import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DomainError } from './domain.ts';

type TrustedDisplay = { id: string; source_sha256: string; display_filename: string; display_sha256: string; width: number; height: number };
export type DisplayMedia = { body: Buffer; contentType: string; source_sha256: string; display_sha256: string; method: 'trusted_svg_lossless_png' | 'original_raster'; width: number | null; height: number | null };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(new URL('./media/display/manifest.json', import.meta.url), 'utf8')) as { media: TrustedDisplay[] };

/** Use raster derivatives for trusted fixture SVGs to avoid PDF gradient-alpha loss.
 * Originals are never changed. Arbitrary SVG uploads are not accepted or rendered here.
 */
export function displayMedia({ id, body, contentType }: { id: string; body: Buffer; contentType: string }): DisplayMedia {
  const sourceHash = sha256(body);
  if (['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    return { body, contentType, source_sha256: sourceHash, display_sha256: sourceHash, method: 'original_raster', width: null, height: null };
  }
  const trusted = manifest.media.find(entry => entry.id === id);
  if (contentType !== 'image/svg+xml' || !trusted || trusted.source_sha256 !== sourceHash) {
    throw new DomainError(409, 'A verified display derivative is unavailable for this source. Original evidence and prior packets are retained.');
  }
  let display: Buffer;
  try { display = readFileSync(new URL(`./media/display/${trusted.display_filename}`, import.meta.url)); }
  catch { throw new DomainError(409, 'The verified display derivative is unavailable. Original evidence and prior packets are retained.'); }
  if (sha256(display) !== trusted.display_sha256) throw new DomainError(409, 'The display derivative has changed. Original evidence and prior packets are retained.');
  return { body: display, contentType: 'image/png', source_sha256: sourceHash, display_sha256: trusted.display_sha256, method: 'trusted_svg_lossless_png', width: trusted.width, height: trusted.height };
}
