import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createApp, loadConfig } from '../server/index.ts';
import { createPublicDemoHandler, publicDemoOrigins } from '../server/vercel-demo.ts';
const host='forma-recap.vercel.app';
type Result={status:number;headers:IncomingHttpHeaders;body:Buffer;json:()=>any};
async function serving(t:{after:(callback:()=>Promise<void>)=>void}) {
  const directory=mkdtempSync(join(tmpdir(),'forma-recap-vercel-'));
  const handler=createPublicDemoHandler({dataDir:join(directory,'isolated-demo'),env:{APS_CLIENT_ID:'must-not-be-used',APS_CLIENT_SECRET:'must-not-be-used',APP_MODE:'live'}});
  const server=http.createServer((req,res)=>void handler(req,res));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address&&typeof address!=='string');
  t.after(async()=>{await new Promise<void>((done,reject)=>server.close(error=>error?reject(error):done()));await handler.close();rmSync(directory,{recursive:true,force:true});});
  const request=(path:string,options:{method?:string;headers?:Record<string,string>;body?:string}={}):Promise<Result>=>new Promise((accept,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:address.port,path,method:options.method||'GET',headers:{Host:host,...options.headers}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>{const body=Buffer.concat(chunks);accept({status:res.statusCode||0,headers:res.headers,body,json:()=>JSON.parse(body.toString())});});
    });req.on('error',reject);req.end(options.body);
  });
  return {request,directory};
}

test('public demo host origins are exact and platform aliases cannot come from arbitrary environment or request headers',()=>{
  assert.deepEqual(publicDemoOrigins({VERCEL_URL:'attacker.example'}),['https://forma-recap.vercel.app']);
  assert.deepEqual(publicDemoOrigins({VERCEL:'1',VERCEL_URL:'forma-recap-preview-team.vercel.app',VERCEL_PROJECT_PRODUCTION_URL:'forma-recap.vercel.app'}),['https://forma-recap.vercel.app','https://forma-recap-preview-team.vercel.app']);
  for(const value of ['https://evil.vercel.app','evil.example','evil.vercel.app/path','evil.vercel.app:443','evil.vercel.app@attacker.example'])assert.deepEqual(publicDemoOrigins({VERCEL:'1',VERCEL_URL:value}),['https://forma-recap.vercel.app']);
});

