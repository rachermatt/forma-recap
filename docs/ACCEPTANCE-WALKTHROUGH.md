# Saved acceptance workflow — 2026-10-19

This is the completed example saved in the actual application at **http://localhost:8080/**, not an isolated test database. It uses Northbank Research Center, Level 02, East wing supply air / Ductwork, and the fixed reference model `fixture-model-v7`. All evidence and quantity values in this example are explicitly **synthetic**. The imported PNG tests the photograph-import mechanism; it is not a real field photograph. No live APS project data or external writes were used.

The application still uses its existing React, Node and SQLite architecture and Forma Build style. The supplied logo PNG is unchanged. Historical scope assessments, placement events and existing packets remain preserved separately from individual element findings. Evidence workspace comes first in both navigation menus.

## Inspect the completed example

1. Open **Review log → Synthetic demo**. The register shows **2 captures with element review, 2 distinct elements reviewed, 3 current capture–element findings, 4 preserved element revisions, and 1 unassessed element**. These are review counts, not measured quantities.
2. Open the October 8 DUCT-03 finding. It remains **Needs review**, with the obscured-connection rationale and a separate image rectangle. **Open element review** selects that exact capture and element. DUCT-01 in the same capture is **Observed installed**; DUCT-02 remains **Not assessed**. DUCT-01 has two revisions, including the later correction.
3. In **Element review → Recapture & coverage**, inspect the DUCT-03 task. Owner: **Mechanical supervisor — synthetic pilot**. Due **2026-10-20**; evidence required before concealment on **2026-10-21**. The requested view is a close-up from below showing the coupling and terminal neck. Its history records request creation, evidence supplied, and a separate human reassessment.
4. Open the **October 18 synthetic test recapture** and DUCT-03. The new finding is **Observed installed**, with its own annotation and uncertainty about hidden fasteners, seals and inspection acceptance. Its task link retains the original October 8 finding, capture and model version. The original finding was not replaced.
5. Open **Reconciliation** for **2026-10-01 through 2026-10-19**. Five separate manual records retain their sources in [DEMO-MEASUREMENTS.md](DEMO-MEASUREMENTS.md): reported **12 m**, imagery-supported manual entry **9 m**, unresolved **Unknown m**, inspection **Unknown m**, and recorded approval **Unknown m**. Only the first two are comparable: **12 m − 9 m = 3 m**. No denominator was supplied, so completion remains unknown. Certification/payment references remain unavailable.
6. In **Local drafts**, open **Confirm terminal clearance and inspection requirements**. Its editable RFI has two saved revisions and selects the original gap plus the follow-up finding and both annotations. It retains location, elements, exact model version, capture/source references, requested clarification and proposed assignee. External submission is disabled.
7. In **Evidence packets**, inspect both new workflow packets and the two preserved historical packets. The earlier workflow packet has three finding revisions; the later one has four, including the subsequent correction. Each includes the five selected reconciliation rows, two draft revisions, task events, original media, separate annotation data, source/model references, identities, timestamps and a versioned manifest. Reload the application; the records remain available.

For a fresh installation, [restore the saved synthetic environment](DEMO.md) with `npm run demo:setup` and `npm run demo`. This retains the exact identifiers and records below without touching existing data. To build a new example instead, start an unreviewed workspace with `npm start`, use **Photographs & scope → Download synthetic test image**, and import the bundled PNG with capture date `2026-10-18T09:30:00-04:00`, timezone `America/New_York`, and a Level 02 terminal location. Create the October 8 findings and task first, then link the imported capture and choose **Reassess linked evidence**. Importing or linking evidence alone creates no finding. Use the manual source sheet above to enter reconciliation values. Existing local installation data remains separate from the published seed.

## Acceptance evidence

