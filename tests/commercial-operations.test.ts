import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createCommercialOperations } from '../server/commercial-operations.ts';
import { canonicalJson, DomainError } from '../server/domain.ts';

type Row = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const status = (number: number) => (error: unknown) => error instanceof DomainError && error.status === number;
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function setup(t: { after: (work: () => void) => void }) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const ctx: Row = { workspace: 'local', project: { id: 'project-1', name: 'Site A' }, reviewer: { id: 'local-reviewer' }, all_finding_revisions: [], finding_revisions: [] };
  const itemMap = new Map<string, Row>(['item-1', 'item-2'].map(id => [id, { item_id: id, revision_id: `${id}-rev1`, revision: 1, workspace: 'local', project_id: 'project-1', kind: 'drawing', label: id, location: 'Level 02', trade: 'Ductwork', model_ref: null }]));
  const captureMap = new Map<string, Row>(); const original = Buffer.from('Explicitly synthetic unit-test image bytes');
  for (const id of ['capture-1', 'capture-2']) captureMap.set(id, { capture_id: id, workspace: 'local', project_id: 'project-1', title: id, media_status: 'verified', capture_ref: { capture_id: id, content_sha256: digest(original), captured_date: id === 'capture-1' ? '2026-10-08' : null, captured_at: null, date_precision: id === 'capture-1' ? 'date' : 'unknown', uploaded_at: '2026-10-20T12:00:00Z' } });
  const getItem = (id: string) => { const item = itemMap.get(id); if (!item) throw new DomainError(404, 'Item unavailable'); return copy(item); };
  const getCapture = (id: string) => { const capture = captureMap.get(id); if (!capture) throw new DomainError(404, 'Capture unavailable'); return copy(capture); };
  const historical: Row[] = []; let failSnapshot = false; let api: ReturnType<typeof createCommercialOperations>;
  api = createCommercialOperations({ db, context: () => copy(ctx), getItem, getCapture, historicalPackets: () => copy(historical), packetSnapshot: selection => {
    if (failSnapshot) throw new DomainError(409, 'Original media changed; packet stopped.');
    const selected = new Set(selection.item_ids); const revisions = ctx.all_finding_revisions.filter((finding: Row) => selected.has(finding.item_id));
    return { workspace: ctx.workspace, project: copy(ctx.project), scope: { items: [...itemMap.values()].filter(item => selected.has(item.item_id)), finding_revisions: copy(revisions) }, existing: { finding_revisions: copy(revisions) }, commercial: api.snapshot({ item_ids: selection.item_ids, record_ids: selection.commercial_record_ids ?? [], include_metrics: false }), queue: [{ reason: 'Unresolved <script>example</script>', next_action: 'Human review required' }], media: revisions.map((finding: Row) => ({ id: finding.capture_ref.capture_id, title: '<img src=x onerror=alert(1)>', content_type: 'image/png', content_sha256: digest(original), original_base64: original.toString('base64') })) };
  } });
  function finding(id: string, itemId = 'item-1', changes: Row = {}) {
    const capture = getCapture('capture-1'); const record = { finding_id: `finding-${id}`, revision_id: id, revision: 1, item_id: itemId, workspace: ctx.workspace, project_id: ctx.project.id, capture_ref: capture.capture_ref, state: 'needs_review', evidence_quality: 'limited', rationale: 'Connection obscured', annotations: [{ id: `annotation-${id}`, label: 'Relevant area', x: 0.1, y: 0.1, width: 0.2, height: 0.3 }], review: { reviewer_id: ctx.reviewer.id, reviewed_at: '2026-10-20T13:00:00Z' }, ...changes };
    ctx.all_finding_revisions.push(record); ctx.finding_revisions.push(copy(record)); return record;
  }
  return { api, db, ctx, itemMap, captureMap, getCapture, finding, historical, failPackets: () => { failSnapshot = true; } };
}
const template = (changes: Row = {}): Row => ({ title: 'Reviewed duct length', item_ids: ['item-1'], unit: 'm', stage: 'installed', period_type: 'cumulative', measurement_method: 'manual_measurement', basis: 'Measured installed length of the exact selected run', source: 'Takeoff M201 Rev A / SOV line 12', denominator: 20, denominator_basis: 'Agreed total length in the same reviewed scope', change_reason: 'Initial reviewed baseline', ...changes });
const quantity = (basis: Row, changes: Row = {}): Row => ({ template_id: basis.id, template_revision_id: basis.revision_id, category: 'trade_reported', quantity: 12, period_start: '2026-10-01', period_end: '2026-10-19', source: 'Trade statement 2026-10-19', basis: 'Explicit manual source on the reviewed template', ...changes });
const draft = (changes: Row = {}): Row => ({ item_ids: ['item-1'], finding_revision_ids: ['finding-rev1'], type: 'rfi', title: 'Confirm terminal detail', description: 'Clarify the hidden connection', location: 'Level 02 east', requested_action: 'Provide a detail and an unobscured view', assignee: 'MEP lead', destination: 'Unverified test project', ...changes });
const packet = (changes: Row = {}): Row => ({ preset: 'weekly_review', item_ids: ['item-1'], commercial_record_ids: [], decision_summary: 'Review the unresolved connection; no inspection or payment decision.', ...changes });

