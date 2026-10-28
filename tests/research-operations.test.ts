import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createResearchOperations, researchDocumentation } from '../server/research-operations.ts';
import { DomainError } from '../server/domain.ts';

type Json = Record<string, any>;
const status = (code: number) => (error: unknown) => error instanceof DomainError && error.status === code;
function setup(t: { after: (callback: () => void) => void }) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const item = { item_id: 'element:D1', workspace: 'fixture', project_id: 'p1', label: 'Duct', revision_id: 'scope-revision-1', revision: 1, model_ref: { element_id: 'D1', model_id: 'm1', version_id: 'v1' } };
  const capture = (id: string, sha: string) => ({ capture_id: id, workspace: 'fixture', project_id: 'p1', capture_ref: { capture_id: id, content_sha256: sha.repeat(64), captured_at: null, captured_date: null, date_precision: 'unknown', uploaded_at: '2026-10-27T12:00:00Z' } });
  const captures = [capture('c1', 'a'), capture('c2', 'b'), capture('c3', 'c')];
  const finding = { finding_id: 'f1', revision_id: 'fr1', revision: 1, workspace: 'fixture', project_id: 'p1', model_ref: { element_id: 'D1', model_id: 'm1', version_id: 'v1' }, capture_ref: captures[0].capture_ref, state: 'needs_review' };
  const ctx: Json = { workspace: 'fixture', data_mode: 'fixture', project: { id: 'p1' }, reviewer: { id: 'fixture-reviewer' }, items: [item], captures, findings: [finding], finding_revisions: [finding], drafts: [{ draft_id: 'd1', revision_id: 'dr1', revision: 1, type: 'rfi', workspace: 'fixture', project_id: 'p1', title: 'Terminal query', external_record_id: null, evidence: [{ finding }] }] };
  const api = createResearchOperations({ db, context: () => ctx, getItem: id => ctx.items.find((i: Json) => i.item_id === id) ?? (() => { throw new DomainError(404, 'Item missing'); })(), getCapture: id => ctx.captures.find((c: Json) => c.capture_id === id) ?? (() => { throw new DomainError(404, 'Capture missing'); })() });
  return { db, ctx, api, item, finding, captures };
}
const protocol = () => ({ name: 'Duct terminal protocol', intended_use: 'Identify a visible duct separately from a terminal; no acceptance or installed quantities.', permission_basis: 'Authorized synthetic source only', ground_truth_process: 'Independent labels and physical identity from declared reference; hold-out split before tuning.', minimum_held_out: 2, thresholds: { classification_accuracy: .9, identity_accuracy: .9, stage_accuracy: .9, measurement_relative_error: .1 } });
const truth = (physical = 'duct-A', quantity: number | null = null, unit: string | null = null) => ({ object_class: 'duct', physical_item_id: physical, stage: 'installed_visible', visible: true, quantity, unit });
function sample(experiment: Json, capture = 'c1', physical = 'duct-A', extras: Json = {}) { return { experiment_id: experiment.record_id, capture_id: capture, item_id: 'element:D1', split: 'held_out', ground_truth: truth(physical), ground_truth_basis: 'Independently labeled synthetic test; unknown date retained', ...extras }; }
function proposal(sample: Json, extras: Json = {}) { return { case_id: sample.record_id, run_id: 'named-test-run-1', source: 'manual_experiment', ...sample.ground_truth, alignment_quality: 'unverified', identity_confidence: null, visibility_confidence: null, measurement_confidence: null, abstained: false, reason: 'Synthetic protocol test output only; no recognition model is connected.', ...extras }; }

test('capability notes cannot promote authentication, reads, writes or attachments to verified', t => {
  const { api } = setup(t);
  const input = { service: 'issues', operation: 'create', documentation_url: researchDocumentation[0].documentation_url, required_permissions: 'Create with current user', notes: 'No authorized test project', observed_result: 'not_tested' };
  const record = api.saveCapability(input); assert.equal(record.live_write_verified, false); assert.equal(record.external_submission_enabled, false);
  assert.throws(() => api.saveCapability({ ...input, live_write_verified: true }), status(400));
  assert.throws(() => api.saveCapability({ ...input, observed_result: 'success' }), status(400));
  assert.throws(() => api.saveCapability({ ...input, documentation_url: 'https://autodesk.com.attacker.example/guide' }), status(400));
  assert.throws(() => api.saveCapability({ ...input, documentation_url: 'https://user:secret@aps.autodesk.com/guide' }), status(400));
  for (const service of api.bootstrap().documentation) { assert.equal(service.live_read_verified, false); assert.equal(service.live_write_verified, false); }
});

