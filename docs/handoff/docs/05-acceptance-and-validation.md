# Acceptance and validation

This is an implementation contract for a future Codex build. No application has been built or validated by this handoff. Items below describe required behavior, test cases, and the evidence needed to call each increment complete.

The initial workflow is one authorized project, one floor or defined zone, one trade scope, and captures from at least two dates. Ductwork is a candidate trade to validate with Andrew; it is not a locked product decision.

## Meaning of an assessment

Only a reviewer can publish an initial-phase assessment. Use these states consistently:

| State | Meaning | Meaning it must not imply |
|---|---|---|
| `observed_installed` | A reviewer observed visual evidence of the defined scope in the selected capture. | Inspected, accepted, compliant, quantitatively complete, or payable. |
| `not_observed` | The reviewer did not observe the defined scope in the reviewed evidence. | The work is absent or definitely not installed. |
| `needs_review` | Available evidence or context does not support a sufficiently clear assessment. | A failed installation or a resolved exception. |

Do not calculate financial completion, certified quantities, or payment eligibility from these states. If displaying a count of reviewed model elements, label it as a count of assessments and disclose the selected scope; do not call that count a measured percentage complete.

## Validation layers

1. **Deterministic application checks:** schema validation, project isolation, assessment history, provenance, dates, report reconstruction, and Issue write retry handling.
2. **Adapter checks:** endpoint access, supported operations, expected permissions, pagination, version selection, and error behavior using a dedicated authorized test project.
3. **Workflow validation:** whether real reviewers can reconcile a defined trade scope with less effort and acceptable evidence. See `06-pilot-playbook.md`.
4. **Later AI evaluation:** separate from the initial application release. Suggestions must retain their origin and remain separate from reviewer findings.

Live credentials and customer imagery are not needed for deterministic checks. Live integration claims require a successful run with approved access and representative data.

## Required acceptance scenarios

| ID | Scenario and action | Required result |
|---|---|---|
| A01 | Start the application with a documented fixture dataset. Complete capture selection, scope selection, review, correction, and report export. | A reviewer can complete the full workflow. Every relevant screen and export identifies fixture mode. No live write is possible from fixture mode. |
| A02 | Start live mode without required configuration, authorization, or a reachable required service. | Show the missing prerequisite or service error. Do not substitute fixture data or continue with simulated success. Previously cached content, if supported, must show its source and retrieval time. |
| A03 | An authorized user selects a project, a model version, a floor/zone, and a trade scope. | Save a scope definition with project identity, exact model version, identifiers used to represent floor/trade, any manual mapping, and the person who created it. Show a readable scope summary before assessment. |
| A04 | A user enters another project's capture, model, assessment, or export identifier directly in a URL or API request. | Enforce authorization server-side for that resource and its project. Return no unauthorized data or existence details. Hiding a UI link is insufficient. |
| A05 | A user's access is revoked, an access token expires, or a project operation lacks the required permission. | Block new unauthorized reads and writes, explain the access issue, and preserve local unsaved input only as appropriate. Background work and exports must enforce the same access boundary. |
| A06 | Upload a capture from an earlier date today. Select it on the timeline. | Place it by capture timestamp, not upload timestamp. Preserve both timestamps and timezone/source information. Never silently infer a capture date from upload time. |
| A07 | Upload a capture with missing, ambiguous, or contradictory timestamp metadata. | Require a reviewer-confirmed capture date/time or explicitly mark the date as uncertain. Store the supplied value, source, and any correction. Do not place an uncertain capture into an exact chronological comparison without disclosure. |
| A08 | Pin a capture to a floor plan or associate it with model scope manually. | Mark the alignment method as manual. Persist the selected reference and transform/pin information. Reloading reproduces the placement. The UI must not label it automatically registered or geometrically verified. |
| A09 | A newer model version becomes available after assessments were made. | Existing assessments stay attached to the original version. Show that the model reference is older. Switching to a newer version requires a new explicit mapping/review decision; do not silently migrate element identifiers or overwrite prior records. |
| A10 | Two scope definitions overlap, contain duplicate elements, use conflicting units, or assign the same element to different trade packages. | Detect conflicts the system can determine and require explicit resolution or documented coexistence. Reports disclose scope boundaries and avoid silently counting the same finding twice. A manual zone-only scope is not represented as an element-level quantity. |
| A11 | A reviewer marks a scope `observed_installed`. | Require source capture, evidence reference(s), capture date/time with recorded precision/source (including disclosed unknowns), scope/model reference, reviewer, review time, and rationale sufficient to trace the finding. Every authoritative visual evidence entry belongs to the selected capture. Publish only after the reviewer confirms the assessment. |
| A12 | A capture is occluded, blurry, out of date, outside the selected zone, or does not show the relevant surface. | Support `needs_review` with a reason. Do not force a binary installed/missing decision. Show evidence limitations beside the finding and in exports. |
| A13 | A reviewer selects `not_observed`. | Display and export the meaning "not observed in reviewed evidence." Do not relabel it missing, late, defective, or uninstalled automatically. |
| A14 | A second capture shows a different condition or appears to contradict an earlier finding. | Allow separate findings for distinct capture dates and flag an apparent conflict for review where appropriate. Reject authoritative evidence references to another capture in the initial assessment contract; display cross-date images as context only. Preserve both observations. Do not treat every difference as installation, removal, or rework without review. |
| A15 | A reviewer corrects or supersedes a published assessment. | Append a new revision with author, timestamp, reason, and the prior revision reference. Preserve the previous assessment and show which revision is current. An earlier export remains reconstructable. |
| A16 | Delete or alter a local file after it has been used as evidence, or lose access to an external source. | Preserve reference metadata and the report manifest; identify evidence that is unavailable or changed. Apply the documented retention policy. Do not show a broken or changed reference as intact supporting evidence. |
| A17 | Generate the same export from a fixed assessment snapshot twice. | Assessment content, evidence manifest, scope/model references, and source hashes match. Generated-at timestamps or archive metadata may differ and must be identified as volatile. Corrections after the snapshot do not alter the earlier report. |
| A18 | A reviewer prepares a follow-up Issue from a finding. | Show target project, title, description, evidence, supported location/model context, and any unsupported fields before a live write. Require explicit user approval of the concrete Issue preview. Issue drafts are not presented as created records. |
| A19 | The Issue create request times out after the server may have accepted it, then the user retries. | Reuse a durable operation identifier; reconcile remote state through supported mechanisms before retrying. Never claim API-native idempotency unless documented. If remote state cannot be determined safely, show an indeterminate result and require reconciliation before another create. |
| A20 | The Issue record is created but one or more evidence attachment/link operations fail. | Preserve the remote Issue identifier, mark the operation partially complete, identify missing evidence, and retry only failed supported steps. Do not create a second Issue or report fully attached evidence. |
| A21 | The service rejects an Issue field, evidence attachment type, model link, or permission. | Surface the actual supported-operation limit. Retain the draft and offer the available evidence/link alternative only when it is supported. Do not fabricate a successful pin, attachment, or write-back. |
| A22 | A model or evidence response is paginated or processing is delayed. | Retrieve all required pages or visibly disclose partial results. Show pending/failed processing states. Avoid presenting an incomplete scope as the full trade package. |
| A23 | Export a report containing assessments, corrections, evidence limitations, and a partially completed Issue operation. | The export clearly separates reviewer observations from unresolved conditions and workflow outcomes. It includes the applicable model/capture versions and all data needed to trace every finding. |
| A24 | A later experimental AI suggestion is imported or generated. | Store model/service version and input references; label it a suggestion. It cannot become a reviewer-published finding, trigger an Issue, or affect any project control without review and the applicable explicit write approval. |

