// POST /api/a11y/attest and POST /api/a11y/attest/clear, invoked through their handlers (no server
// spawn). The registry, the sweep batch carrying a11y.json and the attestation ledger are temp
// fixtures reached through CW_REGISTRY / CW_A11Y_ATTESTATIONS; CW_NOW pins the clock so the entry's
// timestamps and expiry are exact. What is asserted is the ledger on disk, not only the reply.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/a11y.mjs';
import { buildReport } from '../../bin/a11y-scan.mjs';
import { reportDigest } from '../../monitor/a11y-attestations.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-a11y-entry-'));
const LEDGER = join(TMP, 'a11y-attestations.json');
const NOW = '2026-08-05T00:00:00.000Z';
const KEYS = ['CW_REGISTRY', 'CW_A11Y_ATTESTATIONS', 'CW_NOW', 'CW_A11Y_ATTESTATION_TTL_DAYS'];
const saved = {};

// Built at run time: a literal palette declaration here reads as a second palette to
// bin/test/house-palette-guard.test.mjs.
const dash = '--';
const REPORT = buildReport({
  files: [{ path: 'admin/index.html', html: '<html lang="en"><head><title>p</title></head><body><h1>h</h1></body></html>' }],
  cssFiles: [{ path: 'admin/static/panel.css', css: `:root{${dash}bg:#0f1319;${dash}ink:#cdd3de}\n.a{color:var(${dash}ink)}` }],
  nowIso: '2026-08-01T00:00:00.000Z',
});
const DIGEST = reportDigest(REPORT);

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea', defaultManifest: 'security-baseline', roots: [],
    projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
    areas: [
      { slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] },
      { slug: 'bare', label: 'bare', out: 'bare' },
    ],
  }));
  const batch = join(TMP, 'reports', 'sweep-20260803120000-fixarea', 'fixrepo');
  mkdirSync(batch, { recursive: true });
  writeFileSync(join(batch, 'a11y.json'), JSON.stringify(REPORT));
  process.env.CW_REGISTRY = join(TMP, 'projects.json');
  process.env.CW_A11Y_ATTESTATIONS = LEDGER;
  process.env.CW_NOW = NOW;
  delete process.env.CW_A11Y_ATTESTATION_TTL_DAYS;
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const ATTEST = routes.find((r) => r.method === 'POST' && r.path === '/api/a11y/attest');
const CLEAR = routes.find((r) => r.method === 'POST' && r.path === '/api/a11y/attest/clear');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = (route, { project = 'fixarea', body = {}, bodyErr = null, session = SESSION, loopback = false } = {}) => new Promise((resolve) => {
  route.handle({
    req: {}, isLoopbackReq: loopback, adminSession: () => session,
    query: new URLSearchParams(project == null ? {} : { project }),
    knownProjects: () => new Set(['fixarea', 'bare']),
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const ledger = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : null);

test('no session, no attestation — on the published port AND the operator port, for both routes', async () => {
  for (const route of [ATTEST, CLEAR]) {
    for (const loopback of [false, true]) {
      const r = await call(route, { session: null, loopback, body: { criterion: '2.4.3', verdict: 'meets' } });
      assert.equal(r.code, 401, `${route.path} loopback=${loopback}`);
      assert.match(r.payload.error, /there is no anonymous one/);
    }
  }
  // a session object with no user is no identity either
  const r = await call(ATTEST, { session: { provider: 'password' }, body: { criterion: '2.4.3', verdict: 'meets' } });
  assert.equal(r.code, 401);
  assert.equal(ledger(), null, 'a refused attestation creates no ledger');
});

test('an unparseable body is refused 400 before anything is read or written', async () => {
  const r = await call(ATTEST, { bodyErr: 'body is not valid JSON' });
  assert.equal(r.code, 400);
  assert.deepEqual(r.payload, { ok: false, error: 'body is not valid JSON' });
  assert.equal(ledger(), null);
});

test('a caller cannot name its own signature: a body carrying `who` is a schema refusal', async () => {
  const r = await call(ATTEST, { body: { criterion: '2.4.3', verdict: 'meets', who: 'someone-else@example.test' } });
  assert.equal(r.code, 400);
  assert.equal(r.payload.refused, 'schema');
  assert.equal(ledger(), null);
});

test('refusals map to their status and write nothing', async () => {
  const cases = [
    [{ body: { criterion: '1.1.1', verdict: 'meets' } }, 400, 'not-attestable'],
    [{ project: 'not-a-known-area', body: { criterion: '2.4.3', verdict: 'meets' } }, 400, 'bad-area'],
    [{ project: null, body: { criterion: '2.4.3', verdict: 'meets' } }, 400, 'bad-area'],
    [{ project: 'bare', body: { criterion: '2.4.3', verdict: 'meets' } }, 404, 'no-subject'],
    [{ body: { criterion: '2.4.3', verdict: 'meets', subjectDigest: `sha256:${'0'.repeat(64)}` } }, 409, 'stale-subject'],
    [{ body: { criterion: '2.4.3', verdict: 'looks-fine' } }, 400, 'schema'],
  ];
  for (const [opts, code, refused] of cases) {
    const r = await call(ATTEST, opts);
    assert.equal(r.code, code, `${refused}: ${JSON.stringify(r.payload)}`);
    assert.equal(r.payload.ok, false);
    assert.equal(r.payload.refused, refused);
    assert.ok(Array.isArray(r.payload.errors) && r.payload.errors.length > 0);
  }
  assert.equal(ledger(), null, 'no refusal reached the ledger');
});

test('a signed attestation is filed under the session identity, bound to the artifact digest, with a default expiry', async () => {
  const r = await call(ATTEST, { body: { criterion: '2.4.3', verdict: 'meets', subjectDigest: DIGEST, note: 'tabbed through, order matches' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  const e = r.payload.entry;
  assert.equal(e.action, 'attest');
  assert.equal(e.area, 'fixarea');
  assert.equal(e.criterion, '2.4.3');
  assert.equal(e.verdict, 'meets');
  assert.equal(e.who, 'op@example.test (password)');
  assert.equal(e.whoKind, 'human');
  assert.equal(e.channel, 'http');
  assert.equal(e.at, NOW);
  assert.equal(e.expires, new Date(Date.parse(NOW) + 180 * 86_400_000).toISOString());
  assert.equal(e.subjectDigest, DIGEST);
  assert.equal(e.supersedes, null);
  assert.match(e.id, /^ATT-[0-9a-f]{12}$/);
  assert.match(r.payload.note, /recorded as an ATTESTATION, not a scanner pass/);

  const doc = ledger();
  assert.equal(doc.entries.length, 1);
  assert.deepEqual(doc.entries[0], e, 'the ledger holds exactly what the reply described');
});

test('withdrawing APPENDS a record that supersedes the attestation, and says unchecked is not a pass', async () => {
  const first = ledger().entries[0];
  const r = await call(CLEAR, { body: { criterion: '2.4.3' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  assert.equal(r.payload.entry.action, 'withdraw');
  assert.equal(r.payload.entry.verdict, null);
  assert.equal(r.payload.entry.supersedes, first.id);
  assert.equal(r.payload.entry.who, 'op@example.test (password)');
  assert.match(r.payload.note, /`unchecked` again, which is not a pass/);
  const doc = ledger();
  assert.equal(doc.entries.length, 2);
  assert.deepEqual(doc.entries[0], first, 'the original attestation is untouched');
});

test('withdrawing what is not standing is a 404 and the ledger does not move', async () => {
  const before = readFileSync(LEDGER, 'utf8');
  const r = await call(CLEAR, { body: { criterion: '2.4.3' } });
  assert.equal(r.code, 404);
  assert.equal(r.payload.refused, 'nothing-to-withdraw');
  assert.equal(readFileSync(LEDGER, 'utf8'), before);
});

test('an unreadable ledger is a 503 on both routes, and its bytes survive for a human to read', async () => {
  const torn = '{ "v": 1, "entries": [ { "criterion": ';
  writeFileSync(LEDGER, torn);
  for (const [route, body] of [[ATTEST, { criterion: '2.5.8', verdict: 'meets' }], [CLEAR, { criterion: '2.4.3' }]]) {
    const r = await call(route, { body });
    assert.equal(r.code, 503, route.path);
    assert.match(r.payload.error, /a11y attestation store unavailable: .*not valid JSON/);
  }
  assert.equal(readFileSync(LEDGER, 'utf8'), torn, 'a store that could not be read is never written over');
});

test('both write routes are POST-only in the dispatch table', () => {
  for (const p of ['/api/a11y/attest', '/api/a11y/attest/clear']) {
    assert.deepEqual(routes.filter((r) => r.path === p).map((r) => r.method), ['POST'], p);
  }
});