test('local asset proposals retain exact findings, preserve revisions, reject duplicates and flag later corrections', t => {
  const { api, ctx, finding } = setup(t); const input = { item_id: 'element:D1', finding_revision_ids: ['fr1'], target_project_id: 'external-project-reference', asset_reference: 'asset-A', proposed_status: 'Installation observed — proposed', mapping_status: 'unresolved', rationale: 'Identity still ambiguous; do not update an Autodesk record.' };
  const first = api.saveAssetProposal(input); assert.equal(first.external_record_id, null); assert.equal(first.external_submission_enabled, false); assert.equal(first.mapping_status, 'unresolved');
  assert.throws(() => api.saveAssetProposal(input), status(409));
  assert.throws(() => api.saveAssetProposal({ ...input, external_record_id: 'fabricated' }), status(400));
  const second = api.saveAssetProposal({ ...input, proposal_id: first.proposal_id, previous_revision_id: first.record_id, mapping_status: 'confirmed', rationale: 'Reviewer confirmed identity from source register; destination remains unverified.' });
  assert.equal(second.revision, 2); assert.equal(api.bootstrap().asset_proposal_history.length, 2);
  assert.throws(() => api.saveAssetProposal({ ...input, proposal_id: first.proposal_id, previous_revision_id: first.record_id }), status(409));
  ctx.findings = [{ ...finding, revision_id: 'fr2', revision: 2 }]; ctx.finding_revisions.push(ctx.findings[0]);
  assert.equal(api.bootstrap().asset_proposals[0].needs_review, true); assert.equal(api.bootstrap().asset_proposals[0].findings[0].revision_id, 'fr1');
});

test('experimental sources keep exact hashes and unknown dates; train/held-out leaks and duplicate cases are rejected', t => {
  const { api } = setup(t); const experiment = api.saveExperiment(protocol()); const training = api.saveCase(sample(experiment, 'c1', 'duct-A', { split: 'training' }));
  assert.equal(training.capture_ref.captured_at, null); assert.equal(training.capture_ref.date_precision, 'unknown');
  assert.throws(() => api.saveCase(sample(experiment, 'c1', 'duct-B')), status(409));
  assert.throws(() => api.saveCase(sample(experiment, 'c2', 'duct-A')), status(409));
  const held = api.saveCase(sample(experiment, 'c2', 'duct-B')); assert.equal(held.split, 'held_out');
  assert.throws(() => api.saveCase(sample(experiment, 'c2', 'duct-B')), status(409));
  assert.throws(() => api.saveExperiment({ ...protocol(), experiment_id: experiment.record_id }), status(400));
  assert.equal(api.bootstrap().experiments[0].thresholds.classification_accuracy, .9);
});

test('metric ground truth and proposals require an explicit calibrated unit; count and unknown remain distinct', t => {
  const { api } = setup(t), experiment = api.saveExperiment(protocol());
  assert.throws(() => api.saveCase(sample(experiment, 'c1', 'duct-A', { ground_truth: truth('duct-A', 3, 'm') })), status(400));
  const calibrated = api.saveCase(sample(experiment, 'c1', 'duct-A', { ground_truth: truth('duct-A', 3, 'm'), calibration: { method: 'known_dimensions', basis: 'Independent measured synthetic reference', unit: 'm', independently_validated: true } }));
  assert.equal(calibrated.calibration.verifies_project_registration, false);
  assert.throws(() => api.saveProposal(proposal(calibrated, { unit: 'ft' })), status(400));
  const unknownCase = api.saveCase(sample(experiment, 'c2', 'duct-B'));
  assert.throws(() => api.saveProposal(proposal(unknownCase, { quantity: 4, unit: 'm' })), status(400));
  assert.throws(() => api.saveProposal(proposal(unknownCase, { alignment_quality: 'declared_calibrated' })), status(400));
  const counts = api.saveCase(sample(experiment, 'c3', 'duct-C', { ground_truth: truth('duct-C', 0, 'count') })); assert.equal(counts.ground_truth.quantity, 0);
});

