import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { DomainError } from '../server/domain.ts';
import { displayMedia } from '../server/media-render.ts';
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');

test('trusted SVG display derivatives retain exact hashes, dimensions and source geometry across host fonts', async () => {
  for (const id of ['fixture-plan', 'fixture-capture-01', 'fixture-capture-02']) {
    const original = readFileSync(new URL(`../server/media/${id}.svg`, import.meta.url));
    const before = Buffer.from(original);
    const display = displayMedia({ id, body: original, contentType: 'image/svg+xml' });
    assert.equal(display.method, 'trusted_svg_lossless_png');
    assert.equal(display.contentType, 'image/png');
    assert.equal(display.source_sha256, hash(original));
    assert.equal(display.display_sha256, hash(display.body));
    assert.deepEqual(original, before);
    const dimensions = await sharp(original).metadata();
    assert.equal(display.width, dimensions.width);
    assert.equal(display.height, dimensions.height);
    // Bundled PNGs keep the reviewed text pixels on every host. A fresh SVG
    // rasterization can choose different Arial substitutes on Linux/macOS.
    // Compare the drawing and transparency away from text, without regenerating
    // either source or golden display. One-channel rounding may vary by CPU.
    const region = id === 'fixture-plan'
      ? { left: 90, top: 270, width: 820, height: 80 }
      : { left: 0, top: 65, width: 960, height: 410 };
    const expected = await sharp(original).extract(region).raw().toBuffer();
    const rendered = await sharp(display.body).extract(region).raw().toBuffer();
    assert.equal(rendered.length, expected.length);
    let maxDifference = 0;
    for (let index = 0; index < expected.length; index++) maxDifference = Math.max(maxDifference, Math.abs(rendered[index] - expected[index]));
    assert.ok(maxDifference <= 1, `${id} drawing differs by ${maxDifference} channel levels`);
  }
});

test('untrusted or changed SVG fails closed instead of reusing an unrelated display', () => {
  const body = readFileSync(new URL('../server/media/fixture-capture-01.svg', import.meta.url));
  for (const input of [
    { id: 'fixture-capture-01', body: Buffer.concat([body, Buffer.from(' ')]), contentType: 'image/svg+xml' },
    { id: 'unknown-source', body, contentType: 'image/svg+xml' },
    { id: 'fixture-capture-02', body, contentType: 'image/svg+xml' },
    { id: 'fixture-capture-01', body, contentType: 'text/html' },
  ]) assert.throws(() => displayMedia(input), (error: unknown) => error instanceof DomainError && error.status === 409);
});

test('validated raster imports remain byte-identical through display and do not acquire fixture provenance', async () => {
  for (const [format, contentType] of [['png', 'image/png'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp']] as const) {
    const original = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#8f9eab' } })[format]().toBuffer();
    const result = displayMedia({ id: 'private-import', body: original, contentType });
    assert.equal(result.body, original);
    assert.equal(result.contentType, contentType);
    assert.equal(result.method, 'original_raster');
    assert.equal(result.source_sha256, hash(original));
    assert.equal(result.display_sha256, hash(original));
  }
});