| Step | Result | Saved evidence and verification |
| --- | --- | --- |
| 1. Different findings in one capture | Passed | October 8 DUCT-01 observed installed and DUCT-03 needs review saved through the running UI. DUCT-02 has no element finding. Checked in the UI, API and frozen manifests. |
| 2. Annotation for unresolved finding | Passed | DUCT-03 rectangle `(x=.68, y=.27, width=.21, height=.27)` plus label is stored with its exact finding revision, separately from original media. Navigating away, reload, history expansion and report display retain it. |
| 3. Assigned recapture | Passed | Task contains exact originating finding/model/capture, reason, viewpoint, owner, deadline and before-concealment flag/date. UI and immutable task events verified. |
| 4. Subsequent evidence imported and linked | Passed with synthetic test imagery | PNG selected through the actual browser file chooser. Its exact bytes/hash are retained. Capture timestamp/offset/timezone and upload timestamp are separate. The intermediate saved state contained only the original two findings while the capture request was completed and human reassessment pending. |
| 5. Explicit subsequent assessment | Passed | New annotated DUCT-03 finding saved through UI, explicitly linked to the task and original revision. The October 8 needs-review finding and its references remain unchanged. Completing the request did not infer acceptance or approval. |
| 6. Populated reconciliation | Passed with authored manual test values | Five separate sourced records, matching units/scope/period/basis for the 3 m comparison, three unknown quantities, no completion percentage, and one observation per element across dates. UI, API, manifests and calculation tests verified. |
| 7. Editable local RFI | Passed | Saved and then edited in the UI; two immutable draft revisions, two exact finding references and selected annotations. No external record or submission endpoint exists. |
| 8. Review log and new packet | Passed | Main Review log distinguishes element and historical scope records. Both new HTML reports contain the identical manifest represented by their JSON counterpart. Original/display hashes and selected workflow records verified. |
| 9. Persistence | Passed | Server restarted, application reloaded, records revisited. Original task, imported capture, annotations, findings, quantities and draft survived. After the later correction, reload showed four finding revisions. |
| 10. Correction preserves earlier snapshot | Passed | DUCT-01 rationale corrected through UI after the first export. Its revision 1 remains in history. Earlier packet HTML and manifest response hashes remain identical; both pre-existing packets also remain identical. A separate second packet includes the correction. |

## Exact saved references

| Record | Identifier |
| --- | --- |
| Original DUCT-01 revision | `finding-revision-981836e7-f51a-44d4-bb5f-26fde4ad172a` |
| Original DUCT-03 gap | `finding-revision-79068110-da0d-4efa-aae9-32b28645fd33` |
| Recapture task | `recapture-b195736c-8900-4558-af18-06aa310f45ec` |
| Imported synthetic PNG capture | `photo-6026f353-e121-4a89-9896-d9e6c51e5a49` |
| Linked subsequent DUCT-03 finding | `finding-revision-49e6abf5-86cd-4c48-8a28-22082e61ef09` |
| Post-export DUCT-01 correction | `finding-revision-8e3b370a-272b-41ab-853f-bee592be8e55` |
| Local RFI | `draft-75098505-8965-4c35-b07d-9ea8f4685fbb` |
| First fixed packet, before correction | `packet-425f85fd-8739-4abe-a90f-2ac0943491d8` |
| Second fixed packet, with correction history | `packet-9d0865e3-85bf-459b-a204-2d19773b341a` |

The first packet's HTML SHA-256 is `c6be00357e572065c575d855c7c04d267648fa6b39063a79fddc77e84504ba5d`. Its raw API manifest response SHA-256 remains `cd4178574164edc0233046f893ffabb97893e90a09ba04bd7873c677e86c44b0`. The downloaded JSON is pretty-printed, so its file hash differs from the raw response while its parsed snapshot is identical. [Verification results](../examples/acceptance-verification.json) record both packets' hashes and the correction reference.

All rows in the pre-existing legacy database's five application tables were compared against the before-work backup: assessments, captures, exports, media and placement events are identical. Logical record SHA-256: `5de62e9b3b72ffffd21d5a4cb875c0d5a939d8b12d2b3b45aa8630bf02d0efa1`. SQLite file metadata may change when the database opens; record comparison and immutable packet hashes are the preservation evidence.

## Reports and visual checks

