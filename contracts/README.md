# Proposed data contract

`assessment.schema.json` is a draft-2020-12 JSON Schema for the MVP reviewer-assessment interchange record. It is a proposal, not an Autodesk API payload or an existing application database schema. Do not send it to APS endpoints.

`example-assessment.json` is synthetic and deliberately does not invent a media hash, a real model URN, or underlying footage. It validates the shape, not an observation or visual workflow. The implementing application must supply an actual, clearly labeled fixture dataset to demonstrate the review UI.

## Application-level invariants beyond JSON Schema

- All source/capture/scope/element references must resolve within the authorized project and same data mode.
- In the MVP, every evidence entry's `capture_id` must equal `capture_ref.capture_id`. Different dates use separate assessments. Cross-date comparison context is not authoritative evidence for the selected date. Enforce this in the backend and export logic; JSON Schema alone does not compare these values.
- Element model/version IDs must match the selected model reference, unless a documented multi-model extension is implemented.
- Capture hashes must be computed from the actual stored originals. Evidence/derivative hashes and crop transforms belong to the media records and export manifest.
- Dates must be semantically consistent. For timestamp precision, retain the date in the original capture timezone alongside the timezone-aware timestamp; do not fabricate a timezone for date-only evidence.
- Scope membership, overlap, model-change warnings, and review-version transitions require domain validation.
- First revisions have no predecessor; later revisions reference the correct prior revision, remain append-only, and cannot cross projects or overwrite history.
- AI suggestion references, when present, must resolve to preserved inputs and outputs. The reviewer identity must be an authenticated human in live mode.
- Schema validation does not prove evidence sufficiency, installation, calibrated alignment, quantity, inspection, payment, or user authorization.

The initial placement contract deliberately fixes `is_verified_3d_registration` to false. A future automatic/verified-registration feature needs a new versioned contract with coordinate-system, transform, review, and evaluation records; do not switch this flag to true without that work.

Use a format-aware JSON Schema validator. Validate negative cases for unsupported states, missing evidence, date-only capture with an invented timestamp, a live record without a real hash, and a manual pin incorrectly described as verified registration. Add cross-record and authorization tests in the application.


## 0.2 coexistence

The 0.1 assessment schema remains the contract for historical scope-level records. New individual findings, annotations, recapture events, manual quantities and local draft snapshots use `schema_version: 0.2.0`, validated in server/review.ts and server/workflows.ts and documented in [NEXT-INCREMENT.md](../docs/NEXT-INCREMENT.md). No automatic conversion or fanout is performed. Export manifests retain their own version, workspace, source hash and full immutable histories.
