# Evidence image rendering investigation

Reviewed 2026-10-19. This investigation keeps the source SVGs, supplied PDFs, and previously saved evidence packets unchanged.

## Reproduced in the supplied PDF

The supplied `Forma ReCap · Evidence workspace.pdf` contains opaque white ellipses covering the middle of both synthetic corridor illustrations and solid black blocks covering their lower portions. Rendering that PDF with Poppler reproduces the problem. The newer supplied PDF is a macOS Quartz PDFContext PDF 1.4 export dated 2026-10-19 13:37 EDT.

The source is recoverable and intact. The three embedded SVG images in the supplied historical HTML packet match the repository originals byte for byte:

| Source | SHA-256 |
| --- | --- |
| `fixture-plan.svg` | `b654f972a7bfb2ab7beb6e44ea3414cea4f9a564ef315a543f384cbc539b46d0` |
| `fixture-capture-01.svg` | `ffa399e8aea72b4e349e7173031783447ccf660f2ce3d2b65f119a4f28fd6948` |
| `fixture-capture-02.svg` | `f2ab815a5935b7e2e90956d932c9797e3e4e3a8e13db2a212a03e718a74656c8` |

Rendering either original capture with the existing Sharp/librsvg dependency shows the corridor, doors, floor, and ducts. It does not produce the opaque ellipse or black block.

## Identified export failure

The fixture SVG contains a white radial light gradient whose opacity decreases from 0.5 to zero. The application also places a transparent-to-black CSS gradient behind the bottom caption. The supplied PDF has converted those gradients to opaque RGB shadings:

- Radial shadings `/Sh5` and `/Sh13` have only white RGB samples (all channel values 255), with no corresponding soft mask.
- Linear shadings `/Sh6` and `/Sh14` have only black RGB samples (all channel values zero), with no corresponding soft mask.
- The page graphics states contain ordinary constant alpha values but no soft masks carrying either gradient's varying alpha.

Consequently, the shape and location of each PDF obstruction correspond to the source radial light and the caption gradient with their varying opacity lost. This is evidence of transparency loss in the supplied PDF export. It is not evidence that the original media is missing or damaged, or that a reviewer created a white annotation.

## Reproduction files

Read-only comparison intermediates are under `work/render-investigation/`: Poppler renders of the supplied workspace and element-review PDFs, Sharp-rendered original captures, extracted original SVGs from the historical packet, decoded PDF content, and `comparison-evidence.json` with hashes and shading inspection results. These are investigation files, not replacement evidence.

## Implemented display protection

`server/media-render.ts` serves a bundled, lossless PNG display derivative for each of the three trusted synthetic SVGs. The derivative is accepted only if the original source hash and bundled display hash match `server/media/display/manifest.json`. An unavailable, changed, or untrusted SVG fails closed with HTTP 409 rather than substituting a different illustration. Validated JPEG, PNG, and WebP imports pass through byte for byte as `original_raster`.

New legacy packet exports retain the original `snapshot.media` bytes and add `snapshot.display_media` with the source hash, display hash, method, dimensions, and separate PNG bytes. New HTML reports render the PNG derivative and label its provenance. Existing saved exports are read from their immutable database records and are never regenerated.

`scripts/generate-display-media.ts` can regenerate the bundled display assets using the existing Sharp dependency. It reads but never writes the SVG originals. Its generated manifest identifies the renderer and both source/display hashes.

The initial macOS verification compared every derivative's complete decoded pixels with a fresh Sharp rendering of its original SVG. Portable automated checks verify exact source/display hashes and dimensions, compare drawing/gradient regions away from host-dependent text with at most one channel level of rounding tolerance, reject changed/untrusted sources, verify untouched raster imports, and confirm that a later correction does not change an earlier legacy packet. Host font substitution can change a fresh SVG's text rasterization; the application always uses the fixed, hash-verified PNG rather than regenerating it on that host. The focused media and legacy-domain checks pass (15 tests).

## Browser and new PDF verification

The running application was inspected with the new PNG display URLs. The corridor imagery and separate annotation region render without the white ellipse or black block; `docs/images/acceptance-annotation.jpg` records the saved annotation view. The original SVG also rendered correctly in the initial browser check, consistent with the transparency loss being in the supplied Quartz PDF export.

The actual saved acceptance packet (`examples/acceptance-workflow.html` and its matching JSON manifest) was converted to `examples/acceptance-workflow.pdf` using bundled LibreOffice Writer Web. The resulting 18-page A4 landscape inspection copy was rendered with Poppler. All pages were visually reviewed, including the original corridor evidence, later imported synthetic recapture, selected draft evidence, annotations, model references, findings/revisions, reconciliation tables, recapture events, and preserved scope history. The white ellipses and solid black lower blocks are absent. Tables use explicit print-column widths; long references wrap inside their cells, and multi-page tables retain their headers. No clipped text, images, or overflowing columns was observed.

This PDF is a clearly labeled file-converter inspection copy, not the original macOS Quartz export action. The print copy omits the closed machine-readable details panel, fits images to the page, and flattens the same HTML annotation rectangles onto display previews because Writer Web does not preserve CSS absolute overlay positioning. The authoritative HTML, separate original media, annotation data, and JSON snapshot remain unchanged. The exact Quartz re-export has not been rerun.

All four original media hashes and their separate display hashes in the saved acceptance manifest were verified. The imported synthetic PNG passes through byte for byte; the three trusted SVGs have verified PNG derivatives. Conversion also checked that the source HTML remained byte-identical:

- Saved HTML SHA-256: `c6be00357e572065c575d855c7c04d267648fa6b39063a79fddc77e84504ba5d`.
- New PDF SHA-256: `d4afba6f5fe252f6990a96d1a4d6929457221bcab7c82a5a3ddbbfaa687c2967`.
- Converter: `LibreOfficeDev 26.8.0.0.alpha0 (AARCH64)`; PDF 1.7.

The helper, converter print copy, verification JSON, and page renders are under `work/render-investigation/`. The source report/manifest and previously saved packets were never modified by this conversion.
