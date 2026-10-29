# Vercel public synthetic demo

The deployment at `https://forma-recap.vercel.app` originally served the Vite frontend but returned HTTP 404 for `/api/bootstrap` and `/api/integration/status`. The interface needs those APIs before opening its workspace. Vite's development proxy does not run in a production static deployment, and `npm start` is not a Vercel function entry point.

## Deployment configuration

`vercel.json` builds the frontend with `npm ci` and `npm run build`, serves `dist/`, and routes `/api/*` and `/auth/*` to one Node.js function at `api/index.ts`. The function uses the existing application and validated synthetic seed; original media and the fixed packet files are explicitly included in its bundle. No APS credentials or additional service is needed for this demonstration.

The hosted environment is deliberately **public, synthetic and read-only**. It exposes the completed saved example, source media, annotations, findings/revisions, recapture history, coverage filters, manual reconciliation, local draft previews and existing packet downloads. The interface labels that boundary, and the server rejects mutations independently of disabled UI controls. Local photograph workspaces and APS authentication are unavailable on this public deployment.

The function initializes its own validated copy of the demo under the runtime's temporary directory. Each instance serves the same fixed snapshot. It does not depend on process-local sessions or use that temporary directory as durable shared storage. Browser refreshes, new instances and redeployments therefore do not change the saved example. No real photograph upload, visitor assessment or external Issue/RFI submission is accepted.

The local application remains writable and persistent through `npm start`. The isolated local demonstration remains writable through `npm run demo:setup` and `npm run demo`. Their existing session, CSRF, host and storage behavior remains separate from this public read-only adapter.

## Connected GitHub project

Vercel should use the repository root, the Vite framework preset, the repository's `vercel.json`, and Node.js **24.x**. A commit to the connected production branch triggers Vercel's normal deployment. The configured public host is `forma-retrace.vercel.app`; the original `forma-recap.vercel.app` remains an exact compatibility alias. Vercel-provided deployment hosts can be accepted only through trusted platform environment metadata. Arbitrary Host or forwarded-host values do not expand the allowlist.

If a project-level override conflicts with repository configuration, inspect the deployment build log and restore the root/build/output settings above. A frontend page loading successfully does not establish that its APIs deployed successfully: check both bootstrap endpoints and an original-media/packet route.

### Renamed host returns 403

`Workspace unavailable` with `Invalid public demo host` means the frontend loaded, but the API rejected its request hostname before returning workspace data. The October 29, 2026 rename left the original host as the only static allowlist entry. The source-connected Vercel project serves `forma-retrace.vercel.app`, so it needs that exact hostname in `publicDemoOrigins` even when production-alias environment metadata is unavailable. The correction adds the renamed host and retains the original alias; it does not accept arbitrary Vercel hosts, infer trust from request headers, enable edits or enable APS access.

After deploying, verify `/api/bootstrap`, `/api/v2/fixture/bootstrap`, one source-media route and a fixed packet report. Confirm the bootstrap identifies a public synthetic read-only deployment and that mutation, private workspace and authentication routes remain blocked.

The weekly decision queue also needs `/api/v3/fixture/bootstrap`. Vercel can forward the named `:path*` rewrite capture as a `path` query parameter. The adapter consumes that reserved transport field after validating `__forma_route`; only the remaining application query reaches strict scope-filter validation. The route marker and original request pathname still have to agree, unknown application filters still fail, and `path` cannot redirect a request into a private workspace.

## Validation and future cloud editing

The focused server tests cover anonymous public reads across independent instances, exact allowed HTTPS hosts/origins, rewritten routes and query preservation, disabled mutations/local workspaces/APS, original media and fixed packets. Existing localhost tests continue to cover sessions, CSRF and persistent review behavior. The production frontend is built with the hosted controls and disclosures.

A writable cloud application requires durable database and original-media storage, authenticated users and project permissions, shared session handling, authorized upload limits, backup/retention behavior, and tests across concurrent instances and redeployments. Preserve append-only assessments, source hashes and immutable packet snapshots when adding those services. The existing 15 MiB local photograph importer cannot be passed unchanged through Vercel's 4.5 MB function payload limit.

Official deployment references checked on 2026-10-19:

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite): Vite frontend deployment and server functions.
- [Node.js functions](https://vercel.com/docs/functions/runtimes/node-js): root `api/` entry points and native Node request/response objects.
- [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions): Node.js 24 support.
- [Function configuration](https://vercel.com/docs/project-configuration/vercel-json#functions): explicit bundled files and function limits.
- [SQLite on Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel): ephemeral, nonshared function storage.
- [Function payload limits](https://vercel.com/docs/functions/limitations#request-body-size): request and response size constraints.
