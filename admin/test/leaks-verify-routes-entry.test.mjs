// POST /api/leaks/verify through its handler. leaks-verify.test.mjs exercises the verifiers as
// functions; this drives the route: session gate, body validation, repo resolution through the
// registry (CW_REGISTRY), path containment, the annotation lookup (CW_ANNOTATIONS) that supplies the
// reason when the caller does not, and the claim the route returns for each verifier — without the
// matched value ever leaving the process.
//
// No network, and no git history: the fixture repository is a plain directory, so the `rolled`
// witness has to report that it could not ask, which is the case asserted for it. GIT_DIR and
// friends are cleared and GIT_CEILING_DIRECTORIES is set so `git rev-parse` cannot wander into an
// enclosing repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { routes } from '../routes/leaks-verify.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-leaks-verify-entry-'));
const REPO = join(TMP, 'repos', 'fixapp');
const ANN = join(TMP, 'annotations.json');
const NOW = '2026-06-01T00:00:00.000Z';
const KEYS = ['CW_REGISTRY', 'CW_ANNOTATIONS', 'CW_NOW', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES'];
const saved = {};

// credential-shaped values, built at run time
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${b64u(payload)}.${randomBytes(12).toString('hex')}`;
const EXPIRED = jwt({ sub: 'svc-fixture', exp: Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) });
const LIVE = jwt({ sub: 'svc-fixture', exp: Math.floor(Date.parse('2027-01-01T00:00:00Z') / 1000) });
const AWS_DOC_KEY = ['wJalrXUtnFEMI', 'K7MDENG', 'bPxRfiCYEXAMPLEKEY'].join('/');
const OPAQUE = `cwfx${randomBytes(16).toString('hex')}`;
const VALUES = [EXPIRED, LIVE, AWS_DOC_KEY, OPAQUE];

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[k];
  process.env.GIT_CEILING_DIRECTORIES = dirname(TMP);
  mkdirSync(join(REPO, 'src'), { recursive: true });
  mkdirSync(join(REPO, 'test', 'fixtures'), { recursive: true });
  writeFileSync(join(REPO, 'src', 'config.js'), `// config\nconst token = "${EXPIRED}";\nconst live = "${LIVE}";\n`);
  writeFileSync(join(REPO, 'src', 'app.js'), `const key = "${OPAQUE}";\n`);
  writeFileSync(join(REPO, 'test', 'fixtures', 'aws.js'), `export const secret = "${AWS_DOC_KEY}";\n`);
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
    projects: [{ name: 'fixapp', area: 'fixarea', path: REPO, manifest: 'security-baseline' }],
  }));
  writeFileSync(ANN, JSON.stringify({ scannerAnnotations: [
    { category: 'secrets', repo: 'fixapp', rule: 'generic-api-key', file: 'src/config.js', action: 'false-positive',
      reason: 'expired token, no longer valid', at: '2026-02-01T00:00:00.000Z', expires: '2026-12-31T00:00:00.000Z',
      who: 'op@example.test (password)', seenAtLine: 2 },
    // lapsed: must not supply a reason
    { category: 'secrets', repo: 'fixapp', rule: 'generic-api-key', file: 'src/app.js', action: 'false-positive',
      reason: 'rolled last quarter', at: '2026-01-01T00:00:00.000Z', expires: '2026-03-01T00:00:00.000Z',
      who: 'op@example.test (password)', seenAtLine: 1 },
  ] }));
  process.env.CW_REGISTRY = join(TMP, 'projects.json');
  process.env.CW_ANNOTATIONS = ANN;
  process.env.CW_NOW = NOW;
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const route = routes.find((r) => r.method === 'POST' && r.path === '/api/leaks/verify');
const SESSION = { user: 'op@example.test', provider: 'password' };
const call = ({ body = {}, bodyErr = null, session = SESSION } = {}) => new Promise((resolve) => {
  route.handle({
    req: {}, adminSession: () => session,
    readJsonBody: (_r, cb) => cb(bodyErr ? null : body, bodyErr),
    send: (code, payload) => resolve({ code, payload }),
  });
});
const noValue = (payload) => {
  const text = JSON.stringify(payload);
  for (const v of VALUES) {
    assert.ok(!text.includes(v), 'a matched value reached the response');
    for (const part of v.split(/[./]/).filter((x) => x.length >= 12)) assert.ok(!text.includes(part), 'a segment of a matched value reached the response');
  }
};

test('no session, no verification — a user-less session object included', async () => {
  for (const session of [null, { provider: 'password' }]) {
    const r = await call({ session, body: { repo: 'fixapp', file: 'src/config.js', line: 2, reason: 'expired', at: NOW } });
    assert.equal(r.code, 401);
    assert.deepEqual(r.payload, { ok: false, error: 'authentication required' });
  }
});

test('input refusals: unparseable body, missing fields, unknown repo, and a path out of the repo', async () => {
  const bad = await call({ bodyErr: 'body is not valid JSON' });
  assert.equal(bad.code, 400);
  assert.equal(bad.payload.error, 'bad body: body is not valid JSON');

  for (const body of [{}, { repo: 'fixapp' }, { file: 'src/app.js' }]) {
    const r = await call({ body });
    assert.equal(r.code, 400, JSON.stringify(body));
    assert.equal(r.payload.error, 'repo and file are required');
  }

  const nope = await call({ body: { repo: 'no-such-repo', file: 'src/app.js' } });
  assert.equal(nope.code, 404);
  assert.equal(nope.payload.error, "no resolved repo named 'no-such-repo'");

  for (const file of ['../../projects.json', join(TMP, 'projects.json')]) {
    const r = await call({ body: { repo: 'fixapp', file, line: 1, reason: 'test fixture', at: NOW } });
    assert.equal(r.code, 400, file);
    assert.equal(r.payload.error, 'file escapes its repository root');
  }
});

