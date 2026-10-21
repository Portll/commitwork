// /api/verdicts/triage and /adjudicate, fixture-driven
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/verdicts.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-vtri-'));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

const REG = join(TMP, 'projects.json');
const REPORTS = join(TMP, 'reports');
mkdirSync(join(REPORTS, 'alpha'), { recursive: true });
writeFileSync(REG, JSON.stringify({ reportsRoot: REPORTS, roots: [], projects: [], areas: [{ slug: 'alpha', label: 'Alpha' }] }));
writeFileSync(join(REPORTS, 'alpha', 'rollup.json'), JSON.stringify({
  scanners: { secrets: { undetermined: 2, total: 50 } },
  scannerFindings: { secrets: [
    { repo: 'r1', rule: 'generic-api-key', file: 'a.go', sev: '' },
    { repo: 'r1', rule: 'generic-api-key', file: 'b.go', sev: 'crit' },
  ] },
  repos: [{ name: 'r1', findings: [
    { id: 'CVE-1', package: 'nanoid', undetermined: true, undeterminedCode: 'version-not-declared', claimedSeverity: 'high', state: 'persisting', bornSlice: 'sweep-20260901000000' },
    { id: 'CVE-2', package: 'lodash', undetermined: false },
  ] }],
}));

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/verdicts/triage');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/verdicts/adjudicate');
assert.ok(GET && POST, 'both routes exist');

function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const ledgerDir = (name) => { const d = join(TMP, name); mkdirSync(d, { recursive: true }); return d; };

function get({ authed = true, project = 'alpha' } = {}) {
  return GET.handle({
    req: {}, query: new URLSearchParams({ project }),
    adminSession: () => (authed ? { user: 'op' } : null),
    send: (code, body) => ({ code, body }),
  });
}
function post(body, { authed = true, loopback = true, err = null } = {}) {
  return POST.handle({
    req: {},
    adminSession: () => (authed ? { user: 'op' } : null),
    isLoopbackReq: loopback,
    readJsonBody: (_req, cb) => cb(body, err),
    send: (code, b) => ({ code, body: b }),
  });
}

test('GET refuses without a session, before reading anything', () => {
  const r = withEnv({ CW_REGISTRY: REG, CW_VERDICT_DIR: join(TMP, 'never') }, () => get({ authed: false }));
  assert.equal(r.code, 401);
});

test('GET serves the ranked queue: the CVE row, the sevless secret, not the graded secret; rules travel with it', () => {
  const r = withEnv({ CW_REGISTRY: REG, CW_VERDICT_DIR: ledgerDir('led-empty') }, () => get());
  assert.equal(r.code, 200);
  assert.equal(r.body.state, 'ok');
  assert.equal(r.body.area, 'alpha');
  assert.deepEqual(r.body.admitted.map((x) => x.findingKey), ['r1|CVE-1|nanoid', 'secrets|r1|generic-api-key|a.go'],
    'claimed high outranks ungraded; the crit-graded secret is not undetermined at all');
  assert.equal(r.body.pending, 2);
  assert.equal(r.body.population, 3, 'the lane counter (2) plus the CVE row (1)');
  assert.ok(Array.isArray(r.body.rules) && r.body.rules.length >= 8);
  assert.equal(r.body.capacityItems, 120);
});

test('GET names a missing rollup and an unresolvable project as their own states, never as an empty queue', () => {
  const noRoll = withEnv({ CW_REGISTRY: REG, CW_VERDICT_DIR: ledgerDir('led-x') }, () => get({ project: 'beta' }));
  assert.equal(noRoll.code, 200);
  assert.ok(['no-rollup', 'unresolved'].includes(noRoll.body.state), noRoll.body.state);
  assert.equal(noRoll.body.admitted, undefined, 'no rows are invented for a project with no rollup');
});

test('POST refuses off the operator port, and refuses a truth without a basis', () => {
  const d = ledgerDir('led-post-refuse');
  const body = { findingKey: 'r1|CVE-1|nanoid', category: 'cve', repo: 'r1', truth: 'false-alarm', basis: 'read the lock' };
  assert.equal(withEnv({ CW_VERDICT_DIR: d }, () => post(body, { authed: false })).code, 401);
  assert.equal(withEnv({ CW_VERDICT_DIR: d }, () => post(body, { loopback: false })).code, 403);
  assert.equal(withEnv({ CW_VERDICT_DIR: d }, () => post({ ...body, basis: '' })).code, 400);
  assert.equal(withEnv({ CW_VERDICT_DIR: d }, () => post({ ...body, truth: 'meh' })).code, 400);
  assert.equal(withEnv({ CW_VERDICT_DIR: d }, () => post(null, { err: 'body too large' })).code, 400);
  assert.ok(!existsSync(join(d, 'adjudications.jsonl')), 'nothing was written by any refusal');
});

test('POST records one finding-adjudication with the basis sealed, and the row leaves the queue on the next GET', () => {
  const d = ledgerDir('led-post-ok');
  const body = { findingKey: 'r1|CVE-1|nanoid', category: 'cve', repo: 'r1', truth: 'false-alarm', basis: 'the sidecar lock pins nanoid 3.3.6, which is not in the affected range' };
  const r = withEnv({ CW_REGISTRY: REG, CW_VERDICT_DIR: d }, () => post(body));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.by, 'op', 'the session signs — the body cannot name the adjudicator');
  const lines = readFileSync(join(d, 'adjudications.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.kind, 'finding-adjudication');
  assert.equal(rec.truth, 'false-alarm');
  assert.equal(rec.adjudicatedBy, 'op');
  assert.equal(rec.provenance, 'triage:panel');
  assert.equal(typeof rec.basis, 'object', 'basis is an envelope, not free text');
  assert.match(rec.basis.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!lines[0].includes('sidecar lock pins'), 'the free text never reached the ledger');

  const again = withEnv({ CW_REGISTRY: REG, CW_VERDICT_DIR: d }, () => get());
  assert.deepEqual(again.body.admitted.map((x) => x.findingKey), ['secrets|r1|generic-api-key|a.go']);
  assert.equal(again.body.excluded.adjudicated, 1);
});
