# Forma ReCap

A local evidence-review prototype for comparing dated site captures against a defined model scope. Version 0.2 adds individual element findings, recapture tasks, local photograph import, manual progress reconciliation and local Issue/RFI drafts, while preserving historical scope assessments, corrections and fixed packets. The original proposal is in [the handoff](docs/handoff/CODEX_START_HERE.md); the requested product name **Forma ReCap** takes precedence over its earlier working name.

The interface follows the Forma Build visual references, with a white product header, light tool navigation and blue actions. The header uses the supplied **AUTODESK Forma ReCap** PNG unchanged, with proportional CSS display scaling. The previous SVG compositions remain historical alternates. See [appearance notes](docs/APPEARANCE.md) and [logo assets](docs/BRAND-ASSETS.md).

## Run

Requires Node.js **24.19 or later**. Get the source:

```sh
git clone https://github.com/rachermatt/forma-recap.git
cd forma-recap
```

For an initially unreviewed workspace:

```sh
npm ci --cache .npm-cache
npm run build
npm start
```

Open **http://localhost:8080/**. You can also double-click `Start Forma ReCap.command`. Keep its terminal open while using the application. The app binds to the local computer only.

The application defaults to `fixture` mode and runs locally without APS credentials. `.env.example` contains variable names and safe defaults only. For live APS project discovery, copy it to a private `.env` and supply your own application credentials and project-bearing hub. `.env` is ignored by Git and excluded from shareable bundles.

## Run the saved synthetic demonstration

