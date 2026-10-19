import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { canonicalJson, createStore, DomainError } from '../server/domain.ts';
import { createReviewStore } from '../server/review.ts';
import { createWorkflows } from '../server/workflows.ts';

type Context = { after: (fn: () => void) => void };
const status = (expected: number) => (error: unknown) => error instanceof DomainError && error.status === expected;
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function fixture(t: Context, workspace: 'fixture' | 'local' = 'fixture') {
  const directory = mkdtempSync(join(tmpdir(), 'forma-recap-elements-'));
  const legacy = createStore({ dbPath: join(directory, 'legacy.sqlite'), mediaDir: resolve('server/media'), mode: 'fixture' });
  const options = { dbPath: join(directory, `${workspace}.sqlite`), uploadDir: join(directory, 'photos'), workspace, legacyStore: legacy };
  const review = createReviewStore(options);
  t.after(() => { review.close(); legacy.close(); rmSync(directory, { recursive: true, force: true }); });
  return { review, legacy, options, directory };
}
const finding = (changes: Record<string, any> = {}) => ({ capture_id: 'fixture-capture-01', element_id: 'DUCT-01', state: 'observed_installed', rationale: 'Duct is visible in this selected evidence area.', uncertainty_reason: null, evidence_quality: 'usable', annotations: [{ x: .1, y: .2, width: .3, height: .4, label: 'Visible duct' }], previous_revision_id: null, ...changes });
const taskInput = (revision: string, changes: Record<string, any> = {}) => ({ finding_revision_id: revision, reason: 'Terminal obscured by ceiling screen.', required_viewpoint: 'Photograph the terminal connection from below before closure.', assignee: 'Mechanical supervisor', due_date: '2026-10-20', before_concealment: true, concealment_date: '2026-10-21', ...changes });
const config = { project_name: 'User photo project', location: 'Floor 2 east', trade: 'Ductwork', scope_name: 'Supply air', model_id: 'manually-entered-model', model_version: 'version-7', elements: [{ external_id: 'DUCT-A', label: 'Supply duct' }, { external_id: 'DUCT-B', label: 'Terminal' }] };
async function photo(changes: Record<string, any> = {}) {
  const bytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#a7b1bc' } }).png().toBuffer();
  return { filename: 'validation-raster.png', content_type: 'image/png', bytes_base64: bytes.toString('base64'), title: 'Uploaded validation raster (synthetic test pixels)', source: 'Automated validation; not a jobsite observation', location: 'Floor 2 east', date_precision: 'unknown', ...changes };
}

test('individual elements keep independent states without converting historical scope assessments', t => {
  const { review, legacy } = fixture(t);
  const historical = legacy.saveAssessment({ capture_id: 'fixture-capture-01', state: 'needs_review', rationale: 'Legacy scope observation.', uncertainty_reason: 'Partial view.', element_ids: ['DUCT-01', 'DUCT-02', 'DUCT-03'], previous_revision_id: null });
  assert.equal(review.bootstrap().findings.length, 0);
  assert.deepEqual(review.bootstrap().legacy_assessments, [historical]);
  const installed = review.saveFinding(finding());
  const obscured = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', rationale: 'Terminal cannot be seen.', uncertainty_reason: 'Obscured by ceiling screen.', evidence_quality: 'limited' }));
  assert.equal(installed.state, 'observed_installed'); assert.equal(obscured.state, 'needs_review');
  assert.equal(review.bootstrap().findings.length, 2);
  assert.equal(installed.model_ref.version_id, 'fixture-model-v7');
  assert.equal(installed.review.reviewer_id, 'fixture-reviewer');
  assert.equal(installed.alignment.method, 'manual_plan_pin');
  assert.equal(installed.alignment.is_verified_3d_registration, false);
  assert.equal(installed.capture_ref.content_sha256, digest(legacy.getMedia('fixture-capture-01').body));
  assert.deepEqual(legacy.bootstrap().assessments, [historical]);
});

