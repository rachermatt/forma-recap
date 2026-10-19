import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fixtureCaptures, fixtureMedia, fixtureModel, fixturePlan, fixtureProject, fixtureReviewer, fixtureScope } from './fixtures.ts';
import { displayMedia } from './media-render.ts';

type JsonObject = Record<string, any>;
type StoreOptions = { dbPath: string; mediaDir: string; mode: string };

export class DomainError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'DomainError'; this.status = status; }
}
function fail(status: number, message: string): never { throw new DomainError(status, message); }
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
const projectId = fixtureProject.id;

/** Stable content serialization excludes volatile export IDs and generation times at its call site. */
export function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function object(value: unknown, fields: string[], required = fields): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  const result = value as JsonObject;
  if (Object.keys(result).some(key => !fields.includes(key))) fail(400, 'Unsupported fields in request or record.');
  if (required.some(key => !Object.hasOwn(result, key))) fail(400, `Missing required field: ${required.find(key => !Object.hasOwn(result, key))}.`);
  return result;
}
function text(value: unknown, label: string, max = 6000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must be a nonempty string of at most ${max} characters.`);
}
function nullableText(value: unknown, label: string) {
  if (value !== null) text(value, label);
}
function integer(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(400, `${label} must be a positive integer.`);
}
function date(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a valid calendar date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} must be a valid calendar date.`);
}
function timestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, `${label} must be a timezone-aware timestamp.`);
  date(value.slice(0, 10), label);
  const time = value.slice(11, 19).split(':').map(Number);
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) fail(400, `${label} contains an invalid time.`);
}
function enumValue(value: unknown, choices: string[], label: string) {
  if (typeof value !== 'string' || !choices.includes(value)) fail(400, `Unsupported ${label}.`);
}
function validPin(value: unknown) {
  const pin = object(value, ['x', 'y', 'origin']);
  if (pin.origin !== 'top_left' || !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || pin.x < 0 || pin.x > 1 || pin.y < 0 || pin.y > 1) fail(400, 'Plan pins require finite normalized x/y in [0, 1] with top_left origin.');
}

