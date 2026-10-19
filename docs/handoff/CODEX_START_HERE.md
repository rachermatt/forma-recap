# Execution brief for Codex

## Mission

Build the first usable Forma Lens prototype from this handoff. The initial workflow supports a human reviewer reconciling one defined trade scope against dated site evidence and a fixed model reference. The application should make provenance and uncertainty clear.

Begin with implementation after inspecting this package and the target repository. This handoff authorizes the future coding task described in the kickoff prompt; it is not evidence that any application code or live integration already exists.

## Read first

1. `AGENTS.md`
2. `docs/01-product-scope.md`
3. `docs/02-architecture-and-data-model.md`
4. `docs/03-implementation-plan.md`
5. `docs/04-api-capability-register.md`
6. `docs/05-acceptance-and-validation.md`

Consult the remaining documents and contracts while implementing.

## Default decisions

- Working name: Forma Lens. Treat Forma ReCap as an alternative name and product-home hypothesis.
- Initial persona: superintendent or designated progress reviewer. Andrew/customer discovery can revise this.
- Example scope: ductwork on one floor. It is an example, not a proven easiest or highest-value trade.
- Placement: manual plan pins and explicit model-element associations. Do not describe these as automatic 3D registration.
- Assessment authority: a human reviewer. AI suggestions, if later introduced, remain separate until accepted or corrected.
- Initial output: an evidence packet and, after preview/approval, an Issue. Native Photos-gallery upload, native Issue pushpins, RFI automation, payments, and Tandem are not initial dependencies.
- Development mode: explicit `fixture` or `live`; reject unknown values. Never silently substitute synthetic data when live calls fail.
- Stack: retain a suitable existing repository's stack. For a greenfield implementation, prefer a supported TypeScript web stack, a relational database, private object storage, and a worker only where processing needs it. Verify current framework/SDK versions from official documentation before choosing them. Record the decision. Avoid microservices for the first slice.
- No committed dates or accuracy/ROI targets are established. Use phase exit criteria.

## First actions

1. Inspect the repository, existing instructions, source licenses, and reusable modules. Do not assume access to Matt's other application repositories.
2. Produce a brief implementation plan tied to Phase 0 and Phase 1 in `docs/03-implementation-plan.md`.
3. Make the core evidence/review journey runnable locally with synthetic inputs and explicit demo labeling.
4. Prepare live adapters behind feature flags. Where credentials are available, verify the smallest authorized read operation and record the actual result.
5. Build the evidence export before enabling write-back. Scope approval to the exact project, record payload, and evidence revision.
6. Report the runnable state and actual verification evidence; continue through authorized work rather than stopping after scaffolding.

## External inputs that may be missing

APS application configuration, authorized project access, a source model and version, a viewable plan, captures from at least two dates, capture-use permission, relevant reviewer roles, and supported Issue configuration. These are not included here.

Continue local implementation without inventing these inputs. A fixture-only path must use unmistakable synthetic IDs and must not reach live APS services. Ask for the minimum missing input when a live task actually depends on it.

## Definition of the first working slice

A reviewer can select a demo project/model version and scope, inspect two dated captures, save a source-linked assessment, revise it without losing history, and export the reviewed evidence. Closing and reopening the application preserves the records. The application visibly distinguishes manual placement, synthetic data, reviewer assessment, and any unverified capability.

Live Issues are a subsequent slice, not a condition for making the first slice runnable. An error or missing attachment after a live Issue create must not cause duplicate Issue creation on retry.

## What not to infer

The 41 APIs mentioned in Matt's developer setup are not a verified count of applicable services, an entitlement grant, or proof of a complete perception pipeline. ReCap desktop features and the separate Reality Solutions SDK are not automatically public cloud endpoints. An LLM description of an image is not a measured installed quantity. Review confidence is not calibrated model accuracy.