test('proposal rejection/edit/abstention append decisions and never alter findings or approved quantities', t => {
  const { api, ctx } = setup(t), before = JSON.stringify(ctx); const experiment = api.saveExperiment(protocol()), held = api.saveCase(sample(experiment));
  const first = api.saveProposal(proposal(held));
  const rejected = api.saveDecision({ proposal_id: first.record_id, decision: 'reject', rationale: 'Physical identity unsupported.' });
  const edited = api.saveDecision({ proposal_id: first.record_id, decision: 'edit', rationale: 'Independent reviewer cannot determine this class.', corrections: { ...truth(), object_class: 'cannot_determine', quantity: null, unit: null } });
  assert.equal(rejected.creates_saved_finding, false); assert.equal(edited.creates_approved_quantity, false); assert.equal(JSON.stringify(ctx), before);
  assert.equal(api.bootstrap().proposals[0].object_class, 'duct'); assert.equal(api.bootstrap().decisions.length, 2);
  const abstention = api.saveProposal(proposal(held, { run_id: 'run-abstain', abstained: true, object_class: 'cannot_determine', stage: 'obscured' }));
  assert.throws(() => api.saveDecision({ proposal_id: abstention.record_id, decision: 'accept', rationale: 'Cannot accept an unsupported answer.' }), status(400));
  assert.throws(() => api.saveProposal(proposal(held)), status(409));
});

test('evaluation keeps missing and abstained cases in denominators, excludes tuning, and separates metrics', t => {
  const { api } = setup(t), experiment = api.saveExperiment(protocol());
  const first = api.saveCase(sample(experiment, 'c1', 'A')), second = api.saveCase(sample(experiment, 'c2', 'B'));
  const training = api.saveCase(sample(experiment, 'c3', 'C', { split: 'training' }));
  api.saveProposal(proposal(first)); api.saveProposal(proposal(training));
  const result = api.evaluate({ experiment_id: experiment.record_id });
  assert.equal(result.held_out_cases, 2); assert.deepEqual(result.metrics.classification.correct, 1); assert.equal(result.metrics.classification.eligible, 2); assert.equal(result.metrics.classification.value, .5);
  assert.equal(result.metrics.measurement.mean_relative_error, null); assert.equal(result.metrics.alignment.value, null); assert.equal(result.production_enabled, false); assert.equal(result.ai_accuracy_claim_supported, false);
  api.saveProposal(proposal(second, { abstained: true, object_class: 'cannot_determine', physical_item_id: null }));
  const withAbstain = api.evaluate({ experiment_id: experiment.record_id }); assert.equal(withAbstain.abstained_cases, 1); assert.equal(withAbstain.metrics.classification.value, .5);
  assert.equal(result.proposed_cases, 1, 'Earlier evaluation snapshot remains unchanged.');
});

test('one explicit run is required and calibrated measurements do not aggregate duplicate installed scope', t => {
  const { api } = setup(t); const experiment = api.saveExperiment(protocol());
  const cal = { method: 'known_dimensions', basis: 'Independent reference for each held-out synthetic case', unit: 'm', independently_validated: true };
  const first = api.saveCase(sample(experiment, 'c1', 'same-heldout-item', { ground_truth: truth('same-heldout-item', 10, 'm'), calibration: cal }));
  const second = api.saveCase(sample(experiment, 'c2', 'same-heldout-item', { ground_truth: truth('same-heldout-item', 10, 'm'), calibration: cal }));
  api.saveProposal(proposal(first, { quantity: 11 })); api.saveProposal(proposal(second, { quantity: 9 })); api.saveProposal(proposal(first, { run_id: 'different-run', quantity: 10 }));
  assert.throws(() => api.evaluate({ experiment_id: experiment.record_id }), status(400));
  const result = api.evaluate({ experiment_id: experiment.record_id, run_id: 'named-test-run-1' }); assert.equal(result.metrics.measurement.mean_relative_error, .1); assert.equal(result.metrics.measurement.mean_absolute_error, null); assert.equal('total_quantity' in result.metrics.measurement, false);
  assert.throws(() => api.evaluate({ experiment_id: experiment.record_id, run_id: 'missing' }), status(404));
});

