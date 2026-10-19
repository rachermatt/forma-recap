import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import http from 'node:http';
import { createApp, loadConfig } from '../server/index.ts';

async function start(mode:'fixture'|'live'='fixture') {
  const dataDir=mkdtempSync(resolve(tmpdir(),'forma-recap-http-'));
  const app=createApp(loadConfig({APP_MODE:mode,PORT:'0',DATA_DIR:dataDir}));
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  const address=app.server.address() as {port:number};
  const origin=`http://127.0.0.1:${address.port}`;
  const close=async()=>{await new Promise<void>(r=>app.server.close(()=>r()));app.store.close();rmSync(dataDir,{recursive:true,force:true});};
  return {origin,close};
}
async function session(origin:string) {
  const response=await fetch(origin+'/api/bootstrap');
  const cookie=response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  return {cookie,data:await response.json() as any};
}
test('HTTP journey protects evidence and saves reproducible reviews across sessions',async()=>{
  const app=await start();
  try {
    assert.equal((await fetch(app.origin+'/api/media/fixture-capture-01')).status,401);
    const {cookie,data}=await session(app.origin);
    assert.equal(data.mode,'fixture');assert.equal(data.captures.length,2);
    const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':data.csrfToken,Origin:app.origin};
    const assessmentBody={capture_id:data.captures[0].capture_id,state:'not_observed',rationale:'Selected duct is occluded in synthetic illustration.',uncertainty_reason:'Occluded',element_ids:[data.scope.element_ids[0]],previous_revision_id:null};
    const save=await fetch(app.origin+'/api/assessments',{method:'POST',headers,body:JSON.stringify(assessmentBody)});
    assert.equal(save.status,201);const first=await save.json() as any;
    assert.equal(first.state,'not_observed');assert.equal(first.capture_ref.captured_at,null);
    const packetResponse=await fetch(app.origin+'/api/exports',{method:'POST',headers,body:'{}'});
    assert.equal(packetResponse.status,201);const packet=await packetResponse.json() as any;
    const manifest=await fetch(app.origin+packet.manifest_url,{headers:{Cookie:cookie}}).then(r=>r.json());
    const second=await fetch(app.origin+'/api/assessments',{method:'POST',headers,body:JSON.stringify({...assessmentBody,state:'needs_review',rationale:'Correction: image lacks sufficient detail.',previous_revision_id:first.review.revision_id})});
    assert.equal(second.status,201);
    const sameManifest=await fetch(app.origin+packet.manifest_url,{headers:{Cookie:cookie}}).then(r=>r.json());
    assert.deepEqual(sameManifest,manifest);
    const again=await session(app.origin);assert.equal(again.data.assessments[0].review.revision,2);
    const history=await fetch(app.origin+`/api/assessments/${first.assessment_id}/history`,{headers:{Cookie:cookie}}).then(r=>r.json()) as any[];
    assert.equal(history.length,2);
    const report=await fetch(app.origin+packet.html_url,{headers:{Cookie:cookie}}).then(r=>r.text());
    assert.match(report,/Synthetic/i);assert.match(report,/data:image\/png;base64,/);
    assert.equal((await fetch(app.origin+'/api/media/fixture-other-project',{headers:{Cookie:cookie}})).status,404);
    assert.equal((await fetch(app.origin+'/api/exports/other-project/manifest',{headers:{Cookie:cookie}})).status,404);
  } finally {await app.close();}
});
test('HTTP rejects cross-origin, bad host, forged CSRF, malformed bodies, and live writes',async()=>{
  const app=await start();
  try {
    assert.equal((await fetch(app.origin+'/api/bootstrap',{headers:{Origin:'https://evil.example'}})).status,403);
    const hostStatus=await new Promise<number>((resolve,reject)=>{const request=http.get(app.origin+'/api/bootstrap',{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);});
    assert.equal(hostStatus,403);
    const {cookie,data}=await session(app.origin);
    assert.equal((await fetch(app.origin+'/api/exports',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':data.csrfToken};
    assert.equal((await fetch(app.origin+'/api/exports',{method:'POST',headers,body:'null'})).status,400);
    assert.equal((await fetch(app.origin+'/api/issues',{method:'POST',headers,body:'{}'})).status,404);
    assert.equal((await fetch(app.origin+'/auth/login',{headers:{Cookie:cookie}})).status,409);
    assert.equal((await fetch(app.origin+'/api/aps/projects',{headers:{Cookie:cookie}})).status,409);
  } finally {await app.close();}
});
test('live mode exposes no synthetic evidence or fallback',async()=>{
  const app=await start('live');
  try {
    const {cookie,data}=await session(app.origin);
    assert.equal(data.project,null);assert.deepEqual(data.captures,[]);
    assert.equal((await fetch(app.origin+'/api/media/fixture-capture-01',{headers:{Cookie:cookie}})).status,409);
    const status=await fetch(app.origin+'/api/integration/status',{headers:{Cookie:cookie}}).then(r=>r.json()) as any;
    assert.equal(status.authenticated,false);assert.equal(status.configured,false);
  } finally {await app.close();}
});
test('unknown modes fail before listening',()=>{assert.throws(()=>loadConfig({APP_MODE:'demo'}),/fixture or live/);});
test('OAuth callback clears the one-use state cookie on consent denial and invalid callback',async()=>{
  const app=await start('live');
  try {
    for(const query of ['error=access_denied&state=ignored','code=invalid&state=invalid']) {
      const response=await fetch(`${app.origin}/?${query}`,{headers:{Cookie:'aps_oauth_state=old-state'},redirect:'manual'});
      assert.ok(response.status>=400);
      assert.ok(response.headers.getSetCookie().some(value=>value.startsWith('aps_oauth_state=;') && value.includes('Max-Age=0')));
      assert.equal(response.headers.getSetCookie().some(value=>value.startsWith('aps_session=')),false);
    }
  } finally {await app.close();}
});
