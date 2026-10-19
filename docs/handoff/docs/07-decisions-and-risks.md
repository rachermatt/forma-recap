# Decisions, assumptions, and open questions

## Decision status

| Item | Working decision | Status / revisit condition |
|---|---|---|
| Product name/home | Forma Lens working name; Forma ReCap and ReCap/Reality Solutions ownership remain hypotheses. | Unconfirmed. Andrew/product conversations decide direction. |
| User decision | Human progress reconciliation for one defined trade scope. | Proposed. Confirm user and operating decision in discovery. |
| Trade/project | One floor and ductwork example, two or more capture dates. | Illustrative. Select for useful value, visibility, capture practicality, and available references. |
| Review authority | Human reviewer; machine suggestions remain separate. | Initial design decision. Any expansion requires measured evidence and explicit scope. |
| Initial spatial method | Manual plan placement and model links. | Initial design decision; no automatic-registration claim. |
| Initial result | Reproducible evidence and an approved Issue write when needed. | Validate necessity with users. RFIs and financial writes deferred. |
| Stack | Reuse an appropriate target repo; greenfield supported TypeScript stack as default. | Implementation choice, not a product constraint. Verify current versions. |
| Data modes | `fixture` and `live`. | Enforced domain boundary, not a UI-only label. |
| API status | Public docs are a starting point; target-project execution is untested. | Update capability register with actual results. |
| Timeline/budget | No estimates committed. | Estimate after stack, access, data, and first vertical slice are understood. |

## Inputs and decisions to obtain

- Andrew: priority decision/persona/trade, relevant existing initiatives, useful next internal connection, and the evidence needed for further attention. His agreement does not establish project ownership, funding, or a pilot commitment.
- Matt and target project team: appropriate project/data access, capture-use permission, scope definitions, reviewers, baseline process, and practical capture cadence.
- Implementing team: current endpoint contracts and auth, storage/hosting, supported media/model formats, secret handling, dependency/source-code licenses, and operating costs.
- Relevant Autodesk product/research team, if needed: SDK access, reality-processing constraints, alignment/perception work already underway, and feasible collaboration path.

## Principal risks and the next useful response

| Risk | Practical response | Evidence that resolves uncertainty |
|---|---|---|
| Visibility/occlusion prevents conclusions | Allow unknown/non-observation and show coverage gaps. Select representative capture conditions. | Reviewers can explain which evidence is useful and which cannot support a conclusion. |
| Capture date, location, or model version is wrong | Preserve precision/source/version and require explicit mapping. | Known mismatch tests fail safely; exported findings reproduce their source references. |
| Model lacks usable trade attributes | Support manually authored scope mappings with provenance. | Reviewer can define the bounded scope without invented classification. |
| Workflow adds effort without useful decisions | Measure preparation and correction as well as review time. | Baseline comparison and documented user decisions. |
| APIs differ from product UI or older examples | Validate exact current endpoint/auth/format; keep adapters modular. | Small successful authorized calls and negative cases. |
| ReCap feature assumed to be a public cloud service | Separate photogrammetry API, native SDK, and product workflows. | Current supported contract or explicit team guidance. |
| Bad write/retry creates misleading or duplicate records | Exact-payload approval, persisted operation state, reconciliation, partial-result handling. | Timeout, duplicate-click, restart, and failed-attachment tests. |
| Export leaks evidence or loses context | Authorize access, avoid permanent signed URLs, preserve immutable manifests. | Download authorization and reproducibility scenarios. |
| AI overstates evidence or measured completion | Keep suggestions separate; evaluate independently; preserve abstentions and corrections. | Defined dataset and measured errors on the intended use. |
| Compute/storage economics are unknown | Instrument bytes, processing time, API/model use, retries, and retention. | Observed cost per reviewable capture/scope, not a speculative price model. |

## Gates that block only dependent work

- Missing APS credentials/project authorization blocks live calls, not fixture implementation.
- Missing real media/model blocks representative feasibility and pilot claims, not the local workflow.
- Missing SDK license blocks that SDK adapter, not the first evidence app.
- Unknown native pushpin/gallery-write support blocks those features, not custom pins/uploads.
- A failed perception experiment blocks claims about that automation; the reviewed-evidence workflow can still be evaluated independently.

Do not broaden access, invent source data, substitute undocumented endpoints, or report untested capabilities to bypass a gate.
