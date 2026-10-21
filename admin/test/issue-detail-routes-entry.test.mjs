// admin/routes/issue-detail.mjs — GET /api/issue, GET /api/issue/prompt and POST /api/issues/ingest,
// invoked as handlers over a temp issue store and a temp area.
//
// issue-detail-route.test.mjs boots a panel for the lodging and port boundary; these three entry
// points were never named. The ingest is the same ingestArea() the sweep calls, so it is driven
// through its gates (unknown area, no rollup, stale rollup, not newer) and once through a real mint,
// with the store asserted on disk each time. The prompt reads source from the repository the
// registry declares, which here is a temp directory holding one synthetic file.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-issdetail-entry-'));
const REPO = join(TMP, 'fixrepo');
const REPORTS = join(TMP, 'reports');
const ISSUES = join(TMP, 'issues.json');
const NOW = '2026-10-01T12:00:00.000Z';
const SOURCE_LINE = 'const fixtureSink = runQuery(request.query.term);';
mkdirSync(join(REPO, 'src'), { recursive: true });
writeFileSync(join(REPO, 'src', 'db.js'), `// fixture\n${SOURCE_LINE}\nmodule.exports = {};\n`);
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: REPORTS, defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: REPO, manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
Object.assign(process.env, {
  CW_REGISTRY: join(TMP, 'projects.json'), CW_ISSUES: ISSUES, CW_LEARNING: join(TMP, 'learning.json'),
  CW_ANNOTATIONS: join(TMP, 'annotations.json'), CW_VERDICT_DIR: join(TMP, 'verdicts'),
  CW_REMEDIATION_POLICY: join(TMP, 'absent-policy.json'), CW_HEALTH_RUNS_STORE: join(TMP, 'health-runs.json'),
  CW_NOW: NOW, HOME: TMP,
});
for (const k of ['CW_ISSUE_ORG', 'CW_ISSUE_MIN_SEV']) delete process.env[k];

