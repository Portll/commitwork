// admin/routes/ingest.mjs — GET /api/ingest/targets, GET and POST /api/ingest/judgement, as handlers
// over a temp issue store.
//
// The store is built through monitor/issue-store.mjs (CW_ISSUES), and every side store the POST
// touches is redirected: the refusal ledger (CW_INGEST_QUARANTINE), the learning view (CW_LEARNING),
// the remediation policy (CW_REMEDIATION_POLICY, absent ⇒ defaults). A filed judgement may ask for a
// re-scan; the success path here asks for 'none', and CW_INGEST_RESCAN=0 is set as well so that no
// mistake in this file can start a sweep.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-ingest-entry-'));
const ISSUES = join(TMP, 'issues.json');
const QUARANTINE = join(TMP, 'ingest-quarantine.json');
const NOW = '2026-10-01T00:00:00.000Z';
mkdirSync(join(TMP, 'src'), { recursive: true });
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'Fix Area', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
Object.assign(process.env, {
  CW_REGISTRY: join(TMP, 'projects.json'), CW_ISSUES: ISSUES, CW_LEARNING: join(TMP, 'learning.json'),
  CW_INGEST_QUARANTINE: QUARANTINE, CW_INGEST_RESCAN: '0', CW_REMEDIATION_POLICY: join(TMP, 'absent-policy.json'),
  CW_VERDICT_DIR: join(TMP, 'verdicts'), CW_NOW: NOW, HOME: TMP,
});
delete process.env.CW_ISSUE_ORG;

