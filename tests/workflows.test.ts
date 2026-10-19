import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createWorkflows } from '../server/workflows.ts';
import { DomainError } from '../server/domain.ts';
type Json = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const status = (number: number) => (error: unknown) => error instanceof DomainError && error.status === number;
function setup(t: { after: (callback: () => void) => void }) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const ctx: Json = { workspace: 'fixture', data_mode: 'fixture', reviewer: { id: 'fixture-reviewer', name: 'Local demo reviewer' }, project: { id: 'project-1', name: 'Northbank' }, model: { id: 'model-1', version_id: 'v7', elements: [{ external_id: 'D1', label: 'Duct' }, { external_id: 'D2', label: 'Terminal' }, { external_id: 'D3', label: 'Branch' }] }, scope: { scope_id: 'scope-1', revision: 1, trade: 'Ductwork', floor: 'Level 02', zone_id: 'east', element_ids: ['D1', 'D2', 'D3'] }, findings: [], finding_revisions: [], captures: [] };
  const captures = new Map<string, Json>(); const revisions = new Map<string, Json>();
  function addCapture(id: string, day: string | null, precision = day ? 'date' : 'unknown') {
    const capture: Json = { capture_id: id, media_url: `/api/v2/fixture/media/${id}`, capture_ref: { capture_id: id, content_sha256: 'a'.repeat(64), captured_date: day, captured_at: precision === 'timestamp' ? `${day}T10:00:00Z` : null, date_precision: precision, uploaded_at: '2026-10-19T10:00:00Z' } };
    captures.set(id, capture); ctx.captures.push(capture); return capture;
  }
  function addFinding(id: string, capture: Json, element: string, state = 'observed_installed', extras: Json = {}) {
    const finding: Json = { finding_id: `finding-${id}`, revision_id: id, revision: 1, previous_revision_id: null, workspace: 'fixture', project_id: ctx.project.id, capture_ref: copy(capture.capture_ref), model_ref: { model_id: ctx.model.id, version_id: ctx.model.version_id, element_id: element }, scope_ref: { scope_id: ctx.scope.scope_id, revision: 1 }, state, rationale: 'Visible in reviewed source', uncertainty_reason: null, evidence_quality: 'usable', review: { reviewer_id: ctx.reviewer.id, reviewed_at: '2026-10-19T10:00:00Z' }, annotations: [{ id: `annotation-${id}`, x: 0.1, y: 0.1, width: 0.2, height: 0.2, label: 'Reviewed region' }], ...extras };
    revisions.set(id, finding); ctx.finding_revisions.push(finding); ctx.findings.push(finding); return finding;
  }
  const api = createWorkflows({ db, context: () => copy(ctx), getFindingRevision: id => { const value = revisions.get(id); if (!value) throw new DomainError(404, 'Finding unavailable'); return copy(value); }, getCapture: id => { const value = captures.get(id); if (!value) throw new DomainError(404, 'Capture unavailable'); return copy(value); } });
  return { api, db, ctx, addCapture, addFinding, revisions, captures };
}
const record = (overrides: Json = {}): Json => ({ category: 'trade_reported', period_start: '2026-10-08', period_end: '2026-10-19', element_ids: ['D1', 'D2'], quantity: 12, unit: 'm', source: 'Trade statement 12', basis: 'Manual measured length of explicit elements', measurement_method: 'manual_measurement', comparison_key: 'supply-air-run', ...overrides });
const draftInput = (overrides: Json = {}): Json => ({ type: 'rfi', title: 'Clarify terminal connection', description: 'Photograph does not resolve connection.', location: 'Level 02 east wing', requested_action: 'Provide connection detail and a clear viewpoint.', proposed_assignee: 'MEP coordinator', finding_revision_ids: ['revision-1'], ...overrides });

