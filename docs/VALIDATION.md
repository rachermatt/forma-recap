# Forma ReTrace validation record

Increment 0.2 is documented in [INCREMENT-VALIDATION.md](INCREMENT-VALIDATION.md): 67 passing checks, new element/photo/task/reconciliation/draft workflows and browser/export inspection. The record below preserves the earlier 0.1 validation.

Date: October 19, 2026. Scope: local Phase 0–1 workflow plus a read-only APS authorization/project-discovery adapter. The [original handoff acceptance contract](handoff/docs/05-acceptance-and-validation.md) remains the broader target; this record distinguishes the completed slice from future work.

The later [Forma Build appearance refresh](APPEARANCE.md) passed the same 35 regression checks and production build. Its browser and logo checks are recorded separately, with the existing evidence data preserved.

## Capability matrix

| Capability | Implemented | Local validation | Live verification | Limit / next gate |
|---|---|---|---|---|
| Explicit fixture/live modes | Yes | Strict mode and no fallback tests | No live project data | Restart required to change mode |
| One project / floor / ductwork scope / model version | Yes, synthetic | Scope/element/version invariants | No | Fixed scope; editing/multiple scopes deferred |
| Two dated captures and comparison | Yes, original SVG illustrations | Metadata and browser journey | No customer captures | File upload and 360 viewer deferred |
| Manual plan pins and associations | Yes | Persistence, coordinates, revision snapshots, plan integrity | No | No camera pose or BIM registration |
| Reviewer assessment and correction history | Yes | Append-only revisions, stale edit conflicts, uncertainty requirements | No | Explicit local fixture reviewer; no enterprise identities |
| Original evidence integrity | Yes | Changed/missing capture and reference plan detected | No live media | Local filesystem is under machine owner's control |
| Immutable HTML/JSON evidence packets | Yes | Snapshot/hash stability, embedded originals, escaping, source loss | No | HTML and JSON; no PDF/ZIP report API |
| Local resource checks and browser request security | Yes | Sessions, CSRF, Origin/Host, private resource IDs | No multi-user grants | Single-user loopback prototype |
| APS app-credential check | One minimal probe | Not a mocked success claim | HTTP 200 Bearer token | Does not verify user/hub/project access |
| APS confidential OAuth and token refresh | Yes | 18 mocked security/adapter tests | User consent not exercised | Server memory sessions; restart signs out |
| Fixed-hub project discovery and pagination | Yes | Mocked paging, expiry, permissions, safe links | Unverified | Requires user consent and actual data hub |
| Live file/model browsing and APS Viewer | No | Not tested | Unverified | Representative model/version and supported derivative needed |
| Native Photos, attachment and pushpin adapters | No | Not tested | Unverified | Separate current endpoint/permission validation |
| Live Issue publication | Disabled | No write endpoint; fixture attempts rejected | No writes attempted | Exact preview/approval/reconciliation/retry work deferred |
| Automated alignment, recognition, quantities | No | Not tested | Unverified | Outside this slice |

## Automated checks

`npm test` runs native Node test files:

- [Domain tests](../tests/domain.test.ts): persistence after reopening, capture/upload date separation, human fixture review authority, exact versions, scoped element references, immutable histories, stale/foreign predecessors, cross-date evidence rejection, pins and bounds, media/plan tampering, offline export reconstruction, SQL update/delete rejection, date-format invariants, and report escaping.
- [HTTP tests](../tests/http.test.ts): complete save/correct/export journey, session-protected media/exports, foreign resources, CSRF/Origin/Host checks, disabled Issue routes, invalid JSON bodies, OAuth callback cookie clearing, and live-mode isolation.
- [APS tests](../tests/aps.test.ts): fixture network isolation, missing config, browser-bound one-use state, token privacy, refresh rotation/concurrency, logout/expiry, fixed-hub paging and permission/network/format failures.

`npm run build` runs TypeScript strict checks and a Vite production build. Final integration: **35 tests passed, 0 failed** (18 APS, 12 domain, 5 HTTP). Production build and strict TypeScript check passed on Node 24.19.0, npm 11.17.0, TypeScript 7.0.2 and Vite 8.3.4. Vite emitted two non-fatal `use client` directive notices from lucide-react; this application uses a client-only browser bundle.

