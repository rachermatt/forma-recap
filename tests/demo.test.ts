import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createStore } from '../server/domain.ts';
import { createReviewStore } from '../server/review.ts';
import { createWorkflows } from '../server/workflows.ts';
import { DEFAULT_SEED_PATH, loadDemoSeed, PROJECT_ROOT, setupDemo } from '../scripts/demo-setup.ts';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function directory(t: {after:(fn:()=>void)=>void}) { const path=mkdtempSync(join(tmpdir(),'forma-recap-demo-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path; }

test('versioned demo seed contains only allowlisted synthetic records and verified fixed packets', () => {
  const seed=loadDemoSeed();
  assert.equal(seed.schema_version,'forma-recap.synthetic-demo/1');
  assert.deepEqual(seed.counts.legacy,{media:3,captures:2,placement_events:5,assessment_revisions:3,exports:2});
  assert.deepEqual(seed.counts.review,{review_metadata:1,review_configuration:0,review_captures:1,review_media:1,review_findings:4,review_task_events:3,reconciliation_revisions:5,local_draft_revisions:2,review_exports:2});
  assert.equal(seed.uploads.length,1);
  assert.equal(digest(seed.uploads[0].body),seed.uploads[0].sha256);
  assert.equal(seed.uploads[0].source,'server/media/synthetic-recapture.png');
  assert.equal(Object.hasOwn(seed.tables,'local'),false);
  for(const row of seed.tables.review.review_findings){const finding=JSON.parse(row.record_json);assert.equal(finding.workspace,'fixture');assert.equal(finding.review.reviewer_id,'fixture-reviewer');assert.equal(finding.model_ref.version_id,'fixture-model-v7');}
});

test('fresh demo setup restores the complete saved journey with exact identities, histories and snapshots', t => {
  const target=join(directory(t),'demo');const bundle=loadDemoSeed();
  const prepared=setupDemo({targetDir:target});
  assert.equal(prepared.bundle_sha256,bundle.bundle_sha256);
  assert.deepEqual(readdirSync(target).sort(),['demo-environment.json','fixture-originals','fixture-review.sqlite','fixture.sqlite']);
  const legacy=createStore({dbPath:join(target,'fixture.sqlite'),mediaDir:resolve(PROJECT_ROOT,'server/media'),mode:'fixture'});
  const review=createReviewStore({dbPath:join(target,'fixture-review.sqlite'),uploadDir:join(target,'fixture-originals'),workspace:'fixture',legacyStore:legacy,syntheticImportPath:resolve(PROJECT_ROOT,'server/media/synthetic-recapture.png')});
  const workflows=createWorkflows({db:review.db,context:()=>review.bootstrap(),getFindingRevision:review.getFindingRevision,getCapture:review.getCapture});
  try {
    assert.equal(legacy.bootstrap().assessments.length,2);
    assert.equal(legacy.snapshotContext().assessment_history.length,3);
    const state=review.bootstrap();
    assert.equal(state.findings.length,3);assert.equal(state.finding_revisions.length,4);assert.equal(state.captures.length,3);
    const firstCapture=state.findings.filter(record=>record.capture_ref.capture_id==='fixture-capture-01');
    assert.equal(firstCapture.find(record=>record.model_ref.element_id==='DUCT-01')?.state,'observed_installed');
    assert.equal(firstCapture.find(record=>record.model_ref.element_id==='DUCT-03')?.state,'needs_review');
    assert.equal(state.findings.some(record=>record.model_ref.element_id==='DUCT-02'),false);
    assert.equal(state.tasks[0].capture_status,'completed');assert.equal(state.tasks[0].review_status,'reassessed');
    const subsequent=state.findings.find(record=>record.recapture_task_ref);
    assert.ok(subsequent);assert.equal(subsequent.recapture_task_ref.originating_finding_revision_id,state.tasks[0].finding_revision_id);
    assert.equal(state.task_events.length,3);
    const upload=state.captures.find(capture=>capture.data_mode==='synthetic_test');assert.ok(upload);
    assert.deepEqual(upload.capture_ref,JSON.parse(bundle.tables.review.review_captures[0].record_json).capture_ref);
    assert.equal(legacy.bootstrap().captures[0].capture_ref.date_precision,'date');assert.equal(legacy.bootstrap().captures[0].capture_ref.captured_at,null);
    assert.equal(digest(review.getMedia(upload.capture_id).body),bundle.uploads[0].sha256);
    assert.equal(workflows.bootstrap().reconciliations.length,5);
    assert.ok(workflows.bootstrap().reconciliations.some((row:Record<string,any>)=>row.category==='unresolved'&&row.quantity===null));
    assert.equal(workflows.bootstrap().reconciliation_summary.comparisons[0].delta,3);
    const draft=workflows.bootstrap().drafts[0];assert.equal(draft.revision,2);assert.equal(workflows.draftHistory(draft.draft_id).length,2);assert.equal(draft.external_submission_enabled,false);assert.equal(draft.external_record_id,null);
    for(const [kind,table] of [['legacy','exports'],['review','review_exports']] as const)for(const row of bundle.tables[kind][table]){
      const packet=kind==='legacy'?legacy.getExport(row.id):review.getExport(row.id);
      assert.equal(packet.html,row.report_html);
      assert.deepEqual(packet.manifest,JSON.parse(row.manifest_json));
      assert.deepEqual(packet.summary,JSON.parse(row.summary_json));
    }
    const database=new DatabaseSync(join(target,'fixture-review.sqlite'),{readOnly:true});
    for(const [table,rows] of Object.entries(bundle.tables.review))assert.deepEqual(JSON.parse(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),rows);
    database.close();
  } finally {review.close();legacy.close();}
});

test('demo setup refuses populated targets and preserves neighboring data and configuration', t => {
  const parent=directory(t);const target=join(parent,'demo');
  writeFileSync(join(parent,'.env'),'private-installation-sentinel');writeFileSync(join(parent,'fixture.sqlite'),'existing-working-data');
  setupDemo({targetDir:target});
  const before=digest(readFileSync(join(target,'fixture-review.sqlite')));
  assert.throws(()=>setupDemo({targetDir:target}),/refuses a nonempty target/);
  assert.equal(digest(readFileSync(join(target,'fixture-review.sqlite'))),before);
  assert.equal(readFileSync(join(parent,'.env'),'utf8'),'private-installation-sentinel');assert.equal(readFileSync(join(parent,'fixture.sqlite'),'utf8'),'existing-working-data');
  assert.equal(existsSync(join(target,'local-review.sqlite')),false);
  const occupied=join(parent,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'keep.txt'),'keep');
  assert.throws(()=>setupDemo({targetDir:occupied}),/refuses a nonempty target/);assert.equal(readFileSync(join(occupied,'keep.txt'),'utf8'),'keep');
});

test('modified packet artifacts or foreign provenance reject the seed before creating a destination', t => {
  const parent=directory(t);const copied=join(parent,'seed');mkdirSync(copied);copyFileSync(DEFAULT_SEED_PATH,join(copied,'synthetic-seed-v1.json'));cpSync(resolve(PROJECT_ROOT,'demo/packets'),join(copied,'packets'),{recursive:true});
  const seed=JSON.parse(readFileSync(join(copied,'synthetic-seed-v1.json'),'utf8'));
  seed.tables.review.review_findings[0].record_json.workspace='local';
  writeFileSync(join(copied,'synthetic-seed-v1.json'),JSON.stringify(seed));
  const target=join(parent,'rejected');assert.throws(()=>setupDemo({targetDir:target,seedPath:join(copied,'synthetic-seed-v1.json')}),/Local\/live workspace/);assert.equal(existsSync(target),false);
  copyFileSync(DEFAULT_SEED_PATH,join(copied,'synthetic-seed-v1.json'));
  const packet=JSON.parse(readFileSync(DEFAULT_SEED_PATH,'utf8')).tables.review.review_exports[0].report_html.file;
  writeFileSync(join(copied,packet),'changed report');
  assert.throws(()=>setupDemo({targetDir:target,seedPath:join(copied,'synthetic-seed-v1.json')}),/artifact changed/);assert.equal(existsSync(target),false);
});