test('anonymous cloud reads preserve fixed synthetic records, media, packets and deployment labels without sessions',async t=>{
  const {request,directory}=await serving(t);
  const base=await request('/api/bootstrap');assert.equal(base.status,200);assert.equal(base.headers['set-cookie'],undefined);
  assert.deepEqual(base.json().deployment,{kind:'public_demo',read_only:true,label:'Public synthetic demo',persistence:'fixed_snapshot'});assert.equal(base.json().csrfToken,'');assert.equal(base.json().assessments.length,2);
  const [result,second]=await Promise.all([request('/api/v2/fixture/bootstrap'),request('/api/v2/fixture/bootstrap')]);
  assert.equal(result.status,200);assert.equal(second.status,200);const data=result.json();assert.deepEqual(data,second.json());assert.equal(data.finding_revisions.length,4);assert.equal(data.tasks.length,1);assert.equal(data.drafts[0].revision,2);assert.equal(data.deployment.read_only,true);assert.equal(data.workspace,'fixture');
  const history=await request(`/api/v2/fixture/findings/${data.findings[0].finding_id}/history`);assert.equal(history.status,200);assert.ok(history.json().length);
  const media=await request(data.captures[0].display_url);assert.equal(media.status,200);assert.equal(media.headers['content-type'],'image/png');assert.equal(media.body.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(media.headers['x-source-sha256']);
  const original=await request(data.captures[0].media_url);assert.equal(original.headers['content-type'],'image/svg+xml');assert.notDeepEqual(original.body,media.body);
  for(const packet of data.exports){const report=await request(`${packet.html_url}?inline=1`);assert.equal(report.status,200);assert.match(report.body.toString(),/Synthetic demonstration evidence only/);assert.match(String(report.headers['content-disposition']),/^inline/);const manifest=await request(packet.manifest_url);assert.equal(manifest.status,200);assert.equal(manifest.json().id,packet.id);}
  const legacyPacket=await request(base.json().exports[0].manifest_url);assert.equal(legacyPacket.status,200);assert.equal(legacyPacket.json().data_mode,'fixture');
  const integration=await request('/api/integration/status');assert.equal(integration.status,200);assert.equal(integration.json().configured,false);assert.equal(integration.json().authenticated,false);assert.equal(integration.json().read_only,true);
  assert.equal(readdirSync(resolve(directory,'isolated-demo')).some(file=>file.startsWith('local')),false);
});

test('public demo rejects edits before reading bodies, private/local workspaces and all APS entry points',async t=>{
  const {request}=await serving(t);
  for(const path of ['/api/assessments','/api/exports','/api/v2/fixture/findings','/api/v2/fixture/photos','/api/v2/fixture/exports','/api/v2/local/configure','/auth/logout']){
    const result=await request(path,{method:'POST',body:'not JSON',headers:{'Content-Type':'application/json'}});assert.equal(result.status,405);assert.match(result.json().error,/read-only/);assert.equal(result.headers['set-cookie'],undefined);
  }
  const local=await request('/api/v2/local/bootstrap');assert.equal(local.status,409);assert.match(local.json().error,/private project workspaces/);
  for(const path of ['/auth/login','/api/aps/projects','/?code=untrusted&state=untrusted']){const result=await request(path);assert.equal(result.status,403);assert.match(result.json().error,/disabled/);}
  const after=await request('/api/v2/fixture/bootstrap');assert.equal(after.json().finding_revisions.length,4);assert.equal(after.json().exports.length,2);
});

test('public demo rejects foreign hosts, HTTP origins, cross-site requests and conflicting rewrite routing',async t=>{
  const {request}=await serving(t);
  for(const headers of [{Host:'attacker.example'},{Host:'localhost:8080'},{Origin:'http://forma-recap.vercel.app'},{Origin:'https://attacker.example'},{'Sec-Fetch-Site':'cross-site'},{Host:'attacker.example','X-Forwarded-Host':host}] as Record<string,string>[])assert.equal((await request('/api/bootstrap',{headers})).status,403);
  assert.equal((await request('/api/bootstrap',{headers:{Origin:'https://forma-recap.vercel.app'}})).status,200);
  const rewritten=await request('/api/index?__forma_route=/api/v2/fixture/coverage&as_of_date=2026-10-19&freshness_days=7');assert.equal(rewritten.status,200);assert.equal(rewritten.json().freshness_days,7);assert.equal(rewritten.json().as_of_date,'2026-10-19');
  assert.equal((await request('/api/bootstrap?__forma_route=/api/bootstrap')).status,200,'A preserved original pathname may carry its matching rewrite marker.');
  for(const path of ['/api/bootstrap?__forma_route=/api/v2/fixture/bootstrap','/api/index?__forma_route=/api/bootstrap&__forma_route=/api/exports','/api/index?__forma_route=//attacker.example/api/bootstrap','/api/index?__forma_route=/api/../bootstrap'])assert.equal((await request(path)).status,400);
  assert.equal((await request('/api/index?__forma_route=/auth/login')).status,403);
});

test('separate public function instances expose identical saved snapshots without cookie affinity',async t=>{
  const first=await serving(t);const second=await serving(t);
  const a=await first.request('/api/v2/fixture/bootstrap');const b=await second.request('/api/v2/fixture/bootstrap');
  assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.json(),b.json());assert.equal(a.headers['set-cookie'],undefined);assert.equal(b.headers['set-cookie'],undefined);
  const packet=a.json().exports[0];assert.equal((await first.request(packet.html_url)).body.toString(),(await second.request(packet.html_url)).body.toString());
});

test('public deployment cannot accidentally receive APS credentials or live mode',()=>{
  const deployment={kind:'public_demo',read_only:true,label:'Public synthetic demo',persistence:'fixed_snapshot',allowedOrigins:['https://forma-recap.vercel.app']} as const;
  for(const env of [{APP_MODE:'live'},{APS_CLIENT_ID:'credential'},{APS_CLIENT_SECRET:'credential'},{APS_HUB_ID:'real-hub'}])assert.throws(()=>createApp(loadConfig(env),{deployment:{...deployment,allowedOrigins:[...deployment.allowedOrigins]}}),/cannot use live mode or APS/);
});
