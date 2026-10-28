import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from './domain.ts';

type Json = Record<string, any>;
type Options = { db: DatabaseSync; context: () => Json; getCapture: (id: string) => Json; getReviewTemplate?: (revisionId:string)=>Json };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
function fail(status: number, message: string): never { throw new DomainError(status, message); }
function object(value: unknown, allowed: string[], required: string[] = []): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  const input = value as Json;
  if (Object.keys(input).some(key => !allowed.includes(key))) fail(400, 'Unsupported scope operation fields.');
  for (const key of required) if (!Object.hasOwn(input, key)) fail(400, `Missing ${key}.`);
  return input;
}
function text(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, `${label} must be nonempty text (maximum ${max} characters).`);
  return value.trim();
}
function optional(value: unknown, label: string, max = 4000): string | null { return value == null || value === '' ? null : text(value, label, max); }
function choice(value: unknown, allowed: string[], label: string): string { if (typeof value !== 'string' || !allowed.includes(value)) fail(400, `Unsupported ${label}.`); return value; }
function date(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} must be a calendar date.`);
  const parsed = new Date(`${value}T00:00:00Z`); if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} is invalid.`); return value;
}
function ids(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || value.length > 1000 || (!allowEmpty && !value.length)) fail(400, `${label} must be an array of identifiers.`);
  const result = value.map(entry => text(entry, label, 300)); if (new Set(result).size !== result.length) fail(400, `${label} contains duplicates.`); return result;
}
const current = (rows: Json[], key: string) => [...new Map(rows.map(row => [row[key], row])).values()];
const sameIdentity = (a: Json, b: Json) => a.workspace === b.workspace && a.project_id === b.project_id;
const tableNames = ['scope_item_revisions', 'scope_finding_revisions', 'scope_mapping_revisions', 'scope_conflict_revisions'];