test('finding corrections append immutable revisions and reject stale or forged provenance', t => {
  const { review } = fixture(t);
  const first = review.saveFinding(finding());
  const second = review.saveFinding(finding({ state: 'needs_review', uncertainty_reason: 'Correction: photo does not show the far side.', previous_revision_id: first.revision_id }));
  assert.equal(second.finding_id, first.finding_id); assert.equal(second.revision, 2);
  assert.deepEqual(review.findingHistory(first.finding_id), [first, second]);
  assert.deepEqual(review.getFindingRevision(first.revision_id), first);
  assert.throws(() => review.saveFinding(finding({ previous_revision_id: first.revision_id })), status(409));
  for (const changes of [{ model_version: 'new' }, { reviewer_id: 'forged' }, { element_id: 'FOREIGN' }, { state: 'not_observed' }, { rationale: '' }, { evidence_quality: 'measured' }]) assert.throws(() => review.saveFinding(finding(changes)), status(400));
  assert.throws(() => review.db.prepare('UPDATE review_findings SET record_json=? WHERE revision_id=?').run('{}', first.revision_id), /immutable/);
});

test('annotations validate bounds, preserve originals and cannot be transplanted between findings', t => {
  const { review } = fixture(t); const before = review.getMedia('fixture-capture-01').body;
  const first = review.saveFinding(finding());
  assert.equal(first.annotations[0].coordinate_space, 'normalized_displayed_image');
  assert.deepEqual(review.getMedia('fixture-capture-01').body, before);
  assert.throws(() => review.saveFinding(finding({ element_id: 'DUCT-02', annotations: [{ id: first.annotations[0].id, x: .1, y: .2, width: .2, height: .2, label: 'Foreign box' }] })), status(400));
  for (const annotation of [{ x: .9, y: .1, width: .2, height: .2, label: 'Outside' }, { x: 0, y: 0, width: 0, height: .2, label: 'Empty' }, { x: NaN, y: 0, width: .2, height: .2, label: 'NaN' }]) assert.throws(() => review.saveFinding(finding({ annotations: [annotation] })), status(400));
});

