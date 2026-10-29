import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createStore } from '../server/domain.ts';
import { createReviewStore } from '../server/review.ts';
import { createWorkflows } from '../server/workflows.ts';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DEMO_DIR = resolve(PROJECT_ROOT, 'data/demo');
export const DEFAULT_SEED_PATH = resolve(PROJECT_ROOT, 'demo/synthetic-seed-v1.json');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Row = Record<string, any>;
type Tables = Record<string, Record<string, Row[]>>;
const columns: Record<string, Record<string, string[]>> = {
  legacy: {
    media: ['id','project_id','filename','content_type','sha256','bytes'],
    captures: ['id','project_id','data_mode','record_json'],
    placement_events: ['id','project_id','capture_id','event_json'],
    assessment_revisions: ['revision_id','assessment_id','project_id','capture_id','scope_id','scope_revision','model_version_id','revision','previous_revision_id','record_json'],
    exports: ['id','project_id','manifest_json','report_html','summary_json'],
  },
  review: {
    review_metadata: ['key','value'], review_configuration: ['id','record_json'],
    review_captures: ['id','record_json'], review_media: ['id','filename','content_type','sha256','bytes'],
    review_findings: ['revision_id','finding_id','capture_id','element_id','scope_id','scope_revision','model_version_id','revision','previous_revision_id','record_json'],
    review_task_events: ['id','task_id','event_json'],
    reconciliation_revisions: ['revision_id','entry_id','workspace','project_id','revision','record_json'],
    local_draft_revisions: ['revision_id','draft_id','workspace','project_id','revision','record_json'],
    review_exports: ['id','manifest_json','report_html','summary_json'],
  },
};
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function exactKeys(value: unknown, keys: string[], label: string): asserts value is Row {
  ensure(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  ensure(Object.keys(value).sort().join('|') === [...keys].sort().join('|'), `${label} has unsupported or missing fields.`);
}
function readArtifact(ref: unknown, bundleDir: string): string {
  exactKeys(ref, ['file','sha256'], 'Packet artifact');
  ensure(typeof ref.file === 'string' && /^packets\/[a-z0-9-]+\.(manifest|summary)\.json$|^packets\/[a-z0-9-]+\.report\.html$/.test(ref.file), 'Unsupported demo packet path.');
  const path = resolve(bundleDir, ref.file);
  ensure(path.startsWith(resolve(bundleDir,'packets') + '/'), 'Demo packet path leaves its bundle.');
  const body = readFileSync(path, 'utf8');
  ensure(digest(body) === ref.sha256, `Demo packet artifact changed: ${ref.file}.`);
  return body;
}

/** Reads only the checked-in allowlisted synthetic bundle, never current databases, .env or local photographs. */
export function loadDemoSeed(seedPath = DEFAULT_SEED_PATH) {
  const source = readFileSync(seedPath, 'utf8');
  const seed = JSON.parse(source) as Row;
  exactKeys(seed, ['schema_version','label','data_mode','project_id','model_id','model_version_id','reviewer_id','tables','uploads'], 'Demo bundle');
  ensure(seed.schema_version === 'forma-recap.synthetic-demo/1' && seed.data_mode === 'fixture', 'Only version 1 synthetic fixture seeds are supported.');
  ensure(seed.project_id === 'fixture-project' && seed.model_id === 'fixture-model' && seed.model_version_id === 'fixture-model-v7' && seed.reviewer_id === 'fixture-reviewer', 'Demo project, model and reviewer must remain synthetic.');
  exactKeys(seed.tables, ['legacy','review'], 'Demo databases');
  const tables: Tables = { legacy: {}, review: {} };
  for (const [namespace, schema] of Object.entries(columns)) {
    exactKeys(seed.tables[namespace], Object.keys(schema), `${namespace} tables`);
    for (const [table, fields] of Object.entries(schema)) {
      const records = seed.tables[namespace][table];
      ensure(Array.isArray(records), `${table} must be an array.`);
      tables[namespace][table] = records.map((raw: Row) => {
        exactKeys(raw, fields, table);
        const row = { ...raw };
        for (const field of fields) {
          if (field === 'report_html' || field === 'manifest_json' || field === 'summary_json') row[field] = readArtifact(row[field], dirname(seedPath));
          else if (field.endsWith('_json')) {
            ensure(row[field] && typeof row[field] === 'object', `${table}.${field} must be readable JSON.`);
            row[field] = JSON.stringify(row[field]);
          } else ensure(row[field] === null || ['number','string'].includes(typeof row[field]), `Unsupported ${table}.${field} value.`);
        }
        return row;
      });
    }
  }
  ensure(tables.review.review_configuration.length === 0, 'The demo must not contain local project configuration.');
  ensure(canonicalJson(tables.review.review_metadata) === canonicalJson([{key:'workspace',value:'fixture'}]), 'The review database must be synthetic.');
  const mediaHashes = new Map<string,string>();
  for (const media of tables.legacy.media) {
    ensure(media.project_id === seed.project_id && /^fixture-(plan|capture-0[12])\.svg$/.test(media.filename), 'Only bundled fixture media can be seeded.');
    const bytes = readFileSync(resolve(PROJECT_ROOT,'server/media',media.filename));
    ensure(digest(bytes) === media.sha256 && bytes.length === media.bytes, 'Bundled fixture media changed.');
    mediaHashes.set(media.id, media.sha256);
  }
  ensure(Array.isArray(seed.uploads) && seed.uploads.length === tables.review.review_media.length, 'Every imported synthetic source needs an upload mapping.');
  const trusted = readFileSync(resolve(PROJECT_ROOT,'server/media/synthetic-recapture.png'));
  const uploads: (Row & {body:Buffer})[] = seed.uploads.map((entry: Row): Row & {body:Buffer} => {
    exactKeys(entry, ['capture_id','filename','source','sha256','bytes'], 'Synthetic upload');
    ensure(entry.source === 'server/media/synthetic-recapture.png' && /^photo-[a-z0-9-]+\.original$/.test(entry.filename), 'Only the bundled synthetic recapture source can be seeded.');
    ensure(entry.sha256 === digest(trusted) && entry.bytes === trusted.length, 'Synthetic upload hash or length does not match the bundled image.');
    const media = tables.review.review_media.find(row => row.id === entry.capture_id);
    ensure(media && media.filename === entry.filename && media.sha256 === entry.sha256 && media.bytes === entry.bytes && media.content_type === 'image/png', 'Synthetic upload metadata is inconsistent.');
    const capture = tables.review.review_captures.find(row => row.id === entry.capture_id);
    ensure(capture, 'Synthetic upload has no capture record.');
    const record = JSON.parse(capture.record_json);
    ensure(record.workspace === 'fixture' && record.data_mode === 'synthetic_test' && record.source_kind === 'synthetic_test', 'Uploaded evidence must be explicitly synthetic.');
    mediaHashes.set(entry.capture_id, entry.sha256);
    return { ...entry, body: trusted };
  });
  const scan = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Row;
    for (const [key, item] of Object.entries(record)) {
      ensure(!/^(?:access_token|refresh_token|client_secret|password|authorization|cookie|session|csrfToken)$/i.test(key), 'Private credentials or session fields are forbidden in a demo seed.');
      if (key === 'workspace') ensure(item === 'fixture', 'Local/live workspace records cannot enter the demo seed.');
      if (key === 'data_mode') ensure(item === 'fixture' || item === 'synthetic_test', 'Live evidence cannot enter the demo seed.');
      if (key === 'project_id') ensure(item === seed.project_id, 'Foreign project records cannot enter the demo seed.');
      if (['reviewer_id','generated_by','recorded_by','created_by','updated_by','author'].includes(key)) ensure(item === seed.reviewer_id, 'Demo reviewer references must be synthetic.');
      if (key === 'model_id') ensure(item === seed.model_id, 'Demo model references must be synthetic.');
      if (key === 'model_version_id') ensure(item === seed.model_version_id, 'Demo model versions must be synthetic.');
      if (key === 'scope_id') ensure(item === 'fixture-scope', 'Demo scope references must remain synthetic.');
      if (key === 'scope_ref' || key === 'source_scope_ref') { const scope = item as Row; ensure(scope.scope_id === 'fixture-scope' && scope.revision === 1, 'Demo scope revision changed.'); }
      if (key === 'element_id' || key === 'external_id') ensure(['DUCT-01','DUCT-02','DUCT-03'].includes(item as string), 'Foreign model element cannot enter the demo seed.');
      if (key === 'element_ids') ensure(Array.isArray(item) && item.every(id => ['DUCT-01','DUCT-02','DUCT-03'].includes(id)), 'Foreign model scope cannot enter the demo seed.');
      if (key === 'is_verified_3d_registration') ensure(item === false, 'Demo associations cannot claim verified registration.');
      if (key === 'external_submission_enabled') ensure(item === false, 'Demo drafts cannot enable external submission.');
      if (key === 'external_record_id' || key === 'ai_suggestion_id') ensure(item === null, 'Demo seed cannot include external records or AI suggestions.');
      if (key === 'capture_ref') { const capture = item as Row; ensure(mediaHashes.get(capture.capture_id) === capture.content_sha256, 'Capture source hash is outside the synthetic evidence set.'); }
      if (key.endsWith('model_ref')) { const model = item as Row; ensure(model.model_id === seed.model_id && model.version_id === seed.model_version_id, 'Model reference must retain the exact synthetic version.'); }
      scan(item);
    }
  };
  for (const namespace of Object.values(tables)) for (const [table, rows] of Object.entries(namespace)) for (const row of rows) {
    for (const [key, value] of Object.entries(row)) if (key.endsWith('_json')) scan(JSON.parse(value));
    if ('project_id' in row) ensure(row.project_id === seed.project_id, `Foreign ${table} project.`);
    if ('workspace' in row) ensure(row.workspace === 'fixture', `Foreign ${table} workspace.`);
    if (table === 'captures') ensure(row.data_mode === 'fixture', 'Legacy captures must remain synthetic.');
    if (table === 'exports' || table === 'review_exports') {
      const manifest = JSON.parse(row.manifest_json);
      ensure(manifest.id === row.id && manifest.data_mode === 'fixture' && manifest.generated_by === seed.reviewer_id, 'Packet identity or provenance is not synthetic.');
      ensure(digest(canonicalJson(manifest.snapshot)) === manifest.snapshot_sha256, 'Packet snapshot hash changed.');
      for (const media of manifest.snapshot.media) ensure(digest(Buffer.from(media.original_base64,'base64')) === media.content_sha256 && mediaHashes.get(media.id) === media.content_sha256, 'Packet original media changed.');
      for (const display of manifest.snapshot.display_media ?? []) ensure(digest(Buffer.from(display.display_base64,'base64')) === display.content_sha256 && mediaHashes.get(display.id) === display.source_content_sha256, 'Packet display derivative changed.');
      ensure(JSON.parse(row.summary_json).id === row.id && row.report_html.includes(row.id), 'Packet report/manifest identity differs.');
    }
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([namespace, schema]) => [namespace,Object.fromEntries(Object.entries(schema).map(([table, rows]) => [table,rows.length]))]));
  return { tables, uploads, counts, bundle_sha256: digest(source), schema_version: seed.schema_version };
}

