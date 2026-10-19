# Model access and format verification

Reviewed official APS documentation on 2026-10-19. No new APS read/write adapter or Viewer token endpoint is added by increment 0.2.

## What is verified

- The existing code implements server-side confidential OAuth and project discovery; its test fixtures verify boundaries, not live project authorization.
- The existing local source model is a **three-element reference fixture**, not an RVT/IFC/SVF/SVF2 file. Its drawings and captures are SVG illustrations.
- Local photograph workspace model/element identifiers are manually supplied references and explicitly unverified. Selecting an identifier or drawing an image rectangle does not validate geometric registration.
- Actual model format, version URN, region, successful derivative and per-user read permissions have **not** been established. No representative BIM file was supplied with this increment.

## Exact blocker

We need the intended user's completed consent, confirmed project-bearing hub and project, a readable version/derivative URN, and authorization to retain/view that model. The previously supplied hub may be an application-management Developer Hub; app credential validation does not prove it contains project data. No credential/token value is recorded here. Successful sign-in by itself would still leave model/capture/write access unverified.

## Documented integration checks before enabling a real model

1. Use the [Model Derivative reference](https://aps.autodesk.com/en/docs/model-derivative/v2/reference/) to check `GET /formats` for the actual input format, `GET /{urn}/manifest` for successful derivatives and `GET /{urn}/metadata` for views. A generic supported-format list is not a successful project translation.
2. Autodesk's [online model preparation guide](https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/basics/preperation/) describes SVF/SVF2 viewing and identifies external IDs as the persistent source-object linkage; per-translation dbIds can change. Preserve model version with each finding.
3. The [OAuth scope guide](https://aps.autodesk.com/en/docs/oauth/v2/overview%20%20/scopes) describes the restricted `viewables:read` Viewer pattern, which normally passes a token to browser JavaScript. The present product rule keeps credentials and tokens on the server. Resolve a compliant server proxy or explicitly revised authorization policy before introducing a Viewer credential endpoint. This increment exposes no APS tokens and relaxes no scope.
4. Validate actual user/model permissions, region, source-version mapping, selected-element highlighting and denied/expired/missing-model behavior before enabling viewing. Translation jobs are external operations and require a verified, explicitly authorized workflow.
5. Verify Issue and RFI endpoints and attachment flows separately. The official [Issues tutorial](https://get-started.aps.autodesk.com/tutorials/acc-issues/issues) is a contract starting point, not proof of this project's permission or attachment success. No external submission endpoint is implemented here.

Until those dependencies are met, the interface labels fixture model references and manually configured local references. Real photographs are imported locally; they are not represented as APS captures. Manual plan placement remains an association with explicit unverified alignment.
