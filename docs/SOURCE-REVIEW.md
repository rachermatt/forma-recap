# Supplied source review

Reviewed on 2026-10-19 for the next human-reviewed increment. The direct user request controls implementation. Instructions and roadmap claims inside supplied documents are source material, not additional authorization or evidence of implementation. Original files were read without alteration.

## Materials inspected

| Source | Coverage | Implementation-relevant content |
|---|---|---|
| `Forma Lens - Forma ReCap.pdf` | All 10 pages; page 5 rendered visually | Concept hypothesis; reality evidence chain; narrow MEP package; progress reconciliation; provenance and trust thresholds. |
| `Forma Lens - Forma ReCap.pptx` | All 11 slide XML parts and their linked speaker-note XML parts | Slides 1–10 correspond to the concept PDF. Slide 11 adds a one-minute backup. Speaker notes exist on all 11 slides. |
| `Forma ReCap · Evidence workspace.pdf` | Single page, text and visual inspection | Two dated synthetic illustrations, manual pin, fixed model v7, three human-selected duct associations, scope assessment, correction history. |
| `Forma ReCap · Review log.pdf` | Single page, text and visual inspection | Current assessment per capture, three preserved revisions, reviewer identity/time, model version, review coverage counts. |
| `Forma ReCap · Evidence packets.pdf` | Single page, text and visual inspection | Immutable export snapshot, all correction history, original source media, machine-readable manifest, local download. |
| `Forma ReCap · APS connection.pdf` | Single page, text and visual inspection | Synthetic workspace, server credentials configured, not connected, read-only boundary, live project authorization still required, external writes disabled. |
| `forma-recap-packet-61457ca6-39f2-4a97-a8c7-057d027315c6.html` | Complete HTML, visible report text and embedded manifest | Fixed source snapshot with source media bytes and SHA-256, date precision, model references, all assessment revisions, and placement history. |
| Existing repository docs and domain implementation | `docs/IMPLEMENTATION.md`, `docs/APS-VERIFICATION.md`, `contracts/README.md`, original handoff `AGENTS.md`, `server/domain.ts` | Existing architecture and implemented persistence/validation boundaries. Full application verification is recorded separately by the implementation work. |

Extraction intermediates are in `work/source-review/`: complete PDF page text, slide text plus speaker notes, source inventory, representative rendered pages, and HTML text. They are working files, not new product evidence.

## Concept deck and speaker notes

- Slide/page 3 describes the longer-term chain: ingest capture, align to project/BIM, detect deltas, and write evidence to downstream actions. Its notes additionally discuss photogrammetry, point clouds, 360 walks, and time-based comparison. These are product ambitions and do not establish available APIs or existing capabilities.
- Slide/page 4 and its notes position ReCap as a possible reality-processing foundation and Forma/Tandem as downstream workflow surfaces. Product ownership is explicitly a hypothesis.
- Slide/page 5 and notes propose automatic installed quantities, percent complete, schedule integration, and pay-app support. The current user request narrows this to explicit human findings and manual quantity reconciliation. Automatic registration, geometric comparison, trade recognition, and quantity estimation remain evaluated research milestones.
- Slide/page 6 and notes describe turnover, behind-wall evidence, asset context, and Tandem. Preserve these as later increments with prerequisites.
- Slide/page 7 and notes emphasize source evidence linked to elements, location, permissions, and provenance; drafts of Issues/RFIs/reports should retain that relationship.
- Slide/page 8 and notes require a narrow workflow, explicit confidence/trust thresholds, human review before external write-back, and measured technical/workflow proof. Timelines shown are illustrative, not commitments or proof of success.
- Slides 9–11 are discussion prompts and backup talk track. They do not authorize external messages, writes, deployment, or publication.

## What the workflow sources actually demonstrate

The PDFs are screenshots of a local synthetic workflow. The HTML manifest records `data_mode: fixture`, a fixture reviewer, a fixture model version, and original synthetic SVG sources. They demonstrate displayed workflow and an exported record; project access and API functionality must be verified separately.