test('versioned measurement templates preserve prior quantity bases and require explicit re-evaluation', t => {
  const f = setup(t); const first = f.api.save('template', template()); const report = f.api.save('quantity', quantity(first)); const support = f.api.save('quantity', quantity(first, { category: 'imagery_supported', quantity: 9, source: 'Reviewed manual measure' }));
  assert.equal(f.api.comparisons()[0].delta, 3); assert.equal(f.api.comparisons()[0].percentage, 45);
  const revised = f.api.save('template', template({ id: first.id, previous_revision_id: first.revision_id, denominator: 25, source: 'Takeoff Rev B', change_reason: 'Explicit revised denominator and source' }));
  const stale = f.api.comparisons()[0]; assert.equal(stale.delta, null); assert.match(stale.reason, /baseline changed/); assert.equal(report.template.denominator, 20); assert.equal(support.template_revision_id, first.revision_id);
  assert.throws(() => f.api.save('quantity', quantity(first)), status(409));
  f.api.save('quantity', quantity(revised, { id: report.id, previous_revision_id: report.revision_id }));
  f.api.save('quantity', quantity(revised, { id: support.id, previous_revision_id: support.revision_id, category: 'imagery_supported', quantity: 9 }));
  assert.equal(f.api.comparisons()[0].percentage, 36); assert.equal(f.api.snapshot().revisions.filter((record: Row) => record.kind === 'quantity').length, 4);
  f.itemMap.get('item-1')!.revision_id = 'item-1-rev2'; assert.equal(f.api.comparisons()[0].delta, null);
});

test('unknown quantities, incompatible units and duplicate sources never acquire numeric differences', t => {
  const f = setup(t); const first = f.api.save('template', template()); f.api.save('quantity', quantity(first));
  const unknown = f.api.save('quantity', quantity(first, { category: 'imagery_supported', quantity: null }));
  assert.equal(f.api.comparisons()[0].supported, null); assert.equal(f.api.comparisons()[0].delta, null); assert.equal(f.api.comparisons()[0].percentage, null);
  assert.throws(() => f.api.save('quantity', quantity(first, { unit: 'ft' })), status(400));
  for (const bad of [Infinity, -1, '12']) assert.throws(() => f.api.save('quantity', quantity(first, { quantity: bad })), status(400));
  const feet = f.api.save('template', template({ title: 'Different unit', unit: 'ft', denominator: 60 })); f.api.save('quantity', quantity(feet, { category: 'imagery_supported', quantity: 30 }));
  assert.ok(f.api.comparisons().every((row: Row) => row.delta === null));
  f.api.save('quantity', quantity(first, { id: unknown.id, previous_revision_id: unknown.revision_id, category: 'imagery_supported', quantity: 9 })); f.api.save('quantity', quantity(first, { category: 'imagery_supported', quantity: 8, source: 'Overlapping second source' }));
  assert.ok(f.api.comparisons().every((row: Row) => row.delta === null));
});