test('packet selection retains exact saved records and their revisions, rejects foreign IDs, and honors explicit omissions', t => {
  const f=setup(t);
  const reported=f.api.saveReconciliation(record());
  const corrected=f.api.saveReconciliation(record({entry_id:reported.entry_id,previous_revision_id:reported.revision_id,quantity:11}));
  f.api.saveReconciliation(record({category:'imagery_supported',quantity:9}));
  const capture=f.addCapture('selected-capture','2026-10-18');f.addFinding('revision-1',capture,'D1');
  const draft=f.api.saveDraft(draftInput());
  const selected=f.api.snapshot({reconciliation_entry_ids:[reported.entry_id],draft_ids:[draft.draft_id]});
  assert.deepEqual(selected.reconciliations,[corrected]);
  assert.deepEqual(selected.reconciliation_revisions,[reported,corrected]);
  assert.equal(selected.drafts.length,1);assert.equal(selected.draft_revisions.length,1);
  assert.equal(selected.reconciliation_summary.comparisons[0].delta,null,'Excluded supported quantities must not leak into a selected snapshot calculation');
  const omitted=f.api.snapshot({reconciliation_entry_ids:[],draft_ids:[]});
  assert.deepEqual(omitted.reconciliations,[]);assert.deepEqual(omitted.drafts,[]);assert.deepEqual(omitted.draft_revisions,[]);
  assert.equal(f.api.bootstrap().drafts.length,1,'Packet selection must not change saved workspace records');
  assert.throws(()=>f.api.snapshot({draft_ids:['foreign-draft']}),status(404));
  assert.throws(()=>f.api.snapshot({reconciliation_entry_ids:[reported.entry_id,reported.entry_id]}),status(400));
  assert.throws(()=>f.api.snapshot({project_id:'foreign'}),status(400));
});

test('manual reconciliation retains unknowns, exact scope, provenance, approval distinction and append history', t => {
  const f = setup(t); const first = f.api.saveReconciliation(record());
  assert.equal(first.revision, 1); assert.equal(first.recorded_by, 'fixture-reviewer'); assert.equal(first.model_ref.version_id, 'v7');
  const second = f.api.saveReconciliation(record({ entry_id: first.entry_id, previous_revision_id: first.revision_id, quantity: 14 }));
  assert.equal(second.revision, 2); assert.equal(second.previous_revision_id, first.revision_id); assert.equal(f.api.bootstrap().reconciliations[0].quantity, 14);
  assert.deepEqual(f.api.snapshot().reconciliation_revisions, [first, second]);
  const unknown = f.api.saveReconciliation(record({ category: 'unresolved', quantity: null, unit: null })); assert.equal(unknown.quantity, null); assert.equal(unknown.unit, null);
  const approved = f.api.saveReconciliation(record({ category: 'approved', approver_name: 'Named reviewer', approval_reference: 'Approval 42' })); assert.equal(approved.authority, 'manually_recorded_approval'); assert.equal(approved.authority_verified, false);
  assert.throws(() => f.api.saveReconciliation(record({ entry_id: first.entry_id, previous_revision_id: first.revision_id })), status(409));
  assert.throws(() => f.api.saveReconciliation(record({ entry_id: 'foreign', previous_revision_id: first.revision_id })), status(404));
});

test('quantity validation rejects unsafe values, absent units or provenance, invalid periods and forged authority', t => {
  const f = setup(t);
  for (const changes of [{ quantity: -1 }, { quantity: Infinity }, { quantity: NaN }, { quantity: '12' }, { quantity: undefined }, { unit: '' }, { source: '' }, { basis: '' }, { period_start: '2026-02-30' }, { period_end: '2026-10-01' }, { element_ids: [] }, { element_ids: ['D1', 'D1'] }, { element_ids: ['foreign'] }, { category: 'approved' }, { category: 'approved', approver_name: 'Reviewer' }, { recorded_by: 'forged' }, { authority_verified: true }, { category: 'automatic' }]) assert.throws(() => f.api.saveReconciliation(record(changes)), status(400));
  const first = f.api.saveReconciliation(record());
  for (const changes of [{ element_ids: ['D1'] }, { category: 'payment' }]) assert.throws(() => f.api.saveReconciliation(record({ entry_id: first.entry_id, previous_revision_id: first.revision_id, ...changes })), status(409));
  assert.equal(f.api.snapshot().reconciliation_revisions.length, 1);
});

test('differences require known quantities and exact unit, scope, period, method and comparison basis', t => {
  const f = setup(t); f.api.saveReconciliation(record()); let support = f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 8 }));
  assert.equal(f.api.bootstrap().reconciliation_summary.comparisons[0].delta, 4);
  for (const changes of [{ unit: 'ft' }, { period_end: '2026-10-18' }, { measurement_method: 'manual_count' }, { comparison_key: 'other' }, { quantity: null }]) {
    support = f.api.saveReconciliation(record({ category: 'imagery_supported', entry_id: support.entry_id, previous_revision_id: support.revision_id, quantity: 8, ...changes }));
    const comparison = f.api.bootstrap().reconciliation_summary.comparisons[0]; assert.equal(comparison.delta, null); assert.equal(comparison.comparable, false);
  }
  const g = setup(t); g.api.saveReconciliation(record()); g.api.saveReconciliation(record({ category: 'imagery_supported', element_ids: ['D1'] })); assert.match(g.api.bootstrap().reconciliation_summary.comparisons[0].reason, /scope/i);
});

