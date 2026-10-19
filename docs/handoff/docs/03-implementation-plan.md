# Implementation plan and backlog

Sequence work by dependency and evidence. This plan sets no calendar promises. Each phase should produce a runnable increment and a short status report. Advance only when its exit criteria are met or an explicit, documented reduced scope is agreed.

## Phase 0 — Inspect, decide, and establish truthful modes

| ID | Work | Exit evidence |
|---|---|---|
| P0-01 | Inspect the target repo, instructions, existing auth/UI/data modules, licenses, and relevant reusable code. | Document retained stack and gaps. If no repo exists, create a small application repository/branch without disturbing unrelated files. |
| P0-02 | Choose currently supported dependencies and deployment assumptions from official docs. | Record versions, rationale, local commands, storage/auth approach, and environment variable names. No secrets committed. |
| P0-03 | Implement strict `fixture`/`live` configuration and a capability status matrix. | Unknown modes fail. Synthetic screens/exports are visibly labeled. Live errors do not become synthetic success. |
| P0-04 | Revalidate the capability register for the first read adapters. | Endpoint version, region, authorization context, formats, required permissions, and any unresolved items recorded. Credentials unavailable means live unverified. |

Deliver: runnable shell, synthetic project/scope/capture definitions, setup guide, `.env.example`, and an honest status matrix. Do not create a login simulation that is indistinguishable from Autodesk authentication.

## Phase 1 — Local evidence-review journey

| ID | Work | Exit evidence |
|---|---|---|
| P1-01 | Persist project/model/plan/scope versions and dated captures. Keep capture dates separate from uploads. | Reopening the app preserves records. Date-only and unknown cases display correctly. |
| P1-02 | Build a capture timeline, media viewing, and manual plan placement. | Compare at least two dates for one location; each pin retains its plan version and manual-placement label. |
| P1-03 | Implement explicit scope/element associations and model-context UI. A synthetic model substitute is labeled. | Selected element references carry model versions; missing/mismatched models remain visible as unavailable rather than guessed. |
| P1-04 | Implement reviewer assessment creation/correction using the contract conventions. | Source-linked states, uncertainty reasons, reviewer/time, and append-only revisions work. |
| P1-05 | Create an evidence snapshot and reproducible export. | Export manifest identifies exact sources, dates, scope/model versions, reviewer decisions, and synthetic mode. Links/media behavior is explicit. |

Deliver: a complete local journey. Test this slice with the meaningful Phase 1 scenarios in the acceptance document. Fixture media/models should be generated or sourced with known rights, not presented as genuine jobsite evidence. The schema example in this package is not a full media dataset.

## Phase 2 — Authorized live project/model reads

| ID | Work | Exit evidence |
|---|---|---|
| P2-01 | Implement backend-managed Autodesk authorization with exact endpoint requirements. | An authorized test identity accesses the intended project; unauthorized identity/project requests fail. Auth tokens are not exposed to the browser unnecessarily. |
| P2-02 | Browse project folders/files/versions using Data Management. | Pagination, expiry, regional configuration, and missing permissions produce correct results. Record actual tested IDs only in a secure test log. |
| P2-03 | Render a supported model using APS Viewer and available derivatives. | Explicit version/viewable, relevant metadata, units/offset handling, and permission checks validated on sample data. |
| P2-04 | Replace synthetic references with live model/scope mappings and authorized capture uploads. | Prior fixture records stay isolated. A live capture-to-scope review/export can be reproduced. |

Deliver: working live read integration on the authorized project, plus a matrix separating locally implemented from live verified. Do not report a successful connection from OAuth success alone. Existing derivatives may be sufficient; do not assume every model can be downloaded/translated identically.

## Phase 3 — Approved Issue and evidence publication

| ID | Work | Exit evidence |
|---|---|---|
| P3-01 | Verify current Issue create, permission, project configuration, and evidence-attachment workflows. | Required fields/statuses/subtypes and storage/attachment contract confirmed against current official docs and target project. |
| P3-02 | Build immutable Issue preview and payload-scoped approval. | Exact target, evidence revision, fields, and attachments shown. Changes invalidate approval; fixture mode cannot execute live writes. |
| P3-03 | Implement durable operation records, create/readback, evidence upload/association, retry/reconciliation. | Test uncertain create outcome, duplicate clicks, expired authorization, attachment failure, process restart, and safe recovery. |
| P3-04 | Exercise the workflow in an authorized sandbox/test project with explicit approval. | Remote Issue ID, destination, returned status, evidence result, and audit trail verified. Clean up only if explicitly authorized and supported. |

Deliver: one supported evidence-backed write path. If native attachment validation blocks, offer the documented secured-link/export path and report that limitation visibly. It is not equivalent to a native attachment. Do not silently downgrade approved attachments to links or broaden an approval.

## Phase 4 — Bounded workflow validation

Use `docs/06-pilot-playbook.md` to settle the user, trade, scope, baseline method, independent review reference, and decision criteria. Agree participant/project access and use of data before involving a real project. This phase may begin only when the relevant application readiness and integration conditions hold.

Deliver: the pilot readout with observed results, unresolved cases, and a decision to continue, narrow, change, or stop. Customer interest, time saved, reviewer agreement, and commercial value must be measured or explicitly left unknown.

## Later experiments — individually scoped

| Experiment | Prerequisite | Evidence required before expanding |
|---|---|---|
| Visual search/captioning and change suggestions | Working evidence workflow and authorized model service | Source-linked retrieval, independent review, correction/abstention measures, model/prompt version traceability. |
| Automatic alignment | Representative captures, reference coordinates/poses, approved evaluation data | Explicit coordinate/format boundaries and independently measured alignment performance; handle failures without guessed mappings. |
| Photogrammetry | Supported inputs, access/cost understanding, asynchronous job lifecycle | Actual reconstruction, output inspection, provenance, failed-job recovery, storage/compute accounting. |
| Prepared reality/BIM overlay | Known format, licensed sample/code, trustworthy transform | Rendering and spatial fit reviewed; no implied quantity accuracy. |
| Trade detection/quantities | Defined trade ontology, ground truth, calibration, visibility policy | Detection/measurement evaluation separate from image descriptions and confidence scores. |
| RFI, Tandem, cost or pay-app integration | Validated domain use and current endpoint/auth/schema contracts | Human approvals and evidence traceability appropriate to the new decision; no inferred payment certification. |

Do not treat these experiments as automatic Phase 5 deliverables. Andrew/customer discovery should determine which one answers the next important uncertainty.

## Reporting template after each increment

1. What changed and which backlog IDs are complete.
2. Local commands actually run and results.
3. End-to-end journey exercised, with data mode and source provenance.
4. API capabilities implemented, locally tested, live verified, and blocked/unverified.
5. Known limitations that affect user decisions.
6. Next smallest useful task and any genuinely required external input.

Do not claim production readiness, automated progress verification, or validated ROI from successful scaffolding, compilation, mocked calls, or a polished demonstration.