function seedDatabase(dbPath: string, namespace: string, tables: Record<string, Row[]>) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
  try {
    for (const [table, records] of Object.entries(tables)) {
      const fields = columns[namespace][table];
      for (const row of records) {
        const primary = fields[0];
        const existing = db.prepare(`SELECT * FROM ${table} WHERE ${primary}=?`).get(row[primary]);
        if (existing) {
          if (table === 'captures') {
            ensure(existing.id === row.id && existing.project_id === row.project_id && existing.data_mode === row.data_mode, 'Initialized fixture identity differs.');
            db.prepare('UPDATE captures SET record_json=? WHERE id=?').run(row.record_json,row.id);
          } else ensure(canonicalJson(existing) === canonicalJson(row), `Initialized ${table} differs from the saved seed.`);
          continue;
        }
        db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...fields.map(field => row[field]));
      }
    }
    ensure(db.prepare('PRAGMA integrity_check').get()?.integrity_check === 'ok', 'Seeded database integrity failed.');
    ensure(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'Seeded database has broken references.');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
}

/** Refuses existing data. A staged import publishes both databases and media together only after validation. */
export function setupDemo({ targetDir = DEFAULT_DEMO_DIR, seedPath = DEFAULT_SEED_PATH }: {targetDir?:string;seedPath?:string} = {}) {
  const target = resolve(targetDir);
  if (existsSync(target)) ensure(statSync(target).isDirectory() && readdirSync(target).length === 0, 'Demo setup refuses a nonempty target. Choose a new empty directory; existing reviews and .env are never overwritten.');
  const bundle = loadDemoSeed(seedPath);
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  const staging = resolve(dirname(target),`.forma-recap-demo-${randomUUID()}`);
  mkdirSync(staging,{mode:0o700});
  let legacy: ReturnType<typeof createStore> | undefined;
  let review: ReturnType<typeof createReviewStore> | undefined;
  try {
    legacy = createStore({dbPath:resolve(staging,'fixture.sqlite'),mediaDir:resolve(PROJECT_ROOT,'server/media'),mode:'fixture'});
    review = createReviewStore({dbPath:resolve(staging,'fixture-review.sqlite'),uploadDir:resolve(staging,'fixture-originals'),workspace:'fixture',legacyStore:legacy,syntheticImportPath:resolve(PROJECT_ROOT,'server/media/synthetic-recapture.png')});
    createWorkflows({db:review.db,context:()=>review!.bootstrap(),getFindingRevision:review.getFindingRevision,getCapture:review.getCapture});
    review.close(); review=undefined; legacy.close(); legacy=undefined;
    seedDatabase(resolve(staging,'fixture.sqlite'),'legacy',bundle.tables.legacy);
    seedDatabase(resolve(staging,'fixture-review.sqlite'),'review',bundle.tables.review);
    for (const upload of bundle.uploads) writeFileSync(resolve(staging,'fixture-originals',upload.filename),upload.body,{flag:'wx',mode:0o600});
    const marker = {schema_version:bundle.schema_version,data_mode:'fixture',label:'Isolated synthetic acceptance demonstration; no real evidence or live APS data.',bundle_sha256:bundle.bundle_sha256,created_at:new Date().toISOString(),counts:bundle.counts};
    writeFileSync(resolve(staging,'demo-environment.json'),JSON.stringify(marker,null,2)+'\n',{flag:'wx',mode:0o600});
    for (const file of ['fixture.sqlite','fixture-review.sqlite']) chmodSync(resolve(staging,file),0o600);
    renameSync(staging,target);
    return {targetDir:target,...marker};
  } catch (error) {
    review?.close(); legacy?.close(); rmSync(staging,{recursive:true,force:true}); throw error;
  }
}
export function demoDirectory(args: string[]) {
  if (!args.length) return DEFAULT_DEMO_DIR;
  ensure(args.length === 2 && args[0] === '--data-dir' && !!args[1], 'Use --data-dir <new-empty-directory> or omit arguments for data/demo.');
  return resolve(args[1]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = setupDemo({targetDir:demoDirectory(process.argv.slice(2))}); console.log(`Synthetic Forma ReTrace demo prepared at ${result.targetDir}. Run npm run demo (or use the same --data-dir).`); }
  catch (error) { console.error((error as Error).message); process.exitCode=1; }
}
