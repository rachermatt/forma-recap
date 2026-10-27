import { useEffect, useState } from 'react';
import type { Finding } from './ReviewWorkbench';
import { findingDrafts, findingDraftKey, isFindingDraftDirty } from './findingDraft';
import type { FindingDraftIdentity, FindingDraftValues } from './findingDraft';

export function useFindingDraft(identity: FindingDraftIdentity, savedFinding: Finding | null) {
  const key=findingDraftKey(identity);
  const [entry,setEntry]=useState(()=>findingDrafts.open(key,savedFinding));
  useEffect(()=>{setEntry(findingDrafts.open(key,savedFinding));},[key,savedFinding?.revision_id]);
  const update=(values: FindingDraftValues)=>setEntry(findingDrafts.update(key,values));
  const acceptSaved=(finding: Finding)=>setEntry(findingDrafts.saved(key,finding,identity));
  const discard=()=>setEntry(findingDrafts.discard(key,savedFinding));
  return {entry,dirty:isFindingDraftDirty(entry),update,acceptSaved,discard};
}
