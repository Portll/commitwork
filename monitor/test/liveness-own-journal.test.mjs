// The deadman must keep its own pulse: liveness reads every other gate's journal, and a watcher
// that records nothing leaves only an absence of complaints — the false-clean channel pointed at
// the module itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { GATE_REGISTRY, classifyRecord } from '../../bin/adjudication-sampler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVENESS = join(HERE, '..', 'liveness.mjs');

function runLiveness(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-liveness-'));
  const r = spawnSync(process.execPath, [LIVENESS], {
    encoding: 'utf8',
    env: { ...process.env, CW_VERDICT_DIR: dir, ...env },
    timeout: 120_000,
  });
  const path = join(dir, 'liveness.jsonl');
  const records = existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { dir, r, records };
}

test('liveness writes a verdict record of its own on every run', () => {
  const { dir, r, records } = runLiveness();
  try {
    assert.equal(records.length, 1, `expected exactly one record; stderr was: ${r.stderr?.slice(0, 400)}`);
    const rec = records[0];
    assert.equal(rec.gate, 'liveness');
    assert.ok(rec.verdict, 'a record with no verdict cannot be adjudicated');
    assert.ok(Number.isInteger(rec.areas), 'the record must say how much was checked');
    // `git archive HEAD | tar -x` has no .git, so headSha() is legitimately null there — the
    // field is EITHER a real sha or an honest null, never a placeholder
    assert.ok(rec.headSha === null || /^[0-9a-f]{40}$/.test(rec.headSha),
      `headSha must be a real sha or an honest null, never ${JSON.stringify(rec.headSha)}`);
    if (rec.headSha !== null) {
      assert.match(rec.headSha, /^[0-9a-f]{40}$/, 'and which tree it checked, or it can never be re-derived');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// a clean verdict is still a decision — journaling only alarms reproduces the gate-ratchet gap
test('a run in which everything was fine still records — quiet verdicts are decisions too', () => {
  const { dir, records } = runLiveness();
  try {
    const rec = records[0];
    const { stratum } = classifyRecord('liveness', rec);
    assert.notEqual(stratum, 'unclassified',
      `liveness verdict ${JSON.stringify(rec.verdict)} is not mapped in GATE_REGISTRY — a verdict that `
      + 'cannot be classified cannot enter a denominator');
    assert.ok(['clean', 'alarm'].includes(stratum));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// the registry maps liveness's RANK vocabulary — an unmapped state is recorded and never counted
test('every state liveness can rank is classified by GATE_REGISTRY', async () => {
  const { RANK } = await import('../liveness.mjs');
  const spec = GATE_REGISTRY.liveness;
  const known = new Set([...spec.clean, ...spec.alarm, ...spec.neither]);
  const missing = Object.keys(RANK).filter((s) => !known.has(s));
  assert.deepEqual(missing, [],
    'a state in liveness RANK but not in GATE_REGISTRY.liveness would be recorded and then never counted');
});

test('the registry agrees with RANK on which states are clean', async () => {
  const { RANK } = await import('../liveness.mjs');
  const spec = GATE_REGISTRY.liveness;
  for (const s of spec.clean) {
    assert.equal(RANK[s], 0, `${s} is listed clean but RANK ranks it ${RANK[s]} — one of the two is wrong`);
  }
  for (const s of spec.alarm) {
    assert.ok((RANK[s] ?? 0) >= 1, `${s} is listed as an alarm but RANK ranks it ${RANK[s]}`);
  }
});

// the measured block records only that the source was READ — measured.ok is NOT the verdict:
// liveness signals rank-1 alarms while exiting 0
test('the record carries measurement provenance over the rollups it read, and the digest tracks them', () => {
  const fixtures = mkdtempSync(join(tmpdir(), 'cw-liveness-fix-'));
  const rollup = join(fixtures, 'rollup.json');
  const write = (sliceId) => writeFileSync(rollup, JSON.stringify({
    sliceId, freshness: { generated: '2026-08-01T00:00:00Z' },
  }));
  try {
    write('sweep-1');
    const a = runLiveness({ CW_ROLLUP: rollup });
    const b = runLiveness({ CW_ROLLUP: rollup });
    write('sweep-2');
    const c = runLiveness({ CW_ROLLUP: rollup });
    try {
      for (const { records } of [a, b, c]) {
        const m = records[0].measured;
        assert.ok(m, 'a record with no measured block cannot prove the rollup was read');
        assert.match(m.digest, /^sha256:[0-9a-f]{16}$/);
        assert.match(m.source, /^artifact:/, 'a file read must be visible as one');
        assert.equal(m.ok, true);
      }
      assert.equal(a.records[0].measured.digest, b.records[0].measured.digest,
        'an unchanged rollup must digest equal across runs');
      assert.notEqual(b.records[0].measured.digest, c.records[0].measured.digest,
        'a rollup that moved must move the digest — the discrimination the block exists for');
      // verdict and provenance are two axes — the fixture alarms while the read still succeeds
      assert.notEqual(a.records[0].verdict, 'fresh', 'the fixture is deliberately stale');
    } finally {
      for (const { dir } of [a, b, c]) rmSync(dir, { recursive: true, force: true });
    }
  } finally { rmSync(fixtures, { recursive: true, force: true }); }
});

// the journal write must never change the verdict
test('a journal write failure costs evidence, never the verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-liveness-ro-'));
  const blocked = join(dir, 'verdicts');
  try {
    // a FILE where the journal directory should be — the write cannot succeed
    writeFileSync(blocked, 'not a directory');
    const r = spawnSync(process.execPath, [LIVENESS], {
      encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: blocked }, timeout: 120_000,
    });
    assert.ok([0, 1].includes(r.status), `expected a real verdict exit code, got ${r.status}`);
    assert.match(r.stderr, /verdict journal write failed/,
      'the failure must be SAID — a deadman that silently stopped recording is the thing this prevents');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
