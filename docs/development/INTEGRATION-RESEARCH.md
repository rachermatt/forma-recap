# Integration feasibility and narrow validation workflow

Implemented locally in this increment: capability investigation records, evidence-backed asset proposals, exportable local Issue/RFI destination previews, a versioned local follow-up register, a frozen duct/terminal experiment protocol, split-controlled source cases, named manual/imported experiment proposals, independent reviewer decisions, and immutable held-out evaluation snapshots. No external record or production finding is created by any of these operations.

The additive `research_records` table stores append-only records scoped by workspace and project. It does not modify existing findings, quantities, task histories, original media or packet contents. `server/research-operations.ts` has no network client or external write adapter. The server rejects client-supplied verification flags and external receipts; manual investigation notes can describe untested, denied, unavailable or failed observations, but cannot assert successful live access. Corrected source findings flag current asset proposals for review while retaining the original evidence snapshot.

## Official documentation checked — 2026-10-27

| Capability | Current documented constraints | What this delivery can establish |
| --- | --- | --- |
| Issues | The [Forma Issues field guide](https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/issues) describes permissions, issue attachments and relationships. Placement/pushpin creation and updates are unavailable through the API; Photos uploads remain unsupported. Files references and direct attachments are distinct workflows. | A local draft and destination preview exist. Actual destination permission, attachment handling and a confirmed issue receipt remain unverified. |
| RFIs | Autodesk's [RFI v3 release guide](https://aps.autodesk.com/blog/autodesk-build-rfi-v3-api-released) describes project endpoints, `users/me`, types, workflow actions and permitted attributes. Response/official-response attachment handling uses Data Management; the virtual folder must exist before upload. | Live creation cannot be enabled by sign-in alone. RFI creation, evidence attachment and workflow transition need separate tested results. No write probe was performed. |
| Assets | [Managing Forma Assets](https://aps.autodesk.com/en/docs/acc/v1/tutorials/assets/manage-assets) requires configured project settings and authorized access. Batch fetches may omit missing requested entities, so clients must confirm each result; mutations require suitable OAuth scopes and the actual project's categories/statuses. | Manual item-to-asset identity confirmation and proposed status text are stored locally. A proposal is not a validated project transition or an asset update. |
| Tandem | The [Tandem Data API overview](https://aps.autodesk.com/en/docs/tandem/v1/) describes facility/property access. [Document linkage](https://help.autodesk.com/cloudhelp/ENU/Tandem-Facilities/files/tandem-docs.html) depends on classified assets and link parameters; document-version updates require an explicit action. | No authorized facility/schema or tested document mapping has been supplied. Local handover references do not establish transfer success. |
| Model viewing | [Model Derivative](https://aps.autodesk.com/model-derivative-api-2d-3d-conversions) produces Viewer-compatible derivatives; the [official Viewer tutorial](https://get-started.aps.autodesk.com/tutorials/simple-viewer/viewer/) loads an authorized URN and its viewable geometry. | The exact accessible source version/URN, supported format, derivative and user authorization remain required. Manual references do not establish registration. |

These are documentation checks, not account entitlement, project access or successful operation checks. The static capability matrix reports documentation separately from configuration, authentication, verified reads, verified writes and evidence attachment. Credential values and tokens are never present in these records.

## Exact live dependencies

1. An authorized Autodesk test project and intended user, plus product-specific entitlement and project membership.
2. Verified service configuration: Issues settings/current-user permission, RFI v3 type/workflow/actions, Assets category/status set, or Tandem facility/schema.
3. A server-side adapter with the required scopes, endpoint/version and evidence upload/attachment confirmation. The existing APS project-discovery adapter alone does not provide these.
4. An explicitly authorized test write with duplicate prevention, ambiguous-outcome reconciliation, a returned record identity and confirmed evidence links. No test record is created merely to check availability.

External publication remains disabled until those dependencies are implemented and verified. Exporting a destination preview is a manual fallback for review, not a claim that the destination accepted it. A manually supplied external reference is retained as unverified and cannot be substituted for an API receipt.

The local follow-up register retains an exact saved draft/evidence snapshot, proposed destination, responsible owner, due date, manually tracked state, reported external reference and reported response/source. Prepared, reported-awaiting-response, reported-response, manually closed, reported failure and unknown-outcome states are distinct. Updates append revisions; stale updates and duplicate draft/destination trackers are rejected. Later draft edits or finding corrections cannot replace the original snapshot. A typed status or reference remains explicitly unverified; no fabricated external receipt is created. Closing manual follow-up requires a reported reference, response and source basis and does not establish project acceptance.

## Duct/terminal validation protocol

The experiment workflow is usable without an AI service. It evaluates outputs from a named external experiment or manually entered protocol smoke test. It does **not** implement a detector, infer geometry, or demonstrate construction recognition accuracy.

1. Freeze intended use, source-use permission basis, independent ground-truth process, minimum held-out population, and classification/identity/stage/relative-measurement thresholds. Frozen protocols cannot be rewritten after seeing cases.
2. Add cases for exact existing captures and scope items. Reference labels separately describe object class, physical identity, visibility, installation stage and optional quantity. Unknown capture dates and null labels remain unknown. Every case retains original content hash and source precision.
3. Declare training or held-out status. The same media hash or known physical item cannot appear on opposite sides of that split. Duplicate source/item cases are rejected. Different views of a known held-out item do not add installed quantity.
4. Record a named run's proposal with separate alignment, identity, visibility and measurement indicators. Missing confidence remains null. An unsupported case can abstain; an abstention cannot claim a quantity.
5. Inspect original media and accept, edit, reject or abstain from the experimental output. Each decision is append-only. No decision changes a saved human finding, accepted quantity, asset or external record. Rejected proposals remain available.
6. Evaluate one explicit run against held-out cases only. Missing/abstained outputs remain in the known-label denominators. Classification, identity, stage and visibility metrics remain separate; independently calibrated positive reference quantities support relative error. Absolute errors across different units are not summed or averaged. Registration accuracy remains unavailable without independent registration truth.

Metric ground truth and predictions require a recorded independently validated scale/depth/known-dimension basis with the same unit. Ordinary photographs cannot supply metric truth. A quantity of zero is a known reference, distinct from null; zero references do not produce an invented relative error. Passing declared thresholds is labeled a protocol result, with production disabled. Synthetic-only evaluation is explicitly labeled a protocol smoke test.

Remaining FR-019/020 dependencies: a representative authorized construction dataset, independent reference labels and measurement/calibration process, an actual named detector/identity/measurement implementation, held-out execution and review of failure/abstention cases. This delivery provides the collection, review and evaluation mechanism, not those missing services or data.

## Validation

`node --test tests/research-operations.test.ts`: **10 passed**. Checks reject forged live-verification receipts, foreign project/workspace references, duplicates, stale asset/follow-up revisions, split leakage, uncalibrated metric quantities and mixed-run evaluation. They verify immutable source dates/hashes, correction-impact flags, retained rejected proposals, no mutation of human findings, unknown values, explicit evaluation denominators and append-only tables. Item-selected packet snapshots exclude off-scope cases, mixed-scope evaluation/follow-up records and global investigation notes.

All tests use synthetic in-memory records. No Autodesk network operation or recognition model is exercised by this suite.