- [Current packet with all four finding revisions](../examples/acceptance-workflow-corrected.html), [matching JSON](../examples/acceptance-workflow-corrected.json).
- [Earlier frozen packet](../examples/acceptance-workflow.html), [matching JSON](../examples/acceptance-workflow.json), [PDF inspection copy](../examples/acceptance-workflow.pdf).
- [Saved Review log](images/acceptance-review-log.jpg), [annotation view](images/acceptance-annotation.jpg), [reconciliation view](images/acceptance-reconciliation.jpg), [browser report evidence view](images/acceptance-packet.jpg).

Both HTML reports were checked against their embedded/external manifests. The current HTML report was opened and visually inspected in the running browser, including the evidence image and saved overlay. The first fixed report was converted with LibreOffice Writer Web, rendered with Poppler and visually inspected on all 18 pages. Its PDF print copy flattens annotation previews only; original media and annotation records stay separate in the authoritative HTML/JSON. [IMAGE-RENDERING.md](IMAGE-RENDERING.md) explains the supplied PDF's lost gradient transparency, the lossless PNG display protection, and the exact Quartz re-export uncertainty.

Coverage in both new packets uses **7 calendar days as of 2026-10-19**. Latest usable October 8 DUCT-01 evidence is outdated; DUCT-02 has no individual evidence; October 18 DUCT-03 evidence is usable. Counts are `usable=1, unresolved=0, outdated=1, no_evidence=1, date_unknown=0`. The earlier unresolved DUCT-03 finding remains visible in the dated history and task origin. Unknown capture dates cannot establish freshness.

## Automated validation and boundaries

`npm test`: **77 passed, 0 failed**. `npm run build`: passed after the final navigation change. Focused tests cover independent states; append-only revisions and stale correction rejection; annotation bounds/original hashes; task/source/model relationships; evidence delivery without an automatic assessment; still-unresolved reassessment; workspace isolation; corrupt/mislabeled imports; unknown/date-only/offset-bearing dates; matching quantity units/scope/period/basis; null propagation; overlapping/duplicate scope; explicit denominators; selected workflow packet records; exact historical annotations; frozen snapshots; authenticated inline reports; CSRF; no Issue/RFI submission endpoint; live mode without fixture fallback; and server-held APS credentials/tokens.

The saved example was checked separately against the actual application database and API, rather than treating automated fixtures as proof that the UI workflow was saved. Preserved older packet HTML/JSON response hashes were checked before and after the correction. No new APS integration adapter was added.

## Remaining dependencies

- **Representative real photograph:** no authorized, representative project field photograph was available. The actual import/display/annotation/review workflow used a visibly labeled synthetic PNG. JPEG/PNG/WebP decoding, original-byte preservation and date variants are automated mechanism checks. The earlier concept-deck photographic composite remains an isolated QA sample, not field validation. Validate with an authorized original field photograph and its actual metadata before claiming real-project readiness.
- **Actual model and highlighting:** no readable project model/version/derivative URN, known actual format, region or confirmed per-user model permission was supplied. Intended-user consent and a confirmed project-bearing hub/project remain required. The existing app-credential check alone does not establish any of these. Manual fixture/local element associations and plan pins remain explicitly unverified. Resolve the server-held-token requirement before enabling an APS Viewer credential flow. See [MODEL-ACCESS.md](MODEL-ACCESS.md).
- **External Issue/RFI:** endpoint access, permissions, attachment upload/link verification, duplicate prevention and an explicit submission action remain dependencies. Local draft saving makes no external call.
- **Inspection, authorized quantities and payment:** no inspection record, verified approval authority, certification or payment reference was supplied. Their values remain unknown. Manual source values demonstrate reconciliation behavior only.
- **Original PDF exporter:** the supplied obstruction is reproducible in its PDF and explained by missing gradient alpha. New browser/HTML and LibreOffice PDF imagery are clear; the exact macOS Quartz export action has not been repeated.

Subsequent model-revision impact, collaborative review, schedule comparison, evidence search, turnover, pilot measurement, processing visibility and reviewed quantity exchange remain in [BACKLOG.md](BACKLOG.md), with dependencies and acceptance criteria. Automatic registration, geometric comparison, trade recognition and installed-quantity estimation remain research milestones.
