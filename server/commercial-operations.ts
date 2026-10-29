import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, DomainError } from './domain.ts';

type Row = Record<string, any>;
type Options = { db: DatabaseSync; context: () => Row; getItem: (id: string) => Row; getCapture: (id: string) => Row; packetSnapshot: (selection: Row) => Row; historicalPackets?: () => Row[] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function fail(status: number, message: string): never { throw new DomainError(status, message); }
const text = (v: unknown, name: string, max = 4000): string => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : fail(400, `${name} is required (maximum ${max} characters).`);
const choice = (v: unknown, options: string[], name: string) => options.includes(String(v)) ? String(v) : fail(400, `Unsupported ${name}.`);
const date = (v: unknown): string => { const s = text(v, 'Calendar date', 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) fail(400, 'Use a valid calendar date.'); return s; };
const optionalQuantity = (v: unknown): number | null => v === null || v === undefined || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail(400, 'Quantity must be a finite nonnegative number or unknown.');
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const identifiers = (value: unknown, label: string, allowEmpty = false): string[] => {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 1000) fail(400, `${label} must be an array of identifiers.`);
  const result = value.map(id => text(id, label, 250)); if (new Set(result).size !== result.length) fail(400, `${label} must contain distinct identifiers.`); return result;
};
const latestFindings = (values: Row[]): Row[] => [...values.reduce((map, finding) => {
  const old = map.get(finding.finding_id); if (!old || Number(finding.revision ?? 0) > Number(old.revision ?? 0)) map.set(finding.finding_id, finding); return map;
}, new Map<string, Row>()).values()];
const packetFindings = (snapshot: Row): Row[] => [...new Map([...(snapshot.all_finding_revisions ?? []), ...(snapshot.finding_revisions ?? []), ...(snapshot.existing?.finding_revisions ?? []), ...(snapshot.scope?.finding_revisions ?? [])].map((finding: Row) => [finding.revision_id, finding])).values()];
export const PACKET_PRESETS = ['weekly_review', 'quantity_discrepancy', 'concealment_record', 'handover'] as const;