test('overlapping comparable rows are never summed and ambiguity suppresses differences', t => {
  const f = setup(t); f.api.saveReconciliation(record()); f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 8 })); f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 9, source: 'Overlapping worksheet' }));
  const summary = f.api.bootstrap().reconciliation_summary; assert.equal(summary.comparisons.length, 2);
  for (const row of summary.comparisons) { assert.equal(row.delta, null); assert.match(row.reason, /overlap/); }
  assert.equal(summary.total_quantity, undefined);
});

test('completion requires explicit matching denominator and documented manual method, separate from coverage', t => {
  const f = setup(t); const denominator = { quantity: 20, unit: 'm', element_ids: ['D2', 'D1'], measurement_method: 'manual_measurement', basis: 'Design length schedule v7' };
  const entry = f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 8, denominator })); assert.equal(f.api.bootstrap().reconciliation_summary.percentages.find((p: Json) => p.entry_id === entry.entry_id).value, 40);
  for (const changes of [{ unit: 'ft' }, { element_ids: ['D1'] }, { measurement_method: 'visual_only' }]) { f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 8, denominator: { ...denominator, ...changes } })); assert.equal(f.api.bootstrap().reconciliation_summary.percentages.at(-1).value, null); }
  f.api.saveReconciliation(record({ category: 'imagery_supported', measurement_method: 'visual_only', denominator: { ...denominator, measurement_method: 'visual_only' } })); assert.equal(f.api.bootstrap().reconciliation_summary.percentages.at(-1).value, null);
  f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 21, denominator })); assert.equal(f.api.bootstrap().reconciliation_summary.percentages.at(-1).value, null);
  assert.throws(() => f.api.saveReconciliation(record({ denominator: { ...denominator, quantity: 0 } })), status(400));
  assert.throws(() => f.api.saveReconciliation(record({ denominator: { ...denominator, element_ids: ['foreign-project-element'] } })), status(400));
});

test('observation summary counts each element once across dates and leaves legacy scope assessments separate', t => {
  const f = setup(t); f.ctx.legacy_assessments = [{ state: 'observed_installed' }];
  const early = f.addCapture('capture-1', '2026-10-08'); const late = f.addCapture('capture-2', '2026-10-15');
  f.addFinding('early', early, 'D1', 'not_observed', { review: { reviewed_at: '2026-10-19T12:00:00Z' } }); f.addFinding('late', late, 'D1', 'observed_installed', { review: { reviewed_at: '2026-10-18T12:00:00Z' } }); f.addFinding('terminal', late, 'D2', 'needs_review');
  const summary = f.api.bootstrap().reconciliation_summary.observations;
  assert.equal(summary.total_elements, 3); assert.equal(summary.observed_installed, 1); assert.equal(summary.needs_review, 1); assert.equal(summary.no_finding, 1); assert.equal(summary.not_observed, 0); assert.equal(summary.elements[0].finding_revision_id, 'late'); assert.equal(summary.installed_quantity, undefined);
});

test('unknown dates and same-day conflicting evidence remain explicit without rewriting findings', t => {
  const f = setup(t); const unknown = f.addCapture('unknown', null); const day = f.addCapture('day', '2026-10-15'); const sameDay = f.addCapture('same-day', '2026-10-15');
  f.addFinding('unknown-revision', unknown, 'D1'); f.addFinding('known-revision', day, 'D1', 'not_observed'); f.addFinding('day-revision', day, 'D2'); f.addFinding('same-day-revision', sameDay, 'D2', 'not_observed');
  const summary = f.api.bootstrap().reconciliation_summary.observations; assert.equal(summary.date_unknown, 1); assert.equal(summary.conflicting_observations, 1); assert.equal(summary.observed_installed, 0); assert.equal(summary.elements[0].state, null); assert.equal(summary.elements[1].state, null); assert.equal(f.revisions.get('unknown-revision')!.state, 'observed_installed');
});

