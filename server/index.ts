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
  function workspace(name:string) {
    if(config.mode!=='fixture') fail(409,'Local review is unavailable in live mode. Verified project/model access is required before live review.');
    if(publicDemo && name==='local') fail(409,'Local photographs and private project workspaces are available only in the local application. This public deployment contains fixed synthetic evidence.');
    if(!['fixture','local'].includes(name)) fail(404,'Review workspace not found.');
    if(!reviewStores.has(name)) {
      const review=createReviewStore({dbPath:resolve(config.dataDir,`${name}-review.sqlite`),uploadDir:resolve(config.dataDir,`${name}-originals`),workspace:name as 'fixture'|'local',legacyStore:store,...(name==='fixture'?{syntheticImportPath:resolve(ROOT,'server/media/synthetic-recapture.png')}:{})});
      try {
        const workflows=createWorkflows({db:review.db,context:()=>review.bootstrap(),getFindingRevision:(id:string)=>review.getFindingRevision(id),getCapture:(id:string)=>review.getCapture(id)});
        workflowStores.set(name,workflows);reviewStores.set(name,review);
      } catch(error) {review.close();throw error;}
    }
    return {review:reviewStores.get(name)!,workflows:workflowStores.get(name)!};
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
