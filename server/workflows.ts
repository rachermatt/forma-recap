import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from './domain.ts';

type Json = Record<string, any>;
type Options = { db: DatabaseSync; context: () => Json; getFindingRevision: (id: string) => Json; getCapture: (id: string) => Json };
const fail = (status: number, message: string): never => { throw new DomainError(status, message); };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const categories = ['trade_reported', 'imagery_supported', 'unresolved', 'inspection', 'approved', 'certification', 'payment'];
const percentageMethods = new Set(['manual_count', 'manual_measurement', 'documented_measurement', 'manual_documented', 'authorized_manual_approval']);
function object(value: unknown, allowed: string[], required: string[] = []): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected an object.');
  const result = value as Json;
  if (Object.keys(result).some(key => !allowed.includes(key))) fail(400, 'Unsupported workflow fields.');
  for (const key of required) if (!Object.hasOwn(result, key)) fail(400, `Missing required field: ${key}.`);
  return result;
}
function text(value: unknown, label: string, max = 6000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must contain 1–${max} characters.`);
  return (value as string).trim();
}
function optionalText(value: unknown, label: string, max = 6000): string | null {
  return value === undefined || value === null || value === '' ? null : text(value, label, max);
}
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a calendar date.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} must be a calendar date.`);
  return value as string;
}
function ids(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 100) fail(400, `${label} must be a list of 1–100 unique identifiers.`);
  const result = (value as unknown[]).map(id => text(id, label, 250));
  if (new Set(result).size !== result.length) fail(400, `${label} must be unique.`);
  return result;
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);
const exactScope = (a: Json, b: Json) => a.scope_ref.scope_id === b.scope_ref.scope_id && a.scope_ref.revision === b.scope_ref.revision && a.model_ref.model_id === b.model_ref.model_id && a.model_ref.version_id === b.model_ref.version_id && sameSet(a.element_ids, b.element_ids);
function comparisonReason(reported: Json, supported: Json): string | null {
  if (reported.quantity === null || supported.quantity === null) return 'A quantity is unknown; unknown is not zero.';
  if (!exactScope(reported, supported)) return 'Element scope or model version differs.';
  if (reported.unit !== supported.unit) return 'Units differ; no implicit conversion is applied.';
  if (reported.period_start !== supported.period_start || reported.period_end !== supported.period_end) return 'Reporting periods differ.';
  if (!reported.comparison_key || !supported.comparison_key) return 'An explicit shared comparison basis is missing.';
  if (reported.measurement_method !== supported.measurement_method || reported.comparison_key !== supported.comparison_key) return 'Measurement method or comparison basis differs.';
  return null;
}