test('records are immutable and inaccessible across projects, workspaces and live mode', t => {
  const { api, db, ctx } = setup(t); const experiment = api.saveExperiment(protocol());
  assert.throws(() => db.prepare('DELETE FROM research_records').run(), /immutable/); assert.throws(() => db.prepare("UPDATE research_records SET project_id='other'").run(), /immutable/);
  ctx.project = { id: 'other' }; assert.equal(api.bootstrap().experiments.length, 0); assert.throws(() => api.evaluate({ experiment_id: experiment.record_id }), status(404));
  ctx.workspace = 'local'; assert.equal(api.snapshot().records.length, 0);
  ctx.workspace = 'live'; assert.throws(() => api.bootstrap(), status(403));
});

test('manual follow-up preserves draft/evidence snapshots, source corrections and ambiguous outcomes without external receipts', t => {
  const { api, ctx, finding } = setup(t);
  const input = { draft_id: 'd1', draft_revision_id: 'dr1', destination_project: 'reported-project', owner: 'Manual reviewer', due_date: '2026-11-10', tracking_status: 'prepared', basis: 'Local preparation only; no external submission.' };
  const first = api.saveFollowUp(input); assert.equal(first.draft_snapshot.revision_id, 'dr1'); assert.equal(first.external_record_id, null); assert.equal(first.external_receipt_verified, false);
  assert.throws(() => api.saveFollowUp(input), status(409));
  assert.throws(() => api.saveFollowUp({ ...input, tracking_status: 'closed' }), status(400));
  assert.throws(() => api.saveFollowUp({ ...input, external_receipt_verified: true }), status(400));
  ctx.drafts = [{ ...ctx.drafts[0], revision_id: 'dr2', revision: 2, title: 'A later corrected draft' }];
  const second = api.saveFollowUp({ ...input, action_id: first.action_id, previous_revision_id: first.record_id, tracking_status: 'outcome_unknown', basis: 'A manually reported outcome is uncertain; reconcile before any external retry.' });
  assert.equal(second.draft_snapshot.revision_id, 'dr1'); assert.equal(second.tracking_status, 'outcome_unknown');
  ctx.finding_revisions.push({ ...finding, revision: 2, revision_id: 'fr2' });
  assert.equal(api.bootstrap().follow_ups[0].needs_review, true); assert.equal(api.bootstrap().follow_up_history.length, 2);
  assert.throws(() => api.saveFollowUp({ ...input, action_id: first.action_id, previous_revision_id: first.record_id }), status(409));
});

test('selected research exports omit off-scope cases, mixed evaluations and global investigation notes', t => {
  const { api, ctx, item } = setup(t); ctx.items.push({ ...item, item_id: 'custom-scope-2', label: 'Other drawing region', model_ref: null });
  const experiment = api.saveExperiment(protocol());
  const one = api.saveCase(sample(experiment)), two = api.saveCase({ ...sample(experiment, 'c2', 'other'), item_id: 'custom-scope-2' });
  api.saveProposal(proposal(one)); api.saveProposal(proposal(two)); const evaluation = api.evaluate({ experiment_id: experiment.record_id });
  api.saveCapability({ service: 'issues', operation: 'create', documentation_url: researchDocumentation[0].documentation_url, required_permissions: 'Not verified', notes: 'Global project investigation note' });
  const all = api.snapshot(), selected = api.snapshot(['element:D1']);
  assert.ok(all.records.some((row: Json) => row.record_id === evaluation.record_id));
  assert.ok(selected.records.some((row: Json) => row.record_id === one.record_id));
  assert.ok(selected.records.some((row: Json) => row.record_id === experiment.record_id));
  assert.equal(selected.records.some((row: Json) => row.record_id === two.record_id), false);
  assert.equal(selected.records.some((row: Json) => row.record_id === evaluation.record_id), false);
  assert.equal(selected.records.some((row: Json) => row.notes === 'Global project investigation note'), false);
});
