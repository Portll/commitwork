// node --test admin/test/ — the panel's integrations routes: GET /api/integrations,
// POST /api/integrations and POST /api/integrations/remove, driven through their handlers against a
// temporary store. The module has its own tests (integrations.test.mjs); these hold the routes to it:
// a key goes in whole and comes back redacted, and a refusal writes nothing. The VulnCheck refresh
// route runs against a stubbed fetch, so no request leaves the machine.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY_VARS = ['CW_VULNCHECK_KEY', 'CW_SONATYPE_KEY', 'CW_SNYK_KEY'];
let DIR, STORE, CACHE, saved;
beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), 'cw-integrations-route-'));
  STORE = join(DIR, 'integrations.json');
  CACHE = join(DIR, 'vulncheck-kev-cache.json');
  saved = Object.fromEntries(['CW_INTEGRATIONS_STORE', 'CW_VULNCHECK_KEV_CACHE', ...KEY_VARS].map((k) => [k, process.env[k]]));
  process.env.CW_INTEGRATIONS_STORE = STORE;
  process.env.CW_VULNCHECK_KEV_CACHE = CACHE;
  for (const k of KEY_VARS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(DIR, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const { routes } = await import('../routes/settings.mjs');
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path} is not registered`);
  const seen = [];
  await r.handle({
    req: {}, isLoopbackReq: true, adminSession: () => null,
    send: (code, payload) => seen.push({ code, payload }),
    readJsonBody: (_req, cb) => cb(body, null),
  });
  return seen[0];
};
// One stubbed VulnCheck page, recording what was asked of it.
function stubVulncheck(t, { status = 200, data = [] } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.authorization });
    return new Response(JSON.stringify(status === 200 ? { data, _meta: { total_pages: 1 } } : { error: true, errors: ['unauthorized'] }), { status });
  };
  t.after(() => { globalThis.fetch = real; });
  return calls;
}
const byName = (sources) => Object.fromEntries(sources.map((s) => [s.name, s]));
const KEY = 'vc-test-0000-0000-0000-abcd';

test('GET /api/integrations lists every declared source, and none holds a key in an empty store', async () => {
  const { code, payload } = await call('GET', '/api/integrations');
  assert.equal(code, 200);
  assert.deepEqual(payload.sources.map((s) => s.name).sort(), ['snyk', 'sonatype', 'vulncheck']);
  for (const s of payload.sources) {
    assert.equal(s.source, 'none', `${s.name} reads as configured in an empty store`);
    assert.equal(s.key, null);
  }
});

test('POST /api/integrations stores the key whole and returns it redacted', async () => {
  const { code, payload } = await call('POST', '/api/integrations', { name: 'vulncheck', key: KEY });
  assert.equal(code, 200, JSON.stringify(payload));
  const vc = byName(payload.sources).vulncheck;
  assert.equal(vc.source, 'stored');
  assert.notEqual(vc.key, KEY, 'the full key went back to the browser');
  assert.ok(vc.key.endsWith('abcd'), `redaction kept no recognisable tail: ${vc.key}`);
  assert.equal(JSON.parse(readFileSync(STORE, 'utf8')).sources.vulncheck.key, KEY);
  assert.equal(JSON.stringify(payload).includes(KEY), false);
});

test('POST /api/integrations refuses an unknown source and an empty key, and writes nothing', async () => {
  const unknown = await call('POST', '/api/integrations', { name: 'acme', key: KEY });
  assert.equal(unknown.code, 400);
  assert.match(unknown.payload.error, /unknown source 'acme'/);
  const empty = await call('POST', '/api/integrations', { name: 'snyk', key: '   ' });
  assert.equal(empty.code, 400);
  assert.match(empty.payload.error, /must not be empty/);
  assert.equal(existsSync(STORE), false, 'a refused write created the store');
});

test('POST /api/integrations/remove deletes a stored key and says whether there was one', async () => {
  await call('POST', '/api/integrations', { name: 'sonatype', key: KEY });
  const first = await call('POST', '/api/integrations/remove', { name: 'sonatype' });
  assert.equal(first.code, 200);
  assert.equal(first.payload.removed, true);
  assert.equal(byName(first.payload.sources).sonatype.source, 'none');
  const again = await call('POST', '/api/integrations/remove', { name: 'sonatype' });
  assert.equal(again.payload.removed, false, 'removing nothing reported a removal');
  const unknown = await call('POST', '/api/integrations/remove', { name: 'acme' });
  assert.equal(unknown.code, 400);
});

test('an environment key outranks the stored one and is reported as coming from the environment', async () => {
  await call('POST', '/api/integrations', { name: 'vulncheck', key: KEY });
  process.env.CW_VULNCHECK_KEY = 'vc-env-key-0000-wxyz';
  const { payload } = await call('GET', '/api/integrations');
  const vc = byName(payload.sources).vulncheck;
  assert.equal(vc.source, 'env');
  assert.equal(vc.envVar, 'CW_VULNCHECK_KEY');
  assert.ok(vc.key.endsWith('wxyz'));
});

test('GET /api/integrations reports the KEV cache: absent, its size, or unreadable', async () => {
  assert.equal((await call('GET', '/api/integrations')).payload.kevCache, null);
  writeFileSync(CACHE, JSON.stringify({ fetchedAt: '2026-10-01T00:00:00.000Z', entries: [{ cve: ['CVE-2024-0001'] }] }));
  assert.deepEqual((await call('GET', '/api/integrations')).payload.kevCache, { fetchedAt: '2026-10-01T00:00:00.000Z', entries: 1 });
  writeFileSync(CACHE, '{"entries": 3}');
  assert.match((await call('GET', '/api/integrations')).payload.kevCache.error, /malformed/);
});

test('POST /api/integrations/vulncheck/refresh with no key refuses and fetches nothing', async (t) => {
  const calls = stubVulncheck(t);
  const r = await call('POST', '/api/integrations/vulncheck/refresh');
  assert.equal(r.code, 400);
  assert.equal(r.payload.state, 'no-key');
  assert.equal(calls.length, 0);
  assert.equal(existsSync(CACHE), false);
});

test('POST /api/integrations/vulncheck/refresh uses the stored key and writes the cache the rollup reads', async (t) => {
  await call('POST', '/api/integrations', { name: 'vulncheck', key: KEY });
  const calls = stubVulncheck(t, { data: [{ cve: ['CVE-2024-0001'], date_added: '2026-01-02' }, { cve: ['CVE-2024-0002'] }] });
  const r = await call('POST', '/api/integrations/vulncheck/refresh');
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.entries, 2);
  assert.equal(calls[0].auth, `Bearer ${KEY}`, 'the stored key was not the one sent');
  assert.match(calls[0].url, /^https:\/\/api\.vulncheck\.com\//);
  assert.equal(JSON.parse(readFileSync(CACHE, 'utf8')).entries.length, 2);
  assert.equal(r.payload.kevCache.entries, 2);
  assert.equal(JSON.stringify(r.payload).includes(KEY), false);
});

test('a rejected key is a 502 naming the refusal, and the existing cache is left as it was', async (t) => {
  await call('POST', '/api/integrations', { name: 'vulncheck', key: KEY });
  writeFileSync(CACHE, JSON.stringify({ fetchedAt: '2026-09-01T00:00:00.000Z', entries: [] }));
  stubVulncheck(t, { status: 401 });
  const r = await call('POST', '/api/integrations/vulncheck/refresh');
  assert.equal(r.code, 502);
  assert.equal(r.payload.state, 'auth-failed');
  assert.equal(JSON.parse(readFileSync(CACHE, 'utf8')).fetchedAt, '2026-09-01T00:00:00.000Z');
});