test('a later item finding correction requires explicit supported-quantity re-review without overwriting source records', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T14:00:00Z') });
  const f = setup(t); const basis = f.api.save('template', template()); const original = f.finding('finding-rev1', 'item-1', { state: 'observed_installed', evidence_quality: 'usable' });
  const reported = f.api.save('quantity', quantity(basis)); const supported = f.api.save('quantity', quantity(basis, { category: 'imagery_supported', quantity: 9 }));
  const before = f.api.comparisons()[0]; assert.equal(before.delta, 3); assert.equal(before.percentage, 45);
  t.mock.timers.tick(1000);
  f.finding('unrelated-rev2', 'item-2', { previous_revision_id: 'unrelated-rev1', revision: 2, review: { reviewed_at: new Date().toISOString(), reviewer_id: 'local-reviewer' } });
  assert.equal(f.api.comparisons()[0].delta, 3, 'A correction outside the exact scope does not invalidate this quantity');
  const correction = f.finding('finding-rev2', 'item-1', { finding_id: original.finding_id, previous_revision_id: original.revision_id, revision: 2, rationale: 'The earlier visible extent was too broad; investigate and re-review quantities.', review: { reviewed_at: new Date().toISOString(), reviewer_id: 'local-reviewer' } });
  const affected = f.api.comparisons()[0]; assert.equal(affected.comparable, false); assert.equal(affected.delta, null); assert.equal(affected.percentage, null); assert.equal(affected.correction_review_required, true); assert.deepEqual(affected.correction_revision_ids, [correction.revision_id]); assert.match(affected.reason, /later finding correction/);
  assert.equal(f.api.bootstrap().quantities.find((row: Row) => row.id === supported.id)!.quantity, 9); assert.equal(reported.quantity, 12); assert.equal(supported.revision, 1);
  t.mock.timers.tick(1000);
  const reconsidered = f.api.save('quantity', quantity(basis, { id: supported.id, previous_revision_id: supported.revision_id, category: 'imagery_supported', quantity: 9, source: 'Manual quantity re-reviewed after finding-rev2', basis: 'Explicit reviewer confirmation of the same bounded 9 m after inspecting the corrected finding.' }));
  assert.equal(reconsidered.revision, 2); assert.equal(f.api.comparisons()[0].correction_review_required, false); assert.equal(f.api.comparisons()[0].delta, 3); assert.equal(f.api.comparisons()[0].percentage, 45);
  const preserved = f.api.snapshot().revisions.filter((row: Row) => row.id === supported.id); assert.equal(preserved.length, 2); assert.equal(preserved[0].revision_id, supported.revision_id); assert.equal(preserved[0].quantity, 9);
});

test('period quantities remain distinct from cumulative completion and installation stages', t => {
  const f = setup(t); const cumulative = f.api.save('template', template()); const period = f.api.save('template', template({ title: 'This week only', period_type: 'period' })); const delivered = f.api.save('template', template({ title: 'Stored/delivered scope', stage: 'delivered' }));
  for (const basis of [cumulative, period, delivered]) { f.api.save('quantity', quantity(basis)); f.api.save('quantity', quantity(basis, { category: 'imagery_supported', quantity: 9 })); }
  const comparisons = f.api.comparisons(); assert.equal(comparisons.length, 3); assert.ok(comparisons.every((row: Row) => row.delta === 3));
  assert.equal(comparisons.find((row: Row) => row.period_type === 'period')!.percentage, null); assert.match(comparisons.find((row: Row) => row.period_type === 'period')!.percentage_basis, /not cumulative completion/);
  assert.equal(comparisons.find((row: Row) => row.stage === 'installed' && row.period_type === 'cumulative')!.percentage, 45);
  assert.equal(comparisons.find((row: Row) => row.stage === 'delivered')!.stage, 'delivered');
  f.api.save('quantity', quantity(cumulative, { period_end: '2026-10-26', quantity: 15 })); f.api.save('quantity', quantity(cumulative, { period_end: '2026-10-26', category: 'imagery_supported', quantity: 13 }));
  assert.equal(f.api.comparisons().find((row: Row) => row.period_end === '2026-10-26')!.delta, 2, 'Different cumulative as-of dates are separate snapshots and are never added together');
});

