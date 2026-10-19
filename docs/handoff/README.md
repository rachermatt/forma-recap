# Forma Lens / Forma ReCap — Codex handoff

Prepared for Matt Racher on 2026-10-19. Internal working concept; the product name, product home, and roadmap are proposals.

## Start here

Give Codex this entire directory, then paste `prompts/01-kickoff.txt`. Codex should read `CODEX_START_HERE.md` and `AGENTS.md` before making changes.

**First build:** a working application for human-reviewed trade-progress evidence on one project, one floor, one trade, and at least two capture dates. Connect captures, a fixed model version, review decisions, and supporting evidence. Add live APS data and approved Issue creation incrementally.

This archive contains the plan and a proposed data contract. It does not contain a working application, APS credentials, customer footage, sample BIM files, or a trained vision model. No live project integration or perception accuracy has been tested.

## Desired first journey

1. Choose a project and an explicit model version.
2. Define a trade scope and floor/zone.
3. Upload or select dated captures; place them manually on a plan.
4. Inspect imagery alongside the relevant model context.
5. Record reviewer assessments with source evidence.
6. Export a reproducible evidence packet.
7. Preview and explicitly approve an Issue write when a follow-up is warranted.

Use the assessment values `observed_installed`, `not_observed`, and `needs_review`. A non-observation is not proof that work is absent. An observation is not inspection acceptance, measured quantity, or payment certification.

## Contents and reading order

| File | Purpose |
|---|---|
| `CODEX_START_HERE.md` | Execution brief, defaults, and first deliverable |
| `AGENTS.md` | Instructions for the implementing coding agent |
| `docs/01-product-scope.md` | User problem, workflow, scope, and success definition |
| `docs/02-architecture-and-data-model.md` | Application boundaries, records, provenance, and write flow |
| `docs/03-implementation-plan.md` | Dependency-ordered work packages and exit criteria |
| `docs/04-api-capability-register.md` | Source-backed APS capabilities and implementation checks |
| `docs/05-acceptance-and-validation.md` | Meaningful acceptance and integration scenarios |
| `docs/06-pilot-playbook.md` | Proposed customer validation method and metrics |
| `docs/07-decisions-and-risks.md` | Decisions, assumptions, constraints, and open questions |
| `docs/08-sources.md` | Official sources, short quotes, and verification boundaries |
| `contracts/assessment.schema.json` | Proposed assessment interchange contract |
| `contracts/example-assessment.json` | Explicitly synthetic example; no real capture or model |
| `prompts/01-kickoff.txt` | Copy/paste implementation kickoff |
| `prompts/02-capability-probe.txt` | Focused APS capability verification task |
| `prompts/03-review.txt` | Review prompt before handoff or a pilot |

`PACKAGE_MANIFEST.json` inventories the packaged files and their hashes. It excludes itself. `VALIDATION.md` records checks performed on this handoff, not on a future application.

## Evidence status

- Confirmed in user-provided correspondence: Andrew Burnett agrees that individual trade progress verification is a major opportunity.
- Proposed here: the first workflow, architecture defaults, development sequence, and validation approach.
- Documented by public Autodesk sources: file/model access, visualization, photogrammetry, and construction workflow APIs, within their documented limits.
- Unproven: automatic capture-to-BIM registration on representative sites, trade-level perception, installed quantities, commercial return, and enterprise readiness.

Use `docs/04-api-capability-register.md` as an implementation checklist. Public documentation is not a successful test against the target project's entitlements or data. Recheck current endpoints and versions when implementing.

## Work that can start immediately

Codex can inspect an existing repository or create a clean implementation branch, choose supported dependencies, implement the local evidence workflow, and run it with clearly labeled synthetic fixtures. Missing APS credentials should block live verification only. Fixture mode must never masquerade as a live integration.

## First implementation handoff

Return a runnable application, setup instructions, an environment-variable template, a working synthetic demonstration, test results, and an honest capability matrix. Identify live operations that were exercised, operations that remain unverified, and the next narrow task. A successful UI demonstration alone does not establish computer-vision accuracy or reliable progress verification.
