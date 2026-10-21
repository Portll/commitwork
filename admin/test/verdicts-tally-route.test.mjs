// /api/verdicts — the --tally fatigue + calibration sections at the route, fixture-driven.
// The handler is called directly (determinations-route pattern): CW_VERDICT_DIR is read at CALL
// time by bin/verdict-journal.mjs, so each test points it at its own journal and proves the env
// seam rather than assuming it. Auth stays exactly as it was: no session, no payload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/verdicts.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-vdt-'));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

// a registry whose reportsRoot exists and holds no journals — sweep tables stay quiet, not erroring
const REG = join(TMP, 'projects.json');
mkdirSync(join(TMP, 'reports'), { recursive: true });
writeFileSync(REG, JSON.stringify({ reportsRoot: join(TMP, 'reports'), roots: [], projects: [], areas: [] }));

const route = routes.find((r) => r.path === '/api/verdicts');
assert.ok(route, 'route exists');

function call({ authed = true } = {}) {
  return route.handle({
    req: {},
    adminSession: () => (authed ? { user: 'op' } : null),
    send: (code, body) => ({ code, body }),
  });
}

function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); }
  finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const line = (o) => `${JSON.stringify(o)}\n`;

test('unauthenticated call is refused before any journal is read', () => {
  const r = withEnv({ CW_VERDICT_DIR: join(TMP, 'never-read'), CW_REGISTRY: REG }, () => call({ authed: false }));
  assert.equal(r.code, 401);
});

test('no adjudications journal: fatigue no-journal + calibration no-records — unknown, not clean', () => {
  const dir = join(TMP, 'vd-empty');
  mkdirSync(dir, { recursive: true });
  const r = withEnv({ CW_VERDICT_DIR: dir, CW_REGISTRY: REG }, () => call());
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.fatigue, { state: 'no-journal' });
  assert.deepEqual(r.body.calibration, { state: 'no-records' });
  assert.deepEqual(r.body.escalations, { state: 'no-journal' });
});

test('an escalation row is served as a needs-a-human queue entry — reason parsed, digest withheld', () => {
  const dir = join(TMP, 'vd-esc');
  mkdirSync(dir, { recursive: true });
  const sha = 'd'.repeat(64);
  writeFileSync(join(dir, 'adjudications.jsonl'),
    line({ kind: 'finding-adjudication', findingKey: 'secrets|alpha|aws-key', category: 'secrets', repo: 'alpha',
      truth: null, machineVerdict: null, provenance: 'escalation:chain-error(5)', model: 'qwen-7b',
      at: '2026-09-01T00:00:00Z', evidence: { place: null, artifact: null, sha256: sha }, prev: 'genesis' }));
  const r = withEnv({ CW_VERDICT_DIR: dir, CW_REGISTRY: REG }, () => call());
  assert.equal(r.code, 200);
  const e = r.body.escalations;
  assert.equal(e.state, 'ok');
  assert.equal(e.pending, 1);
  assert.deepEqual({ reason: e.rows[0].reason, chains: e.rows[0].chains, sealed: e.rows[0].evidenceSealed },
    { reason: 'chain-error', chains: 5, sealed: true });
  assert.ok(!JSON.stringify(r.body).includes(sha), 'the sealed digest crossed the route');
});

test('suppressed-never-adjudicated targets surface; who/sentence never do; calibration aggregates', () => {
  const dir = join(TMP, 'vd-live');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'adjudications.jsonl'),
    line({ kind: 'suppression-label', target: 'alpha secrets aws-key', action: 'suppress', count: 9, who: 'operator-name', at: '2026-08-01T00:00:00Z', prev: 'genesis' })
    + line({ kind: 'suppression-label', target: 'judged-target', action: 'suppress', count: 3, who: 'operator-name', at: '2026-08-02T00:00:00Z' })
    + line({ kind: 'finding-adjudication', category: 'secrets', findingKey: 'judged-target', truth: 'false-alarm', model: null, bornSlice: 'sweep-20260801000000', at: '2026-08-03T00:00:00Z' }));
  const r = withEnv({ CW_VERDICT_DIR: dir, CW_REGISTRY: REG }, () => call());
  assert.equal(r.code, 200);
  const f = r.body.fatigue;
  assert.equal(f.state, 'ok');
  assert.deepEqual(f.targets, [{ target: 'alpha secrets aws-key', count: 9, labels: 1, everExpiring: false }],
    'the adjudicated target is excluded; the surviving row carries the allowlist only');
  assert.ok(!JSON.stringify(r.body).includes('operator-name'), 'who never crosses the tunnel');
  const c = r.body.calibration;
  assert.equal(c.state, 'ok');
  assert.equal(c.checks.secrets.human.adjudicated, 1);
  assert.equal(c.checks.secrets.human.falseAlarmRate, 1);
});

test('an unreadable journal is its own state — never "nothing suppressed"', () => {
  const dir = join(TMP, 'vd-dir-as-file');
  mkdirSync(join(dir, 'adjudications.jsonl'), { recursive: true }); // a directory where the file goes: read throws non-ENOENT
  const r = withEnv({ CW_VERDICT_DIR: dir, CW_REGISTRY: REG }, () => call());
  assert.equal(r.code, 200);
  assert.equal(r.body.fatigue.state, 'unreadable');
  assert.equal(r.body.calibration.state, 'unreadable');
  assert.equal(r.body.escalations.state, 'unreadable', 'an unreadable journal must never read as an empty queue');
});
