import assert from 'node:assert/strict';
import test from 'node:test';
import { createAps, ApsError } from '../server/aps.ts';

const HUB = '31bbf700-27f1-47cc-b30c-2e8048443ee8';
const API = 'https://developer.api.autodesk.com';
const PATH = `/project/v1/hubs/b.${HUB}/projects`;
const CALLBACK = 'http://localhost:8080/';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function tokens(access = 'test-access', refresh = 'test-refresh', expires = 3600) {
  return json({ access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: expires });
}

function project(id: string) { return { id, type: 'projects', attributes: { name: `Project ${id}` } }; }

function setup(handler: (url: string, init: RequestInit) => Response | Promise<Response> = () => tokens()) {
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  const options = { mode: 'live' as const, clientId: 'test-client', clientSecret: 'test-secret', callback: CALLBACK, hubId: HUB, fetchImpl, now: () => clock };
  const aps = createAps(options);
  return { aps, calls, options, advance: (ms: number) => { clock += ms; } };
}

async function signIn(aps: ReturnType<typeof createAps>) {
  const { state } = aps.login();
  return (await aps.callback('test-code', state, state)).sessionId;
}

const errorStatus = (status: number) => (error: unknown) => error instanceof ApsError && error.status === status;

test('fixture mode makes no APS requests and cannot authenticate', async () => {
  const { options, calls } = setup();
  const aps = createAps({ ...options, mode: 'fixture' });
  assert.equal(aps.status().authenticated, false);
  assert.match(aps.status().message, /Synthetic/);
  assert.throws(() => aps.login(), errorStatus(409));
  await assert.rejects(() => aps.projects('invented'), errorStatus(409));
  assert.equal(calls.length, 0);
});

test('missing credentials disable login; invalid hub IDs and callback URLs are refused', () => {
  const { options } = setup();
  const aps = createAps({ ...options, clientSecret: '' });
  assert.equal(aps.status().configured, false);
  assert.throws(() => aps.login(), errorStatus(503));
  assert.throws(() => createAps({ ...options, hubId: '../../other-hub' }), errorStatus(500));
  assert.throws(() => createAps({ ...options, callback: 'http://public.example/' }), errorStatus(500));
  assert.throws(() => createAps({ ...options, callback: `${CALLBACK}?code=bad` }), errorStatus(500));
});

test('authorize URL uses confidential authorization code flow and only data:read', () => {
  const { aps } = setup();
  const first = aps.login();
  const second = aps.login();
  const url = new URL(first.url);
  assert.equal(url.origin, API);
  assert.equal(url.pathname, '/authentication/v2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK);
  assert.equal(url.searchParams.get('scope'), 'data:read');
  assert.equal(url.searchParams.get('state'), first.state);
  assert.equal(first.state.length, 43);
  assert.notEqual(first.state, second.state);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(url.searchParams.has('code_challenge'), false);
});

test('callback requires pending state bound to the initiating browser cookie', async () => {
  const { aps, calls } = setup();
  const { state } = aps.login();
  await assert.rejects(() => aps.callback('code', state), errorStatus(400));
  await assert.rejects(() => aps.callback('code', state, 'wrong-browser'), errorStatus(400));
  await assert.rejects(() => aps.callback('code', 'A'.repeat(43), 'A'.repeat(43)), errorStatus(400));
  assert.equal(calls.length, 0);
  const { sessionId } = await aps.callback('code', state, state);
  assert.equal(aps.status(sessionId).authenticated, true);
  assert.equal(aps.status().authenticated, false);
  await assert.rejects(() => aps.callback('code', state, state), errorStatus(400));
  assert.equal(calls.length, 1);
});

test('pending state expires after ten minutes', async () => {
  const { aps, calls, advance } = setup();
  const { state } = aps.login();
  advance(10 * 60_000);
  await assert.rejects(() => aps.callback('code', state, state), errorStatus(400));
  assert.equal(calls.length, 0);
});

test('token exchange keeps secret and tokens server-side, with Basic authentication', async () => {
  const { aps, calls } = setup();
  const sessionId = await signIn(aps);
  const { url, init } = calls[0];
  assert.equal(url, `${API}/authentication/v2/token`);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal);
  assert.equal(new Headers(init.headers).get('authorization'), `Basic ${Buffer.from('test-client:test-secret').toString('base64')}`);
  const body = new URLSearchParams(String(init.body));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), CALLBACK);
  assert.equal(body.has('client_secret'), false);
  const publicStatus = JSON.stringify(aps.status(sessionId));
  assert.doesNotMatch(publicStatus, /test-secret|test-access|test-refresh/);
  assert.equal(aps.status(sessionId).project_access, 'unverified');
});