/** Format-aware contract validation plus cross-record invariants for this scoped workflow. */
export function validateAssessment(value: unknown): asserts value is JsonObject {
  const record = object(value, ['schema_version', 'data_mode', 'assessment_id', 'project_id', 'scope_ref', 'model_ref', 'capture_ref', 'placement', 'state', 'rationale', 'uncertainty_reason', 'evidence', 'review', 'previous_revision_id', 'ai_suggestion_id']);
  if (record.schema_version !== '0.1.0') fail(400, 'Unsupported assessment schema version.');
  enumValue(record.data_mode, ['fixture', 'live'], 'data mode');
  text(record.assessment_id, 'Assessment ID'); text(record.project_id, 'Project ID');
  const scope = object(record.scope_ref, ['scope_id', 'revision', 'trade', 'zone_id']);
  text(scope.scope_id, 'Scope ID'); integer(scope.revision, 'Scope revision'); text(scope.trade, 'Trade'); text(scope.zone_id, 'Zone');
  const model = object(record.model_ref, ['model_id', 'version_id', 'viewable_id', 'element_refs'], ['model_id', 'version_id', 'element_refs']);
  text(model.model_id, 'Model ID'); text(model.version_id, 'Model version');
  if (Object.hasOwn(model, 'viewable_id')) nullableText(model.viewable_id, 'Viewable ID');
  if (!Array.isArray(model.element_refs)) fail(400, 'Element references must be an array.');
  const seen = new Set<string>();
  for (const raw of model.element_refs) {
    const element = object(raw, ['model_id', 'version_id', 'external_id']);
    text(element.model_id, 'Element model'); text(element.version_id, 'Element model version'); text(element.external_id, 'External element ID');
    if (element.model_id !== model.model_id || element.version_id !== model.version_id) fail(400, 'Element references must use the selected model and exact version.');
    if (seen.has(element.external_id)) fail(400, 'Duplicate model element reference.');
    seen.add(element.external_id);
  }
  const capture = object(record.capture_ref, ['capture_id', 'content_sha256', 'captured_at', 'captured_date', 'date_precision', 'date_source', 'original_timezone', 'uploaded_at']);
  text(capture.capture_id, 'Capture ID');
  if (capture.content_sha256 !== null && (typeof capture.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(capture.content_sha256))) fail(400, 'Invalid capture content hash.');
  enumValue(capture.date_precision, ['timestamp', 'date', 'unknown'], 'capture date precision');
  enumValue(capture.date_source, ['device_metadata', 'file_metadata', 'uploader_supplied', 'fixture', 'unknown'], 'capture date source');
  nullableText(capture.original_timezone, 'Original timezone'); timestamp(capture.uploaded_at, 'Upload timestamp');
  if (capture.date_precision === 'timestamp') {
    timestamp(capture.captured_at, 'Capture timestamp'); date(capture.captured_date, 'Capture date');
    if (capture.captured_at.slice(0, 10) !== capture.captured_date) fail(400, 'Capture date must preserve the original timestamp date.');
  } else if (capture.date_precision === 'date') {
    if (capture.captured_at !== null) fail(400, 'Date-only evidence cannot have an invented capture time.');
    date(capture.captured_date, 'Capture date');
  } else if (capture.captured_at !== null || capture.captured_date !== null) fail(400, 'Unknown capture date must remain unknown.');
  if (record.data_mode === 'live' && (capture.content_sha256 === null || capture.date_source === 'fixture')) fail(400, 'Live evidence requires a real content hash and non-fixture provenance.');
  const placement = object(record.placement, ['method', 'plan_ref', 'normalized_pin', 'is_verified_3d_registration']);
  enumValue(placement.method, ['manual_plan_pin', 'explicit_model_association', 'none'], 'placement method');
  if (placement.is_verified_3d_registration !== false) fail(400, 'Manual associations are not verified 3D registration.');
  if (placement.method === 'manual_plan_pin') {
    const plan = object(placement.plan_ref, ['file_id', 'version_id']);
    text(plan.file_id, 'Plan file'); text(plan.version_id, 'Plan version'); validPin(placement.normalized_pin);
  } else if (placement.plan_ref !== null || placement.normalized_pin !== null) fail(400, 'Only a manual plan pin may contain plan coordinates.');
  enumValue(record.state, ['observed_installed', 'not_observed', 'needs_review'], 'assessment state');
  text(record.rationale, 'Rationale'); nullableText(record.uncertainty_reason, 'Uncertainty reason');
  if (record.state !== 'observed_installed') text(record.uncertainty_reason, 'Uncertainty reason');
  if (!Array.isArray(record.evidence) || !record.evidence.length) fail(400, 'Source evidence is required.');
  for (const raw of record.evidence) {
    const evidence = object(raw, ['capture_id', 'derivative_id', 'description']);
    text(evidence.capture_id, 'Evidence capture'); nullableText(evidence.derivative_id, 'Evidence derivative'); text(evidence.description, 'Evidence description');
    if (evidence.capture_id !== capture.capture_id) fail(400, 'Authoritative evidence must belong to the selected capture date.');
  }
  const review = object(record.review, ['authority', 'reviewer_id', 'reviewed_at', 'revision', 'revision_id']);
  if (review.authority !== 'human_reviewer') fail(400, 'Only human reviewer assessments are supported.');
  text(review.reviewer_id, 'Reviewer'); timestamp(review.reviewed_at, 'Review timestamp'); integer(review.revision, 'Assessment revision'); text(review.revision_id, 'Revision ID');
  if (review.revision === 1 && record.previous_revision_id !== null) fail(400, 'A first revision must not have a predecessor.');
  if (review.revision > 1) text(record.previous_revision_id, 'Previous revision');
  nullableText(record.ai_suggestion_id, 'AI suggestion');
  if (record.ai_suggestion_id !== null) fail(400, 'AI suggestions are not enabled in this prototype.');
}

