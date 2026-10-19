/** Regenerate bundled PNG display derivatives without changing any original SVG bytes. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sources = ['fixture-plan', 'fixture-capture-01', 'fixture-capture-02'];
const media = [];
for (const id of sources) {
  const original = readFileSync(new URL(`../server/media/${id}.svg`, import.meta.url));
  const { data, info } = await sharp(original).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer({ resolveWithObject: true });
  writeFileSync(new URL(`../server/media/display/${id}.png`, import.meta.url), data);
  media.push({ id, source_filename: `${id}.svg`, source_sha256: sha256(original), display_filename: `${id}.png`, display_sha256: sha256(data), width: info.width, height: info.height, method: 'trusted_svg_lossless_png' });
}
writeFileSync(new URL('../server/media/display/manifest.json', import.meta.url), `${JSON.stringify({ schema_version: '1.0.0', purpose: 'Lossless display derivatives; original source media remains authoritative and unchanged.', renderer: `sharp/${sharp.versions.sharp} librsvg/${sharp.versions.rsvg}`, media }, null, 2)}\n`);
