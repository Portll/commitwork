// admin — linking a GitHub account by signing in with GitHub (/auth/github/link), end to end.
//
// Two panels: one with GitHub configured and live exchange on, one with no GitHub credentials at
// all. Every provider call goes to a loopback stub through CW_OAUTH_ENDPOINT_BASE, so nothing here
// reaches GitHub. CW_SECRETS_FILE points at a file that does not exist, so the operator's keychain
// cannot configure the "unconfigured" panel behind the test's back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request, createServer as createHttp } from 'node:http';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';

// Pin the store BEFORE auth.mjs loads — see admin/test/store-path-call-time.test.mjs for why.
const TMP = mkdtempSync(join(tmpdir(), 'cw-ghlink-'));
const STORE = join(TMP, 'live', 'users.json');
const BARE_STORE = join(TMP, 'bare', 'users.json');
mkdirSync(dirname(STORE)); mkdirSync(dirname(BARE_STORE));
process.env.CW_AUTH_STORE = STORE;
const { bootstrapRoot } = await import('../auth.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const AUTH_SESSION = join(HERE, '..', 'lib', 'auth-session.mjs');
const EMAIL = 'op@example.com';
const OTHER = 'second@example.com';   // a second panel user, for the one-account-one-user refusal
const PASSWORD = 'correct horse battery staple';
const CLIENT_ID = 'stub-github-client-id';
// Distinctive enough that finding it anywhere on disk or in the log can only mean it leaked.
const TOKEN = 'gho_stubLinkToken_7f3a9c1e5b2d4086';
const UNCONFIGURED = 'GitHub sign-in is not configured on this box (GITHUB_OAUTH_CLIENT_ID)';

let stub, stubPort, live, bare;
const seen = { token: [], user: [] };

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hit = (srv, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const h = { ...headers };
  if (body != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(body); }
  const req = request({ host: '127.0.0.1', port: srv.port, path, method, headers: h }, (r) => {
    let buf = '';
    r.setEncoding('utf8');
    r.on('data', (d) => { buf += d; });
    r.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ }
      resolve({ status: r.statusCode, body: buf, json, headers: r.headers }); });
  });
  req.on('error', reject);
  if (body != null) req.write(body);
  req.end();
});

async function boot(store, env) {
  const srv = { port: await freePort(), log: [] };
  srv.child = spawn(process.execPath, [SERVE], {
    env: { ...process.env,
      CW_AUTH_STORE: store, CW_REGISTRY: join(TMP, 'projects.json'),
      CW_SECRETS_FILE: join(TMP, 'no-secrets.json'),
      CW_ADMIN_PORT: String(await freePort()), CW_ADMIN_LOCAL_PORT: String(srv.port),
      CW_OAUTH_ENDPOINT_BASE: `http://127.0.0.1:${stubPort}`, CW_OAUTH_BASE_URL: '',
      GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
      ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const s of [srv.child.stdout, srv.child.stderr]) s.on('data', (d) => srv.log.push(String(d)));
  for (let i = 0; i < 150 && !srv.csrf; i++) {
    try { const r = await hit(srv, '/api/csrf'); srv.csrf = r.json && r.json.token; } catch { /* not up yet */ }
    if (!srv.csrf) await sleep(100);
  }
  assert.ok(srv.csrf, `panel did not come up:\n${srv.log.join('')}`);
  return srv;
}

/** A fresh password session on `srv`, as a Cookie header value. */
async function signIn(srv, email = EMAIL) {
  const r = await hit(srv, '/auth/login', { method: 'POST', headers: { 'x-cw-csrf': srv.csrf },
    body: JSON.stringify({ email, password: PASSWORD }) });
  assert.equal(r.status, 200, r.body);
  const m = /cw_admin_sid=([^;]+)/.exec(String(r.headers['set-cookie'] || ''));
  assert.ok(m, 'login set no session cookie');
  return `cw_admin_sid=${m[1]}`;
}

/** Start link mode as `cookie`; returns the authorize URL the panel redirected to and its state. */
async function startLink(cookie) {
  const r = await hit(live, '/auth/github/link', { headers: { cookie } });
  assert.equal(r.status, 302, r.body);
  const url = new URL(String(r.headers.location));
  assert.equal(url.origin, `http://127.0.0.1:${stubPort}`, 'the authorize redirect must go to the stub');
  const state = url.searchParams.get('state');
  assert.ok(state, 'no state in the authorize redirect');
  return { url, state };
}

const callback = (state, cookie) => hit(live, `/auth/callback/github?code=stub-code&state=${encodeURIComponent(state)}`,
  { headers: cookie ? { cookie } : {} });
const linked = (email = EMAIL) => JSON.parse(readFileSync(STORE, 'utf8')).users.find((u) => u.email === email).github || null;
const noSessionMinted = (r) => assert.doesNotMatch(String(r.headers['set-cookie'] || ''), /cw_admin_sid=/,
  'the GitHub callback minted a session');

function filesContaining(dir, needle) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesContaining(p, needle));
    else if (e.isFile() && readFileSync(p, 'utf8').includes(needle)) out.push(p);
  }
  return out;
}

