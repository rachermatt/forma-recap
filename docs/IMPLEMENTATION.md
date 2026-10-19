# Forma ReCap implementation agreement

Increment 0.2 extends this architecture through [NEXT-INCREMENT.md](NEXT-INCREMENT.md), adding separate element findings, original photograph storage, recapture, manual reconciliation and local drafts. The original 0.1 agreement remains below for compatibility.

Build target: first persistent local fixture workflow (handoff Phase 0–1), plus server-managed OAuth and smallest read adapters where access permits. Product name is always Forma ReCap; original handoff is retained unchanged as source material.

Stack: Node 24.19+ native TypeScript execution and node:sqlite; React + TypeScript + Vite for the browser. One Node HTTP server on localhost:8080 serves the built browser app and JSON API. No deployment or live external writes. SQLite and secrets stay out of source control.

## Modules and ownership

- `server/domain.ts`, `server/fixtures.ts`: domain/persistence agent. Native SQLite, schema/invariant validation, immutable assessments, pins, immutable evidence exports. Add domain tests.
- `src/*`, `index.html`: frontend agent. React workspace, CSS, timeline, plan, review, history, exports and integration status. No package/config edits needed.
- `server/aps.ts`, `docs/APS-VERIFICATION.md`: APS agent. Official-doc research, OAuth flow/read adapters, mocked security tests. No real secrets.
- `server/index.ts`, project/config files, integration tests, synthetic SVG media, docs: root agent.

## Shared HTTP API

All APIs same-origin. `GET /api/bootstrap` => `{mode, csrfToken, user:{id,name}, project, model, scope, plan, captures, assessments, exports, capabilities}`. Fixture user is a clearly labeled local reviewer, never an Autodesk identity. Bootstrap response in live mode contains empty/null fixture entities plus integration config/status. Server checks Origin/Host and CSRF on mutations; bound only to loopback.

Fixture shapes:

```
project: {id:'fixture-project',name:'Northbank Research Center',hub_id:'fixture-hub',mode:'fixture'}
model: {id:'fixture-model',name:'Mechanical coordination',version_id:'fixture-model-v7',version_label:'Version 7',elements:[{external_id:'DUCT-01',label:'Main supply duct',zone_id:'zone-east'}]}
scope: {scope_id:'fixture-scope',revision:1,trade:'Ductwork',zone_id:'zone-east',floor:'Level 02',name:'East wing · supply air',element_ids:['DUCT-01','DUCT-02','DUCT-03'],created_by:'fixture-reviewer',model_version_id:'fixture-model-v7'}
plan: {file_id:'fixture-plan',version_id:'fixture-plan-v3',name:'Level 02 · Mechanical plan',url:'/api/media/fixture-plan'}
capture: {capture_id:'fixture-capture-01',title:'East corridor',capture_ref:<contract capture_ref>,media_url:'/api/media/fixture-capture-01',placement:<contract placement>}
```

`GET /api/media/:id` private synthetic SVG bytes with project checks. `GET /api/assessments/:id/history` => array of assessment contract revisions, oldest first.

`POST /api/assessments` body `{capture_id, state, rationale, uncertainty_reason, element_ids, previous_revision_id}` => new immutable contract assessment. `previous_revision_id:null` for first assessment for that capture/scope; require current revision id on correction, conflict (409) otherwise. Reviewer identity and time are server-owned. All evidence is the selected capture. Root serves errors as `{error}`.

`PUT /api/captures/:id/placement` body `{x,y}` => capture; normalized top-left coordinates. Assessments snapshot placement at review time.

`POST /api/exports` body `{}` => `{id,created_at,revision_count,html_url,manifest_url}` immutable snapshot of current assessment revisions plus history. `GET /api/exports/:id/manifest` => manifest; `GET /api/exports/:id/report` => self-contained HTML report with embedded original evidence and manifest. Fixed snapshot reproducible. Browser can download report/JSON from these URLs. GET export authenticated. No remote issue create endpoint; issue capability visibly disabled.

`GET /api/integration/status` => `{configured,authenticated,mode,callback,hub_id,read_only:true,message}`; `GET /auth/login` redirects to official Autodesk OAuth only in live mode; `GET /` handles callback only when code/state present; `POST /auth/logout` clears server session; `GET /api/aps/projects` lists authorized projects of configured hub. Never expose secret, access token or refresh token. UI can show sign-in link only in live mode.

## Domain API (agreed exports)

`createStore({dbPath,mediaDir,mode})` returns `{bootstrap(), getMedia(id), saveAssessment(body), history(id), placeCapture(id,{x,y}), createExport(), getExport(id), close()}`. Each domain method rejects live access to fixture data. `getMedia` returns `{body:Buffer,contentType}`. `getExport` returns `{manifest,html,summary}`; createExport returns summary. `bootstrap` returns fixture data above excluding csrf/user/capabilities, which root adds. Error objects use numeric `.status`. Domain constructor seeds one synthetic project/scope, 3 elements and 2 dated captures; media files supplied by root in `server/media`.

## Sources

- [Handoff scope](handoff/docs/01-product-scope.md), [contract](../contracts/assessment.schema.json), [acceptance](handoff/docs/05-acceptance-and-validation.md)
- [Vite requirements](https://vite.dev/guide/), [Node SQLite](https://nodejs.org/download/release/v24.20.0/docs/api/sqlite.html)
