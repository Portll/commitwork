import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_POLICY, MODES, AGENTIC_MODES, CADENCE, validatePolicy, loadPolicy, checkAgenticPreconditions } from '../remediation-policy.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-rempol-'));
const NOW = '2026-09-15T12:00:00.000Z';
const ABSENT = join(TMP, 'no-witness.json');
// the witness shape monitor/stpa-sweep.mjs reads: {pass, at}
const witness = (name, doc) => { const p = join(TMP, name); writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc)); return p; };
const fresh = (name = 'witness-fresh.json') => witness(name, { pass: true, at: '2026-09-15T11:00:00.000Z' });

test('the default policy is valid and is the safe baseline (mode=report) — new lanes enter here and need no witness', () => {
  assert.deepEqual(validatePolicy(DEFAULT_POLICY).errors, []);
  assert.equal(DEFAULT_POLICY.mode, 'report');
  assert.equal(DEFAULT_POLICY.verification, 'single');
  assert.equal(DEFAULT_POLICY.remediationBudgetPctOfCompute, 0);
  const pre = checkAgenticPreconditions({ policy: DEFAULT_POLICY, witnessPath: ABSENT, now: NOW });
  assert.deepEqual(pre, { ok: true, mode: 'report', witness: null, errors: [] });
  assert.equal(checkAgenticPreconditions({ policy: { mode: 'hitl-item' }, witnessPath: ABSENT, now: NOW }).ok, true, 'hitl-item never consults the witness');
});

test('every toggle is enum-validated; out-of-range budget errors', () => {
  assert.ok(validatePolicy({ mode: 'yolo' }).errors.some((e) => /mode must be one of/.test(e)));
  assert.ok(validatePolicy({ cadence: 'hourly' }).errors.some((e) => /cadence must be one of/.test(e)));
  assert.ok(validatePolicy({ verification: 'triple' }).errors.some((e) => /verification/.test(e)));
  assert.ok(validatePolicy({ remediationBudgetPctOfCompute: 250 }).errors.length);
  assert.ok(validatePolicy({ remediationBudgetPctOfCompute: -1 }).errors.length);
  // MODES/CADENCE exports are the source of truth the panel builds its toggles from
  assert.ok(MODES.includes('full-agentic') && CADENCE.includes('quarterly'));
});

test('full-agentic auto-merge without an owner is an ADVISORY, not an error (suggested-default)', () => {
  const r = validatePolicy({ mode: 'full-agentic', verification: 'double-arbitrate', m3: { autoMerge: true, owner: null } });
  assert.deepEqual(r.errors, []);
  assert.ok(r.advisories.some((a) => /name an accountable owner/.test(a)));
  // with an owner named, the advisory clears
  assert.equal(validatePolicy({ mode: 'full-agentic', verification: 'double-arbitrate', m3: { autoMerge: true, owner: 'sec@x' } }).advisories.length, 0);
});

test('the agentic modes are REFUSED without a fresh witness — an error that names the state and the path, not an advisory', () => {
  assert.deepEqual(AGENTIC_MODES, ['hitl-agentic', 'full-agentic']);
  for (const mode of AGENTIC_MODES) {
    const absent = checkAgenticPreconditions({ policy: { mode }, witnessPath: ABSENT, now: NOW });
    assert.equal(absent.ok, false);
    assert.equal(absent.witness.state, 'absent');
    assert.equal(absent.witness.path, ABSENT);
    assert.match(absent.errors[0], new RegExp(`^mode=${mode} is refused: .*witness for this run is absent at `));

    const unreadable = witness(`unreadable-${mode}.json`, '{ nope');
    assert.match(checkAgenticPreconditions({ policy: { mode }, witnessPath: unreadable, now: NOW }).errors[0], /is unreadable — not JSON/);

    const failed = witness(`failed-${mode}.json`, { pass: false, at: NOW });
    assert.match(checkAgenticPreconditions({ policy: { mode }, witnessPath: failed, now: NOW }).errors[0], /is failed \(/);

    const stale = witness(`stale-${mode}.json`, { pass: true, at: '2026-09-01T12:00:00.000Z' });
    assert.match(checkAgenticPreconditions({ policy: { mode }, witnessPath: stale, now: NOW }).errors[0], /is stale \(2026-09-01/);
  }
});

test('the agentic modes are permitted with a fresh passed witness', () => {
  const p = fresh();
  for (const mode of AGENTIC_MODES) {
    const pre = checkAgenticPreconditions({ policy: { mode }, witnessPath: p, now: NOW });
    assert.equal(pre.ok, true, JSON.stringify(pre));
    assert.deepEqual(pre.errors, []);
    assert.equal(pre.witness.state, 'fresh');
  }
});

test('loadPolicy refuses a stored agentic policy for this run without the witness, loads it with one, and agenticGate:false reads the declared mode', () => {
  const p = join(TMP, 'agentic.json');
  writeFileSync(p, JSON.stringify({ mode: 'hitl-agentic', verification: 'double-arbitrate' }));
  assert.throws(() => loadPolicy(p, { witnessPath: ABSENT, now: NOW }), /refused for this run: mode=hitl-agentic is refused: .*absent/);
  const loaded = loadPolicy(p, { witnessPath: fresh(), now: NOW });
  assert.equal(loaded.mode, 'hitl-agentic');
  const declared = loadPolicy(p, { agenticGate: false, witnessPath: ABSENT, now: NOW });
  assert.equal(declared.mode, 'hitl-agentic', 'the ungated read shows what the file declares');
  writeFileSync(p, JSON.stringify({ mode: 'report' }));
  assert.equal(loadPolicy(p, { witnessPath: ABSENT, now: NOW }).mode, 'report', 'report mode loads with no witness at all');
});

test('loadPolicy: absent file → safe defaults (source=default); present file merges over defaults', () => {
  const missing = loadPolicy(join(TMP, 'nope.json'));
  assert.equal(missing.source, 'default');
  assert.equal(missing.mode, 'report');

  const p = join(TMP, 'policy.json');
  writeFileSync(p, JSON.stringify({ mode: 'hitl-item', cadence: 'weekly', m3: { scope: { minSeverity: 'medium' } } }));
  const loaded = loadPolicy(p);
  assert.equal(loaded.source, 'file');
  assert.equal(loaded.mode, 'hitl-item');
  assert.equal(loaded.cadence, 'weekly');
  assert.equal(loaded.verification, 'single', 'unspecified fields fall back to the default');
  assert.equal(loaded.m3.scope.minSeverity, 'medium');
  assert.deepEqual(loaded.m3.scope.pathAllowlist, [], 'partial scope still complete');
});

test('loadPolicy fails CLOSED — a corrupt or invalid file throws, never a silent default', () => {
  const corrupt = join(TMP, 'corrupt.json');
  writeFileSync(corrupt, '{ not json');
  assert.throws(() => loadPolicy(corrupt), /corrupt/);

  const invalid = join(TMP, 'invalid.json');
  writeFileSync(invalid, JSON.stringify({ mode: 'nonsense' }));
  assert.throws(() => loadPolicy(invalid), /invalid/);
});

test('loadPolicy is deterministic (same file → identical result)', () => {
  const p = join(TMP, 'det.json');
  writeFileSync(p, JSON.stringify({ mode: 'hitl-agentic', verification: 'double-arbitrate', cadence: 'monthly' }));
  const opts = { witnessPath: fresh('det-witness.json'), now: NOW };
  assert.deepEqual(loadPolicy(p, opts), loadPolicy(p, opts));
});

test.after(() => rmSync(TMP, { recursive: true, force: true }));
