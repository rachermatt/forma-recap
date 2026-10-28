import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../server/domain.ts';
import { createScopeOperations } from '../server/scope-operations.ts';

type Json = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const status = (number: number) => (error: unknown) => error instanceof DomainError && error.status === number;
function setup(t: { after: (work: () => void) => void }, noModel = false, templates = new Map<string,Json>()) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const ctx: Json = { workspace: 'local', data_mode: 'local', project: { id: 'local-project', name: 'Test site' }, reviewer: { id: 'local-reviewer', name: 'Local reviewer', identity_basis: 'self_asserted_local_identity' }, model: noModel ? null : { id: 'model-a', version_id: 'v1', elements: [{ external_id: 'D1', label: 'Duct' }, { external_id: 'D2', label: 'Terminal' }] }, scope: { scope_id: 'scope-a', revision: 1, trade: 'Ductwork', floor: 'Level 02', element_ids: noModel ? [] : ['D1', 'D2'] }, findings: [], finding_revisions: [], tasks: [], task_events: [], reconciliations: [], drafts: [], exports: [], captures: [], reconciliation_summary: { comparisons: [] } };
  const captures = new Map<string, Json>();
  function addCapture(id: string, day: string | null, precision = day ? 'date' : 'unknown') {
    const capture = { capture_id: id, workspace: ctx.workspace, project_id: ctx.project.id, title: id, media_status: 'verified', media_url: `/api/v2/local/media/${id}`, capture_ref: { capture_id: id, content_sha256: id.padEnd(64, 'a').slice(0, 64), captured_date: day, captured_at: precision === 'timestamp' ? `${day}T09:00:00-04:00` : null, date_precision: precision, original_timezone: precision === 'timestamp' ? 'America/New_York' : null, uploaded_at: '2026-10-20T09:00:00Z' } };
    captures.set(id, capture); ctx.captures.push(capture); return capture;
  }
  function addFinding(id: string, capture: Json, element = 'D1', state = 'observed_installed') {
    const finding = { finding_id: `finding-${id}`, revision_id: id, revision: 1, previous_revision_id: null, workspace: ctx.workspace, project_id: ctx.project.id, capture_ref: copy(capture.capture_ref), model_ref: { model_id: ctx.model.id, version_id: ctx.model.version_id, element_id: element }, scope_ref: { scope_id: ctx.scope.scope_id, revision: 1 }, state, rationale: 'Bounded observation', uncertainty_reason: state === 'needs_review' ? 'Connection obscured' : null, evidence_quality: 'usable', review: { reviewer_id: ctx.reviewer.id, reviewed_at: '2026-10-21T09:00:00Z' }, annotations: [] };
    ctx.findings.push(finding); ctx.finding_revisions.push(copy(finding)); return finding;
  }
  const api = createScopeOperations({ db, context: () => copy(ctx), getReviewTemplate:id=>{const template=templates.get(id);if(!template)throw new DomainError(404,'Template unavailable');return copy(template);}, getCapture: id => { const capture = captures.get(id); if (!capture) throw new DomainError(404, 'Capture unavailable'); return copy(capture); } });
  return { api, db, ctx, captures, addCapture, addFinding };
}
const itemInput = (changes: Json = {}): Json => ({ kind: 'drawing', label: 'Terminal zone', description: 'Defined scope on the mechanical plan', location: 'Level 02 east', trade: 'Ductwork', references: [{ kind: 'drawing', source_id: 'M-201', version: 'Rev A', external_id: 'region-4', validation: 'unverified' }], unit: null, denominator: null, ...changes });
const findingInput = (id: string, capture: string, changes: Json = {}): Json => ({ item_id: id, capture_id: capture, state: 'needs_review', rationale: 'The connection is obscured in this source view.', uncertainty_reason: 'Need a clear close-up before concealment.', evidence_quality: 'limited', annotations: [{ label: 'Connection area', x: 0.1, y: 0.2, width: 0.3, height: 0.25 }], ...changes });
const mappingInput = (source: string[], target: string[], changes: Json = {}): Json => ({ kind: 'replaced', source_item_ids: source, target_item_ids: target, from_reference: { kind: 'drawing', source_id: 'M-201', version: 'Rev A' }, to_reference: { kind: 'drawing', source_id: 'M-201', version: 'Rev B' }, status: 'proposed', reason: 'Revised scope requires identity and denominator review.', ...changes });