/** Local, append-only manual records. This module has no external client or submission operation. */
export function createWorkflows({ db, context, getFindingRevision, getCapture }: Options) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation_revisions (
      revision_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, workspace TEXT NOT NULL,
      project_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL,
      UNIQUE(entry_id, revision)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS local_draft_revisions (
      revision_id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, workspace TEXT NOT NULL,
      project_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL,
      UNIQUE(draft_id, revision)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS reconciliation_no_update BEFORE UPDATE ON reconciliation_revisions BEGIN SELECT RAISE(ABORT, 'Reconciliation revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS reconciliation_no_delete BEFORE DELETE ON reconciliation_revisions BEGIN SELECT RAISE(ABORT, 'Reconciliation revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS draft_no_update BEFORE UPDATE ON local_draft_revisions BEGIN SELECT RAISE(ABORT, 'Local draft revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS draft_no_delete BEFORE DELETE ON local_draft_revisions BEGIN SELECT RAISE(ABORT, 'Local draft revisions are immutable'); END;
  `);
  function currentContext(requireConfiguration = false): Json {
    const ctx = context();
    if (!['fixture', 'local'].includes(ctx.workspace)) fail(403, 'Only separate local or fixture workflows are available.');
    if (requireConfiguration && (!ctx.project || !ctx.scope || !ctx.model)) fail(409, 'Configure the local project, model references, and trade scope first.');
    return ctx;
  }
  function rows(table: string, ctx: Json): Json[] {
    if (!ctx.project) return [];
    return (db.prepare(`SELECT record_json FROM ${table} WHERE workspace = ? AND project_id = ? ORDER BY rowid`).all(ctx.workspace, ctx.project.id) as { record_json: string }[]).map(row => JSON.parse(row.record_json));
  }
  function latest(list: Json[], key: string): Json[] {
    const grouped = new Map<string, Json>();
    for (const record of list) {
      const prior = grouped.get(record[key]);
      if (!prior || record.revision > prior.revision) grouped.set(record[key], record);
    }
    return [...grouped.values()];
  }
  function predecessor(list: Json[], key: string, id: unknown, revisionId: unknown): Json | null {
    if (id === undefined || id === null) {
      if (revisionId !== undefined && revisionId !== null) fail(409, 'A new record cannot have a predecessor.');
      return null;
    }
    text(id, 'Record identifier', 250);
    const previous = latest(list, key).find(record => record[key] === id);
    if (!previous) return fail(404, 'Workflow record unavailable in this workspace.');
    if (revisionId !== previous.revision_id) fail(409, 'The record changed. Reload before saving another revision.');
    return previous;
  }
  function scopeElements(value: unknown, ctx: Json): string[] {
    const result = ids(value, 'Element scope');
    if (result.some(id => !ctx.scope.element_ids.includes(id) || !ctx.model.elements.some((element: Json) => element.external_id === id))) fail(400, 'Elements must belong to the configured scope and exact model version.');
    return result;
  }
  function denominator(value: unknown, input: Json, elementIds: string[], ctx: Json): Json | null {
    if (value === undefined || value === null || value === '') return null;
    const data = typeof value === 'number' ? { quantity: value, unit: input.unit, element_ids: elementIds, measurement_method: input.measurement_method, basis: input.basis } : object(value, ['quantity', 'unit', 'element_ids', 'measurement_method', 'basis'], ['quantity', 'unit', 'element_ids', 'measurement_method', 'basis']);
    if (typeof data.quantity !== 'number' || !Number.isFinite(data.quantity) || data.quantity <= 0) fail(400, 'A denominator must be an explicit positive finite quantity.');
    const selected = scopeElements(data.element_ids, ctx);
    return { quantity: data.quantity, unit: text(data.unit, 'Denominator unit', 100), element_ids: selected, measurement_method: text(data.measurement_method, 'Denominator method', 200), basis: text(data.basis, 'Denominator basis') };
  }
  function saveReconciliation(raw: unknown): Json {
    const input = object(raw, ['entry_id', 'previous_revision_id', 'category', 'period_start', 'period_end', 'element_ids', 'quantity', 'unit', 'source', 'basis', 'measurement_method', 'comparison_key', 'decision', 'approver_name', 'approval_reference', 'record_reference', 'denominator'], ['category', 'period_start', 'period_end', 'element_ids', 'quantity', 'unit', 'source', 'basis', 'measurement_method', 'comparison_key']);
    const ctx = currentContext(true);
    if (!categories.includes(input.category)) fail(400, 'Unsupported reconciliation category.');
    const start = date(input.period_start, 'Reporting period start');
    const end = date(input.period_end, 'Reporting period end');
    if (start > end) fail(400, 'Reporting period end precedes its start.');
    if (input.quantity !== null && (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity < 0)) fail(400, 'A quantity must be non-negative and finite, or explicitly unknown (null).');
    const elementIds = scopeElements(input.element_ids, ctx);
    const unit = input.quantity === null ? optionalText(input.unit, 'Unit', 100) : text(input.unit, 'Unit', 100);
    const source = text(input.source, 'Source');
    const basis = text(input.basis, 'Measurement or decision basis');
    const method = text(input.measurement_method, 'Measurement method', 200);
    const comparisonKey = optionalText(input.comparison_key, 'Comparison basis identifier', 250);
    const approver = optionalText(input.approver_name, 'Recorded approver', 250);
    const approvalRef = optionalText(input.approval_reference, 'Approval reference');
    if (input.category === 'approved' && input.quantity !== null && (!approver || !approvalRef)) fail(400, 'An approved quantity requires a named approver and approval reference. Authority is recorded manually, not verified by the app.');
    const den = denominator(input.denominator, { ...input, unit }, elementIds, ctx);
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = predecessor(rows('reconciliation_revisions', ctx), 'entry_id', input.entry_id, input.previous_revision_id);
      const record: Json = {
        schema_version: '0.2.0', entry_id: prior?.entry_id ?? `reconciliation-${randomUUID()}`, revision_id: `reconciliation-revision-${randomUUID()}`,
        revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.revision_id ?? null,
        workspace: ctx.workspace, project_id: ctx.project.id,
        scope_ref: clone({ scope_id: ctx.scope.scope_id, revision: ctx.scope.revision, trade: ctx.scope.trade, floor: ctx.scope.floor, zone_id: ctx.scope.zone_id }),
        model_ref: { model_id: ctx.model.id, version_id: ctx.model.version_id },
        category: input.category, period_start: start, period_end: end, element_ids: [...elementIds], quantity: input.quantity, unit, source, basis,
        measurement_method: method, comparison_key: comparisonKey,
        decision: optionalText(input.decision, 'Inspection or acceptance decision'), approver_name: approver, approval_reference: approvalRef,
        record_reference: optionalText(input.record_reference, 'Certification or payment reference'), denominator: den,
        authority: input.category === 'approved' ? 'manually_recorded_approval' : 'manual_entry', authority_verified: false,
        recorded_by: text(ctx.reviewer?.id, 'Server reviewer', 250), recorded_at: now(),
      };
      if (prior && (!exactScope(prior, record) || prior.category !== record.category)) fail(409, 'A revision must retain its original category, element scope, and model version. Create a separate record for a different scope.');
      db.prepare('INSERT INTO reconciliation_revisions VALUES (?, ?, ?, ?, ?, ?)').run(record.revision_id, record.entry_id, ctx.workspace, ctx.project.id, record.revision, JSON.stringify(record));
      db.exec('COMMIT');
      return clone(record);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function observationSummary(ctx: Json, period: Json | null): Json {
    const findings = Array.isArray(ctx.findings) ? ctx.findings : [];
    const elements = (ctx.scope?.element_ids ?? []).map((id: string) => {
      const candidates = findings.filter((finding: Json) => finding.model_ref?.element_id === id && finding.model_ref?.model_id === ctx.model.id && finding.model_ref?.version_id === ctx.model.version_id && (!period || !finding.capture_ref?.captured_date || finding.capture_ref.date_precision === 'unknown' || (finding.capture_ref.captured_date >= period.period_start && finding.capture_ref.captured_date <= period.period_end)));
      const label = ctx.model.elements.find((element: Json) => element.external_id === id)?.label ?? id;
      if (!candidates.length) return { element_id: id, label, state: null, status: 'no_finding', finding_revision_id: null, capture_id: null, capture_date: null, reason: 'No individual element finding; historical scope assessments are not expanded.' };
      const undated = candidates.filter((finding: Json) => !finding.capture_ref?.captured_date || finding.capture_ref?.date_precision === 'unknown');
      if (undated.length) return { element_id: id, label, state: null, status: 'date_unknown', finding_revision_id: null, capture_id: null, capture_date: null, candidate_revision_ids: candidates.map((finding: Json) => finding.revision_id), reason: 'Unknown capture dates prevent chronological reconciliation; original finding states remain unchanged.' };
      const newestDate = candidates.map((finding: Json) => finding.capture_ref.captured_date).sort().at(-1);
      const newest = candidates.filter((finding: Json) => finding.capture_ref.captured_date === newestDate);
      // Timestamp order is only meaningful within the recorded capture date. Day-only records remain tied.
      const allTimed = newest.every((finding: Json) => finding.capture_ref.date_precision === 'timestamp' && finding.capture_ref.captured_at);
      const considered = allTimed ? newest.filter((finding: Json) => Date.parse(finding.capture_ref.captured_at) === Math.max(...newest.map((f: Json) => Date.parse(f.capture_ref.captured_at)))) : newest;
      if (new Set(considered.map((finding: Json) => finding.state)).size > 1) return { element_id: id, label, state: null, status: 'conflicting_observations', finding_revision_id: null, capture_id: null, capture_date: newestDate, candidate_revision_ids: considered.map((finding: Json) => finding.revision_id), reason: 'Newest evidence has differing findings and cannot be ordered at its recorded date precision.' };
      const chosen = considered.reduce((selected: Json, next: Json) => String(next.review?.reviewed_at ?? '').localeCompare(String(selected.review?.reviewed_at ?? '')) > 0 ? next : selected);
      return { element_id: id, label, state: chosen.state, status: chosen.state, finding_revision_id: chosen.revision_id, capture_id: chosen.capture_ref.capture_id, capture_date: chosen.capture_ref.captured_date, evidence_quality: chosen.evidence_quality, reason: 'Latest explicitly dated element observation; counted once across capture dates.' };
    });
    return { total_elements: elements.length, observed_installed: elements.filter((e: Json) => e.state === 'observed_installed').length, not_observed: elements.filter((e: Json) => e.state === 'not_observed').length, needs_review: elements.filter((e: Json) => e.state === 'needs_review').length, no_finding: elements.filter((e: Json) => e.status === 'no_finding').length, date_unknown: elements.filter((e: Json) => e.status === 'date_unknown').length, conflicting_observations: elements.filter((e: Json) => e.status === 'conflicting_observations').length, elements };
  }
  function reconciliationSummary(entries: Json[], ctx: Json, period: Json | null): Json {
    const reported = entries.filter(entry => entry.category === 'trade_reported');
    const supported = entries.filter(entry => entry.category === 'imagery_supported');
    const comparisons = reported.flatMap(report => {
      const matches = supported.filter(support => comparisonReason(report, support) === null);
      const choices: (Json | null)[] = matches.length ? matches : supported.length ? supported : [null];
      return choices.map(support => {
        let reason = support ? comparisonReason(report, support) : 'No imagery-supported quantity record is available.';
        if (!reason && (matches.length !== 1 || reported.filter(r => comparisonReason(r, support!) === null).length !== 1)) reason = 'Multiple overlapping records share this comparison basis. Resolve the duplicate or overlap; rows are not summed.';
        return { reported_entry_id: report.entry_id, supported_entry_id: support?.entry_id ?? null, quantity_reported: report.quantity, quantity_supported: support?.quantity ?? null, unit: report.unit, delta: reason ? null : report.quantity - support!.quantity, comparable: reason === null, reason: reason ?? 'Reported minus imagery-supported manual quantity, using matching unit, exact elements, period, method, and comparison basis.', element_ids: clone(report.element_ids), period_start: report.period_start, period_end: report.period_end };
      });
    });
    const percentages = entries.map(entry => {
      const den = entry.denominator;
      let reason: string | null = null;
      if (entry.quantity === null) reason = 'The numerator is unknown.';
      else if (!['imagery_supported', 'approved'].includes(entry.category)) reason = 'Completion percentages are limited to manually supported or approved quantity records.';
      else if (!den) reason = 'No explicit positive denominator was provided.';
      else if (entry.unit !== den.unit || !sameSet(entry.element_ids, den.element_ids) || entry.measurement_method !== den.measurement_method) reason = 'Denominator unit, exact element scope, or measurement method differs.';
      else if (!percentageMethods.has(entry.measurement_method)) reason = 'This method is not a supported documented manual measurement method.';
      else if (entry.quantity > den.quantity) reason = 'The numerator exceeds the stated denominator; reconcile the basis before calculating completion.';
      return { entry_id: entry.entry_id, value: reason ? null : 100 * (entry.quantity / den.quantity), reason: reason ?? 'Manual recorded quantity / explicit denominator. This is separate from review coverage, inspection acceptance, and payment approval.', unit: entry.unit, denominator: den ? clone(den) : null };
    });
    return { reporting_period: period, comparisons, observations: observationSummary(ctx, period), percentages, notes: [period ? 'Quantity rows match the selected reporting period exactly; dated observations fall within that period. Unknown capture dates remain unresolved.' : 'All recorded periods and capture dates are shown; select a reporting period for period-specific reconciliation.', 'Rows are never summed across overlapping elements or capture dates.', 'Not observed is not absent, incomplete, or zero quantity.', 'Visibility does not establish inspection acceptance, contractual completion, or payment approval.', 'Approval names and references are manually recorded; reviewer authority is not verified by this local prototype.'] };
  }
  function saveDraft(raw: unknown): Json {
    const input = object(raw, ['draft_id', 'previous_revision_id', 'type', 'title', 'description', 'location', 'requested_action', 'proposed_assignee', 'finding_revision_ids', 'annotation_ids'], ['type', 'title', 'description', 'location', 'requested_action', 'proposed_assignee', 'finding_revision_ids']);
    const ctx = currentContext(true);
    if (!['issue', 'rfi'].includes(input.type)) fail(400, 'Draft type must be issue or rfi.');
    const revisionIds = ids(input.finding_revision_ids, 'Finding revision identifiers');
    const selectedAnnotations = input.annotation_ids === undefined ? null : ids(input.annotation_ids, 'Annotation identifiers', true);
    const evidence = revisionIds.map(id => {
      const finding = getFindingRevision(id);
      if (finding.revision_id !== id || finding.model_ref?.model_id !== ctx.model.id || finding.model_ref?.version_id !== ctx.model.version_id || finding.scope_ref?.scope_id !== ctx.scope.scope_id || finding.scope_ref?.revision !== ctx.scope.revision || !ctx.scope.element_ids.includes(finding.model_ref?.element_id)) fail(400, 'Draft findings must use this workspace scope and exact model version.');
      if ((finding.workspace && finding.workspace !== ctx.workspace) || (finding.project_id && finding.project_id !== ctx.project.id)) fail(400, 'Draft finding belongs to a different workspace or project.');
      const capture = getCapture(finding.capture_ref.capture_id);
      if (capture.capture_id !== finding.capture_ref.capture_id || capture.capture_ref?.content_sha256 !== finding.capture_ref.content_sha256 || (capture.workspace && capture.workspace !== ctx.workspace)) fail(409, 'The original evidence does not match its reviewed finding.');
      const annotations = (finding.annotations ?? []).filter((annotation: Json) => selectedAnnotations === null || selectedAnnotations.includes(annotation.id));
      return { finding_revision_id: id, finding: clone(finding), capture: clone(capture), annotations: clone(annotations), media: { capture_id: capture.capture_id, content_sha256: capture.capture_ref.content_sha256, media_url: capture.media_url, content_type: capture.content_type ?? null, original_filename: capture.original_filename ?? null, integrity_status_at_draft: capture.media_status ?? 'not_checked' } };
    });
    const available = new Set(evidence.flatMap(entry => (entry.finding.annotations ?? []).map((annotation: Json) => annotation.id)));
    if (selectedAnnotations?.some(id => !available.has(id))) fail(400, 'Selected annotation does not belong to a selected finding revision.');
    const fields = { type: input.type, title: text(input.title, 'Draft title', 300), description: text(input.description, 'Draft description', 12000), location: text(input.location, 'Draft location', 500), requested_action: text(input.requested_action, 'Requested action or clarification', 12000), proposed_assignee: optionalText(input.proposed_assignee, 'Proposed assignee', 250) };
    db.exec('BEGIN IMMEDIATE');
    try {
      const prior = predecessor(rows('local_draft_revisions', ctx), 'draft_id', input.draft_id, input.previous_revision_id);
      if (prior && prior.type !== input.type) fail(409, 'A draft revision retains its Issue or RFI type. Create a separate draft to change type.');
      const time = now();
      const record: Json = { schema_version: '0.2.0', draft_id: prior?.draft_id ?? `draft-${randomUUID()}`, revision_id: `draft-revision-${randomUUID()}`, revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.revision_id ?? null, workspace: ctx.workspace, project_id: ctx.project.id, ...fields, finding_revision_ids: [...revisionIds], annotation_ids: selectedAnnotations ?? [...new Set(evidence.flatMap(entry => entry.annotations.map((annotation: Json) => annotation.id)))], evidence, model_ref: { model_id: ctx.model.id, version_id: ctx.model.version_id }, created_at: prior?.created_at ?? time, updated_at: time, created_by: prior?.created_by ?? text(ctx.reviewer?.id, 'Server reviewer', 250), updated_by: text(ctx.reviewer?.id, 'Server reviewer', 250), external_submission_enabled: false, external_record_id: null };
      db.prepare('INSERT INTO local_draft_revisions VALUES (?, ?, ?, ?, ?, ?)').run(record.revision_id, record.draft_id, ctx.workspace, ctx.project.id, record.revision, JSON.stringify(record));
      db.exec('COMMIT');
      return clone(record);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function draftHistory(id: string): Json[] {
    text(id, 'Draft identifier', 250);
    const all = rows('local_draft_revisions', currentContext());
    const selected = all.find(record => record.draft_id === id || record.revision_id === id);
    if (!selected) return fail(404, 'Draft unavailable in this workspace.');
    return all.filter(record => record.draft_id === selected.draft_id).sort((a, b) => a.revision - b.revision);
  }
  function bootstrap(filters?: unknown): Json {
    const ctx = currentContext();
    const input = filters === undefined ? {} : object(filters, ['period_start', 'period_end']);
    const hasStart = Object.hasOwn(input, 'period_start');
    const hasEnd = Object.hasOwn(input, 'period_end');
    if (hasStart !== hasEnd) fail(400, 'Provide both reporting period dates.');
    const period = hasStart ? { period_start: date(input.period_start, 'Reporting period start'), period_end: date(input.period_end, 'Reporting period end') } : null;
    if (period && period.period_start > period.period_end) fail(400, 'Reporting period end precedes its start.');
    const reconciliations = latest(rows('reconciliation_revisions', ctx), 'entry_id').filter(record => !period || (record.period_start === period.period_start && record.period_end === period.period_end));
    const drafts = latest(rows('local_draft_revisions', ctx), 'draft_id');
    return { reconciliations, drafts, reconciliation_summary: reconciliationSummary(reconciliations, ctx, period) };
  }
  function snapshot(selection?: unknown): Json {
    const ctx = currentContext();
    const input=selection===undefined?{}:object(selection,['reconciliation_entry_ids','draft_ids']);
    const state=bootstrap();
    const select=(key:string,available:Json[],identity:string)=>{
      const chosen=Object.hasOwn(input,key)?ids(input[key],key,true):available.map(record=>record[identity]);
      if(chosen.some(id=>!available.some(record=>record[identity]===id))) fail(404,'Packet selection contains a record outside this workspace or an unavailable record.');
      return chosen;
    };
    const reconciliationIds=select('reconciliation_entry_ids',state.reconciliations,'entry_id');
    const draftIds=select('draft_ids',state.drafts,'draft_id');
    const reconciliations=state.reconciliations.filter((record:Json)=>reconciliationIds.includes(record.entry_id));
    const drafts=state.drafts.filter((record:Json)=>draftIds.includes(record.draft_id));
    const reconciliationRevisions = rows('reconciliation_revisions', ctx).filter(record=>reconciliationIds.includes(record.entry_id));
    const draftRevisions = rows('local_draft_revisions', ctx).filter(record=>draftIds.includes(record.draft_id));
    return {reconciliations,drafts,reconciliation_summary:reconciliationSummary(reconciliations,ctx,null),selection:{reconciliation_entry_ids:reconciliationIds,draft_ids:draftIds},reconciliation_revisions:reconciliationRevisions,draft_revisions:draftRevisions,external_submission_enabled:false};
  }
  return { bootstrap, saveReconciliation, saveDraft, draftHistory, snapshot };
}
