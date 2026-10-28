import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Box, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleAlert, Clock3, Cloud, ExternalLink, FileArchive, FileCheck2, FileJson, FolderClosed, History, Image, Info, Layers3, Link2, LoaderCircle, LogIn, LogOut, MapPin, Maximize2, PanelLeftClose, RotateCcw, ScanLine, ShieldCheck, Unplug, X } from 'lucide-react';
import ReviewWorkbench from './ReviewWorkbench';
import type { Workspace, ReviewSelection, Deployment } from './ReviewWorkbench';
import ReviewRegister from './ReviewRegister';
import { DEFAULT_REVIEW_ROUTE } from './reviewNavigation';
import type { ReviewPage, ReviewRoute, ReviewSection } from './reviewNavigation';
import { useReviewNavigation } from './useReviewNavigation';
import type { LeaveGuard } from './useReviewNavigation';
import { findingDrafts } from './findingDraft';
import ProjectOperations, {hasOperationDrafts} from './ProjectOperations';
const FieldAssignments=lazy(()=>import('./FieldAssignments'));
const IntegrationResearch=lazy(()=>import('./IntegrationResearch'));

class WorkspaceBoundary extends Component<{children:React.ReactNode;resetKey:string},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidUpdate(previous:Readonly<{children:React.ReactNode;resetKey:string}>){if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:false});}
  render(){return this.state.failed?<section className="panel route-problem" role="alert"><h2>This workspace view could not be loaded</h2><p>The application may have been updated or the connection interrupted. Saved evidence and device-queued originals remain unchanged.</p><p>Use the sidebar to open another view, or reload to retrieve the current application. Unsaved edits may need to be entered again after a reload.</p><button className="button primary" onClick={()=>window.location.reload()}>Reload saved workspace</button></section>:this.props.children;}
}

type ReviewState = 'observed_installed' | 'not_observed' | 'needs_review';
type Page = ReviewPage;
type ReviewContext = { workspace:string; project_name:string; reviewer_name:string; project_id?:string; scope_id?:string; scope_name?:string; model_version_id?:string; capture_id?:string; capture_title?:string; element_id?:string; element_label?:string };
type CaptureRef = { capture_id: string; captured_at: string | null; captured_date: string | null; date_precision: string; date_source: string; original_timezone: string | null; uploaded_at: string; content_sha256?: string | null };
type Placement = { method: string; normalized_pin: { x: number; y: number; origin: string } | null; plan_ref?: { file_id: string; version_id: string } | null; is_verified_3d_registration: false };
type Capture = { capture_id: string; title: string; media_url: string; display_url?: string; media_status?: 'verified' | 'changed' | 'unavailable'; capture_ref: CaptureRef; placement: Placement };
type Assessment = { assessment_id: string; state: ReviewState; rationale: string; uncertainty_reason: string | null; capture_ref: CaptureRef; placement: Placement; model_ref: { model_id: string; version_id: string; element_refs: { external_id: string }[] }; review: { revision: number; revision_id: string; reviewer_id: string; reviewed_at: string }; previous_revision_id: string | null; scope_ref: { scope_id: string; revision: number; trade: string; zone_id: string } };
type Export = { id: string; created_at: string; revision_count: number; html_url: string; manifest_url: string };
type Bootstrap = { deployment?: Deployment; mode: 'fixture' | 'live'; csrfToken: string; user: { id: string; name: string }; project: { id: string; name: string } | null; model: { id: string; name: string; version_id: string; version_label: string; elements: { external_id: string; label: string; zone_id: string }[] } | null; scope: { scope_id: string; revision: number; trade: string; floor: string; name: string; element_ids: string[] } | null; plan: { file_id: string; version_id: string; name: string; url: string; display_url?: string } | null; captures: Capture[]; assessments: Assessment[]; exports: Export[]; capabilities?: unknown };
type Integration = { configured: boolean; authenticated: boolean; mode: string; callback: string; hub_id: string | null; read_only: boolean; message: string };

const stateInfo: Record<ReviewState, { label: string; short: string; detail: string; className: string }> = {
  observed_installed: { label: 'Observed installed', short: 'Observed', detail: 'Visible within the selected evidence.', className: 'observed' },
  not_observed: { label: 'Not observed', short: 'Not observed', detail: 'Not visible; this does not mean absent.', className: 'not-observed' },
  needs_review: { label: 'Needs review', short: 'Needs review', detail: 'Evidence needs further clarification.', className: 'needs-review' },
};
const pageNames: Record<Page, string> = { workspace: 'Evidence workspace', field: 'Element review', log: 'Review log', packets: 'Evidence packets', connection: 'APS connection', operations:'Decision queue', assignments:'Field assignments', research:'Integration & research' };
const date = (value: string | null | undefined, compact = false) => value ? new Intl.DateTimeFormat('en-US', { month: compact ? 'short' : 'long', day: 'numeric', year: compact ? undefined : 'numeric', timeZone: 'UTC' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value)) : 'Date unknown';
const time = (value: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: 'America/New_York' }).format(new Date(value));
const captureDate = (capture: Capture) => capture.capture_ref.captured_date || capture.capture_ref.captured_at;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `The request could not be completed (${response.status}).`);
  return payload as T;
}