const store = await import('../../monitor/issue-store.mjs');
const { subjectDigest } = await import('../../monitor/ingest-external.mjs');
const { routes } = await import('../routes/ingest.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

const route = (method, path) => routes.find((r) => r.method === method && r.path === path);
const OPERATOR = { user: 'op@example.test', provider: 'local' };

function call(method, path, { query = '', body = {}, readErr = null, session = OPERATOR } = {}) {
  const r = route(method, path);
  assert.ok(r, `${method} ${path} is not a registered route`);
  let out = null;
  r.handle({
    req: {}, query: new URLSearchParams(query),
    adminSession: () => session, isLoopbackReq: false,
    send: (status, payload) => { out = { status, body: payload }; },
    readJsonBody: (_req, cb) => (readErr ? cb(null, readErr) : cb(body, null)),
  });
  assert.ok(out, `${method} ${path} answered nothing`);
  return out;
}

let OPEN, OTHER, CLOSED;
function seed() {
  const doc = store.emptyIssuesDoc();
  const mint = (area, n) => store.mintIssue(doc, {
    area, repo: 'fixrepo', kind: 'code', severity: 'high', title: `js/sql-injection [sastCodeql] (fixrepo) ${n}`,
    body: null, remediation: null,
    source: { kind: 'scanner-row', key: `sc:fixrepo|sastCodeql|js/sql-injection|src/db${n}.js`, tool: 'sastCodeql', rule: 'js/sql-injection' },
  }, '2026-09-01T00:00:00.000Z').id;
  OPEN = mint('fixarea', 1);
  OTHER = mint('otherarea', 2);
  CLOSED = mint('fixarea', 3);
  store.closeIssue(doc, CLOSED, { as: 'accepted', evidence: 'risk accepted in fixture', at: '2026-09-02T00:00:00.000Z' });
  store.withIssuesLock(() => store.saveIssues(doc, { path: ISSUES }), { path: ISSUES });
}
const onDisk = () => JSON.parse(readFileSync(ISSUES, 'utf8'));
const quarantine = () => (existsSync(QUARANTINE) ? JSON.parse(readFileSync(QUARANTINE, 'utf8')) : null);
const VALID = () => ({ issueId: OPEN, disposition: 'false-positive', reason: 'the value is a fixture constant, never input', rescan: 'none' });

beforeEach(() => { rmSync(QUARANTINE, { force: true }); seed(); });

describe('GET /api/ingest/targets', () => {
  test('no session, no targets', () => {
    const res = call('GET', '/api/ingest/targets', { session: null });
    assert.equal(res.status, 401);
    assert.equal(res.body.rows, undefined);
  });

  test('lists the OPEN issues of the named area only, with the legend and vocabularies beside them', () => {
    const res = call('GET', '/api/ingest/targets', { query: 'project=fixarea' });
    assert.equal(res.status, 200);
    assert.equal(res.body.area, 'fixarea');
    assert.deepEqual(res.body.rows.map((r) => r.id), [OPEN], 'the closed issue and the other area are excluded');
    assert.equal(res.body.rows[0].subjectDigest, subjectDigest(onDisk().issues[OPEN]));
    assert.equal(res.body.rows[0].greenKind, 'open');
    assert.deepEqual(res.body.dispositions, ['false-positive', 'remediated', 'not-applicable']);
    assert.ok(res.body.rescanLevels.includes('none'), 'none must be a level a caller can name');
    assert.match(res.body.greenKinds['human-green'], /still here/);
    assert.equal(res.body.generated, NOW);
  });

  test('no area named is every open issue', () => {
    const res = call('GET', '/api/ingest/targets');
    assert.deepEqual(res.body.rows.map((r) => r.id).sort(), [OPEN, OTHER].sort());
    assert.equal(res.body.area, null);
  });

  test('a corrupt store is a 503 naming it, never an empty list', () => {
    writeFileSync(ISSUES, '{ "version": 1, ');
    const res = call('GET', '/api/ingest/targets');
    assert.equal(res.status, 503);
    assert.match(res.body.error, /issue store unavailable: .*not valid JSON/);
  });
});

describe('GET /api/ingest/judgement', () => {
  test('no session is a 401; an unknown id a 404', () => {
    assert.equal(call('GET', '/api/ingest/judgement', { query: `id=${OPEN}`, session: null }).status, 401);
    const res = call('GET', '/api/ingest/judgement', { query: 'id=ISS-NOPE-0' });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'no such issue');
  });

  test('one issue\'s judgement view, with the digest a caller pins on the way back', () => {
    const res = call('GET', '/api/ingest/judgement', { query: `id=${OPEN}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.id, OPEN);
    assert.equal(res.body.state, 'open');
    assert.deepEqual(res.body.dispositions, []);
    assert.equal(res.body.currentSubjectDigest, res.body.subjectDigest);
    assert.match(res.body.currentSubjectDigest, /^sha256:[0-9a-f]{64}$/);
  });
});

describe('POST /api/ingest/judgement', () => {
  test('no session is a 401 and the store is byte-identical', () => {
    const before = readFileSync(ISSUES, 'utf8');
    const res = call('POST', '/api/ingest/judgement', { body: VALID(), session: null });
    assert.equal(res.status, 401);
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
  });

  test('a body the reader refused is a 400', () => {
    const res = call('POST', '/api/ingest/judgement', { readErr: 'body is not valid JSON' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'body is not valid JSON');
  });

  test('a payload outside the schema is refused as schema, quarantined with its author, and files nothing', () => {
    const before = readFileSync(ISSUES, 'utf8');
    const res = call('POST', '/api/ingest/judgement', { body: { ...VALID(), disposition: 'fixed-it-honest', extra: 1 } });
    assert.equal(res.status, 400);
    assert.equal(res.body.refused, 'schema');
    assert.equal(res.body.quarantined, true);
    assert.equal(readFileSync(ISSUES, 'utf8'), before);
    const q = quarantine();
    assert.ok(q, 'the refusal ledger was not written');
    assert.equal(JSON.stringify(q).includes('op@example.test (local)'), true, 'a quarantined refusal keeps who sent it');
  });

  test('a re-scan level outside the closed set is refused, never defaulted', () => {
    const res = call('POST', '/api/ingest/judgement', { body: { ...VALID(), rescan: 'everything-now' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.refused, 'unknown-rescan-level');
    assert.match(res.body.errors[0], /No level is picked for you/);
  });

  test('an unknown issue is a 404, and a pinned digest that moved is a 409', () => {
    const unknown = call('POST', '/api/ingest/judgement', { body: { ...VALID(), issueId: 'ISS-ZZZ-9' } });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.refused, 'unknown-issue');
    const stale = call('POST', '/api/ingest/judgement', { body: { ...VALID(), subjectDigest: `sha256:${'0'.repeat(64)}` } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.refused, 'stale-subject');
  });

  test('a valid judgement is filed against the session identity, expires by default, and leaves the issue open', () => {
    const pin = subjectDigest(onDisk().issues[OPEN]);
    const res = call('POST', '/api/ingest/judgement', { body: { ...VALID(), subjectDigest: pin, who: 'someone-else@example.test' } });
    // `who` is not in the schema, so a body naming one is refused outright — the identity is never the caller's.
    assert.equal(res.status, 400);
    assert.equal(res.body.refused, 'schema');

    const ok = call('POST', '/api/ingest/judgement', { body: { ...VALID(), subjectDigest: pin } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.issueId, OPEN);
    assert.equal(ok.body.filed.disposition, 'false-positive');
    assert.equal(ok.body.filed.who, 'op@example.test (local)');
    assert.equal(ok.body.filed.at, NOW);
    assert.equal(ok.body.filed.expires, '2026-12-30T00:00:00.000Z', 'a suppressing ruling with no expiry gets the 90-day default');
    assert.equal(ok.body.stillOpen, true);
    assert.deepEqual(ok.body.rescan, { level: 'none', spawned: false, reason: 'none' });
    assert.equal(ok.body.subjectDigest, pin);

    const iss = onDisk().issues[OPEN];
    assert.equal(iss.state, 'open', 'a judgement is never a close');
    assert.equal(iss.dispositions.length, 1);
    assert.equal(iss.dispositions[0].id, ok.body.filed.id);
    assert.equal(iss.waiver.annotationId, ok.body.filed.id);
    assert.equal(ok.body.learning.ok, true, JSON.stringify(ok.body.learning));
    assert.equal(existsSync(join(TMP, 'learning.json')), true);
  });

  test('a judgement on a closed issue is refused, and the closed record is untouched', () => {
    const before = JSON.stringify(onDisk().issues[CLOSED]);
    const res = call('POST', '/api/ingest/judgement', { body: { ...VALID(), issueId: CLOSED } });
    assert.equal(res.status, 400);
    assert.equal(res.body.refused, 'closed-issue');
    assert.equal(JSON.stringify(onDisk().issues[CLOSED]), before);
  });
});