before(async () => {
  bootstrapRoot({ email: EMAIL, password: PASSWORD });
  copyFileSync(STORE, BARE_STORE);
  // The second user shares the root's password hash, so signIn() works for both. Written before
  // the panel boots, so no process holds the store lock.
  const doc = JSON.parse(readFileSync(STORE, 'utf8'));
  doc.users.push({ ...doc.users[0], id: 'second-user-id', email: OTHER });
  writeFileSync(STORE, JSON.stringify(doc), { mode: 0o600 });
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'a', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'a', label: 'a', out: 'a', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'a'), { recursive: true });

  // GitHub's three endpoints, routed by path, recording what the panel sent.
  stubPort = await freePort();
  stub = createHttp((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const p = req.url.split('?')[0];
      res.setHeader('content-type', 'application/json');
      if (p === '/login/oauth/access_token') {
        seen.token.push(new URLSearchParams(body));
        return res.end(JSON.stringify({ access_token: TOKEN, token_type: 'bearer', scope: 'read:user' }));
      }
      if (p === '/user') {
        seen.user.push(req.headers.authorization);
        return res.end(JSON.stringify({ login: 'octo-link', id: 4242, email: null }));
      }
      if (p === '/user/emails') return res.end('[]');
      res.statusCode = 404; return res.end('{}');
    });
  });
  await new Promise((r) => stub.listen(stubPort, '127.0.0.1', r));

  [live, bare] = await Promise.all([
    boot(STORE, { CW_OAUTH_LIVE_EXCHANGE: '1',
      GITHUB_OAUTH_CLIENT_ID: CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET: 'stub-github-client-secret' }),
    boot(BARE_STORE, { CW_OAUTH_LIVE_EXCHANGE: '1', GITHUB_OAUTH_CLIENT_ID: '', GITHUB_OAUTH_CLIENT_SECRET: '' }),
  ]);
});

after(() => {
  for (const s of [live, bare]) if (s && s.child) s.child.kill('SIGKILL');
  if (stub) stub.close();
  rmSync(TMP, { recursive: true, force: true });
});

