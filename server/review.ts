import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { canonicalJson, DomainError } from './domain.ts';
import { displayMedia } from './media-render.ts';

type RecordValue = Record<string, any>;
type Options = { dbPath: string; uploadDir: string; workspace: 'fixture' | 'local'; legacyStore?: any; syntheticImportPath?: string };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const now = () => new Date().toISOString();
function fail(status: number, message: string): never { throw new DomainError(status, message); }
function object(value: unknown, fields: string[], required = fields): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  const record = value as RecordValue;
  if (Object.keys(record).some(key => !fields.includes(key))) fail(400, 'Unsupported request fields.');
  for (const key of required) if (!Object.hasOwn(record, key)) fail(400, `Missing required field: ${key}.`);
  return record;
}
function text(value: unknown, label: string, max = 6000): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must be a nonempty string of at most ${max} characters.`);
}
function optionalText(value: unknown, label: string, max = 6000) {
  if (value !== null && value !== undefined && value !== '') text(value, label, max);
}
function date(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a calendar date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} must be a valid calendar date.`);
}
function timestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, `${label} must include a valid timezone offset.`);
  date(value.slice(0, 10), label);
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  const offset = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (hour > 23 || minute > 59 || second > 59 || (offset && (Number(offset[2]) > 23 || Number(offset[3]) > 59))) fail(400, `${label} has an invalid time or offset.`);
}
function choice(value: unknown, values: string[], label: string) {
  if (typeof value !== 'string' || !values.includes(value)) fail(400, `Unsupported ${label}.`);
}
const escape = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const stateLabel = (value: string) => ({ observed_installed: 'Observed installed', not_observed: 'Not observed in reviewed evidence', needs_review: 'Needs review' })[value] ?? value;

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS review_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS review_configuration (id INTEGER PRIMARY KEY CHECK(id=1), record_json TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS review_captures (id TEXT PRIMARY KEY, record_json TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS review_media (id TEXT PRIMARY KEY REFERENCES review_captures(id), filename TEXT NOT NULL, content_type TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS review_findings (
 revision_id TEXT PRIMARY KEY, finding_id TEXT NOT NULL, capture_id TEXT NOT NULL,
 element_id TEXT NOT NULL, scope_id TEXT NOT NULL, scope_revision INTEGER NOT NULL,
 model_version_id TEXT NOT NULL, revision INTEGER NOT NULL, previous_revision_id TEXT REFERENCES review_findings(revision_id),
 record_json TEXT NOT NULL, UNIQUE(finding_id,revision), UNIQUE(capture_id,element_id,scope_id,scope_revision,model_version_id,revision)
) STRICT;
CREATE TABLE IF NOT EXISTS review_task_events (id INTEGER PRIMARY KEY, task_id TEXT NOT NULL, event_json TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS review_exports (id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL, report_html TEXT NOT NULL, summary_json TEXT NOT NULL) STRICT;
`;

function report(manifest: RecordValue) {
  const snapshot = manifest.snapshot;
  const image = (id: string, annotations: RecordValue[], alt: string, elementId = '') => {
    const display = snapshot.display_media?.find((item: RecordValue) => item.id === id);
    const original = snapshot.media.find((item: RecordValue) => item.id === id);
    if (!display && !original) return '<p>Evidence media is unavailable in this fixed snapshot.</p>';
    const boxes = annotations.map((box: RecordValue) => `<div class="annotation" style="left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%"><span>${escape(elementId ? `${elementId}: ` : '')}${escape(box.label)}</span></div>`).join('');
    return `<div class="image"><img src="data:${escape(display?.content_type ?? original.content_type)};base64,${display?.display_base64 ?? original.original_base64}" alt="${escape(alt)}">${boxes}</div>`;
  };
  const findingRows = snapshot.findings.map((finding: RecordValue) => `<tr><td>${escape(finding.model_ref.element_id)}</td><td>${escape(finding.capture_ref.capture_id)}<br>${escape(finding.capture_ref.captured_at ?? finding.capture_ref.captured_date ?? 'Unknown capture date')} (${escape(finding.capture_ref.date_precision)})</td><td>${escape(stateLabel(finding.state))}<br>Evidence ${escape(finding.evidence_quality)}</td><td>${escape(finding.rationale)}<br>${escape(finding.uncertainty_reason)}</td><td>${escape(finding.review.reviewer_id)}<br>${escape(finding.review.reviewed_at)}<br>Revision ${finding.revision}</td></tr>`).join('');
  const media = snapshot.media.map((item: RecordValue) => {
    const capture = snapshot.captures.find((entry: RecordValue) => entry.capture_id === item.id);
    const findings = snapshot.findings.filter((entry: RecordValue) => entry.capture_ref.capture_id === item.id);
    const annotations = findings.flatMap((finding: RecordValue) => finding.annotations.map((box: RecordValue) => ({ ...box, label: `${finding.model_ref.element_id}: ${box.label}` })));
    const display = snapshot.display_media?.find((entry: RecordValue) => entry.id === item.id);
    return `<figure><h3>${escape(capture?.title ?? 'Reference plan')}</h3>${image(item.id, annotations, capture?.title ?? item.id)}<figcaption>${escape(item.id)} · Original SHA-256 ${escape(item.content_sha256)}<br>Display ${escape(display?.method ?? 'original_media')} · SHA-256 ${escape(display?.content_sha256 ?? item.content_sha256)}<br>Capture ${escape(capture?.capture_ref.captured_at ?? capture?.capture_ref.captured_date ?? 'Unknown')} (${escape(capture?.capture_ref.date_precision ?? 'reference plan')}) · uploaded ${escape(capture?.capture_ref.uploaded_at ?? 'not applicable')}<br>Source ${escape(capture?.source ?? capture?.source_context ?? 'Synthetic reference plan')}. Annotation overlays are separate from unchanged original bytes. Display derivatives are embedded separately with their original-source hash.</figcaption></figure>`;
  }).join('');
  const tasks = snapshot.tasks.map((task: RecordValue) => `<tr><td>${escape(task.element_id)}<br>Capture request: ${escape(task.capture_status ?? (task.new_capture_id ? 'completed' : 'requested'))}<br>Review: ${escape(task.review_status ?? (task.resolution_revision_id ? 'reassessed' : task.new_capture_id ? 'awaiting_reassessment' : 'pending_evidence'))}</td><td>${escape(task.reason)}<br>Required: ${escape(task.required_viewpoint)}</td><td>${escape(task.assignee)}<br>Due ${escape(task.due_date)}${task.before_concealment ? `<br>Before concealment ${escape(task.concealment_date ?? '(date unknown)')}` : ''}</td><td>Origin finding ${escape(task.finding_revision_id)}<br>Origin capture ${escape(task.source_capture_id)}<br>Model ${escape(task.model_ref.model_id)} / ${escape(task.model_ref.version_id)}<br>New capture ${escape(task.new_capture_id ?? 'none')}<br>Evidence supplied ${escape(task.evidence_supplied_at ?? task.evidence_linked_at ?? 'pending')}<br>Reassessment ${escape(task.latest_assessment_revision_id ?? task.resolution_revision_id ?? 'pending')}</td></tr>`).join('');
  const revisionHistory = snapshot.finding_revisions.map((finding: RecordValue) => {
    const link = finding.recapture_task_ref;
    return `<article class="finding-revision"><h3>${escape(finding.model_ref.element_id)} · revision ${finding.revision} · ${escape(stateLabel(finding.state))}</h3><p>${escape(finding.rationale)}<br>Uncertainty: ${escape(finding.uncertainty_reason ?? 'None recorded')} · Evidence quality: ${escape(finding.evidence_quality)}</p><p>Finding ${escape(finding.finding_id)}<br>Revision ${escape(finding.revision_id)}<br>Previous revision ${escape(finding.previous_revision_id ?? 'none')}<br>Model ${escape(finding.model_ref.model_id)} / ${escape(finding.model_ref.version_id)} · Scope ${escape(finding.scope_ref.scope_id)} revision ${finding.scope_ref.revision}<br>Capture ${escape(finding.capture_ref.capture_id)} · ${escape(finding.capture_ref.captured_at ?? finding.capture_ref.captured_date ?? 'Unknown capture date')} (${escape(finding.capture_ref.date_precision)}) · uploaded ${escape(finding.capture_ref.uploaded_at)}<br>Reviewer ${escape(finding.review.reviewer_id)} (${escape(finding.review.identity_basis)}) · assessed ${escape(finding.review.reviewed_at)}</p>${link ? `<p>Explicit reassessment for task ${escape(link.task_id)}<br>Origin finding revision ${escape(link.originating_finding_revision_id)}<br>Origin capture ${escape(link.source_capture_ref.capture_id)} · model ${escape(link.source_model_ref.model_id)} / ${escape(link.source_model_ref.version_id)}. Original finding and evidence references remain unchanged.</p>` : ''}${finding.annotations.length ? image(finding.capture_ref.capture_id, finding.annotations, `Finding revision ${finding.revision}: ${finding.model_ref.element_id}`, finding.model_ref.element_id) : '<p>No region annotation saved for this revision.</p>'}<p>Annotation IDs: ${escape(finding.annotations.map((annotation: RecordValue) => annotation.id).join(', ') || 'none')}. Original media remains separate from annotation data.</p></article>`;
  }).join('');
  const taskHistory = snapshot.task_events.map((event: RecordValue) => `<tr><td>${escape(event.task_id)}<br>${escape(event.type)}</td><td>${escape(event.at)}<br>${escape(event.reviewer_id)}</td><td>Origin ${escape(event.task.finding_revision_id)}<br>New capture ${escape(event.task.new_capture_id ?? 'none')}<br>Assessment ${escape(event.task.latest_assessment_revision_id ?? event.task.resolution_revision_id ?? 'pending')}</td><td>Capture request: ${escape(event.task.capture_status ?? (event.task.new_capture_id ? 'completed' : 'requested'))}<br>Review: ${escape(event.task.review_status ?? (event.task.resolution_revision_id ? 'reassessed' : event.task.new_capture_id ? 'awaiting_reassessment' : 'pending_evidence'))}</td></tr>`).join('');
  const scopeHistory = snapshot.legacy_assessment_history.map((assessment: RecordValue) => `<tr><td>Historical scope assessment<br>${escape(assessment.assessment_id)}<br>Revision ${escape(assessment.review?.revision)}<br>${escape(assessment.review?.revision_id)}</td><td>${escape(assessment.capture_ref?.capture_id)}<br>${escape(assessment.model_ref?.version_id)}<br>Scope ${escape(assessment.scope_ref?.scope_id)}</td><td>${escape(stateLabel(assessment.state))}<br>${escape(assessment.rationale)}<br>${escape(assessment.uncertainty_reason)}</td><td>${escape(assessment.review?.reviewer_id)}<br>${escape(assessment.review?.reviewed_at)}</td></tr>`).join('');
  const coverageRows = snapshot.coverage.elements.map((element: RecordValue) => `<tr><td>${escape(element.element_id)}<br>${escape(element.label)}</td><td>${escape(element.status.replaceAll('_', ' '))}</td><td>${escape(element.finding?.revision_id ?? 'Unassessed')}<br>${escape(element.finding?.capture_ref.capture_id ?? 'No individual evidence')}<br>${escape(element.capture_date ?? 'Unknown')}</td><td>${escape(element.reason)}</td></tr>`).join('');
  const workflows = snapshot.workflows ?? {};
  const reconciliations = (workflows.reconciliations ?? []).map((entry: RecordValue) => `<tr><td>${escape(entry.category)}</td><td>${escape(entry.quantity === null ? 'Unknown' : entry.quantity)} ${escape(entry.unit)}</td><td>${escape(entry.period_start)} to ${escape(entry.period_end)}<br>${escape(entry.element_ids?.join(', '))}</td><td>Source: ${escape(entry.source)}<br>Basis: ${escape(entry.basis)}<br>Method: ${escape(entry.measurement_method)}<br>${escape(entry.record_reference ?? entry.approval_reference)}</td></tr>`).join('');
  const reconciliation = workflows.reconciliation_summary ?? {};
  const quantity = (value: unknown, unit: unknown = '') => `${escape(value === null || value === undefined ? 'Unknown' : value)}${unit ? ` ${escape(unit)}` : ''}`;
  const comparisonRows = (reconciliation.comparisons ?? []).map((comparison: RecordValue) => `<tr><td>${escape(comparison.element_ids?.join(', '))}<br>${escape(comparison.period_start)} to ${escape(comparison.period_end)}</td><td>${quantity(comparison.quantity_reported, comparison.unit)}</td><td>${quantity(comparison.quantity_supported, comparison.unit)}</td><td>${quantity(comparison.delta, comparison.unit)}</td><td>${comparison.comparable ? 'Comparable manual records' : 'Not comparable'}<br>${escape(comparison.reason)}</td></tr>`).join('');
  const observations = reconciliation.observations ?? {};
  const observationRows = (observations.elements ?? []).map((element: RecordValue) => `<tr><td>${escape(element.element_id)}<br>${escape(element.label)}</td><td>${element.state ? escape(stateLabel(element.state)) : escape(String(element.status ?? 'Unknown').replaceAll('_', ' '))}${element.evidence_quality ? `<br>Evidence ${escape(element.evidence_quality)}` : ''}</td><td>${escape(element.capture_date ?? 'Unknown')}<br>${escape(element.capture_id ?? '')}</td><td>${escape(element.reason)}</td></tr>`).join('');
  const percentageRows = (reconciliation.percentages ?? []).map((percentage: RecordValue) => {
    const entry = (workflows.reconciliations ?? []).find((record: RecordValue) => record.entry_id === percentage.entry_id);
    const label = entry ? `${String(entry.category).replaceAll('_', ' ')} · ${entry.source}` : percentage.entry_id;
    const value = typeof percentage.value === 'number' && Number.isFinite(percentage.value) ? `${Math.round(percentage.value * 100) / 100}%` : 'Unknown';
    return `<tr><td>${escape(label)}<br>${escape(entry?.element_ids?.join(', '))}</td><td>${quantity(entry?.quantity, entry?.unit ?? percentage.unit)}</td><td>${percentage.denominator ? quantity(percentage.denominator.quantity, percentage.denominator.unit) : 'Not provided'}</td><td>${escape(value)}</td><td>${escape(percentage.reason)}${percentage.denominator?.basis ? `<br>Denominator basis: ${escape(percentage.denominator.basis)}` : ''}</td></tr>`;
  }).join('');
  const period = reconciliation.reporting_period;
  const reconciliationTables = `<p><strong>Reporting period:</strong> ${period ? `${escape(period.period_start)} to ${escape(period.period_end)}` : 'All recorded periods. Each quantity comparison retains its own reporting period.'}</p><h3>Reported versus imagery-supported quantities</h3><table><thead><tr><th>Scope / period</th><th>Trade reported</th><th>Imagery supported</th><th>Reported minus supported</th><th>Comparison basis</th></tr></thead><tbody>${comparisonRows || '<tr><td colspan="5">No quantity comparisons available.</td></tr>'}</tbody></table><h3>Reviewed element observations</h3><p>${quantity(observations.total_elements)} selected elements · ${quantity(observations.observed_installed)} observed installed · ${quantity(observations.not_observed)} not observed · ${quantity(observations.needs_review)} needs review · ${quantity(observations.no_finding)} without an individual finding · ${quantity(observations.date_unknown)} with unknown capture dates · ${quantity(observations.conflicting_observations)} with conflicting observations. Each element appears once across capture dates. These are observation counts, separate from evidence coverage, installed quantities, and percent complete.</p><table><thead><tr><th>Element</th><th>Reviewed observation</th><th>Evidence date / capture</th><th>Review basis</th></tr></thead><tbody>${observationRows || '<tr><td colspan="4">No individual observations available for reconciliation.</td></tr>'}</tbody></table><h3>Completion calculation basis</h3><p>Percentages require an explicit positive denominator and a supported manual quantity method with matching unit and exact scope. Unknown or incomparable values remain unknown. Visibility alone does not establish inspection acceptance, contractual completion, or payment approval.</p><table><thead><tr><th>Manual record / scope</th><th>Recorded quantity</th><th>Explicit denominator</th><th>Completion</th><th>Basis / limitation</th></tr></thead><tbody>${percentageRows || '<tr><td colspan="5">No completion calculations available.</td></tr>'}</tbody></table>`;
  const drafts = (workflows.drafts ?? []).map((draft: RecordValue) => {
    // A draft selects exact historical finding revisions and annotation subsets. Its evidence preview
    // must not borrow overlays from today's corrected finding on the same original photograph.
    const selectedEvidence = (draft.evidence ?? []).map((evidence: RecordValue) => {
      const finding = evidence.finding;
      const capture = evidence.capture;
      return `<figure class="draft-evidence"><h4>${escape(capture.title)}</h4>${image(capture.capture_id, evidence.annotations ?? [], `${capture.title} · selected draft evidence`, finding.model_ref.element_id)}<figcaption>Exact finding revision ${escape(evidence.finding_revision_id)}<br>Model ${escape(finding.model_ref.model_id)} / ${escape(finding.model_ref.version_id)} · element ${escape(finding.model_ref.element_id)}<br>Capture ${escape(capture.capture_id)} · ${escape(capture.capture_ref.captured_at ?? capture.capture_ref.captured_date ?? 'Unknown capture date')} (${escape(capture.capture_ref.date_precision)}) · uploaded ${escape(capture.capture_ref.uploaded_at)}<br>Source ${escape(capture.source ?? capture.source_context ?? 'Not recorded')}<br>SHA-256 ${escape(finding.capture_ref.content_sha256)}<br>Selected annotations: ${escape((evidence.annotations ?? []).map((box: RecordValue) => box.id).join(', ') || 'none')}. These overlays retain this draft’s selected historical finding revision.</figcaption></figure>`;
    }).join('');
    return `<article class="local-draft"><h3>${escape(draft.type?.toUpperCase())}: ${escape(draft.title)}</h3><p>${escape(draft.description)}</p><p>Location ${escape(draft.location)} · Requested action ${escape(draft.requested_action)} · Proposed assignee ${escape(draft.proposed_assignee ?? 'unassigned')}</p><p>Finding revisions ${escape(draft.finding_revision_ids?.join(', '))}</p>${selectedEvidence || '<p>No selected evidence.</p>'}<p>Local editable draft only. External submission disabled; no external record created.</p></article>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>Forma ReCap · ${escape(manifest.workspace_label)} evidence packet</title><style>body{font:14px/1.5 Arial,sans-serif;color:#26313a;max-width:1180px;margin:32px auto;padding:0 24px}header,article,figure,details{border:1px solid #ccd3da;padding:20px;margin:20px 0}h1{font-size:30px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccd3da;padding:10px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f0f3f6}.notice{border-left:4px solid #c46a21;background:#fff3e7;padding:12px}.image{position:relative;display:inline-block;max-width:100%;line-height:0}.image img{max-width:100%;height:auto;display:block;image-orientation:from-image}.annotation{position:absolute;box-sizing:border-box;border:2px solid #0873cf;background:#0873cf12;line-height:1.2}.annotation span{background:white;color:#123d62;font-size:11px}figcaption,pre{font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap}@media print{figure,article{break-inside:avoid}body{margin:0}}</style></head><body><header><p>FORMA RECAP · ${escape(manifest.workspace_label.toUpperCase())}</p><h1>Element evidence and reconciliation packet</h1><p>${escape(snapshot.project?.name)} · ${escape(snapshot.scope?.floor)} · ${escape(snapshot.scope?.trade)} · ${escape(snapshot.scope?.name)}</p><p>Model ${escape(snapshot.model?.id)} / ${escape(snapshot.model?.version_id)}</p><p>Generated ${escape(manifest.created_at)} · ${escape(manifest.generated_by)}<br>Packet ${escape(manifest.id)} · snapshot SHA-256 ${escape(manifest.snapshot_sha256)}</p></header><p class="notice">${manifest.workspace === 'fixture' ? 'Synthetic demonstration evidence only.' : 'User-imported photographs with manual, unverified BIM references; no APS model access established.'} Human observations do not establish inspection acceptance, measured installation quantities, contractual completion, or payment approval. “Not observed” does not mean absent, incomplete, or zero. Manual location associations are not verified 3D registration.</p><h2>Individual element findings</h2><table><thead><tr><th>Element</th><th>Evidence date</th><th>Observation</th><th>Rationale and uncertainty</th><th>Review</th></tr></thead><tbody>${findingRows || '<tr><td colspan="5">No individual findings. Historical scope assessments are retained separately.</td></tr>'}</tbody></table><h2>Coverage</h2><p>Unique selected elements: ${snapshot.coverage.total_elements}. ${escape(JSON.stringify(snapshot.coverage.counts))}. Freshness ${snapshot.coverage.freshness_days} days as of ${escape(snapshot.coverage.as_of_date)}. This is evidence coverage, not percent installed or complete. Evidence older than the configured number of calendar days is outdated; unknown dates cannot establish freshness. Unassessed elements remain explicitly without individual findings.</p><table><thead><tr><th>Element</th><th>Coverage state</th><th>Finding / capture / date</th><th>Basis</th></tr></thead><tbody>${coverageRows}</tbody></table><h2>Recapture tasks</h2><table><thead><tr><th>Element / status</th><th>Uncertainty / viewpoint</th><th>Responsibility</th><th>Preserved references</th></tr></thead><tbody>${tasks || '<tr><td colspan="4">No recapture tasks.</td></tr>'}</tbody></table><h2>Progress reconciliation</h2><p>Manual reported information, imagery-supported quantities, unresolved scope, inspection decisions and recorded approvals remain separate. Unknown quantities remain unknown; comparable differences require matching units, scope, period and basis.</p><table><thead><tr><th>Category</th><th>Quantity</th><th>Scope / period</th><th>Source and basis</th></tr></thead><tbody>${reconciliations || '<tr><td colspan="4">No manual reconciliation entries.</td></tr>'}</tbody></table>${reconciliationTables}<h2>Local Issue and RFI drafts</h2>${drafts || '<p>No local drafts.</p>'}<h2>Original evidence with separate annotations</h2>${media}<h2>Individual finding revision history</h2>${revisionHistory || '<p>No individual finding revisions.</p>'}<h2>Recapture decision history</h2><p>Completing a capture request records evidence supplied. It does not assign an installation state, inspection acceptance, quantity approval or payment decision.</p><table><thead><tr><th>Task / event</th><th>When / reviewer</th><th>Preserved links</th><th>Capture and review status</th></tr></thead><tbody>${taskHistory || '<tr><td colspan="4">No task events.</td></tr>'}</tbody></table><h2>Historical scope assessments</h2><p>Preserved scope-level records are separate from individual element findings. Their states do not establish findings for every associated element.</p><table><thead><tr><th>Record / revision</th><th>Capture / model / scope</th><th>Historical assessment</th><th>Reviewer / time</th></tr></thead><tbody>${scopeHistory || '<tr><td colspan="4">No historical scope records.</td></tr>'}</tbody></table><h2>Revision and placement history</h2><p>${snapshot.finding_revisions.length} immutable element finding revisions; ${snapshot.task_events.length} task events; ${snapshot.legacy_assessment_history.length} historical scope assessment revisions. Historical scope records are not converted into per-element findings.</p><details><summary>Fixed machine-readable snapshot, all histories, and original source bytes</summary><pre>${escape(JSON.stringify(manifest, null, 2))}</pre></details></body></html>`;
}

export function createReviewStore({ dbPath, uploadDir, workspace, legacyStore, syntheticImportPath }: Options) {
  if (!['fixture', 'local'].includes(workspace)) fail(400, 'Unsupported review workspace.');
  if (workspace === 'fixture' && !legacyStore) fail(500, 'Synthetic review requires its existing evidence store.');
  if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true, mode: 0o700 });
  mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec('PRAGMA busy_timeout=5000;'); db.exec(schema);
  const persistedWorkspace = db.prepare('SELECT value FROM review_metadata WHERE key=?').get('workspace');
  if (persistedWorkspace && persistedWorkspace.value !== workspace) { db.close(); fail(409, 'Review database belongs to a different workspace.'); }
  db.prepare('INSERT OR IGNORE INTO review_metadata VALUES (?,?)').run('workspace', workspace);
  for (const table of ['review_captures', 'review_media', 'review_findings', 'review_task_events', 'review_exports']) {
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Review evidence and history are immutable'); END;`);
  }
  const reviewer = workspace === 'fixture' ? { id: 'fixture-reviewer', name: 'Local fixture reviewer', identity_basis: 'synthetic_demo' } : { id: 'local-reviewer', name: 'Local photograph reviewer', identity_basis: 'self_asserted_local_identity' };
  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const rows = (table: string, column = 'record_json') => db.prepare(`SELECT ${column} FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row[column] as string)) as RecordValue[];
  const currentFindings = () => [...new Map(rows('review_findings').map(record => [record.finding_id, record])).values()];
  const taskEvents = () => rows('review_task_events', 'event_json');
  const tasks = () => [...new Map(taskEvents().map(event => [event.task_id, event.task])).values()];
  const configuration = (): RecordValue => {
    if (workspace === 'fixture') { const state = legacyStore.bootstrap(); return { project: state.project, model: state.model, scope: state.scope }; }
    const row = db.prepare('SELECT record_json FROM review_configuration WHERE id=1').get();
    return row ? JSON.parse(row.record_json as string) : { project: null, model: null, scope: null };
  };
  const configured = (requireModel = true) => { const state = configuration(); if (!state.project || !state.scope || (requireModel && !state.model)) fail(409, requireModel ? 'Configure the local project, floor, trade and exact model references first.' : 'Configure the local project and review package first.'); return state; };
  const captures = (): RecordValue[] => [
    ...(workspace === 'fixture' ? legacyStore.bootstrap().captures : []),
    ...rows('review_captures'),
  ].map(capture => ({ ...capture, media_url: `/api/v2/${workspace}/media/${capture.capture_id}`, display_url: `/api/v2/${workspace}/media/${capture.capture_id}/display`, media_status: mediaStatus(capture.capture_id) }));
  function getCapture(id: string): RecordValue {
    text(id, 'Capture ID', 200);
    const capture = captures().find(item => item.capture_id === id);
    if (!capture) fail(404, 'Capture is unavailable in this workspace.');
    return copy(capture);
  }
  function getMedia(id: string) {
    text(id, 'Media ID', 200);
    const row = db.prepare('SELECT * FROM review_media WHERE id=?').get(id);
    if (!row) {
      if (workspace === 'fixture') return legacyStore.getMedia(id) as { body: Buffer; contentType: string };
      fail(404, 'Media is unavailable in this workspace.');
    }
    const path = resolve(uploadDir, row.filename as string);
    if (dirname(path) !== resolve(uploadDir)) fail(404, 'Media is unavailable.');
    try {
      if (!statSync(path).isFile() || statSync(path).size !== row.bytes) fail(409, 'Original photo is unavailable or changed. Historical references and packets remain preserved.');
      const body = readFileSync(path);
      if (hash(body) !== row.sha256) fail(409, 'Original photo has changed. Historical references and packets remain preserved.');
      return { body, contentType: row.content_type as string };
    } catch (error) { if (error instanceof DomainError) throw error; fail(409, 'Original photo is unavailable. Historical references and packets remain preserved.'); }
  }
  function getDisplayMedia(id: string) {
    const original = getMedia(id);
    return displayMedia({ id, ...original });
  }
  function mediaStatus(id: string) { try { getMedia(id); return 'verified'; } catch { return 'unavailable_or_changed'; } }
  function getFindingRevision(id: string): RecordValue {
    text(id, 'Finding revision ID', 200);
    const row = db.prepare('SELECT record_json FROM review_findings WHERE revision_id=?').get(id);
    if (!row) fail(404, 'Finding revision is unavailable in this workspace.');
    return JSON.parse(row.record_json as string);
  }
  function findingHistory(id: string): RecordValue[] {
    text(id, 'Finding ID', 200);
    const row = db.prepare('SELECT finding_id FROM review_findings WHERE finding_id=? OR revision_id=? LIMIT 1').get(id, id);
    if (!row) fail(404, 'Finding is unavailable in this workspace.');
    return db.prepare('SELECT record_json FROM review_findings WHERE finding_id=? ORDER BY revision').all(row.finding_id).map(item => JSON.parse(item.record_json as string));
  }
  function taskById(id: string): RecordValue {
    text(id, 'Task ID', 200); const result = tasks().find(task => task.task_id === id);
    if (!result) fail(404, 'Recapture task is unavailable in this workspace.'); return result;
  }
  function addTaskEvent(task: RecordValue, type: string, details: RecordValue = {}) {
    const event = { event_id: `task-event-${randomUUID()}`, task_id: task.task_id, type, at: now(), reviewer_id: reviewer.id, ...details, task: copy(task) };
    db.prepare('INSERT INTO review_task_events(task_id,event_json) VALUES (?,?)').run(task.task_id, JSON.stringify(event)); return task;
  }
  function coverage(input: RecordValue = {}) {
    object(input, ['as_of_date', 'freshness_days'], []);
    const asOf = input.as_of_date ?? now().slice(0, 10); date(asOf, 'Coverage date');
    const freshness = input.freshness_days ?? 14;
    if (!Number.isSafeInteger(freshness) || freshness < 1 || freshness > 3650) fail(400, 'Freshness must be an integer from 1 to 3650 days.');
    const config = configuration();
    const counts: RecordValue = { usable: 0, unresolved: 0, outdated: 0, no_evidence: 0, date_unknown: 0 };
    const current = currentFindings();
    const elements = (config.model?.elements ?? []).filter((element: RecordValue) => config.scope.element_ids.includes(element.external_id)).map((element: RecordValue) => {
      const all = current.filter(finding => finding.model_ref.element_id === element.external_id && finding.model_ref.version_id === config.model.version_id && (!finding.capture_ref.captured_date || finding.capture_ref.captured_date <= asOf));
      const unknown = all.filter(finding => finding.capture_ref.date_precision === 'unknown');
      const dated = all.filter(finding => finding.capture_ref.captured_date).sort((a, b) => b.capture_ref.captured_date.localeCompare(a.capture_ref.captured_date) || b.review.reviewed_at.localeCompare(a.review.reviewed_at));
      const selected = unknown.length ? unknown.sort((a, b) => b.review.reviewed_at.localeCompare(a.review.reviewed_at))[0] : dated[0];
      let status = 'no_evidence'; let reason = 'No individual element finding; historical scope reviews do not establish element coverage.';
      if (selected) {
        if (unknown.length) { status = 'date_unknown'; reason = 'Capture date is unknown; freshness and chronological precedence cannot be established.'; }
        else if (selected.state === 'needs_review' || selected.evidence_quality !== 'usable') { status = 'unresolved'; reason = selected.uncertainty_reason || 'Reviewer marked evidence limited or unusable.'; }
        else if ((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${selected.capture_ref.captured_date}T00:00:00Z`)) / 86400000 > freshness) { status = 'outdated'; reason = 'Latest usable reviewed evidence exceeds the configured freshness rule.'; }
        else { status = 'usable'; reason = 'Reviewer marked dated evidence usable; this is evidence coverage, not installation quantity.'; }
        if (!unknown.length && dated.some(other => other.capture_ref.captured_date === selected.capture_ref.captured_date && other.state !== selected.state)) { status = 'unresolved'; reason = 'Different observations on the same date require reviewer reconciliation.'; }
      }
      counts[status]++;
      return { element_id: element.external_id, label: element.label, status, finding: selected ?? null, capture_date: selected?.capture_ref.captured_date ?? null, reason };
    });
    return { as_of_date: asOf, freshness_days: freshness, total_elements: elements.length, counts, elements };
  }
  function bootstrap() {
    const config = configuration();
    return { schema_version: '0.2.0', workspace, data_mode: workspace, ...copy(config), captures: captures(), findings: currentFindings(), finding_revisions: rows('review_findings'), tasks: tasks(), task_events: taskEvents(), exports: rows('review_exports', 'summary_json').reverse(), legacy_assessments: workspace === 'fixture' ? legacyStore.bootstrap().assessments : [], reviewer: copy(reviewer), freshness_days: 14 };
  }
  return {
    db, bootstrap, getCapture, getMedia, getDisplayMedia, getFindingRevision, findingHistory, coverage,
    configure(body: unknown) {
      if (workspace !== 'local') fail(409, 'Synthetic project configuration is fixed.');
      const input = object(body, ['project_name', 'location', 'trade', 'scope_name', 'model_id', 'model_version', 'elements', 'review_mode'], ['project_name', 'location', 'trade', 'scope_name']);
      const scopeOnly = input.review_mode === 'scope_only';
      if (input.review_mode !== undefined && !['scope_only','model_backed'].includes(input.review_mode)) fail(400, 'Choose scope_only or model_backed review.');
      for (const key of ['project_name', 'location', 'trade', 'scope_name', ...(!scopeOnly ? ['model_id', 'model_version'] : [])]) text(input[key], key, 300);
      if (scopeOnly && (input.model_id || input.model_version || (Array.isArray(input.elements) && input.elements.length))) fail(400, 'A scope-only package must not invent model references.');
      if (!scopeOnly && (!Array.isArray(input.elements) || input.elements.length < 1 || input.elements.length > 1000)) fail(400, 'Configure between 1 and 1000 explicit model elements.');
      const seen = new Set<string>();
      const elements = (scopeOnly ? [] : input.elements).map((value: unknown) => { const element = object(value, ['external_id', 'label']); text(element.external_id, 'Element ID', 200); text(element.label, 'Element label', 300); if (seen.has(element.external_id.trim())) fail(400, 'Duplicate element IDs are not allowed.'); seen.add(element.external_id.trim()); return { external_id: element.external_id.trim(), label: element.label.trim(), zone_id: 'local-location' }; });
      return transaction(() => {
        const hasWorkflowRecords = ['reconciliation_revisions', 'local_draft_revisions', 'scope_item_revisions', 'scope_finding_revisions', 'scope_mapping_revisions', 'scope_conflict_revisions', 'field_operation_revisions', 'field_import_events', 'research_records', 'commercial_revisions'].some(table => db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?').get(table) && db.prepare(`SELECT rowid FROM ${table} LIMIT 1`).get());
        if (hasWorkflowRecords || db.prepare('SELECT id FROM review_captures LIMIT 1').get() || db.prepare('SELECT revision_id FROM review_findings LIMIT 1').get()) fail(409, 'Project and model references are locked after evidence import or workflow records. Historical evidence must never move silently to another model version.');
        const config = { project: { id: 'local-project', name: input.project_name.trim(), mode: 'local', source: 'manual_configuration' }, model: scopeOnly ? null : { id: input.model_id.trim(), version_id: input.model_version.trim(), version_label: input.model_version.trim(), elements, association_method: 'manual_unverified_reference', viewer_available: false }, scope: { scope_id: 'local-scope', revision: 1, trade: input.trade.trim(), floor: input.location.trim(), name: input.scope_name.trim(), zone_id: 'local-location', element_ids: elements.map((element: RecordValue) => element.external_id), model_version_id: scopeOnly ? null : input.model_version.trim(), mapping_method: scopeOnly ? 'reviewer_defined_scope' : 'explicit_manual_element_selection', validation: 'unverified' } };
        db.prepare('INSERT INTO review_configuration VALUES (1,?) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json').run(JSON.stringify(config)); return copy(config);
      });
    },
    saveFinding(body: unknown) {
      const input = object(body, ['capture_id', 'element_id', 'state', 'rationale', 'uncertainty_reason', 'evidence_quality', 'annotations', 'previous_revision_id', 'resolves_task_id', 'recapture_task_id'], ['capture_id', 'element_id', 'state', 'rationale', 'uncertainty_reason', 'evidence_quality', 'annotations', 'previous_revision_id']);
      text(input.capture_id, 'Capture ID', 200); text(input.element_id, 'Element ID', 200); text(input.rationale, 'Rationale');
      choice(input.state, ['observed_installed', 'not_observed', 'needs_review'], 'observation state'); choice(input.evidence_quality, ['usable', 'limited', 'unusable'], 'evidence quality');
      optionalText(input.uncertainty_reason, 'Uncertainty'); if (input.state !== 'observed_installed') text(input.uncertainty_reason, 'Uncertainty');
      optionalText(input.previous_revision_id, 'Previous revision', 200); optionalText(input.resolves_task_id, 'Recapture task', 200); optionalText(input.recapture_task_id, 'Recapture task', 200);
      if (input.resolves_task_id && input.recapture_task_id && input.resolves_task_id !== input.recapture_task_id) fail(400, 'A reassessment must refer to one recapture task.');
      if (!Array.isArray(input.annotations) || input.annotations.length > 50) fail(400, 'Annotations must be an array of at most 50 rectangles.');
      const annotationIds = new Set<string>();
      const annotations = input.annotations.map((value: unknown) => {
        const annotation = object(value, ['id', 'x', 'y', 'width', 'height', 'label'], ['x', 'y', 'width', 'height', 'label']); text(annotation.label, 'Annotation label', 500);
        for (const key of ['x', 'y', 'width', 'height']) if (typeof annotation[key] !== 'number' || !Number.isFinite(annotation[key]) || annotation[key] < 0 || annotation[key] > 1) fail(400, 'Annotation coordinates must be finite normalized image coordinates.');
        if (annotation.width <= 0 || annotation.height <= 0 || annotation.x + annotation.width > 1.000000001 || annotation.y + annotation.height > 1.000000001) fail(400, 'Annotation rectangle must lie within the image.');
        const id = annotation.id ?? `annotation-${randomUUID()}`; text(id, 'Annotation ID', 200); if (annotationIds.has(id)) fail(400, 'Duplicate annotation IDs.'); annotationIds.add(id);
        return { ...annotation, id, label: annotation.label.trim(), origin: 'top_left', coordinate_space: 'normalized_displayed_image', original_media_unchanged: true };
      });
      return transaction(() => {
        const config = configured(); const capture = getCapture(input.capture_id); const original = getMedia(input.capture_id);
        if (hash(original.body) !== capture.capture_ref.content_sha256) fail(409, 'Original evidence no longer matches its capture reference.');
        if (!config.scope.element_ids.includes(input.element_id)) fail(400, 'Element is outside the selected scope and exact model version.');
        const previousRow = db.prepare('SELECT record_json FROM review_findings WHERE capture_id=? AND element_id=? AND scope_id=? AND scope_revision=? AND model_version_id=? ORDER BY revision DESC LIMIT 1').get(input.capture_id, input.element_id, config.scope.scope_id, config.scope.revision, config.model.version_id);
        const previous = previousRow ? JSON.parse(previousRow.record_json as string) : null;
        if ((previous?.revision_id ?? null) !== (input.previous_revision_id ?? null)) fail(409, 'Finding changed. Reload its latest revision before saving a correction.');
        // Annotation identifiers cannot be transplanted from a different element or source image.
        for (const annotation of annotations) if (rows('review_findings').some(record => record.finding_id !== previous?.finding_id && record.annotations.some((old: RecordValue) => old.id === annotation.id))) fail(400, 'Annotation identifier belongs to another finding.');
        const record: RecordValue = { schema_version: '0.2.0', workspace, data_mode: workspace, project_id: config.project.id, finding_id: previous?.finding_id ?? `finding-${randomUUID()}`, revision_id: `finding-revision-${randomUUID()}`, revision: (previous?.revision ?? 0) + 1, previous_revision_id: previous?.revision_id ?? null, capture_ref: copy(capture.capture_ref), model_ref: { model_id: config.model.id, version_id: config.model.version_id, element_id: input.element_id }, scope_ref: { scope_id: config.scope.scope_id, revision: config.scope.revision, trade: config.scope.trade, zone_id: config.scope.zone_id }, state: input.state, rationale: input.rationale.trim(), uncertainty_reason: input.uncertainty_reason?.trim() || null, evidence_quality: input.evidence_quality, annotations, review: { authority: 'human_reviewer', reviewer_id: reviewer.id, identity_basis: reviewer.identity_basis, reviewed_at: now() }, alignment: { method: capture.placement?.method ?? 'explicit_model_association', validation: 'unverified', is_verified_3d_registration: false, location_association: copy(capture.placement ?? null) }, ai_suggestion_id: null };
        let task: RecordValue | null = null;
        // A correction retains its originating recapture relationship even when an API caller
        // omits the optional task field. Legacy resolutions can be recovered only by exact revision ID.
        const legacyTaskLinks = previous && !previous.recapture_task_ref ? tasks().filter(item => item.latest_assessment_revision_id === previous.revision_id || item.resolution_revision_id === previous.revision_id) : [];
        if (legacyTaskLinks.length > 1) fail(409, 'Finding has ambiguous recapture history; preserve the original references and resolve the links explicitly.');
        const previousTaskId = previous?.recapture_task_ref?.task_id ?? legacyTaskLinks[0]?.task_id;
        if (previousTaskId && (input.recapture_task_id || input.resolves_task_id) && previousTaskId !== (input.recapture_task_id || input.resolves_task_id)) fail(409, 'A correction cannot move a historical reassessment to a different recapture task.');
        const taskId = input.recapture_task_id || input.resolves_task_id || previousTaskId;
        if (taskId) {
          task = taskById(taskId);
          const origin = getFindingRevision(task.finding_revision_id);
          const exactModel = { model_id: config.model.id, version_id: config.model.version_id, element_id: input.element_id };
          const exactScope = { scope_id: config.scope.scope_id, revision: config.scope.revision, trade: config.scope.trade, zone_id: config.scope.zone_id };
          if (!task.new_capture_id || task.new_capture_id !== input.capture_id || task.source_capture_id !== origin.capture_ref.capture_id || task.element_id !== input.element_id || canonicalJson(task.model_ref) !== canonicalJson(exactModel) || canonicalJson(task.scope_ref) !== canonicalJson(exactScope) || canonicalJson(origin.model_ref) !== canonicalJson(task.model_ref) || canonicalJson(origin.scope_ref) !== canonicalJson(task.scope_ref)) fail(409, 'Reassessment requires the task’s newly supplied capture and exact affected element, model version and scope.');
          if (input.resolves_task_id && (task.status !== 'awaiting_reassessment' || input.state === 'needs_review' || input.evidence_quality !== 'usable')) fail(409, 'Task closure requires a usable, non-needs-review reassessment of the affected element in its newly linked capture.');
          Object.assign(record, { recapture_task_ref: { task_id: task.task_id, originating_finding_revision_id: origin.revision_id, source_capture_ref: copy(origin.capture_ref), source_model_ref: copy(origin.model_ref), source_scope_ref: copy(origin.scope_ref) } });
        }
        db.prepare('INSERT INTO review_findings VALUES (?,?,?,?,?,?,?,?,?,?)').run(record.revision_id, record.finding_id, input.capture_id, input.element_id, config.scope.scope_id, config.scope.revision, config.model.version_id, record.revision, record.previous_revision_id, JSON.stringify(record));
        if (task) {
          const assessment = { ...task, capture_status: 'completed', review_status: 'reassessed', latest_assessment_revision_id: record.revision_id, latest_assessment_state: record.state, latest_assessment_evidence_quality: record.evidence_quality, reassessed_at: record.review.reviewed_at };
          if (input.resolves_task_id) addTaskEvent({ ...assessment, status: 'closed', resolution_revision_id: record.revision_id, closed_at: now() }, 'reassessed_and_closed', { resolution_revision_id: record.revision_id });
          else addTaskEvent(assessment, 'reassessed', { assessment_revision_id: record.revision_id, observation_state: record.state, originating_finding_revision_id: task.finding_revision_id });
        }
        return record;
      });
    },
    saveTask(body: unknown) {
      const input = object(body, ['finding_revision_id', 'reason', 'required_viewpoint', 'assignee', 'due_date', 'before_concealment', 'concealment_date'], ['finding_revision_id', 'reason', 'required_viewpoint', 'assignee', 'due_date', 'before_concealment']);
      for (const key of ['finding_revision_id', 'reason', 'required_viewpoint', 'assignee']) text(input[key], key);
      date(input.due_date, 'Task due date'); if (typeof input.before_concealment !== 'boolean') fail(400, 'Before-concealment selection must be boolean.');
      if (input.concealment_date) { date(input.concealment_date, 'Concealment date'); if (!input.before_concealment) fail(400, 'Concealment date requires the before-concealment flag.'); if (input.due_date > input.concealment_date) fail(400, 'Evidence is required on or before the concealment date.'); }
      return transaction(() => {
        const finding = getFindingRevision(input.finding_revision_id); if (finding.state !== 'needs_review') fail(400, 'Recapture tasks originate from a needs-review finding.');
        const task = { task_id: `recapture-${randomUUID()}`, finding_revision_id: finding.revision_id, source_capture_id: finding.capture_ref.capture_id, model_ref: copy(finding.model_ref), scope_ref: copy(finding.scope_ref), element_id: finding.model_ref.element_id, location: configured().scope.floor, reason: input.reason.trim(), required_viewpoint: input.required_viewpoint.trim(), assignee: input.assignee.trim(), due_date: input.due_date, before_concealment: input.before_concealment, concealment_date: input.concealment_date || null, status: 'open', capture_status: 'requested', review_status: 'pending_evidence', created_at: now(), created_by: reviewer.id, new_capture_id: null, evidence_supplied_at: null, latest_assessment_revision_id: null, resolution_revision_id: null };
        return addTaskEvent(task, 'created');
      });
    },
    linkTaskEvidence(body: unknown) {
      const input = object(body, ['task_id', 'capture_id']); text(input.task_id, 'Task ID', 200); text(input.capture_id, 'Capture ID', 200);
      return transaction(() => {
        const task = taskById(input.task_id); if (task.status === 'closed') fail(409, 'Closed task history cannot be replaced.');
        const source = getFindingRevision(task.finding_revision_id); const capture = getCapture(input.capture_id); getMedia(input.capture_id);
        if (capture.capture_id === source.capture_ref.capture_id) fail(400, 'Recapture evidence must use a different capture from the original finding.');
        if (capture.capture_ref.content_sha256 === source.capture_ref.content_sha256) fail(400, 'Recapture evidence must contain new original media; reimporting identical bytes does not close an evidence gap.');
        if (capture.capture_ref.captured_date && source.capture_ref.captured_date && capture.capture_ref.captured_date < source.capture_ref.captured_date) fail(400, 'Recapture evidence cannot predate the original capture.');
        if (capture.capture_ref.captured_at && source.capture_ref.captured_at && Date.parse(capture.capture_ref.captured_at) < Date.parse(source.capture_ref.captured_at)) fail(400, 'Recapture evidence cannot predate the original capture timestamp.');
        if (task.status === 'awaiting_reassessment' && task.new_capture_id === input.capture_id) fail(409, 'This evidence is already linked and awaiting reassessment.');
        const suppliedAt = now();
        return addTaskEvent({ ...task, status: 'awaiting_reassessment', capture_status: 'completed', review_status: 'awaiting_reassessment', new_capture_id: input.capture_id, evidence_linked_at: suppliedAt, evidence_supplied_at: suppliedAt, latest_assessment_revision_id: null }, 'evidence_linked', { date_validation: capture.capture_ref.captured_date && source.capture_ref.captured_date ? 'not_before_original_date' : 'capture_date_unknown' });
      });
    },
    async importPhoto(body: unknown) {
      if (workspace !== 'local' && !syntheticImportPath) fail(409, 'Real photographs belong in the separate local-photograph workspace. Synthetic evidence cannot be mixed with uploads.');
      const importConfiguration = copy(configured(false));
      const input = object(body, ['filename', 'content_type', 'bytes_base64', 'title', 'source', 'location', 'date_precision', 'captured_date', 'captured_at', 'original_timezone'], ['filename', 'content_type', 'bytes_base64', 'title', 'source', 'location', 'date_precision']);
      for (const key of ['filename', 'title', 'source', 'location']) text(input[key], key, 1000);
      if (basename(input.filename) !== input.filename || /[\x00-\x1f]/.test(input.filename)) fail(400, 'Original filename must not contain paths or control characters.');
      choice(input.content_type, ['image/jpeg', 'image/png', 'image/webp'], 'photograph format'); choice(input.date_precision, ['unknown', 'date', 'timestamp'], 'capture date precision');
      optionalText(input.original_timezone, 'Original timezone', 100);
      let capturedAt: string | null = null; let capturedDate: string | null = null;
      if (input.date_precision === 'unknown') { if (input.captured_at || input.captured_date) fail(400, 'Unknown capture date cannot contain an invented date or time.'); }
      else if (input.date_precision === 'date') { date(input.captured_date, 'Capture date'); if (input.captured_at) fail(400, 'Date-only precision cannot contain an invented time.'); capturedDate = input.captured_date; }
      else { timestamp(input.captured_at, 'Capture timestamp'); capturedAt = input.captured_at; capturedDate = capturedAt.slice(0, 10); if (input.captured_date && input.captured_date !== capturedDate) fail(400, 'Capture date must preserve the original timestamp date.'); }
      if (typeof input.bytes_base64 !== 'string' || !input.bytes_base64.length || input.bytes_base64.length > 20971520 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bytes_base64)) fail(400, 'Photo bytes must be canonical base64 up to 15 MiB.');
      const bytes = Buffer.from(input.bytes_base64, 'base64'); if (!bytes.length || bytes.length > 15 * 1024 * 1024) fail(400, 'Photo must contain at most 15 MiB.');
      if (workspace === 'fixture') {
        let trusted: Buffer;
        try { trusted = readFileSync(syntheticImportPath!); } catch { fail(409, 'Bundled synthetic recapture evidence is unavailable. Real photographs belong in the local-photograph workspace.'); }
        if (input.content_type !== 'image/png' || hash(bytes) !== hash(trusted)) fail(409, 'Only the exact bundled synthetic recapture PNG may enter the synthetic demonstration. Import real or other test imagery into the separate local-photograph workspace.');
      }
      let metadata: Metadata;
      try {
        metadata = await sharp(bytes, { limitInputPixels: 50000000, failOn: 'warning', animated: false }).metadata();
        if (!metadata.width || !metadata.height || metadata.width * metadata.height > 50000000 || (metadata.pages ?? 1) !== 1) fail(400, 'Use a single photograph of at most 50 megapixels.');
        // Decode all pixels to reject a plausible header with corrupt/truncated image data. Original bytes are retained unchanged.
        await sharp(bytes, { limitInputPixels: 50000000, failOn: 'warning' }).raw().toBuffer();
      } catch (error) { if (error instanceof DomainError) throw error; fail(400, 'Photo cannot be decoded as a valid JPEG, PNG or WebP image.'); }
      const detectedType = ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[metadata.format ?? ''];
      if (detectedType !== input.content_type) fail(400, 'Declared photograph format does not match its bytes.');
      const id = `photo-${randomUUID()}`; const filename = `${id}.original`; const uploadedAt = now();
      const orientationSwaps = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
      const synthetic = workspace === 'fixture';
      const capture = { capture_id: id, workspace, data_mode: synthetic ? 'synthetic_test' : 'local', title: synthetic ? `Synthetic test recapture · ${input.title.trim()}` : input.title.trim(), media_url: `/api/v2/${workspace}/media/${id}`, display_url: `/api/v2/${workspace}/media/${id}/display`, source: synthetic ? 'Bundled synthetic recapture PNG; test pixels, not field evidence.' : input.source.trim(), source_kind: synthetic ? 'synthetic_test' : 'user_imported_original', location: input.location.trim(), original_filename: input.filename, content_type: detectedType, width: orientationSwaps ? metadata.height : metadata.width, height: orientationSwaps ? metadata.width : metadata.height, original_orientation: metadata.orientation ?? 1, capture_ref: { capture_id: id, content_sha256: hash(bytes), captured_at: capturedAt, captured_date: capturedDate, date_precision: input.date_precision, date_source: input.date_precision === 'unknown' ? 'unknown' : 'uploader_supplied', original_timezone: input.original_timezone || null, uploaded_at: uploadedAt }, placement: { method: importConfiguration.model ? 'explicit_model_association' : 'explicit_location_association', plan_ref: null, normalized_pin: null, is_verified_3d_registration: false, validation: 'unverified', location: input.location.trim() }, uploaded_by: reviewer.id, processing: { status: 'validated', decoder: 'sharp', retries: 0 }, source_context: synthetic ? 'Synthetic test evidence supplied for the fixture workflow; no real photograph, APS capture, automatic registration or measurement.' : 'User-imported original photo; manually supplied capture metadata and scope references. No automatic registration or measurement.' };
      const path = join(uploadDir, filename); writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
      try { return transaction(() => { if (canonicalJson(configured(false)) !== canonicalJson(importConfiguration)) fail(409, 'Project references changed during photo validation. Review the current configuration and import again.'); db.prepare('INSERT INTO review_captures VALUES (?,?)').run(id, JSON.stringify(capture)); db.prepare('INSERT INTO review_media VALUES (?,?,?,?,?)').run(id, filename, detectedType, capture.capture_ref.content_sha256, bytes.length); return { ...capture, media_status: 'verified' }; }); }
      catch (error) { unlinkSync(path); throw error; }
    },
    createExport(extra: RecordValue = {}, options: RecordValue = {}) {
      object(options, ['coverage_rule'], []);
      if (options.coverage_rule !== undefined) object(options.coverage_rule, ['as_of_date', 'freshness_days'], []);
      configured();
      return transaction(() => {
        const state = bootstrap();
        const legacy = workspace === 'fixture' ? legacyStore.bootstrap() : null;
        const mediaIds = [...state.captures.map(capture => capture.capture_id), ...(legacy?.plan ? [legacy.plan.file_id] : [])];
        const media = mediaIds.map(id => { const original = getMedia(id); return { id, content_type: original.contentType, content_sha256: hash(original.body), byte_length: original.body.length, original_base64: original.body.toString('base64'), availability: 'embedded_original', source: workspace === 'fixture' ? 'synthetic_fixture' : 'user_imported_original' }; });
        const display_media = mediaIds.map(id => { const display = getDisplayMedia(id); return { id, content_type: display.contentType, source_content_sha256: display.source_sha256, content_sha256: display.display_sha256, byte_length: display.body.length, display_base64: display.body.toString('base64'), method: display.method, width: display.width, height: display.height }; });
        const legacyContext = legacy && legacyStore.snapshotContext ? legacyStore.snapshotContext() : null;
        const legacyHistory = legacyContext?.assessment_history ?? (legacy ? legacy.assessments.flatMap((assessment: RecordValue) => legacyStore.history(assessment.assessment_id)) : []);
        const snapshot = { ...state, exports: undefined, coverage: coverage(options.coverage_rule ?? {}), media, display_media, legacy_assessment_history: legacyHistory, legacy_plan: legacy?.plan ?? null, legacy_placement_history: legacyContext?.placement_history ?? [], workflows: copy(extra), integration: { actual_model_viewer: 'unavailable_pending_verified_project_access_and_viewable_manifest', external_submission_enabled: false, ai_suggestions: false, automatic_measurement: false }, metric_definitions: { evidence_coverage: 'Distinct selected elements with individual findings; latest dated evidence under explicit freshness rule. Unknown dates remain unknown.', percent_complete: 'Only explicit manual comparable quantities and a supported denominator may establish a percentage; no installation percentage inferred from evidence count.' } };
        const id = `packet-${randomUUID()}`; const createdAt = now();
        const manifest = { schema_version: '0.2.0', product: 'Forma ReCap', id, workspace, data_mode: workspace, workspace_label: workspace === 'fixture' ? 'Synthetic demo' : 'Local photographs · manual BIM references', created_at: createdAt, generated_by: reviewer.id, source_snapshot_cutoff: createdAt, snapshot_sha256: hash(canonicalJson(snapshot)), hash_basis: 'SHA-256 of canonical JSON snapshot. Volatile packet ID and generation timestamp are excluded.', snapshot };
        // JSON serialization removes undefined optional fields before rendering and hashing consistency.
        const fixedManifest = copy(manifest); fixedManifest.snapshot_sha256 = hash(canonicalJson(fixedManifest.snapshot));
        const html = report(fixedManifest); const summary = { id, created_at: createdAt, html_url: `/api/v2/${workspace}/exports/${id}/report`, manifest_url: `/api/v2/${workspace}/exports/${id}/manifest` };
        db.prepare('INSERT INTO review_exports VALUES (?,?,?,?)').run(id, JSON.stringify(fixedManifest), html, JSON.stringify(summary)); return summary;
      });
    },
    getExport(id: string) { text(id, 'Packet ID', 200); const row = db.prepare('SELECT * FROM review_exports WHERE id=?').get(id); if (!row) fail(404, 'Packet is unavailable in this workspace.'); return { manifest: JSON.parse(row.manifest_json as string), html: row.report_html as string, summary: JSON.parse(row.summary_json as string) }; },
    close() { db.close(); },
  };
}
