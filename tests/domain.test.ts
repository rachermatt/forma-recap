import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, createStore, DomainError, validateAssessment } from '../server/domain.ts';

type TestContext = { after: (fn: () => void) => void };
function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'forma-recap-domain-'));
  const mediaDir = join(dir, 'media'); mkdirSync(mediaDir);
  for (const name of ['fixture-plan', 'fixture-capture-01', 'fixture-capture-02']) {
    writeFileSync(join(mediaDir, `${name}.svg`), readFileSync(new URL(`../server/media/${name}.svg`, import.meta.url)));
  }
  const options = { dbPath: join(dir, 'private.sqlite'), mediaDir, mode: 'fixture' };
  let store = createStore(options);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { options, mediaDir, get store() { return store; }, reopen() { store.close(); store = createStore(options); return store; } };
}
const input = (changes: Record<string, any> = {}) => ({ capture_id: 'fixture-capture-01', state: 'observed_installed', rationale: 'Synthetic duct outline visible in selected evidence; no inspection claim.', uncertainty_reason: null, element_ids: ['DUCT-01'], previous_revision_id: null, ...changes });
const status = (expected: number) => (error: unknown) => error instanceof DomainError && error.status === expected;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test('persistent fixture workflow preserves date-only evidence, exact model version and server reviewer', t => {
  const f = fixture(t);
  const initial = f.store.bootstrap();
  assert.equal(initial.mode, 'fixture');
  assert.equal(initial.assessments.length, 0);
  assert.equal(initial.captures[0].capture_ref.captured_at, null);
  assert.equal(initial.captures[0].capture_ref.captured_date, '2026-10-08');
  assert.equal(initial.captures[0].capture_ref.uploaded_at, '2026-10-09T14:05:00Z');
  assert.equal(initial.captures[1].capture_ref.original_timezone, 'America/New_York');
  const record = f.store.saveAssessment(input());
  validateAssessment(record);
  assert.equal(record.review.reviewer_id, 'fixture-reviewer');
  assert.equal(record.review.authority, 'human_reviewer');
  assert.equal(record.model_ref.version_id, 'fixture-model-v7');
  assert.equal(record.capture_ref.content_sha256, createHash('sha256').update(f.store.getMedia('fixture-capture-01').body).digest('hex'));
  assert.deepEqual(f.reopen().bootstrap().assessments, [record]);
});

test('corrections append immutable history and stale or foreign predecessors conflict', t => {
  const f = fixture(t);
  const first = f.store.saveAssessment(input());
  assert.throws(() => f.store.saveAssessment(input()), status(409));
  assert.throws(() => f.store.saveAssessment(input({ previous_revision_id: 'foreign-revision' })), status(409));
  const second = f.store.saveAssessment(input({ state: 'needs_review', rationale: 'Correction: branch is obscured.', uncertainty_reason: 'The branch connection is behind the ceiling screen.', previous_revision_id: first.review.revision_id }));
  assert.equal(first.review.revision, 1);
  assert.equal(second.review.revision, 2);
  assert.equal(second.assessment_id, first.assessment_id);
  assert.equal(second.previous_revision_id, first.review.revision_id);
  assert.deepEqual(f.store.history(first.assessment_id), [first, second]);
  assert.deepEqual(f.store.history(first.review.revision_id), [first, second]);
  assert.throws(() => f.store.saveAssessment(input({ previous_revision_id: first.review.revision_id })), status(409));
  assert.deepEqual(f.store.bootstrap().assessments, [second]);
});

test('selected captures create separate findings without erasing apparent differences across dates', t => {
  const f = fixture(t);
  const first = f.store.saveAssessment(input({ state: 'not_observed', uncertainty_reason: 'Outside the visible camera area.' }));
  const second = f.store.saveAssessment(input({ capture_id: 'fixture-capture-02' }));
  assert.notEqual(first.assessment_id, second.assessment_id);
  assert.equal(first.state, 'not_observed');
  assert.equal(second.state, 'observed_installed');
  assert.equal(f.store.bootstrap().assessments.length, 2);
  assert.equal(first.evidence[0].capture_id, first.capture_ref.capture_id);
  assert.equal(second.evidence[0].capture_id, second.capture_ref.capture_id);
});

test('server rejects unsupported states, scope overlap, forged identity/version/evidence and blank rationale', t => {
  const f = fixture(t);
  for (const change of [
    { state: 'not_installed' }, { rationale: '  ' }, { state: 'needs_review' },
    { state: 'not_observed', uncertainty_reason: '' }, { element_ids: ['DUCT-01', 'DUCT-01'] },
    { element_ids: ['ANOTHER-MODEL-01'] }, { element_ids: [] },
    { project_id: 'foreign-project' }, { model_version_id: 'fixture-model-v8' },
    { reviewer_id: 'someone-else' }, { evidence: [{ capture_id: 'fixture-capture-02' }] },
    { reviewed_at: '2020-01-01T00:00:00Z' },
  ]) assert.throws(() => f.store.saveAssessment(input(change)), status(400));
  assert.equal(f.store.bootstrap().assessments.length, 0);
});

