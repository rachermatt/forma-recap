import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createStore } from '../server/domain.ts';
import { createReviewStore } from '../server/review.ts';
import { loadDemoSeed, PROJECT_ROOT, setupDemo } from '../scripts/demo-setup.ts';
import { buildQueuedCapture, listQueuedCaptures } from '../src/offlineCapture.ts';

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

test('active replacement logo retains the delivered PNG bytes and original logo remains intact', async () => {
  const replacement = readFileSync(resolve(PROJECT_ROOT, 'public/brand/autodesk-forma-retrace.png'));
  const original = readFileSync(resolve(PROJECT_ROOT, 'public/brand/autodesk-forma-recap.png'));
  assert.equal(digest(replacement), '3efbfa5bd848f2c1524891f8962f5d8c10825fe7bf08d330542845340f88a2d4');
  assert.equal(digest(original), '206f6b435eda9cc3292ecf1e60d89449aadcb47c0f647a2f20751139336c9c7c');
  const metadata = await sharp(replacement).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 2242);
  assert.equal(metadata.height, 701);
});

test('rebranding changes new packet branding while restored historical reports and manifests stay byte exact', t => {
  const directory = mkdtempSync(join(tmpdir(), 'forma-retrace-branding-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const target = join(directory, 'demo');
  const seed = loadDemoSeed();
  assert.equal(seed.schema_version, 'forma-recap.synthetic-demo/1');
  setupDemo({ targetDir: target });
  const legacy = createStore({ dbPath: join(target, 'fixture.sqlite'), mediaDir: resolve(PROJECT_ROOT, 'server/media'), mode: 'fixture' });
  const review = createReviewStore({ dbPath: join(target, 'fixture-review.sqlite'), uploadDir: join(target, 'fixture-originals'), workspace: 'fixture', legacyStore: legacy, syntheticImportPath: resolve(PROJECT_ROOT, 'server/media/synthetic-recapture.png') });
  try {
    const preserved = [
      ...seed.tables.legacy.exports.map(row => ({ row, read: () => legacy.getExport(row.id) })),
      ...seed.tables.review.review_exports.map(row => ({ row, read: () => review.getExport(row.id) })),
    ];
    for (const { row, read } of preserved) {
      assert.equal(read().html, row.report_html);
      assert.deepEqual(read().manifest, JSON.parse(row.manifest_json));
      assert.equal(read().manifest.product, 'Forma ReCap');
    }
    const newLegacy = legacy.getExport(legacy.createExport().id);
    const newReview = review.getExport(review.createExport().id);
    for (const packet of [newLegacy, newReview]) {
      assert.equal(packet.manifest.product, 'Forma ReTrace');
      assert.match(packet.html, /<title>Forma ReTrace ·/);
    }
    for (const { row, read } of preserved) {
      assert.equal(read().html, row.report_html);
      assert.deepEqual(read().manifest, JSON.parse(row.manifest_json));
    }
  } finally { review.close(); legacy.close(); }
});

test('rebranded field workflow reads pending originals from the existing browser storage namespace', async t => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'indexedDB', originalDescriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  const row = await buildQueuedCapture({ workspace: 'local', project_id: 'old-project', assignment_id: 'old-assignment', assignment_revision_id: 'old-assignment-revision', item_revision_id: 'old-item-revision', file: new File(['unchanged original'], 'pending.png', { type: 'image/png' }), metadata: { date_precision: 'unknown', captured_at: null } });
  let opened: { name: string; version: number } | null = null;
  let closed = false;
  const database = {
    transaction(name: string, mode: string) {
      assert.equal(name, 'captures');
      assert.equal(mode, 'readonly');
      const transaction = {
        oncomplete: null as (() => void) | null,
        objectStore(storeName: string) {
          assert.equal(storeName, 'captures');
          return { getAll() {
            const request = { result: [row], onsuccess: null as (() => void) | null };
            queueMicrotask(() => { request.onsuccess?.(); transaction.oncomplete?.(); });
            return request;
          } };
        },
      };
      return transaction;
    },
    close() { closed = true; },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open(name: string, version: number) {
      opened = { name, version };
      const request = { result: database, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } });
  const queued = await listQueuedCaptures('local', 'old-project');
  assert.deepEqual(opened, { name: 'forma-recap-field-captures-v1', version: 1 });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].operation_id, row.operation_id);
  assert.equal(await queued[0].original_blob.text(), 'unchanged original');
  assert.equal(queued[0].status, 'pending');
  assert.equal(queued[0].metadata.captured_at, null);
  assert.equal(closed, true);
});