## Minimal report manifest

Every evidence packet must include or reference a machine-readable manifest with:

- Report/snapshot identifier, schema version, mode (`fixture` or `live`), generation time, and generating user.
- Project identifier and the exact floor/zone/trade scope definition used.
- Model source/version identifiers and the mapping/alignment method used for each capture.
- Capture identifiers, capture timestamps, upload timestamps, timestamp source, evidence references, and available content hashes.
- Published assessment revision identifiers, states, reviewer identities, review timestamps, rationales, and evidence limitations.
- Correction/supersession references and the source snapshot cutoff.
- Related Issue operation status and remote identifier if created; failures and missing evidence must remain visible.
- Metric definitions if any counts are displayed. No inferred financial completion or payment certification.

Record identifiers should be opaque in user-facing reports when possible, but identifiers alone must never grant access to evidence.

## Evidence to record when closing an implementation increment

For each completed scenario, record the implementation revision, test command or manual steps, dataset/mode, observed outcome, and relevant output artifact. Record a scenario as blocked when credentials, data, SDK entitlement, or an endpoint capability prevents validation. A blocked scenario is not a pass.

Use focused automated tests for authorization boundaries, historical revisions, capture-date logic, export reconstruction, scope conflicts, and retry/partial-success state handling. Use a browser walkthrough for the representative reviewer journey. Avoid tests that merely restate component internals.

Live adapter verification must record which operations were actually attempted and succeeded. A mocked adapter test cannot establish real APS compatibility, and a successful file read cannot establish Issue creation or attachment support.

## Completion gate for the first usable prototype

The prototype is ready for a limited workflow trial when:

- The end-to-end fixture workflow is reproducible and fixture/live separation is enforced.
- At least the required live read/view operations have been proven with authorized representative data, or the trial is explicitly limited to uploaded files with no claim of live APS integration.
- Project isolation, model-version provenance, assessment corrections, report reconstruction, and failure paths pass their applicable scenarios.
- Any enabled live Issue write has passed preview/approval, retry, and partial-evidence failure checks in an authorized test project. Otherwise keep Issue creation disabled and retain local drafts only.
- Remaining limits are documented in the app and pilot brief.

No schedule or model-accuracy target is implied by this gate. Any future AI performance target must be proposed with its dataset, unit of evaluation, and decision consequence, then agreed by the people evaluating the workflow.