const sqlSchema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, filename TEXT NOT NULL,
    content_type TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS captures (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data_mode TEXT NOT NULL CHECK(data_mode = 'fixture'), record_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS placement_events (
    id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, capture_id TEXT NOT NULL REFERENCES captures(id), event_json TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS assessment_revisions (
    revision_id TEXT PRIMARY KEY, assessment_id TEXT NOT NULL, project_id TEXT NOT NULL,
    capture_id TEXT NOT NULL REFERENCES captures(id), scope_id TEXT NOT NULL, scope_revision INTEGER NOT NULL,
    model_version_id TEXT NOT NULL, revision INTEGER NOT NULL, previous_revision_id TEXT REFERENCES assessment_revisions(revision_id),
    record_json TEXT NOT NULL, UNIQUE(assessment_id, revision),
    UNIQUE(project_id, capture_id, scope_id, scope_revision, model_version_id, revision)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, manifest_json TEXT NOT NULL, report_html TEXT NOT NULL, summary_json TEXT NOT NULL
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS revisions_no_update BEFORE UPDATE ON assessment_revisions BEGIN SELECT RAISE(ABORT, 'Assessment revisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS revisions_no_delete BEFORE DELETE ON assessment_revisions BEGIN SELECT RAISE(ABORT, 'Assessment revisions are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS exports_no_update BEFORE UPDATE ON exports BEGIN SELECT RAISE(ABORT, 'Evidence exports are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS exports_no_delete BEFORE DELETE ON exports BEGIN SELECT RAISE(ABORT, 'Evidence exports are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS media_no_update BEFORE UPDATE ON media BEGIN SELECT RAISE(ABORT, 'Original media metadata is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS media_no_delete BEFORE DELETE ON media BEGIN SELECT RAISE(ABORT, 'Original media metadata is immutable'); END;
  CREATE TRIGGER IF NOT EXISTS placements_no_update BEFORE UPDATE ON placement_events BEGIN SELECT RAISE(ABORT, 'Placement events are immutable'); END;
  CREATE TRIGGER IF NOT EXISTS placements_no_delete BEFORE DELETE ON placement_events BEGIN SELECT RAISE(ABORT, 'Placement events are immutable'); END;
`;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
const stateLabel = (state: string) => ({ observed_installed: 'Observed installed', not_observed: 'Not observed in reviewed evidence', needs_review: 'Needs review' })[state] || state;

function buildReport(manifest: JsonObject): string {
  const captureDate = (ref: JsonObject) => `${escapeHtml(ref.captured_at ?? ref.captured_date ?? 'Unknown')} (${escapeHtml(ref.date_precision)}; source ${escapeHtml(ref.date_source)}; original timezone ${escapeHtml(ref.original_timezone ?? 'not recorded')})`;
  const evidence = manifest.snapshot.media.map((entry: JsonObject) => {
    const capture = manifest.snapshot.captures.find((item: JsonObject) => item.capture_id === entry.id);
    const provenance = capture ? `<p>Captured ${captureDate(capture.capture_ref)}<br>Uploaded ${escapeHtml(capture.capture_ref.uploaded_at)}</p>` : `<p>Reference plan version ${escapeHtml(manifest.snapshot.plan.version_id)}</p>`;
    const display = manifest.snapshot.display_media.find((item: JsonObject) => item.id === entry.id);
    return `<figure><img alt="${escapeHtml(entry.id)} — synthetic fixture display derivative" src="data:${display.content_type};base64,${display.display_base64}"><figcaption>${escapeHtml(entry.id)} · original SHA-256 ${entry.content_sha256}<br>Display: ${escapeHtml(display.method)} · display SHA-256 ${display.content_sha256}. Original SVG bytes remain unchanged in the manifest.${provenance}</figcaption></figure>`;
  }).join('');
  const rows = manifest.snapshot.current_assessments.map((assessment: JsonObject) => `<article><h3>${escapeHtml(stateLabel(assessment.state))}</h3><p>${escapeHtml(assessment.rationale)}</p>${assessment.uncertainty_reason ? `<p><strong>Evidence limitation:</strong> ${escapeHtml(assessment.uncertainty_reason)}</p>` : ''}<dl><dt>Capture</dt><dd>${escapeHtml(assessment.capture_ref.capture_id)} · ${captureDate(assessment.capture_ref)}</dd><dt>Uploaded</dt><dd>${escapeHtml(assessment.capture_ref.uploaded_at)}</dd><dt>Model</dt><dd>${escapeHtml(assessment.model_ref.model_id)} / ${escapeHtml(assessment.model_ref.version_id)}</dd><dt>Elements</dt><dd>${assessment.model_ref.element_refs.map((entry: JsonObject) => escapeHtml(entry.external_id)).join(', ')}</dd><dt>Review</dt><dd>${escapeHtml(assessment.review.reviewer_id)} at ${escapeHtml(assessment.review.reviewed_at)} · revision ${assessment.review.revision}</dd><dt>Placement</dt><dd>Manual plan pin; top-left normalized coordinates (${assessment.placement.normalized_pin?.x}, ${assessment.placement.normalized_pin?.y}); not verified 3D registration.</dd></dl></article>`).join('');
  const history = manifest.snapshot.assessment_history.map((assessment: JsonObject) => `<li>${escapeHtml(assessment.capture_ref.capture_id)} · revision ${assessment.review.revision} · ${escapeHtml(stateLabel(assessment.state))} · ${escapeHtml(assessment.review.reviewed_at)}<p>${escapeHtml(assessment.rationale)}</p>${assessment.uncertainty_reason ? `<p>Evidence limitation: ${escapeHtml(assessment.uncertainty_reason)}</p>` : ''}<small>Revision ${escapeHtml(assessment.review.revision_id)}; predecessor ${escapeHtml(assessment.previous_revision_id ?? 'none')}</small></li>`).join('');
  // JSON is inert text and escapes '<' to prevent an embedded </script> from ending the manifest.
  const json = JSON.stringify(manifest, null, 2).replaceAll('<', '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Forma ReCap · Fixture evidence packet</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1100px;margin:48px auto;padding:0 24px;color:#1d2832;background:#f7f8fa}header,article,figure,details{background:white;padding:24px;margin:20px 0;border:1px solid #ccd4dc;border-radius:12px}h1{font-size:36px}h2{margin-top:40px}img{display:block;max-width:100%;height:auto}figcaption,small{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}dt{font-weight:700}dd{margin-bottom:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.notice{border-left:5px solid #c66a25;padding:12px 16px;background:#fff1df}@media print{body{margin:0}article,figure{break-inside:avoid}}</style></head><body><header><p>FORMA RECAP · SYNTHETIC FIXTURE</p><h1>Evidence review packet</h1><p>${escapeHtml(fixtureProject.name)} · ${escapeHtml(fixtureScope.name)}</p><p>Generated ${escapeHtml(manifest.created_at)} by ${escapeHtml(manifest.generated_by)}</p><p>Packet ${escapeHtml(manifest.id)} · snapshot SHA-256 ${escapeHtml(manifest.snapshot_sha256)}</p></header><p class="notice">Synthetic demonstration evidence only. These human reviewer observations do not establish inspection acceptance, concealed conditions, measured quantities, contractual completion, or payment approval. “Not observed” means not observed in reviewed evidence.</p><h2>Scope and basis</h2><p>${escapeHtml(fixtureScope.floor)} · ${escapeHtml(fixtureScope.trade)} · ${escapeHtml(fixtureScope.zone_id)} · scope revision ${fixtureScope.revision} · model ${fixtureModel.version_id}</p><p>${manifest.current_revision_count} current assessments; ${manifest.history_revision_count} preserved revisions. These are review coverage counts, not a progress percentage. Scope denominator: ${fixtureScope.element_ids.length} explicitly selected model elements. Elements may be reviewed on multiple dates.</p><h2>Current reviewer observations</h2>${rows || '<p>No published reviewer assessments at this snapshot cutoff.</p>'}<h2>Original synthetic evidence</h2><p>Lossless PNG display derivatives avoid gradient-transparency loss in PDF exports. Original SVG bytes and separate display provenance remain embedded in the manifest for offline reconstruction.</p>${evidence}<h2>Correction history</h2><ol>${history || '<li>No published revisions.</li>'}</ol><h2>Integration limits</h2><p>Local fixture packet. Issue creation and external writes are disabled. No APS project access or real-world observation is established.</p><details><summary>Machine-readable manifest</summary><pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre></details><script type="application/json" id="forma-recap-manifest">${json}</script></body></html>`;
}

export function createStore({ dbPath, mediaDir, mode }: StoreOptions) {
  if (mode !== 'fixture' && mode !== 'live') fail(500, 'APP_MODE must be fixture or live.');
  if (!dbPath || !mediaDir) fail(500, 'Database and private media paths are required.');
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(sqlSchema);
  const assertFixture = () => { if (mode !== 'fixture') fail(403, 'Fixture resources are unavailable in live mode.'); };
  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const readBytes = (filename: string) => {
    const path = resolve(mediaDir, filename);
    if (dirname(path) !== resolve(mediaDir)) fail(404, 'Resource unavailable.');
    try {
      const metadata = statSync(path);
      if (!metadata.isFile()) fail(409, 'Original evidence is unavailable.');
      if (metadata.size > 5 * 1024 * 1024) fail(409, 'Original fixture evidence exceeds its allowed size.');
      const bytes = readFileSync(path);
      if (bytes.length > 5 * 1024 * 1024) fail(409, 'Original fixture evidence exceeds its allowed size.');
      return bytes;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      fail(409, 'Original evidence is unavailable. Metadata and prior exports are retained.');
    }
  };
  const mediaRow = (id: string): JsonObject => {
    text(id, 'Media ID', 200);
    const row = db.prepare('SELECT * FROM media WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!row) fail(404, 'Resource unavailable.');
    return row as JsonObject;
  };
  const verifiedMedia = (id: string) => {
    const row = mediaRow(id);
    const body = readBytes(row.filename);
    if (sha256(body) !== row.sha256 || body.length !== row.bytes) fail(409, 'Original evidence has changed. Its stored hash and earlier exports are preserved.');
    return { body, contentType: row.content_type as string, sha256: row.sha256 as string, byteLength: row.bytes as number };
  };
  const mediaStatus = (id: string) => {
    try { verifiedMedia(id); return 'verified'; }
    catch (error) { return error instanceof Error && error.message.includes('has changed') ? 'changed' : 'unavailable'; }
  };
  const captureRecord = (id: string): JsonObject => {
    text(id, 'Capture ID', 200);
    const row = db.prepare('SELECT record_json FROM captures WHERE id = ? AND project_id = ? AND data_mode = ?').get(id, projectId, mode);
    if (!row) fail(404, 'Resource unavailable.');
    return JSON.parse(row.record_json as string);
  };
  const allRevisions = (): JsonObject[] => db.prepare('SELECT record_json FROM assessment_revisions WHERE project_id = ? ORDER BY capture_id, scope_id, revision ASC').all(projectId).map(row => JSON.parse(row.record_json as string));
  const currentRevisions = () => {
    const records = new Map<string, JsonObject>();
    for (const revision of allRevisions()) records.set(revision.assessment_id, revision);
    return [...records.values()];
  };
  const validateReferences = (record: JsonObject) => {
    validateAssessment(record);
    if (record.data_mode !== mode || record.project_id !== projectId) fail(404, 'Resource unavailable.');
    if (canonicalJson(record.scope_ref) !== canonicalJson({ scope_id: fixtureScope.scope_id, revision: fixtureScope.revision, trade: fixtureScope.trade, zone_id: fixtureScope.zone_id })) fail(400, 'Assessment scope does not match the authorized scope revision.');
    if (record.model_ref.model_id !== fixtureModel.id || record.model_ref.version_id !== fixtureScope.model_version_id) fail(400, 'Assessment model version does not match the selected scope.');
    for (const element of record.model_ref.element_refs) if (!(fixtureScope.element_ids as readonly string[]).includes(element.external_id)) fail(400, 'Element is outside the selected scope.');
    const capture = captureRecord(record.capture_ref.capture_id);
    if (canonicalJson(record.capture_ref) !== canonicalJson(capture.capture_ref)) fail(400, 'Capture provenance does not match the stored original.');
    if (record.placement.method === 'manual_plan_pin' && (record.placement.plan_ref.file_id !== fixturePlan.file_id || record.placement.plan_ref.version_id !== fixturePlan.version_id)) fail(400, 'Plan version is outside the selected project.');
  };

  if (mode === 'fixture') {
    try {
      transaction(() => {
        for (const media of fixtureMedia) {
          if (!db.prepare('SELECT id FROM media WHERE id = ?').get(media.id)) {
            const bytes = readBytes(media.file);
            db.prepare('INSERT INTO media VALUES (?, ?, ?, ?, ?, ?)').run(media.id, projectId, media.file, media.contentType, sha256(bytes), bytes.length);
          }
        }
        for (const seed of fixtureCaptures) {
          if (!db.prepare('SELECT id FROM captures WHERE id = ?').get(seed.capture_id)) {
            const capture = clone(seed) as unknown as JsonObject;
            capture.capture_ref.content_sha256 = mediaRow(seed.capture_id).sha256;
            db.prepare('INSERT INTO captures VALUES (?, ?, ?, ?)').run(capture.capture_id, projectId, 'fixture', JSON.stringify(capture));
            db.prepare('INSERT INTO placement_events(project_id, capture_id, event_json) VALUES (?, ?, ?)').run(projectId, capture.capture_id, JSON.stringify({ placement: capture.placement, author: fixtureReviewer.id, placed_at: '2026-10-17T14:00:00Z', reason: 'Synthetic initial manual placement', coordinate_space: 'normalized_plan_top_left', source: 'fixture' }));
          }
        }
      });
    } catch (error) { db.close(); throw error; }
  }

  return {
    bootstrap() {
      if (mode === 'live') return { mode, project: null, model: null, scope: null, plan: null, captures: [], assessments: [], exports: [] };
      const captures: JsonObject[] = fixtureCaptures.map(seed => ({ ...captureRecord(seed.capture_id), media_status: mediaStatus(seed.capture_id) }));
      const exports = db.prepare('SELECT summary_json FROM exports WHERE project_id = ? ORDER BY rowid DESC').all(projectId).map(row => JSON.parse(row.summary_json as string));
      return { mode, project: clone(fixtureProject), model: clone(fixtureModel), scope: clone(fixtureScope), plan: { ...clone(fixturePlan), media_status: mediaStatus(fixturePlan.file_id) }, captures, assessments: currentRevisions(), exports };
    },
    getMedia(id: string) { assertFixture(); const { body, contentType } = verifiedMedia(id); return { body, contentType }; },
    saveAssessment(body: unknown) {
      assertFixture();
      const input = object(body, ['capture_id', 'state', 'rationale', 'uncertainty_reason', 'element_ids', 'previous_revision_id']);
      text(input.capture_id, 'Capture ID', 200); enumValue(input.state, ['observed_installed', 'not_observed', 'needs_review'], 'assessment state');
      text(input.rationale, 'Rationale'); nullableText(input.uncertainty_reason, 'Uncertainty reason');
      if (input.state !== 'observed_installed') text(input.uncertainty_reason, 'Uncertainty reason');
      nullableText(input.previous_revision_id, 'Previous revision');
      if (!Array.isArray(input.element_ids) || !input.element_ids.length || input.element_ids.length > fixtureScope.element_ids.length) fail(400, 'Select at least one element from the explicit scope.');
      if (new Set(input.element_ids).size !== input.element_ids.length) fail(400, 'Duplicate model elements are not allowed.');
      for (const id of input.element_ids) {
        text(id, 'Element ID', 200);
        if (!(fixtureScope.element_ids as readonly string[]).includes(id)) fail(400, 'Element is outside the selected scope and model version.');
      }
      return transaction(() => {
        const capture = captureRecord(input.capture_id);
        verifiedMedia(input.capture_id);
        if (capture.placement.method === 'manual_plan_pin') verifiedMedia(capture.placement.plan_ref.file_id);
        const previousRow = db.prepare('SELECT record_json FROM assessment_revisions WHERE project_id = ? AND capture_id = ? AND scope_id = ? AND scope_revision = ? AND model_version_id = ? ORDER BY revision DESC LIMIT 1').get(projectId, input.capture_id, fixtureScope.scope_id, fixtureScope.revision, fixtureModel.version_id);
        const previous = previousRow ? JSON.parse(previousRow.record_json as string) : null;
        if ((previous?.review.revision_id ?? null) !== input.previous_revision_id) fail(409, 'This assessment has changed. Reload the latest revision before saving a correction.');
        const record = {
          schema_version: '0.1.0', data_mode: mode, assessment_id: previous?.assessment_id ?? `assessment-${randomUUID()}`, project_id: projectId,
          scope_ref: { scope_id: fixtureScope.scope_id, revision: fixtureScope.revision, trade: fixtureScope.trade, zone_id: fixtureScope.zone_id },
          model_ref: { model_id: fixtureModel.id, version_id: fixtureModel.version_id, viewable_id: null, element_refs: [...input.element_ids].sort().map(external_id => ({ model_id: fixtureModel.id, version_id: fixtureModel.version_id, external_id })) },
          capture_ref: clone(capture.capture_ref), placement: clone(capture.placement), state: input.state, rationale: input.rationale.trim(),
          uncertainty_reason: input.uncertainty_reason === null ? null : input.uncertainty_reason.trim(),
          evidence: [{ capture_id: input.capture_id, derivative_id: null, description: 'Original synthetic fixture SVG selected by the local human reviewer.' }],
          review: { authority: 'human_reviewer', reviewer_id: fixtureReviewer.id, reviewed_at: now(), revision: (previous?.review.revision ?? 0) + 1, revision_id: `revision-${randomUUID()}` },
          previous_revision_id: input.previous_revision_id, ai_suggestion_id: null,
        };
        validateReferences(record);
        db.prepare('INSERT INTO assessment_revisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.review.revision_id, record.assessment_id, projectId, input.capture_id, fixtureScope.scope_id, fixtureScope.revision, fixtureModel.version_id, record.review.revision, record.previous_revision_id, JSON.stringify(record));
        return record;
      });
    },
    history(id: string) {
      assertFixture(); text(id, 'Assessment ID', 200);
      const row = db.prepare('SELECT assessment_id FROM assessment_revisions WHERE project_id = ? AND (assessment_id = ? OR revision_id = ?) LIMIT 1').get(projectId, id, id);
      if (!row) fail(404, 'Resource unavailable.');
      return db.prepare('SELECT record_json FROM assessment_revisions WHERE project_id = ? AND assessment_id = ? ORDER BY revision ASC').all(projectId, row.assessment_id).map(entry => JSON.parse(entry.record_json as string));
    },
    placeCapture(id: string, body: unknown): JsonObject {
      assertFixture();
      const input = object(body, ['x', 'y']); validPin({ ...input, origin: 'top_left' });
      return transaction(() => {
        const capture = captureRecord(id);
        verifiedMedia(fixturePlan.file_id);
        capture.placement = { method: 'manual_plan_pin', plan_ref: { file_id: fixturePlan.file_id, version_id: fixturePlan.version_id }, normalized_pin: { x: input.x, y: input.y, origin: 'top_left' }, is_verified_3d_registration: false };
        db.prepare('UPDATE captures SET record_json = ? WHERE id = ? AND project_id = ? AND data_mode = ?').run(JSON.stringify(capture), id, projectId, mode);
        db.prepare('INSERT INTO placement_events(project_id, capture_id, event_json) VALUES (?, ?, ?)').run(projectId, id, JSON.stringify({ placement: capture.placement, author: fixtureReviewer.id, placed_at: now(), reason: 'Reviewer moved manual plan pin', coordinate_space: 'normalized_plan_top_left', source: 'human_reviewer' }));
        return { ...capture, media_status: mediaStatus(id) };
      });
    },
    snapshotContext() {
      assertFixture();
      return { assessment_history: allRevisions(), placement_history: db.prepare('SELECT capture_id, event_json FROM placement_events WHERE project_id = ? ORDER BY id ASC').all(projectId).map(row => ({ capture_id: row.capture_id, ...JSON.parse(row.event_json as string) })) };
    },
    createExport() {
      assertFixture();
      return transaction(() => {
        const history = allRevisions();
        for (const record of history) validateReferences(record);
        const current = currentRevisions();
        const captures = fixtureCaptures.map(seed => captureRecord(seed.capture_id));
        const media = fixtureMedia.map(source => {
          const original = verifiedMedia(source.id);
          return { id: source.id, content_type: original.contentType, content_sha256: original.sha256, byte_length: original.byteLength, original_base64: original.body.toString('base64'), availability: 'embedded_original', source: 'synthetic_fixture' };
        });
        const displayImages = media.map(original => {
          const display = displayMedia({ id: original.id, body: Buffer.from(original.original_base64, 'base64'), contentType: original.content_type });
          return { id: original.id, content_type: display.contentType, source_content_sha256: display.source_sha256, content_sha256: display.display_sha256, byte_length: display.body.length, display_base64: display.body.toString('base64'), method: display.method, width: display.width, height: display.height };
        });
        const placementHistory = db.prepare('SELECT capture_id, event_json FROM placement_events WHERE project_id = ? ORDER BY id ASC').all(projectId).map(row => ({ capture_id: row.capture_id, ...JSON.parse(row.event_json as string) }));
        const snapshot = {
          project: clone(fixtureProject), scope: clone(fixtureScope), model: clone(fixtureModel), plan: clone(fixturePlan), captures,
          current_assessments: current, assessment_history: history, media, display_media: displayImages, placement_history: placementHistory,
          issue_operations: [], issue_creation: 'disabled',
          metric_definitions: { scope_denominator: fixtureScope.element_ids.length, scope_unit: 'explicitly selected model elements', current_assessments: 'Latest reviewer revision for each capture and scope; each date remains separate.', history_revisions: 'All preserved immutable reviewer revisions, including superseded revisions.', progress_percentage: 'Not calculated; observations do not measure contractual completion.' },
        };
        const id = `packet-${randomUUID()}`; const createdAt = now();
        const manifest = { schema_version: '0.1.0', product: 'Forma ReCap', id, data_mode: mode, created_at: createdAt, generated_by: fixtureReviewer.id, source_snapshot_cutoff: createdAt, selected_revision_ids: current.map(record => record.review.revision_id), current_revision_count: current.length, history_revision_count: history.length, snapshot_sha256: sha256(canonicalJson(snapshot)), hash_basis: 'SHA-256 of canonical JSON snapshot; packet identifier and generated-at metadata are volatile and excluded.', snapshot, limitations: ['Synthetic fixture only; not actual site evidence.', 'Manual plan pins are not verified 3D registration.', 'No inspection acceptance, quantity, contractual completion, or payment approval is inferred.', 'Issue creation and live external writes are disabled.'] };
        const html = buildReport(manifest);
        const summary = { id, created_at: createdAt, revision_count: history.length, html_url: `/api/exports/${id}/report`, manifest_url: `/api/exports/${id}/manifest` };
        db.prepare('INSERT INTO exports VALUES (?, ?, ?, ?, ?)').run(id, projectId, JSON.stringify(manifest), html, JSON.stringify(summary));
        return summary;
      });
    },
    getExport(id: string) {
      assertFixture(); text(id, 'Export ID', 200);
      const row = db.prepare('SELECT * FROM exports WHERE id = ? AND project_id = ?').get(id, projectId);
      if (!row) fail(404, 'Resource unavailable.');
      return { manifest: JSON.parse(row.manifest_json as string), html: row.report_html as string, summary: JSON.parse(row.summary_json as string) };
    },
    close() { db.close(); },
  };
}
