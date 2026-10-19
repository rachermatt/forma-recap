# Forma ReCap prototype brand assets

Replacement verification: the supplied original, project asset, and built browser asset have identical SHA-256 `206f6b435eda9cc3292ecf1e60d89449aadcb47c0f647a2f20751139336c9c7c`. The browser loaded the original 3440 × 1042 pixel PNG with proportional display sizing, `object-fit: contain`, and no CSS filter. The production build passed. [Application preview](images/logo-replacement-preview.jpg).

The active application logo is an exact copy of the user-supplied `Autodesk Forma ReCap.png`. The image is used without cropping, recoloring, regeneration, or other image edits. Ordinary CSS display scaling preserves its aspect ratio.

## Assets

| Asset | Intrinsic dimensions | Use |
| --- | --- | --- |
| `public/brand/autodesk-forma-recap.png` | 3440 × 1042 | Supplied PNG, unchanged, used in the application header |
| `public/brand/forma-recap-light.svg` | 240 × 48 | Alternate white lockup for a black or dark background |
| `public/brand/forma-recap-dark.svg` | 240 × 48 | Previous black lockup, retained as a historical alternate |
| `public/brand/autodesk-mark.svg` | 64 × 64 | Black Autodesk symbol on a white tile for the browser favicon |

The previous light and dark SVG compositions are historical alternates, not the active header logo. The logo accessible name is `AUTODESK Forma ReCap`.

## Reference provenance

The active PNG was supplied as `Autodesk Forma ReCap.png` and copied byte-for-byte to `public/brand/autodesk-forma-recap.png`.

The earlier prototype SVG compositions combined the three references below. Those original source files remain preserved unchanged in `public/brand/references/`:

- `Autodesk Forma logo.svg`: exact Autodesk symbol, `AUTODESK` and `Forma` outline geometry, isolated from the supplied square background using nested SVG viewports.
- `Autodesk logo.png`: reference for the white Autodesk symbol on black; the matching vector symbol from the supplied Forma artwork is used for sharp output.
- `Autodesk ReCap logo.jpeg`: reference for the `AUTODESK` / `ReCap` typography and stacked hierarchy. `ReCap` is newly outlined in Arial Regular to provide a clean scalable treatment in the combined lockup.

The earlier SVG compositions are retained for provenance. They are not used to reconstruct or alter the replacement PNG.