test('manual pins persist and later edits do not mutate reviewed placement snapshots', t => {
  const f = fixture(t);
  const record = f.store.saveAssessment(input());
  const oldPin = copy(record.placement.normalized_pin);
  const capture = f.store.placeCapture('fixture-capture-01', { x: 0.9, y: 0.1 });
  assert.deepEqual(capture.placement.normalized_pin, { x: 0.9, y: 0.1, origin: 'top_left' });
  assert.equal(capture.placement.is_verified_3d_registration, false);
  assert.deepEqual(f.store.history(record.assessment_id)[0].placement.normalized_pin, oldPin);
  assert.equal(f.reopen().bootstrap().captures[0].placement.normalized_pin.x, 0.9);
  for (const invalid of [{ x: -1, y: 0 }, { x: 0, y: 1.01 }, { x: NaN, y: 0 }, { x: '0.5', y: 0 }, { x: 0.5, y: 0.5, is_verified_3d_registration: true }]) {
    assert.throws(() => f.store.placeCapture('fixture-capture-01', invalid), status(400));
  }
});

test('private resource lookups fail closed and live mode never substitutes fixtures', t => {
  const f = fixture(t);
  for (const lookup of [() => f.store.getMedia('../fixture-capture-01'), () => f.store.getMedia('foreign-capture'), () => f.store.history('foreign-assessment'), () => f.store.getExport('foreign-export'), () => f.store.placeCapture('foreign-capture', { x: 0, y: 0 }), () => f.store.saveAssessment(input({ capture_id: 'foreign-capture' }))]) assert.throws(lookup, status(404));
  const live = createStore({ ...f.options, mode: 'live' });
  try {
    assert.equal(live.bootstrap().project, null);
    assert.deepEqual(live.bootstrap().captures, []);
    for (const operation of [() => live.getMedia('fixture-plan'), () => live.saveAssessment(input()), () => live.history('any'), () => live.placeCapture('fixture-capture-01', { x: 0.1, y: 0.1 }), () => live.createExport(), () => live.getExport('any')]) assert.throws(operation, status(403));
  } finally { live.close(); }
  assert.throws(() => createStore({ ...f.options, mode: 'auto' }), status(500));
});

test('export snapshots are deterministic, offline, immutable and include all correction revisions', t => {
  const f = fixture(t);
  const first = f.store.saveAssessment(input());
  const firstSummary = f.store.createExport();
  const packet = f.store.getExport(firstSummary.id);
  const repeated = f.store.getExport(f.store.createExport().id);
  assert.equal(packet.manifest.snapshot_sha256, repeated.manifest.snapshot_sha256);
  assert.deepEqual(packet.manifest.snapshot, repeated.manifest.snapshot);
  assert.notEqual(packet.manifest.id, repeated.manifest.id);
  assert.equal(packet.manifest.snapshot_sha256, createHash('sha256').update(canonicalJson(packet.manifest.snapshot)).digest('hex'));
  assert.equal(packet.manifest.snapshot.media.length, 3);
  assert.equal(packet.manifest.snapshot.display_media.length, 3);
  assert.ok(packet.html.includes('data:image/png;base64,'), 'new report embeds verified PNG displays');
  assert.match(packet.html, /not a progress percentage/);
  assert.match(packet.html, /Synthetic demonstration evidence only/);
  for (const source of packet.manifest.snapshot.media) assert.equal(createHash('sha256').update(Buffer.from(source.original_base64, 'base64')).digest('hex'), source.content_sha256);
  for (const display of packet.manifest.snapshot.display_media) {
    const original = packet.manifest.snapshot.media.find((source: Record<string, any>) => source.id === display.id);
    assert.equal(display.source_content_sha256, original.content_sha256);
    assert.equal(display.method, 'trusted_svg_lossless_png');
    assert.equal(display.content_type, 'image/png');
    assert.equal(createHash('sha256').update(Buffer.from(display.display_base64, 'base64')).digest('hex'), display.content_sha256);
    assert.ok(packet.html.includes(`data:image/png;base64,${display.display_base64}`));
  }
  const second = f.store.saveAssessment(input({ state: 'not_observed', rationale: 'Correction: selected branch cannot be seen.', uncertainty_reason: 'Occluded in synthetic image.', previous_revision_id: first.review.revision_id }));
  const newSummary = f.store.createExport();
  const correctedPacket = f.store.getExport(newSummary.id);
  assert.equal(newSummary.revision_count, 2);
  assert.equal(correctedPacket.manifest.current_revision_count, 1);
  assert.deepEqual(correctedPacket.manifest.selected_revision_ids, [second.review.revision_id]);
  assert.deepEqual(correctedPacket.manifest.snapshot.assessment_history, [first, second]);
  assert.deepEqual(f.reopen().getExport(firstSummary.id), packet);
});

