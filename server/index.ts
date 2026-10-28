import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './domain.ts';
import { createAps } from './aps.ts';
import { createReviewStore } from './review.ts';
import { createWorkflows } from './workflows.ts';
import { displayMedia } from './media-render.ts';
import { createScopeOperations } from './scope-operations.ts';
import { createFieldOperations } from './field-operations.ts';
import { createResearchOperations } from './research-operations.ts';
import { createCommercialOperations } from './commercial-operations.ts';
import { createHash } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.APP_MODE || 'fixture';
  if (!['fixture', 'live'].includes(mode)) throw new Error('APP_MODE must be fixture or live.');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be a valid port.');
  return { mode: mode as 'fixture'|'live', port, dataDir: resolve(env.DATA_DIR || resolve(ROOT,'data')),
    clientId: env.APS_CLIENT_ID || '', clientSecret: env.APS_CLIENT_SECRET || '',
    callback: env.APS_CALLBACK_URL || 'http://localhost:8080/', hubId: env.APS_HUB_ID || '' };
}
type Config = ReturnType<typeof loadConfig>;
type LocalSession = { csrf: string; expires: number };
export type PublicDemoDeployment = {kind:'public_demo';read_only:true;label:'Public synthetic demo';persistence:'fixed_snapshot';allowedOrigins:string[]};
const token = () => randomBytes(32).toString('hex');
function fail(status:number,message:string): never { throw Object.assign(new Error(message),{status}); }
function cookies(req:http.IncomingMessage) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c=>c.trim().split('=')).filter(c=>c.length===2));
}
async function body(req:http.IncomingMessage, limit=65536) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415,'Use application/json.');
  const chunks:Buffer[]=[]; let size=0;
  for await (const chunk of req) { size+=chunk.length; if(size>limit) fail(413,'Request too large.'); chunks.push(chunk); }
  let value:unknown;
  try { value=JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { fail(400,'Invalid JSON.'); }
  if(!value || typeof value!=='object' || Array.isArray(value)) fail(400,'JSON body must be an object.');
  return value as Record<string,unknown>;
}
function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }

