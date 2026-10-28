/** URL context describes selected records, never an authorization grant or a saved finding. */
export type ReviewPage = 'workspace' | 'field' | 'log' | 'packets' | 'connection' | 'operations' | 'assignments' | 'research';
export type ReviewSection = 'findings' | 'tasks' | 'photos' | 'reconciliation' | 'drafts';
export type ReviewRoute = {
  page: ReviewPage;
  workspace: 'fixture' | 'local';
  section: ReviewSection;
  capture_id?: string;
  element_id?: string;
  project_id?: string;
  scope_id?: string;
  model_version_id?: string;
  task_id?: string;
  draft_id?: string;
  entry_id?: string;
  item_id?: string;
  assignment_id?: string;
};
export const DEFAULT_REVIEW_ROUTE: Readonly<ReviewRoute> = Object.freeze({ page: 'operations', workspace: 'fixture', section: 'findings' });
const pagePaths: Record<ReviewPage, string> = { workspace: 'evidence-workspace', field: 'element-review', log: 'review-log', packets: 'evidence-packets', connection: 'aps-connection', operations: 'decision-queue', assignments: 'field-assignments', research: 'integration-research' };
const aliases: Record<string, ReviewPage> = { workspace: 'workspace', field: 'field', log: 'log', packets: 'packets', connection: 'connection', 'fixed-packets': 'packets' };
const sections: readonly string[] = ['findings', 'tasks', 'photos', 'reconciliation', 'drafts'];
const references = { capture: 'capture_id', element: 'element_id', project: 'project_id', scope: 'scope_id', version: 'model_version_id', task: 'task_id', draft: 'draft_id', entry: 'entry_id', item: 'item_id', assignment: 'assignment_id' } as const;
const knownParams = new Set(['workspace', 'section', ...Object.keys(references)]);
const validReference = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 500 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
export type ParsedReviewRoute = { ok: true; route: ReviewRoute; redirected: boolean } | { ok: false; error: string };

/** Recognized legacy destinations redirect compatibly; invalid destinations remain explicit errors. */
export function parseReviewHash(hash: string): ParsedReviewRoute {
  if (hash === '' || hash === '#' || hash === '#/' || hash === '/') return { ok: true, route: { ...DEFAULT_REVIEW_ROUTE }, redirected: false };
  if (hash.length > 6000 || /[\u0000-\u001f\u007f]/.test(hash)) return { ok: false, error: 'The review link is malformed.' };
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!fragment.startsWith('/') || fragment.startsWith('//') || /%(?![0-9a-f]{2})/i.test(fragment) || fragment.includes('#')) return { ok: false, error: 'The review link is malformed.' };
  const question = fragment.indexOf('?');
  const path = question === -1 ? fragment : fragment.slice(0, question);
  const parameters = new URLSearchParams(question === -1 ? '' : fragment.slice(question + 1));
  for (const key of parameters.keys()) {
    if (!knownParams.has(key)) return { ok: false, error: `The review link contains an unsupported parameter: ${key}.` };
    if (parameters.getAll(key).length !== 1) return { ok: false, error: `The review link contains conflicting ${key} values.` };
  }
  const segments = path.slice(1).split('/');
  const name = segments[0];
  const page = Object.entries(pagePaths).find(([, value]) => value === name)?.[0] as ReviewPage | undefined ?? (Object.hasOwn(aliases, name) ? aliases[name] : undefined);
  if (!page || segments.length > 2 || (segments.length === 2 && page !== 'field')) return { ok: false, error: 'That review destination is unavailable. Use the project navigation to choose an existing view.' };
  const legacyPackets = page === 'field' && segments[1] === 'packets';
  const pathSection = page === 'field' && !legacyPackets ? segments[1] || 'findings' : undefined;
  const querySection = parameters.get('section');
  if ((pathSection && !sections.includes(pathSection)) || (querySection !== null && !sections.includes(querySection))) return { ok: false, error: 'That element-review section is unavailable.' };
  if (pathSection && querySection !== null && pathSection !== querySection) return { ok: false, error: 'The review link contains conflicting section values.' };
  const workspace = parameters.get('workspace') ?? 'fixture';
  if (workspace !== 'fixture' && workspace !== 'local') return { ok: false, error: 'That evidence workspace is unavailable.' };
  const route: ReviewRoute = { page: legacyPackets ? 'packets' : page, workspace, section: (pathSection ?? querySection ?? 'findings') as ReviewSection };
  for (const [parameter, field] of Object.entries(references)) {
    const value = parameters.get(parameter);
    if (value !== null) {
      if (!validReference(value)) return { ok: false, error: `The selected ${parameter} reference is invalid.` };
      route[field as typeof references[keyof typeof references]] = value;
    }
  }
  return { ok: true, route, redirected: serializeReviewRoute(route) !== `#${fragment}` };
}

