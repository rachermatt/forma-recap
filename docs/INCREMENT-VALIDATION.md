# Increment 0.2 validation · historical isolated QA

**Historical record:** these results document the earlier isolated QA run, not the current completed acceptance journey. They are preserved unchanged as prior evidence and are superseded for current acceptance by [ACCEPTANCE-WALKTHROUGH.md](ACCEPTANCE-WALKTHROUGH.md), which records the saved example in the running application, unified Review log, selected exports, recapture delivery/reassessment separation and rendering investigation. Test totals and limitations below describe that earlier run.

Validated locally on 2026-10-19 with Node 24.19.0. This records implementation and observed results, not a live APS certification. Read [source review](SOURCE-REVIEW.md), [implementation contract](NEXT-INCREMENT.md), [model access dependency](MODEL-ACCESS.md) and [subsequent backlog](BACKLOG.md) for scope and remaining work.

## Automated checks

`npm test`: **67 tests passed**, zero failures. This includes the original 35 checks plus 13 element/import/export checks, 15 workflow checks and four new HTTP journeys. `npm run build`: TypeScript and Vite production build passed. Vite emits non-blocking `use client` directive warnings from the existing lucide-react package.

The focused checks cover original media integrity, normalized annotations, independent element states, optimistic revision conflicts, immutable history, recapture reassessment, unknown/date-only/offset date precision, format/size/decode validation, workspace isolation, exact quantity comparability, unknown quantities, overlapping records, reporting-period boundaries, denominator rules, immutable draft references, selected historical annotations, CSRF, session/host/origin checks, disabled external operations and fail-closed live mode.

## Acceptance demonstration

Browser verification used an isolated SQLite data directory on localhost:8081. It did not modify the user's existing `data/fixture.sqlite`; the original database and pre-increment backup remained byte-identical (SHA-256 `a75435ee4bf5df80f949eecc2cb2db9aa1ca6aabfdd89990a9b2b53145763ac1`). The finished app runs on localhost:8080 with its existing scope records intact. A clean new element workspace has no implicit per-element findings.

| Criterion | Observed result |
| --- | --- |
| 1. Different elements within one capture | October 8 synthetic DUCT-01 retained Observed installed while DUCT-03 retained Needs review; DUCT-02 remained unassessed. Annotated DUCT-01 correction appended revision 2 and preserved revision 1. Older scope assessments stayed separate. |
| 2. Assigned recapture task | Created a DUCT-03 task from its exact unresolved revision, with mechanical supervisor, October 20 due date, required upward photograph and October 21 concealment reference. |
| 3. New evidence and reassessment | Linking October 15 evidence moved the task to awaiting reassessment. A new usable finding closed it. The original October 8 Needs review finding and all three task events remained. Unusable/identical/older evidence cannot resolve a task; a still-unresolved follow-up can be saved while the task remains open. |
| 4. Photograph import and annotation | Imported the unchanged 768×432 JPEG embedded in supplied deck slide 5. The image is a photograph/composite with a camera overlay, not validated pilot evidence. Date and location stayed unknown. Added a separate rectangle, selected a manually configured demonstration reference and saved a bounded finding. Downloaded original bytes matched the source exactly (SHA-256 `e0facb59057c0f3e3e323f74980249366c0627d61c2ec32c25753aaa31a3c5f9`). |
| 5. Distinct reconciliation records | Browser form saved synthetic trade report 12 m, separately recorded manual image-supported quantity 9 m and unknown unresolved quantity for another element. Inspection, approval, certification and payment records remained independently unknown. |
| 6. Units, unknowns, dates and deduplication | Matching dimensions produced a 3 m difference. No denominator meant no completion percentage. October 1–10 excluded the October 15 observation and showed the earlier unresolved terminal; October 1–19 showed the later observation. Each element counted once. Automated checks reject/suppress mismatched units, scope, basis, overlapping rows and unknown inputs. |
| 7. Local Issue/RFI draft | Saved and revised a local RFI with exact finding revision, selected image and annotation, location, proposed assignee and requested clarification. Preview and two draft revisions were inspected. External submission stayed disabled; no external record was created. |
| 8. History and fixed exports | Original scope/history/export checks passed. New HTML/JSON packets embedded original media, all finding/task/workflow histories, provenance and exact draft evidence. Later corrections cannot alter saved packets. Reports were opened and visually inspected. |