test('assigned recapture task links later evidence, requires reassessment and preserves original finding', t => {
  const { review } = fixture(t);
  const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Obscured terminal.', evidence_quality: 'limited' }));
  const task = review.saveTask(taskInput(original.revision_id));
  assert.equal(task.assignee, 'Mechanical supervisor'); assert.equal(task.status, 'open');
  assert.throws(() => review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-01' }), status(400));
  assert.throws(() => review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', resolves_task_id: task.task_id })), status(409));
  const linked = review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' });
  assert.equal(linked.status, 'awaiting_reassessment');
  assert.throws(() => review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Still obscured.', resolves_task_id: task.task_id })), status(409));
  assert.throws(() => review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', evidence_quality: 'unusable', resolves_task_id: task.task_id })), status(409));
  const resolved = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', rationale: 'Later evidence shows the terminal.', resolves_task_id: task.task_id }));
  const state = review.bootstrap();
  assert.equal(state.tasks[0].status, 'closed'); assert.equal(state.tasks[0].resolution_revision_id, resolved.revision_id);
  assert.equal(state.findings.length, 2); assert.deepEqual(review.getFindingRevision(original.revision_id), original);
  assert.equal(state.task_events.length, 3);
  assert.throws(() => review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' }), status(409));
  assert.throws(() => review.db.prepare('DELETE FROM review_task_events').run(), /immutable/);
});

test('task fields, concealment dates and originating needs-review state are validated', t => {
  const { review } = fixture(t); const installed = review.saveFinding(finding());
  assert.throws(() => review.saveTask(taskInput(installed.revision_id)), status(400));
  const needs = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Obscured.' }));
  for (const changes of [{ assignee: '' }, { required_viewpoint: '' }, { due_date: '2026-02-30' }, { due_date: '2026-10-22' }, { before_concealment: false }, { reviewer_id: 'forged' }]) assert.throws(() => review.saveTask(taskInput(needs.revision_id, changes)), status(400));
});

test('coverage deduplicates elements across dates and retains unresolved, stale and missing evidence', t => {
  const { review } = fixture(t);
  review.saveFinding(finding());
  review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-01' }));
  review.saveFinding(finding({ element_id: 'DUCT-02', state: 'needs_review', uncertainty_reason: 'View obscured.', evidence_quality: 'limited' }));
  const fresh = review.coverage({ as_of_date: '2026-10-19', freshness_days: 7 });
  assert.equal(fresh.total_elements, 3); assert.deepEqual(fresh.counts, { usable: 1, unresolved: 1, outdated: 0, no_evidence: 1, date_unknown: 0 });
  assert.equal(fresh.elements[0].finding.capture_ref.capture_id, 'fixture-capture-02');
  const stale = review.coverage({ as_of_date: '2026-11-19', freshness_days: 7 });
  assert.equal(stale.counts.outdated, 1); assert.equal(stale.counts.unresolved, 1);
  const prior = review.coverage({ as_of_date: '2026-10-01' }); assert.equal(prior.counts.no_evidence, 3);
  assert.throws(() => review.coverage({ freshness_days: 0 }), status(400));
});

test('photo import preserves bytes and unknown/date-only/timestamp precision with upload time separate', async t => {
  const { review } = fixture(t, 'local'); review.configure(config);
  const unknownInput = await photo(); const unknown = await review.importPhoto(unknownInput);
  assert.deepEqual(review.getMedia(unknown.capture_id).body, Buffer.from(unknownInput.bytes_base64, 'base64'));
  assert.equal(unknown.capture_ref.captured_date, null); assert.equal(unknown.capture_ref.captured_at, null); assert.equal(unknown.capture_ref.date_precision, 'unknown');
  assert.ok(unknown.capture_ref.uploaded_at); assert.equal(unknown.capture_ref.content_sha256, digest(Buffer.from(unknownInput.bytes_base64, 'base64')));
  const onlyDate = await review.importPhoto(await photo({ date_precision: 'date', captured_date: '2026-10-08' }));
  assert.equal(onlyDate.capture_ref.captured_at, null); assert.equal(onlyDate.capture_ref.captured_date, '2026-10-08');
  const precise = await review.importPhoto(await photo({ date_precision: 'timestamp', captured_at: '2026-10-09T23:40:00-04:00', original_timezone: 'America/New_York' }));
  assert.equal(precise.capture_ref.captured_date, '2026-10-09'); assert.equal(precise.capture_ref.captured_at, '2026-10-09T23:40:00-04:00');
  assert.equal(precise.capture_ref.date_source, 'uploader_supplied'); assert.equal(precise.placement.is_verified_3d_registration, false);
  const record = review.saveFinding(finding({ capture_id: unknown.capture_id, element_id: 'DUCT-A' }));
  assert.equal(record.review.identity_basis, 'self_asserted_local_identity');
  assert.equal(review.coverage().counts.date_unknown, 1);
  assert.throws(() => review.configure({ ...config, model_version: 'version-8' }), status(409));
});

test('photo validation rejects corrupt, disguised, oversized or invented metadata before storing', async t => {
  const { review } = fixture(t, 'local'); review.configure(config);
  const valid = await photo();
  for (const changes of [{ bytes_base64: Buffer.from('<svg/>').toString('base64') }, { bytes_base64: 'invalid==foo' }, { content_type: 'image/jpeg' }, { filename: '../escape.png' }, { date_precision: 'unknown', captured_date: '2026-10-08' }, { date_precision: 'date', captured_date: '2026-02-30' }, { date_precision: 'date', captured_date: '2026-10-08', captured_at: '2026-10-08T12:00:00Z' }, { date_precision: 'timestamp', captured_at: '2026-10-08T12:00:00' }, { date_precision: 'timestamp', captured_at: '2026-10-08T24:00:00Z' }]) await assert.rejects(review.importPhoto({ ...valid, ...changes }), status(400));
  const oversized = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(review.importPhoto({ ...valid, bytes_base64: oversized.toString('base64') }), status(400));
  assert.equal(review.bootstrap().captures.length, 0);
});

test('recapture rejects identical reimports and same-day photographs older than source timestamp', async t => {
  const { review } = fixture(t, 'local'); review.configure(config);
  const originalInput = await photo({ date_precision: 'timestamp', captured_at: '2026-10-09T14:00:00Z' });
  const originalCapture = await review.importPhoto(originalInput);
  const original = review.saveFinding(finding({ capture_id: originalCapture.capture_id, element_id: 'DUCT-A', state: 'needs_review', uncertainty_reason: 'The area is obscured.' }));
  const task = review.saveTask(taskInput(original.revision_id));
  const repeat = await review.importPhoto({ ...originalInput, captured_at: '2026-10-09T15:00:00Z' });
  assert.throws(() => review.linkTaskEvidence({ task_id: task.task_id, capture_id: repeat.capture_id }), status(400));
  const olderBytes = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c4c5c6' } }).png().toBuffer();
  const older = await review.importPhoto({ ...originalInput, bytes_base64: olderBytes.toString('base64'), captured_at: '2026-10-09T13:00:00Z' });
  assert.throws(() => review.linkTaskEvidence({ task_id: task.task_id, capture_id: older.capture_id }), status(400));
  assert.equal(review.bootstrap().tasks[0].status, 'open');
});

test('workspace isolation prevents uploads in synthetic workspace and cross-database model leakage', async t => {
  const { review, options } = fixture(t);
  await assert.rejects(review.importPhoto(await photo()), status(409));
  assert.throws(() => review.configure(config), status(409));
  assert.throws(() => createReviewStore({ ...options, workspace: 'local' }), status(409));
  assert.throws(() => review.getCapture('photo-foreign'), status(404));
});

test('fixed packets embed unchanged originals, annotations, histories and workflows without external writes', t => {
  const { review, legacy } = fixture(t);
  const first = review.saveFinding(finding({ state: 'needs_review', uncertainty_reason: '<script>obscured</script>' }));
  review.saveTask(taskInput(first.revision_id));
  legacy.placeCapture('fixture-capture-01', { x: .7, y: .2 });
  const packet = review.createExport({ reconciliations: [{ entry_id: 'manual-quantity', category: 'trade_reported', quantity: null, unit: 'm', element_ids: ['DUCT-01'], period_start: '2026-10-01', period_end: '2026-10-19', source: 'Supervisor', basis: 'Manual report', measurement_method: 'manual', comparison_key: 'duct-length' }], reconciliation_summary: { reporting_period: null, comparisons: [{ element_ids: ['DUCT-01'], period_start: '2026-10-01', period_end: '2026-10-19', quantity_reported: 0, quantity_supported: null, unit: 'm', delta: null, comparable: false, reason: 'Supported quantity is unknown.' }], observations: { total_elements: 3, observed_installed: 0, not_observed: 0, needs_review: 1, no_finding: 2, date_unknown: 0, conflicting_observations: 0, elements: [] }, percentages: [{ entry_id: 'manual-quantity', value: null, unit: 'm', denominator: null, reason: 'No explicit denominator.' }] }, drafts: [] });
  const fixed = review.getExport(packet.id);
  assert.equal(fixed.manifest.workspace, 'fixture');
  assert.equal(fixed.manifest.snapshot_sha256, digest(canonicalJson(fixed.manifest.snapshot)));
  assert.equal(fixed.manifest.snapshot.media.length, 3);
  for (const item of fixed.manifest.snapshot.media) assert.equal(digest(Buffer.from(item.original_base64, 'base64')), item.content_sha256);
  assert.ok(fixed.manifest.snapshot.legacy_placement_history.length >= 2);
  assert.match(fixed.html, /Unknown m/); assert.match(fixed.html, /Annotation overlays are separate/);
  assert.match(fixed.html, /Reported versus imagery-supported quantities/);
  assert.match(fixed.html, /All recorded periods/);
  assert.match(fixed.html, /Reviewed element observations/);
  assert.match(fixed.html, /Completion calculation basis/);
  const visibleReport = fixed.html.split('<details>')[0];
  assert.match(visibleReport, /<td>0 m<\/td><td>Unknown m<\/td><td>Unknown m<\/td>/);
  assert.match(visibleReport, /Not comparable<br>Supported quantity is unknown/);
  assert.match(visibleReport, /<td>Not provided<\/td><td>Unknown<\/td>/);
  assert.doesNotMatch(visibleReport, /reconciliation_summary|quantity_reported/);
  assert.doesNotMatch(fixed.html, /<script>obscured<\/script>/); assert.match(fixed.html, /&lt;script&gt;obscured/);
  review.saveFinding(finding({ previous_revision_id: first.revision_id }));
  assert.deepEqual(review.getExport(packet.id), fixed);
  assert.throws(() => review.db.prepare('DELETE FROM review_exports WHERE id=?').run(packet.id), /immutable/);
});

test('changed imported originals block new review and export but existing fixed packets remain available', async t => {
  const { review, directory } = fixture(t, 'local'); review.configure(config);
  const input = await photo(); const capture = await review.importPhoto(input);
  const packet = review.createExport(); const fixed = review.getExport(packet.id);
  const filename = review.db.prepare('SELECT filename FROM review_media WHERE id=?').get(capture.capture_id)?.filename as string;
  const original = readFileSync(join(directory, 'photos', filename)); original[original.length - 1] ^= 1; writeFileSync(join(directory, 'photos', filename), original);
  assert.throws(() => review.getMedia(capture.capture_id), status(409));
  assert.throws(() => review.saveFinding(finding({ capture_id: capture.capture_id, element_id: 'DUCT-A' })), status(409));
  assert.throws(() => review.createExport(), status(409));
  assert.deepEqual(review.getExport(packet.id), fixed);
});

test('draft packet previews preserve selected historical annotations after finding corrections', t => {
  const { review } = fixture(t);
  const workflows = createWorkflows({ db: review.db, context: () => review.bootstrap(), getFindingRevision: review.getFindingRevision, getCapture: review.getCapture });
  const first = review.saveFinding(finding({ annotations: [{ x: .1, y: .2, width: .3, height: .2, label: 'Original selected terminal region' }, { x: .5, y: .5, width: .2, height: .2, label: 'Unselected neighboring region' }] }));
  workflows.saveDraft({ type: 'rfi', title: 'Check terminal detail', description: 'Clarify the connection depicted in the selected evidence region.', location: 'Level 02 / East wing', requested_action: 'Confirm terminal detail.', proposed_assignee: 'Design coordinator', finding_revision_ids: [first.revision_id], annotation_ids: [first.annotations[0].id] });
  review.saveFinding(finding({ previous_revision_id: first.revision_id, annotations: [{ id: first.annotations[0].id, x: .2, y: .3, width: .2, height: .1, label: 'Corrected current terminal region' }] }));
  const packet = review.createExport(workflows.snapshot());
  const fixed = review.getExport(packet.id);
  const article = fixed.html.match(/<article class="local-draft">[\s\S]*?<\/article>/)?.[0];
  assert.ok(article);
  assert.match(article, /Original selected terminal region/);
  assert.doesNotMatch(article, /Corrected current terminal region|Unselected neighboring region/);
  assert.match(article, /left:10%;top:20%;width:30%;height:20%/);
  assert.ok(article.includes(first.revision_id));
  assert.ok(article.includes(first.capture_ref.content_sha256));
  assert.match(article, /fixture-model \/ fixture-model-v7/);
  const original = fixed.manifest.snapshot.media.find((item: Record<string, any>) => item.id === 'fixture-capture-01');
  const display = fixed.manifest.snapshot.display_media.find((item: Record<string, any>) => item.id === 'fixture-capture-01');
  assert.ok(article.includes(display.display_base64));
  assert.equal(display.source_content_sha256, original.content_sha256);
  assert.equal(fixed.manifest.snapshot.workflows.drafts[0].evidence[0].annotations.length, 1);
  review.saveFinding(finding({ element_id: 'DUCT-02' }));
  assert.equal(review.getExport(packet.id).html, fixed.html);
});

test('evidence supplied and human reassessment remain separate even when the new finding is unresolved', t => {
  const { review } = fixture(t);
  const installed = review.saveFinding(finding());
  const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Terminal hidden behind the ceiling screen.', evidence_quality: 'limited' }));
  const task = review.saveTask(taskInput(original.revision_id));
  assert.equal(task.capture_status, 'requested');
  assert.equal(task.review_status, 'pending_evidence');
  const supplied = review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' });
  assert.equal(supplied.capture_status, 'completed');
  assert.equal(supplied.review_status, 'awaiting_reassessment');
  assert.ok(supplied.evidence_supplied_at);
  assert.equal(supplied.latest_assessment_revision_id, null);
  assert.equal(review.bootstrap().findings.length, 2, 'Linking evidence creates no assessment or installation claim.');
  assert.throws(() => review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-02', recapture_task_id: task.task_id })), status(409));
  assert.throws(() => review.saveFinding(finding({ element_id: 'DUCT-03', previous_revision_id: original.revision_id, recapture_task_id: task.task_id })), status(409));
  const subsequent = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', state: 'needs_review', rationale: 'A new angle was supplied but the terminal detail remains obscured.', uncertainty_reason: 'Connection detail still hidden.', evidence_quality: 'limited', recapture_task_id: task.task_id }));
  const state = review.bootstrap();
  assert.equal(state.tasks[0].capture_status, 'completed');
  assert.equal(state.tasks[0].review_status, 'reassessed');
  assert.equal(state.tasks[0].latest_assessment_revision_id, subsequent.revision_id);
  assert.equal(state.tasks[0].resolution_revision_id, null);
  assert.equal(subsequent.state, 'needs_review');
  assert.notEqual(subsequent.finding_id, original.finding_id);
  assert.deepEqual(subsequent.recapture_task_ref, { task_id: task.task_id, originating_finding_revision_id: original.revision_id, source_capture_ref: original.capture_ref, source_model_ref: original.model_ref, source_scope_ref: original.scope_ref });
  assert.deepEqual(review.getFindingRevision(original.revision_id), original);
  assert.deepEqual(review.getFindingRevision(installed.revision_id), installed);
  assert.equal(state.findings.some(record => record.model_ref.element_id === 'DUCT-02'), false);
  assert.equal(review.coverage({ as_of_date: '2026-10-19' }).counts.no_evidence, 1);
  const correction = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', rationale: 'Corrected reassessment rationale, with explicit continued uncertainty.', state: 'needs_review', uncertainty_reason: 'Still hidden.', previous_revision_id: subsequent.revision_id, recapture_task_id: task.task_id }));
  assert.equal(correction.revision, 2);
  assert.equal(review.bootstrap().tasks[0].latest_assessment_revision_id, correction.revision_id);
  assert.equal(review.bootstrap().task_events.at(-1)?.type, 'reassessed');
  const implicitCorrection = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', previous_revision_id: correction.revision_id }));
  assert.deepEqual(implicitCorrection.recapture_task_ref, subsequent.recapture_task_ref, 'Omitted optional task input must not erase historical linkage.');
  assert.equal(review.bootstrap().tasks[0].latest_assessment_state, 'observed_installed');
});

test('a later unresolved correction preserves a legacy closed capture request and updates its human assessment', t => {
  const { review } = fixture(t);
  const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Obscured terminal.' }));
  const task = review.saveTask(taskInput(original.revision_id));
  review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' });
  const resolved = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', resolves_task_id: task.task_id }));
  const packet = review.createExport(); const fixed = review.getExport(packet.id);
  const corrected = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', previous_revision_id: resolved.revision_id, state: 'needs_review', uncertainty_reason: 'Correction: terminal detail is still ambiguous.', evidence_quality: 'limited' }));
  assert.equal(corrected.recapture_task_ref.task_id, task.task_id);
  const latestTask = review.bootstrap().tasks[0];
  assert.equal(latestTask.capture_status, 'completed');
  assert.equal(latestTask.review_status, 'reassessed');
  assert.equal(latestTask.latest_assessment_revision_id, corrected.revision_id);
  assert.equal(latestTask.latest_assessment_state, 'needs_review');
  assert.equal(latestTask.latest_assessment_evidence_quality, 'limited');
  assert.equal(latestTask.resolution_revision_id, resolved.revision_id, 'Historical closure revision remains recorded independently of the latest assessment.');
  assert.deepEqual(review.getExport(packet.id), fixed);
});

test('reassessment rejects mismatched stored model or scope references instead of silently remapping history', t => {
  const { review } = fixture(t);
  const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Obscured terminal.' }));
  const task = review.saveTask(taskInput(original.revision_id));
  const linked = review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' });
  for (const altered of [{ ...linked, model_ref: { ...linked.model_ref, version_id: 'different-version' } }, { ...linked, scope_ref: { ...linked.scope_ref, revision: 99 } }]) {
    review.db.prepare('INSERT INTO review_task_events(task_id,event_json) VALUES (?,?)').run(task.task_id, JSON.stringify({ task_id: task.task_id, task: altered }));
    assert.throws(() => review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', recapture_task_id: task.task_id })), status(409));
  }
  assert.equal(review.bootstrap().findings.length, 1);
  assert.deepEqual(review.getFindingRevision(original.revision_id), original);
});

test('fixture accepts only server-authorized synthetic recapture bytes and cannot label them as real evidence', async t => {
  const { review: existing, options, directory } = fixture(t);
  const input = await photo({ date_precision: 'date', captured_date: '2026-10-16', source: 'Attempted real-site source label', title: 'Terminal follow-up' });
  const trustedPath = join(directory, 'trusted-synthetic.png');
  writeFileSync(trustedPath, Buffer.from(input.bytes_base64, 'base64'));
  const review = createReviewStore({ ...options, syntheticImportPath: trustedPath });
  try {
    const capture = await review.importPhoto(input);
    assert.equal(capture.workspace, 'fixture');
    assert.equal(capture.data_mode, 'synthetic_test');
    assert.equal(capture.source_kind, 'synthetic_test');
    assert.match(capture.title, /^Synthetic test recapture/);
    assert.match(capture.source, /not field evidence/);
    assert.doesNotMatch(capture.source, /Attempted/);
    assert.equal(capture.capture_ref.captured_at, null);
    assert.equal(capture.capture_ref.captured_date, '2026-10-16');
    assert.equal(capture.placement.is_verified_3d_registration, false);
    assert.equal(review.bootstrap().captures.length, 3);
    assert.equal(existing.bootstrap().captures.length, 3);
    assert.deepEqual(review.getMedia(capture.capture_id).body, Buffer.from(input.bytes_base64, 'base64'));
    assert.equal(review.getCapture(capture.capture_id).display_url, `/api/v2/fixture/media/${capture.capture_id}/display`);
    const other = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#101820' } }).png().toBuffer();
    await assert.rejects(review.importPhoto({ ...input, bytes_base64: other.toString('base64') }), status(409));
    await assert.rejects(review.importPhoto({ ...input, content_type: 'image/jpeg' }), status(409));
    const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Terminal obscured.' }));
    const task = review.saveTask(taskInput(original.revision_id));
    review.linkTaskEvidence({ task_id: task.task_id, capture_id: capture.capture_id });
    const reassessment = review.saveFinding(finding({ capture_id: capture.capture_id, element_id: 'DUCT-03', recapture_task_id: task.task_id }));
    const packet = review.createExport();
    const fixed = review.getExport(packet.id);
    const uploadedOriginal = fixed.manifest.snapshot.media.find((item: Record<string, any>) => item.id === capture.capture_id);
    const uploadedDisplay = fixed.manifest.snapshot.display_media.find((item: Record<string, any>) => item.id === capture.capture_id);
    assert.equal(uploadedOriginal.original_base64, input.bytes_base64);
    assert.equal(uploadedDisplay.display_base64, input.bytes_base64);
    assert.equal(uploadedDisplay.source_content_sha256, uploadedOriginal.content_sha256);
    assert.equal(uploadedDisplay.method, 'original_raster');
    assert.equal(fixed.manifest.data_mode, 'fixture');
    assert.equal(fixed.manifest.snapshot.findings.find((record: Record<string, any>) => record.revision_id === reassessment.revision_id).recapture_task_ref.originating_finding_revision_id, original.revision_id);
  } finally { review.close(); }
});

test('fixed report shows complete finding revisions, recapture decisions and immutable display derivatives', t => {
  const { review, legacy } = fixture(t);
  const scope = legacy.saveAssessment({ capture_id: 'fixture-capture-01', state: 'not_observed', rationale: 'Historical scope observation remains independent.', uncertainty_reason: 'Scope partly obscured.', element_ids: ['DUCT-01', 'DUCT-02', 'DUCT-03'], previous_revision_id: null });
  const original = review.saveFinding(finding({ element_id: 'DUCT-03', state: 'needs_review', uncertainty_reason: 'Terminal obscured.', annotations: [{ x: .4, y: .3, width: .2, height: .2, label: 'Original obscured connection' }] }));
  const task = review.saveTask(taskInput(original.revision_id));
  review.linkTaskEvidence({ task_id: task.task_id, capture_id: 'fixture-capture-02' });
  const subsequent = review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', recapture_task_id: task.task_id, annotations: [{ x: .3, y: .2, width: .2, height: .2, label: 'Subsequent visible connection' }] }));
  const packet = review.createExport({}, { coverage_rule: { as_of_date: '2026-10-19', freshness_days: 7 } });
  const fixed = review.getExport(packet.id);
  const visible = fixed.html.split('<details>')[0];
  assert.match(visible, /Individual finding revision history/);
  assert.match(visible, /Original obscured connection/);
  assert.match(visible, /Subsequent visible connection/);
  assert.match(visible, /Explicit reassessment for task/);
  assert.match(visible, /Capture request: completed/);
  assert.match(visible, /Review: reassessed/);
  assert.ok(visible.includes(scope.review.revision_id));
  assert.ok(visible.includes(original.revision_id));
  assert.ok(visible.includes(subsequent.revision_id));
  assert.equal(fixed.manifest.snapshot.coverage.freshness_days, 7);
  assert.equal(fixed.manifest.snapshot.coverage.as_of_date, '2026-10-19');
  assert.equal(fixed.manifest.snapshot.display_media.length, fixed.manifest.snapshot.media.length);
  for (const display of fixed.manifest.snapshot.display_media) {
    const source = fixed.manifest.snapshot.media.find((item: Record<string, any>) => item.id === display.id);
    assert.equal(display.source_content_sha256, source.content_sha256);
    assert.equal(digest(Buffer.from(display.display_base64, 'base64')), display.content_sha256);
    assert.equal(digest(Buffer.from(source.original_base64, 'base64')), source.content_sha256);
    assert.equal(display.method, 'trusted_svg_lossless_png');
    assert.equal(display.content_type, 'image/png');
  }
  assert.equal(fixed.manifest.snapshot_sha256, digest(canonicalJson(fixed.manifest.snapshot)));
  review.saveFinding(finding({ capture_id: 'fixture-capture-02', element_id: 'DUCT-03', previous_revision_id: subsequent.revision_id, rationale: 'Later correction after the snapshot.', annotations: [] }));
  assert.deepEqual(review.getExport(packet.id), fixed);
  assert.throws(() => review.createExport({}, { coverage_rule: { freshness_days: 0 } }), status(400));
  assert.throws(() => review.createExport({}, { arbitrary: true }), status(400));
});