test('drawing/custom scope can retain independent human findings without inventing model references', t => {
  const f = setup(t, true); const capture = f.addCapture('photo-a', '2026-10-19'); const original = copy(capture);
  const item = f.api.saveItem(itemInput()); const other = f.api.saveItem(itemInput({ kind: 'custom', label: 'Nearby unassessed scope', references: [] }));
  const finding = f.api.saveFinding(findingInput(item.item_id, capture.capture_id));
  assert.equal(item.model_ref, null); assert.equal(finding.model_ref, null); assert.equal(finding.item_ref.item_id, item.item_id);
  assert.equal(finding.review.reviewer_id, 'local-reviewer'); assert.equal(finding.annotations[0].original_media_unchanged, true);
  assert.deepEqual(f.captures.get(capture.capture_id), original); assert.equal(f.api.dossier(other.item_id).findings.length, 0);
  assert.equal(f.api.dossier(item.item_id).findings[0].state, 'needs_review'); assert.equal(f.api.dossier(item.item_id).installation_quantity, null);
});

test('stable identities survive rename and denominator revisions; duplicate imports and stale edits fail', t => {
  const f = setup(t, true); const first = f.api.saveItem(itemInput({ import_key: 'drawing:M201:A:region4' }));
  const second = f.api.saveItem(itemInput({ item_id: first.item_id, previous_revision_id: first.revision_id, label: 'Renamed terminal zone', import_key: first.import_key, unit: 'm', denominator: { quantity: 10, unit: 'm', basis: 'Length from reviewed takeoff', source: 'Takeoff Rev A', measurement_method: 'manual_measurement' } }));
  assert.equal(second.item_id, first.item_id); assert.equal(second.revision, 2); assert.equal(second.denominator.quantity, 10); assert.equal(first.denominator, null);
  assert.equal(f.api.dossier(first.item_id).item_revisions.length, 2);
  const renamed = f.api.saveItem({ item_id: second.item_id, previous_revision_id: second.revision_id, kind: second.kind, label: 'Label-only correction', location: second.location, trade: second.trade });
  assert.deepEqual(renamed.references, second.references); assert.deepEqual(renamed.denominator, second.denominator); assert.equal(renamed.import_key, first.import_key);
  assert.throws(() => f.api.saveItem(itemInput({ import_key: first.import_key })), status(409));
  assert.throws(() => f.api.saveItem(itemInput({ item_id: first.item_id, previous_revision_id: first.revision_id })), status(409));
  assert.throws(() => f.api.saveItem(itemInput({ unit: 'm', denominator: { quantity: 0, unit: 'm', basis: 'Invalid', source: 'Manual', measurement_method: 'manual_measurement' } })), status(400));
});

test('model-backed read views retain exact historic source references through a label change', t => {
  const f = setup(t); const capture = f.addCapture('photo-a', '2026-10-08'); const old = f.addFinding('old-revision', capture);
  const item = f.api.getItem('element:D1'); assert.equal(item.revision_id, 'source:scope-a:1:v1:D1');
  const renamed = f.api.saveItem({ ...itemInput(), kind: 'model', item_id: item.item_id, previous_revision_id: item.revision_id, label: 'Main supply duct', references: item.references });
  assert.equal(renamed.item_id, 'element:D1'); assert.equal(renamed.revision, 2);
  const dossier = f.api.dossier(item.item_id); assert.equal(dossier.finding_revisions[0].model_ref.version_id, 'v1'); assert.equal(dossier.finding_revisions[0].revision_id, old.revision_id);
  assert.deepEqual(f.ctx.findings[0], old); assert.equal(dossier.item_revisions.length, 2);
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, capture.capture_id)), status(409));
  assert.throws(() => f.api.saveItem({ ...itemInput(), kind: 'model', item_id: renamed.item_id, previous_revision_id: renamed.revision_id, references: [{ kind: 'model', source_id: 'model-a', version: 'v2', external_id: 'D1' }] }), status(409));
});