Desktop layout was checked at 1440×1000. At 319×900, document width remained 319 px and the sidebar folded off-screen after its transition. The original supplied logo remains unchanged (SHA-256 `206f6b435eda9cc3292ecf1e60d89449aadcb47c0f647a2f20751139336c9c7c`).

## Inspectable artifacts

- [Synthetic element/reconciliation HTML packet](../examples/element-review-synthetic.html) and [JSON manifest](../examples/element-review-synthetic.json).
- [Photograph import/local RFI HTML packet](../examples/photograph-import-demonstration.html) and [JSON manifest](../examples/photograph-import-demonstration.json). The provenance labels identify the concept source and unknown project/date/location.
- [Photograph review screenshot](images/photograph-review-preview.jpg) and [reconciliation screenshot](images/reconciliation-preview.jpg).
- Original 0.1 [HTML packet](../examples/synthetic-evidence.html) and [manifest](../examples/synthetic-evidence.json) remain unchanged.

## Capability status and limits

| Capability | Implemented | Locally checked | Live APS verified |
| --- | --- | --- | --- |
| Scope history and old fixed exports | Yes | Yes, original tests retained | No |
| Independent element findings and annotations | Yes | Yes, synthetic references and imported JPEG | No |
| Assigned recapture and coverage | Yes | Yes | No |
| Original JPEG/PNG/WebP import | Yes | Yes, genuine supplied JPEG plus decoder test rasters | Local files only; no APS import |
| Manual quantities, decisions and reconciliation | Yes | Yes, synthetic manual entries | No |
| Local editable Issue/RFI drafts | Yes | Yes | No external submission |
| Actual model display/highlighting | Gated | No representative BIM file/viewable available | No |
| External record/attachment creation | Disabled | Rejection boundary checked | No |
| Automatic measurement, registration, recognition | Research backlog | Not implemented or evaluated | No |

The local reviewer identity is self-asserted. Approval names/references are recorded manually and the app does not verify authority. Local photo sources and synthetic sources use separate databases and exports; neither is labeled as live APS evidence. Capture metadata is uploader-supplied, not independently validated against the site. Coverage uses explicit element findings and a stated freshness rule, not geometric image coverage. Export coverage records the default 14-day rule at export time; ad hoc coverage-view filters do not change stored configuration. Local storage is a loopback prototype, not an enterprise multi-user service.

Actual model viewing needs the intended user's consent and confirmed project-bearing hub, readable exact model version/URN, successful viewable and model-element mapping. A compliant Viewer authorization design must preserve the server-token rule. External Issue and RFI submission additionally needs verified product-specific endpoints, permissions and attachments, followed by explicit submission/idempotency/confirmation behavior. These gates and the remaining product increments are retained in [BACKLOG.md](BACKLOG.md).

## Current behavior after the acceptance-gap follow-up

The earlier default-only packet coverage note above is historical: new packets accept explicit coverage as-of and freshness inputs and retain them in the snapshot. Packet selection includes chosen reconciliation records and local drafts with their own histories; full element/task/source and historical scope histories remain included. The unified Review log displays element findings and their revisions separately from preserved scope assessments, with capture and element counts labeled independently.

Recapture delivery now completes the capture request without changing any finding; reassessment is a separate explicit human action and can remain unresolved. Its exact links to the original finding/capture/model are retained through later corrections. The synthetic workspace accepts only the server-bundled test PNG by exact byte hash, with forced synthetic labels. Other uploaded images remain isolated in the local workspace. Original media and annotation data are separate; trusted SVG fixtures use separately hashed lossless PNG display derivatives, also embedded separately in new packets. Existing fixed packets are not rewritten.

See the [current acceptance walkthrough](ACCEPTANCE-WALKTHROUGH.md) for the latest checks, saved record IDs, image-rendering findings, reproduction steps and remaining dependencies. Representative authorized construction-photograph and live APS model validation remain distinct from synthetic/import-mechanism checks.