The [hosted Vercel demo](https://forma-recap.vercel.app) presents the saved synthetic example as a public **read-only fixed snapshot**. [Vercel deployment notes](docs/VERCEL.md) explain its API adapter and storage boundary. Use the local commands below for editable review and photograph import.

The repository includes the completed acceptance example as a versioned, readable synthetic seed and preserved packet files. It restores the saved record IDs, annotations, correction history, recapture/reassessment links, manual reconciliation and local RFI draft. It contains no local photograph workspace, live APS data, credentials or sessions.

After installing dependencies and building:

```sh
npm run demo:setup
npm run demo
```

Open **http://localhost:8080/**. If another local instance is running, use `PORT=8081 npm run demo` and open **http://localhost:8081/**. The demo uses isolated `data/demo/`, does not load `.env`, and disables APS credentials. Setup refuses an existing nonempty target and leaves the working `data/fixture*.sqlite`, uploaded originals and `.env` untouched. Review edits in the demo persist independently.

See [demo setup and seed validation](docs/DEMO.md) and the [saved acceptance walkthrough](docs/ACCEPTANCE-WALKTHROUGH.md). To use a different new directory, pass the same `--data-dir` to both commands; the original working application still runs with `npm start`.

## Try the element workflow

Follow the [current acceptance walkthrough](docs/ACCEPTANCE-WALKTHROUGH.md) for the saved end-to-end example, record references, verification evidence and remaining dependencies. Evidence workspace comes before Element review in both navigation menus.

1. Open **Element review** and select **Synthetic demo**. Choose the October 8 capture and DUCT-01. Record an observed installation, a rationale and a rectangle marking the relevant image area. Select DUCT-03 in that same capture and save **Needs review**, with an occlusion reason. These are independent findings; older scope assessments remain separate.
2. In **Recapture & coverage**, create a task from the unresolved finding, assigning a person, due date and required viewpoint. Mark before-concealment evidence where relevant. In **Photographs & scope**, download and import the bundled synthetic recapture PNG with an explicit later demonstration capture date, then link it to the task. Supplying evidence completes the capture request and leaves human reassessment pending; it creates no installation, acceptance or approval decision. **Reassess linked evidence** saves a subsequent finding with exact links to the original task, finding, capture and model version. The new finding may still be **Needs review**. Earlier findings and task events remain preserved.
3. Inspect usable, unresolved, stale, undated and missing evidence using coverage date and freshness rules. Counts are unique elements, not installation quantities or completion percentages.
4. Switch to **Local photographs**. Configure one project, location/floor, trade package, exact model version and element IDs. These are **manual, unverified BIM references**, separate from the synthetic project and APS live mode. Configuration is fixed after evidence or review records exist.
5. In **Photographs & scope**, import a JPEG, PNG or WebP (up to 15 MiB and 50 megapixels). Supply source and location; explicitly choose unknown date, date only, or an offset-bearing timestamp. Upload time is recorded independently. The validated original bytes and hash are retained; annotation overlays never edit the file. Select the image and an element in **Element findings** to review it.
6. In **Reconciliation**, record trade reports, imagery-supported manual quantities, unresolved scope, inspection decisions, recorded approvals and certification/payment references separately. Blank quantity is unknown/null. Comparisons require matching scope, period, units and measurement/comparison basis. Observation counts across dates are deduplicated by element. A manual approval records its named approver/reference; the app does not verify that person's authority.
7. In **Local drafts**, select exact findings and their annotations, edit an Issue or RFI preview, and save/revise locally. External submission remains disabled; saving does not create an Autodesk record.
8. Open **Review log** to inspect individual element findings, their revisions and annotations alongside a separately labeled historical scope register. Capture-review counts and distinct element-review counts are labeled separately. In **Evidence packets**, select reconciliation records and local drafts, set the coverage as-of date and freshness window, and create a fixed HTML/JSON snapshot. All finding/task histories, original media, separate annotation data and model references remain included. Only selected workflow records and their revisions are included; later edits cannot change the packet. Each packet labels synthetic or local photograph provenance.

The synthetic workspace accepts only bytes matching the server-bundled recapture PNG; the server forces synthetic labels. Other images belong in the separate local workspace. Original SVG fixtures and raster uploads remain unchanged. Trusted SVG fixtures use separately hashed, lossless PNG display derivatives for consistent browser and report rendering; packets retain both the originals and display derivatives. Raster uploads display their original bytes.

Records persist separately in `data/fixture-review.sqlite` and `data/local-review.sqlite`; uploaded synthetic test media is private under `data/fixture-originals/`, and original local media under `data/local-originals/`. Back up the entire `data/` folder. Local reviewer identity is self-asserted, not an Autodesk identity. Local photographs are not uploaded to Autodesk.

## Preserve the original scope workflow

1. Open **Evidence workspace**. The project, model, plan and two capture illustrations are explicitly synthetic. Choose October 8 or October 15 on the capture timeline; compare the other date alongside it.
2. Check the mechanical scope and model version. Select the model elements that the evidence supports.
3. Choose **Move pin**, then click the plan to save a **manual plan pin**. Alternatively, use arrow keys and Enter; Escape cancels. This is an application association, not a verified camera pose or 3D registration.
4. Select **Observed installed**, **Not observed**, or **Needs review**. Enter a bounded rationale; the latter two require an uncertainty reason. Save the reviewer assessment.
5. Edit the review and save a correction. **Review log** preserves each revision, author, time, source hash, model version, and predecessor.
6. Create an **Evidence packet**, then download its HTML report and JSON manifest. The HTML contains the synthetic source illustrations and manifest for offline use. A later correction leaves the earlier packet unchanged.
7. Reload or restart the server. Reviews, pins, revisions, and snapshots remain in `data/fixture.sqlite`.

October 8 is date-only evidence, with no invented capture time. October 15 preserves the recorded `-04:00` offset and `America/New_York` source timezone. Upload times are independent. The illustrations and plan are original SVG fixtures generated for this prototype, not customer imagery. See [fixture definitions](server/fixtures.ts) and [domain rules](server/domain.ts).

## APS connection

Register an APS **Traditional Web App** with callback **http://localhost:8080/** and configure its client ID, secret and intended project-bearing hub in your private server environment. Credentials stay on the Node server; the browser receives only opaque session cookies. [Adapter and verification record](docs/APS-VERIFICATION.md).

To use read-only project discovery, stop the fixture server and run:

```sh
APP_MODE=live npm start
```

Open the **APS connection** tab, choose **Sign in with Autodesk**, complete consent if needed, then request projects. Use `localhost`, matching the registered callback, rather than `127.0.0.1` for this flow. The allowed hub is fixed server-side. Failure or missing access produces an error and never substitutes synthetic data.

Successful app authentication was checked separately. Real user consent, hub access, project membership and representative model access remain unverified until that flow succeeds. Live mode currently offers project discovery only; model viewing, APS capture import, live assessments and external Issue/RFI creation remain gated. The new local photograph importer is independent of APS and disabled in live mode. See the [exact model-access dependency and official API checks](docs/MODEL-ACCESS.md). No live Issue writes are enabled.

## Validate

```sh
npm test
npm run build
```

An [optional GitHub Actions template](docs/ci/README.md) provides the same checks plus demo setup. It is not enabled by this repository upload.

See the [current acceptance walkthrough](docs/ACCEPTANCE-WALKTHROUGH.md), [historical isolated 0.2 validation](docs/INCREMENT-VALIDATION.md), [implementation decisions and API](docs/IMPLEMENTATION.md), and [original acceptance scenarios](docs/handoff/docs/05-acceptance-and-validation.md).

The local installation retains its existing scope assessments and packets. A fresh installation using `npm start` starts unreviewed; `npm run demo:setup` restores the completed synthetic example into its isolated directory. An offline [sample HTML packet](examples/synthetic-evidence.html) and [JSON manifest](examples/synthetic-evidence.json) are included.

Earlier isolated QA samples, preserved unchanged: [synthetic element/reconciliation packet](examples/element-review-synthetic.html) and [photograph/local RFI packet](examples/photograph-import-demonstration.html) demonstrate the increment. The latter imports an unchanged photographic composite from the supplied concept deck, with a camera overlay and unknown date/location. It is mechanism validation, not verified construction evidence or representative real-photograph validation. The current acceptance walkthrough identifies the completed synthetic example separately.

## Boundaries

See the [source review](docs/SOURCE-REVIEW.md), [0.2 contract](docs/NEXT-INCREMENT.md) and [subsequent increments with dependencies and acceptance criteria](docs/BACKLOG.md).

This is a single-user loopback prototype. Local reviewer identities are explicitly self-asserted. It does not implement enterprise accounts, multi-user project grants, production storage encryption, malware scanning, cloud hosting, automated visual recognition, 360 panorama rendering, automatic registration, automatic measured quantities, or certification. Recorded manual quantities and approvals remain separate from image observations. A visible observation does not establish inspection acceptance, absence, contractual completion, or payment eligibility.

Original evidence hashes are checked before display/review/export. A modified or missing source is reported as changed/unavailable. Earlier evidence packets retain the embedded original bytes they captured. Database files remain until you intentionally remove or archive them. Back up the `data/` directory for local retention; source files in `server/media/` should remain unchanged.

The SQLite database is app-managed, with append-only revision/snapshot triggers. It is not a tamper-proof ledger against someone who controls the local filesystem. Live OAuth tokens remain only in server memory and are discarded at restart/local logout; persistence applies to local review records, not Autodesk login sessions.

All application code and SVG fixtures were authored for this prototype. External packages are installed from npm and pinned in `package-lock.json`; their original licenses apply. The handoff is retained unchanged as reference material, including its earlier name and proposed future phases.

See [NOTICE.md](NOTICE.md) for supplied branding/reference-image provenance and reuse boundaries. No open-source license has been selected for the application.