/** Includes remembered item context even on register/packet pages so Back and copied links agree. */
export function serializeReviewRoute(route: ReviewRoute): string {
  if (!Object.hasOwn(pagePaths, route.page) || !['fixture', 'local'].includes(route.workspace) || !sections.includes(route.section)) throw new Error('Cannot create a link to an unsupported review destination.');
  const query = new URLSearchParams({ workspace: route.workspace });
  if (route.page !== 'field' && route.section !== 'findings') query.set('section', route.section);
  for (const [parameter, field] of Object.entries(references)) {
    const value = route[field];
    if (value !== undefined) {
      if (!validReference(value)) throw new Error(`Cannot create a link with an invalid ${parameter} reference.`);
      query.set(parameter, value);
    }
  }
  return `#/${pagePaths[route.page]}${route.page === 'field' ? `/${route.section}` : ''}?${query}`;
}

type RecordBoundary = { workspace?: string; project_id?: string; model_ref?: { version_id?: string }; scope_ref?: { scope_id?: string } };
/** Minimal shape is deliberately compatible with the existing v2 bootstrap; no new schema is required. */
export type ReviewRouteData = {
  workspace: 'fixture' | 'local';
  project: { id: string } | null;
  scope: { scope_id: string; element_ids?: string[] } | null;
  model: { version_id: string; elements: { external_id: string }[] } | null;
  captures: ({ capture_id: string } & RecordBoundary)[];
  tasks?: ({ task_id: string } & RecordBoundary)[];
  drafts?: ({ draft_id: string } & RecordBoundary)[];
  reconciliations?: ({ entry_id: string } & RecordBoundary)[];
};

/** Validates explicit references without substituting a different element, model or source capture. */
export function validateReviewRoute(route: ReviewRoute, data: ReviewRouteData): string | null {
  if (route.workspace !== data.workspace) return 'The linked records belong to a different evidence workspace.';
  if (route.page === 'workspace' && route.workspace === 'local') return 'The historical Evidence workspace contains synthetic scope records. Use Element review for the selected local photograph workspace.';
  if (route.project_id !== undefined && route.project_id !== data.project?.id) return 'The linked project is unavailable in this workspace.';
  if (route.scope_id !== undefined && route.scope_id !== data.scope?.scope_id) return 'The linked scope is unavailable in this workspace.';
  if (route.model_version_id !== undefined && route.model_version_id !== data.model?.version_id) return 'The linked model version is unavailable. Historical references have not been moved to the current model.';
  if (route.element_id !== undefined && (!data.model?.elements.some(element => element.external_id === route.element_id) || (data.scope?.element_ids && !data.scope.element_ids.includes(route.element_id)))) return 'The linked element is unavailable in the selected scope. No replacement element has been selected.';
  const selected: RecordBoundary[] = [];
  if (route.capture_id !== undefined) {
    const capture = data.captures.find(item => item.capture_id === route.capture_id);
    if (!capture) return 'The linked capture is unavailable or inaccessible. No replacement capture has been selected.';
    selected.push(capture);
  }
  for (const [reference, collection, field, label] of [
    [route.task_id, data.tasks, 'task_id', 'recapture task'],
    [route.draft_id, data.drafts, 'draft_id', 'local draft'],
    [route.entry_id, data.reconciliations, 'entry_id', 'reconciliation record'],
  ] as const) if (reference !== undefined) {
    const record = collection?.find(item => (item as unknown as Record<string, unknown>)[field] === reference);
    if (!record) return `The linked ${label} is unavailable or inaccessible.`;
    selected.push(record);
  }
  if (selected.some(record => record.workspace !== undefined && record.workspace !== data.workspace)) return 'A linked record belongs to a different evidence workspace.';
  if (selected.some(record => record.project_id !== undefined && record.project_id !== data.project?.id)) return 'A linked record belongs to a different project.';
  if (selected.some(record => record.model_ref?.version_id !== undefined && record.model_ref.version_id !== data.model?.version_id)) return 'A linked record retains a different model version. It has not been remapped.';
  if (selected.some(record => record.scope_ref?.scope_id !== undefined && record.scope_ref.scope_id !== data.scope?.scope_id)) return 'A linked record belongs to a different scope.';
  return null;
}