const core = await import('../lib/core.mjs');
const { initJobs, knownProjects } = await import('../lib/jobs.mjs');
const { primaryArea } = await import('../../monitor/registry.mjs');
const { projectSlug } = await import('../../monitor/project-scope.mjs');
initJobs({ CW: TMP, registry: core.registry, sessionStorePath: () => join(TMP, 'sessions.json'), projectSlug, primaryArea });
const store = await import('../../monitor/issue-store.mjs');
const { routes } = await import('../routes/issue-detail.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const OPERATOR = { user: 'op@example.test', provider: 'local' };

function call(method, path, { query = '', body = {}, readErr = null, session = OPERATOR, loopback = false } = {}) {
  const r = route(method, path);
  assert.ok(r, `${method} ${path} is not a registered route`);
  let out = null;
  r.handle({
    req: {}, query: new URLSearchParams(query), adminSession: () => session, isLoopbackReq: loopback, knownProjects,
    send: (status, payload) => { out = { status, body: payload }; },
    readJsonBody: (_req, cb) => (readErr ? cb(null, readErr) : cb(body, null)),
  });
  assert.ok(out, `${method} ${path} answered nothing`);
  return out;
}

let ID;
const SOURCE_KEY = 'sc:fixrepo|sastCodeql|js/sql-injection|src/db.js';
function seed() {
  const doc = store.emptyIssuesDoc();
  ID = store.mintIssue(doc, {
    area: 'fixarea', repo: 'fixrepo', kind: 'code', severity: 'high', title: 'js/sql-injection [sastCodeql] (fixrepo)',
    body: 'request input reaches a query at src/db.js:2', remediation: 'parameterise the query',
    source: { kind: 'scanner-row', key: SOURCE_KEY, tool: 'sastCodeql', rule: 'js/sql-injection' },
    anchor: { file: 'src/db.js', line: 2, hash: null },
  }, '2026-09-01T00:00:00.000Z').id;
  store.withIssuesLock(() => store.saveIssues(doc, { path: ISSUES }), { path: ISSUES });
}
const onDisk = () => JSON.parse(readFileSync(ISSUES, 'utf8'));

beforeEach(() => { rmSync(REPORTS, { recursive: true, force: true }); seed(); });

describe('GET /api/issue', () => {
  test('no session, no issue', () => {
    const res = call('GET', '/api/issue', { query: `id=${ID}`, session: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.id, undefined);
  });

  test('an unknown id is a 404', () => {
    assert.deepEqual(call('GET', '/api/issue', { query: 'id=ISS-NONE-0' }), { status: 404, body: { ok: false, error: 'no such issue' } });
  });

  test('the lodging surface is whitelisted: rule and tool, never the body, the anchor or the source key', () => {
    const res = call('GET', '/api/issue', { query: `id=${ID}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, ID);
    assert.equal(res.body.area, 'fixarea');
    assert.equal(res.body.rule, 'js/sql-injection');
    assert.equal(res.body.tool, 'sastCodeql');
    assert.equal(res.body.remediation, 'parameterise the query');
    assert.equal(res.body.promptAvailable, false, 'off the operator port the source-bearing half is unavailable');
    const text = JSON.stringify(res.body);
    for (const leak of ['src/db.js', SOURCE_KEY, 'request input reaches']) assert.equal(text.includes(leak), false, `leaked ${leak}`);
    assert.ok(res.body.vocab.fixTypes.length > 0);
    assert.ok(res.body.vocab.rescanLevels.includes('none'));
  });

  test('on the operator port the same view says the prompt is available', () => {
    assert.equal(call('GET', '/api/issue', { query: `id=${ID}`, loopback: true }).body.promptAvailable, true);
  });

  test('a corrupt store is a 503, never "no such issue"', () => {
    writeFileSync(ISSUES, 'not json');
    const res = call('GET', '/api/issue', { query: `id=${ID}` });
    assert.equal(res.status, 503);
    assert.match(res.body.error, /issue store unavailable/);
  });
});

describe('GET /api/issue/prompt', () => {
  test('no session is a 401 even on the operator port', () => {
    assert.equal(call('GET', '/api/issue/prompt', { query: `id=${ID}`, session: null, loopback: true }).status, 401);
  });

  test('off the operator port it is a 403 that names the port and carries no prompt', () => {
    const res = call('GET', '/api/issue/prompt', { query: `id=${ID}` });
    assert.equal(res.status, 403);
    assert.equal(res.body.localOnly, true);
    assert.match(res.body.error, /127\.0\.0\.1:7879/);
    assert.equal(res.body.prompt, undefined);
  });

  test('on the operator port an unknown id is a 404', () => {
    assert.equal(call('GET', '/api/issue/prompt', { query: 'id=ISS-NONE-0', loopback: true }).status, 404);
  });

  test('on the operator port the prompt carries the rule, the location and the anchored source line', () => {
    const res = call('GET', '/api/issue/prompt', { query: `id=${ID}`, loopback: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, ID);
    assert.match(res.body.prompt, /Rule: js\/sql-injection {3}Severity: high {3}Scanner: sastCodeql/);
    assert.match(res.body.prompt, /Location: src\/db\.js:2/);
    assert.ok(res.body.prompt.includes(SOURCE_LINE), 'the source window was not read from the declared repository');
    assert.match(res.body.prompt, /^VERDICT: one of/m);
  });
});

describe('POST /api/issues/ingest', () => {
  const rollup = (over = {}) => ({
    generated: '2026-10-01T11:00:00.000Z', sliceId: 'sweep-20261001110000', scanners: {}, scannerFindings: {},
    repos: [{ name: 'fixrepo', findings: [{ key: 'osv|fixrepo|left-pad|CVE-2099-0001', state: 'born', severity: 'high',
      package: 'left-pad', version: '1.0.0', id: 'CVE-2099-0001', tool: 'osv', fixed: '1.0.1', title: 'synthetic advisory' }] }],
    ...over,
  });
  const putRollup = (doc) => {
    mkdirSync(join(REPORTS, 'fixarea'), { recursive: true });
    writeFileSync(join(REPORTS, 'fixarea', 'rollup.json'), JSON.stringify(doc));
  };

  test('no session is a 401 and the store is byte-identical', () => {
    const before = readFileSync(ISSUES, 'utf8');
    const res = call('POST', '/api/issues/ingest', { body: { project: 'fixarea' }, session: null });
    assert.equal(res.status, 401);
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
  });

  test('a body the reader refused is a 400', () => {
    assert.equal(call('POST', '/api/issues/ingest', { readErr: 'body is not valid JSON' }).status, 400);
  });

  test('an area the registry does not declare is a 400', () => {
    for (const project of [undefined, '', 'not-an-area', '../../etc']) {
      const res = call('POST', '/api/issues/ingest', { body: { project } });
      assert.equal(res.status, 400, String(project));
      assert.equal(res.body.error, 'project must name a known area');
    }
  });

  test('a traversal-shaped name is reduced to a declared slug, never used as a path', () => {
    // projectSlug() keeps [a-z0-9-] and trims dashes, so '../fixarea' can only ever mean 'fixarea'.
    const res = call('POST', '/api/issues/ingest', { body: { project: '../fixarea' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'no-rollup');
    assert.equal(res.body.area, 'fixarea');
  });

  test('a known area with no rollup answers no-rollup and writes nothing', () => {
    const before = readFileSync(ISSUES, 'utf8');
    const res = call('POST', '/api/issues/ingest', { body: { project: 'Fix Area' } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, status: 'no-rollup', area: 'fixarea', note: 'this area has no rollup to ingest — run a sweep first' });
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
  });

  test('a stale rollup files nothing: acting on old evidence manufactures conclusions', () => {
    putRollup(rollup({ generated: '2026-09-20T00:00:00.000Z', sliceId: 'sweep-20260920000000' }));
    const before = readFileSync(ISSUES, 'utf8');
    const res = call('POST', '/api/issues/ingest', { body: { project: 'fixarea' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'stale-rollup');
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
  });

  test('a fresh rollup mints its finding into the store; the same slice again is not-newer and changes nothing', () => {
    putRollup(rollup());
    const res = call('POST', '/api/issues/ingest', { body: { project: 'fixarea' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.area, 'fixarea');
    assert.equal(res.body.created.length, 1);
    assert.deepEqual(res.body.identityProblems, { before: 0, after: 0 });
    const doc = onDisk();
    const minted = doc.issues[res.body.created[0]];
    assert.equal(minted.area, 'fixarea');
    assert.equal(minted.severity, 'high');
    assert.equal(minted.source.key, 'f:osv|fixrepo|left-pad|CVE-2099-0001');
    assert.deepEqual(doc.lastIngest.fixarea, { sliceId: 'sweep-20261001110000', generated: '2026-10-01T11:00:00.000Z' });

    const before = readFileSync(ISSUES, 'utf8');
    const again = call('POST', '/api/issues/ingest', { body: { project: 'fixarea' } });
    assert.equal(again.body.status, 'not-newer');
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
  });
});
