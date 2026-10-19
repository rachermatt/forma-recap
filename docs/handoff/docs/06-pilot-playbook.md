# Pilot playbook

## Purpose

Test whether connecting visual evidence to a defined trade scope makes progress reconciliation more useful and reduces review effort. This is a proposed workflow-validation approach, not an approved customer pilot, delivery commitment, or promise of measurable savings.

Start with one project, one floor or zone, one trade package, and at least two capture dates. Ductwork is an example to discuss with Andrew. Choose scope based on a real review decision and usable evidence.

The first workflow produces reviewer-assessed visual observations and traceable evidence. It does not establish installed quantities, inspected/accepted work, earned value, billable completion, or pay-application certification.

## Decisions to settle with Andrew

| Decision | Question to resolve | Output |
|---|---|---|
| User and decision | Who reviews the trade's progress, and what do they decide next? | One named role and a concrete weekly/monthly decision. |
| Initial value | Is the priority review efficiency, better evidence, earlier exceptions, or a different outcome? | A primary value hypothesis and supporting measures. |
| Scope | Which trade, floor, project condition, and installation stage can be observed usefully? | A bounded package with inclusions and exclusions. |
| Existing work | Which product, research, or partner work should this complement? | Appropriate internal connection and known dependencies. |
| Validation standard | What evidence would justify another increment, and what would change direction? | Agreed evaluation questions and decision owner. |
| Contribution | What customer discovery or workflow documentation can Matt contribute? | Specific next deliverable and owner. |

Document unresolved decisions explicitly. Do not replace missing answers with invented customer demand, a named pilot commitment, or an assumed product-team sponsorship.

## Candidate selection

Look for a project that has:

- A repeated progress-review decision and a reviewer who understands the selected trade.
- A defined scope that can be described in locations and, where available, model elements.
- Authorized access to a specified drawing/model version and representative imagery from multiple dates.
- Enough visible work and capture coverage to test the workflow; evidence gaps should be recorded rather than hidden.
- A willingness to share actual review effort and corrections so the workflow can be evaluated honestly.

Before involving project participants, establish the permitted purpose, access, data handling/retention, and whether live writes are in scope. Do not use customer data for model training by default. Any later training effort needs its own established data rights and permitted use.

## Proposed roles

Confirm actual owners before beginning; this table does not assign people to work they have not accepted.

| Role | Responsibility |
|---|---|
| Workflow sponsor | Confirms the decision being improved and evaluates whether the result is useful. |
| Trade reviewer | Reviews imagery, publishes observations, explains corrections, and identifies limitations. |
| Independent assessor, if available | Produces a separate reference assessment for evaluating agreement; does not treat the prototype output as ground truth. |
| Project data/access owner | Confirms project permissions, source versions, permitted evidence use, and retention. |
| Prototype developer | Implements and measures the workflow, maintains provenance, and documents technical limitations. |
| Discovery lead | Documents the baseline process, collects feedback, and produces the validation readout. Matt is a candidate for this role. |

## Baseline discovery

Observe or reconstruct the existing review before introducing the prototype. Ask the reviewer:

1. What progress question do you answer, for whom, and how often?
2. What scope and denominator are used today? How do people resolve differences in scope?
3. What evidence do you collect, and how much time do you spend finding and interpreting it?
4. Who accepts or disputes the assessment, and how is the disagreement resolved?
5. What happens when the imagery is unclear, the model is stale, or the work is concealed?
6. What action follows the assessment, and where is that action recorded?

Record the actual steps, time window, participants, inputs, and output artifact. Separate elapsed turnaround time from active reviewer effort. If reliable baseline data is unavailable, label results exploratory rather than reporting a savings claim.

## Trial procedure

### 1. Freeze the first comparison scope

Record project, zone, trade definition, model/drawing version, selected capture dates, and relevant exclusions. Create a manifest. Agree what the reviewer means by each assessment state using `05-acceptance-and-validation.md`.

Avoid expanding scope mid-comparison. If a change is necessary, version the scope and compare like-for-like results separately.

### 2. Confirm representative data

Check capture timestamps against upload timestamps, coverage, image quality, location mapping, and model applicability. Keep rejected or unusable data in the coverage log with reasons. Do not remove difficult examples solely because they make results worse.

The initial prototype may use manual pinning and model associations. Record that effort because it is part of the cost of the workflow.

### 3. Run the baseline and prototype workflows

Use comparable scope and information for both workflows. Record how the reviewer finds evidence, decides a state, resolves uncertainty, and produces the output. Where practical, use different review order or an independent reviewer to reduce memory and learning effects. Describe any unavoidable differences.

In the prototype, a reviewer chooses `observed_installed`, `not_observed`, or `needs_review`; links the evidence; and records reasons and limitations. The reviewer can correct findings, with history preserved.

### 4. Compare results and resolve disagreements

Compare assessments at the same scope and capture date. Categorize differences: capture coverage, model/scope mismatch, interpretation, data quality, or application error. When there is no independent reference, report agreement/disagreement rather than accuracy.

If a site inspection is used as a reference, record its date and scope. A later site visit may show work installed after the original capture and is not automatically a valid label for the earlier date.

### 5. Test the downstream action

