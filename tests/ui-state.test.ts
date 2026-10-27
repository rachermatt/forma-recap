import test from 'node:test';
import assert from 'node:assert/strict';
import { createFindingDraftStore, findingDraftKey, findingDraftValidation, isFindingDraftDirty } from '../src/findingDraft.ts';
import type { FindingDraftIdentity } from '../src/findingDraft.ts';
import type { Finding } from '../src/ReviewWorkbench.tsx';
import { acceptReportingPeriod, reportingPeriodLabel, sameReportingPeriod, validateReportingPeriod } from '../src/reportingPeriod.ts';

const identity: FindingDraftIdentity = { workspace: 'fixture', project_id: 'project-1', model_id: 'model-1', model_version: 'v7', scope_id: 'scope-1', scope_revision: 1, capture_id: 'capture-1', element_id: 'DUCT-01' };
const finding = (overrides: Partial<Finding> = {}): Finding => ({ finding_id: 'finding-1', revision_id: 'revision-1', revision: 1, previous_revision_id: null, capture_ref: { capture_id: identity.capture_id, captured_at: null, captured_date: '2026-10-08', date_precision: 'date', uploaded_at: '2026-10-09T09:00:00Z' }, model_ref: { model_id: identity.model_id, version_id: identity.model_version, element_id: identity.element_id }, scope_ref: { scope_id: identity.scope_id, revision: identity.scope_revision }, state: 'needs_review', rationale: 'Connection is obscured.', uncertainty_reason: 'Closer viewpoint required.', evidence_quality: 'limited', annotations: [{ id: 'annotation-1', x: 0.1, y: 0.2, width: 0.3, height: 0.2, label: 'Obscured connection' }], review: { reviewer_id: 'fixture-reviewer', reviewed_at: '2026-10-19T10:00:00Z' }, ...overrides });

test('finding drafts are isolated by workspace, project, model, scope, capture and element identity', () => {
  const store = createFindingDraftStore();
  const key = findingDraftKey(identity);
  const opened = store.open(key);
  store.update(key, { ...opened.values, rationale: 'Unsaved note for this capture only.' });
  const alternatives: FindingDraftIdentity[] = [
    { ...identity, workspace: 'local' }, { ...identity, project_id: 'project-2' },
    { ...identity, model_id: 'model-2' }, { ...identity, model_version: 'v8' },
    { ...identity, scope_id: 'scope-2' }, { ...identity, scope_revision: 2 },
    { ...identity, capture_id: 'capture-2' }, { ...identity, element_id: 'DUCT-02' },
  ];
  for (const other of alternatives) {
    assert.notEqual(findingDraftKey(other), key);
    const independent = store.open(findingDraftKey(other));
    assert.equal(independent.values.rationale, '');
    assert.equal(independent.base_revision_id, null);
    assert.equal(isFindingDraftDirty(independent), false);
  }
  assert.equal(store.open(key).values.rationale, 'Unsaved note for this capture only.');
  assert.notEqual(findingDraftKey({ ...identity, capture_id: 'a:b', element_id: 'c' }), findingDraftKey({ ...identity, capture_id: 'a', element_id: 'b:c' }));
});

test('default Needs review is a clean unsaved form and never establishes a saved revision', () => {
  const store = createFindingDraftStore();
  const key = findingDraftKey(identity);
  const opened = store.open(key, null);
  assert.equal(opened.values.state, 'needs_review');
  assert.equal(opened.base_revision_id, null);
  assert.equal(isFindingDraftDirty(opened), false);
  assert.match(findingDraftValidation(opened.values)!, /rationale/);
  const edited = store.update(key, { ...opened.values, rationale: 'Relevant detail cannot be seen.' });
  assert.equal(edited.base_revision_id, null);
  assert.equal(isFindingDraftDirty(edited), true);
  assert.match(findingDraftValidation(edited.values)!, /uncertainty/);
  assert.equal(findingDraftValidation({ ...edited.values, uncertainty_reason: 'Terminal is behind the service.' }), null);
  assert.equal(findingDraftValidation({ ...edited.values, state: 'observed_installed', uncertainty_reason: '' }), null);
});

test('failed or cancelled save paths retain a draft and its saved baseline without mutating source annotations', () => {
  const store = createFindingDraftStore();
  const saved = finding();
  const before = structuredClone(saved);
  const key = findingDraftKey(identity);
  const opened = store.open(key, saved);
  const changed = { ...opened.values, rationale: 'Unsaved correction retained after failure.', annotations: opened.values.annotations.map(annotation => ({ ...annotation, label: 'Corrected region, still unsaved' })) };
  store.update(key, changed);
  // Reopening follows a rejected request or cancelled navigation without a saved response.
  const returned = store.open(key, saved);
  assert.equal(returned.base_revision_id, saved.revision_id);
  assert.equal(returned.values.rationale, changed.rationale);
  assert.equal(returned.baseline.rationale, saved.rationale);
  assert.equal(isFindingDraftDirty(returned), true);
  assert.deepEqual(saved, before);
  returned.values.annotations[0].label = 'Caller mutation';
  assert.equal(store.open(key, saved).values.annotations[0].label, changed.annotations[0].label, 'Returned objects cannot mutate the retained draft');
});

