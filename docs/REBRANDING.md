# Forma ReTrace rename

On October 29, 2026 the owner requested the revised **AUTODESK Forma ReTrace** logo in the application and the new product name throughout the tool. The active logo is `public/brand/autodesk-forma-retrace.png`; interface titles, accessible branding, footer, current documentation and newly generated reports use **Forma ReTrace**.

The selected revised PNG remains unchanged in the application. Its native dimensions are 2242 × 701 and CSS preserves its aspect ratio. The original supplied logo and source-brand references remain preserved for provenance. See [brand assets](BRAND-ASSETS.md).

## Compatibility and historical evidence

The rename changes presentation, not the identity of saved scope, findings, captures, assignments or decisions. It does not move or rewrite the existing databases, original media, annotation data or append-only histories.

Previously generated HTML/JSON packets are fixed snapshots and retain their original product label and bytes. Original handoff documents, supplied document filenames, captured validation baselines and source-image references also keep their historical spelling. Actual Autodesk ReCap product and SDK references retain their official names.

Compatibility identifiers such as existing browser storage keys, schema identifiers and manifest element IDs remain stable so earlier saved browser work, seeds and consumers remain readable. The GitHub repository path and configured Vercel host retain their current addresses; changing a product name does not rename or redeploy either external service. New display labels and download filenames use ReTrace where they are not persisted compatibility identifiers.

A successful local rename does not confirm a production deployment or change live APS permissions. Existing fixture/local separation, original media hashes and disabled external write boundaries continue to apply.

## Verification

The production build and all 155 automated tests passed on October 29, 2026. Focused checks verify the selected PNG hash and dimensions, all four restored historical packet contents, new report and manifest product names, and access to pending field originals through the unchanged browser storage namespace. Original handoff files, seed, source media and saved example packets have no changes.

The running application at localhost:8080 was inspected: the header loads the new 2242 × 701 PNG proportionally, the browser title is `Forma ReTrace · Decision queue`, and the current workspace contains no old product label. [Current application preview](images/retrace-branding-preview.png).
