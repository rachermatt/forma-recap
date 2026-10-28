import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_REVIEW_ROUTE, parseReviewHash, serializeReviewRoute, validateReviewRoute } from '../src/reviewNavigation.ts';
import type { ReviewRoute, ReviewRouteData } from '../src/reviewNavigation.ts';
const sample: ReviewRoute = { page: 'field', workspace: 'fixture', section: 'findings', project_id: 'fixture-project', scope_id: 'scope-1', model_version_id: 'v7', capture_id: 'capture-1', element_id: 'DUCT-03' };
const data: ReviewRouteData = { workspace: 'fixture', project: { id: 'fixture-project' }, scope: { scope_id: 'scope-1', element_ids: ['DUCT-01', 'DUCT-03'] }, model: { version_id: 'v7', elements: [{ external_id: 'DUCT-01' }, { external_id: 'DUCT-03' }, { external_id: 'outside-scope' }] }, captures: [{ capture_id: 'capture-1', workspace: 'fixture', project_id: 'fixture-project' }], tasks: [{ task_id: 'task-1', workspace: 'fixture', project_id: 'fixture-project', model_ref: { version_id: 'v7' }, scope_ref: { scope_id: 'scope-1' } }], drafts: [{ draft_id: 'draft-1', workspace: 'fixture' }], reconciliations: [{ entry_id: 'entry-1', workspace: 'fixture' }] };

test('review routes round trip exact workspace, item, capture and reference context through each destination', () => {
  for (const page of ['workspace', 'field', 'log', 'packets', 'connection'] as const) for (const section of ['findings', 'tasks', 'photos', 'reconciliation', 'drafts'] as const) {
    const route: ReviewRoute = { ...sample, page, section, task_id: 'task-1', draft_id: 'draft-1', entry_id: 'entry-1' };
    assert.deepEqual(parseReviewHash(serializeReviewRoute(route)), { ok: true, route, redirected: false });
  }
  const encoded = { ...sample, element_id: 'Duct / terminal + branch & connector' };
  const parsed = parseReviewHash(serializeReviewRoute(encoded));
  assert.equal(parsed.ok, true);if (parsed.ok) assert.equal(parsed.route.element_id, encoded.element_id);
});

test('empty and recognized old destinations remain compatible while Fixed packets goes directly to Evidence packets', () => {
  assert.deepEqual(parseReviewHash(''), { ok: true, route: { ...DEFAULT_REVIEW_ROUTE }, redirected: false });
  for (const hash of ['#/field', '#/element-review']) { const result = parseReviewHash(hash);assert.equal(result.ok, true);if (result.ok) { assert.equal(result.route.page, 'field');assert.equal(result.route.section, 'findings');assert.equal(result.redirected, true); } }
  for (const hash of ['#/fixed-packets', '#/element-review/packets?workspace=local&capture=photo-1']) {
    const result = parseReviewHash(hash);assert.equal(result.ok, true);if (result.ok) { assert.equal(result.route.page, 'packets');assert.equal(result.redirected, true);if(hash.includes('workspace=local')){assert.equal(result.route.workspace,'local');assert.equal(result.route.capture_id,'photo-1');} }
  }
});

test('unsupported, malformed and ambiguous links produce explanations instead of selecting defaults', () => {
  for (const hash of ['https://attacker.example', '#//attacker.example', '#/unknown', '#/toString', '#/__proto__', '#/constructor', '#/review-log/extra', '#/element-review/not-a-view', '#/field?workspace=live', '#/field?workspace=fixture&workspace=local', '#/field?capture=', '#/field?capture=%00', '#/field?element=%ZZ', '#/field?unknown=value', '#/element-review/tasks?section=drafts', '#/field?capture=first&capture=second']) {
    const result = parseReviewHash(hash);assert.equal(result.ok, false, hash);if(!result.ok)assert.ok(result.error.length,hash);
  }
  assert.throws(() => serializeReviewRoute({ ...sample, capture_id: ' ' }), /invalid capture/);
});

test('history snapshots preserve each destination independently without mutating earlier context', () => {
  const first = serializeReviewRoute(sample);
  const second = serializeReviewRoute({ ...sample, page: 'log', section: 'tasks', task_id: 'task-1' });
  const third = serializeReviewRoute({ ...sample, page: 'packets', section: 'drafts', draft_id: 'draft-1' });
  const history = [first, second, third];
  assert.equal(parseReviewHash(history[1]).ok, true);
  const back = parseReviewHash(history[0]);assert.equal(back.ok, true);if(back.ok)assert.deepEqual(back.route,sample);
  assert.equal(first, serializeReviewRoute(sample));
});

test('explicit unavailable and cross-workspace references never fall back to unrelated saved records', () => {
  assert.equal(validateReviewRoute(sample, data), null);
  assert.equal(validateReviewRoute({ ...sample, task_id: 'task-1', draft_id: 'draft-1', entry_id: 'entry-1' }, data), null);
  for (const [field, value] of [['workspace', 'local'], ['project_id', 'other-project'], ['scope_id', 'other-scope'], ['model_version_id', 'v8'], ['element_id', 'missing'], ['element_id', 'outside-scope'], ['capture_id', 'missing'], ['task_id', 'missing'], ['draft_id', 'missing'], ['entry_id', 'missing']] as const) assert.ok(validateReviewRoute({ ...sample, [field]: value }, data), field);
  assert.deepEqual(data.captures.map(capture=>capture.capture_id),['capture-1']);
  assert.equal(sample.capture_id,'capture-1');
});

test('linked records retain their own project, scope and model boundaries', () => {
  const route = { ...sample, task_id: 'task-1' };
  for (const boundary of [{ workspace: 'local' }, { project_id: 'foreign' }, { model_ref: { version_id: 'v8' } }, { scope_ref: { scope_id: 'foreign' } }]) assert.ok(validateReviewRoute(route, { ...data, tasks: [{ ...data.tasks![0], ...boundary }] }));
  assert.ok(validateReviewRoute({ ...sample, page: 'workspace', workspace: 'local' }, { ...data, workspace: 'local' }));
  const unconfigured: ReviewRouteData = { workspace: 'local', project: null, scope: null, model: null, captures: [] };
  assert.equal(validateReviewRoute({ page: 'field', section: 'photos', workspace: 'local' }, unconfigured), null);
  assert.ok(validateReviewRoute({ page: 'field', section: 'findings', workspace: 'local', element_id: 'DUCT-01' }, unconfigured));
});


test('broader decision and direct assignment routes preserve stable item and task identity without ambiguous parameters', () => {
  for(const page of ['operations','assignments','research'] as const){const route={...DEFAULT_REVIEW_ROUTE,page,workspace:'local' as const,item_id:'item-drawing-A',assignment_id:'assignment-12'};const parsed=parseReviewHash(serializeReviewRoute(route));assert.equal(parsed.ok,true);if(parsed.ok)assert.deepEqual(parsed.route,route);}
  assert.equal(parseReviewHash('#/field-assignments?workspace=local&assignment=a&assignment=b').ok,false);
});