test('overlapping period scope blocks combined differences and very large finite ratios remain finite', t => {
  const f = setup(t); const period = f.api.save('template', template({ period_type: 'period' }));
  f.api.save('quantity', quantity(period)); f.api.save('quantity', quantity(period, { category: 'imagery_supported', quantity: 9 })); f.api.save('quantity', quantity(period, { period_start: '2026-10-10', period_end: '2026-10-22', quantity: 4 }));
  assert.ok(f.api.comparisons().every((row: Row) => row.delta === null));
  const huge = f.api.save('template', template({ item_ids: ['item-2'], denominator: 1e308 })); f.api.save('quantity', quantity(huge, { quantity: 1e308 })); f.api.save('quantity', quantity(huge, { category: 'imagery_supported', quantity: 1e308 }));
  const comparison = f.api.comparisons().find((row: Row) => row.item_ids.includes('item-2'))!; assert.equal(comparison.percentage, 100); assert.equal(comparison.delta, 0);
  f.itemMap.delete('item-2'); assert.equal(f.api.comparisons().find((row: Row) => row.item_ids.includes('item-2'))!.delta, null, 'Unavailable scope explains incomparable records instead of breaking all bootstrap reads');
});

test('local follow-up drafts freeze exact evidence/annotation choices and expose later corrections', t => {
  const f = setup(t); const original = f.finding('finding-rev1'); const first = f.api.save('followup', draft({ annotation_ids: [] }));
  assert.equal(first.external_record_id, null); assert.equal(first.external_submission_enabled, false); assert.deepEqual(first.evidence[0].annotations, []); assert.equal(first.evidence[0].finding.annotations.length, 1);
  const second = f.api.save('followup', draft({ id: first.id, previous_revision_id: first.revision_id, title: 'Updated local clarification' })); assert.equal(second.revision, 2); assert.equal(second.evidence[0].annotations[0].id, 'annotation-finding-rev1');
  f.finding('finding-rev2', 'item-1', { finding_id: original.finding_id, revision: 2, rationale: 'A subsequent correction is retained separately.' });
  assert.equal(f.api.bootstrap().followups[0].newer_correction_available, true); assert.equal(first.evidence[0].finding.revision_id, 'finding-rev1');
  assert.throws(() => f.api.save('followup', draft({ annotation_ids: ['foreign-annotation'] })), status(400));
  assert.throws(() => f.api.save('followup', draft({ finding_revision_ids: ['finding-rev1', 'finding-rev1'] })), status(400));
  assert.throws(() => f.api.save('followup', draft({ id: second.id, previous_revision_id: first.revision_id })), status(409));
  assert.throws(() => f.api.save('followup', draft({ id: second.id, previous_revision_id: second.revision_id, type: 'issue' })), status(409));
  f.captureMap.get('capture-1')!.capture_ref.content_sha256 = 'b'.repeat(64); assert.throws(() => f.api.save('followup', draft()), status(409));
});

test('follow-up and comparison source failures stay visible without claiming registration or external success', t => {
  const f = setup(t); f.finding('finding-rev1');
  const comparison = f.api.save('comparison', { item_id: 'item-1', mode: 'temporal', capture_a: 'capture-1', capture_b: 'capture-2', viewpoint: 'different', limitations: 'Unknown date and unmatched viewpoints; not a measured change.', observation: 'Manual evidence comparison only.' });
  assert.equal(comparison.capture_b.captured_date, null); assert.equal(comparison.alignment.overlay_enabled, false); assert.equal(comparison.alignment.metric_measurement_supported, false);
  f.captureMap.get('capture-1')!.media_status = 'unavailable_or_changed';
  assert.throws(() => f.api.save('followup', draft()), status(409));
  assert.throws(() => f.api.save('comparison', { item_id: 'item-1', mode: 'design', capture_a: 'capture-1', design_reference: 'Drawing Rev A', viewpoint: 'unknown', limitations: 'Unaligned', observation: 'Manual' }), status(409));
  assert.throws(() => f.api.save('followup', draft({ external_record_id: 'invented-id' })), status(400));
});