test('local Issue/RFI drafts snapshot exact evidence and annotations with editable immutable history and no submission operation', t => {
  const f = setup(t); const capture = f.addCapture('capture-1', '2026-10-15'); const finding = f.addFinding('revision-1', capture, 'D2', 'needs_review');
  const first = f.api.saveDraft(draftInput()); assert.equal(first.external_submission_enabled, false); assert.equal(first.external_record_id, null); assert.deepEqual(first.evidence[0].finding, finding); assert.deepEqual(first.evidence[0].capture, capture); assert.deepEqual(first.evidence[0].annotations, finding.annotations); assert.equal(first.evidence[0].media.content_sha256, 'a'.repeat(64));
  const second = f.api.saveDraft(draftInput({ draft_id: first.draft_id, previous_revision_id: first.revision_id, title: 'Updated clarification', annotation_ids: ['annotation-revision-1'] })); assert.equal(second.revision, 2); assert.equal(second.previous_revision_id, first.revision_id); assert.deepEqual(f.api.draftHistory(first.draft_id), [first, second]); assert.deepEqual(f.api.draftHistory(first.revision_id), [first, second]); assert.equal(f.api.bootstrap().drafts.length, 1); assert.equal(f.api.snapshot().draft_revisions.length, 2);
  finding.rationale = 'Changed after snapshot'; capture.title = 'Changed after snapshot'; assert.equal(f.api.draftHistory(first.draft_id)[0].evidence[0].finding.rationale, 'Visible in reviewed source'); assert.equal(f.api.draftHistory(first.draft_id)[0].evidence[0].capture.title, undefined);
  assert.throws(() => f.api.saveDraft(draftInput({ draft_id: first.draft_id, previous_revision_id: first.revision_id })), status(409)); assert.throws(() => f.api.saveDraft(draftInput({ draft_id: first.draft_id, previous_revision_id: second.revision_id, type: 'issue' })), status(409)); assert.equal(f.api.saveDraft(draftInput({ type: 'issue' })).type, 'issue'); assert.equal((f.api as Json).submitDraft, undefined);
});

test('draft validation rejects foreign versions/workspaces, changed originals, unrelated annotations and external fields', t => {
  const f = setup(t); const capture = f.addCapture('capture-1', '2026-10-15'); const finding = f.addFinding('revision-1', capture, 'D2', 'needs_review');
  for (const changes of [{ finding_revision_ids: [] }, { finding_revision_ids: ['revision-1', 'revision-1'] }, { annotation_ids: ['unrelated'] }, { external_submission_enabled: true }, { external_record_id: 'remote' }, { title: '' }]) assert.throws(() => f.api.saveDraft(draftInput(changes)), status(400));
  assert.throws(() => f.api.saveDraft(draftInput({ finding_revision_ids: ['missing'] })), status(404)); finding.model_ref.version_id = 'v8'; assert.throws(() => f.api.saveDraft(draftInput()), status(400)); finding.model_ref.version_id = 'v7'; finding.workspace = 'local'; assert.throws(() => f.api.saveDraft(draftInput()), status(400)); finding.workspace = 'fixture'; capture.capture_ref.content_sha256 = 'b'.repeat(64); assert.throws(() => f.api.saveDraft(draftInput()), status(409)); assert.equal(f.api.bootstrap().drafts.length, 0);
});

test('SQLite prevents history mutation and workspace boundaries prevent disclosure', t => {
  const f = setup(t); const capture = f.addCapture('capture-1', '2026-10-15'); f.addFinding('revision-1', capture, 'D2'); f.api.saveReconciliation(record()); const draft = f.api.saveDraft(draftInput());
  for (const sql of ["UPDATE reconciliation_revisions SET record_json='{}'", 'DELETE FROM reconciliation_revisions', "UPDATE local_draft_revisions SET record_json='{}'", 'DELETE FROM local_draft_revisions']) assert.throws(() => f.db.exec(sql), /immutable/);
  f.ctx.workspace = 'local'; assert.deepEqual(f.api.bootstrap().drafts, []); assert.deepEqual(f.api.bootstrap().reconciliations, []); assert.throws(() => f.api.draftHistory(draft.draft_id), status(404)); f.ctx.workspace = 'live'; assert.throws(() => f.api.bootstrap(), status(403)); assert.throws(() => f.api.saveReconciliation(record()), status(403));
});

