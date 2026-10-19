import { randomBytes, timingSafeEqual } from 'node:crypto';

const API_ORIGIN = 'https://developer.api.autodesk.com';
const AUTHORIZE_URL = `${API_ORIGIN}/authentication/v2/authorize`;
const TOKEN_URL = `${API_ORIGIN}/authentication/v2/token`;
const SCOPE = 'data:read';
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 100;

export class ApsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApsError';
    this.status = status;
  }
}

export interface ApsOptions {
  mode: 'fixture' | 'live';
  clientId?: string;
  clientSecret?: string;
  callback?: string;
  hubId?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ApsProject {
  id: string;
  type: 'projects';
  attributes: { name: string };
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface Session extends Tokens {
  deadline: number;
  projectAccess: 'unverified' | 'verified' | 'denied';
  refreshPromise?: Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function equalState(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A server-only, per-browser-session APS adapter. Never serialize its internal maps. */
export function createAps(options: ApsOptions) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const callbackUrl = options.callback ?? 'http://localhost:8080/';
  const rawHubId = (options.hubId ?? '').replace(/^b\./, '');
  if (rawHubId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawHubId)) {
    throw new ApsError(500, 'APS_HUB_ID must be a Forma hub UUID, optionally prefixed with b.');
  }
  const dataHubId = rawHubId ? `b.${rawHubId}` : '';
  const projectsPath = `/project/v1/hubs/${dataHubId}/projects`;
  const pending = new Map<string, number>();
  const sessions = new Map<string, Session>();
  const configured = !!(options.clientId && options.clientSecret && rawHubId);
  const parsedCallback = new URL(callbackUrl);
  if (parsedCallback.username || parsedCallback.password || parsedCallback.search || parsedCallback.hash ||
      !(parsedCallback.protocol === 'https:' ||
        (parsedCallback.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedCallback.hostname)))) {
    throw new ApsError(500, 'APS callback must be HTTPS or a loopback HTTP URL, without credentials, query, or fragment.');
  }

  function purge() {
    for (const [state, deadline] of pending) if (deadline <= now()) pending.delete(state);
    for (const [id, session] of sessions) if (session.deadline <= now()) sessions.delete(id);
  }

  function requireLive() {
    if (options.mode !== 'live') throw new ApsError(409, 'APS access is disabled in fixture mode.');
    if (!configured) throw new ApsError(503, 'Set the server-side APS credentials and Forma hub ID to enable sign-in.');
  }

  function requireSession(sessionId?: string): Session {
    requireLive();
    purge();
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) throw new ApsError(401, 'Sign in with Autodesk to read projects.');
    return session;
  }