test('failed token exchange consumes state and suppresses upstream error details', async () => {
  const { aps, calls } = setup(() => json({ error_description: 'secret leaked upstream test-secret' }, 400));
  const { state } = aps.login();
  await assert.rejects(() => aps.callback('code', state, state), error => errorStatus(401)(error) && !String(error).includes('test-secret'));
  await assert.rejects(() => aps.callback('code', state, state), errorStatus(400));
  assert.equal(calls.length, 1);
  assert.equal(aps.status().authenticated, false);
});

test('token response must contain a bearer token, valid expiry and refresh token', async () => {
  for (const payload of [
    { access_token: 'access', token_type: 'Bearer', expires_in: 3600 },
    { access_token: 'access', refresh_token: 'refresh', token_type: 'Basic', expires_in: 3600 },
    { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: -1 },
  ]) {
    const { aps } = setup(() => json(payload));
    await assert.rejects(() => signIn(aps), errorStatus(502));
  }
});

test('projects requires an exact server session and reads only the configured b.-prefixed hub', async () => {
  const { aps, calls } = setup(url => url.endsWith('/token') ? tokens() : json({ data: [project('b.p1')] }));
  await assert.rejects(() => aps.projects(), errorStatus(401));
  await assert.rejects(() => aps.projects('invented-session'), errorStatus(401));
  const sessionId = await signIn(aps);
  const result = await aps.projects(sessionId);
  assert.deepEqual(result, { data: [project('b.p1')], hub_id: HUB });
  const requestUrl = new URL(calls[1].url);
  assert.equal(requestUrl.pathname, PATH);
  assert.equal(requestUrl.searchParams.get('page[number]'), '0');
  assert.equal(requestUrl.searchParams.get('page[limit]'), '100');
  assert.equal(new Headers(calls[1].init.headers).get('authorization'), 'Bearer test-access');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(aps.status(sessionId).project_access, 'verified');
});

test('project pagination follows next links, including empty pages, and deduplicates projects', async () => {
  let pages = 0;
  const { aps } = setup(url => {
    if (url.endsWith('/token')) return tokens();
    pages += 1;
    if (pages === 1) return json({ data: [project('one')], links: { next: { href: `${PATH}?page[number]=1&page[limit]=100` } } });
    if (pages === 2) return json({ data: [], links: { next: { href: `${API}${PATH}?page[number]=2&page[limit]=100` } } });
    return json({ data: [project('one'), project('two')], links: { next: null } });
  });
  const result = await aps.projects(await signIn(aps));
  assert.deepEqual(result.data.map(p => p.id), ['one', 'two']);
  assert.equal(pages, 3);
});

test('pagination refuses other origins, other hubs, arbitrary query parameters and cycles', async () => {
  for (const href of [
    `https://attacker.example${PATH}?page[number]=1`,
    `${API}/project/v1/hubs/b.other/projects?page[number]=1`,
    `${PATH}?access_token=steal`,
    `${PATH}?page%5Bnumber%5D=0&page%5Blimit%5D=100`,
  ]) {
    const { aps, calls } = setup(url => url.endsWith('/token') ? tokens() : json({ data: [], links: { next: { href } } }));
    await assert.rejects(async () => aps.projects(await signIn(aps)), errorStatus(502));
    assert.equal(calls.length, 2);
  }
});

test('403 is a permission failure after sign-in, not a successful capability verification', async () => {
  const { aps } = setup(url => url.endsWith('/token') ? tokens() : json({ error: 'denied' }, 403));
  const sessionId = await signIn(aps);
  await assert.rejects(() => aps.projects(sessionId), errorStatus(403));
  assert.equal(aps.status(sessionId).authenticated, true);
  assert.equal(aps.status(sessionId).project_access, 'denied');
});