test('mismatched save responses cannot accept a draft for a different capture, element, model or scope', () => {
  const store = createFindingDraftStore();
  const key = findingDraftKey(identity);
  const original = finding();
  const opened = store.open(key, original);
  store.update(key, { ...opened.values, rationale: 'A pending correction.' });
  const next = finding({ revision_id: 'revision-2', revision: 2, previous_revision_id: original.revision_id, rationale: 'A pending correction.' });
  for (const mismatch of [
    { ...next, capture_ref: { ...next.capture_ref, capture_id: 'capture-2' } },
    { ...next, model_ref: { ...next.model_ref, element_id: 'DUCT-02' } },
    { ...next, model_ref: { ...next.model_ref, model_id: 'model-2' } },
    { ...next, model_ref: { ...next.model_ref, version_id: 'v8' } },
    { ...next, scope_ref: { ...next.scope_ref, scope_id: 'scope-2' } },
    { ...next, scope_ref: { ...next.scope_ref, revision: 2 } },
  ]) assert.throws(() => store.saved(key, mismatch, identity), /save response did not match/);
  assert.equal(isFindingDraftDirty(store.open(key, original)), true);
  const accepted = store.saved(key, next, identity);
  assert.equal(accepted.base_revision_id, 'revision-2');
  assert.equal(accepted.baseline.rationale, 'A pending correction.');
  assert.equal(isFindingDraftDirty(accepted), false);
  assert.equal(original.revision_id, 'revision-1');
});

test('a newer saved revision does not silently rebase dirty edits, while clean drafts follow confirmed revisions', () => {
  const store = createFindingDraftStore();
  const key = findingDraftKey(identity);
  const first = finding();
  const opened = store.open(key, first);
  const next = finding({ revision_id: 'revision-2', revision: 2, previous_revision_id: first.revision_id, rationale: 'Another saved correction.' });
  store.update(key, { ...opened.values, rationale: 'My conflicting unsaved correction.' });
  const conflict = store.open(key, next);
  assert.equal(conflict.base_revision_id, first.revision_id);
  assert.equal(conflict.baseline.rationale, first.rationale);
  assert.equal(conflict.values.rationale, 'My conflicting unsaved correction.');
  assert.equal(isFindingDraftDirty(conflict), true);
  const discarded = store.discard(key, next);
  assert.equal(discarded.base_revision_id, next.revision_id);
  assert.equal(discarded.values.rationale, next.rationale);
  assert.equal(isFindingDraftDirty(discarded), false);
  const third = finding({ revision_id: 'revision-3', revision: 3, previous_revision_id: next.revision_id });
  assert.equal(store.open(key, third).base_revision_id, 'revision-3');
});

test('explicit discard and session reset do not create or remove saved findings', () => {
  const store = createFindingDraftStore();
  const key = findingDraftKey(identity);
  const opened = store.open(key);
  store.update(key, { ...opened.values, rationale: 'Discard this local draft.' });
  const discarded = store.discard(key);
  assert.equal(discarded.base_revision_id, null);
  assert.equal(discarded.values.rationale, '');
  assert.equal(isFindingDraftDirty(discarded), false);
  const saved = finding();
  store.open(key, saved);
  store.clear();
  assert.equal(store.open(key, saved).base_revision_id, saved.revision_id);
  assert.equal(saved.revision, 1);
});

test('invalid and reversed pending periods explain rejection without changing the applied result', () => {
  const applied = Object.freeze({ period_start: '2026-10-01', period_end: '2026-10-19' });
  const prior = Object.freeze({ reconciliation_summary: Object.freeze({ reporting_period: applied }), rows: Object.freeze([{ quantity: null }]) });
  const before = structuredClone(prior);
  for (const pending of [
    { period_start: '', period_end: '2026-10-19' },
    { period_start: '2026-02-29', period_end: '2026-10-19' },
    { period_start: '2026-10-01T12:00:00Z', period_end: '2026-10-19' },
    { period_start: '2026-10-20', period_end: '2026-10-19' },
  ]) assert.ok(validateReportingPeriod(pending));
  assert.equal(validateReportingPeriod({ period_start: '2028-02-29', period_end: '2028-02-29' }), null);
  assert.equal(sameReportingPeriod(applied, { period_start: '2026-10-01', period_end: '2026-10-19' }), true);
  assert.equal(sameReportingPeriod(applied, null), false);
  assert.equal(sameReportingPeriod(null, null), true);
  assert.equal(reportingPeriodLabel(null), 'All recorded periods');
  assert.equal(reportingPeriodLabel(applied), '2026-10-01 → 2026-10-19');
  assert.deepEqual(prior, before);
});

test('a response must confirm the exact applied period and retains unknown or no-match records unchanged', () => {
  const requested = { period_start: '2026-10-01', period_end: '2026-10-19' };
  const unknown = { reconciliation_summary: { reporting_period: { ...requested } }, rows: [{ quantity: null }] };
  assert.equal(acceptReportingPeriod(unknown, requested), unknown);
  assert.equal(unknown.rows[0].quantity, null);
  const empty = { reconciliation_summary: { reporting_period: { ...requested } }, rows: [] };
  assert.deepEqual(acceptReportingPeriod(empty, requested).rows, []);
  for (const period of [undefined, null, { ...requested, period_end: '2026-10-18' }, { ...requested, period_start: '2026-10-02' }]) {
    const response = { reconciliation_summary: { reporting_period: period }, rows: [{ quantity: 0 }] };
    assert.throws(() => acceptReportingPeriod(response, requested), /server did not confirm/);
    assert.equal(response.rows[0].quantity, 0);
  }
  assert.deepEqual(requested, { period_start: '2026-10-01', period_end: '2026-10-19' });
});