test('with no stated reason and no ACTIVE annotation for the row, there is nothing to verify', async () => {
  for (const body of [
    { repo: 'fixapp', rule: 'generic-api-key', file: 'src/other.js' },       // no annotation at all
    { repo: 'fixapp', rule: 'generic-api-key', file: 'src/app.js' },         // annotation lapsed before CW_NOW
    { repo: 'fixapp', rule: 'a-different-rule', file: 'src/config.js' },     // identity is (repo, rule, file)
  ]) {
    const r = await call({ body });
    assert.equal(r.code, 404, JSON.stringify(body));
    assert.match(r.payload.error, /no active false-positive annotation addresses this row/);
  }
});

test('the reason and line come from the active annotation when the caller sends none — expired, and corroborated', async () => {
  const r = await call({ body: { repo: 'fixapp', rule: 'generic-api-key', file: 'src/config.js' } });
  assert.equal(r.code, 200, JSON.stringify(r.payload));
  const p = r.payload;
  assert.equal(p.ok, true);
  assert.equal(p.reasonClass, 'expired');
  assert.equal(p.reason, 'expired token, no longer valid');
  assert.equal(p.seenAtLine, 2, 'the annotation\'s line is evidence, read from the record');
  assert.equal(p.status, 'corroborated');
  assert.equal(p.evidence.tier, 'strong');
  assert.match(p.evidence.detail, /^exp 2026-01-01T00:00:00\.000Z is before 2026-06-01T00:00:00\.000Z$/);
  assert.deepEqual(p.annotation, { action: 'false-positive', who: 'op@example.test (password)', at: '2026-02-01T00:00:00.000Z', expires: '2026-12-31T00:00:00.000Z' });
  assert.equal(p.now, NOW);
  assert.equal(p.advisory, true);
  assert.match(p.vocabulary, /^strong\/medium\/weak/);
  noValue(p);
});

test('a token still inside its validity window REFUTES the stated expiry', async () => {
  const r = await call({ body: { repo: 'fixapp', rule: 'generic-api-key', file: 'src/config.js', line: 3, reason: 'it expired', at: NOW } });
  assert.equal(r.code, 200);
  assert.equal(r.payload.status, 'refuted');
  assert.equal(r.payload.evidence.tier, 'strong');
  assert.match(r.payload.evidence.detail, /still within its validity window/);
  assert.equal(r.payload.annotation, null, 'a caller-supplied reason consults no annotation');
  noValue(r.payload);
});

test('a published example value on a fixture path corroborates "test fixture" strongly', async () => {
  const r = await call({ body: { repo: 'fixapp', rule: 'aws-secret', file: 'test/fixtures/aws.js', line: 1, reason: 'test fixture data', at: NOW } });
  assert.equal(r.code, 200);
  assert.equal(r.payload.reasonClass, 'test-fixture');
  assert.equal(r.payload.status, 'corroborated');
  assert.equal(r.payload.evidence.tier, 'strong');
  assert.deepEqual(r.payload.checks.map((c) => [c.name, c.result]), [['test-path', 'pass'], ['published-example', 'pass']]);
  noValue(r.payload);
});

test('"rolled" with no history to read is unverified — never corroborated, never refuted', async () => {
  const r = await call({ body: { repo: 'fixapp', rule: 'generic-api-key', file: 'src/app.js', line: 1, reason: 'key was rotated', at: '2026-01-15T00:00:00.000Z' } });
  assert.equal(r.code, 200);
  assert.equal(r.payload.reasonClass, 'rolled');
  assert.equal(r.payload.status, 'unverified');
  assert.equal(r.payload.evidence.tier, 'weak');
  assert.deepEqual(r.payload.checks.map((c) => [c.name, c.result]), [['trace-token', 'pass'], ['git', 'unavailable']]);
  noValue(r.payload);
});

test('a reason that names no checkable claim, or a value that cannot be read, is unverified', async () => {
  const vague = await call({ body: { repo: 'fixapp', file: 'src/app.js', line: 1, reason: 'looks fine to me', at: NOW } });
  assert.equal(vague.code, 200);
  assert.equal(vague.payload.reasonClass, 'unrecognised');
  assert.equal(vague.payload.status, 'unverified');
  assert.deepEqual(vague.payload.checks, []);

  const gone = await call({ body: { repo: 'fixapp', file: 'src/deleted.js', line: 4, reason: 'expired', at: NOW } });
  assert.equal(gone.code, 200);
  assert.equal(gone.payload.status, 'unverified');
  assert.match(gone.payload.evidence.detail, /could not be read: file no longer present/);
});

test('an unreadable annotation store is a 503, not "no annotation"', async () => {
  writeFileSync(ANN, '{ "scannerAnnotations": [ ');
  const r = await call({ body: { repo: 'fixapp', rule: 'generic-api-key', file: 'src/config.js' } });
  assert.equal(r.code, 503);
  assert.match(r.payload.error, /^annotations store unreadable/);
});

test('the route is POST-only in the dispatch table', () => {
  assert.deepEqual(routes.filter((r) => r.path === '/api/leaks/verify').map((r) => r.method), ['POST']);
});