function StatusBadge({ state }: { state: ReviewState }) { return <span className={`status-badge ${stateInfo[state].className}`}><span />{stateInfo[state].short}</span>; }
function SmallLabel({ children }: { children: React.ReactNode }) { return <span className="eyebrow">{children}</span>; }
function EmptyState({ icon: Icon = FolderClosed, title, children }: { icon?: typeof FolderClosed; title: string; children: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Icon size={24} /></div><h3>{title}</h3><p>{children}</p></div>; }

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [integration, setIntegration] = useState<Integration | null>(null);
  const leaveGuardRef = useRef<LeaveGuard>(null);
  const { route, routeError, navigate, remember } = useReviewNavigation(leaveGuardRef);
  const routeRef = useRef(route); routeRef.current = route;
  const page = route.page;
  const fieldWorkspace = route.workspace;
  const fieldSelection = useMemo<ReviewSelection>(() => ({capture_id:route.capture_id,element_id:route.element_id,project_id:route.project_id,scope_id:route.scope_id,model_version_id:route.model_version_id,task_id:route.task_id,draft_id:route.draft_id,entry_id:route.entry_id}),[route]);
  const [fieldContext,setFieldContext]=useState<ReviewContext|null>(null);
  const registerLeaveGuard=useCallback((guard:LeaveGuard)=>{leaveGuardRef.current=guard;},[]);
  const updateFieldContext=useCallback((value:ReviewContext)=>{
    const active=routeRef.current;
    if(value.workspace!==active.workspace || (value.capture_id&&active.capture_id&&value.capture_id!==active.capture_id) || (value.element_id&&active.element_id&&value.element_id!==active.element_id))return;
    setFieldContext(value);
    remember({project_id:value.project_id,scope_id:value.scope_id,model_version_id:value.model_version_id,capture_id:value.capture_id,element_id:value.element_id});
  },[remember]);
  const [selectedId, setSelectedId] = useState('');
  const [earlierId, setEarlierId] = useState('');
  const [state, setState] = useState<ReviewState>('needs_review');
  const [rationale, setRationale] = useState('');
  const [uncertainty, setUncertainty] = useState('');
  const [elementIds, setElementIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [pinMode, setPinMode] = useState(false);
  const [draftPin, setDraftPin] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState<Assessment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dialog, setDialog] = useState<Capture | null>(null);
  const [sourceDetails, setSourceDetails] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [logFilter, setLogFilter] = useState<ReviewState | 'all'>('all');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const publicDemo = data?.deployment?.kind === 'public_demo' && data.deployment.read_only === true;
  const planRef = useRef<HTMLDivElement>(null);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => { document.title = `Forma ReCap · ${pageNames[page]}`; }, [page]);
  useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if((findingDrafts.hasDirty()||hasOperationDrafts())){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<Bootstrap>('/api/bootstrap')
      .then(async bootstrap => { const status = await request<Integration>('/api/integration/status'); if (active) { setData(bootstrap); setIntegration(status); setError(''); setSelectedId(current => current || bootstrap.captures.at(-1)?.capture_id || ''); setEarlierId(current => current || bootstrap.captures[0]?.capture_id || ''); } })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshVersion]);

  const captures = data?.captures || [];
  const selected = captures.find(c => c.capture_id === selectedId) || null;
  const earlier = captures.find(c => c.capture_id === earlierId) || null;
  const current = data?.assessments.filter(a => a.capture_ref.capture_id === selectedId).sort((a, b) => b.review.revision - a.review.revision)[0] || null;
  const visiblePin = pinMode && draftPin ? draftPin : selected?.placement.normalized_pin;
  const revisionId = current?.review.revision_id;
  const assessments = (data?.assessments || []).filter(a => !data?.assessments.some(b => b.previous_revision_id === a.review.revision_id));
  const reviewedCount = new Set(assessments.map(a => a.capture_ref.capture_id)).size;

  useEffect(()=>{if(page==='workspace'&&route.capture_id&&data?.captures.some(item=>item.capture_id===route.capture_id))setSelectedId(route.capture_id);},[page,route.capture_id,data?.captures]);

  useEffect(() => {
    setState(current?.state || 'needs_review');
    setRationale(current?.rationale || '');
    setUncertainty(current?.uncertainty_reason || '');
    setElementIds(current?.model_ref.element_refs.map(e => e.external_id) || data?.scope?.element_ids || []);
    setPinMode(false);
    setDraftPin(null);
    setSourceDetails(false);
  }, [selectedId, revisionId, data?.scope?.scope_id]);

  useEffect(() => {
    let active = true;
    setHistory([]);
    if (!current) return;
    setHistoryLoading(true);
    request<Assessment[]>(`/api/assessments/${encodeURIComponent(current.assessment_id)}/history`)
      .then(result => { if (active) setHistory(result); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [current?.assessment_id, revisionId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!dialog) return;
    returnFocusRef.current = document.activeElement as HTMLElement;
    closeDialogRef.current?.focus();
    const handler = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setDialog(null); };
    document.addEventListener('keydown', handler);
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = priorOverflow; returnFocusRef.current?.focus(); };
  }, [dialog]);

  const mutation = async <T,>(url: string, method: string, body: unknown): Promise<T> => { if(publicDemo)throw new Error('The public synthetic demo is a fixed, read-only snapshot.'); return request<T>(url, { method, body: JSON.stringify(body), headers: { 'X-CSRF-Token': data?.csrfToken || '' } }); };
  const changePage = (next: Page) => { void navigate({page:next}).then(changed=>{if(changed){setMobileNav(false);setError('');window.scrollTo({top:0});}}); };
  const openReview = (workspace:Workspace, selection?:ReviewSelection, section:ReviewSection='findings') => { void navigate({page:'field',workspace,section,item_id:selection?.element_id?`element:${selection.element_id}`:undefined,assignment_id:undefined,task_id:undefined,draft_id:undefined,entry_id:undefined,...selection}); };
  const chooseLegacyCapture = (capture_id:string) => { void navigate({page:'workspace',workspace:'fixture',capture_id,task_id:undefined,draft_id:undefined,entry_id:undefined}); };

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!selected || !data) return;
    if (!rationale.trim()) { setError('Add a rationale that explains your observation.'); return; }
    if (state !== 'observed_installed' && !uncertainty.trim()) { setError('Describe the uncertainty before saving this assessment.'); return; }
    setBusy('review'); setError('');
    try {
      const saved = await mutation<Assessment>('/api/assessments', 'POST', { capture_id: selected.capture_id, state, rationale: rationale.trim(), uncertainty_reason: uncertainty.trim() || null, element_ids: elementIds, previous_revision_id: current?.review.revision_id || null });
      setData({ ...data, assessments: [...data.assessments, saved] });
      setNotice(`Assessment revision ${saved.review.revision} saved. The original evidence is preserved.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }

  async function savePin(x: number, y: number) {
    if (!selected || !data || busy) return;
    setBusy('pin'); setError('');
    try {
      const updated = await mutation<Capture>(`/api/captures/${encodeURIComponent(selected.capture_id)}/placement`, 'PUT', { x: Math.max(0, Math.min(1, Number(x.toFixed(4)))), y: Math.max(0, Math.min(1, Number(y.toFixed(4)))) });
      setData({ ...data, captures: data.captures.map(c => c.capture_id === updated.capture_id ? updated : c) }); setPinMode(false); setDraftPin(null);
      setNotice('Manual plan pin saved. Existing assessment snapshots retain their original placement.');
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }
  function clickPlan(event: MouseEvent<HTMLDivElement>) {
    if (!pinMode) return;
    const rect = event.currentTarget.getBoundingClientRect();
    void savePin((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  function keyPlan(event: KeyboardEvent<HTMLDivElement>) {
    if (!pinMode || !selected) return;
    const pin = draftPin || selected.placement.normalized_pin || { x: 0.5, y: 0.5 };
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02] };
    if (offsets[event.key]) { event.preventDefault(); const [dx, dy] = offsets[event.key]; setDraftPin({ x: Math.max(0, Math.min(1, pin.x + dx)), y: Math.max(0, Math.min(1, pin.y + dy)) }); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void savePin(pin.x, pin.y); }
    if (event.key === 'Escape') { setPinMode(false); setDraftPin(null); }
  }
  async function createPacket() {
    if (!data) return;
    setBusy('export'); setError('');
    try { const packet = await mutation<Export>('/api/exports', 'POST', {}); setData({ ...data, exports: [packet, ...data.exports] }); setNotice('Evidence packet created. This immutable snapshot is ready to download.'); void navigate({page:'packets',workspace:'fixture'}); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }
  async function refreshStatus() {
    setBusy('status'); setError('');
    try { setIntegration(await request<Integration>('/api/integration/status')); setNotice('Connection status refreshed.'); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }
  async function loadProjects() {
    setBusy('projects'); setError('');
    try { const result = await request<{ projects: { id: string; attributes: { name: string } }[] }>('/api/aps/projects'); setProjects(result.projects.map(project => ({ id: project.id, name: project.attributes.name }))); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }
  async function logout() {
    setBusy('logout'); setError('');
    try { await mutation('/auth/logout', 'POST', {}); setProjects(null); setIntegration(await request<Integration>('/api/integration/status')); setNotice('Autodesk session signed out.'); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
  }

  if (loading && !data) return <div className="app-loading"><Brand /><LoaderCircle className="spin" size={26} /><p>Opening your evidence workspace…</p></div>;
  if (!data) return <div className="app-loading"><Brand /><CircleAlert size={32} /><h2>Workspace unavailable</h2><p>{error || 'The local server did not return a workspace.'}</p><button className="button primary" onClick={() => setRefreshVersion(v => v + 1)}><RotateCcw size={16} />Try again</button></div>;

  const fixture = data.mode === 'fixture';
  const navigationProblem = routeError || (publicDemo&&fieldWorkspace==='local'?'The public demo does not expose private photograph workspaces. Choose the synthetic demo or open the local application.':'') || (page==='workspace'&&fieldWorkspace==='local'?'The historical Evidence workspace contains synthetic scope records. The selected local photograph context is available in Element review.':'') || (page==='workspace'&&route.capture_id&&!data.captures.some(item=>item.capture_id===route.capture_id)?'This capture is not available in the historical scope workspace. Open Element review to inspect its individual evidence.':'') || (page==='workspace'&&((route.project_id&&route.project_id!==data.project?.id)||(route.scope_id&&route.scope_id!==data.scope?.scope_id)||(route.model_version_id&&route.model_version_id!==data.model?.version_id))?'The linked project, scope or model version is unavailable in this workspace. Historical references have not been remapped.':'');
  const localPhotos=!publicDemo && ['field','log','packets','operations','assignments','research'].includes(page) && fieldWorkspace==='local';
  const activeFieldContext=fieldContext?.workspace===fieldWorkspace?fieldContext:null;
  const displayedProject=localPhotos?(activeFieldContext?.project_name||'Local photograph workspace'):(data.project?.name || 'APS workspace');
  const displayedReviewer=localPhotos?(activeFieldContext?.reviewer_name||'Local reviewer'):data.user.name;
  const visibleAssessments = assessments.filter(a => logFilter === 'all' || a.state === logFilter).sort((a, b) => b.review.reviewed_at.localeCompare(a.review.reviewed_at));
  return <div className={`app-shell ${mobileNav ? 'nav-open' : ''}`}>
    <header className="global-header">
      <div className="global-product"><button className="mobile-menu icon-button" aria-label="Toggle navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><PanelLeftClose size={20} /></button><Brand /></div>
      <div className="global-project"><Box size={18} /><span>{displayedProject}</span><small>{publicDemo?'Saved demonstration':localPhotos?'Local photographs':fixture ? 'Local project' : 'Read-only connection'}</small></div>
      <div className="global-status"><span className={`environment-pill ${fixture ? '' : 'live'}`}><span />{publicDemo?'Public synthetic demo · Read only':localPhotos?'Local photographs · Manual references':fixture ? 'Synthetic demo data' : 'Live · read only'}</span><span className="topbar-avatar" title={publicDemo ? `Saved fixture reviewer: ${displayedReviewer}` : displayedReviewer}>LR</span></div>
    </header>
    <aside className="sidebar">
      <button className="project-switch" onClick={() => changePage('workspace')}><span className="project-avatar"><Box size={21} /></span><span><strong>{displayedProject}</strong><small>{publicDemo?'Public synthetic demo · Fixed snapshot':localPhotos?'Local evidence · Manual references':fixture ? 'Local project · Synthetic' : 'Authorized Autodesk access'}</small></span><ChevronDown size={14} /></button>
      <div className="nav-group-label">PROJECT WORKSPACE</div>
      <nav aria-label="Main navigation">
        {([{ id:'operations',icon:CheckCheck },{ id: 'workspace', icon: ScanLine }, { id: 'field', icon: FileCheck2 },{id:'assignments',icon:CalendarDays}, { id: 'log', icon: History }, { id: 'packets', icon: FileArchive },{id:'research',icon:ShieldCheck}, { id: 'connection', icon: Link2 }] as const).map(item => <button key={item.id} aria-current={page===item.id?'page':undefined} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => changePage(item.id)}><item.icon size={18} /><span>{pageNames[item.id]}</span>{item.id === 'connection' && <span className={`connection-dot ${integration?.authenticated ? 'on' : ''}`} />}</button>)}
      </nav>
      <div className="sidebar-bottom"><div className="prototype-card"><div><span className="small-lime-dot" />{publicDemo?'PUBLIC DEMO':'LOCAL PROTOTYPE'}</div><p>{publicDemo?'Fixed synthetic evidence.':'Source-linked evidence.'}<br />{publicDemo?'Read-only saved workflow.':'Human-reviewed observations.'}</p></div><div className="user-card"><span className="avatar">LR</span><span><strong>{displayedReviewer}</strong><small>{publicDemo?'Saved fixture reviewer · no visitor sign-in':localPhotos?'Self-asserted local reviewer':fixture ? 'Local fixture identity' : 'Local browser session'}</small></span><ShieldCheck size={17} /></div></div>
    </aside>
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="main-shell">
      <div className="topbar"><div className="breadcrumbs"><span>Projects</span><ChevronRight size={13} /><span>{displayedProject}</span><ChevronRight size={13} /><strong>{pageNames[page]}</strong></div><div className="topbar-right">{data.model && !localPhotos && <span className="topbar-reference"><Layers3 size={14} />{data.scope?.floor} · {data.model.version_label}</span>}</div></div>
      <main id="main-content">
        {error && <div className="alert error" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        {notice && <div className="toast" role="status"><CheckCheck size={18} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {publicDemo && <div className="public-demo-banner" role="note"><Info size={19}/><div><strong>Public synthetic demo · Read-only fixed snapshot</strong><p>Explore saved findings, recapture decisions, manual reconciliation, draft previews and evidence packets. Changes and photograph uploads are disabled. This demo has no authenticated visitor identity, live APS access or cloud saving.</p></div></div>}
        <div className="page-heading"><div><h1>{pageNames[page]}</h1><p>{page === 'operations'?'Review weekly exceptions, stable scope and the next required decisions.':page === 'assignments'?'Plan, acknowledge and supply targeted field evidence.':page === 'research'?'Verify integration capabilities and evaluate bounded research proposals.':page === 'field'?'Review individual elements, close evidence gaps, and reconcile trade reports.':page === 'workspace' ? 'Compare dated captures and record source-linked assessments.' : page === 'log' ? 'Human observations, source evidence, and correction history.' : page === 'packets' ? 'Download fixed snapshots of reviewed evidence.' : 'Manage authorized, read-only Autodesk project access.'}</p></div>{!navigationProblem && page === 'workspace' && <button className="button primary" disabled={publicDemo || !!busy || !fixture || !assessments.length} onClick={createPacket}>{busy === 'export' ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}Create evidence packet</button>}</div>
        {navigationProblem && <section className="panel route-problem" role="alert"><h2>Review link unavailable</h2><p>{navigationProblem}</p><p>No replacement capture, element or workspace has been selected.</p><div className="wb-actions"><button className="button" onClick={()=>openReview(fieldWorkspace,fieldSelection,route.section)}>Open selected Element review context</button><button className="button" onClick={()=>void navigate({...DEFAULT_REVIEW_ROUTE,capture_id:undefined,element_id:undefined,project_id:undefined,scope_id:undefined,model_version_id:undefined,task_id:undefined,draft_id:undefined,entry_id:undefined},{replace:true})}>Choose synthetic demo context</button></div></section>}
        {!navigationProblem && (page==='log'||page==='packets') && (route.capture_id||route.element_id) && <section className="retained-review-context" aria-label="Retained review context"><div><strong>Retained review context · {fieldWorkspace==='fixture'?'Synthetic demo':'Local photographs'}</strong><span>{route.element_id||'No selected element'}{fieldContext?.element_label?` · ${fieldContext.element_label}`:''} · {fieldContext?.capture_title||route.capture_id||'No selected capture'}</span><small>{fieldContext?.scope_name||route.scope_id||'No selected scope'} · {route.model_version_id||'No model reference'}. The register still shows its labeled full record set.</small></div><div className="wb-actions"><button className="button" onClick={()=>openReview(fieldWorkspace,fieldSelection)}>Element finding</button><button className="button" onClick={()=>openReview(fieldWorkspace,fieldSelection,'tasks')}>Recapture</button><button className="button" onClick={()=>openReview(fieldWorkspace,fieldSelection,'reconciliation')}>Reconciliation</button><button className="button" onClick={()=>openReview(fieldWorkspace,fieldSelection,'drafts')}>Local drafts</button></div></section>}

        {!navigationProblem && page==='field' && (fixture?<ReviewWorkbench key={fieldWorkspace} readOnly={publicDemo} csrfToken={data.csrfToken} initialWorkspace={fieldWorkspace} initialSection={route.section} initialSelection={fieldSelection} onBeforeLeaveChange={registerLeaveGuard} onNavigationChange={context=>{void navigate({page:'field',...context,item_id:context.element_id?`element:${context.element_id}`:undefined,assignment_id:undefined},{skipGuard:true});}} onContextChange={updateFieldContext} onOpenPackets={workspace=>{void navigate({page:'packets',workspace},{skipGuard:true});}}/>:<div className="panel live-empty"><EmptyState icon={Cloud} title="Live element review requires verified sources">Connect an authorized project and verify model viewables and capture access before live review. Local photographs and synthetic fixtures remain separate from live mode.</EmptyState><button className="button primary" onClick={()=>changePage('connection')}>Open APS connection <ArrowRight size={16}/></button></div>)}
        {!navigationProblem && page==='operations' && (fixture?<WorkspaceBoundary resetKey={page+fieldWorkspace}><Suspense fallback={<p>Loading project decisions…</p>}><ProjectOperations key={fieldWorkspace} workspace={fieldWorkspace} csrfToken={data.csrfToken} readOnly={publicDemo} initialItemId={route.item_id} onContextChange={updateFieldContext} onOpenItem={id=>{void navigate({page:'operations',item_id:id});}} onOpenReview={(capture,element,section,taskId)=>openReview(fieldWorkspace,{capture_id:capture,element_id:element,task_id:taskId},section??'findings')} onAssignments={(itemId,assignmentId)=>{void navigate({page:'assignments',item_id:itemId,assignment_id:assignmentId});}} onResearch={itemId=>{void navigate({page:'research',item_id:itemId});}} onWorkspaceChange={workspace=>{void navigate({workspace,item_id:undefined});}}/></Suspense></WorkspaceBoundary>:<p className="wb-info">Live project operations require separately verified project sources. No synthetic fallback is shown.</p>)}
        {!navigationProblem && page==='assignments' && (fixture?<WorkspaceBoundary resetKey={page+fieldWorkspace}><Suspense fallback={<p>Loading field assignments…</p>}><FieldAssignments key={fieldWorkspace} workspace={fieldWorkspace} csrfToken={data.csrfToken} readOnly={publicDemo} initialAssignmentId={route.assignment_id} onOpenItem={id=>{void navigate({page:'operations',item_id:id});}}/></Suspense></WorkspaceBoundary>:<p className="wb-info">Live field assignments are unavailable until shared project access and authorization are verified.</p>)}
        {!navigationProblem && page==='research' && (fixture?<WorkspaceBoundary resetKey={page+fieldWorkspace}><Suspense fallback={<p>Loading integration research…</p>}><IntegrationResearch key={fieldWorkspace} workspace={fieldWorkspace} csrfToken={data.csrfToken} readOnly={publicDemo} onOpenItem={id=>{void navigate({page:'operations',item_id:id});}}/></Suspense></WorkspaceBoundary>:<p className="wb-info">The live APS connection remains read-only. Research records belong to a separate local workspace.</p>)}

        {!navigationProblem && page === 'workspace' && <>
          {!fixture || !selected || !data.scope || !data.model ? <div className="panel live-empty"><EmptyState icon={Cloud} title={fixture ? 'No captures in this workspace' : 'Your live connection starts here'}>{fixture ? 'Add authorized source data through a verified capture adapter.' : 'Connect your Autodesk account to inspect authorized hub projects. The synthetic evidence workspace is isolated from live mode.'}</EmptyState><button className="button primary" onClick={() => changePage('connection')}>Open APS connection <ArrowRight size={16} /></button></div> : <>
            <div className="scope-bar"><div className="scope-item"><span className="scope-icon"><Layers3 size={18} /></span><span><SmallLabel>REVIEW SCOPE</SmallLabel><strong>{data.scope.name}</strong></span></div><div className="scope-divider" /><div className="scope-item"><span><SmallLabel>TRADE / LEVEL</SmallLabel><strong>{data.scope.trade}<span className="text-separator">/</span>{data.scope.floor}</strong></span></div><div className="scope-divider" /><div className="scope-item"><span><SmallLabel>DESIGN REFERENCE</SmallLabel><strong>{data.model.name}<span className="version-tag">{data.model.version_label}</span></strong></span></div><span className="scope-lock"><ShieldCheck size={14} />Fixed model version</span></div>
            <div className="workspace-grid">
              <div className="evidence-column">
                <section className="panel comparison-panel" aria-labelledby="comparison-title">
                  <div className="panel-heading"><div><h2 id="comparison-title">Capture comparison</h2><p>East corridor <span className="tiny-dot" /> {data.scope.floor}</p></div><span className="subtle-badge"><Image size={13} />Synthetic illustrations</span></div>
                  <div className="comparison-toolbar"><div className="segmented-control" aria-label="Comparison mode"><span className="selected"><Layers3 size={14} />Side by side</span><span className="locked-option" title="360 imagery is not supplied in this fixture"><ScanLine size={14} />360° unavailable</span></div><span className="manual-label"><MapPin size={13} />Manually associated</span></div>
                  <div className="capture-comparison">
                    {earlier && <CaptureCard capture={earlier} label="REFERENCE CAPTURE" assessment={assessments.find(a => a.capture_ref.capture_id === earlier.capture_id)} onExpand={() => setDialog(earlier)} select={<select aria-label="Reference capture" value={earlierId} onChange={event => setEarlierId(event.target.value)}>{captures.map(c => <option key={c.capture_id} value={c.capture_id}>{date(captureDate(c))}</option>)}</select>} />}
                    <div className="comparison-divider"><ArrowRight size={14} /></div>
                    <CaptureCard capture={selected} label="REVIEWING CAPTURE" active assessment={current || undefined} onExpand={() => setDialog(selected)} select={<select aria-label="Reviewing capture" value={selectedId} onChange={event => chooseLegacyCapture(event.target.value)}>{captures.map(c => <option key={c.capture_id} value={c.capture_id}>{date(captureDate(c))}</option>)}</select>} />
                  </div>
                  {captures.some(c => c.media_status && c.media_status !== "verified") && <div className="media-warning" role="alert"><CircleAlert size={14} />Source integrity warning: a capture changed or is unavailable. Review and export require the original evidence.</div>}<div className="comparison-caption"><Info size={14} /><span>Capture dates show when evidence was recorded. They do not establish an installation date.</span></div>
                  <div className="timeline-section"><div className="timeline-heading"><SmallLabel>CAPTURE TIMELINE</SmallLabel><span>{captures.length} captures <span className="text-separator">·</span> {reviewedCount} reviewed</span></div><div className="timeline"><div className="timeline-line" />{captures.map((capture, index) => <button key={capture.capture_id} className={`timeline-stop ${capture.capture_id === selectedId ? 'active' : ''}`} onClick={() => chooseLegacyCapture(capture.capture_id)} aria-pressed={capture.capture_id === selectedId}><span className="timeline-marker">{capture.capture_id === selectedId ? <span /> : assessments.some(a => a.capture_ref.capture_id === capture.capture_id) ? <Check size={9} /> : null}</span><strong>{date(captureDate(capture), true)}</strong><span>{index === 0 ? 'Reference' : 'Follow-up'} capture</span></button>)}<div className="timeline-tail"><span /><small>Next capture</small></div></div></div>
                </section>
                <div className="context-grid">
                  <section className="panel plan-panel" aria-labelledby="plan-title"><div className="panel-heading compact"><div><h2 id="plan-title">Location context</h2><p>{data.plan?.name}</p></div><button className={`button tiny ${pinMode ? 'soft-green' : 'ghost'}`} disabled={publicDemo || !!busy} onClick={() => { setDraftPin(!pinMode ? selected.placement.normalized_pin || { x: 0.5, y: 0.5 } : null); setPinMode(!pinMode); if (!pinMode) window.setTimeout(() => planRef.current?.focus(), 0); }}>{pinMode ? <X size={13} /> : <MapPin size={13} />}{pinMode ? 'Cancel' : 'Move pin'}</button></div><div className={`floor-plan ${pinMode ? 'placing' : ''}`} ref={planRef} role={pinMode ? 'application' : 'img'} aria-label={pinMode ? 'Place manual capture pin. Click a position or use arrow keys, then Enter to save.' : 'Synthetic mechanical floor plan with manually placed capture pin'} tabIndex={pinMode ? 0 : -1} onClick={clickPlan} onKeyDown={keyPlan}>{data.plan && <img src={data.plan.display_url || data.plan.url} alt="Synthetic Level 02 mechanical floor plan" draggable={false} />}{visiblePin && <span className="plan-pin" style={{ left: `${visiblePin.x * 100}%`, top: `${visiblePin.y * 100}%` }}><span><MapPin size={17} fill="currentColor" /></span><span className="plan-pin-tooltip">Selected capture</span></span>}{pinMode && <span className="plan-hint">Click to place · Arrow keys to adjust · Enter to save</span>}<span className="north-arrow">N ↑</span></div><div className="context-footer"><MapPin size={12} /><span>Manual plan pin <span className="text-separator">·</span> Not a verified 3D registration</span></div></section>
                  <section className="panel model-panel" aria-labelledby="elements-title"><div className="panel-heading compact"><div><h2 id="elements-title">Model associations</h2><p>Human-selected scope mapping</p></div><span className="count-badge">{elementIds.length}</span></div><div className="element-list">{data.model.elements.map(element => <label className={`element-row ${elementIds.includes(element.external_id) ? 'selected' : ''}`} key={element.external_id}><input type="checkbox" disabled={publicDemo} checked={elementIds.includes(element.external_id)} onChange={() => setElementIds(previous => previous.includes(element.external_id) ? previous.filter(id => id !== element.external_id) : [...previous, element.external_id])} /><span className="element-icon"><Box size={17} /></span><span><strong>{element.label}</strong><small>{element.external_id}</small></span><span className="custom-check"><Check size={11} /></span></label>)}</div><div className="context-footer"><Link2 size={12} /><span>{data.model.version_label} <span className="text-separator">·</span> Associations saved with assessment</span></div></section>
                </div>
                <div className="evidence-disclaimer"><ShieldCheck size={15} /><p>Reviewer observations support evidence review. They do not certify completion, quantities, inspection acceptance, or payment.</p></div>
              </div>
              <aside className="review-column">
                <section className="panel review-panel" aria-labelledby="review-title"><div className="review-heading"><div><span className="review-icon"><FileCheck2 size={18} /></span><h2 id="review-title">Scope assessment</h2></div><span className="human-label">HUMAN REVIEW</span></div><div className="review-meta"><span>{date(captureDate(selected), true)} capture</span>{current ? <span className="revision-badge">Revision {current.review.revision}</span> : <span className="revision-badge">Not yet reviewed</span>}</div><form onSubmit={saveReview}><fieldset className="wb-readonly-controls" disabled={publicDemo}><fieldset className="state-fieldset"><legend>What does the evidence show?</legend>{(Object.keys(stateInfo) as ReviewState[]).map(value => <label key={value} className={`state-option ${state === value ? 'selected' : ''} ${stateInfo[value].className}`}><input type="radio" name="assessment-state" value={value} checked={state === value} onChange={() => setState(value)} /><span className="state-radio">{state === value && <span />}</span><span><strong>{stateInfo[value].label}</strong><small>{stateInfo[value].detail}</small></span></label>)}</fieldset><label className="form-label" htmlFor="rationale">{current ? 'Correction rationale' : 'Review rationale'} <span>Required</span></label><textarea id="rationale" rows={3} required maxLength={5000} value={rationale} onChange={event => setRationale(event.target.value)} placeholder={current ? "Explain the revised observation and why the earlier assessment is being corrected…" : "Describe what is visible in this capture and why you chose this state…"} /><label className="form-label" htmlFor="uncertainty">Uncertainty & limitations <span>{state === 'observed_installed' ? 'Optional' : 'Required'}</span></label><textarea id="uncertainty" rows={2} required={state !== 'observed_installed'} maxLength={5000} value={uncertainty} onChange={event => setUncertainty(event.target.value)} placeholder="Occlusion, incomplete coverage, or questions for follow-up…" /><div className="review-context"><ShieldCheck size={14} /><span>{publicDemo?'Recorded reviewer':'Saved as'} <strong>{data.user.name}</strong><small>{elementIds.length} model element{elementIds.length === 1 ? '' : 's'} associated · {data.model.version_label}</small></span></div><button className="button save-button" type="submit" disabled={!!busy || pinMode || (selected.media_status !== undefined && selected.media_status !== "verified")}>{busy === 'review' ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{current ? 'Save new revision' : 'Save assessment'}<ArrowRight size={16} /></button>{current && <p className="save-footnote">{publicDemo?'Historical scope assessment preserved in the fixed demo snapshot.':'A new revision preserves the earlier assessment.'}</p>}</fieldset></form></section>
                <section className="panel provenance-panel"><button className="disclosure-heading" aria-expanded={sourceDetails} onClick={() => setSourceDetails(!sourceDetails)}><span><Link2 size={15} />Evidence provenance</span><ChevronDown size={15} className={sourceDetails ? 'rotate' : ''} /></button><div className="provenance-summary"><span className="source-square"><Image size={17} /></span><span><strong>{selected.media_status && selected.media_status !== "verified" ? `Source ${selected.media_status}` : "Original synthetic illustration"}</strong><small>Date supplied by fixture · {selected.capture_ref.date_precision === 'timestamp' ? 'Timestamp recorded' : selected.capture_ref.date_precision === 'date' ? 'Day precision' : 'Date unknown'}</small></span><button className="icon-button" aria-label="Inspect source evidence" disabled={selected.media_status !== undefined && selected.media_status !== "verified"} onClick={() => setDialog(selected)}><ArrowUpRight size={16} /></button></div>{sourceDetails && <dl className="metadata-list"><div><dt>Capture ID</dt><dd>{selected.capture_id}</dd></div><div><dt>Captured date</dt><dd>{date(captureDate(selected))}</dd></div><div><dt>Original timestamp</dt><dd>{selected.capture_ref.captured_at || "Not supplied · date only"}</dd></div><div><dt>Uploaded</dt><dd>{time(selected.capture_ref.uploaded_at)}</dd></div><div><dt>Date source</dt><dd>{selected.capture_ref.date_source}</dd></div><div><dt>Timezone</dt><dd>{selected.capture_ref.original_timezone || 'Not supplied'}</dd></div><div><dt>Plan version</dt><dd>{data.plan?.version_id || 'No plan'}</dd></div></dl>}</section>
                <section className="panel history-panel"><div className="panel-heading compact"><h2><History size={15} />Correction history</h2>{current && <span className="count-badge">{history.length}</span>}</div>{historyLoading ? <div className="inline-loading"><LoaderCircle size={15} className="spin" />Loading revisions…</div> : history.length ? <div className="revision-list">{history.slice().reverse().map(revision => <div className="revision-item" key={revision.review.revision_id}><span className="revision-dot" /><div><div className="revision-item-heading"><strong>Revision {revision.review.revision}</strong><span>{revision.review.revision === current?.review.revision ? 'Current' : 'Preserved'}</span></div><p>{stateInfo[revision.state].label}</p><small>{time(revision.review.reviewed_at)}</small>{revision.review.revision > 1 && <p className="revision-rationale">{revision.rationale}</p>}</div></div>)}</div> : <p className="small-empty">Your first assessment starts the review history.</p>}</section>
              </aside>
            </div>
          </>}
        </>}

        {!navigationProblem && page === 'log' && <ReviewRegister key={`log:${fieldWorkspace}`} selection={fieldSelection} readOnly={publicDemo} view="log" csrfToken={data.csrfToken} initialWorkspace={fieldWorkspace} onContextChange={updateFieldContext} onWorkspaceChange={workspace=>{void navigate({workspace});}} onReview={openReview} onOpenItem={(workspace,item_id)=>{void navigate({page:'operations',workspace,item_id});}}>
          <div className="stats-row"><Stat label="CAPTURES IN SCOPE" value={captures.length} note="Dated evidence records" icon={Image} /><Stat label="CAPTURES WITH SCOPE REVIEW" value={reviewedCount} note="Human-authored assessments" icon={FileCheck2} /><Stat label="SCOPE NEEDS REVIEW" value={assessments.filter(a => a.state === 'needs_review').length} note="Uncertainty remains explicit" icon={CircleAlert} /><Stat label="SCOPE REVISIONS" value={assessments.reduce((sum, assessment) => sum + assessment.review.revision, 0)} note="Originals and corrections" icon={History} /></div>
          <section className="panel"><div className="panel-heading log-heading"><div><h2>Historical scope assessment register</h2><p>Current scope assessments with their original evidence, selected model associations and correction history.</p></div><select className="filter-select" aria-label="Filter assessments by state" value={logFilter} onChange={event => setLogFilter(event.target.value as ReviewState | 'all')}><option value="all">All review states</option>{Object.entries(stateInfo).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}</select></div>{visibleAssessments.length ? <div className="assessment-table-wrap"><table className="assessment-table"><thead><tr><th>Evidence / capture date</th><th>Reviewer state</th><th>Scope / model</th><th>Revision / reviewer</th><th><span className="sr-only">Open review</span></th></tr></thead><tbody>{visibleAssessments.map(assessment => { const capture = captures.find(c => c.capture_id === assessment.capture_ref.capture_id); return <tr key={assessment.review.revision_id}><td><div className="table-capture">{capture && <img src={capture.display_url || capture.media_url} alt="" />}<span><strong>{capture?.title || assessment.capture_ref.capture_id}</strong><small>{date(assessment.capture_ref.captured_date || assessment.capture_ref.captured_at)}</small></span></div></td><td><StatusBadge state={assessment.state} /></td><td><strong>{assessment.scope_ref.trade}</strong><small>{data.model?.version_label} · {assessment.model_ref.element_refs.length} elements</small></td><td><strong>Revision {assessment.review.revision}</strong><small>{time(assessment.review.reviewed_at)}</small><small>{assessment.review.reviewer_id}</small></td><td><button className="button ghost tiny" onClick={() => chooseLegacyCapture(assessment.capture_ref.capture_id)}>Review <ArrowUpRight size={14} /></button></td></tr>; })}</tbody></table></div> : <EmptyState icon={History} title={logFilter === 'all' ? 'Your review record starts with an observation' : 'No assessments match this state'}>{logFilter === 'all' ? 'Compare your captures in the evidence workspace, then save a reviewer assessment.' : 'Choose another review state to inspect the register.'}</EmptyState>}</section><div className="info-strip"><Info size={16} /><span>Counts describe review coverage. No installed quantity or percentage complete is inferred.</span></div>
        </ReviewRegister>}

        {!navigationProblem && page === 'packets' && <ReviewRegister key={`packets:${fieldWorkspace}`} selection={fieldSelection} readOnly={publicDemo} view="packets" csrfToken={data.csrfToken} initialWorkspace={fieldWorkspace} onContextChange={updateFieldContext} onWorkspaceChange={workspace=>{void navigate({workspace});}} onReview={openReview} onOpenItem={(workspace,item_id)=>{void navigate({page:'operations',workspace,item_id});}}>
          <div className="packet-hero"><div className="packet-hero-art"><FileArchive size={48} strokeWidth={1.2} /><span><Check size={14} /></span></div><div><SmallLabel>AN EVIDENCE TRAIL YOU CAN TAKE WITH YOU</SmallLabel><h2>A snapshot. Every source intact.</h2><p>Each packet freezes the assessment revisions, model references, manual placements, and synthetic source media at the moment of export.</p></div><div className="packet-features"><span><ShieldCheck size={16} />Immutable snapshot</span><span><History size={16} />Correction history included</span><span><FileJson size={16} />Machine-readable manifest</span></div></div>
          <section className="panel"><div className="panel-heading"><div><h2>Historical scope packets <span className="inline-count">{data.exports.length}</span></h2><p>Download the self-contained report or its structured manifest.</p></div><span className="subtle-badge"><FolderClosed size={13} />{publicDemo?'Published fixed snapshot':'Stored locally'}</span></div>{data.exports.length ? <div className="packet-list">{data.exports.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map((packet, index) => <div className="packet-row" key={packet.id}><div className="packet-file-icon"><FileArchive size={23} /></div><div className="packet-description"><div><strong>Historical scope packet · v0.1</strong>{index === 0 && <span className="latest-tag">Latest</span>}</div><p>{date(packet.created_at)} <span className="text-separator">·</span> {time(packet.created_at)} <span className="text-separator">·</span> {packet.revision_count} preserved revision{packet.revision_count === 1 ? '' : 's'}</p><code>{packet.id}</code></div><div className="packet-actions"><a className="button ghost" href={packet.manifest_url} download><FileJson size={15} />JSON</a><a className="button secondary" href={packet.html_url} download><ArrowDownToLine size={15} />HTML report</a></div></div>)}</div> : <EmptyState icon={FileArchive} title="Build a traceable evidence packet">Save at least one assessment, then select “Create evidence packet.” Each export remains tied to the exact evidence and revisions it captured.</EmptyState>}</section><div className="info-strip"><Info size={16} /><span>Packets contain synthetic demonstration evidence. They are review records and do not certify completed or accepted work.</span></div>
        </ReviewRegister>}

        {!navigationProblem && page === 'connection' && <div className="connection-layout"><section className="panel connection-card"><div className="connection-card-top"><span className="aps-mark"><Cloud size={27} /></span><span className={`status-badge ${integration?.authenticated ? 'observed' : 'needs-review'}`}><span />{publicDemo?'Disabled in public demo':integration?.authenticated ? 'Authenticated' : 'Not connected'}</span></div><h2>Autodesk Platform Services</h2><p>{publicDemo?'This public synthetic snapshot establishes no APS user, project or model access.':'Server-managed OAuth for authorized, read-only access to the configured Forma hub.'}</p><div className="connection-mode"><SmallLabel>WORKSPACE MODE</SmallLabel><strong>{publicDemo?'Public synthetic snapshot':fixture ? 'Synthetic fixture' : 'Live Autodesk connection'}</strong><p>{publicDemo?'Saved synthetic records are available for inspection. APS authentication and external project access are disabled here.':fixture ? 'The local workflow is ready to explore. Live APS data stays separate from demo records.' : 'Live mode contains no synthetic project records. Sign in to inspect authorized projects.'}</p></div><dl className="connection-details"><div><dt>Credentials configured</dt><dd>{publicDemo?'Not used in public demo':integration?.configured ? <><Check size={14} />Yes · server-side</> : 'Not configured'}</dd></div><div><dt>Hub ID</dt><dd className="mono">{publicDemo?'No live hub access':integration?.hub_id || 'Not configured'}</dd></div><div><dt>OAuth callback</dt><dd className="mono">{publicDemo?'Sign-in disabled':integration?.callback || 'Unavailable'}</dd></div><div><dt>Access policy</dt><dd><ShieldCheck size={14} />Read only</dd></div></dl><div className="connection-message"><Info size={16} /><p>{integration?.message || 'Status has not been returned by the local server.'}</p></div><div className="connection-actions">{!publicDemo && !fixture && integration?.configured && !integration.authenticated && <a className="button primary" href="/auth/login"><LogIn size={16} />Sign in with Autodesk<ArrowUpRight size={15} /></a>}{!publicDemo && integration?.authenticated && <><button className="button primary" disabled={!!busy} onClick={loadProjects}>{busy === 'projects' ? <LoaderCircle size={15} className="spin" /> : <FolderClosed size={15} />}Read authorized projects</button><button className="button secondary" disabled={!!busy} onClick={logout}><LogOut size={15} />Sign out</button></>}<button className="button secondary" onClick={refreshStatus} disabled={!!busy}><RotateCcw size={15} className={busy === 'status' ? 'spin' : ''} />Refresh status</button></div>{fixture && !publicDemo && <p className="connection-hint">To use live sign-in, set the server’s data mode to <code>live</code> and restart it. Your local evidence remains in the fixture workspace.</p>}{projects && <div className="authorized-projects"><h3>Authorized projects <span className="count-badge">{projects.length}</span></h3>{projects.length ? projects.map(project => <div key={project.id}><FolderClosed size={17} /><span><strong>{project.name}</strong><code>{project.id}</code></span></div>) : <p>No projects were returned for this hub and user. A token alone does not establish project access.</p>}</div>}</section><div className="connection-side"><section className="panel capability-card"><div className="panel-heading compact"><h2>Capability boundaries</h2><ShieldCheck size={17} /></div><div className="capability-list"><Capability title={publicDemo?"Saved evidence review":"Local evidence review"} detail={publicDemo?"Fixed read-only synthetic snapshot":"Persistent fixture workflow"} enabled={fixture} /><Capability title="APS OAuth sign-in" detail={publicDemo?'Disabled in public demo':fixture ? 'Available in live mode' : 'User-context authorization'} enabled={!!integration?.authenticated} /><Capability title="Authorized project read" detail="Requires successful live verification" enabled={projects !== null} /><Capability title="Capture / BIM registration" detail="Manual associations only" /><Capability title="Issue creation" detail="Unverified · External writes disabled" /><Capability title="Automatic progress measurement" detail="Outside the first workflow" /></div></section><div className="connection-note"><ShieldCheck size={22} /><h3>Source evidence comes first.</h3><p>Client secrets and tokens stay on the server. A successful sign-in does not verify model, capture, or Issue API access.</p></div></div></div>}
        <footer className="workspace-footer"><span><span className="footer-wordmark">FORMA RECAP</span><span className="text-separator">/</span>Evidence with context.</span><span>{publicDemo?'Public synthetic demo · Fixed snapshot · Read only':localPhotos?'Local photographs · Manual references · Local storage':fixture ? 'Synthetic demonstration · Local storage' : 'Live mode · Read-only APS access'}</span></footer>
      </main>
    </div>
    {dialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDialog(null); }}><section className="media-dialog" role="dialog" aria-modal="true" aria-labelledby="media-dialog-title" onKeyDown={event => { if (event.key === 'Tab') { const focusable = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]'); const first = focusable[0]; const last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }}><div className="media-dialog-heading"><div><SmallLabel>SOURCE EVIDENCE · SYNTHETIC DEMONSTRATION</SmallLabel><h2 id="media-dialog-title">{dialog.title} <span>— {date(captureDate(dialog))}</span></h2></div><button ref={closeDialogRef} className="icon-button" aria-label="Close source evidence" onClick={() => setDialog(null)}><X size={22} /></button></div><img src={dialog.display_url || dialog.media_url} alt={`Original synthetic illustration, ${dialog.title}, capture date ${date(captureDate(dialog))}`} /><div className="media-dialog-footer"><span><CalendarDays size={15} />Captured: {date(captureDate(dialog))} · {dialog.capture_ref.date_precision} precision</span><a className="button secondary tiny" href={dialog.media_url} target="_blank" rel="noreferrer">Open original <ExternalLink size={13} /></a></div></section></div>}
  </div>;
}

function Brand() { return <div className="brand"><img src="/brand/autodesk-forma-recap.png" width="3440" height="1042" alt="AUTODESK Forma ReCap" /></div>; }
function CaptureCard({ capture, label, active, assessment, onExpand, select }: { capture: Capture; label: string; active?: boolean; assessment?: Assessment; onExpand: () => void; select: React.ReactNode }) { return <div className={`capture-card ${active ? 'active' : ''}`}><div className="capture-card-header"><SmallLabel>{label}</SmallLabel><div className="capture-date-select"><CalendarDays size={13} />{select}<ChevronDown size={12} /></div></div><div className="capture-image">{capture.media_status && capture.media_status !== "verified" ? <div className="media-unavailable"><CircleAlert size={23} /><strong>Evidence {capture.media_status}</strong><span>Original source integrity could not be confirmed.</span></div> : <img src={capture.display_url || capture.media_url} alt={`Synthetic ${capture.title} illustration captured ${date(captureDate(capture))}`} />}<span className="image-label">SYNTHETIC EVIDENCE</span><button className="expand-image" disabled={capture.media_status !== undefined && capture.media_status !== "verified"} aria-label={`Inspect ${date(captureDate(capture))} source evidence`} onClick={onExpand}><Maximize2 size={15} /></button><span className="image-caption"><span className="image-caption-icon"><MapPin size={13} /></span>{capture.title}<span>01</span></span></div><div className="capture-card-footer"><span><Clock3 size={12} />{capture.capture_ref.date_precision === 'date' ? 'Day precision' : capture.capture_ref.date_precision === 'timestamp' ? 'Timestamp recorded' : 'Date unknown'}</span>{assessment ? <StatusBadge state={assessment.state} /> : <span className="unreviewed-label">Unreviewed</span>}</div></div>; }
function Stat({ label, value, note, icon: Icon }: { label: string; value: number; note: string; icon: typeof Image }) { return <div className="stat-card"><div><SmallLabel>{label}</SmallLabel><Icon size={18} /></div><strong>{value.toString().padStart(2, '0')}</strong><p>{note}</p></div>; }
function Capability({ title, detail, enabled = false }: { title: string; detail: string; enabled?: boolean }) { return <div className="capability-item"><span className={`capability-icon ${enabled ? 'enabled' : ''}`}>{enabled ? <Check size={13} /> : <Unplug size={13} />}</span><span><strong>{title}</strong><small>{detail}</small></span></div>; }