export function createApp(config:Config, deps: {store?:any; aps?:any; deployment?:PublicDemoDeployment} = {}) {
  const publicDemo=deps.deployment?.kind==='public_demo';
  if(publicDemo && (config.mode!=='fixture' || config.clientId || config.clientSecret || config.hubId || deps.aps)) throw new Error('Public synthetic deployments cannot use live mode or APS credentials/adapters.');
  const deployment=publicDemo?{kind:'public_demo',read_only:true,label:'Public synthetic demo',persistence:'fixed_snapshot'}:null;
  mkdirSync(config.dataDir,{recursive:true,mode:0o700});
  const store=deps.store || createStore({dbPath:resolve(config.dataDir,`${config.mode}.sqlite`),mediaDir:resolve(ROOT,'server/media'),mode:config.mode});
  const aps=deps.aps || createAps({mode:config.mode,clientId:config.clientId,clientSecret:config.clientSecret,callback:config.callback,hubId:config.hubId});
  const localSessions=new Map<string,LocalSession>();
  // Lazy creation keeps live mode entirely separate from local/synthetic sources.
  const reviewStores=new Map<string,ReturnType<typeof createReviewStore>>();
  const workflowStores=new Map<string,ReturnType<typeof createWorkflows>>();
  const operationStores=new Map<string,any>();
  function workspace(name:string) {
    if(config.mode!=='fixture') fail(409,'Local review is unavailable in live mode. Verified project/model access is required before live review.');
    if(publicDemo && name==='local') fail(409,'Local photographs and private project workspaces are available only in the local application. This public deployment contains fixed synthetic evidence.');
    if(!['fixture','local'].includes(name)) fail(404,'Review workspace not found.');
    if(!reviewStores.has(name)) {
      const review=createReviewStore({dbPath:resolve(config.dataDir,`${name}-review.sqlite`),uploadDir:resolve(config.dataDir,`${name}-originals`),workspace:name as 'fixture'|'local',legacyStore:store,...(name==='fixture'?{syntheticImportPath:resolve(ROOT,'server/media/synthetic-recapture.png')}:{})});
      try {
        const workflows=createWorkflows({db:review.db,context:()=>review.bootstrap(),getFindingRevision:(id:string)=>review.getFindingRevision(id),getCapture:(id:string)=>review.getCapture(id)});
        const base=():any=>({...review.bootstrap(),...workflows.bootstrap()});
        const scopes=createScopeOperations({db:review.db,context:base,getCapture:review.getCapture,getReviewTemplate:(id:string)=>field.bootstrap().requirement_revisions.find((r:any)=>r.revision_id===id)??fail(404,'Review template unavailable.')});
        const extended=()=>{const s=scopes.bootstrap();const b=base();return {...b,items:s.items,scope_finding_revisions:s.finding_revisions,all_finding_revisions:[...new Map([...b.finding_revisions,...s.finding_revisions].map((f:any)=>[f.revision_id,f])).values()]};};
        const field=createFieldOperations({db:review.db,context:extended,getItem:scopes.getItem,getCapture:review.getCapture,importPhoto:review.importPhoto});
        const research=createResearchOperations({db:review.db,context:extended,getItem:scopes.getItem,getCapture:review.getCapture});
        const historicalPackets=()=>review.bootstrap().exports.map((p:any)=>({id:p.id,manifest:review.getExport(p.id).manifest}));
        const commercial=createCommercialOperations({db:review.db,context:extended,getItem:scopes.getItem,getCapture:review.getCapture,historicalPackets,packetSnapshot:(selection:any)=>{
          const s=scopes.bootstrap();const selected=new Set<string>(selection.item_ids);const b=base();
          const revisions=[...new Map([...b.finding_revisions,...s.finding_revisions].map((f:any)=>[f.revision_id,f])).values()].filter((f:any)=>selected.has(f.item_id??`element:${f.model_ref?.element_id}`));
          const captureIds=new Set<string>(revisions.map((f:any)=>f.capture_ref.capture_id));
          const fieldSnapshot=field.snapshot([...selected]),researchSnapshot=research.snapshot([...selected]);
          for(const a of fieldSnapshot.assignment_events){if(a.example_capture_id)captureIds.add(a.example_capture_id);for(const e of a.supplied_evidence??[])captureIds.add(e.capture_id);}
          for(const t of b.tasks)if(selected.has(`element:${t.element_id}`)){if(t.source_capture_id)captureIds.add(t.source_capture_id);if(t.new_capture_id)captureIds.add(t.new_capture_id);}
          for(const r of researchSnapshot.records)if(r.capture_id)captureIds.add(r.capture_id);
          const selectedCommercial:any=commercial.snapshot({item_ids:[...selected],record_ids:selection.commercial_record_ids??[],include_metrics:false});
          const selectedRecordIds=new Set(selectedCommercial.records.map((r:any)=>r.id));selectedCommercial.comparisons=commercial.comparisons().filter((q:any)=>q.record_ids.every((id:string)=>selectedRecordIds.has(id)));
          for(const r of selectedCommercial.records)if(r.kind==='comparison'){if(r.capture_a?.capture_id)captureIds.add(r.capture_a.capture_id);if(r.capture_b?.capture_id)captureIds.add(r.capture_b.capture_id);}
          const media=[...captureIds].map(id=>{const capture=review.getCapture(id);const original=review.getMedia(id);const display=review.getDisplayMedia(id);const digest=createHash('sha256').update(original.body).digest('hex');if(digest!==capture.capture_ref.content_sha256)fail(409,'Original media changed; export stopped.');return {id,title:capture.title,content_type:original.contentType,content_sha256:digest,original_base64:original.body.toString('base64'),display_content_type:display.contentType,display_base64:display.body.toString('base64'),display_sha256:display.display_sha256};});
          const workflowsSnapshot=workflows.snapshot({reconciliation_entry_ids:selection.reconciliation_entry_ids??[],draft_ids:selection.draft_ids??[]});
          for(const q of workflowsSnapshot.reconciliations)if(!q.element_ids.every((id:string)=>selected.has(`element:${id}`)))fail(400,'Selected reconciliation contains scope outside this packet.');
          for(const d of workflowsSnapshot.drafts)if(!d.evidence.every((e:any)=>selected.has(`element:${e.finding.model_ref.element_id}`)))fail(400,'Selected draft contains scope outside this packet.');
          const scopeSnapshot=scopes.snapshot();
          return {workspace:name,data_mode:name==='fixture'?'synthetic':'local',project:b.project,scope:{items:s.items.filter((i:any)=>selected.has(i.item_id)),item_revisions:scopeSnapshot.item_revisions.filter((i:any)=>selected.has(i.item_id)),finding_revisions:s.finding_revisions.filter((f:any)=>selected.has(f.item_id)),findings:s.findings.filter((f:any)=>selected.has(f.item_id)),mappings:scopeSnapshot.mappings.filter((m:any)=>[...m.source_item_ids,...m.target_item_ids].every((id:string)=>selected.has(id))),conflicts:scopeSnapshot.conflicts.filter((c:any)=>selected.has(c.item_id))},existing:{project:b.project,findings:b.findings.filter((f:any)=>selected.has(`element:${f.model_ref.element_id}`)),finding_revisions:revisions,captures:b.captures.filter((c:any)=>captureIds.has(c.capture_id)),tasks:b.tasks.filter((t:any)=>selected.has(`element:${t.element_id}`)),task_events:b.task_events.filter((t:any)=>selected.has(`element:${t.task.element_id}`)),reconciliations:workflowsSnapshot.reconciliations,drafts:workflowsSnapshot.drafts},workflows:workflowsSnapshot,field:fieldSnapshot,commercial:selectedCommercial,research:researchSnapshot,queue:combinedQueue({as_of_date:selection.as_of_date??new Date().toISOString().slice(0,10),freshness_days:selection.freshness_days??14}).exceptions.filter((r:any)=>selected.has(r.item_id)),media,limitations:['Manual evidence and authored quantities only.','No verified external submission, registration, inspection acceptance or AI accuracy.']};
        }});
        const combinedQueue=(filters:Record<string,any>={})=>{
          const scope=scopes.bootstrap(filters), f=field.bootstrap(), c=commercial.bootstrap(), r=research.bootstrap();
          const extra:any[]=[]; const asOf=scope.policy.as_of_date;
          for(const a of f.assignments) if(a.review_status!=='sufficient')extra.push({id:`field:${a.assignment_id}`,item_id:a.item_id,kind:a.status==='unable'?'unable_to_capture':a.supplied_evidence.length?'awaiting_reassessment':a.due_date<asOf?'overdue_assignment':'planned_evidence',reason:a.supplied_evidence.length?'Evidence supplied; explicit sufficiency/reassessment is still required.':`Required ${a.requirement_snapshot.viewpoint} · due ${a.due_date}`,next_action:a.supplied_evidence.length?'Review supplied evidence':'Open field assignment',owner:a.assignee,due_date:a.due_date,source_refs:[a.revision_id],destination:'assignments'});
          for(const q of c.comparisons)if(q.delta!==0&&(!filters.period_start||(q.period_start===filters.period_start&&q.period_end===filters.period_end)))for(const id of q.item_ids)extra.push({id:`quantity:${q.id}:${id}`,item_id:id,kind:q.delta===null?'quantity_basis_unresolved':'quantity_difference',reason:q.delta===null?q.reason:`Reported minus supported: ${q.delta} ${q.unit} (${q.period_start} to ${q.period_end}).`,next_action:'Reconcile source and measurement basis',source_refs:q.record_ids,destination:'quantities'});
          for(const d of c.followups)extra.push({id:`followup:${d.id}`,item_id:d.item_ids[0],kind:'local_followup',reason:'Local action awaits a verified destination and explicit submission.',next_action:'Review local draft and capability blocker',source_refs:[d.revision_id],destination:'drafts'});
          for(const follow of r.follow_ups??[])if(follow.needs_review||follow.tracking_status!=='closed')extra.push({id:`external-followup:${follow.action_id}`,item_id:follow.findings[0]?.item_id??(follow.findings[0]?.model_ref?.element_id?`element:${follow.findings[0].model_ref.element_id}`:null),kind:follow.needs_review?'action_correction_review':'unanswered_followup',reason:follow.needs_review?'A relied-on finding has a newer correction.':`Local follow-up ${follow.tracking_status}; external response/access unverified.`,next_action:'Inspect the preserved action and response history',owner:follow.owner,due_date:follow.due_date,source_refs:[follow.record_id],destination:'research'});
          for(const l of c.lookahead)for(const id of l.item_ids)extra.push({id:`lookahead:${l.id}:${id}`,item_id:id,kind:'lookahead_review',reason:`${l.title} needs ${l.stage} evidence before ${l.planned_start}; ${l.mapping_confirmed?'mapping manually confirmed':'scope mapping unresolved'}.`,next_action:'Check prerequisites and stage/billing basis',due_date:l.planned_start,source_refs:[l.revision_id],destination:'lookahead'});
          const extras=extra.filter(e=>{const i=scope.items.find((i:any)=>i.item_id===e.item_id);return i&&(!filters.trade||i.trade.toLowerCase().includes(String(filters.trade).toLowerCase()))&&(!filters.location||i.location.toLowerCase().includes(String(filters.location).toLowerCase()))&&(!filters.owner||String(e.owner??'').toLowerCase().includes(String(filters.owner).toLowerCase()))&&(!filters.due_before||(e.due_date&&e.due_date<=filters.due_before));});
          const exceptions=[...scope.queue.exceptions,...extras].map(e=>({...e,id:e.id??e.exception_id,exception_id:e.exception_id??e.id,category:e.category??e.kind,kind:e.kind??e.category}));return {...scope.queue,exceptions,count:exceptions.length};
        };
        operationStores.set(name,{scopes,field,research,commercial,base,extended,combinedQueue});
        workflowStores.set(name,workflows);reviewStores.set(name,review);
      } catch(error) {review.close();throw error;}
    }
    return {review:reviewStores.get(name)!,workflows:workflowStores.get(name)!,operations:operationStores.get(name)!};
  }
  const capabilities = [
    {name:'Evidence review',implemented:true,locally_tested:true,live_verified:false,status:'Local fixture workflow'},
    {name:'Manual plan placement',implemented:true,locally_tested:true,live_verified:false,status:'Manual association only'},
    {name:'Immutable evidence packets',implemented:true,locally_tested:true,live_verified:false,status:'HTML + JSON with source hashes'},
    {name:'APS OAuth and project reads',implemented:true,locally_tested:true,live_verified:false,status:'User sign-in and project access required'},
    {name:'APS model viewing and source import',implemented:false,locally_tested:false,live_verified:false,status:'Deferred; representative model required'},
    {name:'Local photograph import and element findings',implemented:true,locally_tested:true,live_verified:false,status:'Separate local originals; manually configured BIM references'},
    {name:'Recapture and progress reconciliation',implemented:true,locally_tested:true,live_verified:false,status:'Human findings, manual quantities, local drafts'},
    {name:'Live Issue publication',implemented:false,locally_tested:false,live_verified:false,status:'Disabled · preview/export only'},
  ];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const setCookie=(name:string,value:string,maxAge=43200)=>{
      const previous=res.getHeader('Set-Cookie');
      res.setHeader('Set-Cookie',[...(Array.isArray(previous)?previous:previous?[String(previous)]:[]),`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`]);
    };
    const send=(value:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try {
      const host=req.headers.host || '';
      if(publicDemo ? !deps.deployment!.allowedOrigins.includes(`https://${host.toLowerCase()}`) : !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) fail(403,publicDemo?'Invalid public demo host.':'Invalid local host.');
      const origin=`${publicDemo?'https':'http'}://${publicDemo?host.toLowerCase():host}`;
      if(req.headers.origin && req.headers.origin!==origin) fail(403,'Cross-origin requests are not allowed.');
      if(req.headers['sec-fetch-site']==='cross-site' && !req.url?.startsWith('/?')) fail(403,'Cross-site requests are not allowed.');
      const url=new URL(req.url || '/',origin), path=url.pathname;
      if(publicDemo && !['GET','HEAD'].includes(req.method || 'GET')) fail(405,'This public synthetic demo is read-only. Run the local application to import evidence, edit reviews or create packets.');
      if(publicDemo && (path.startsWith('/auth/') || path==='/api/aps/projects' || (path==='/' && ['code','state','error'].some(key=>url.searchParams.has(key))))) fail(403,'APS sign-in and external integrations are disabled in the public synthetic demo.');
      const jar=publicDemo?{}:cookies(req);
      let local=localSessions.get(jar.recap_local || '');
      if(local && local.expires<Date.now()) { localSessions.delete(jar.recap_local); local=undefined; }
      const requireSession=()=>{if(!publicDemo && !local) fail(401,'Open Forma ReCap to start a local review session.');};
      if(!['GET','HEAD'].includes(req.method || 'GET')) {
        requireSession();
        if(!equal(String(req.headers['x-csrf-token'] || ''),local!.csrf)) fail(403,'Invalid request token. Reload the app and retry.');
      }
      if(path==='/' && (url.searchParams.has('code') || url.searchParams.has('state') || url.searchParams.has('error'))) {
        setCookie('aps_oauth_state','',0);
        if(url.searchParams.has('error')) fail(401,'Autodesk sign-in was declined or failed. Return to the app to retry.');
        const session=await aps.callback(url.searchParams.get('code') || '',url.searchParams.get('state') || '',jar.aps_oauth_state || '');
        if(jar.aps_session) aps.logout(jar.aps_session);
        setCookie('aps_session',session.sessionId);
        res.writeHead(303,{Location:'/'});res.end();return;
      }
      if(path==='/api/bootstrap' && req.method==='GET') {
        if(!publicDemo && !local) { const id=token();local={csrf:token(),expires:Date.now()+12*3600000};localSessions.set(id,local);setCookie('recap_local',id); }
        const original=config.mode==='fixture'?store.bootstrap():{mode:'live',project:null,model:null,scope:null,plan:null,captures:[],assessments:[],exports:[]};
        const base={...original,captures:original.captures.map((capture:any)=>({...capture,display_url:`/api/media/${encodeURIComponent(capture.capture_id)}/display`})),plan:original.plan?{...original.plan,display_url:`/api/media/${encodeURIComponent(original.plan.file_id)}/display`}:null};
        send({...base,mode:config.mode,csrfToken:publicDemo?'':local!.csrf,user:{id:config.mode==='fixture'?'fixture-reviewer':'local-session',name:config.mode==='fixture'?'Local demo reviewer':'Local APS session'},capabilities,...(deployment?{deployment}:{})});return;
      }
      if(path==='/api/integration/status' && req.method==='GET') {requireSession();send({...aps.status(jar.aps_session),...(publicDemo?{read_only:true,message:'Public synthetic demo. APS sign-in, private photograph workspaces and external operations are disabled. Use the local application for editable review.'}:{})});return;}
      if(path==='/auth/login' && req.method==='GET') {
        requireSession();const result=await aps.login();setCookie('aps_oauth_state',result.state,600);
        res.writeHead(302,{Location:result.url});res.end();return;
      }
      if(path==='/auth/logout' && req.method==='POST') {aps.logout(jar.aps_session);setCookie('aps_session','',0);send({ok:true});return;}
      if(path==='/api/aps/projects' && req.method==='GET') {requireSession();const result=await aps.projects(jar.aps_session);send({projects:result.data});return;}
      const v3=path.match(/^\/api\/v3\/([^/]+)\/(.+)$/);
      if(v3) {
        requireSession(); const {review,operations}=workspace(v3[1]); const {scopes,field,research,commercial,base,combinedQueue}=operations; const route=v3[2];
        const filters=Object.fromEntries([...url.searchParams].map(([k,v])=>[k,k==='freshness_days'?Number(v):v]));
        if(route==='bootstrap'&&req.method==='GET') {
          const scope=scopes.bootstrap(filters), f=field.bootstrap(), c=commercial.bootstrap(), r=research.bootstrap();
          send({schema_version:'0.3.0',workspace:v3[1],scope,field:f,commercial:c,research:r,existing:base(),queue:combinedQueue(filters),...(deployment?{deployment}:{})});return;
        }
        if(route==='configure'&&req.method==='POST'){send(review.configure(await body(req)),201);return;}
        if(route==='scope/bootstrap'&&req.method==='GET'){send(scopes.bootstrap(filters));return;}
        const dossier=route.match(/^dossier\/(.+)$/);if(dossier&&req.method==='GET'){const id=decodeURIComponent(dossier[1]);const d=scopes.dossier(id);send({...d,field:field.bootstrap().assignments.filter((a:any)=>a.item_id===id),commercial:commercial.bootstrap().records.filter((r:any)=>r.item_ids?.includes(id)),asset_proposals:research.bootstrap().asset_proposals.filter((a:any)=>a.item_id===id)});return;}
        const packet=route.match(/^packets\/([^/]+)\/(manifest|report)$/);if(packet&&req.method==='GET'){const p=commercial.getPacket(packet[1]);res.setHeader('Content-Disposition',`${url.searchParams.get('inline')==='1'?'inline':'attachment'}; filename="forma-recap-${packet[1]}.${packet[2]==='manifest'?'json':'html'}"`);if(packet[2]==='manifest')send(p.manifest);else{res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(p.html);}return;}
        const getRoutes:Record<string,()=>any>={'field/bootstrap':field.bootstrap,'field/readiness':field.readiness,'research/bootstrap':research.bootstrap,'commercial/bootstrap':commercial.bootstrap};
        if(req.method==='GET'&&getRoutes[route]){send(getRoutes[route]());return;}
        const postRoutes:Record<string,(input:any)=>any>={'scope/items':scopes.saveItem,'scope/findings':scopes.saveFinding,'scope/mappings':scopes.saveMapping,'scope/conflicts':scopes.saveConflict,'field/requirements':field.saveRequirement,'field/assignments':field.saveAssignment,'field/events':field.recordEvent,'field/capture':field.receiveCapture,'field/release':field.saveRelease,'research/capability':research.saveCapability,'research/asset-proposal':research.saveAssetProposal,'research/experiment':research.saveExperiment,'research/case':research.saveCase,'research/proposal':research.saveProposal,'research/decision':research.saveDecision,'research/evaluate':research.evaluate,'research/follow-up':research.saveFollowUp,'commercial/metric':commercial.metric,'packets':commercial.createPacket};
        const commercialKind=route.match(/^commercial\/(template|quantity|lookahead|handover|comparison|followup|rollout)$/);
        if(req.method==='POST'&&commercialKind){send(commercial.save(commercialKind[1],await body(req)),201);return;}
        if(req.method==='POST'&&postRoutes[route]){send(await postRoutes[route](await body(req,route==='field/capture'?22*1024*1024:65536)),201);return;}
        fail(404,'Project operation unavailable. External submission remains disabled.');
      }
      const v2=path.match(/^\/api\/v2\/([^/]+)\/(.+)$/);
      if(v2) {
        requireSession();
        const {review,workflows}=workspace(v2[1]);
        const route=v2[2]; let match:RegExpMatchArray|null;
        if(route==='bootstrap' && req.method==='GET') {send({...review.bootstrap(),...workflows.bootstrap(),coverage:review.coverage({}),...(deployment?{deployment}:{})});return;}
        if(route==='configure' && req.method==='POST') {send(review.configure(await body(req)),201);return;}
        if(route==='findings' && req.method==='POST') {send(review.saveFinding(await body(req)),201);return;}
        if((match=route.match(/^findings\/([^/]+)\/history$/)) && req.method==='GET') {send(review.findingHistory(decodeURIComponent(match[1])));return;}
        if(route==='tasks' && req.method==='POST') {send(review.saveTask(await body(req)),201);return;}
        if(route==='tasks/evidence' && req.method==='POST') {send(review.linkTaskEvidence(await body(req)),201);return;}
        if(route==='coverage' && req.method==='GET') {
          send(review.coverage({...(url.searchParams.has('as_of_date')?{as_of_date:url.searchParams.get('as_of_date')}:{}),...(url.searchParams.has('freshness_days')?{freshness_days:Number(url.searchParams.get('freshness_days'))}:{})}));return;
        }
        if(route==='photos' && req.method==='POST') {send(await review.importPhoto(await body(req,22*1024*1024)),201);return;}
        if(route==='demo-source' && req.method==='GET') {
          if(v2[1]!=='fixture') fail(404,'Synthetic test sources belong only to the synthetic workspace.');
          res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="synthetic-recapture.png"'});res.end(readFileSync(resolve(ROOT,'server/media/synthetic-recapture.png')));return;
        }
        if((match=route.match(/^media\/([^/]+)\/display$/)) && req.method==='GET') {
          const media=review.getDisplayMedia(decodeURIComponent(match[1]));res.writeHead(200,{'Content-Type':media.contentType,'X-Source-SHA256':media.source_sha256,'X-Display-SHA256':media.display_sha256});res.end(media.body);return;
        }
        if((match=route.match(/^media\/([^/]+)$/)) && req.method==='GET') {
          const media=review.getMedia(decodeURIComponent(match[1]));res.writeHead(200,{'Content-Type':media.contentType});res.end(media.body);return;
        }
        if(route==='reconciliation' && req.method==='GET') {send(workflows.bootstrap({...(url.searchParams.has('period_start')?{period_start:url.searchParams.get('period_start')}:{}),...(url.searchParams.has('period_end')?{period_end:url.searchParams.get('period_end')}:{})}));return;}
        if(route==='reconciliation' && req.method==='POST') {send(workflows.saveReconciliation(await body(req)),201);return;}
        if(route==='drafts' && req.method==='POST') {send(workflows.saveDraft(await body(req)),201);return;}
        if((match=route.match(/^drafts\/([^/]+)\/history$/)) && req.method==='GET') {send(workflows.draftHistory(decodeURIComponent(match[1])));return;}
        if(route==='exports' && req.method==='POST') {
          const input=await body(req);
          if(Object.keys(input).some(key=>!['reconciliation_entry_ids','draft_ids','coverage_rule'].includes(key))) fail(400,'Unsupported packet selection.');
          const selection={...(Object.hasOwn(input,'reconciliation_entry_ids')?{reconciliation_entry_ids:input.reconciliation_entry_ids}:{}),...(Object.hasOwn(input,'draft_ids')?{draft_ids:input.draft_ids}:{})};
          send(review.createExport(workflows.snapshot(selection),Object.hasOwn(input,'coverage_rule')?{coverage_rule:input.coverage_rule}:{}),201);return;
        }
        if((match=route.match(/^exports\/([^/]+)\/(manifest|report)$/)) && req.method==='GET') {
          const packet=review.getExport(decodeURIComponent(match[1]));
          const disposition=match[2]==='report' && url.searchParams.get('inline')==='1'?'inline':'attachment';
          res.setHeader('Content-Disposition',`${disposition}; filename="forma-recap-${v2[1]}-${match[1]}.${match[2]==='manifest'?'json':'html'}"`);
          if(match[2]==='manifest') send(packet.manifest);
          else {res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(packet.html);}return;
        }
        fail(404,'Review operation not found. External submission is disabled.');
      }
      if(path.startsWith('/api/')) {
        requireSession();
        if(config.mode!=='fixture') fail(409,'Live evidence import and review are not enabled. Use APS connection for read-only project discovery.');
        let m:RegExpMatchArray|null;
        if((m=path.match(/^\/api\/media\/([^/]+)\/display$/)) && req.method==='GET') {
          const id=decodeURIComponent(m[1]);const original=store.getMedia(id);const media=displayMedia({id,...original});
          res.writeHead(200,{'Content-Type':media.contentType,'X-Source-SHA256':media.source_sha256,'X-Display-SHA256':media.display_sha256});res.end(media.body);return;
        }
        if((m=path.match(/^\/api\/media\/([^/]+)$/)) && req.method==='GET') {
          const media=store.getMedia(decodeURIComponent(m[1]));res.writeHead(200,{'Content-Type':media.contentType});res.end(media.body);return;
        }
        if(path==='/api/assessments' && req.method==='POST') {send(store.saveAssessment(await body(req)),201);return;}
        if((m=path.match(/^\/api\/assessments\/([^/]+)\/history$/)) && req.method==='GET') {send(store.history(decodeURIComponent(m[1])));return;}
        if((m=path.match(/^\/api\/captures\/([^/]+)\/placement$/)) && req.method==='PUT') {send(store.placeCapture(decodeURIComponent(m[1]),await body(req)));return;}
        if(path==='/api/exports' && req.method==='POST') {const input=await body(req);if(Object.keys(input).length)fail(400,'Export uses the current reviewed snapshot.');send(store.createExport(),201);return;}
        if((m=path.match(/^\/api\/exports\/([^/]+)\/(manifest|report)$/)) && req.method==='GET') {
          const packet=store.getExport(decodeURIComponent(m[1]));
          res.setHeader('Content-Disposition',`attachment; filename="forma-recap-${m[1]}.${m[2]==='manifest'?'json':'html'}"`);
          if(m[2]==='manifest') send(packet.manifest);
          else {res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(packet.html);}return;
        }
        fail(404,'Resource not found.');
      }
      if(!['GET','HEAD'].includes(req.method || '')) fail(405,'Method not allowed.');
      const dist=resolve(ROOT,'dist');
      const requested=resolve(dist,'.'+decodeURIComponent(path));
      if(!requested.startsWith(dist+'/') && requested!==dist) fail(404,'Resource not found.');
      const target=path==='/'?resolve(dist,'index.html'):requested;
      if(!existsSync(target) || !extname(target)) fail(404,'Resource not found. Build the app with npm run build.');
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
      res.writeHead(200,{'Content-Type':mime[extname(target)] || 'application/octet-stream'});
      res.end(req.method==='HEAD'?undefined:readFileSync(target));
    } catch(error) {
      const e=error as Error & {status?:number};
      const status=Number.isInteger(e.status)?e.status!:500;
      const safeError=status<500 || ['ApsError','DomainError'].includes(e.name);
      send({error:safeError?e.message:'The operation could not be completed. Check local server configuration.'},status);
      if(status>=500) console.error('Request failed:',e.name);
    }
  });
  let closed=false;
  return {server,store,aps,close:()=>{if(closed)return;closed=true;server.close();for(const review of reviewStores.values())review.close();store.close();localSessions.clear();}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const envFile=resolve(ROOT,'.env'); if(existsSync(envFile)) process.loadEnvFile(envFile);
  const config=loadConfig();const app=createApp(config);
  app.server.listen(config.port,'127.0.0.1',()=>console.log(`Forma ReCap · ${config.mode} mode · http://localhost:${config.port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{app.close();process.exit(0);});
}