Generate the evidence packet. Ask whether another participant can trace each finding to its source and understand unresolved items.

If Issue creation is enabled and approved for this test, preview the concrete record, obtain the user's approval, then create it in the authorized target project. Record partial attachment/link failures honestly. If live writes are not enabled, test a local Issue draft and label it accordingly.

Do not create an RFI simply because an image is ambiguous; the reviewer must decide whether the finding warrants that workflow and the adapter must support it.

### 6. Debrief and decide

Review the metrics and examples below with the workflow sponsor and trade reviewer. Decide to expand, revise, investigate a technical dependency, or stop. Record why, with an owner and next checkpoint for any follow-up.

## Metrics and interpretation

Agree the primary metric before the trial and report sample size. No numeric performance threshold is pre-approved by this plan.

| Measure | Suggested definition | Interpretation limits |
|---|---|---|
| Active review effort | Minutes of reviewer activity for a fixed scope and output, with evidence preparation measured separately. | A faster review with missing evidence is not necessarily a better result. |
| End-to-end turnaround | Time from availability of required inputs to a usable review output. | Separate service waiting time, reviewer availability, and capture delays. |
| Evidence retrieval effort | Time required to locate the source that supports a finding. | Use comparable questions and evidence sets; note learning effects. |
| Capture coverage | Portion of the agreed review scope with sufficient evidence, using a stated denominator. | Do not confuse coverage with installation progress or model completeness. |
| Assessment agreement | Agreement between independent qualified reviewers for the same scope/date; show the full state confusion table and disagreements. | Agreement is not accuracy; report the reference method and uncertainty. |
| Correction rate | Published findings revised, with reasons and timing. | Distinguish improved later evidence from mistakes in the earlier assessment. |
| Unresolved scope | Count/share of scope classified `needs_review`, with stated scope units and reasons. | A high rate may expose poor capture coverage rather than weak software. |
| Traceability completeness | Findings with complete capture, scope/model, reviewer, date, and evidence references. | Complete provenance does not prove the interpretation is correct. |
| Mapping/preparation effort | Time to upload, confirm dates, pin captures, define scope, and map model context. | Include repeat work after model updates; do not hide setup cost in claimed savings. |
| Downstream usability | Whether another reviewer can understand and use the packet or approved Issue without recreating context. | Collect examples and participant judgments; do not invent financial impact. |

A transparent effort comparison can be calculated as:

`net effort difference = baseline effort − prototype preparation effort − prototype review effort − correction/rework effort`

Report the time unit, scope, participant count, and any omitted recurring costs. Calculate processing/storage costs separately when measured. Do not extrapolate a small trial to portfolio ROI without explicitly modeling and validating the assumptions.

## Questions for the reviewer debrief

- Which decision became easier, and what changed because of the evidence?
- What took more effort than the existing process?
- Which finding would you challenge, and what evidence would resolve it?
- Did any label sound more certain than the evidence justified?
- Could another person reproduce your reasoning from the packet?
- Would you use this on the next review cycle? What must improve first?
- Is there enough value before automatic detection or quantity measurement is introduced?

## Go-forward decision

| Outcome | Evidence to seek | Next step |
|---|---|---|
| Continue the same scope | Repeat use improves a meaningful review task and evidence is traceable. | Repeat on another capture cycle to test whether setup cost and value persist. |
| Improve capture or mapping | Reviewers see value but coverage, timestamps, registration, or stale-model issues dominate. | Fix the limiting input/process and repeat the same scope. |
| Change the workflow | Review is faster but does not improve a decision, or the chosen user lacks ownership. | Revisit the user/decision with Andrew and the sponsor. |
| Investigate specialized technology | Manual review is useful but the next value depends on alignment, recognition, or measurement. | Create a bounded technical evaluation with suitable expertise, reference data, and explicit performance questions. |
| Stop or pause | Required data/access is unavailable, preparation cost dominates, or repeat use is not valuable. | Record the evidence and conditions that would justify reconsideration. |

Do not substitute pilot enthusiasm for evidence. Likewise, a trial blocked by input quality should be reported as blocked or inconclusive, not as proof that automated visual verification is impossible.

## Pilot readout to produce

Prepare one concise decision brief plus supporting artifacts:

1. Workflow tested, participants, scope, capture dates, model version, and mode.
2. Baseline process and the prototype process, with actual effort and limitations.
3. Metrics with definitions, sample size, and observed results.
4. A few traceable examples: useful finding, unresolved evidence, correction, and failure if encountered.
5. Measured technical and operating dependencies.
6. Recommendation, owner, proposed next step, and the evidence needed for that next decision.

Attach or reference the report manifest and permission-appropriate evidence. Do not send the brief or contact participants automatically; prepare it for Matt's review and use.

## Later AI work

Only after the manual evidence workflow is useful, consider a separate experiment that suggests observations for review. Keep evaluation captures separate from tuning examples, retain model/service versions and input references, and report scope-specific performance with uncertainty. Preserve all reviewer corrections.

Any automated quantity or progress-percent claim requires an explicit denominator, measurement method, reference labels, visibility/occlusion handling, and validation appropriate to the intended decision. Payment support adds further acceptance and commercial context that cannot be inferred from visible installation alone.