test('finding correction appends exact source/item snapshots and validates annotations and relationships', t => {
  const f = setup(t, true); const a = f.addCapture('photo-a', '2026-10-08'); f.addCapture('photo-b', '2026-10-19', 'timestamp');
  const item = f.api.saveItem(itemInput()); const first = f.api.saveFinding(findingInput(item.item_id, a.capture_id));
  f.api.saveItem(itemInput({ item_id: item.item_id, previous_revision_id: item.revision_id, label: 'Revised scope label' }));
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, 'photo-b', { item_revision_id: item.revision_id })), status(409));
  const second = f.api.saveFinding(findingInput(item.item_id, a.capture_id, { finding_id: first.finding_id, previous_revision_id: first.revision_id, rationale: 'More precise bounded explanation.', annotations: first.annotations.map(({ id, label, x, y, width, height }: Json) => ({ id, label, x, y, width, height })) }));
  assert.equal(second.revision, 2); assert.deepEqual(second.capture_ref, first.capture_ref); assert.equal(f.api.dossier(item.item_id).finding_revisions.length, 2);
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, a.capture_id)), status(409));
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, 'photo-b', { finding_id: first.finding_id, previous_revision_id: second.revision_id })), status(409));
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, 'photo-b', { annotations: [{ label: 'Outside', x: 0.9, y: 0.2, width: 0.3, height: 0.1 }] })), status(400));
  assert.throws(() => f.api.saveFinding(findingInput(item.item_id, 'photo-b', { annotations: first.annotations.map(({ id, label, x, y, width, height }: Json) => ({ id, label, x, y, width, height })) })), status(400));
  f.captures.get('photo-b')!.media_status = 'unavailable_or_changed'; assert.throws(() => f.api.saveFinding(findingInput(item.item_id, 'photo-b')), status(409));
});

test('version mappings preserve both proposals and decisions without moving evidence or transferring quantity', t => {
  const f = setup(t); const photo = f.addCapture('photo-a', '2026-10-08'); f.addFinding('finding-1', photo); const before = copy(f.ctx.findings);
  const target = f.api.saveItem(itemInput()); f.ctx.reconciliations.push({ entry_id: 'quantity-1', element_ids: ['D1'], quantity: 9 });
  const proposed = f.api.saveMapping(mappingInput(['element:D1'], [target.item_id])); assert.equal(proposed.impact.finding_revision_ids[0], 'finding-1'); assert.equal(proposed.impact.quantity_record_ids[0], 'quantity-1');
  const confirmed = f.api.saveMapping(mappingInput(['element:D1'], [target.item_id], { mapping_id: proposed.mapping_id, previous_revision_id: proposed.revision_id, status: 'confirmed', reason: 'Confirmed identity link; remeasure the denominator separately.' }));
  assert.equal(confirmed.quantity_transfer, 'none'); assert.equal(confirmed.baseline_review_required, true); assert.deepEqual(f.ctx.findings, before); assert.equal(f.api.snapshot().mappings.length, 2);
  assert.throws(() => f.api.saveMapping(mappingInput(['element:D2'], [target.item_id], { mapping_id: proposed.mapping_id, previous_revision_id: confirmed.revision_id, status: 'rejected' })), status(409));
  const rejectedProposal = f.api.saveMapping(mappingInput(['element:D2'], [target.item_id])); const rejected = f.api.saveMapping(mappingInput(['element:D2'], [target.item_id], { mapping_id: rejectedProposal.mapping_id, previous_revision_id: rejectedProposal.revision_id, status: 'rejected', reason: 'Ambiguous identity; leave original records usable.' })); assert.equal(rejected.status, 'rejected'); assert.equal(rejected.baseline_review_required, false);
  assert.throws(() => f.api.saveMapping(mappingInput(['element:D1'], [target.item_id], { kind: 'split' })), status(400));
});

