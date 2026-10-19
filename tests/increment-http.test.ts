import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createApp,loadConfig} from '../server/index.ts';

async function start(mode:'fixture'|'live'='fixture') {
  const dataDir=mkdtempSync(resolve(tmpdir(),'forma-recap-v2-http-'));
  const app=createApp(loadConfig({APP_MODE:mode,PORT:'0',DATA_DIR:dataDir}));
  await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
  const bootstrap=await fetch(origin+'/api/bootstrap');
  const cookie=bootstrap.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const session=await bootstrap.json() as any;
  const headers={Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':session.csrfToken};
  async function call(path:string,input?:unknown) {
    const response=await fetch(origin+path,{headers,method:input===undefined?'GET':'POST',...(input===undefined?{}:{body:JSON.stringify(input)})});
    const value=await response.json() as any;
    assert.ok(response.ok,`${path} ${response.status}: ${JSON.stringify(value)}`);
    return value;
  }
  return {origin,headers,call,close:async()=>{app.close();await new Promise<void>(done=>app.server.listening?app.server.close(()=>done()):done());rmSync(dataDir,{recursive:true,force:true});}};
}
const finding=(capture_id:string,element_id:string,state:string)=>({capture_id,element_id,state,rationale:'Human assessment of the selected evidence region.',uncertainty_reason:state==='observed_installed'?null:'The connection is obscured by overhead services.',evidence_quality:state==='observed_installed'?'usable':'limited',annotations:[{x:0.15,y:0.2,width:0.3,height:0.25,label:'Selected connection'}],previous_revision_id:null});

test('complete same-project workflow imports synthetic recapture, links human reassessment and freezes selected history consistently',async()=>{
  const app=await start();
  try {
    const initial=await app.call('/api/v2/fixture/bootstrap');
    const legacyDisplay=await fetch(app.origin+'/api/media/fixture-capture-01/display',{headers:app.headers});
    assert.equal(legacyDisplay.headers.get('content-type'),'image/png');
    const source=await fetch(app.origin+'/api/v2/fixture/media/fixture-capture-01',{headers:app.headers}).then(r=>r.arrayBuffer());
    assert.equal(legacyDisplay.headers.get('x-source-sha256'),createHash('sha256').update(Buffer.from(source)).digest('hex'));
    const visible=await app.call('/api/v2/fixture/findings',finding('fixture-capture-01','DUCT-01','observed_installed'));
    const gap=await app.call('/api/v2/fixture/findings',finding('fixture-capture-01','DUCT-03','needs_review'));
    const task=await app.call('/api/v2/fixture/tasks',{finding_revision_id:gap.revision_id,reason:'Obscured coupling',required_viewpoint:'Close-up of terminal before ceiling closure',assignee:'Mechanical supervisor (synthetic)',due_date:'2026-10-20',before_concealment:true,concealment_date:'2026-10-21'});
    const bytes=readFileSync(resolve('server/media/synthetic-recapture.png'));
    const imported=await app.call('/api/v2/fixture/photos',{filename:'synthetic-recapture.png',content_type:'image/png',bytes_base64:bytes.toString('base64'),title:'Terminal follow-up illustration',source:'Clearly labeled test imagery',location:'Level 02 East',date_precision:'timestamp',captured_at:'2026-10-18T09:30:00-04:00',captured_date:'2026-10-18',original_timezone:'America/New_York'});
    assert.equal(imported.source_kind,'synthetic_test');assert.equal(imported.capture_ref.captured_at,'2026-10-18T09:30:00-04:00');assert.notEqual(imported.capture_ref.uploaded_at,imported.capture_ref.captured_at);
    await app.call('/api/v2/fixture/tasks/evidence',{task_id:task.task_id,capture_id:imported.capture_id});
    let state=await app.call('/api/v2/fixture/bootstrap');
    assert.equal(state.tasks[0].capture_status,'completed');assert.equal(state.tasks[0].review_status,'awaiting_reassessment');assert.equal(state.findings.length,2,'Evidence delivery creates no assessment');
    const followup=await app.call('/api/v2/fixture/findings',{...finding(imported.capture_id,'DUCT-03','observed_installed'),recapture_task_id:task.task_id,resolves_task_id:task.task_id});
    assert.equal(followup.recapture_task_ref.originating_finding_revision_id,gap.revision_id);assert.deepEqual(followup.recapture_task_ref.source_capture_ref,gap.capture_ref);
    state=await app.call('/api/v2/fixture/bootstrap');assert.equal(state.tasks[0].review_status,'reassessed');assert.equal(state.findings.filter((f:any)=>f.model_ref.element_id==='DUCT-02').length,0);
    const base={period_start:'2026-10-01',period_end:'2026-10-19',element_ids:['DUCT-01'],quantity:12,unit:'m',source:'Synthetic source sheet',basis:'Authored manual test value, not measured from pixels',measurement_method:'manual_measurement',comparison_key:'synthetic-length-v1'};
    const reported=await app.call('/api/v2/fixture/reconciliation',{...base,category:'trade_reported'});
    const supported=await app.call('/api/v2/fixture/reconciliation',{...base,category:'imagery_supported',quantity:9});
    const unresolved=await app.call('/api/v2/fixture/reconciliation',{...base,category:'unresolved',element_ids:['DUCT-02'],quantity:null});
    const draft=await app.call('/api/v2/fixture/drafts',{type:'rfi',title:'Confirm terminal detail',description:'Human reviewed selected evidence; acceptance remains unknown.',location:'Level 02 East',requested_action:'Confirm clearance and inspection requirement',proposed_assignee:'Design coordinator (synthetic)',finding_revision_ids:[gap.revision_id,followup.revision_id]});
    const packet=await app.call('/api/v2/fixture/exports',{reconciliation_entry_ids:[reported.entry_id,supported.entry_id,unresolved.entry_id],draft_ids:[draft.draft_id],coverage_rule:{as_of_date:'2026-10-19',freshness_days:7}});
    const frozen=await app.call(packet.manifest_url);
    const download=await fetch(app.origin+packet.html_url,{headers:app.headers});
    assert.match(download.headers.get('content-disposition')!,/^attachment;/);
    const html=await download.text();
    const inline=await fetch(app.origin+packet.html_url+'?inline=1',{headers:app.headers});
    assert.match(inline.headers.get('content-disposition')!,/^inline;/);
    assert.match(inline.headers.get('content-security-policy')!,/sandbox/);
    assert.equal(await inline.text(),html,'Inline preview must use the identical frozen report');
    assert.equal((await fetch(app.origin+packet.html_url+'?inline=1')).status,401);
    const encoded=Array.from(html.matchAll(/<pre>([\s\S]*?)<\/pre>/g)).at(-1)![1];
    const entities:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"};
    assert.deepEqual(JSON.parse(encoded.replace(/&(?:amp|lt|gt|quot|#39);/g,s=>entities[s])),frozen,'HTML and external manifest must describe the same exact saved snapshot');
    assert.equal(frozen.snapshot.coverage.freshness_days,7);assert.equal(frozen.snapshot.workflows.reconciliation_summary.comparisons[0].delta,3);assert.equal(frozen.snapshot.finding_revisions.length,3);
    assert.equal(frozen.snapshot.media[0].content_type,'image/svg+xml');assert.equal(frozen.snapshot.display_media[0].content_type,'image/png');
    await app.call('/api/v2/fixture/findings',{...finding('fixture-capture-01','DUCT-01','observed_installed'),previous_revision_id:visible.revision_id,rationale:'Later clarification after the packet was frozen.'});
    assert.deepEqual(await app.call(packet.manifest_url),frozen);assert.equal(await fetch(app.origin+packet.html_url,{headers:app.headers}).then(r=>r.text()),html);
    assert.deepEqual((await app.call('/api/v2/fixture/bootstrap')).legacy_assessments,initial.legacy_assessments);
    assert.equal((await fetch(app.origin+'/api/v2/local/media/'+imported.capture_id,{headers:app.headers})).status,404);
    assert.equal((await fetch(app.origin+'/api/v2/fixture/exports',{headers:app.headers,method:'POST',body:JSON.stringify({draft_ids:['foreign-draft']})})).status,404);
    const empty=await app.call('/api/v2/fixture/exports',{reconciliation_entry_ids:[],draft_ids:[]});
    assert.deepEqual((await app.call(empty.manifest_url)).snapshot.workflows.reconciliations,[]);
    assert.equal((await fetch(app.origin+'/api/v2/fixture/issues/submit',{headers:app.headers,method:'POST',body:'{}'})).status,404);
  } finally {await app.close();}
});

test('v2 HTTP mixed findings, recapture reassessment, fixed packets, and legacy export coexist',async()=>{
  const app=await start();
  try {
    const initial=await app.call('/api/v2/fixture/bootstrap');
    assert.deepEqual(initial.findings,[],'Legacy scope assessments must never be fanned out');
    const installed=await app.call('/api/v2/fixture/findings',finding('fixture-capture-01','DUCT-01','observed_installed'));
    const obscured=await app.call('/api/v2/fixture/findings',finding('fixture-capture-01','DUCT-03','needs_review'));
    assert.notEqual(installed.finding_id,obscured.finding_id);
    const task=await app.call('/api/v2/fixture/tasks',{finding_revision_id:obscured.revision_id,reason:'Connection cannot be inspected in current view.',required_viewpoint:'Close-up looking upward before ceiling closure.',assignee:'Pilot reviewer',due_date:'2026-10-20',before_concealment:true,concealment_date:'2026-10-21'});
    await app.call('/api/v2/fixture/tasks/evidence',{task_id:task.task_id,capture_id:'fixture-capture-02'});
    const stillUnclear=await app.call('/api/v2/fixture/findings',finding('fixture-capture-02','DUCT-03','needs_review'));
    assert.equal((await app.call('/api/v2/fixture/bootstrap')).tasks.find((t:any)=>t.task_id===task.task_id).status,'awaiting_reassessment');
    const resolution=await app.call('/api/v2/fixture/findings',{...finding('fixture-capture-02','DUCT-03','observed_installed'),previous_revision_id:stillUnclear.revision_id,resolves_task_id:task.task_id});
    const state=await app.call('/api/v2/fixture/bootstrap');
    assert.equal(state.tasks.find((t:any)=>t.task_id===task.task_id).status,'closed');
    assert.equal(state.findings.find((f:any)=>f.revision_id===obscured.revision_id).state,'needs_review');
    assert.equal(resolution.model_ref.version_id,'fixture-model-v7');
    assert.equal((await app.call(`/api/v2/fixture/findings/${obscured.finding_id}/history`)).length,1);
    const coverage=await app.call('/api/v2/fixture/coverage?as_of_date=2026-10-19&freshness_days=14');
    assert.equal(coverage.total_elements,3);
    assert.equal(coverage.elements.filter((e:any)=>e.element_id==='DUCT-03').length,1);
    const draft=await app.call('/api/v2/fixture/drafts',{type:'rfi',title:'Clarify terminal clearance',description:'Review the selected connection and confirm required clearance.',location:'Level 02 / East wing',requested_action:'Confirm the detail.',proposed_assignee:'Design coordinator',finding_revision_ids:[obscured.revision_id],annotation_ids:[]});
    assert.equal(draft.external_submission_enabled,false);
    assert.equal(draft.evidence.length,1);
    const packet=await app.call('/api/v2/fixture/exports',{});
    const fixed=await app.call(packet.manifest_url);
    await app.call('/api/v2/fixture/findings',{...finding('fixture-capture-01','DUCT-01','needs_review'),previous_revision_id:installed.revision_id});
    assert.deepEqual(await app.call(packet.manifest_url),fixed);
    const html=await fetch(app.origin+packet.html_url,{headers:app.headers}).then(r=>r.text());
    assert.match(html,/synthetic/i);assert.match(html,/data:image\/png;base64,/);
    const legacy=await app.call('/api/exports',{});
    assert.equal((await app.call(legacy.manifest_url)).schema_version,'0.1.0');
  } finally {await app.close();}
});

test('v2 local photograph import preserves original bytes and unknown/date-only precision, isolates sources, and validates requests',async()=>{
  const app=await start();
  try {
    await app.call('/api/v2/local/configure',{project_name:'Photograph review pilot',location:'Level 02',trade:'Ductwork',scope_name:'East supply package',model_id:'manual-model',model_version:'design-v1',elements:[{external_id:'D-1',label:'Supply duct'},{external_id:'D-2',label:'Connection'}]});
    // Decoder input is generated test data, never represented as a real construction photograph.
    const bytes=await sharp({create:{width:96,height:64,channels:3,background:'#b2a895'}}).jpeg().toBuffer();
    const input={filename:'decoder-test.jpg',content_type:'image/jpeg',bytes_base64:bytes.toString('base64'),title:'Decoder test fixture',source:'Automated integrity test raster',location:'Level 02 / East wing',date_precision:'unknown',captured_date:null,captured_at:null,original_timezone:null};
    const unknown=await app.call('/api/v2/local/photos',input);
    assert.equal(unknown.capture_ref.captured_date,null);assert.equal(unknown.capture_ref.captured_at,null);
    assert.equal(unknown.capture_ref.date_precision,'unknown');
    assert.ok(unknown.capture_ref.uploaded_at);
    const original=await fetch(app.origin+unknown.media_url,{headers:app.headers});
    assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
    assert.equal(unknown.capture_ref.content_sha256,createHash('sha256').update(bytes).digest('hex'));
    const dated=await app.call('/api/v2/local/photos',{...input,filename:'date-only.jpg',date_precision:'date',captured_date:'2026-10-18'});
    assert.equal(dated.capture_ref.captured_date,'2026-10-18');assert.equal(dated.capture_ref.captured_at,null);
    const observation=await app.call('/api/v2/local/findings',finding(unknown.capture_id,'D-1','observed_installed'));
    assert.equal(observation.annotations.length,1);
    assert.equal((await app.call('/api/v2/fixture/bootstrap')).captures.length,2);
    assert.equal((await fetch(app.origin+`/api/v2/fixture/media/${unknown.capture_id}`,{headers:app.headers})).status,404);
    assert.equal((await fetch(app.origin+'/api/v2/local/photos',{method:'POST',headers:app.headers,body:JSON.stringify({...input,bytes_base64:Buffer.from('<svg/>').toString('base64')})})).status,400);
    assert.equal((await fetch(app.origin+'/api/v2/local/findings',{method:'POST',headers:{Cookie:app.headers.Cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(app.origin+'/api/v2/local/issues/submit',{method:'POST',headers:app.headers,body:'{}'})).status,404);
  } finally {await app.close();}
});

test('v2 API never falls back to local sources in live mode',async()=>{
  const app=await start('live');
  try {
    for(const mode of ['fixture','local']) assert.equal((await fetch(`${app.origin}/api/v2/${mode}/bootstrap`,{headers:app.headers})).status,409);
  } finally {await app.close();}
});

test('v2 reconciliation preserves units, unknowns and reporting-period boundaries',async()=>{
  const app=await start();
  try {
    await app.call('/api/v2/fixture/findings',finding('fixture-capture-02','DUCT-01','observed_installed'));
    const entry={category:'trade_reported',period_start:'2026-10-01',period_end:'2026-10-19',element_ids:['DUCT-01'],quantity:12,unit:'m',source:'Manual subcontractor report R1',basis:'Measured centerline length for the explicit element scope',measurement_method:'manual_measurement',comparison_key:'centerline-v1'};
    await app.call('/api/v2/fixture/reconciliation',entry);
    await app.call('/api/v2/fixture/reconciliation',{...entry,category:'imagery_supported',quantity:9});
    let report=await app.call('/api/v2/fixture/reconciliation?period_start=2026-10-01&period_end=2026-10-19');
    assert.equal(report.reconciliation_summary.comparisons[0].delta,3);
    assert.equal(report.reconciliation_summary.observations.observed_installed,1);
    await app.call('/api/v2/fixture/reconciliation',{...entry,category:'unresolved',quantity:null});
    report=await app.call('/api/v2/fixture/reconciliation?period_start=2026-10-01&period_end=2026-10-10');
    assert.equal(report.reconciliation_summary.observations.observed_installed,0,'Later capture must not appear in an earlier reporting period');
    assert.equal(report.reconciliations.length,0);
    const fixed=await app.call('/api/v2/fixture/bootstrap');
    assert.equal(fixed.reconciliations.find((r:any)=>r.category==='unresolved').quantity,null);
    assert.equal(fixed.reconciliation_summary.percentages.every((p:any)=>p.value===null),true);
  } finally {await app.close();}
});
