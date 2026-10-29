# Forma ReTrace APS verification

Checked 2026-10-19. This document separates documented contracts, implementation tests, and live authorization. The original handoff remains source material; the current product name is **Forma ReTrace**.

## Implemented boundary

`server/aps.ts` implements a server-managed authorization-code flow for the supplied **Traditional Web App**, refresh, local logout, and a read-only project list. Only `data:read` is requested. The callback stays exactly `http://localhost:8080/`, matching the user-provided app registration. Credentials come from server environment variables and never enter the browser bundle.

| Operation | Official APS contract | Local behavior |
|---|---|---|
| Consent | `GET /authentication/v2/authorize` | Sends the browser to Autodesk with a random state bound to an HttpOnly browser cookie. |
| Code exchange | `POST /authentication/v2/token` | Confidential client authentication through HTTP Basic; authorization code and exact redirect URI in the form body. |
| Refresh | `POST /authentication/v2/token` | Uses `grant_type=refresh_token`, current refresh token and `data:read`; retains the latest returned token. |
| Projects | `GET /project/v1/hubs/{hub_id}/projects` | Fixed configured hub, authenticated user context, GET only, follows validated pagination. |

Autodesk documents the confidential client authorization-code flow and its Basic-authenticated token exchange in the [3-legged authorization tutorial](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/get-3-legged-token). Its [OAuth v2 migration guide](https://aps.autodesk.com/blog/migration-guide-oauth2-v1-v2) gives the refresh request format. APS documents PKCE as the public-client variant in its [PKCE tutorial](https://aps.autodesk.com/en/docs/oauth/v2/tutorials/get-3-legged-token-pkce/get-3-legged-token-pkce/). This implementation follows the documented confidential flow for the provided app type; it does not assume an unverified confidential-client/PKCE combination.

Configure your intended Forma hub UUID through `APS_HUB_ID`. The Data Management adapter uses its `b.`-prefixed representation, following the documented [Forma-to-Data-Management hub ID conversion](https://aps.autodesk.com/en/docs/data/v2/reference/http/hubs-GET). The original installation's supplied hub was not established to be a project-bearing customer hub. A Developer Hub used to manage applications must not be assumed to contain the intended project data. Installation-specific identifiers are not required for the synthetic demo.

The [project endpoint reference](https://aps.autodesk.com/en/docs/data/v2/reference/http/hubs-hub_id-projects-GET) and [pagination guide](https://aps.autodesk.com/en/docs/data/v2/developers_guide/pagination) are the intended endpoint contracts. These pages were located, but their dynamic reference bodies were not exposed by the research browser. The official [Data Management changelog](https://aps.autodesk.com/en/docs/data/v2/change_history) confirms `page[number]` and `page[limit]` support, and the official [project browsing tutorial](https://get-started.aps.autodesk.com/tutorials/acc-issues/data) confirms the project list is limited to the signed-in user's membership. Exact live paging behavior still needs an authorized-project exercise.

## Controls implemented and tested locally

Opaque sessions and access/refresh tokens live only in server memory, separately for each browser session. Restarting the server signs out all browsers. States expire after ten minutes and are consumed before code exchange; sessions expire after eight hours. Local logout deletes the tokens held by this process. It does not revoke Autodesk consent or end the user's Autodesk browser session.

Only the configured hub path is available through the adapter. Pagination cannot redirect bearer tokens to another origin, another hub, or an unrelated endpoint. HTTP redirects are refused. Repeated/cyclic pages and more than 100 pages fail without returning a partial list. The app refreshes shortly before expiry, serializes concurrent refreshes, and retries a resource 401 once. A 403 reports denied permissions without declaring authentication failed. Upstream body text, tokens, and client credentials are excluded from public errors/status.

Run `node --test tests/aps.test.ts` from the project directory. **18 tests passed** on Node 24.19.0, using mocked fetch responses. They cover disabled fixture access, missing config, callback and hub validation, minimal scopes, one-use browser-bound state, expiry/replay, token privacy, malformed token/project responses, isolated sessions, logout during refresh, refresh rotation/concurrency, fixed-hub reads, empty-page pagination, unsafe next links, cycles, permission denial, 401 retry, network errors and redirects. These tests establish local behavior; they do not establish Autodesk authorization.

## Live evidence and remaining gates

On 2026-10-19 the root implementation ran one live app-credential check: `POST /authentication/v2/token`, `grant_type=client_credentials`, scope `data:read`. APS returned **HTTP 200**, `token_type: Bearer`, and `expires_in: 3599`; the response did not include a scope field. The token was discarded. No project request or remote data write was made in this probe. **App credentials verified only.**

**End-user consent and project-bearing Forma hub access remain unverified.** The successful app-only token exchange does not establish user identity, membership, project access, capture/media access, or write permission.

Before describing the integration as project tested:

1. Start in live mode and complete Autodesk consent in the browser. Confirm that the configured ID is the intended Forma data hub; use the actual project hub ID if it differs from the supplied Developer Hub ID.
2. Read the intended user's projects successfully; record only sanitized project IDs/names and the user's role with permission to retain them. Check a denied user/project case separately.
3. Exercise pagination on an authorized multipage result and verify rate-limit/region behavior against the current full endpoint reference. No partial lists should be presented as complete.
4. Establish each additional file/model/media adapter separately before enabling it. The current adapter does not read models or photos, create Issues, upload attachments, reconstruct reality data, or certify construction completion.

The [handoff capability register](handoff/docs/04-api-capability-register.md) retains the broader research and later-phase gates. Selecting APIs in Developer Hub is not evidence of any of those project-specific permissions.
