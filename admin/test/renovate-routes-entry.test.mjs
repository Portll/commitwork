// admin/routes/renovate.mjs — the paste-ingest and its three clear spellings, invoked as handlers.
//
// renovate-paste.test.mjs tests the parser; nothing invoked the routes. These drive the real handler
// with a real request stream and read the store it writes. Every path is a temp fixture: the registry
// (CW_REGISTRY) declares one area whose reportsRoot is under TMP, and HOME is moved so a stray ~ read
// lands nowhere real. The panel's CSRF and login gates sit in serve.mjs above the dispatcher and are
// not reachable from a handler harness; route-auth-live.test.mjs boots the server for those.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const TMP = mkdtempSync(join(tmpdir(), 'cw-renovate-entry-'));
const REPORTS = join(TMP, 'reports');
mkdirSync(join(TMP, 'src'), { recursive: true });
mkdirSync(join(REPORTS, 'fixarea'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' },
    { name: 'freshrepo', area: 'fresharea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  // fresharea is declared but never swept, so reports/fresharea does not exist.
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] },
    { slug: 'fresharea', label: 'Fresh Area', out: 'fresharea', members: ['freshrepo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.HOME = TMP;

// Dynamic, after the env is set: monitor/project-scope.mjs reads the registry at module load.
const core = await import('../lib/core.mjs');
const { initJobs } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const { routes } = await import('../routes/renovate.mjs');
const { RENOVATE_PASTE_CAP } = await import('../lib/renovate-paste.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const STORE = join(REPORTS, 'fixarea', 'renovate-manual.json');
const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const onDisk = () => JSON.parse(readFileSync(STORE, 'utf8'));

/** Drive a handler with a real readable request; resolves with what it sent. */
function call(method, path, { body = null, query = 'project=fixarea' } = {}) {
  const r = route(method, path);
  assert.ok(r, `${method} ${path} is not a registered route`);
  return new Promise((resolve, reject) => {
    const req = Readable.from(body === null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]);
    req.url = `${path}${query ? `?${query}` : ''}`;
    const timer = setTimeout(() => reject(new Error(`${method} ${path} never answered`)), 5000);
    r.handle({ req, send: (status, payload) => { clearTimeout(timer); resolve({ status, body: payload }); } });
  });
}

const DASHBOARD = [
  '## Rate-Limited',
  '- [ ] chore(deps): update dependency lodash to 4.17.21',
  '## Open',
  '- [ ] [chore(deps): update dependency axios to 1.7.2](../pull/412)',
].join('\n');

describe('POST /api/renovate/paste', () => {
  test('a dashboard paste is parsed and written to the area store, with per-state counts', async () => {
    const res = await call('POST', '/api/renovate/paste', { body: DASHBOARD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.entries, 2);
    assert.deepEqual(res.body.states, { 'rate-limited': 1, open: 1 });
    const doc = onDisk();
    assert.equal(doc.source, 'paste');
    assert.equal(doc.pastedAt, res.body.pastedAt, 'the response names the paste it wrote');
    assert.deepEqual(doc.entries.map((e) => e.packages[0]).sort(), ['axios', 'lodash']);
    assert.equal(doc.entries.find((e) => e.packages[0] === 'axios').prNumber, 412);
  });

  test('an empty body is refused with a 400 and the store is left as it was', async () => {
    await call('POST', '/api/renovate/paste', { body: DASHBOARD });
    const before = readFileSync(STORE, 'utf8');
    const res = await call('POST', '/api/renovate/paste', { body: null });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /empty body/);
    assert.equal(readFileSync(STORE, 'utf8'), before);
  });

  test('a body carrying a NUL byte is not text and is refused', async () => {
    const res = await call('POST', '/api/renovate/paste', { body: Buffer.from([0x63, 0x00, 0x64]) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /NUL bytes/);
  });

  test('a body dense with control characters is refused before parsing', async () => {
    const res = await call('POST', '/api/renovate/paste', { body: Buffer.alloc(100, 0x01) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /too many control characters/);
  });

  test('text with no Renovate entry in it is a 400 naming what was expected, not an empty success', async () => {
    const res = await call('POST', '/api/renovate/paste', { body: 'hello, this is not a dashboard' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no Renovate update entries recognized/);
  });

  test('a body over the 256KB cap is a 413 and nothing is written', async () => {
    rmSync(STORE, { force: true });
    const res = await call('POST', '/api/renovate/paste', { body: Buffer.alloc(RENOVATE_PASTE_CAP + 1, 0x61) });
    assert.equal(res.status, 413);
    assert.match(res.body.error, /body too large/);
    assert.equal(existsSync(STORE), false);
  });

  test('there is no GET on the paste path; the dispatcher matches method and path together', () => {
    assert.equal(route('GET', '/api/renovate/paste'), undefined);
    assert.deepEqual(routes.filter((r) => r.path === '/api/renovate/paste').map((r) => r.method).sort(), ['DELETE', 'POST']);
  });
});

describe('the clear: POST /api/renovate/paste/clear, DELETE /api/renovate/paste, DELETE /api/renovate/paste/clear', () => {
  for (const [method, path] of [['POST', '/api/renovate/paste/clear'], ['DELETE', '/api/renovate/paste'], ['DELETE', '/api/renovate/paste/clear']]) {
    test(`${method} ${path} overwrites a pasted store with the empty cleared stub and reports that it existed`, async () => {
      await call('POST', '/api/renovate/paste', { body: DASHBOARD });
      assert.equal(onDisk().entries.length, 2);
      const res = await call(method, path);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body, { ok: true, cleared: true });
      const doc = onDisk();
      assert.deepEqual(doc.entries, [], 'cleared means no entries, never a deleted file');
      assert.equal(doc.pastedAt, null);
      assert.match(doc.clearedAt, /^\d{4}-\d{2}-\d{2}T/);
    });
  }

  test('clearing a store that never existed says cleared:false, and still writes the stub', async () => {
    rmSync(STORE, { force: true });
    const res = await call('DELETE', '/api/renovate/paste');
    assert.equal(res.status, 200);
    assert.equal(res.body.cleared, false);
    assert.deepEqual(onDisk().entries, []);
  });

  test('the project is selected by label as well as by slug', async () => {
    await call('POST', '/api/renovate/paste', { body: DASHBOARD });
    const res = await call('POST', '/api/renovate/paste/clear', { query: `project=${encodeURIComponent('Fix Area')}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.cleared, true);
    assert.deepEqual(onDisk().entries, []);
  });
});

// The store is per project, so a request that names none, or names one the registry does not know,
// has no store. The fallback used to build a path under the checkout's reports/__unresolved__ and
// answer the failed write as a 500 "write failed: ENOENT", a server fault for a client error.
describe('a missing or unknown ?project= is refused with a 400 before any store path is built', () => {
  const CASES = [['no project', ''], ['an empty project', 'project='], ['an unknown project', 'project=nosuch']];
  const ATTEMPTS = [['POST', '/api/renovate/paste', DASHBOARD], ['POST', '/api/renovate/paste/clear', null],
    ['DELETE', '/api/renovate/paste', null], ['DELETE', '/api/renovate/paste/clear', null]];
  for (const [what, query] of CASES) {
    test(`${what}: every paste and clear spelling answers 400 naming the project, and the area store is untouched`, async () => {
      await call('POST', '/api/renovate/paste', { body: DASHBOARD });
      const before = readFileSync(STORE, 'utf8');
      for (const [method, path, body] of ATTEMPTS) {
        const res = await call(method, path, { body, query });
        assert.equal(res.status, 400, `${method} ${path} ?${query}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.ok, false);
        assert.match(res.body.error, /project/);
        assert.doesNotMatch(res.body.error, /write failed|ENOENT|__unresolved__/, 'refused before a path was built');
      }
      assert.equal(readFileSync(STORE, 'utf8'), before);
    });
  }
});

test('a paste and a clear for a declared area no sweep has reached create its report directory', async () => {
  const store = join(REPORTS, 'fresharea', 'renovate-manual.json');
  assert.equal(existsSync(join(REPORTS, 'fresharea')), false);
  const paste = await call('POST', '/api/renovate/paste', { body: DASHBOARD, query: 'project=fresharea' });
  assert.equal(paste.status, 200, JSON.stringify(paste.body));
  assert.equal(JSON.parse(readFileSync(store, 'utf8')).entries.length, 2);
  rmSync(join(REPORTS, 'fresharea'), { recursive: true });
  const clear = await call('POST', '/api/renovate/paste/clear', { query: 'project=fresharea' });
  assert.equal(clear.status, 200, JSON.stringify(clear.body));
  assert.deepEqual(JSON.parse(readFileSync(store, 'utf8')).entries, []);
});
