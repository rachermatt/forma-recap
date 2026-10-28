import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from './domain.ts';

type Json = Record<string, any>;
type Options = { db: DatabaseSync; context: () => Json; getItem: (id: string) => Json; getCapture: (id: string) => Json };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const fail = (status: number, message: string): never => { throw new DomainError(status, message); };
const text = (value: unknown, label: string, max = 6000): string => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail(400, `${label} is required (up to ${max} characters).`);
const optional = (value: unknown, label: string, max = 6000) => value == null || value === '' ? null : text(value, label, max);
function object(raw: unknown, allowed: string[], required: string[] = []): Json {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(400, 'Expected a JSON object.');
  const input = raw as Json;
  if (Object.keys(input).some(key => !allowed.includes(key))) fail(400, 'Unsupported research fields. Live verification and external receipts cannot be supplied by this form.');
  for (const key of required) if (!Object.hasOwn(input, key)) fail(400, `Missing ${key}.`);
  return input;
}
function choice(value: unknown, options: string[], label: string): string { return typeof value === 'string' && options.includes(value) ? value : fail(400, `Unsupported ${label}.`); }
function number(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fail(400, `${label} must be between ${min} and ${max}.`); }
function ids(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) fail(400, `${label} needs 1–100 identifiers.`);
  const result = (value as unknown[]).map(value => text(value, label, 250));
  if (new Set(result).size !== result.length) fail(400, `${label} contains duplicates.`);
  return result;
}
function officialUrl(value: unknown): string {
  const raw = text(value, 'Official documentation URL', 1000);
  let url: URL; try { url = new URL(raw); } catch { return fail(400, 'Use an official Autodesk HTTPS documentation URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !['autodesk.com', 'autodesk.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) fail(400, 'Use an official Autodesk HTTPS documentation URL.');
  return raw;
}

export const researchDocumentation = [
  { service: 'issues', operation: 'create_and_attach', documentation_url: 'https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/issues', required_permissions: 'Current-user issue create/update permissions; project settings; separately verified attachment or Files/Relationships access.', limitation: 'Placement/pushpin issues are read-only. Photos upload is not supported; direct issue attachments or Files references require their own tested workflow.' },
  { service: 'rfis', operation: 'create_and_transition', documentation_url: 'https://aps.autodesk.com/blog/autodesk-build-rfi-v3-api-released', required_permissions: 'RFI v3 users/me, project RFI type/workflow and per-record permitted actions/attributes; Data Management access for response attachments.', limitation: 'Use v3 project endpoints. Responses/official responses handle attachments; wait for the created RFI virtual folder before attachment upload. Creation alone does not confirm evidence attachment.' },
  { service: 'assets', operation: 'read_map_propose_status', documentation_url: 'https://aps.autodesk.com/en/docs/acc/v1/tutorials/assets/manage-assets', required_permissions: 'Verified project Assets access, configured category/status set, supported transition and relationship permissions.', limitation: 'Available status sets belong to actual project categories. This app has not fetched them; status text here is only a local proposal.' },
  { service: 'tandem', operation: 'asset_document_handoff', documentation_url: 'https://aps.autodesk.com/en/docs/tandem/v1/', required_permissions: 'Authorized facility, classification/schema/link parameters and verified property/document mapping.', limitation: 'Facility identity, schema and document transfer are unverified. A local reference is not a confirmed Tandem transfer.' },
  { service: 'models', operation: 'read_and_view', documentation_url: 'https://aps.autodesk.com/model-derivative-api-2d-3d-conversions', required_permissions: 'Exact source version/URN, user model access, supported derivative format, completed viewable and Viewer permission.', limitation: 'No exact authorized model/viewable has been supplied. Manual element associations are not verified registration.' },
].map(entry => ({ ...entry, documentation_checked_date: '2026-10-27', documentation_supported: true, configured: null, authenticated: null, live_read_verified: false, live_write_verified: false, attachment_verified: false, external_submission_enabled: false, blocker: 'No authorized destination and tested operation/attachment adapter receipt. Existing OAuth project discovery does not verify this capability.' }));

/** Local experimental and feasibility records only. No network client, production finding writer or external submission exists here. */
export function createResearchOperations({ db, context, getItem, getCapture }: Options) {
  db.exec(`CREATE TABLE IF NOT EXISTS research_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, workspace TEXT NOT NULL, project_id TEXT NOT NULL, record_json TEXT NOT NULL) STRICT;
    CREATE TRIGGER IF NOT EXISTS research_no_update BEFORE UPDATE ON research_records BEGIN SELECT RAISE(ABORT,'Research history is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS research_no_delete BEFORE DELETE ON research_records BEGIN SELECT RAISE(ABORT,'Research history is immutable'); END;`);
  function ctx(required = false): Json {
    const value = context();
    if (!['fixture', 'local'].includes(value.workspace)) fail(403, 'Research is limited to the separate local or synthetic workspace.');
    if (required && !value.project) fail(409, 'Configure a project before recording research.');
    return value;
  }
  function rows(kind?: string): Json[] {
    const c = ctx(); if (!c.project) return [];
    const values = db.prepare('SELECT kind,record_json FROM research_records WHERE workspace=? AND project_id=? ORDER BY rowid').all(c.workspace, c.project.id) as { kind: string; record_json: string }[];
    return values.filter(row => !kind || row.kind === kind).map(row => JSON.parse(row.record_json));
  }
  function persist(kind: string, fields: Json): Json {
    const c = ctx(true); const record = { schema_version: '1.0.0', record_id: `${kind}-${randomUUID()}`, workspace: c.workspace, project_id: c.project.id, data_mode: c.data_mode ?? c.workspace, recorded_by: c.reviewer?.id ?? 'local-reviewer', recorded_at: new Date().toISOString(), ...fields };
    db.prepare('INSERT INTO research_records VALUES (?,?,?,?,?)').run(record.record_id, kind, c.workspace, c.project.id, JSON.stringify(record));
    return clone(record);
  }
  function lookup(kind: string, id: unknown): Json { return rows(kind).find(row => row.record_id === text(id, `${kind} identifier`, 250)) ?? fail(404, `${kind} is unavailable in this workspace/project.`); }
  function scopedItem(id: unknown): Json {
    const c = ctx(true), item = getItem(text(id, 'Scope item', 250));
    if (!item || item.workspace !== c.workspace || item.project_id !== c.project.id) fail(404, 'Scope item is unavailable in this project.');
    return clone(item);
  }
  function scopedCapture(id: unknown): Json {
    const c = ctx(true), capture = getCapture(text(id, 'Capture', 250));
    if (!capture || (capture.workspace && capture.workspace !== c.workspace) || (capture.project_id && capture.project_id !== c.project.id)) fail(404, 'Capture is unavailable in this project.');
    if (!capture.capture_ref?.content_sha256) fail(409, 'An immutable source hash is required.');
    return clone(capture);
  }
  function currentFindings(): Json[] {
    const c = ctx();
    return [...new Map([...(c.finding_revisions ?? []), ...(c.scope_findings ?? []), ...(c.scope_finding_revisions ?? [])].filter(row => row.workspace === c.workspace && row.project_id === c.project?.id).map(row => [row.revision_id, row])).values()];
  }
  function saveCapability(raw: unknown): Json {
    const input = object(raw, ['service', 'operation', 'documentation_url', 'required_permissions', 'notes', 'observed_result', 'test_project_reference'], ['service', 'operation', 'documentation_url', 'required_permissions', 'notes']);
    return persist('capability', { service: choice(input.service, ['issues', 'rfis', 'assets', 'tandem', 'models'], 'service'), operation: text(input.operation, 'Operation', 250), documentation_url: officialUrl(input.documentation_url), required_permissions: text(input.required_permissions, 'Permissions'), notes: text(input.notes, 'Evidence notes'), observed_result: choice(input.observed_result ?? 'not_tested', ['not_tested', 'permission_denied', 'unavailable', 'failed'], 'manually recorded result'), test_project_reference: optional(input.test_project_reference, 'Test project reference', 500), evidence_basis: 'manual_unverified_note', live_read_verified: false, live_write_verified: false, attachment_verified: false, external_submission_enabled: false });
  }
  function latestAssets(): Json[] { const map = new Map<string, Json>(); for (const row of rows('asset')) map.set(row.proposal_id, row); return [...map.values()]; }
  function latestFollowUps(): Json[] { const map = new Map<string, Json>(); for (const row of rows('follow-up')) map.set(row.action_id, row); return [...map.values()]; }
  function saveFollowUp(raw: unknown): Json {
    const input = object(raw, ['action_id', 'previous_revision_id', 'draft_id', 'draft_revision_id', 'destination_project', 'owner', 'due_date', 'tracking_status', 'reported_external_reference', 'reported_response', 'basis'], ['draft_id', 'draft_revision_id', 'destination_project', 'owner', 'due_date', 'tracking_status', 'basis']);
    const prior = input.action_id ? latestFollowUps().find(row => row.action_id === input.action_id) ?? fail(404, 'Local follow-up unavailable.') : null;
    if (prior ? prior.record_id !== input.previous_revision_id : input.previous_revision_id != null) fail(409, 'Follow-up changed; reload its saved revision.');
    const c = ctx(true), candidate = (c.drafts ?? []).find((draft: Json) => draft.draft_id === input.draft_id && draft.revision_id === input.draft_revision_id);
    const preserved = prior && prior.draft_snapshot.draft_id === input.draft_id && prior.draft_snapshot.revision_id === input.draft_revision_id ? prior.draft_snapshot : null;
    const draft = candidate ?? preserved;
    if (!draft || (draft.workspace && draft.workspace !== c.workspace) || (draft.project_id && draft.project_id !== c.project.id)) fail(404, 'Select an exact saved draft revision in this project.');
    const destination = text(input.destination_project, 'Destination project reference', 250);
    const dueDate = text(input.due_date, 'Due date', 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(`${dueDate}T00:00:00Z`)) || new Date(`${dueDate}T00:00:00Z`).toISOString().slice(0, 10) !== dueDate) fail(400, 'Use a valid due date.');
    const state = choice(input.tracking_status, ['prepared', 'awaiting_response', 'response_recorded', 'closed', 'submission_failed', 'outcome_unknown'], 'manual follow-up state');
    const reference = optional(input.reported_external_reference, 'Manually reported external reference', 1000), response = optional(input.reported_response, 'Manually reported response');
    if (['awaiting_response', 'response_recorded', 'closed'].includes(state) && !reference) fail(400, 'This manual tracking state needs a reported external reference. It remains unverified.');
    if (['response_recorded', 'closed'].includes(state) && !response) fail(400, 'Record the reported response and its source before closing manual follow-up.');
    const duplicate = latestFollowUps().find(row => row.action_id !== prior?.action_id && row.draft_snapshot.draft_id === draft.draft_id && row.destination_project === destination);
    if (duplicate) fail(409, `This draft already has a follow-up for this destination: ${duplicate.action_id}. Revise it instead of creating a duplicate.`);
    return persist('follow-up', { action_id: prior?.action_id ?? `follow-up-${randomUUID()}`, revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.record_id ?? null, draft_snapshot: clone(draft), service: choice(draft.type, ['issue', 'rfi'], 'draft destination type'), destination_project: destination, owner: text(input.owner, 'Responsible owner', 250), due_date: dueDate, tracking_status: state, reported_external_reference: reference, reported_response: response, basis: text(input.basis, 'Tracking/response source basis'), identity_basis: 'manually_recorded_unverified', external_record_id: null, external_receipt_verified: false, attachment_verified: false, external_submission_enabled: false, findings: (draft.evidence ?? []).map((entry: Json) => entry.finding).filter(Boolean) });
  }
  function saveAssetProposal(raw: unknown): Json {
    const input = object(raw, ['proposal_id', 'previous_revision_id', 'item_id', 'finding_revision_ids', 'target_project_id', 'asset_reference', 'proposed_status', 'mapping_status', 'rationale', 'external_reference'], ['item_id', 'finding_revision_ids', 'target_project_id', 'asset_reference', 'proposed_status', 'mapping_status', 'rationale']);
    const item = scopedItem(input.item_id); const revisions = ids(input.finding_revision_ids, 'Supporting finding revisions');
    const findings = revisions.map(id => currentFindings().find(row => row.revision_id === id) ?? fail(404, 'A supporting finding is unavailable.'));
    if (findings.some(finding => finding.workspace !== item.workspace || finding.project_id !== item.project_id || (finding.item_id ?? `element:${finding.model_ref?.element_id}`) !== item.item_id)) fail(400, 'Each supporting finding must concern the exact selected item and project.');
    const prior = input.proposal_id ? latestAssets().find(row => row.proposal_id === input.proposal_id) ?? fail(404, 'Asset proposal unavailable.') : null;
    if (prior ? prior.record_id !== input.previous_revision_id : input.previous_revision_id != null) fail(409, 'Asset proposal changed; reload its saved revision.');
    const fields = { item_id: item.item_id, item_ref: item, finding_revision_ids: revisions, findings: clone(findings), target_project_id: text(input.target_project_id, 'Destination project', 250), asset_reference: text(input.asset_reference, 'Asset reference', 500), proposed_status: text(input.proposed_status, 'Proposed status', 250), mapping_status: choice(input.mapping_status, ['confirmed', 'unresolved'], 'mapping state'), rationale: text(input.rationale, 'Proposal rationale'), external_reference: optional(input.external_reference, 'Manually supplied external reference', 1000) };
    const duplicate = latestAssets().find(row => row.proposal_id !== prior?.proposal_id && row.item_id === item.item_id && row.target_project_id === fields.target_project_id && row.asset_reference === fields.asset_reference && row.proposed_status === fields.proposed_status);
    if (duplicate) fail(409, `A local proposal already exists for this item/asset/status: ${duplicate.proposal_id}. Revise it explicitly.`);
    return persist('asset', { ...fields, proposal_id: prior?.proposal_id ?? `asset-proposal-${randomUUID()}`, revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.record_id ?? null, status: 'local_proposal', project_status_set_verified: false, external_reference_verified: false, external_record_id: null, external_submission_enabled: false });
  }
  function saveExperiment(raw: unknown): Json {
    const input = object(raw, ['name', 'intended_use', 'permission_basis', 'ground_truth_process', 'thresholds', 'minimum_held_out', 'scope'], ['name', 'intended_use', 'permission_basis', 'ground_truth_process', 'thresholds']);
    const thresholds = object(input.thresholds, ['classification_accuracy', 'identity_accuracy', 'stage_accuracy', 'measurement_relative_error'], ['classification_accuracy', 'identity_accuracy', 'stage_accuracy', 'measurement_relative_error']);
    for (const [key, value] of Object.entries(thresholds)) number(value, key, 0, 1);
    const minimum = number(input.minimum_held_out ?? 20, 'Minimum held-out cases', 1, 10000); if (!Number.isInteger(minimum)) fail(400, 'Minimum held-out cases must be an integer.');
    return persist('experiment', { name: text(input.name, 'Experiment name', 250), intended_use: text(input.intended_use, 'Intended use'), permission_basis: text(input.permission_basis, 'Source permission basis'), ground_truth_process: text(input.ground_truth_process, 'Ground truth process'), thresholds, minimum_held_out: minimum, scope: choice(input.scope ?? 'duct_terminal', ['duct_terminal'], 'experiment scope'), frozen_protocol: true, ai_service_connected: false, production_enabled: false });
  }
  const objectClasses = ['duct', 'terminal', 'other', 'cannot_determine'];
  const stages = ['installed_visible', 'not_observed', 'obscured', 'cannot_determine'];
  function calibration(raw: unknown, unit: string | null): Json | null {
    if (raw == null) return null;
    const input = object(raw, ['method', 'basis', 'unit', 'independently_validated'], ['method', 'basis', 'unit', 'independently_validated']);
    if (input.independently_validated !== true) fail(400, 'Metric calibration requires a recorded independent validation basis.');
    const result = { method: choice(input.method, ['scale_reference', 'depth', 'known_dimensions'], 'calibration method'), basis: text(input.basis, 'Calibration source and validation basis'), unit: text(input.unit, 'Calibration unit', 30), independently_validated: true, authority: 'experiment_author_declaration', verifies_project_registration: false };
    if (unit && result.unit !== unit) fail(400, 'Calibration unit must match the declared metric quantity.');
    return result;
  }
  function labels(raw: unknown): Json {
    const input = object(raw, ['object_class', 'physical_item_id', 'stage', 'visible', 'quantity', 'unit'], ['object_class', 'physical_item_id', 'stage', 'visible', 'quantity', 'unit']);
    if (input.visible !== null && typeof input.visible !== 'boolean') fail(400, 'Visibility must be true, false or unknown (null).');
    if (input.quantity !== null) number(input.quantity, 'Quantity');
    const unit = optional(input.unit, 'Quantity unit', 30);
    if (input.quantity !== null && !unit) fail(400, 'A known quantity requires a unit.');
    return { object_class: choice(input.object_class, objectClasses, 'object class'), physical_item_id: optional(input.physical_item_id, 'Physical item identity', 250), stage: choice(input.stage, stages, 'installation stage'), visible: input.visible, quantity: input.quantity, unit };
  }
  function saveCase(raw: unknown): Json {
    const input = object(raw, ['experiment_id', 'capture_id', 'item_id', 'split', 'ground_truth', 'ground_truth_basis', 'calibration'], ['experiment_id', 'capture_id', 'item_id', 'split', 'ground_truth', 'ground_truth_basis']);
    const experiment = lookup('experiment', input.experiment_id), capture = scopedCapture(input.capture_id), item = scopedItem(input.item_id);
    const truth = labels(input.ground_truth), split = choice(input.split, ['training', 'held_out'], 'dataset split'), cal = calibration(input.calibration, truth.unit);
    if (truth.quantity !== null && truth.unit !== 'count' && !cal) fail(400, 'Metric ground truth requires a scale/depth/known-dimension calibration basis. An ordinary photo is insufficient.');
    const peers = rows('case').filter(row => row.experiment_id === experiment.record_id);
    if (peers.some(row => row.capture_ref.content_sha256 === capture.capture_ref.content_sha256 && row.item_id === item.item_id)) fail(409, 'This source/item already has a dataset case; do not duplicate the held-out population.');
    if (peers.some(row => row.split !== split && (row.capture_ref.content_sha256 === capture.capture_ref.content_sha256 || (truth.physical_item_id && row.ground_truth.physical_item_id === truth.physical_item_id)))) fail(409, 'Training and held-out sets cannot share source media or the same known physical item.');
    return persist('case', { experiment_id: experiment.record_id, item_id: item.item_id, item_ref: item, capture_id: capture.capture_id, capture_ref: capture.capture_ref, split, ground_truth: truth, ground_truth_basis: text(input.ground_truth_basis, 'Independent ground-truth basis'), calibration: cal, source_permission_basis: experiment.permission_basis });
  }
  function saveProposal(raw: unknown): Json {
    const input = object(raw, ['case_id', 'run_id', 'source', 'object_class', 'physical_item_id', 'stage', 'visible', 'quantity', 'unit', 'alignment_quality', 'identity_confidence', 'visibility_confidence', 'measurement_confidence', 'abstained', 'reason'], ['case_id', 'run_id', 'source', 'object_class', 'physical_item_id', 'stage', 'visible', 'quantity', 'unit', 'alignment_quality', 'identity_confidence', 'visibility_confidence', 'measurement_confidence', 'abstained', 'reason']);
    const sample = lookup('case', input.case_id), prediction = labels(Object.fromEntries(['object_class', 'physical_item_id', 'stage', 'visible', 'quantity', 'unit'].map(key => [key, input[key]])));
    const run = text(input.run_id, 'External experiment run / manual test identifier', 250);
    if (rows('proposal').some(row => row.case_id === sample.record_id && row.run_id === run)) fail(409, 'This case/run already has a preserved proposal; use a new run identifier for a changed proposal.');
    if (typeof input.abstained !== 'boolean') fail(400, 'Abstention must be explicit.');
    if (input.abstained && prediction.quantity !== null) fail(400, 'An abstained proposal cannot claim a quantity.');
    if (prediction.quantity !== null && prediction.unit !== 'count' && (!sample.calibration || sample.calibration.unit !== prediction.unit)) fail(400, 'Metric predictions require the case’s exact calibrated unit.');
    if (input.alignment_quality === 'declared_calibrated' && !sample.calibration) fail(400, 'This case has no recorded calibration; alignment must remain unverified or unsupported.');
    const confidence = Object.fromEntries(['identity_confidence', 'visibility_confidence', 'measurement_confidence'].map(key => [key, input[key] === null ? null : number(input[key], key, 0, 1)]));
    return persist('proposal', { experiment_id: sample.experiment_id, case_id: sample.record_id, item_id: sample.item_id, capture_ref: sample.capture_ref, run_id: run, source: choice(input.source, ['manual_experiment', 'imported_experiment'], 'proposal source'), ...prediction, alignment_quality: choice(input.alignment_quality, ['unverified', 'unsupported', 'declared_calibrated'], 'alignment quality'), ...confidence, abstained: input.abstained, reason: text(input.reason, 'Proposal rationale / abstention reason'), authority: 'experimental_proposal_only', ai_service_connected: false, production_enabled: false });
  }
  function saveDecision(raw: unknown): Json {
    const input = object(raw, ['proposal_id', 'decision', 'rationale', 'corrections'], ['proposal_id', 'decision', 'rationale']);
    const proposal = lookup('proposal', input.proposal_id), decision = choice(input.decision, ['accept', 'edit', 'reject', 'abstain'], 'reviewer decision');
    if (decision === 'accept' && proposal.abstained) fail(400, 'An abstained proposal cannot be accepted as a finding; obtain evidence or record a separate manual assessment.');
    const corrections = decision === 'edit' ? labels(input.corrections) : null;
    if (decision !== 'edit' && input.corrections != null) fail(400, 'Corrections belong to an explicit edit decision.');
    const sample = lookup('case', proposal.case_id);
    if (corrections?.quantity != null && corrections.unit !== 'count' && (!sample.calibration || corrections.unit !== sample.calibration.unit)) fail(400, 'Edited metric quantity requires the same calibrated basis.');
    return persist('decision', { proposal_id: proposal.record_id, experiment_id: proposal.experiment_id, case_id: proposal.case_id, item_id: proposal.item_id, decision, rationale: text(input.rationale, 'Reviewer rationale'), corrections, creates_saved_finding: false, creates_approved_quantity: false, creates_external_record: false });
  }
  function evaluate(raw: unknown): Json {
    const input = object(raw, ['experiment_id', 'run_id'], ['experiment_id']); const experiment = lookup('experiment', input.experiment_id);
    const cases = rows('case').filter(row => row.experiment_id === experiment.record_id && row.split === 'held_out');
    const proposals = rows('proposal').filter(row => row.experiment_id === experiment.record_id), runs = [...new Set(proposals.map(row => row.run_id))];
    if (!input.run_id && runs.length > 1) fail(400, 'Select one run explicitly; proposals from different runs cannot be combined.');
    const run = input.run_id ? text(input.run_id, 'Run identifier', 250) : runs[0] ?? null;
    if (input.run_id && !runs.includes(run)) fail(404, 'Experiment run unavailable.');
    const heldOutIds = new Set(cases.map(row => row.record_id));
    const selected = proposals.filter(row => row.run_id === run && heldOutIds.has(row.case_id));
    function accuracy(truthKey: string, unknown: unknown) {
      const eligible = cases.filter(row => row.ground_truth[truthKey] !== unknown && row.ground_truth[truthKey] !== null);
      const correct = eligible.filter(row => { const proposal = selected.find(p => p.case_id === row.record_id); return proposal && !proposal.abstained && proposal[truthKey] === row.ground_truth[truthKey]; }).length;
      return { correct, eligible: eligible.length, value: eligible.length ? correct / eligible.length : null, denominator: 'All held-out cases with known reference label; absent/abstained proposals do not disappear.' };
    }
    const measurements = cases.filter(row => row.ground_truth.quantity !== null), relative: number[] = [], absolute: number[] = []; let unsupported = 0;
    for (const sample of measurements) {
      const p = selected.find(proposal => proposal.case_id === sample.record_id), truth = sample.ground_truth;
      if (!p || p.abstained || p.quantity === null || p.unit !== truth.unit || (truth.unit !== 'count' && !sample.calibration)) { unsupported++; continue; }
      absolute.push(Math.abs(p.quantity - truth.quantity)); if (truth.quantity > 0) relative.push(Math.abs(p.quantity - truth.quantity) / truth.quantity);
    }
    const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const metrics = { classification: accuracy('object_class', 'cannot_determine'), identity: accuracy('physical_item_id', null), stage: accuracy('stage', 'cannot_determine'), visibility: accuracy('visible', null), measurement: { eligible: measurements.length, evaluated: absolute.length, unsupported, mean_absolute_error: null as number | null, mean_relative_error: mean(relative), note: 'Absolute errors use different units and are not aggregated; relative errors include positive calibrated reference quantities only. No installed quantities are summed across captures.' }, alignment: { verified_project_registration: false, value: null, reason: 'No independent project-registration truth or algorithm is connected.' } };
    const enough = cases.length >= experiment.minimum_held_out;
    const gates = { population: enough, classification: metrics.classification.value !== null && metrics.classification.value >= experiment.thresholds.classification_accuracy, identity: metrics.identity.value !== null && metrics.identity.value >= experiment.thresholds.identity_accuracy, stage: metrics.stage.value !== null && metrics.stage.value >= experiment.thresholds.stage_accuracy, measurement: measurements.length > 0 && unsupported === 0 && relative.length === measurements.length && metrics.measurement.mean_relative_error !== null && metrics.measurement.mean_relative_error <= experiment.thresholds.measurement_relative_error };
    return persist('evaluation', { experiment_id: experiment.record_id, run_id: run, protocol: clone(experiment), case_ids: cases.map(row => row.record_id), proposal_ids: selected.map(row => row.record_id), held_out_cases: cases.length, proposed_cases: cases.filter(row => selected.some(p => p.case_id === row.record_id)).length, abstained_cases: cases.filter(row => selected.some(p => p.case_id === row.record_id && p.abstained)).length, metrics, gates, status: enough ? Object.values(gates).every(Boolean) ? 'protocol_thresholds_met_not_production_validated' : 'thresholds_not_met_or_unavailable' : 'insufficient_evaluation_population', synthetic_only: ctx().workspace === 'fixture', ai_accuracy_claim_supported: false, production_enabled: false, limitations: ['Human-entered/imported experimental proposals only; no recognition model is connected.', 'Synthetic data and a passing protocol check do not demonstrate construction recognition accuracy.', 'Reviewer decisions remain independent of production findings, acceptance, payment and external records.'] });
  }
  function correctionFlags(record: Json): Json {
    const latest = new Map<string, Json>();
    for (const finding of currentFindings()) if (!latest.has(finding.finding_id) || latest.get(finding.finding_id)!.revision < finding.revision) latest.set(finding.finding_id, finding);
    const current = [...latest.values()];
    const changed = (record.findings ?? []).filter((finding: Json) => current.some((f: Json) => f.finding_id === finding.finding_id && f.revision_id !== finding.revision_id));
    return { ...record, needs_review: changed.length > 0, changed_finding_ids: changed.map((f: Json) => f.finding_id) };
  }
  function snapshot(itemIds?: string[]): Json {
    if (itemIds === undefined) return { schema_version: '1.0.0', records: rows(), external_submission_enabled: false };
    const selected = new Set(itemIds.map(id => scopedItem(id).item_id));
    const cases = rows('case').filter(row => selected.has(row.item_id)), caseIds = new Set(cases.map(row => row.record_id)), experimentIds = new Set(cases.map(row => row.experiment_id));
    const records = [...cases, ...rows('proposal').filter(row => caseIds.has(row.case_id)), ...rows('decision').filter(row => caseIds.has(row.case_id)), ...rows('experiment').filter(row => experimentIds.has(row.record_id)), ...rows('evaluation').filter(row => row.case_ids.length > 0 && row.case_ids.every((id: string) => caseIds.has(id))), ...rows('asset').filter(row => selected.has(row.item_id)), ...rows('follow-up').filter(row => row.findings.length > 0 && row.findings.every((finding: Json) => selected.has(finding.item_id ?? `element:${finding.model_ref?.element_id}`)))];
    return { schema_version: '1.0.0', item_ids: [...selected], records, external_submission_enabled: false, selection_note: 'Global investigation notes and mixed-scope evaluation/follow-up snapshots are excluded from item-selected packets.' };
  }
  function bootstrap(): Json {
    const c = ctx();
    return { schema_version: '1.0.0', workspace: c.workspace, data_mode: c.data_mode ?? c.workspace, project: c.project, items: c.items ?? [], captures: c.captures ?? [], findings: currentFindings(), local_drafts: c.drafts ?? [], follow_ups: latestFollowUps().map(correctionFlags), follow_up_history: rows('follow-up'), documentation: clone(researchDocumentation), capabilities: rows('capability'), asset_proposals: latestAssets().map(correctionFlags), asset_proposal_history: rows('asset'), experiments: rows('experiment'), cases: rows('case'), proposals: rows('proposal'), decisions: rows('decision'), evaluations: rows('evaluation'), external_submission_enabled: false, ai_service_connected: false, blockers: ['Live model, Issue/RFI/Asset operations and attachments lack verified authorized destination/adapter receipts.', 'No authorized representative construction dataset or recognition model is connected.', 'Local experimental decisions never become production findings or approved quantities automatically.'] };
  }
  return { bootstrap, saveCapability, saveFollowUp, saveAssetProposal, saveExperiment, saveCase, saveProposal, saveDecision, evaluate, snapshot };
}