test('changed or unavailable originals are detected, while old offline exports remain reconstructable', t => {
  const f = fixture(t);
  f.store.saveAssessment(input());
  const packetId = f.store.createExport().id;
  const before = f.store.getExport(packetId);
  const originalBytes = readFileSync(join(f.mediaDir, 'fixture-capture-01.svg'));
  writeFileSync(join(f.mediaDir, 'fixture-capture-01.svg'), '<svg>altered evidence</svg>');
  assert.equal(f.store.bootstrap().captures[0].media_status, 'changed');
  assert.throws(() => f.store.getMedia('fixture-capture-01'), status(409));
  assert.throws(() => f.store.createExport(), status(409));
  assert.throws(() => f.store.saveAssessment(input()), status(409));
  unlinkSync(join(f.mediaDir, 'fixture-capture-02.svg'));
  assert.equal(f.store.bootstrap().captures[1].media_status, 'unavailable');
  assert.deepEqual(f.store.getExport(packetId), before);
  const stored = before.manifest.snapshot.media.find((source: Record<string, any>) => source.id === 'fixture-capture-01');
  assert.deepEqual(Buffer.from(stored.original_base64, 'base64'), originalBytes);
});

test('a changed reference plan blocks saving a review with a manual pin', t => {
  const f = fixture(t);
  writeFileSync(join(f.mediaDir, 'fixture-plan.svg'), '<svg>changed plan geometry</svg>');
  assert.equal(f.store.bootstrap().plan?.media_status, 'changed');
  assert.throws(() => f.store.saveAssessment(input()), status(409));
  assert.throws(() => f.store.placeCapture('fixture-capture-01', { x: 0.1, y: 0.2 }), status(409));
  assert.equal(f.store.bootstrap().assessments.length, 0);
});

test('SQLite prevents mutation or deletion of reviewer history and exported evidence', t => {
  const f = fixture(t);
  f.store.saveAssessment(input()); f.store.createExport();
  const db = new DatabaseSync(f.options.dbPath);
  try {
    for (const sql of ['UPDATE assessment_revisions SET record_json = \'{}\'', 'DELETE FROM assessment_revisions', 'UPDATE exports SET report_html = \'changed\'', 'DELETE FROM exports', 'UPDATE media SET sha256 = \'changed\'', 'DELETE FROM media', 'DELETE FROM placement_events']) assert.throws(() => db.exec(sql), /immutable/);
  } finally { db.close(); }
});

test('format-aware contract guard rejects invented capture times, incompatible versions and cross-date evidence', t => {
  const f = fixture(t);
  const valid = f.store.saveAssessment(input());
  const invalid = [
    (record: any) => { record.capture_ref.captured_at = '2026-10-08T00:00:00Z'; },
    (record: any) => { record.capture_ref.captured_date = '2026-02-30'; },
    (record: any) => { record.capture_ref.captured_date = '2026-99-01'; },
    (record: any) => { record.capture_ref.date_precision = 'unknown'; },
    (record: any) => { record.capture_ref.uploaded_at = '2026-10-09T14:00:00'; },
    (record: any) => { record.data_mode = 'live'; record.capture_ref.content_sha256 = null; },
    (record: any) => { record.data_mode = 'live'; },
    (record: any) => { record.model_ref.element_refs[0].version_id = 'v8'; },
    (record: any) => { record.model_ref.element_refs.push(copy(record.model_ref.element_refs[0])); },
    (record: any) => { record.placement.is_verified_3d_registration = true; },
    (record: any) => { record.evidence[0].capture_id = 'fixture-capture-02'; },
    (record: any) => { record.evidence = []; },
    (record: any) => { record.state = 'not_observed'; },
    (record: any) => { record.review.revision = 2; },
    (record: any) => { record.ai_suggestion_id = 'unpreserved-suggestion'; },
  ];
  for (const mutate of invalid) { const record = copy(valid); mutate(record); assert.throws(() => validateAssessment(record), status(400)); }
});

test('offline report escapes reviewer-controlled markup in display and inert JSON', t => {
  const f = fixture(t);
  f.store.saveAssessment(input({ rationale: '</script><script>alert("example")</script><img src=x onerror=alert(1)>' }));
  const packet = f.store.getExport(f.store.createExport().id);
  assert.doesNotMatch(packet.html, /<script>alert/);
  assert.doesNotMatch(packet.html, /<img src=x/);
  assert.match(packet.html, /&lt;script&gt;alert/);
  assert.match(packet.html, /\\u003c\/script>/);
});
