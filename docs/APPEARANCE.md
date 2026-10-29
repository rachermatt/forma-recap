# Forma Build appearance refresh

Current product name: **Forma ReTrace**. The October 29, 2026 rename applies the revised PNG and current interface text; the dated sections below retain the original design history.

Requested October 19, 2026: align Forma ReCap with Forma Build and combine the supplied Autodesk, Forma and ReCap brand references into an `AUTODESK Forma ReCap` lockup.

## Reference

The starting point was [About Forma Build](https://help.autodesk.com/view/BUILD/ENU/?guid=What_is_Build) and its linked product documentation. The actual application screenshots used were:

- [Build Issues interface](https://help.autodesk.com/cloudhelp/ENU/Build-Issues/images/getting-started-essential-navigation.png), linked from [Issues Navigation Basics](https://help.autodesk.com/view/BUILD/ENU/?guid=Issues_Getting_Started_Navigation_Basic).
- [Forma project list](https://help.autodesk.com/cloudhelp/ENU/Build-GS/images/project-list.png), from [Navigate Autodesk Forma](https://help.autodesk.com/cloudhelp/ENU/Build-GS/files/Getting_Started_Navigation.html).
- [Tool navigation](https://help.autodesk.com/cloudhelp/ENU/Build-GS/images/tools-selection.png) and [Project Home](https://help.autodesk.com/cloudhelp/ENU/Build-Hub/images/project_home_overview.png).

The screenshots show a white application header with black branding, light tool navigation, blue selection states and primary actions, compact typography, thin gray borders, and small corner radii. The black banner on the Help site itself is not the application header.

## Applied design

- White global product header with the Autodesk Forma ReTrace PNG, project context, and explicit data-mode label. The original refresh began with a vector lockup, preserved as a historical alternate.
- Light side navigation with outline icons, blue active text and a blue selection rule.
- Neutral white/gray surfaces, blue buttons and links, flat panels, compact form controls and table rows.
- Underlined page navigation for the existing comparison, review log, evidence packets and APS views.
- Readable system typography, responsive navigation and stacked captures on narrow screens.
- Synthetic evidence labels, uncertainty states, correction history and disabled live-write boundaries remain explicit.

The source stylesheet was replaced with organized component rules. No API contract, assessment schema, database migration, live authentication scope, or evidence record change is part of this appearance update. Previously exported evidence packets retain their original immutable HTML.

## Logo assets

The header now uses [the revised Forma ReTrace PNG](../public/brand/autodesk-forma-retrace.png) (2242 × 701), copied unchanged from the selected logo edit. CSS scales its display proportionally without cropping, recoloring, or changing the selected file. The earlier [owner-supplied PNG](../public/brand/autodesk-forma-recap.png) (3440 × 1042), [black](../public/brand/forma-recap-dark.svg) and [white](../public/brand/forma-recap-light.svg) SVGs remain historical assets. The [favicon](../public/brand/autodesk-mark.svg) and original references remain available. See [brand provenance](BRAND-ASSETS.md) and [compatibility notes](REBRANDING.md).

## Validation

- `npm run build`: strict TypeScript and production build passed. The existing two non-fatal lucide-react `use client` notices remain.
- `npm test`: all 35 existing regression checks passed; no new implementation-mirroring style tests were added.
- Browser checks: desktop 1440 × 1000 and narrow 319 × 900 layouts fit without horizontal document overflow; all images loaded.
- Verified the combined SVG wordmark, sidebar and page-view navigation, review register, packet list, APS connection, mobile menu, source dialog, and Escape/focus return.
- A fresh browser session loaded the updated app with no console errors.
- Compared persisted API data before and after the visual review: both current findings, all three revisions, the existing packet reference, capture identities and manual pins remained unchanged.
- All three supplied logo reference files remain byte-identical in the project copy.

[Final desktop preview](images/build-style-preview.jpg)

## Sidebar spacing follow-up

Removed the repeated `Forma ReCap / Project tools` block from the left rail. At the checked 979 × 888 viewport, the project selector and Project Workspace navigation moved upward by 87 pixels. The Local Prototype and local reviewer panels retained exactly the same top and bottom coordinates. Production build passed. [Updated sidebar preview](images/sidebar-layout-preview.jpg).

## Navigation order

Evidence workspace precedes Element review in both the sidebar and horizontal tabs. Reviewing capture and scope context comes before recording individual element findings. Verified in the running application after a successful production build. [Navigation preview](images/navigation-order-preview.jpg).