describe('link mode on a configured box', () => {
  test('refuses without a session — a link is recorded on the account that asked for it', async () => {
    const r = await hit(live, '/auth/github/link');
    assert.equal(r.status, 401);
    assert.equal(r.headers.location, undefined);
  });

  test('asks GitHub for read:user and nothing else, with PKCE, back to the shared callback', async () => {
    const { url } = await startLink(await signIn(live));
    assert.equal(url.pathname, '/login/oauth/authorize');
    assert.equal(url.searchParams.get('scope'), 'read:user', 'link mode must not reuse the sign-in scope (finding 0075)');
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.equal(new URL(url.searchParams.get('redirect_uri')).pathname, '/auth/callback/github');
  });

  test('a state minted for session A is refused for session B, before any exchange', async () => {
    const a = await signIn(live);
    const b = await signIn(live);   // same account, other session: the binding is to the SESSION
    const { state } = await startLink(a);
    const exchanges = seen.token.length;
    const r = await callback(state, b);
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/profile/?github=session');
    noSessionMinted(r);
    assert.equal(seen.token.length, exchanges, 'the code was exchanged for a session that did not start the flow');
    assert.equal(linked(), null);
    // and the refusal spent it, so the rightful session cannot be handed a state someone else tried
    const retry = await callback(state, a);
    assert.equal(retry.status, 400);
    assert.equal(linked(), null);
  });

  test('a link state cannot complete a sign-in', async () => {
    const { state } = await startLink(await signIn(live));
    const exchanges = seen.token.length;
    const r = await callback(state, null);   // no session: exactly what a sign-in callback carries
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/profile/?github=session');
    noSessionMinted(r);
    assert.equal(seen.token.length, exchanges);
    assert.equal(linked(), null);
  });

  test('a sign-in state cannot complete a link, even presented with a live session', async () => {
    const a = await signIn(live);
    const s = await hit(live, '/auth/login/github');
    assert.equal(s.status, 302, s.body);
    const state = new URL(String(s.headers.location)).searchParams.get('state');
    const r = await callback(state, a);
    assert.notEqual(r.headers.location, '/profile/?github=linked');
    assert.equal(linked(), null, 'a sign-in flow recorded a GitHub link');
  });

  let linkedCookie;
  test('links the account GitHub reports, mints no session, and the state is single-use', async () => {
    linkedCookie = await signIn(live);
    const { url, state } = await startLink(linkedCookie);
    const r = await callback(state, linkedCookie);
    assert.equal(r.status, 302, r.body);
    assert.equal(r.headers.location, '/profile/?github=linked');
    noSessionMinted(r);
    const gh = linked();
    assert.equal(gh && gh.login, 'octo-link');
    assert.equal(gh && gh.id, 4242);

    // the verifier sent with the code is the one whose challenge went to GitHub with this state
    const sent = seen.token.at(-1);
    assert.equal(sent.get('code'), 'stub-code');
    assert.equal(createHash('sha256').update(sent.get('code_verifier')).digest('base64url'),
      url.searchParams.get('code_challenge'));
    assert.equal(seen.user.at(-1), `Bearer ${TOKEN}`);

    const exchanges = seen.token.length;
    const replay = await callback(state, linkedCookie);
    assert.equal(replay.status, 400, 'a state that survives its own use is replayable');
    assert.equal(seen.token.length, exchanges);

    const me = await hit(live, '/api/me', { headers: { cookie: linkedCookie } });
    assert.deepEqual(me.json.github, { login: 'octo-link' });
  });

  test('the access token is never persisted — stores, session or log', async () => {
    assert.ok(linked(), 'precondition: a link completed, so GitHub issued a token');
    assert.deepEqual(filesContaining(TMP, TOKEN), [], 'the access token was written to disk');
    assert.ok(!live.log.join('').includes(TOKEN), 'the access token reached the panel log');
    // the in-memory session: this route says whether the session carries a provider token
    const p = await hit(live, '/admin/github/projects', { headers: { cookie: linkedCookie } });
    assert.equal(p.status, 200, p.body);
    assert.match(p.json.note, /no token/, 'the linking session was handed the access token');
  });

  test('declining on GitHub returns to the profile page and spends the state', async () => {
    const a = await signIn(live);
    const { state } = await startLink(a);
    const r = await hit(live, `/auth/callback/github?error=access_denied&state=${encodeURIComponent(state)}`,
      { headers: { cookie: a } });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, '/profile/?github=denied');
    assert.equal((await callback(state, a)).status, 400);
  });

  test('/api/me says linking is available', async () => {
    const me = await hit(live, '/api/me', { headers: { cookie: await signIn(live) } });
    assert.deepEqual(me.json.githubLink, { available: true, reason: null });
  });

  // The stub always reports id 4242, which the test above linked to EMAIL.
  test('a GitHub account already linked to another user is refused with `taken`', async () => {
    assert.equal(linked()?.id, 4242, 'precondition: EMAIL holds the link');
    const other = await signIn(live, OTHER);
    const { state } = await startLink(other);
    const r = await callback(state, other);
    assert.equal(r.status, 302, r.body);
    assert.equal(r.headers.location, '/profile/?github=taken');
    noSessionMinted(r);
    assert.equal(linked(OTHER), null, 'one GitHub account was linked to two panel users');
    assert.equal(linked()?.id, 4242, 'the refusal disturbed the existing link');
  });

  test('the typed form refuses the same id with 409, and the holder may re-link its own', async () => {
    const post = async (cookie, body) => hit(live, '/api/me/github',
      { method: 'POST', headers: { cookie, 'x-cw-csrf': live.csrf }, body: JSON.stringify(body) });
    const r = await post(await signIn(live, OTHER), { login: 'octo-link', id: 4242 });
    assert.equal(r.status, 409, r.body);
    assert.match(r.json.error, /already linked to another panel user/);
    assert.equal(linked(OTHER), null);
    const own = await post(await signIn(live), { login: 'octo-link', id: 4242 });
    assert.equal(own.status, 200, own.body);
    assert.equal(linked()?.id, 4242);
  });
});

