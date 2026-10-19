# Reproduce the saved synthetic environment

This repository includes the completed human-reviewed acceptance example for Northbank Research Center, Level 02, Ductwork / East wing supply air, model `fixture-model-v7`. Every source is synthetic. The seed retains the saved identifiers and timestamps so [the acceptance walkthrough](ACCEPTANCE-WALKTHROUGH.md) and its exported packets refer to the same records after a fresh installation.

Use Node.js 24.19.0 or later:

```sh
npm ci
npm run build
npm run demo:setup
npm run demo
```

Open **http://localhost:8080/**. If the working app already occupies that port:

```sh
PORT=8081 npm run demo
```

The server stays on the local computer. The demo entry point imports the existing application without executing its `.env` loader and supplies blank APS credentials. It uses fixture mode even if the shell contains live-mode or credential variables. It does not establish live Autodesk access.

## What is restored

| Saved material | Included |
| --- | --- |
| Original scope workflow | Two synthetic captures and the plan; five placement events; three scope assessment revisions; two unchanged legacy packets |
| Individual findings | Three current capture–element findings, four revisions, independent DUCT-01 and DUCT-03 states, separate region annotations; DUCT-02 unassessed |
| Recapture | Assigned task, required viewpoint and deadline, before-concealment reference, supplied synthetic PNG, explicit subsequent assessment and three immutable task events |
| Manual reconciliation | Five separately sourced records, including reported 12 m, supported 9 m and unknown values; no completion percentage inferred from review counts |
| Local draft | One local RFI with two revisions and selected historical evidence/annotations; external submission disabled |
| Workflow packets | Two unchanged version 0.2 HTML reports, structured manifests and summaries; the earlier packet predates the later finding correction |

The uploaded synthetic PNG is the exact trusted file at `server/media/synthetic-recapture.png`. During setup its unchanged bytes are written into the isolated `fixture-originals/` directory using the original saved filename referenced by `review_media`. Its original capture timestamp, timezone and separate upload timestamp remain intact. Original SVG sources, separately hashed PNG display derivatives and annotation data retain their existing provenance. The seed contains no original local-photograph imports or live APS records.

## Isolation and retention

`npm run demo:setup` writes `data/demo/` by default. It refuses a nonempty target, validates the bundle before creating data, initializes the existing application schemas in a temporary sibling directory, inserts only allowlisted synthetic tables, verifies SQLite integrity and foreign keys, and publishes both databases and media together. It does not reset or copy the working application's databases, `.env`, credentials or local photograph workspace. Existing `data/` stays ignored by Git.

The demo writes its own reviews after startup. It does not overwrite them on subsequent starts. To create another untouched copy, choose a different empty path:

```sh
npm run demo:setup -- --data-dir data/demo-second-copy
PORT=8081 npm run demo -- --data-dir data/demo-second-copy
```

Keep the same path for both commands. Setup deliberately has no force/reset option. Back up a demonstration directory before removing it yourself.

## Inspectable seed and checks

`demo/synthetic-seed-v1.json` contains readable, versioned rows for explicit fixture and fixture-review table allowlists. `demo/packets/` holds the exact saved packet manifest, HTML and summary text, with file hashes referenced by the seed. No SQLite database, session state or `.env` file is published. The setup tool never reads the current installation databases; the checked-in seed is its only record source.

Validation requires the fixed synthetic project, model version, scope, element IDs and reviewer; rejects local/live namespaces, external records, enabled external submission and credential/session fields; verifies original-media and display-derivative hashes and snapshot hashes; and preserves exact packet bytes and revision links. The fresh-install tests compare all restored review rows and all four packet snapshots with the bundle. They also check non-overwrite behavior, neighboring-file preservation, unknown quantities, date precision and rejection of modified packet artifacts or foreign provenance.

```sh
node --test tests/demo.test.ts
npm test
npm run build
```

For the complete saved workflow and current integration dependencies, use [ACCEPTANCE-WALKTHROUGH.md](ACCEPTANCE-WALKTHROUGH.md). Representative real construction photographs, actual BIM viewables and external Issue/RFI writes remain separate validation dependencies.