## Browser walkthrough performed

Tested in the Codex in-app browser, including its 319 px default viewport and a temporary 1440×1000 desktop breakpoint. Final layout checks reported document width equal to viewport width at both sizes, zero missing images and no current browser console errors. System fonts keep the app independent of external font services. Verified:

1. The rebuilt app opened without the initial session/bootstrap race; fixture identity and synthetic labels were visible.
2. Saved an October 15 `observed_installed` assessment, then corrected it to `needs_review` with a limitation. The UI showed revision 2 as current and revision 1 as preserved.
3. Moved the manual pin with keyboard controls. Cancelling restored the original pin; saving and reloading retained the committed pin. Existing review snapshots remained unchanged.
4. Saved a separate October 8 `not_observed` finding. Its date-only provenance remained distinct from the October 15 timestamp.
5. The Review log showed 2 captures, 2 reviewed captures, 1 current needs-review finding, and 3 preserved revisions.
6. Created an immutable packet and downloaded its self-contained HTML report. The sample files are [HTML](../examples/synthetic-evidence.html) and [JSON](../examples/synthetic-evidence.json).
7. Inspected the original source dialog and closed it with Escape. APS connection showed configured server-side credentials, fixture isolation and disabled external writes; no personal sign-in was attempted.

The live local database intentionally retains these clearly synthetic walkthrough records for inspection. The source ZIP excludes that database, so a fresh installation starts unreviewed. The sample packet remains available under `examples/`.

Secret scan passed: the supplied client secret was absent from source and browser build artifacts outside the private `.env`; its permissions are `0600`, and Git ignores it. The distributable source ZIP excludes `.env`, databases, installed dependencies and Git internals.

## Handoff scenario coverage

| Scenarios | Result / scope |
|---|---|
| A01 | Local review/correct/export workflow implemented; clearly synthetic, with external writes disabled. |
| A02 | Live bootstrap has no fixture entities. Missing configuration/authentication and upstream failures produce errors. |
| A03 | Fixed synthetic scope and exact model version are explicit. Scope editing and live selection deferred. |
| A04–A05 | Local opaque sessions and project-filtered resources tested. Real multi-user project grants, user-role revocation and live evidence permissions are deferred; mocked APS expiry/permission failures tested. |
| A06–A07 | Capture precision, timezone, source and upload separation tested against fixtures. User capture upload/metadata correction not implemented. |
| A08 | Manual pins persist and carry top-left coordinate space and reference-plan version; reviewed snapshots are immutable. |
| A09–A10 | Model version and duplicate/out-of-scope elements validated. Model-version switching, overlapping scope editing and conflict-resolution UI deferred. |
| A11–A13 | Required source/rationale/reviewer/version and uncertainty checks pass locally; no absence or certification inference. Live reviewer/import path deferred. |
| A14 | Separate findings by date and rejection of cross-date authoritative evidence tested. Automatic apparent-conflict detection deferred. |
| A15 | Immutable revisions, current predecessor, history and prior exports tested. |
| A16 | Changed/deleted source and changed plan detected; earlier packets retain embedded originals. |
| A17 | Fixed snapshot content/hash stable across exports; packet ID/time explicitly volatile. |
| A18–A21 | Live Issue flow deferred. No remote Issue/attachment records created; no simulated publication success. |
| A22 | APS project paging is implemented and mocked; live paging/region/rate-limit behavior unverified. Model processing deferred. |
| A23 | Local packets include current findings, corrections, scope/model/evidence and disabled Issue state. Partial remote Issue records not applicable while writes disabled. |
| A24 | AI suggestions unavailable; submitted suggestion or forged reviewer fields rejected. |

## Live probe

The sole live request was the official OAuth v2 app-only token endpoint with `client_credentials` and `data:read`. Result: **HTTP 200**, Bearer, 3599 seconds. Token discarded, no scope field returned, no project request or external data write. See [APS verification and sources](APS-VERIFICATION.md).

An APS Developer Hub UUID is not yet confirmed as the intended project-bearing Forma data hub. Successful end-user consent plus a project read is the next live gate. The developer application's selected API count is not treated as evidence of project entitlements.