test('packet HTML and manifest share one escaped immutable snapshot with exact successor revision changes', t => {
  const f = setup(t); const original = f.finding('finding-rev1'); const first = f.api.createPacket(packet({ decision_summary: '</script><img src=x onerror=alert(1)>' })); const saved = f.api.getPacket(first.id);
  assert.equal(saved.manifest.product, 'Forma ReTrace'); assert.match(saved.html, /<title>Forma ReTrace ·/);
  const script = saved.html.match(/<script type="application\/json" id="forma-recap-manifest">([\s\S]*?)<\/script>/)![1]; assert.deepEqual(JSON.parse(script), saved.manifest); assert.equal(saved.manifest.snapshot_sha256, digest(canonicalJson(saved.manifest.snapshot)));
  assert.ok(saved.html.includes('&lt;/script&gt;')); assert.ok(!script.includes('</script><img')); assert.ok(saved.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const priorBytes = { html: saved.html, manifest: JSON.stringify(saved.manifest) };
  f.finding('finding-rev2', 'item-1', { finding_id: original.finding_id, revision: 2 }); f.ctx.all_finding_revisions.reverse();
  assert.equal(f.api.notices()[0].newer_correction_available, true, 'Correction detection uses revision numbers rather than array order');
  const successor = f.api.createPacket(packet({ predecessor_id: first.id, preset: 'concealment_record' })); const manifest = f.api.getPacket(successor.id).manifest;
  assert.deepEqual(manifest.changes.revised, [{ finding_id: original.finding_id, previous_revision_id: 'finding-rev1', current_revision_id: 'finding-rev2' }]); assert.equal(manifest.predecessor_id, first.id);
  assert.equal(f.api.getPacket(first.id).html, priorBytes.html); assert.equal(JSON.stringify(f.api.getPacket(first.id).manifest), priorBytes.manifest); assert.deepEqual(f.api.notices().find((notice: Row) => notice.packet_id === first.id)!.successors, [successor.id]);
});

test('packet record selection preserves unchecked exclusions and rejects partial-scope quantities', t => {
  const f = setup(t); f.finding('finding-rev1'); const one = f.api.save('template', template()); const mixed = f.api.save('template', template({ title: 'Two distinct items', item_ids: ['item-1', 'item-2'] }));
  const omitted = f.api.snapshot({ item_ids: ['item-1'], record_ids: [], include_metrics: false }); assert.deepEqual(omitted.records, []); assert.deepEqual(omitted.revisions, []);
  const chosen = f.api.snapshot({ item_ids: ['item-1'], record_ids: [one.id] }); assert.deepEqual(chosen.records.map((record: Row) => record.id), [one.id]);
  assert.throws(() => f.api.createPacket(packet({ commercial_record_ids: [mixed.id] })), status(400));
  assert.throws(() => f.api.createPacket(packet({ commercial_record_ids: ['foreign-record'] })), status(404));
  assert.throws(() => f.api.createPacket(packet({ commercial_record_ids: [one.id, one.id] })), status(400));
  const selected = f.api.createPacket(packet({ commercial_record_ids: [one.id] })); assert.deepEqual(f.api.getPacket(selected.id).manifest.snapshot.commercial.records.map((record: Row) => record.id), [one.id]);
  f.failPackets(); const count = f.api.bootstrap().packets.length; assert.throws(() => f.api.createPacket(packet()), status(409)); assert.equal(f.api.bootstrap().packets.length, count);
});

test('handover requirements keep missing documents and unresolved evidence separate from local review readiness', t => {
  const f = setup(t); const input = { title: 'Concealed terminal index', item_ids: ['item-1'], owner_requirements: 'Owner checklist Rev 1', identity_confirmed: true, documents: [{ type: 'before_cover', status: 'reference_supplied', reference: 'photo-index' }, { type: 'test', status: 'missing', reference: null }] };
  const first = f.api.save('handover', input); assert.equal(f.api.bootstrap().handover[0].missing, 2); assert.equal(f.api.bootstrap().handover[0].ready_for_owner_review, false); assert.equal(first.tandem_transfer, 'unverified_not_submitted');
  const second = f.api.save('handover', { ...input, id: first.id, previous_revision_id: first.revision_id, documents: input.documents.map(document => ({ ...document, status: 'reviewed_locally', reference: document.reference ?? 'Test report TR-1', basis: 'Manual document review against owner requirements' })) });
  assert.equal(f.api.bootstrap().handover[0].ready_for_owner_review, true); assert.equal(f.api.bootstrap().handover[0].owner_acceptance_verified, false);
  f.finding('finding-rev1'); const review = f.api.bootstrap().handover[0]; assert.equal(review.ready_for_owner_review, false); assert.deepEqual(review.unresolved_item_ids, ['item-1']);
  assert.throws(() => f.api.save('handover', { ...input, documents: [null] }), status(400));
  assert.throws(() => f.api.save('handover', { ...input, documents: [{ type: 'test', status: 'reviewed_locally', reference: 'TR-1' }] }), status(400));
  assert.throws(() => f.api.save('handover', { ...input, documents: [input.documents[0], input.documents[0]] }), status(400));
  assert.equal(second.revision, 2);
});

test('explicit activity events preserve failures, cancellations and pauses without fabricated pilot metrics', t => {
  const f = setup(t); const emit = (event: string, extra: Row = {}) => f.api.metric({ activity_id: 'review-1', workflow: 'review', event, ...extra });
  assert.throws(() => emit('complete'), status(409)); emit('start'); assert.equal(f.api.bootstrap().metrics.activities[0].active_seconds, null);
  assert.throws(() => emit('start'), status(409)); assert.throws(() => emit('resume'), status(409)); emit('pause'); assert.throws(() => emit('pause'), status(409));
  emit('resume'); assert.throws(() => emit('complete', { workflow: 'draft' }), status(409)); emit('cancel'); assert.throws(() => emit('complete'), status(409));
  const metrics = f.api.bootstrap().metrics; assert.equal(metrics.activities[0].status, 'cancel'); assert.equal(metrics.activities[0].event_count, 4); assert.ok(Number.isFinite(metrics.activities[0].active_seconds)); assert.equal(metrics.human_agreement, null); assert.equal(metrics.recognition_accuracy, null); assert.equal(metrics.roi, null);
  assert.throws(() => emit('start', { actor: 'forged-reviewer' }), status(400));
});

test('operation histories, metrics and packet access remain isolated and immutable', t => {
  const f = setup(t); const one = f.api.save('template', template()); f.finding('finding-rev1'); f.api.metric({ activity_id: 'review-1', workflow: 'review', event: 'start' }); const exported = f.api.createPacket(packet());
  for (const [table, column, id] of [['commercial_revisions', 'revision_id', one.revision_id], ['commercial_packets', 'id', exported.id]]) assert.throws(() => f.db.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(id), /Immutable/);
  assert.throws(() => f.db.prepare('UPDATE commercial_metrics SET event_json=?').run('{}'), /Immutable/);
  f.ctx.project.id = 'other-project'; assert.equal(f.api.bootstrap().records.length, 0); assert.equal(f.api.bootstrap().packets.length, 0); assert.equal(f.api.bootstrap().metrics.activities.length, 0); assert.throws(() => f.api.getPacket(exported.id), status(404));
  assert.throws(() => f.api.save('template', template()), status(404));
  f.ctx.workspace = 'live'; assert.throws(() => f.api.bootstrap(), status(403));
  f.ctx.workspace = 'local'; f.ctx.project = null; assert.equal(f.api.bootstrap().records.length, 0); assert.throws(() => f.api.createPacket(packet()), status(409));
});
