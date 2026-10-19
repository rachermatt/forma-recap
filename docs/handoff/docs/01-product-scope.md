# Product scope — first workflow

## Context and objective

Matt proposed a broader reality-evidence concept spanning capture, model alignment, progress verification, Issues/RFIs, financial review, and handover. Andrew Burnett responded that individual trade progress verification is a major opportunity. This establishes shared interest, not a chosen trade, funded roadmap, product owner, or pilot commitment.

The first application should test whether linking dated visual evidence to a defined trade scope and model version makes progress review easier and more useful. Automation is introduced only as its value and reliability are demonstrated.

## Target user and decision

Proposed primary user: a superintendent or designated reviewer reconciling a trade's reported progress. Secondary users can inspect reviewed evidence and follow-up Issues according to project permissions.

Example decision: which portions of a ductwork package can be observed in a zone on a given capture date, which need clarification, and what should be followed up during planning or reconciliation?

Validate persona and trade with Andrew before committing to a customer pilot. The example does not establish the best observation conditions or economic value.

## Initial boundaries

One authorized project, one floor or small area, one explicitly selected trade scope, one fixed model version per assessment, and captures from two or more dates. Separate geometry/model metadata from the human-authored scope mapping. Maintain provenance for each mapping and revision.

### Included

- Local synthetic demonstration and optional live, authorized APS adapters.
- Project/model/plan selection, with explicit versions.
- A custom dated capture library and 360 viewing where inputs support it.
- Manual location placement and model associations, visibly labeled.
- Side-by-side date comparison and access to source evidence.
- Human review, notes, uncertainty reasons, correction history, and audit events.
- Reproducible evidence export with permission-safe references.
- Previewed and explicitly approved Issue creation after the supported API path is verified.

### Deferred experiments and integrations

- Automatic panorama-to-plan/BIM registration and camera localization.
- Automatic installed-quantity measurement or percent complete.
- Detection across arbitrary trades, sites, capture formats, or occlusions.
- Native Photos-gallery upload or native pushpin placement unless separately verified.
- Fully automated RFI routing, contract/cost/pay-application writes, or payment certification.
- Full ReCap processing parity, scan-to-mesh cloud invocation, a point-cloud streaming product, or digital-twin creation.
- Portfolio analytics, mobile capture apps, robot/drone control, and an enterprise rollout.

These are future possibilities, not rejected product directions. Keep their interfaces modular where reasonable without building them prematurely.

## User stories

| Story | Useful result |
|---|---|
| As a reviewer, choose a model version and trade scope before reviewing imagery. | Findings have an explicit design reference and scope. |
| As a reviewer, compare dated captures for one location. | I can find source evidence and distinguish capture time from upload time. |
| As a reviewer, associate a finding with model elements and mark uncertainty. | A non-observation does not become an unsupported absence claim. |
| As a reviewer, correct an earlier assessment. | The original assessment and reason for correction remain traceable. |
| As a project team member, inspect a reviewed evidence packet. | I can reproduce which source/model/revision supported the finding. |
| As an authorized user, approve a proposed Issue and evidence payload. | The follow-up reaches the intended project and retries do not duplicate records. |

## Product language

Use labels such as "Reviewer assessment," "Observed installed," "Not observed," "Needs review," and "Manually placed capture." Optional later outputs use "AI suggestion" until reviewed. Do not label visibility as certified progress or accepted work.

Distinguish capture date from installation date. A capture can establish first observed visibility in the available record; it does not necessarily establish when the work was installed.

## Success definition

First demonstrate a persistent, reproducible evidence-review workflow and safe live integration where authorized. In a pilot, compare review effort and agreement with independent reviewers against the current process. Record exceptions, corrections, and unusable captures. No accuracy, time-saving, revenue, or willingness-to-pay result is established by this package.

## Questions for Andrew

1. Which user decision and trade scope should be investigated first?
2. Is a location-based reviewed assessment sufficient, or are measured quantities essential to value?
3. Who should accept/correct the assessment, and what reference should validation use?
4. What relevant work exists, who can sponsor workflow discovery, and which product/research owner should review the results?
5. What evidence would make a follow-up discussion useful, and what outcome would change direction?