test('queue distinguishes missing, stale, unresolved and supplied-but-unreviewed causes without quantities', t => {
  const f = setup(t); const old = f.addCapture('photo-old', '2026-10-01'); const newer = f.addCapture('photo-new', '2026-10-20'); f.addFinding('old', old, 'D1', 'needs_review'); f.addFinding('new', newer, 'D1');
  f.ctx.tasks.push({ task_id: 'task-a', element_id: 'D1', assignee: 'Field lead', due_date: '2026-10-19', status: 'awaiting_reassessment', review_status: 'awaiting_reassessment', new_capture_id: newer.capture_id });
  const queue = f.api.queue({ as_of_date: '2026-10-27', freshness_days: 3 });
  assert.equal(queue.exceptions.filter((row: Json) => row.category === 'missing_evidence').length, 1); assert.equal(queue.exceptions.filter((row: Json) => row.category === 'outdated_evidence').length, 1); assert.equal(queue.exceptions.some((row: Json) => row.category === 'unresolved_finding'), false);
  assert.equal(queue.exceptions.filter((row: Json) => row.category === 'awaiting_reassessment').length, 1); assert.equal(queue.exceptions.some((row: Json) => row.category === 'overdue_capture'), false);
  assert.equal(new Set(queue.exceptions.map((row: Json) => row.exception_id)).size, queue.exceptions.length); assert.ok(queue.exceptions.every((row: Json) => row.quantity === null));
  const ownerFiltered = f.api.queue({ as_of_date: '2026-10-27', owner: 'field lead' }); assert.equal(ownerFiltered.exceptions.length, 1);
  f.ctx.tasks[0] = { ...f.ctx.tasks[0], status: 'closed', review_status: 'reassessed' }; assert.equal(f.api.queue({ as_of_date: '2026-10-27' }).exceptions.some((row: Json) => row.category === 'awaiting_reassessment'), false); assert.equal(f.ctx.finding_revisions.length, 2);
});

test('date-only conflicts and unknown capture dates abstain from chronological conclusions', t => {
  const f = setup(t); const a = f.addCapture('photo-a', '2026-10-19'); const b = f.addCapture('photo-b', '2026-10-19'); f.addFinding('a', a, 'D1'); f.addFinding('b', b, 'D1', 'not_observed');
  assert.equal(f.api.queue({ as_of_date: '2026-10-20' }).exceptions.some((row: Json) => row.category === 'conflicting_findings'), true);
  const unknown = f.addCapture('photo-unknown', null); f.addFinding('unknown', unknown, 'D2');
  assert.equal(f.api.queue({ as_of_date: '2026-10-20' }).exceptions.some((row: Json) => row.category === 'unknown_capture_date'), true);
  const timeline = f.api.dossier('element:D2').timeline[0]; assert.equal(timeline.captured_at, null); assert.equal(timeline.captured_date, null); assert.equal(timeline.date_precision, 'unknown'); assert.match(f.api.dossier('element:D2').chronology_rule, /not.*installation|never.*installation/);
});

test('queue keeps comparable discrepancies distinct from unknown quantities and filters exact periods', t => {
  const f = setup(t); f.ctx.reconciliation_summary.comparisons = [
    { reported_entry_id: 'reported-a', supported_entry_id: 'supported-a', comparable: true, delta: 3, unit: 'm', element_ids: ['D1'], period_start: '2026-10-01', period_end: '2026-10-19' },
    { reported_entry_id: 'reported-b', supported_entry_id: null, comparable: false, delta: null, reason: 'Quantity is unknown.', unit: 'm', element_ids: ['D2'], period_start: '2026-10-01', period_end: '2026-10-19' },
    { reported_entry_id: 'reported-b', supported_entry_id: 'another', comparable: false, delta: null, reason: 'Overlapping records.', unit: 'm', element_ids: ['D2'], period_start: '2026-10-01', period_end: '2026-10-19' },
  ];
  const q = f.api.queue({ period_start: '2026-10-01', period_end: '2026-10-19' }); const rows = q.exceptions.filter((row: Json) => row.category.startsWith('quantity_'));
  assert.equal(rows.length, 2); assert.equal(rows.find((row: Json) => row.category === 'quantity_discrepancy').quantity, 3); assert.equal(rows.find((row: Json) => row.category === 'quantity_unresolved').quantity, null);
  assert.equal(f.api.queue({ period_start: '2026-11-01', period_end: '2026-11-30' }).exceptions.some((row: Json) => row.category.startsWith('quantity_')), false);
  assert.throws(() => f.api.queue({ period_start: '2026-10-19', period_end: '2026-10-01' }), status(400));
});