test('unconfigured local workspace loads without records and rejects premature workflow creation', t => {
  const f = setup(t); f.ctx.workspace = 'local'; f.ctx.project = null; f.ctx.model = null; f.ctx.scope = null;
  assert.deepEqual(f.api.bootstrap().reconciliations, []); assert.equal(f.api.bootstrap().reconciliation_summary.observations.total_elements, 0); assert.throws(() => f.api.saveReconciliation(record()), status(409)); assert.throws(() => f.api.saveDraft(draftInput()), status(409));
});

test('reporting period filters rows exactly and excludes future observations while preserving unknown dates', t => {
  const f = setup(t);
  f.api.saveReconciliation(record()); f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: 8 }));
  f.api.saveReconciliation(record({ period_start: '2026-10-20', period_end: '2026-10-25', quantity: 20 }));
  const inside = f.addCapture('inside', '2026-10-15'); const after = f.addCapture('future', '2026-10-22'); const unknown = f.addCapture('undated', null);
  f.addFinding('inside-revision', inside, 'D1', 'not_observed'); f.addFinding('future-revision', after, 'D1', 'observed_installed'); f.addFinding('unknown-revision', unknown, 'D2');
  const filtered = f.api.bootstrap({ period_start: '2026-10-08', period_end: '2026-10-19' });
  assert.equal(filtered.reconciliations.length, 2); assert.equal(filtered.reconciliation_summary.comparisons[0].delta, 4);
  assert.deepEqual(filtered.reconciliation_summary.reporting_period, { period_start: '2026-10-08', period_end: '2026-10-19' });
  const observations = filtered.reconciliation_summary.observations;
  assert.equal(observations.elements[0].finding_revision_id, 'inside-revision'); assert.equal(observations.not_observed, 1); assert.equal(observations.observed_installed, 0); assert.equal(observations.date_unknown, 1);
  assert.equal(f.api.snapshot().reconciliation_revisions.length, 3); assert.equal(f.api.snapshot().reconciliation_summary.reporting_period, null);
  assert.equal(f.api.bootstrap().reconciliation_summary.observations.elements[0].finding_revision_id, 'future-revision');
  for (const filters of [{ period_start: '2026-10-01' }, { period_start: '2026-10-20', period_end: '2026-10-01' }, { period_start: '2026-02-30', period_end: '2026-10-19' }, { category: 'payment' }]) assert.throws(() => f.api.bootstrap(filters), status(400));
});

test('very large finite quantities retain bounded finite percentages', t => {
  const f = setup(t);
  f.api.saveReconciliation(record({ category: 'imagery_supported', quantity: Number.MAX_VALUE / 2, denominator: { quantity: Number.MAX_VALUE, unit: 'm', element_ids: ['D1', 'D2'], measurement_method: 'manual_measurement', basis: 'Explicit finite denominator' } }));
  assert.equal(f.api.bootstrap().reconciliation_summary.percentages[0].value, 50);
});

test('omitted annotation selection includes all, explicit empty selection includes none and integrity is not overstated', t => {
  const f = setup(t); const capture = f.addCapture('capture-1', '2026-10-15'); capture.media_status = 'changed'; f.addFinding('revision-1', capture, 'D2');
  const all = f.api.saveDraft(draftInput()); const none = f.api.saveDraft(draftInput({ annotation_ids: [] }));
  assert.equal(all.evidence[0].annotations.length, 1); assert.deepEqual(none.evidence[0].annotations, []); assert.deepEqual(none.annotation_ids, []);
  assert.equal(none.evidence[0].media.integrity_status_at_draft, 'changed');
  assert.equal(none.evidence[0].finding.annotations.length, 1); // exact source revision retained separately from selected overlay
  assert.equal(none.evidence[0].media.original_verified, undefined);
});

test('manual records may lack a comparison group while differences remain unknown', t => {
  const f = setup(t);
  const report = f.api.saveReconciliation(record({ comparison_key: '' }));
  f.api.saveReconciliation(record({ category: 'imagery_supported', comparison_key: null, quantity: 8 }));
  assert.equal(report.comparison_key, null);
  assert.equal(f.api.bootstrap().reconciliation_summary.comparisons[0].delta, null);
  assert.match(f.api.bootstrap().reconciliation_summary.comparisons[0].reason, /comparison basis is missing/);
});