describe('link mode on a box with no GitHub credentials', () => {
  test('/auth/github/link answers 503 with the reason, never a redirect', async () => {
    const r = await hit(bare, '/auth/github/link', { headers: { cookie: await signIn(bare) } });
    assert.equal(r.status, 503, r.body);
    assert.equal(r.json && r.json.error, UNCONFIGURED);
    assert.equal(r.headers.location, undefined);
  });

  test('/api/me carries the same reason for the disabled button', async () => {
    const me = await hit(bare, '/api/me', { headers: { cookie: await signIn(bare) } });
    assert.deepEqual(me.json.githubLink, { available: false, reason: UNCONFIGURED });
  });
});

describe('githubLinkBlocked, lifted from auth-session.mjs', () => {
  const src = readFileSync(AUTH_SESSION, 'utf8');
  const at = src.indexOf('function githubLinkBlocked()');
  const fn = src.slice(at, src.indexOf('\n}\n', at) + 2);
  const make = (github) => new Function('OAUTH', `${fn}; return githubLinkBlocked;`)({
    github: { idEnv: 'GITHUB_OAUTH_CLIENT_ID', secretEnv: 'GITHUB_OAUTH_CLIENT_SECRET', ...github } });
  const withLive = (v, f) => {
    const prev = process.env.CW_OAUTH_LIVE_EXCHANGE;
    if (v === null) delete process.env.CW_OAUTH_LIVE_EXCHANGE; else process.env.CW_OAUTH_LIVE_EXCHANGE = v;
    try { return f(); } finally {
      if (prev === undefined) delete process.env.CW_OAUTH_LIVE_EXCHANGE; else process.env.CW_OAUTH_LIVE_EXCHANGE = prev;
    }
  };

  test('names the missing half of the credentials', () => withLive('1', () => {
    assert.equal(make({ clientId: '', clientSecret: '' })(), UNCONFIGURED);
    assert.equal(make({ clientId: 'x', clientSecret: '' })(),
      'GitHub sign-in is not configured on this box (GITHUB_OAUTH_CLIENT_SECRET)');
  }));

  test('configured but not live is still blocked, read at call time', () => {
    const blocked = make({ clientId: 'x', clientSecret: 'y' });
    withLive(null, () => assert.match(blocked(), /CW_OAUTH_LIVE_EXCHANGE=1/));
    withLive('1', () => assert.equal(blocked(), null));
  });
});
