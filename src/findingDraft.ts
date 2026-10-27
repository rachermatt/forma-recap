import type { Annotation, Finding, State } from './ReviewWorkbench';

export type FindingDraftValues = { state: State; rationale: string; uncertainty_reason: string; evidence_quality: string; annotations: Annotation[] };
export type FindingDraftEntry = { values: FindingDraftValues; baseline: FindingDraftValues; base_revision_id: string | null };
export type FindingDraftIdentity = { workspace: string; project_id: string; model_id: string; model_version: string; scope_id: string; scope_revision: number; capture_id: string; element_id: string };
const clone = <T>(value: T): T => structuredClone(value);
export const findingDraftKey = (identity: FindingDraftIdentity) => JSON.stringify([identity.workspace, identity.project_id, identity.model_id, identity.model_version, identity.scope_id, identity.scope_revision, identity.capture_id, identity.element_id]);
export function findingDraftValues(finding?: Finding | null): FindingDraftValues {
  return { state: finding?.state || 'needs_review', rationale: finding?.rationale || '', uncertainty_reason: finding?.uncertainty_reason || '', evidence_quality: finding?.evidence_quality || 'limited', annotations: (finding?.annotations || []).map(({id,x,y,width,height,label}) => ({...(id ? {id} : {}),x,y,width,height,label})) };
}
export const isFindingDraftDirty = (entry: FindingDraftEntry) => JSON.stringify(entry.values) !== JSON.stringify(entry.baseline);
export function findingDraftValidation(values: FindingDraftValues) {
  if(!values.rationale.trim()) return 'Add a rationale before saving this finding.';
  if(values.state !== 'observed_installed' && !values.uncertainty_reason.trim()) return 'Describe the uncertainty before saving this finding.';
  return null;
}
export function createFindingDraftStore() {
  const drafts = new Map<string, FindingDraftEntry>();
  function fresh(finding?: Finding | null): FindingDraftEntry { const values = findingDraftValues(finding); return { values, baseline: clone(values), base_revision_id: finding?.revision_id || null }; }
  return {
    open(key: string, finding?: Finding | null) { let entry=drafts.get(key); if(!entry || (!isFindingDraftDirty(entry) && entry.base_revision_id !== (finding?.revision_id || null))) { entry=fresh(finding); drafts.set(key,entry); } return clone(entry); },
    update(key: string, values: FindingDraftValues) { const prior=drafts.get(key); if(!prior)throw new Error('Open the exact capture–element draft before editing.'); const entry={...prior,values:clone(values)};drafts.set(key,entry);return clone(entry); },
    saved(key: string, finding: Finding, identity: FindingDraftIdentity) { const boundary=finding as Finding & {workspace?:string;project_id?:string}; if(key!==findingDraftKey(identity)||(boundary.workspace!==undefined&&boundary.workspace!==identity.workspace)||(boundary.project_id!==undefined&&boundary.project_id!==identity.project_id)||finding.capture_ref.capture_id!==identity.capture_id || finding.model_ref.element_id!==identity.element_id || finding.model_ref.version_id!==identity.model_version || finding.model_ref.model_id!==identity.model_id || finding.scope_ref.scope_id!==identity.scope_id || finding.scope_ref.revision!==identity.scope_revision)throw new Error('The save response did not match this draft’s exact capture, element and reference version.'); const entry=fresh(finding);drafts.set(key,entry);return clone(entry); },
    discard(key: string, finding?: Finding | null) { const entry=fresh(finding);drafts.set(key,entry);return clone(entry); },
    hasDirty() { return [...drafts.values()].some(isFindingDraftDirty); },
    clear() { drafts.clear(); },
  };
}
// Deliberate session-memory retention only: no browser storage or durable finding is created.
export const findingDrafts = createFindingDraftStore();