/** Additive, item-centered local records. Existing model evidence is only read, never migrated. */
export function createScopeOperations({ db, context, getCapture, getReviewTemplate }: Options) {
  for (const table of tableNames) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (revision_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, workspace TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, record_json TEXT NOT NULL, UNIQUE(entity_id, revision)) STRICT;`);
    for (const operation of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${operation.toLowerCase()} BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'Scope evidence and history are immutable'); END;`);
  }
  function ctx(write = false): Json {
    const value = context();
    if (!['fixture', 'local'].includes(value.workspace)) fail(403, 'Scope operations require an authorized local or synthetic workspace.');
    if (write && !value.project?.id) fail(409, 'Configure a project and review package first. BIM references are optional.');
    return value;
  }
  function rows(table: string, value = ctx()): Json[] {
    if (!value.project?.id) return [];
    return db.prepare(`SELECT record_json FROM ${table} WHERE workspace=? AND project_id=? ORDER BY rowid`).all(value.workspace, value.project.id).map(row => JSON.parse(row.record_json as string));
  }
  function transaction<T>(work: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return copy(result); } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function predecessor(table: string, entityId: string | null, previous: unknown, value: Json, synthesized?: Json): Json | null {
    if (!entityId) { if (previous) fail(409, 'A new record cannot have a predecessor.'); return null; }
    const prior = current(rows(table, value), 'entity_id').find(row => row.entity_id === entityId) ?? synthesized;
    if (!prior || !sameIdentity(prior, { workspace: value.workspace, project_id: value.project.id })) fail(404, 'Record is unavailable in this project and workspace.');
    if (prior.revision_id !== previous) fail(409, 'Record changed. Load the latest revision before saving.'); return prior;
  }
  function insert(table: string, key: string, input: Json, fields: Json, value: Json, synthesized?: Json): Json {
    const requestedId = optional(input[key], key, 300);
    const prior = predecessor(table, requestedId, input.previous_revision_id, value, synthesized);
    const id = prior?.entity_id ?? prior?.[key] ?? `${key.replace('_id', '')}-${randomUUID()}`;
    const record = { schema_version: '0.3.0', entity_id: id, [key]: id, workspace: value.workspace, data_mode: value.workspace, project_id: value.project.id, revision_id: `scope-revision-${randomUUID()}`, revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.revision_id ?? null, ...fields, recorded_by: text(value.reviewer?.id, 'Reviewer identity', 300), recorded_at: now() };
    db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?)`).run(record.revision_id, id, value.workspace, value.project.id, record.revision, JSON.stringify(record)); return record;
  }
  function references(raw: unknown): Json[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > 100) fail(400, 'References must be an array of at most 100 source records.');
    return raw.map(entry => {
      const ref = object(entry, ['kind', 'source_id', 'version', 'external_id', 'description', 'validation', 'is_verified_3d_registration'], ['kind', 'source_id', 'version']);
      if (ref.is_verified_3d_registration !== undefined && ref.is_verified_3d_registration !== false) fail(400, 'A manual reference cannot claim verified 3D registration.');
      return { kind: choice(ref.kind, ['model', 'drawing', 'takeoff', 'asset', 'custom'], 'reference kind'), source_id: text(ref.source_id, 'Source ID', 300), version: text(ref.version, 'Source version', 300), external_id: optional(ref.external_id, 'External item ID', 300), description: optional(ref.description, 'Reference description'), validation: choice(ref.validation ?? 'unverified', ['unverified', 'reviewer_confirmed', 'unresolved'], 'reference validation'), is_verified_3d_registration: false };
    });
  }
  function baseItems(value = ctx()): Json[] {
    if (!value.project || !value.model || !value.scope) return [];
    return (value.scope.element_ids ?? []).map((id: string) => {
      const element = (value.model.elements ?? []).find((entry: Json) => entry.external_id === id);
      const model = { model_id: value.model.id, version_id: value.model.version_id, element_id: id };
      return { schema_version: '0.3.0', entity_id: `element:${id}`, item_id: `element:${id}`, revision_id: `source:${value.scope.scope_id}:${value.scope.revision}:${value.model.version_id}:${id}`, revision: 1, previous_revision_id: null, workspace: value.workspace, project_id: value.project.id, kind: 'model', label: element?.label ?? id, description: 'Existing model-backed review item; historical model references remain unchanged.', location: value.scope.floor ?? value.scope.zone_id ?? 'Location not specified', trade: value.scope.trade ?? 'Trade not specified', references: [{ kind: 'model', source_id: value.model.id, version: value.model.version_id, external_id: id, description: null, validation: 'unverified', is_verified_3d_registration: false }], model_ref: model, unit: null, denominator: null, import_key: null, source: 'existing_model_scope', recorded_by: 'source_configuration', recorded_at: null };
    });
  }
  function items(value = ctx()): Json[] { return [...new Map([...baseItems(value), ...current(rows('scope_item_revisions', value), 'item_id')].map(item => [item.item_id, item])).values()]; }
  function getItem(id: string): Json {
    text(id, 'Scope item ID', 300); const selected = items().find(item => item.item_id === id); if (!selected) fail(404, 'Scope item is unavailable in this project and workspace.'); return copy(selected);
  }
  function saveItem(raw: unknown): Json {
    const input = object(raw, ['item_id', 'previous_revision_id', 'kind', 'label', 'description', 'location', 'trade', 'references', 'unit', 'denominator', 'import_key'], ['kind', 'label', 'location', 'trade']);
    const value = ctx(true); const kind = choice(input.kind, ['model', 'drawing', 'takeoff', 'asset', 'custom'], 'scope kind');
    return transaction(() => {
      const existing = input.item_id ? getItem(input.item_id) : null;
      const refs: Json[] = input.references === undefined ? copy(existing?.references ?? []) : references(input.references);
      const unit = input.unit === undefined ? existing?.unit ?? null : optional(input.unit, 'Unit', 100);
      let denominator: Json | null = input.denominator === undefined ? copy(existing?.denominator ?? null) : null;
      if (input.denominator != null) {
        const den = object(input.denominator, ['quantity', 'unit', 'basis', 'source', 'measurement_method'], ['quantity', 'unit', 'basis', 'source', 'measurement_method']);
        if (typeof den.quantity !== 'number' || !Number.isFinite(den.quantity) || den.quantity <= 0) fail(400, 'Denominator must be an explicit positive finite quantity.');
        denominator = { quantity: den.quantity, unit: text(den.unit, 'Denominator unit', 100), basis: text(den.basis, 'Denominator basis'), source: text(den.source, 'Denominator source'), measurement_method: text(den.measurement_method, 'Denominator measurement method', 300) };
      }
      if (denominator && (!unit || unit !== denominator.unit)) fail(400, 'Scope and denominator units must match.');
      const importKey = input.import_key === undefined ? existing?.import_key ?? null : optional(input.import_key, 'Import identity key', 300);
      if (existing && existing.kind !== kind) fail(409, 'A stable item retains its kind. Propose an explicit mapping to a different item.');
      if (importKey && items(value).some(item => item.import_key === importKey && item.item_id !== input.item_id)) fail(409, 'This import identity already belongs to a scope item; resolve the duplicate explicitly.');
      const modelRef = existing?.model_ref ?? (kind === 'model' ? (() => { const ref = refs.find(ref => ref.kind === 'model' && ref.external_id); if (!ref) fail(400, 'A model-backed item requires an exact model, version and element reference.'); return { model_id: ref.source_id, version_id: ref.version, element_id: ref.external_id }; })() : null);
      if (!existing && modelRef && items(value).some(item => item.model_ref?.model_id === modelRef.model_id && item.model_ref?.version_id === modelRef.version_id && item.model_ref?.element_id === modelRef.element_id)) fail(409, 'This exact model element already has a stable scope identity.');
      if (existing?.model_ref && !refs.some(ref => ref.kind === 'model' && ref.source_id === modelRef.model_id && ref.version === modelRef.version_id && ref.external_id === modelRef.element_id)) fail(409, 'Preserve the historical model reference; record a revision mapping rather than replacing it.');
      return insert('scope_item_revisions', 'item_id', input, { kind, label: text(input.label, 'Scope label', 500), description: input.description === undefined ? existing?.description ?? null : optional(input.description, 'Description'), location: text(input.location, 'Location', 500), trade: text(input.trade, 'Trade', 300), references: refs, model_ref: modelRef, unit, denominator, import_key: importKey, source: 'reviewer_defined' }, value, existing ?? undefined);
    });
  }
  function bridgedFindings(value: Json, revisions = false): Json[] {
    const records = revisions ? value.finding_revisions ?? value.findings ?? [] : value.findings ?? [];
    return records.filter((finding: Json) => (!finding.workspace || finding.workspace === value.workspace) && (!finding.project_id || finding.project_id === value.project?.id)).map((finding: Json) => {
      const itemId = `element:${finding.model_ref?.element_id}`; const source = baseItems(value).find(item => item.item_id === itemId);
      const snapshot = source ? { ...copy(source), revision_id: `source:${finding.scope_ref?.scope_id}:${finding.scope_ref?.revision}:${finding.model_ref?.version_id}:${finding.model_ref?.element_id}`, label: finding.model_ref?.element_id, description: 'Historical identifier and source version. The current dossier label is shown separately.', location: finding.scope_ref?.floor ?? finding.scope_ref?.zone_id ?? null, trade: finding.scope_ref?.trade ?? null, source: 'preserved_finding_reference', model_ref: copy(finding.model_ref), references: [{ kind: 'model', source_id: finding.model_ref?.model_id, version: finding.model_ref?.version_id, external_id: finding.model_ref?.element_id, validation: 'unverified', is_verified_3d_registration: false }] } : null;
      return { ...copy(finding), item_id: itemId, item_ref: snapshot, source: 'preserved_model_finding' };
    });
  }
  function allFindingRevisions(value = ctx()): Json[] { return [...bridgedFindings(value, true), ...rows('scope_finding_revisions', value)]; }
  function findings(value = ctx()): Json[] { return [...bridgedFindings(value), ...current(rows('scope_finding_revisions', value), 'finding_id')]; }
  function saveFinding(raw: unknown): Json {
    const input = object(raw, ['finding_id', 'previous_revision_id', 'item_id', 'item_revision_id', 'capture_id', 'state', 'rationale', 'uncertainty_reason', 'evidence_quality', 'annotations', 'review_template_revision_id'], ['item_id', 'capture_id', 'state', 'rationale', 'evidence_quality']);
    const value = ctx(true); const item = getItem(input.item_id);
    if (input.item_revision_id !== undefined && input.item_revision_id !== item.revision_id) fail(409, 'The scope item changed. Review the latest identity and basis before saving a finding.');
    if (item.model_ref) fail(409, 'Model-backed findings use the existing Element review workflow; a parallel scope finding cannot duplicate its capture–element record.');
    const capture = getCapture(text(input.capture_id, 'Capture ID', 300));
    if ((capture.workspace && capture.workspace !== value.workspace) || (capture.project_id && capture.project_id !== value.project.id)) fail(404, 'Capture is unavailable in this project and workspace.');
    if (!capture.capture_ref?.content_sha256 || capture.media_status !== 'verified') fail(409, 'Original evidence is unavailable or changed.');
    const state = choice(input.state, ['observed_installed', 'not_observed', 'needs_review'], 'finding state');
    const uncertainty = optional(input.uncertainty_reason, 'Uncertainty'); if (state !== 'observed_installed' && !uncertainty) fail(400, 'This observation requires an uncertainty reason.');
    const quality = choice(input.evidence_quality, ['usable', 'limited', 'unusable'], 'evidence quality');
    const reviewTemplate=input.review_template_revision_id?(getReviewTemplate?.(text(input.review_template_revision_id,'Review criteria revision',300))??fail(404,'Review criteria template unavailable.')):null;
    if(reviewTemplate&&(reviewTemplate.workspace!==value.workspace||reviewTemplate.project_id!==value.project.id||reviewTemplate.trade!==item.trade))fail(400,'Review criteria are outside this project or trade.');
    if (!Array.isArray(input.annotations ?? []) || (input.annotations ?? []).length > 50) fail(400, 'Annotations must be an array of at most 50 rectangles.');
    const annotations = (input.annotations ?? []).map((raw: unknown) => {
      const box = object(raw, ['id', 'label', 'x', 'y', 'width', 'height'], ['label', 'x', 'y', 'width', 'height']);
      for (const key of ['x', 'y', 'width', 'height']) if (typeof box[key] !== 'number' || !Number.isFinite(box[key]) || box[key] < 0 || box[key] > 1) fail(400, 'Annotation coordinates must be finite normalized image coordinates.');
      if (box.width <= 0 || box.height <= 0 || box.x + box.width > 1.000000001 || box.y + box.height > 1.000000001) fail(400, 'Annotation must remain inside the source image.');
      return { id: optional(box.id, 'Annotation ID', 300) ?? `annotation-${randomUUID()}`, label: text(box.label, 'Annotation label', 500), x: box.x, y: box.y, width: box.width, height: box.height, origin: 'top_left', coordinate_space: 'normalized_displayed_image', original_media_unchanged: true };
    });
    if (new Set(annotations.map((box: Json) => box.id)).size !== annotations.length) fail(400, 'Annotation IDs must be unique.');
    return transaction(() => {
      const pair = current(rows('scope_finding_revisions', value), 'finding_id').find(finding => finding.item_id === item.item_id && finding.capture_ref.capture_id === capture.capture_id);
      if (pair && input.finding_id !== pair.finding_id) fail(409, 'This item and capture already have a saved finding; revise that finding explicitly.');
      if (input.finding_id && !pair) fail(409, 'A correction cannot move a finding to a different item or capture.');
      if (annotations.some((box: Json) => allFindingRevisions(value).some(finding => finding.finding_id !== pair?.finding_id && (finding.annotations ?? []).some((old: Json) => old.id === box.id)))) fail(400, 'Annotation identifier belongs to a different finding.');
      return insert('scope_finding_revisions', 'finding_id', input, { item_id: item.item_id, item_ref: copy(item), capture_ref: copy(capture.capture_ref), model_ref: copy(item.model_ref), state, rationale: text(input.rationale, 'Rationale'), uncertainty_reason: uncertainty, evidence_quality: quality, annotations, review_template_ref:reviewTemplate?copy(reviewTemplate):null, review: { authority: 'human_reviewer', reviewer_id: value.reviewer.id, identity_basis: value.reviewer.identity_basis ?? 'self_asserted_local_identity', reviewed_at: now() }, alignment: { method: 'explicit_scope_association', validation: 'unverified', is_verified_3d_registration: false }, ai_suggestion_id: null }, value);
    });
  }
  function saveMapping(raw: unknown): Json {
    const input = object(raw, ['mapping_id', 'previous_revision_id', 'kind', 'source_item_ids', 'target_item_ids', 'from_reference', 'to_reference', 'status', 'reason'], ['kind', 'source_item_ids', 'target_item_ids', 'from_reference', 'to_reference', 'status', 'reason']);
    const value = ctx(true); const kind = choice(input.kind, ['added', 'removed', 'replaced', 'split', 'merged', 'renamed'], 'mapping kind');
    const sourceIds = ids(input.source_item_ids, 'Source item IDs', kind === 'added'); const targetIds = ids(input.target_item_ids, 'Target item IDs', kind === 'removed');
    if (sourceIds.some(id => targetIds.includes(id)) && kind !== 'renamed') fail(400, 'Source and target identities must be distinct except for a rename.');
    if (kind === 'split' && (sourceIds.length !== 1 || targetIds.length < 2)) fail(400, 'A split requires one source and at least two targets.');
    if (kind === 'merged' && (sourceIds.length < 2 || targetIds.length !== 1)) fail(400, 'A merge requires at least two sources and one target.');
    if (kind === 'added' && sourceIds.length || kind === 'removed' && targetIds.length) fail(400, 'Added/removed mappings have no prior/next item respectively.');
    const sourceItems = sourceIds.map(getItem); const targetItems = targetIds.map(getItem);
    const from = references([input.from_reference])[0]; const to = references([input.to_reference])[0];
    if (from.source_id === to.source_id && from.version === to.version) fail(400, 'A revision mapping must identify different source versions.');
    const status = choice(input.status, ['proposed', 'confirmed', 'rejected'], 'mapping decision');
    return transaction(() => {
      const prior = input.mapping_id ? current(rows('scope_mapping_revisions', value), 'mapping_id').find(row => row.mapping_id === input.mapping_id) : null;
      if (prior && (JSON.stringify(prior.source_item_ids) !== JSON.stringify(sourceIds) || JSON.stringify(prior.target_item_ids) !== JSON.stringify(targetIds) || JSON.stringify(prior.from_reference) !== JSON.stringify(from) || JSON.stringify(prior.to_reference) !== JSON.stringify(to) || prior.kind !== kind)) fail(409, 'A mapping decision retains its original proposal identities and versions.');
      if (prior && prior.status !== 'proposed') fail(409, 'A decided mapping remains immutable; record a new proposal.');
      if (!prior && status !== 'proposed') fail(400, 'Record a proposed mapping before confirming or rejecting it.');
      const impacted = impactedRecords([...sourceIds, ...targetIds], value);
      return insert('scope_mapping_revisions', 'mapping_id', input, { kind, source_item_ids: sourceIds, target_item_ids: targetIds, source_items: sourceItems, target_items: targetItems, from_reference: from, to_reference: to, status, reason: text(input.reason, 'Mapping rationale'), impact: impacted, baseline_review_required: status !== 'rejected' && (impacted.quantity_record_ids.length > 0 || impacted.denominator_item_revision_ids.length > 0), quantity_transfer: 'none', historical_findings_reassigned: false, identity_counting_rule: 'Mappings are review decisions, never added installation or automatic quantity transfer.' }, value);
    });
  }
  function impactedRecords(itemIds: string[], value: Json): Json {
    const elementIds = itemIds.filter(id => id.startsWith('element:')).map(id => id.slice(8));
    const affectedFindings = allFindingRevisions(value).filter(finding => itemIds.includes(finding.item_id));
    return { finding_revision_ids: affectedFindings.map(finding => finding.revision_id), denominator_item_revision_ids: items(value).filter(item => itemIds.includes(item.item_id) && item.denominator !== null).map(item => item.revision_id), quantity_record_ids: (value.reconciliations ?? []).filter((record: Json) => record.element_ids?.some((id: string) => elementIds.includes(id)) || record.item_ids?.some((id: string) => itemIds.includes(id))).map((record: Json) => record.entry_id), task_ids: (value.tasks ?? []).filter((record: Json) => itemIds.includes(record.item_id) || elementIds.includes(record.element_id)).map((record: Json) => record.task_id ?? record.assignment_id), draft_ids: (value.drafts ?? []).filter((draft: Json) => draft.finding_revision_ids?.some((id: string) => affectedFindings.some(finding => finding.revision_id === id))).map((draft: Json) => draft.draft_id) };
  }
  function saveConflict(raw: unknown): Json {
    const input = object(raw, ['conflict_id', 'previous_revision_id', 'item_id', 'finding_revision_ids', 'status', 'reason'], ['item_id', 'finding_revision_ids', 'status', 'reason']);
    const value = ctx(true); const item = getItem(input.item_id); const selected = ids(input.finding_revision_ids, 'Finding revisions');
    const available = allFindingRevisions(value).filter(finding => finding.item_id === item.item_id);
    if (selected.some(id => !available.some(finding => finding.revision_id === id))) fail(404, 'Conflict findings must belong to the selected item and this workspace.');
    const status = choice(input.status, ['open', 'resolved'], 'conflict state');
    return transaction(() => {
      if (!input.conflict_id && status !== 'open') fail(400, 'Record an open conflict before resolving it.');
      const prior = input.conflict_id ? current(rows('scope_conflict_revisions', value), 'conflict_id').find(row => row.conflict_id === input.conflict_id) : null;
      if (prior && (prior.item_id !== item.item_id || JSON.stringify(prior.finding_revision_ids) !== JSON.stringify(selected))) fail(409, 'A conflict resolution retains its originating item and findings.');
      return insert('scope_conflict_revisions', 'conflict_id', input, { item_id: item.item_id, finding_revision_ids: selected, status, reason: text(input.reason, 'Conflict rationale'), interpretation: 'Human investigation record; no observation or source evidence is overwritten.' }, value);
    });
  }
  function policy(raw: unknown = {}): Json {
    const input = object(raw, ['as_of_date', 'freshness_days', 'period_start', 'period_end', 'trade', 'location', 'owner', 'due_before']);
    const asOf = date(input.as_of_date ?? now().slice(0, 10), 'Review as-of date'); const freshness = input.freshness_days ?? 14;
    if (!Number.isInteger(freshness) || freshness < 1 || freshness > 3650) fail(400, 'Freshness window must be 1–3650 calendar days.');
    if (Boolean(input.period_start) !== Boolean(input.period_end)) fail(400, 'Provide both review period dates.');
    const start = input.period_start ? date(input.period_start, 'Review period start') : null; const end = input.period_end ? date(input.period_end, 'Review period end') : null;
    if (start && end && start > end) fail(400, 'Review period end precedes its start.');
    return { due_before:input.due_before?date(input.due_before,'Due on or before'):null, as_of_date: asOf, freshness_days: freshness, period_start: start, period_end: end, trade: optional(input.trade, 'Trade filter', 300), location: optional(input.location, 'Location filter', 500), owner: optional(input.owner, 'Owner filter', 300), date_rule: 'Source calendar date, retaining unknown and date-only precision. Date-only captures on the same day are tied; upload/review time does not establish capture order.', evidence_rule: 'Latest dated finding per stable item; unknown dates and tied conflicting states remain unresolved. Evidence coverage is not installation completion.' };
  }
  function queue(raw: unknown = {}): Json {
    const value = ctx(); const rule = policy(raw); const itemList = items(value); const all = findings(value); const result: Json[] = [];
    const byItem = new Map(itemList.map(item => [item.item_id, item]));
    const add = (category: string, causeId: string, item: Json | undefined, reason: string, action: string, refs: Json[], extras: Json = {}) => {
      result.push({ exception_id: `${category}:${causeId}`, category, item_id: item?.item_id ?? null, label: item?.label ?? extras.label ?? 'Package review', trade: item?.trade ?? value.scope?.trade ?? null, location: item?.location ?? value.scope?.floor ?? null, owner: null, due_date: null, status: 'open', reason, next_action: action, source_refs: refs, quantity: null, ...extras });
    };
    for (const item of itemList) {
      const candidates = all.filter(finding => finding.item_id === item.item_id && (!item.model_ref || !finding.model_ref || finding.model_ref.version_id === item.model_ref.version_id) && (!finding.capture_ref?.captured_date || (finding.capture_ref.captured_date <= rule.as_of_date && (!rule.period_start || finding.capture_ref.captured_date >= rule.period_start && finding.capture_ref.captured_date <= rule.period_end))));
      const refs = (records: Json[]) => records.map(finding => ({ kind: 'finding', id: finding.finding_id, revision_id: finding.revision_id, capture_id: finding.capture_ref.capture_id }));
      if (!candidates.length) { add('missing_evidence', item.item_id, item, 'No saved individual finding in the selected date policy. Historical scope findings are not copied to items.', 'Plan a capture or review available evidence.', [{ kind: 'item', id: item.item_id, revision_id: item.revision_id }]); continue; }
      if (candidates.some(finding => !finding.capture_ref?.captured_date || finding.capture_ref.date_precision === 'unknown')) { add('unknown_capture_date', item.item_id, item, 'An unknown capture date prevents reliable chronological review.', 'Confirm the source date where possible or request dated evidence.', refs(candidates)); continue; }
      const newestDate = candidates.map(finding => finding.capture_ref.captured_date).sort().at(-1);
      let newest = candidates.filter(finding => finding.capture_ref.captured_date === newestDate);
      if (newest.every(finding => finding.capture_ref.date_precision === 'timestamp' && finding.capture_ref.captured_at)) { const timestamp = Math.max(...newest.map(finding => Date.parse(finding.capture_ref.captured_at))); newest = newest.filter(finding => Date.parse(finding.capture_ref.captured_at) === timestamp); }
      if (new Set(newest.map(finding => finding.state)).size > 1) { add('conflicting_findings', item.item_id, item, 'Latest source evidence has differing observations that cannot be ordered at its saved precision.', 'Investigate the conflicting views in the item dossier.', refs(newest)); continue; }
      const finding = newest.at(-1)!;
      if (finding.state === 'needs_review' || finding.evidence_quality !== 'usable') add('unresolved_finding', item.item_id, item, finding.uncertainty_reason ?? 'The latest evidence remains limited or unusable.', 'Review the finding or assign a better view.', refs(newest));
      else if (finding.state === 'not_observed') add('not_observed', item.item_id, item, 'The item is not observed in the reviewed evidence. This does not establish absence, incomplete work or zero quantity.', 'Investigate coverage or obtain a targeted view.', refs(newest));
      const age = Math.round((Date.parse(`${rule.as_of_date}T00:00:00Z`) - Date.parse(`${newestDate}T00:00:00Z`)) / 86400000);
      if (age > rule.freshness_days) add('outdated_evidence', item.item_id, item, `Latest dated finding is ${age} calendar days old; configured freshness is ${rule.freshness_days} days.`, 'Obtain a current view or record a justified freshness exception.', refs(newest));
    }
    for (const task of value.tasks ?? []) {
      const item = byItem.get(task.item_id ?? `element:${task.element_id}`);
      const awaiting = task.review_status === 'awaiting_reassessment' || task.status === 'awaiting_reassessment';
      const closed = task.status === 'closed' || task.review_status === 'reassessed';
      if (awaiting) add('awaiting_reassessment', task.task_id, item, 'New evidence has been supplied, but no explicit human reassessment is recorded.', 'Review the supplied evidence; delivery alone is not resolution.', [{ kind: 'task', id: task.task_id }, { kind: 'capture', id: task.new_capture_id }], { owner: task.assignee, due_date: task.due_date });
      else if (!closed && task.due_date && task.due_date < rule.as_of_date) add('overdue_capture', task.task_id, item, 'The requested viewpoint is overdue and remains unsupplied.', 'Follow up with the assignee or revise the assignment explicitly.', [{ kind: 'task', id: task.task_id }], { owner: task.assignee, due_date: task.due_date });
    }
    const periodMatches = (record: Json) => !rule.period_start || record.period_start === rule.period_start && record.period_end === rule.period_end;
    const compared = new Set<string>();
    for (const comparison of value.reconciliation_summary?.comparisons ?? []) {
      if (!periodMatches(comparison) || compared.has(comparison.reported_entry_id)) continue;
      if (!comparison.comparable || comparison.delta !== 0) {
        compared.add(comparison.reported_entry_id); const item = comparison.element_ids?.length === 1 ? byItem.get(`element:${comparison.element_ids[0]}`) : undefined;
        add(comparison.comparable ? 'quantity_discrepancy' : 'quantity_unresolved', comparison.reported_entry_id, item, comparison.comparable ? `Reported minus imagery-supported manual quantity is ${comparison.delta} ${comparison.unit}; this is a source difference, not payment approval.` : comparison.reason ?? 'Quantities are unknown or not comparable.', 'Reconcile the exact scope, unit, reporting period and measurement basis.', [{ kind: 'reconciliation', id: comparison.reported_entry_id }, ...(comparison.supported_entry_id ? [{ kind: 'reconciliation', id: comparison.supported_entry_id }] : [])], { quantity: comparison.comparable ? comparison.delta : null, unit: comparison.unit, period_start: comparison.period_start, period_end: comparison.period_end });
      }
    }
    for (const draft of value.drafts ?? []) add('local_follow_up', draft.draft_id, undefined, 'A local follow-up draft has no confirmed external project record. Saving locally does not submit it.', 'Review the local draft and verify the destination capability before any external submission.', [{ kind: 'draft', id: draft.draft_id, revision_id: draft.revision_id }], { label: draft.title, owner: draft.proposed_assignee });
    for (const mapping of current(rows('scope_mapping_revisions', value), 'mapping_id')) if (mapping.status === 'proposed' || mapping.baseline_review_required) add('reference_revision', mapping.mapping_id, byItem.get(mapping.source_item_ids[0] ?? mapping.target_item_ids[0]), mapping.status === 'proposed' ? 'A reference-version mapping requires a human decision.' : 'This confirmed reference mapping affects quantity baselines; comparisons require re-evaluation.', 'Inspect impacted findings, quantities, tasks and actions before using the new reference.', [{ kind: 'mapping', id: mapping.mapping_id, revision_id: mapping.revision_id }]);
    for (const conflict of current(rows('scope_conflict_revisions', value), 'conflict_id')) if (conflict.status === 'open') add('explicit_conflict', conflict.conflict_id, byItem.get(conflict.item_id), conflict.reason, 'Investigate and record an explicit resolution without overwriting either finding.', [{ kind: 'conflict', id: conflict.conflict_id, revision_id: conflict.revision_id }]);
    const matches = (actual: unknown, wanted: string | null) => !wanted || String(actual ?? '').toLowerCase().includes(wanted.toLowerCase());
    const selected = [...new Map(result.map(row => [row.exception_id, row])).values()].filter(row => matches(row.trade, rule.trade) && matches(row.location, rule.location) && matches(row.owner, rule.owner) && (!rule.due_before || (row.due_date && row.due_date <= rule.due_before)));
    return { schema_version: '0.3.0', workspace: value.workspace, project_id: value.project?.id ?? null, policy: rule, exceptions: selected, count: selected.length, permission_state: value.project ? 'local_workspace_available' : 'project_not_configured', notes: ['Exceptions describe evidence and review actions, never automatic completion, inspection or payable work.', 'Historical findings and resolved task events are retained even when their exception leaves the current queue.'] };
  }
  function dossier(id: string): Json {
    const value = ctx(); const item = getItem(id); const revisions = allFindingRevisions(value).filter(finding => finding.item_id === id); const latest = findings(value).filter(finding => finding.item_id === id);
    const elementId = item.model_ref?.element_id; const capturedIds = [...new Set(revisions.map(finding => finding.capture_ref.capture_id))];
    const captures = capturedIds.map(captureId => { try { return getCapture(captureId); } catch { return { capture_id: captureId, media_status: 'unavailable', source_reference_preserved: true }; } });
    return { schema_version: '0.3.0', workspace: value.workspace, project_id: value.project.id, item, item_revisions: [...baseItems(value).filter(record => record.item_id === id), ...rows('scope_item_revisions', value).filter(record => record.item_id === id)], findings: latest, finding_revisions: revisions, captures, tasks: (value.tasks ?? []).filter((record: Json) => record.item_id === id || !!elementId && record.element_id === elementId), reconciliations: (value.reconciliations ?? []).filter((record: Json) => record.item_ids?.includes(id) || !!elementId && record.element_ids?.includes(elementId)), drafts: (value.drafts ?? []).filter((record: Json) => record.finding_revision_ids?.some((revisionId: string) => revisions.some(finding => finding.revision_id === revisionId))), packets: (value.exports ?? []).map((record: Json) => ({ ...copy(record), relationship: 'Package snapshot; inspect manifest for exact selected item revisions.' })), mappings: current(rows('scope_mapping_revisions', value), 'mapping_id').filter(record => record.source_item_ids.includes(id) || record.target_item_ids.includes(id)), conflicts: rows('scope_conflict_revisions', value).filter(record => record.item_id === id), timeline: revisions.map(finding => ({ kind: 'finding_revision', revision_id: finding.revision_id, capture_id: finding.capture_ref.capture_id, captured_date: finding.capture_ref.captured_date, captured_at: finding.capture_ref.captured_at, date_precision: finding.capture_ref.date_precision, uploaded_at: finding.capture_ref.uploaded_at, reviewed_at: finding.review.reviewed_at, state: finding.state })).sort((a, b) => String(a.reviewed_at).localeCompare(String(b.reviewed_at))), chronology_rule: 'Review events are ordered by assessment time. Capture date precision is preserved separately; unknown or date-only capture dates never become installation timestamps.', installation_quantity: null };
  }
  function snapshot(): Json {
    const value = ctx(); return { schema_version: '0.3.0', workspace: value.workspace, data_mode: value.workspace, project_id: value.project?.id ?? null, items: items(value), item_revisions: rows('scope_item_revisions', value), findings: findings(value), finding_revisions: allFindingRevisions(value), mappings: rows('scope_mapping_revisions', value), conflicts: rows('scope_conflict_revisions', value), historical_scope_records_remain_separate: true };
  }
  function bootstrap(filters: unknown = {}): Json {
    const value = ctx(); return { schema_version: '0.3.0', workspace: value.workspace, data_mode: value.workspace, project: copy(value.project ?? null), reviewer: copy(value.reviewer), ...snapshot(), queue: queue(filters), policy: policy(filters), sources: 'Existing model records are preserved read views; new scope records append independently.' };
  }
  return { bootstrap, getItem, saveItem, saveFinding, saveMapping, saveConflict, dossier, queue, snapshot };
}