  async function request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      // Raw upstream errors can contain request details. Return only a fixed local message.
      throw new ApsError(502, 'APS could not be reached. Retry the request.');
    }
  }

  async function json(response: Response): Promise<unknown> {
    try { return await response.json(); }
    catch { throw new ApsError(502, 'APS returned an invalid JSON response.'); }
  }

  async function token(body: URLSearchParams, previousRefreshToken?: string): Promise<Tokens> {
    const response = await request(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) throw new ApsError(401, 'Autodesk authorization failed or expired. Sign in again.');
      throw new ApsError(502, 'APS could not issue a token. Retry sign-in.');
    }
    const payload = await json(response);
    if (!isObject(payload) || typeof payload.access_token !== 'string' || !payload.access_token ||
        !Number.isFinite(payload.expires_in) || Number(payload.expires_in) <= 0 ||
        typeof payload.token_type !== 'string' || payload.token_type.toLowerCase() !== 'bearer') {
      throw new ApsError(502, 'APS returned an invalid token response.');
    }
    const refreshToken = typeof payload.refresh_token === 'string' && payload.refresh_token
      ? payload.refresh_token : previousRefreshToken;
    if (!refreshToken) throw new ApsError(502, 'APS did not provide a refresh token. Sign in again.');
    return { accessToken: payload.access_token, refreshToken, expiresAt: now() + Number(payload.expires_in) * 1000 };
  }

  async function refresh(sessionId: string, session: Session, rejectedAccessToken?: string) {
    // Another in-flight read may already have refreshed the token rejected by APS.
    if (rejectedAccessToken && session.accessToken !== rejectedAccessToken) return;
    if (!session.refreshPromise) {
      session.refreshPromise = (async () => {
        try {
          const refreshed = await token(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken, scope: SCOPE }), session.refreshToken);
          // A concurrent logout must never resurrect a session or allow further reads.
          if (sessions.get(sessionId) !== session || session.deadline <= now()) throw new ApsError(401, 'The local session has ended. Sign in again.');
          Object.assign(session, refreshed);
        } catch (error) {
          if (error instanceof ApsError && error.status === 401) sessions.delete(sessionId);
          throw error;
        } finally {
          delete session.refreshPromise;
        }
      })();
    }
    await session.refreshPromise;
  }

  function safeNext(href: unknown): string | undefined {
    if (href === undefined || href === null) return undefined;
    if (typeof href !== 'string' || !href) throw new ApsError(502, 'APS returned invalid project pagination.');
    let url: URL;
    try { url = new URL(href, `${API_ORIGIN}/`); }
    catch { throw new ApsError(502, 'APS returned invalid project pagination.'); }
    if (url.origin !== API_ORIGIN || url.pathname !== projectsPath || url.username || url.password || url.hash ||
        [...url.searchParams.keys()].some(key => !['page[number]', 'page[limit]'].includes(key))) {
      throw new ApsError(502, 'APS returned project pagination outside the configured hub.');
    }
    return url.href;
  }

  return {
    status(sessionId?: string) {
      purge();
      const session = options.mode === 'live' && sessionId ? sessions.get(sessionId) : undefined;
      const projectAccess = session?.projectAccess ?? 'unverified';
      return {
        configured, authenticated: !!session, mode: options.mode, callback: callbackUrl,
        hub_id: rawHubId, data_management_hub_id: dataHubId, read_only: true,
        project_access: projectAccess,
        message: options.mode === 'fixture'
          ? 'Synthetic fixture workspace. Autodesk sign-in and live project reads are disabled.'
          : !configured ? 'APS credentials or Forma hub ID are missing from the server configuration.'
          : !session ? 'Ready for Autodesk sign-in. Live hub and project access are not verified.'
          : projectAccess === 'verified' ? 'Signed in. The latest project list was read from the configured Forma hub.'
          : projectAccess === 'denied' ? 'Signed in, but APS denied project access. Check project membership and app integration permissions.'
          : 'Signed in. Project access still needs to be checked against APS.',
      };
    },

    login() {
      requireLive();
      purge();
      if (pending.size >= 200) throw new ApsError(429, 'Too many sign-in attempts. Wait a few minutes and retry.');
      const state = randomBytes(32).toString('base64url');
      pending.set(state, now() + STATE_TTL_MS);
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({ response_type: 'code', client_id: options.clientId!, redirect_uri: callbackUrl, scope: SCOPE, state }).toString();
      return { url: url.href, state };
    },

    async callback(code: string, state: string, cookieState?: string) {
      requireLive();
      purge();
      if (typeof code !== 'string' || !code || code.length > 4096 || typeof state !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(state) || !cookieState || !equalState(state, cookieState) || !pending.has(state)) {
        throw new ApsError(400, 'Invalid or expired sign-in state. Start Autodesk sign-in again.');
      }
      pending.delete(state); // One use, including failed code exchange.
      const tokens = await token(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl }));
      purge();
      if (sessions.size >= 100) throw new ApsError(503, 'The local session limit has been reached. Sign out of another browser and retry.');
      const sessionId = randomBytes(32).toString('base64url');
      sessions.set(sessionId, { ...tokens, deadline: now() + SESSION_TTL_MS, projectAccess: 'unverified' });
      return { sessionId };
    },

    async projects(sessionId?: string): Promise<{ data: ApsProject[]; hub_id: string }> {
      const session = requireSession(sessionId);
      if (session.expiresAt <= now() + 60_000) await refresh(sessionId!, session);
      const initial = new URL(projectsPath, API_ORIGIN);
      initial.search = new URLSearchParams({ 'page[number]': '0', 'page[limit]': '100' }).toString();
      let next: string | undefined = initial.href;
      const visited = new Set<string>();
      const data = new Map<string, ApsProject>();
      let pages = 0;
      while (next) {
        if (visited.has(next) || ++pages > MAX_PAGES) throw new ApsError(502, 'APS project pagination exceeded the local safety limit. No partial list was returned.');
        visited.add(next);
        if (sessions.get(sessionId!) !== session || session.deadline <= now()) throw new ApsError(401, 'The local session has ended. Sign in again.');
        const requestedToken = session.accessToken;
        let response = await request(next, { method: 'GET', headers: { Authorization: `Bearer ${requestedToken}`, Accept: 'application/vnd.api+json' } });
        if (response.status === 401) {
          await refresh(sessionId!, session, requestedToken);
          response = await request(next, { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}`, Accept: 'application/vnd.api+json' } });
        }
        if (!response.ok) {
          if (response.status === 401) {
            sessions.delete(sessionId!);
            throw new ApsError(401, 'APS rejected the user session. Sign in again.');
          }
          if (response.status === 403) {
            session.projectAccess = 'denied';
            throw new ApsError(403, 'APS denied project access. Check hub/project membership and app integration permissions.');
          }
          if (response.status === 404) throw new ApsError(404, 'APS could not find the configured hub or its projects for this user.');
          throw new ApsError(response.status === 429 ? 503 : 502, 'APS could not return the project list. Retry later.');
        }
        const payload = await json(response);
        if (!isObject(payload) || !Array.isArray(payload.data)) throw new ApsError(502, 'APS returned an invalid project list.');
        for (const project of payload.data) {
          if (!isObject(project) || typeof project.id !== 'string' || !project.id || project.type !== 'projects' ||
              !isObject(project.attributes) || typeof project.attributes.name !== 'string') {
            throw new ApsError(502, 'APS returned an invalid project record.');
          }
          data.set(project.id, { id: project.id, type: 'projects', attributes: { name: project.attributes.name } });
        }
        if (payload.links !== undefined && !isObject(payload.links)) throw new ApsError(502, 'APS returned invalid project pagination.');
        const links = isObject(payload.links) ? payload.links : undefined;
        if (links?.next !== undefined && links.next !== null &&
            (!isObject(links.next) || typeof links.next.href !== 'string')) {
          throw new ApsError(502, 'APS returned invalid project pagination.');
        }
        next = safeNext(isObject(links?.next) ? links.next.href : undefined);
      }
      if (sessions.get(sessionId!) !== session || session.deadline <= now()) throw new ApsError(401, 'The local session has ended. Sign in again.');
      session.projectAccess = 'verified';
      return { data: [...data.values()], hub_id: rawHubId };
    },

    logout(sessionId?: string) {
      if (sessionId) sessions.delete(sessionId);
      // Local logout discards server-held tokens; it does not sign out of Autodesk globally.
    },
  };
}