test('explicit conflict resolution retains independent positions and both decision revisions', t => {
  const f = setup(t); const a = f.addCapture('photo-a', '2026-10-19'); const b = f.addCapture('photo-b', '2026-10-20'); f.addFinding('a', a); f.addFinding('b', b, 'D1', 'needs_review');
  const conflict = f.api.saveConflict({ item_id: 'element:D1', finding_revision_ids: ['a', 'b'], status: 'open', reason: 'Possible rework or viewpoint difference requires investigation.' });
  assert.ok(f.api.queue().exceptions.some((row: Json) => row.category === 'explicit_conflict'));
  const resolved = f.api.saveConflict({ conflict_id: conflict.conflict_id, previous_revision_id: conflict.revision_id, item_id: 'element:D1', finding_revision_ids: ['a', 'b'], status: 'resolved', reason: 'Reviewed both views; installation state remains bounded to each original capture.' });
  assert.equal(resolved.revision, 2); assert.equal(f.api.dossier('element:D1').conflicts.length, 2); assert.equal(f.ctx.findings.length, 2); assert.equal(f.api.queue().exceptions.some((row: Json) => row.category === 'explicit_conflict'), false);
  assert.throws(() => f.api.saveConflict({ item_id: 'element:D2', finding_revision_ids: ['a'], status: 'open', reason: 'Wrong item' }), status(404));
});

test('scope access and immutable history fail closed across project/workspace boundaries', t => {
  const f = setup(t, true); f.addCapture('photo-a', '2026-10-19'); const item = f.api.saveItem(itemInput()); const finding = f.api.saveFinding(findingInput(item.item_id, 'photo-a'));
  assert.throws(() => f.db.prepare('UPDATE scope_item_revisions SET record_json=? WHERE revision_id=?').run('{}', item.revision_id), /immutable/);
  assert.throws(() => f.db.prepare('DELETE FROM scope_finding_revisions WHERE revision_id=?').run(finding.revision_id), /immutable/);
  f.ctx.project.id = 'other-project'; assert.equal(f.api.bootstrap().items.length, 0); assert.throws(() => f.api.getItem(item.item_id), status(404));
  f.ctx.workspace = 'live'; assert.throws(() => f.api.bootstrap(), status(403));
  f.ctx.workspace = 'local'; f.ctx.project = null; assert.equal(f.api.bootstrap().queue.permission_state, 'project_not_configured'); assert.throws(() => f.api.saveItem(itemInput()), status(409));
  assert.throws(() => f.api.saveItem(itemInput({ project_id: 'forged' })), status(400));
});


test('trade criteria templates retain an exact version without assigning an observation or crossing scope', t => {
  const templates=new Map<string,Json>();const f=setup(t,true,templates);const cap=f.addCapture('criteria-photo','2026-10-25');const item=f.api.saveItem(itemInput());
  const criteria={workspace:'local',project_id:'local-project',trade:'Ductwork',revision_id:'criteria-v1',revision:1,visibility_criteria:'Coupling and clearance visible',viewpoint:'Perpendicular close-up'};templates.set(criteria.revision_id,criteria);
  const finding=f.api.saveFinding(findingInput(item.item_id,cap.capture_id,{review_template_revision_id:criteria.revision_id}));
  assert.equal(finding.state,'needs_review');assert.equal(finding.review_template_ref.revision_id,'criteria-v1');criteria.visibility_criteria='Changed later';assert.equal(finding.review_template_ref.visibility_criteria,'Coupling and clearance visible');
  templates.set('foreign',{...criteria,revision_id:'foreign',project_id:'other-project'});assert.throws(()=>f.api.saveFinding(findingInput(item.item_id,cap.capture_id,{finding_id:finding.finding_id,previous_revision_id:finding.revision_id,review_template_revision_id:'foreign'})),status(400));
});