/** Local authored records, never an Autodesk write or an automated measurement. */
export function createCommercialOperations({ db, context, getItem, getCapture, packetSnapshot, historicalPackets = () => [] }: Options) {
  db.exec(`CREATE TABLE IF NOT EXISTS commercial_revisions(revision_id TEXT PRIMARY KEY,id TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL,UNIQUE(id,revision)) STRICT;
    CREATE TABLE IF NOT EXISTS commercial_packets(id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL,report_html TEXT NOT NULL,summary_json TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS commercial_metrics(id TEXT PRIMARY KEY,event_json TEXT NOT NULL) STRICT;
    CREATE TRIGGER IF NOT EXISTS commercial_revision_no_update BEFORE UPDATE ON commercial_revisions BEGIN SELECT RAISE(ABORT,'Immutable operation revision'); END;
    CREATE TRIGGER IF NOT EXISTS commercial_revision_no_delete BEFORE DELETE ON commercial_revisions BEGIN SELECT RAISE(ABORT,'Immutable operation revision'); END;
    CREATE TRIGGER IF NOT EXISTS commercial_packet_no_update BEFORE UPDATE ON commercial_packets BEGIN SELECT RAISE(ABORT,'Immutable packet'); END;
    CREATE TRIGGER IF NOT EXISTS commercial_packet_no_delete BEFORE DELETE ON commercial_packets BEGIN SELECT RAISE(ABORT,'Immutable packet'); END;
    CREATE TRIGGER IF NOT EXISTS commercial_metric_no_update BEFORE UPDATE ON commercial_metrics BEGIN SELECT RAISE(ABORT,'Immutable metric event'); END;
    CREATE TRIGGER IF NOT EXISTS commercial_metric_no_delete BEFORE DELETE ON commercial_metrics BEGIN SELECT RAISE(ABORT,'Immutable metric event'); END;`);
  const ctx = (requireProject = true) => { const c = context(); if (!['fixture', 'local'].includes(c.workspace)) fail(403, 'Local operations are unavailable in this workspace.'); if (requireProject && !c.project?.id) fail(409, 'Configure a review project first.'); return c; };
  const authorized = (record: Row, c: Row) => !!c.project?.id && record.workspace === c.workspace && record.project_id === c.project.id;
  const all = () => { const c = ctx(false); return (db.prepare('SELECT record_json FROM commercial_revisions ORDER BY rowid').all().map(r => JSON.parse(r.record_json as string)) as Row[]).filter(record => authorized(record, c)); };
  const current = (kind?: string) => [...new Map(all().filter(r => !kind || r.kind === kind).map(r => [r.id, r])).values()];
  const items = (ids: unknown): Row[] => { const c = ctx(); return identifiers(ids, 'Scope items').map(id => { const item = getItem(id); if (!authorized(item, c)) fail(404, 'Scope item unavailable in this project and workspace.'); return item; }); };
  const captureSource = (id: unknown): Row => {
    const c = ctx(); const capture = getCapture(text(id, 'Capture ID', 250));
    if (capture.workspace && capture.workspace !== c.workspace || capture.project_id && capture.project_id !== c.project.id) fail(404, 'Capture unavailable in this project and workspace.');
    if (capture.media_status !== 'verified' || !capture.capture_ref?.content_sha256) fail(409, 'Original evidence is unavailable or changed.'); return capture;
  };
  const find = (id: string, kind?: string) => current(kind).find(r => r.id === id) ?? fail(404, 'Referenced local record is unavailable.');
  function save(kind: string, input: Row): Row {
    const c = ctx(); if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Expected a record.');
    if (['workspace', 'project_id', 'recorded_by', 'recorded_at', 'external_record_id', 'external_submission_enabled', 'authority_verified'].some(k => Object.hasOwn(input, k))) fail(400, 'Identity, authority and external state are server owned.');
    db.exec('BEGIN IMMEDIATE');
    try {
    const prior = input.id ? find(input.id, kind) : null;
    if ((prior?.revision_id ?? null) !== (input.previous_revision_id ?? null)) fail(409, 'Record changed; reload before correcting.');
    let fields: Row = {};
    if (kind === 'template') {
      const selected = items(input.item_ids); const denominator = optionalQuantity(input.denominator);
      if (denominator !== null && denominator <= 0) fail(400, 'Denominator must be positive.');
      fields = { title: text(input.title, 'Template title', 250), item_ids: selected.map(i => i.item_id), item_refs: selected, unit: text(input.unit, 'Unit', 40), stage: choice(input.stage, ['delivered', 'installed', 'tested', 'accepted'], 'installation stage'), period_type: choice(input.period_type, ['period', 'cumulative'], 'period basis'), measurement_method: choice(input.measurement_method, ['manual_measurement', 'manual_count', 'approved_takeoff'], 'manual method'), basis: text(input.basis, 'Agreed measurement basis'), source: text(input.source, 'Source/version'), denominator, denominator_basis: denominator === null ? null : text(input.denominator_basis, 'Denominator basis'), change_reason: text(input.change_reason, 'Version/change reason') };
    } else if (kind === 'quantity') {
      if (['unit', 'stage', 'period_type', 'item_ids', 'item_refs', 'template'].some(key => Object.hasOwn(input, key))) fail(400, 'Quantity unit, scope, stage and period basis come from the selected template; they cannot be silently converted or overridden.');
      const template = find(text(input.template_id, 'Template'), 'template');
      if (prior && (prior.template_id !== template.id || prior.category !== input.category)) fail(409, 'A quantity correction retains its template identity and source category. Create a separate record for another basis or category.');
      if (template.revision_id !== input.template_revision_id) fail(409, 'Choose the current template revision explicitly.');
      const start = date(input.period_start), end = date(input.period_end); if (start > end) fail(400, 'Period end must follow start.');
      const category = choice(input.category, ['trade_reported', 'imagery_supported', 'unresolved', 'inspection', 'approved', 'certification', 'payment'], 'quantity category');
      fields = { template_id: template.id, template_revision_id: template.revision_id, template: clone(template), item_ids: template.item_ids, item_refs: template.item_refs, quantity: optionalQuantity(input.quantity), category, unit: template.unit, period_type: template.period_type, stage: template.stage, period_start: start, period_end: end, source: text(input.source, 'Quantity source'), basis: text(input.basis, 'Measurement/approval basis'), approval_reference: category === 'approved' ? text(input.approval_reference, 'Approval reference') : null, approver: category === 'approved' ? text(input.approver, 'Named approver') : null, record_reference: input.record_reference ? text(input.record_reference, 'External reference') : null, authority_verified: false };
    } else if (kind === 'lookahead') {
      const selected = items(input.item_ids); const start = date(input.planned_start), end = date(input.planned_end); if (start > end) fail(400, 'Activity end must follow start.');
      fields = { title: text(input.title, 'Activity / billing line', 250), item_ids: selected.map(i => i.item_id), item_refs: selected, source: text(input.source, 'Schedule / commercial source and version'), planned_start: start, planned_end: end, stage: choice(input.stage, ['delivered', 'installed', 'tested', 'accepted'], 'required stage'), billing_line: input.billing_line ? text(input.billing_line, 'Billing line') : null, unit: input.unit ? text(input.unit, 'Unit', 40) : null, mapping_confirmed: input.mapping_confirmed === true, rationale: text(input.rationale, 'Mapping basis'), exclusions: text(input.exclusions, 'Billing exclusions (including stored/off-site materials and retention)') };
    } else if (kind === 'handover') {
      const selected = items(input.item_ids); if (!Array.isArray(input.documents) || !input.documents.length || input.documents.length > 50) fail(400, 'List the required owner documents.');
      const documents = input.documents.map((d: Row) => { if (!d || typeof d !== 'object' || Array.isArray(d)) fail(400, 'Document requirements must be records.'); return { type: choice(d.type, ['before_cover', 'inspection', 'test', 'commissioning', 'warranty', 'om'], 'document requirement'), status: choice(d.status, ['missing', 'reference_supplied', 'reviewed_locally'], 'documentation state'), reference: d.reference ? text(d.reference, 'Document reference') : null, basis: d.basis ? text(d.basis, 'Review basis') : null }; }).map((d: Row) => { if (d.status !== 'missing' && !d.reference) fail(400, 'Supplied documents need a reference.'); if (d.status === 'reviewed_locally' && !d.basis) fail(400, 'Local document review needs a basis.'); return d; });
      if (new Set(documents.map((d: Row) => d.type)).size !== documents.length) fail(400, 'Required document types must be distinct.');
      fields = { title: text(input.title, 'Asset/location index', 250), item_ids: selected.map(i => i.item_id), item_refs: selected, owner_requirements: text(input.owner_requirements, 'Owner requirements/version'), identity_confirmed: input.identity_confirmed === true, documents, tandem_transfer: 'unverified_not_submitted' };
    } else if (kind === 'comparison') {
      const item = items([input.item_id])[0]; const a = captureSource(input.capture_a); const mode = choice(input.mode, ['temporal', 'design'], 'comparison question');
      const b = input.capture_b ? captureSource(input.capture_b) : null;
      if (mode === 'temporal' && (!b || b.capture_id === a.capture_id)) fail(400, 'Choose two different captures.');
      fields = { item_ids: [item.item_id], item_refs: [item], mode, capture_a: a.capture_ref, capture_b: b?.capture_ref ?? null, design_reference: mode === 'design' ? text(input.design_reference, 'Exact design/drawing revision') : null, viewpoint: choice(input.viewpoint, ['different', 'reviewer_matched', 'unknown'], 'viewpoint match'), limitations: text(input.limitations, 'Lighting, occlusion, coverage and alignment limitations'), observation: text(input.observation, 'Bounded comparison'), alignment: { method: 'manual_association', validation: 'unverified', metric_measurement_supported: false, overlay_enabled: false } };
    } else if (kind === 'followup') {
      const selected = items(input.item_ids); const revisionIds = identifiers(input.finding_revision_ids, 'Finding revisions');
      const available: Row[] = c.all_finding_revisions ?? c.finding_revisions ?? [];
      const annotationIds = input.annotation_ids === undefined ? null : identifiers(input.annotation_ids, 'Annotation IDs', true);
      const evidence = revisionIds.map(id => {
        const finding = available.find(f => f.revision_id === id); if (!finding || finding.workspace && finding.workspace !== c.workspace || finding.project_id && finding.project_id !== c.project.id) fail(404, 'Selected finding revision unavailable.');
        const itemId = finding.item_id ?? `element:${finding.model_ref?.element_id}`; if (!selected.some(item => item.item_id === itemId)) fail(400, 'Finding is outside selected scope.');
        const capture = captureSource(finding.capture_ref.capture_id); if (capture.capture_ref.content_sha256 !== finding.capture_ref.content_sha256) fail(409, 'Original evidence no longer matches the selected finding revision.');
        return { finding: clone(finding), capture: clone(capture), annotations: clone((finding.annotations ?? []).filter((annotation: Row) => annotationIds === null || annotationIds.includes(annotation.id))) };
      });
      if (annotationIds?.some(id => !evidence.some(entry => entry.finding.annotations?.some((annotation: Row) => annotation.id === id)))) fail(400, 'An annotation must belong to a selected finding revision.');
      const type = choice(input.type, ['issue', 'rfi'], 'draft type'); if (prior && prior.type !== type) fail(409, 'A draft retains its Issue or RFI type; create a separate draft to change type.');
      fields = { type, title: text(input.title, 'Proposed title', 250), description: text(input.description, 'Description'), location: text(input.location, 'Location'), requested_action: text(input.requested_action, 'Requested action'), assignee: input.assignee ? text(input.assignee, 'Proposed assignee') : null, item_ids: selected.map(i => i.item_id), item_refs: selected, finding_revision_ids: revisionIds, annotation_ids: annotationIds ?? evidence.flatMap(entry => entry.annotations.map((annotation: Row) => annotation.id)), evidence, destination: input.destination ? text(input.destination, 'Proposed destination') : 'Unverified Autodesk destination', external_submission_enabled: false, external_record_id: null };
    } else if (kind === 'rollout') {
      fields = { feature: choice(input.feature, ['scope_registry', 'decision_queue', 'field_capture', 'assistance', 'commercial_review'], 'feature'), decision: choice(input.decision, ['continue', 'change', 'stop'], 'pilot decision'), population: text(input.population, 'Pilot population/exclusions'), outcome: text(input.outcome, 'Observed outcome and basis'), reason: text(input.reason, 'Decision rationale'), production_authority: 'local_pilot_record_only' };
    } else fail(404, 'Local operation type unavailable.');
    const record = { ...fields, schema_version: '0.3.0', kind, id: prior?.id ?? `${kind}-${randomUUID()}`, revision_id: `${kind}-revision-${randomUUID()}`, revision: (prior?.revision ?? 0) + 1, previous_revision_id: prior?.revision_id ?? null, workspace: c.workspace, project_id: c.project.id, recorded_by: c.reviewer.id, recorded_at: new Date().toISOString() };
    db.prepare('INSERT INTO commercial_revisions VALUES(?,?,?,?,?)').run(record.revision_id, record.id, kind, record.revision, JSON.stringify(record)); db.exec('COMMIT'); return clone(record);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function comparisons() {
    const c = ctx(); const findingRevisions: Row[] = c.all_finding_revisions ?? c.finding_revisions ?? [];
    const rows = current('quantity'); const groups = new Map<string, Row[]>();
    for (const r of rows) { const key = canonicalJson([r.template_revision_id, r.period_start, r.period_end, r.period_type, r.stage, r.unit, [...r.item_ids].sort()]); groups.set(key, [...(groups.get(key) ?? []), r]); }
    return [...groups.values()].map(group => {
      const reported = group.filter(r => r.category === 'trade_reported'), supported = group.filter(r => r.category === 'imagery_supported'), first = group[0];
      const template = find(first.template_id, 'template');
      const refsChanged = first.template.item_refs.some((r: Row) => { try { return getItem(r.item_id).revision_id !== r.revision_id; } catch { return true; } });
      const corrections = [...new Set(supported.flatMap(record => findingRevisions.filter(finding => {
        if (!finding.previous_revision_id || finding.workspace && finding.workspace !== c.workspace || finding.project_id && finding.project_id !== c.project.id) return false;
        if (!record.item_ids.includes(finding.item_id ?? `element:${finding.model_ref?.element_id}`)) return false;
        const reviewed = Date.parse(finding.review?.reviewed_at ?? finding.recorded_at ?? ''); const recorded = Date.parse(record.recorded_at);
        return !Number.isFinite(reviewed) || !Number.isFinite(recorded) || reviewed > recorded;
      }).map(finding => finding.revision_id)))];
      const overlapping = rows.some(other => !group.includes(other) && ['trade_reported','imagery_supported'].includes(other.category) && other.stage === first.stage && other.period_type === first.period_type && (first.period_type !== 'cumulative' || other.period_end === first.period_end) && other.period_start <= first.period_end && other.period_end >= first.period_start && other.item_ids.some((id: string) => first.item_ids.includes(id)));
      const reason = template.revision_id !== first.template_revision_id || refsChanged ? 'Scope or agreed baseline changed; explicit re-evaluation required.' : corrections.length ? 'A later finding correction affects this scope. Re-review and explicitly revise the imagery-supported quantity before comparing sources or calculating completion.' : overlapping ? 'Overlapping rows with another basis/period prevent a combined comparison.' : reported.length !== 1 || supported.length !== 1 ? 'Exactly one reported and one supported record on the same template revision are required.' : reported[0].quantity === null || supported[0].quantity === null ? 'A source quantity is unknown.' : null;
      const numerator = supported.length === 1 ? supported[0].quantity : null; const den = first.template.denominator;
      const percentageReason = reason ?? (first.period_type !== 'cumulative' ? 'A period quantity is not cumulative completion; the total-scope denominator cannot establish completion from this interval alone.' : den === null ? 'No explicit denominator.' : numerator === null ? 'The supported numerator is unknown.' : numerator > den ? 'The numerator exceeds the explicit denominator; resolve the basis before calculating completion.' : null);
      return { id: first.template_revision_id + ':' + first.period_start + ':' + first.period_end, item_ids: first.item_ids, template_id: first.template_id, template_revision_id: first.template_revision_id, period_start: first.period_start, period_end: first.period_end, period_type: first.period_type, stage: first.stage, unit: first.unit, reported: reported.length === 1 ? reported[0].quantity : null, supported: numerator, delta: reason ? null : reported[0].quantity - supported[0].quantity, comparable: !reason, reason: reason ?? 'Difference between explicitly sourced manual records; not a payable quantity.', correction_review_required: corrections.length > 0, correction_revision_ids: corrections, correction_policy: 'Conservative item-level review prompt: a later correction is not a measured quantity change. Saved quantities remain unchanged until an explicit human revision.', percentage: percentageReason ? null : 100 * (numerator! / den), denominator: den, percentage_basis: percentageReason ?? `Cumulative ${first.stage} manual quantity / template revision ${first.template.revision}, denominator ${den} ${first.unit}; neither inspection acceptance nor payment approval is inferred.`, record_ids: group.map(r => r.id) };
    });
  }
  const events = () => { const c = ctx(false); return (db.prepare('SELECT event_json FROM commercial_metrics ORDER BY rowid').all().map(r => JSON.parse(r.event_json as string)) as Row[]).filter(record => authorized(record, c)); };
  function metric(input: Row) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['activity_id', 'event', 'workflow'].includes(key))) fail(400, 'Activity events accept only an activity ID, event and workflow.');
    const c = ctx(); const id = text(input.activity_id, 'Activity ID', 250); const event = choice(input.event, ['start', 'pause', 'resume', 'complete', 'cancel'], 'review activity');
    const history = events().filter(e => e.activity_id === id); const prior = history.at(-1);
    if (event === 'start' ? !!prior : !prior || ['complete','cancel'].includes(prior.event)) fail(409, 'Activity state conflicts with this event.');
    if (event === 'pause' && !['start','resume'].includes(prior?.event)) fail(409, 'Only an active activity can pause.');
    if (event === 'resume' && prior?.event !== 'pause') fail(409, 'Only a paused activity can resume.');
    const workflow = choice(input.workflow, ['review','recapture','draft'], 'activity workflow');
    if (prior && prior.workflow !== workflow) fail(409, 'Activity workflow cannot change.');
    const r = { id: randomUUID(), activity_id: id, workflow, event, workspace: c.workspace, project_id: c.project.id, actor: c.reviewer.id, at: new Date().toISOString() };
    db.prepare('INSERT INTO commercial_metrics VALUES(?,?)').run(r.id, JSON.stringify(r)); return r;
  }
  function metrics() {
    const e = events(); const ids = [...new Set(e.map(x => x.activity_id))];
    return { population: 'Explicitly started local review activities only; synthetic sessions excluded from human-performance claims.', activities: ids.map(id => { const h = e.filter(x => x.activity_id === id); let started: number | null = null, seconds = 0; for (const x of h) { if (['start','resume'].includes(x.event)) started = Date.parse(x.at); else if (started !== null) { seconds += Math.max(0, (Date.parse(x.at) - started) / 1000); started = null; } } return { activity_id: id, workflow: h[0].workflow, status: h.at(-1)!.event, active_seconds: ['complete','cancel'].includes(h.at(-1)!.event) ? seconds : null, event_count: h.length }; }), human_agreement: null, recognition_accuracy: null, roi: null, note: 'Delivery and reassessment remain separate field events. Active review uses explicit start/pause/resume/end events; no duration is inferred from a finding timestamp alone. Server-clock discontinuities are not a validated pilot duration.' };
  }
  const packetIdentity = (manifest: Row) => ({ workspace: manifest.workspace, project_id: manifest.project_id ?? manifest.snapshot?.project?.id ?? manifest.snapshot?.existing?.project?.id });
  const packetRows = (): Row[] => { const c = ctx(false); return db.prepare('SELECT manifest_json,summary_json FROM commercial_packets ORDER BY rowid DESC').all().filter(row => authorized(packetIdentity(JSON.parse(row.manifest_json as string)), c)).map(row => JSON.parse(row.summary_json as string)); };
  function getPacket(id: string) {
    const c = ctx(); text(id, 'Packet ID', 250); const row = db.prepare('SELECT * FROM commercial_packets WHERE id=?').get(id); if (!row) fail(404, 'Packet unavailable in this workspace.');
    const manifest = JSON.parse(row.manifest_json as string); if (!authorized(packetIdentity(manifest), c)) fail(404, 'Packet unavailable in this project and workspace.');
    return { manifest, html: row.report_html as string, summary: JSON.parse(row.summary_json as string) };
  }
  const findingIndex = (s: Row) => new Map(packetFindings(s).map(f => [f.revision_id, f]));
  function correctionState(selected: Row[], allRevisions: Row[]): Row {
    const latest = new Map(latestFindings(allRevisions).map(finding => [finding.finding_id, finding.revision_id]));
    const changed = latestFindings(selected).filter(finding => latest.has(finding.finding_id) && latest.get(finding.finding_id) !== finding.revision_id).map(finding => finding.finding_id);
    return { newer_correction_available: changed.length > 0, affected_finding_ids: changed, notice: changed.length ? 'Newer correction available. Original saved evidence snapshot remains unchanged.' : 'No later finding correction detected.' };
  }
  function notices(): Row[] {
    const c = ctx(false); if (!c.project) return [];
    const revisions: Row[] = c.all_finding_revisions ?? c.finding_revisions ?? [];
    const packets = [...packetRows().map(p => ({ id: p.id, manifest: getPacket(p.id).manifest })), ...historicalPackets()];
    return packets.filter(p => authorized(packetIdentity(p.manifest), c)).map(p => ({ packet_id: p.id, ...correctionState(packetFindings(p.manifest.snapshot ?? {}), revisions), successors: packetRows().filter(r => r.predecessor_id === p.id).map(r => r.id) }));
  }
  function createPacket(input: Row) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['preset', 'item_ids', 'decision_summary', 'predecessor_id', 'reconciliation_entry_ids', 'draft_ids', 'commercial_record_ids', 'as_of_date', 'freshness_days'].includes(key))) fail(400, 'Unsupported packet selection fields.');
    const c = ctx(); const preset = choice(input.preset, [...PACKET_PRESETS], 'packet purpose'); const selected = items(input.item_ids);
    if (input.commercial_record_ids !== undefined) selectRecords({ item_ids: selected.map(item => item.item_id), record_ids: input.commercial_record_ids });
    const predecessor = input.predecessor_id ? getPacket(input.predecessor_id) : null;
    const snapshot = packetSnapshot({ ...input, item_ids: selected.map(i => i.item_id) });
    const previous = predecessor?.manifest.snapshot;
    const index = (s: Row) => findingIndex(s);
    const before = previous ? index(previous) : new Map(), after = index(snapshot);
    const beforeLatest = new Map(latestFindings([...before.values()]).map(finding => [finding.finding_id, finding.revision_id])); const afterLatest = new Map(latestFindings([...after.values()]).map(finding => [finding.finding_id, finding.revision_id]));
    const changes = { added: [...after.keys()].filter(id => !before.has(id)), removed: [...before.keys()].filter(id => !after.has(id)), revised: [...afterLatest].filter(([id, revision]) => beforeLatest.has(id) && beforeLatest.get(id) !== revision).map(([id, revision]) => ({ finding_id: id, previous_revision_id: beforeLatest.get(id), current_revision_id: revision })), note: 'Finding revision IDs are compared; removal from a selection does not mean physical removal.', unresolved: snapshot.queue ?? [] };
    const manifest = { schema_version: '0.3.0', product: 'Forma ReTrace', id: `review-packet-${randomUUID()}`, workspace: c.workspace, project_id: c.project.id, data_mode: c.workspace === 'fixture' ? 'synthetic' : 'local_imported', created_at: new Date().toISOString(), generated_by: c.reviewer.id, preset, decision_summary: text(input.decision_summary, 'Decision summary'), predecessor_id: predecessor?.manifest.id ?? null, changes, snapshot: clone(snapshot), snapshot_sha256: sha(canonicalJson(snapshot)) };
    const encoded = JSON.stringify(manifest).replaceAll('<','\\u003c');
    const findingRows = (snapshot.existing?.finding_revisions ?? []).map((f: Row) => {
      const media = (snapshot.media ?? []).find((m: Row) => m.id === f.capture_ref.capture_id);
      const annotations = (f.annotations ?? []).map((a: Row) => `<div class="annotation" style="left:${a.x*100}%;top:${a.y*100}%;width:${a.width*100}%;height:${a.height*100}%"><span>${escape(a.label)}</span></div>`).join('');
      return `<article><h3>${escape(f.item_ref?.label ?? f.model_ref?.element_id ?? f.item_id)} · ${escape(f.state)} · revision ${f.revision}</h3><p>${escape(f.rationale)}</p><p>Uncertainty: ${escape(f.uncertainty_reason ?? 'None recorded')} · evidence ${escape(f.evidence_quality)}</p><p>Capture ${escape(f.capture_ref.captured_at ?? f.capture_ref.captured_date ?? 'Unknown')} (${escape(f.capture_ref.date_precision)}) · uploaded ${escape(f.capture_ref.uploaded_at)}<br>Reviewer ${escape(f.review.reviewer_id)} · assessed ${escape(f.review.reviewed_at)}<br>Exact model/drawing: ${escape(f.model_ref?.version_id ?? f.item_ref?.references?.map((r: Row) => `${r.source_id} / ${r.version}`).join(', ') ?? 'No model reference')}<br>Finding revision ${escape(f.revision_id)} · previous ${escape(f.previous_revision_id ?? 'none')}</p>${media && f.annotations?.length ? `<div class="annotated"><img alt="${escape(media.title)} — separate revision annotations" src="data:${escape(media.display_content_type ?? media.content_type)};base64,${media.display_base64 ?? media.original_base64}">${annotations}</div>` : ''}</article>`;
    }).join('');
    const selectedRecords: Row[] = snapshot.commercial?.records ?? [];
    const quantities = [...(snapshot.workflows?.reconciliations ?? []), ...selectedRecords.filter(r => r.kind === 'quantity')].map((q: Row) => `<tr><td>${escape(q.category)}</td><td>${q.quantity === null ? 'Unknown' : escape(q.quantity)} ${escape(q.unit)}</td><td>${escape(q.period_start)} → ${escape(q.period_end)}<br>${escape(q.period_type ?? 'Existing recorded period')} · ${escape(q.stage ?? 'See recorded source basis')}</td><td>${escape(q.source)}<br>${escape(q.basis)}<br>Template ${escape(q.template_revision_id ?? q.comparison_key ?? 'No template')}</td></tr>`).join('');
    const calculations = (snapshot.commercial?.comparisons ?? []).map((q: Row) => `<p>Reported ${escape(q.reported ?? 'Unknown')} ${escape(q.unit)} · supported ${escape(q.supported ?? 'Unknown')} ${escape(q.unit)} · difference ${escape(q.delta ?? 'Unknown')} ${escape(q.unit)}.<br>${escape(q.reason)}<br>Completion ${q.percentage === null ? 'Unknown' : escape(q.percentage)+'%'} · ${escape(q.percentage_basis)}</p>`).join('');
    const field = [...new Map((snapshot.field?.assignment_events ?? []).map((a: Row) => [a.assignment_id, a])).values()] as Row[];
    const fieldRows = field.map((a: Row) => `<article><h3>${escape(a.item_snapshot.label)} · ${escape(a.status)}</h3><p>Owner ${escape(a.assignee)} · due ${escape(a.due_date)} · before concealment ${escape(a.concealment_date ?? 'not specified')}<br>Required view: ${escape(a.requirement_snapshot.viewpoint)}<br>Capture evidence ${a.supplied_evidence.length ? 'supplied' : 'pending'} · human review ${escape(a.review_status)}<br>${escape(a.last_reason)}</p><p>Assignment ${escape(a.assignment_id)} · exact requirement revision ${escape(a.requirement_snapshot.revision_id)}</p></article>`).join('');
    const draftRows = selectedRecords.filter(r => r.kind === 'followup').map((d: Row) => `<article><h3>Local ${escape(d.type)} · ${escape(d.title)}</h3><p>${escape(d.description)}</p><p>Requested action: ${escape(d.requested_action)}<br>Location ${escape(d.location)} · proposed assignee ${escape(d.assignee ?? 'unassigned')}<br>Destination ${escape(d.destination)} · external submission disabled<br>Exact finding revisions ${escape(d.finding_revision_ids.join(', '))}</p></article>`).join('');
    const readable = `<section><h2>Individual findings and corrections</h2>${findingRows || '<p>No selected saved findings.</p>'}</section><section><h2>Field requests and evidence decisions</h2>${fieldRows || '<p>No selected field assignments.</p>'}</section><section><h2>Reported, supported and unresolved quantities</h2><table><thead><tr><th>Record category</th><th>Manual quantity</th><th>Period / stage</th><th>Source and basis</th></tr></thead><tbody>${quantities || '<tr><td colspan="4">No selected quantity records.</td></tr>'}</tbody></table>${calculations}</section><section><h2>Local follow-up drafts</h2>${draftRows || '<p>No selected new follow-up drafts. See the manifest for any explicitly selected historical draft.</p>'}</section>`;
    const images = (snapshot.media ?? []).map((m: Row) => `<figure><h3>${escape(m.title ?? m.id)}</h3><img alt="${escape(m.title ?? m.id)}" src="data:${escape(m.display_content_type ?? m.content_type)};base64,${m.display_base64 ?? m.original_base64}"><figcaption>Original SHA-256 ${escape(m.content_sha256)}. Annotation data is stored separately in the manifest; original media is unchanged.</figcaption></figure>`).join('');
    const queue = (snapshot.queue ?? []).map((r: Row) => `<li>${escape(r.reason ?? r.title)} — ${escape(r.next_action ?? 'Human review required')}</li>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Forma ReTrace · ${escape(preset)}</title><style>body{font:15px system-ui;color:#333;max-width:1120px;margin:32px auto;padding:0 24px}h1,h2{font-weight:500}header,section{border:1px solid #ddd;padding:20px;margin:20px 0}article{padding:12px 0;border-bottom:1px solid #ddd}img{display:block;max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:20px 0}figcaption{font-size:12px}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}.annotated{position:relative;max-width:700px}.annotation{position:absolute;border:2px solid #007db6;pointer-events:none;box-sizing:border-box}.annotation span{position:absolute;top:0;left:0;background:#007db6;color:#fff;font-size:11px;max-width:240px;padding:3px}button{padding:8px}@media print{article,figure{break-inside:avoid}details:not([open]){display:none}}</style></head><body><header><h1>AUTODESK Forma ReTrace</h1><p>${escape(manifest.data_mode)} · ${escape(preset)} · ${escape(manifest.created_at)} · reviewer ${escape(manifest.generated_by)}</p><h2>Decision summary</h2><p>${escape(manifest.decision_summary)}</p><p>Fixed as-of record. Observations are not inspection acceptance, contractual completion or payment approval. Unknown is not zero. No external record was created.</p><p>Snapshot SHA-256 ${manifest.snapshot_sha256} · predecessor ${escape(manifest.predecessor_id ?? 'none')}</p></header><section><h2>Unresolved exceptions</h2><ul>${queue || '<li>No selected exceptions recorded.</li>'}</ul></section>${readable}<section><h2>Original source media</h2>${images || '<p>No source media in the selected scope.</p>'}</section><section><details><summary>Full structured decisions, references and revision history</summary><pre>${escape(JSON.stringify({ changes, ...snapshot, media: (snapshot.media ?? []).map(({ original_base64, display_base64, ...m }: Row) => m) }, null, 2))}</pre></details></section><script type="application/json" id="forma-recap-manifest">${encoded}</script></body></html>`;
    const base = `/api/v3/${c.workspace}/packets/${manifest.id}`; const summary = { id: manifest.id, workspace: c.workspace, project_id: c.project.id, created_at: manifest.created_at, preset, predecessor_id: manifest.predecessor_id, snapshot_sha256: manifest.snapshot_sha256, html_url: `${base}/report`, manifest_url: `${base}/manifest` };
    db.prepare('INSERT INTO commercial_packets VALUES(?,?,?,?)').run(manifest.id, JSON.stringify(manifest), html, JSON.stringify(summary)); return summary;
  }
  function selectRecords(selection: Row = {}): Row[] {
    const available = current();
    const selectedItems = selection.item_ids === undefined ? null : new Set(identifiers(selection.item_ids, 'Selected scope items', true));
    if (selectedItems) for (const id of selectedItems) { const c = ctx(); if (!authorized(getItem(id), c)) fail(404, 'Selected scope item unavailable.'); }
    const selectedIds = selection.record_ids === undefined ? null : identifiers(selection.record_ids, 'Selected commercial records', true);
    if (selectedIds?.some(id => !available.some(record => record.id === id))) fail(404, 'Selected commercial record unavailable in this workspace.');
    const inScope = (record: Row) => !selectedItems || (record.item_ids?.length ? record.item_ids.every((id: string) => selectedItems.has(id)) : selectedIds?.includes(record.id) === true);
    if (selectedIds?.some(id => !inScope(available.find(record => record.id === id)!))) fail(400, 'A selected commercial record includes scope items that are not selected. Its quantity cannot be truncated to a subset.');
    return available.filter(record => (!selectedIds || selectedIds.includes(record.id)) && inScope(record));
  }
  function snapshot(selection?: Row) {
    if (selection && Object.keys(selection).some(key => !['item_ids', 'record_ids', 'include_metrics'].includes(key))) fail(400, 'Unsupported commercial snapshot selection.');
    const records = selectRecords(selection); const selected = new Set(records.map(record => record.id));
    return { records, revisions: all().filter(record => selected.has(record.id)), metric_events: selection === undefined || selection.include_metrics === true ? events() : [], selection: { record_ids: records.map(record => record.id), item_ids: selection?.item_ids ?? null } };
  }
  function handoverReadiness(record: Row, c: Row): Row {
    const changed = record.item_refs.some((item: Row) => { try { return getItem(item.item_id).revision_id !== item.revision_id; } catch { return true; } });
    const revisions: Row[] = c.all_finding_revisions ?? c.finding_revisions ?? [];
    const currentFindings = latestFindings(revisions).filter(finding => record.item_ids.includes(finding.item_id ?? `element:${finding.model_ref?.element_id}`));
    const unresolvedItems = record.item_ids.filter((id: string) => {
      const candidates = currentFindings.filter(finding => (finding.item_id ?? `element:${finding.model_ref?.element_id}`) === id);
      if (!candidates.length) return false;
      if (candidates.some(finding => !finding.capture_ref?.captured_date || finding.capture_ref.date_precision === 'unknown')) return true;
      const newest = candidates.map(finding => finding.capture_ref.captured_date).sort().at(-1); const latest = candidates.filter(finding => finding.capture_ref.captured_date === newest);
      return latest.some(finding => finding.state !== 'observed_installed' || finding.evidence_quality !== 'usable');
    });
    const missing = record.documents.filter((document: Row) => document.status !== 'reviewed_locally').length;
    return { ...record, missing, scope_reference_review_required: changed, unresolved_item_ids: unresolvedItems, ready_for_owner_review: record.identity_confirmed && missing === 0 && !changed && unresolvedItems.length === 0, owner_acceptance_verified: false, readiness_basis: 'Local document and evidence checks only. Owner acceptance, external link access and Tandem transfer remain unverified.' };
  }
  function bootstrap() {
    const c = ctx(false); const revisions: Row[] = c.all_finding_revisions ?? c.finding_revisions ?? [];
    return { records: current(), templates: current('template'), quantities: current('quantity'), comparisons: c.project ? comparisons() : [], lookahead: current('lookahead'), handover: current('handover').map(record => handoverReadiness(record, c)), followups: current('followup').map(record => ({ ...record, ...correctionState(record.evidence.map((entry: Row) => entry.finding), revisions) })), capture_comparisons: current('comparison'), rollout: current('rollout'), packets: packetRows(), packet_notices: notices(), metrics: metrics(), packet_presets: [...PACKET_PRESETS] };
  }
  return { save, bootstrap, snapshot, comparisons, metric, createPacket, getPacket, notices };
}