test('expired access tokens refresh once across concurrent reads and retain rotated refresh token', async () => {
  let tokenCalls = 0;
  let refreshCalls = 0;
  const { aps, advance } = setup((url, init) => {
    if (url.endsWith('/token')) {
      tokenCalls += 1;
      const form = new URLSearchParams(String(init.body));
      if (form.get('grant_type') === 'authorization_code') return tokens('first-access', 'first-refresh', 120);
      refreshCalls += 1;
      assert.equal(form.get('scope'), 'data:read');
      assert.equal(form.get('refresh_token'), refreshCalls === 1 ? 'first-refresh' : 'rotated-refresh');
      return tokens(`access-${refreshCalls}`, 'rotated-refresh', 120);
    }
    return json({ data: [] });
  });
  const sessionId = await signIn(aps);
  advance(61_000);
  await Promise.all([aps.projects(sessionId), aps.projects(sessionId)]);
  assert.equal(tokenCalls, 2);
  advance(61_000);
  await aps.projects(sessionId);
  assert.equal(tokenCalls, 3);
});

test('APS 401 refreshes and retries once; repeated rejection clears the local session', async () => {
  let tokenCalls = 0;
  let reads = 0;
  const { aps } = setup(url => {
    if (url.endsWith('/token')) return tokens(`access-${++tokenCalls}`);
    reads += 1;
    return json({ error: 'expired' }, 401);
  });
  const sessionId = await signIn(aps);
  await assert.rejects(() => aps.projects(sessionId), errorStatus(401));
  assert.equal(tokenCalls, 2);
  assert.equal(reads, 2);
  assert.equal(aps.status(sessionId).authenticated, false);
});

test('refresh invalid_grant clears only the affected browser session', async () => {
  const { aps, advance } = setup((url, init) => {
    const form = new URLSearchParams(String(init.body));
    if (url.endsWith('/token') && form.get('grant_type') === 'refresh_token') return json({ error: 'invalid_grant' }, 400);
    return tokens('access', 'refresh', 120);
  });
  const first = await signIn(aps);
  const second = await signIn(aps);
  advance(61_000);
  await assert.rejects(() => aps.projects(first), errorStatus(401));
  assert.equal(aps.status(first).authenticated, false);
  assert.equal(aps.status(second).authenticated, true);
});

test('logout clears local tokens and an in-flight refresh cannot restore the session', async () => {
  let resolveRefresh: ((response: Response) => void) | undefined;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { notifyStarted = resolve; });
  const { aps, advance, calls } = setup((url, init) => {
    if (url.endsWith('/token') && new URLSearchParams(String(init.body)).get('grant_type') === 'refresh_token') {
      notifyStarted!();
      return new Promise<Response>(resolve => { resolveRefresh = resolve; });
    }
    return tokens('access', 'refresh', 120);
  });
  const sessionId = await signIn(aps);
  advance(61_000);
  const reading = aps.projects(sessionId);
  await started;
  aps.logout(sessionId);
  resolveRefresh!(tokens());
  await assert.rejects(() => reading, errorStatus(401));
  assert.equal(calls.length, 2);
  assert.equal(aps.status(sessionId).authenticated, false);
  await assert.rejects(() => aps.projects(sessionId), errorStatus(401));
});

test('local sessions expire after eight hours, independently of token lifetime', async () => {
  const { aps, advance, calls } = setup(() => tokens('access', 'refresh', 86400));
  const sessionId = await signIn(aps);
  advance(8 * 60 * 60_000);
  assert.equal(aps.status(sessionId).authenticated, false);
  await assert.rejects(() => aps.projects(sessionId), errorStatus(401));
  assert.equal(calls.length, 1);
});

test('bad JSON, malformed project records, network errors and redirects fail closed', async () => {
  for (const bad of [
    () => new Response('not json', { status: 200 }),
    () => json({ data: [{ id: 'one', type: 'projects', attributes: {} }] }),
    () => json({ data: {}, links: {} }),
    () => json({ data: [], links: 'invalid' }),
    () => json({ data: [], links: { next: {} } }),
    () => { throw new Error('network failure with test-secret'); },
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } }),
  ]) {
    const { aps } = setup(url => url.endsWith('/token') ? tokens() : bad());
    const sessionId = await signIn(aps);
    await assert.rejects(() => aps.projects(sessionId), error => errorStatus(502)(error) && !String(error).includes('test-secret'));
    assert.equal(aps.status(sessionId).project_access, 'unverified');
  }
});
