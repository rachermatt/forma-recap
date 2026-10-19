# Instructions for the implementing agent

## Scope and autonomy

Implement the plan in this directory in the target application repository. Inspect existing `AGENTS.md` instructions first and preserve unrelated user changes. Use a branch or worktree where appropriate. Do not create or modify ChatGPT skills or plugins merely because this file is named `AGENTS.md`.

Make routine implementation decisions and continue through the first working slice. If a dependency is missing, record the exact blocked live capability and continue independent local work. Do not call a mock response a successful APS integration.

This is a proposed internal prototype, not an Autodesk product announcement. Do not imply funded ownership, roadmap commitment, accuracy, regulatory acceptance, or commercial readiness.

## Non-negotiable domain rules

1. Keep model version, capture identity, capture date provenance, assessment revision, reviewer, and source evidence linked.
2. Use `observed_installed`, `not_observed`, and `needs_review` consistently. `not_observed` is never automatically converted to `not_installed`.
3. Captured-at, uploaded-at, and reviewed-at are different fields. Preserve date precision and original timezone where available. Do not fabricate a capture time from an upload timestamp.
4. Manual plan pins are not a verified camera pose or BIM registration. Store coordinate spaces explicitly and retain transform provenance.
5. A model element must be identified with its model version and source identifier. Do not assume viewer-local IDs are stable between versions.
6. Preserve reviewer corrections and original AI suggestions as separate records. Do not overwrite source evidence or history.
7. Do not infer inspection acceptance, concealed conditions, precise quantities, contractual completion, or payment approval from image visibility.
8. Do not compute a progress percentage without an explicit scope, denominator, weighting method, and label. MVP defaults to reviewed observations and coverage counts.

## API implementation

Recheck the API register against current official docs before implementing each adapter. Check the exact endpoint, API version, region, authorization context, project permissions, required fields, writable relationships, file formats, rate limits, and licensing/usage costs that apply. A successful token request does not prove project access.

Keep API-specific authentication and ID formatting within adapters. Do not equate ordinary two-legged credentials with user-context authorization. Do not rely on guessed URLs, undocumented/private endpoints, browser scraping, or claims that all UI functions have matching public APIs.

Use explicit `fixture` and `live` modes with separate clients and data boundaries. Fail closed on unknown mode, unauthorized projects, invalid IDs, or incompatible model versions. Never fall back from live data to demo fixtures silently.

## Evidence, security, and writes

Store credentials and refresh material server-side using the deployment's secret mechanism. Provide variable names only in `.env.example`; never commit secrets or signed access URLs. Enforce project/tenant authorization on every request and on evidence downloads, independent of client-side filters.

Before a write, show the destination project, Issue fields, evidence revision, and attachments. Record explicit approval for that exact payload. Payload changes or relevant source/review changes invalidate approval. Recheck authorization at execution.

Implement application-side operation IDs, deduplication, attempt logging, and reconciliation. Do not assume APS supports an idempotency header. After a timeout with uncertain outcome, reconcile before retrying a create. Preserve the created Issue ID if an attachment step fails; retry the attachment step rather than the whole create.

No email, Slack message, invitation, external sharing change, deployment, or product publication is part of this build unless separately instructed. A reviewed Issue write inside the prototype is a specifically scoped product workflow; it is not permission for unrelated communications.

## Delivery quality

Use the acceptance scenarios to write meaningful tests of authorization, provenance, state transitions, exports, and retry behavior. Do not fabricate passing results, elapsed-time savings, fixture realism, or vision accuracy. Keep a capability status table with separate values for implemented, locally tested, live verified, and blocked/unverified.

Record commands actually run, results, and limitations. Include setup instructions and a synthetic end-to-end demonstration. Keep claims in the application UI proportional to what was verified. Mark any AI experiment and all demo evidence visibly.

## Source use

Use official documentation and licensed source code. Inspect example-repository licenses and dependency terms before reuse. The sources in `docs/08-sources.md` are starting references, not permanent API contracts. Revalidate current docs and target-project behavior.