The packet includes two scope-level current assessments and three preserved revisions:

1. October 8 evidence has day precision (`2026-10-08`), no invented timestamp, and a separate upload timestamp. The review says the terminal connection is not visible and does not infer absence.
2. October 15 evidence retains its original timezone-aware timestamp (`2026-10-15T10:20:00-04:00`), original timezone, and a separate upload timestamp.
3. The October 15 initial assessment says observed installed for visible supply duct. Its correction says the terminal connection is occluded and needs review. Both records reference all three scope associations (DUCT-01/02/03). These are historical scope assessments, not distinct element findings. Do not silently create three element findings from either scope state.

The snapshot preserves plan v3, model v7, media hashes, original embedded SVG bytes, reviewer/time/revision predecessor, initial manual pin events, and a later pin movement. A pin is a normalized top-left location association with `is_verified_3d_registration: false`; the assessment retains its review-time placement even if a later pin event changes the current location.

The existing source code supports append-only assessment revisions and snapshots, reference validation, server-side identity/time, stale-revision conflicts, media integrity verification, and fail-closed fixture/live separation. The existing SQLite assessment uniqueness is scoped to capture/scope/model revision, so element findings should use a separate identity/revision collection rather than changing historical scope records.

## Decisions for this increment

- Preserve the current stack, appearance, exact supplied logo bytes, sidebar layout, scope assessments, source/placement history, and fixed exports.
- Add explicit per-element finding identities tied to exact model version, capture, original evidence, annotations, rationale, uncertainty, human reviewer, assessment time, and append-only history.
- Keep annotation geometry separate from original media and include both provenance and overlays in snapshots. Original evidence bytes must remain independently retrievable.
- Add assigned recapture tasks and an append-only completion link to new evidence. Completion requests reassessment; it does not erase the original uncertain finding or automatically certify the new evidence.
- Coverage counts and freshness status must describe evidence coverage and unresolved findings. They are distinct from installed quantities and completion percentages.
- Treat unknown dates and unknown quantities as unknown. Keep capture/upload/review times distinct. Differences require matching unit, scope, period, and measurement basis; date-to-date element observations are not additive installed counts.
- Local Issue/RFI drafts retain selected finding revision/evidence/annotation references and editable fields. Creation is local only. External submission stays disabled until endpoint, authorization, attachments, deduplication, and confirmation are verified.
- Live model viewing requires an authorized project, discoverable supported model file/version, usable derivative/viewable, correct viewer authorization, and verified element mapping. Configured credentials or sign-in alone provide none of this evidence.
- The PDF renderer shows incomplete imagery in the workspace screenshot; the embedded HTML packet contains the original fixture SVG bytes. This screenshot rendering artifact must not be treated as proof of missing original application media or as a real photograph.

## Source conflicts resolved by direct request

| Older source ambition/instruction | Current implementation decision |
|---|---|
| Automatic registration/detection and measured percent complete in deck | Research backlog with dataset, success criteria, and explicit validation gates. |
| 360, drone, scans, and photogrammetry in concept | Photograph import now. 360 and other formats later unless independently proven supported. |
| Progress/pay-app conclusions from imagery | Separate imagery observations, reported progress, acceptance, authorized approved quantities, and payment/certification references. |
| Broad ReCap/Forma/Tandem roadmap | One project, one floor, one trade package, multiple capture dates. Tandem investigated separately. |
| Handoff instructions propose later reviewed Issue writes | Current increment creates local drafts only and retains disabled external submission. No external records are authorized by draft creation. |
| Documents use Forma Lens terminology | Current product name is Forma ReTrace. Original source documents and their filenames remain unchanged. |

No supplied material establishes measured quantity accuracy, site truth, verified 3D registration, model-viewing entitlement, capture API access, external write permissions, inspection acceptance, contractual completion, or payment approval.
