// node --test bin/test/ — the gate a ledger-rewriting pass must run, and the trap it replaces.
//
// The whole suite exists to hold ONE property: a line-count comparison cannot detect a content
// rewrite, and a chain check can. On 2026-09-02 a PII scrub rewrote paths inside
// verdicts/liveness.jsonl and verified itself by comparing the line count before and after. It
// matched exactly — a content rewrite preserves it — so the guard reported success while orphaning
// 47 successors. The first test below is that scrub, in miniature, with both checks run side by
// side so the difference is asserted rather than described.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainedAppend, chainSnapshot, chainDegradation } from '../lib/touch-chain.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = join(REPO, 'bin', 'chain-guard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-guard-')); dirs.push(d); return d; };
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean);
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function ledger(n = 6) {
  const l = join(scratch(), 'l.jsonl');
  for (let i = 0; i < n; i++) chainedAppend(l, { gate: 'g', at: `t${i}`, src: `/work/alpha/x-${i}` });
  return l;
}

describe('the trap the guard replaces', () => {
  test('THE 2026-09-02 SCRUB IN MINIATURE: line count is identical, the chain is not', () => {
    const l = ledger();
    const before = chainSnapshot([l]);
    const countBefore = lines(l).length;

    const all = lines(l);
    all[2] = all[2].replace('/work/alpha/', '/work/beta/');   // content rewrite, same line count
    writeFileSync(l, all.join('\n') + '\n');

    const countAfter = lines(l).length;
    const after = chainSnapshot([l]);

    assert.equal(countAfter, countBefore, 'THE TRAP: a line-count check sees NOTHING and reports success');
    assert.equal(before[l].state, 'ok');
    assert.equal(after[l].state, 'chain-broken', 'the chain check sees it');
    assert.equal(chainDegradation(before, after).ok, false, 'and the guard fails, where the count passed');
  });
});

describe('degradation is measured per path, on counts and not just verdicts', () => {
  test('an ALREADY-broken ledger cannot launder a new break behind an unchanged state', () => {
    const l = ledger(8);
    const all = lines(l);
    all[2] = all[2].replace('alpha', 'beta');
    writeFileSync(l, all.join('\n') + '\n');
    const before = chainSnapshot([l]);
    assert.equal(before[l].state, 'chain-broken');
    assert.equal(before[l].broken, 1);

    const more = lines(l);
    more[5] = more[5].replace('alpha', 'gamma');
    writeFileSync(l, more.join('\n') + '\n');
    const after = chainSnapshot([l]);

    assert.equal(after[l].state, before[l].state, 'the VERDICT did not move — chain-broken both times');
    assert.ok(after[l].broken > before[l].broken, `but the count did (${before[l].broken} -> ${after[l].broken})`);
    const d = chainDegradation(before, after);
    assert.equal(d.ok, false, 'so the guard still fails — a state comparison alone would have passed this');
    assert.match(d.degraded[0].why, /broken 1 -> 2/);
  });

  test('a rewrite that EMPTIES a store is degradation, not a clean result', () => {
    const l = ledger();
    const before = chainSnapshot([l]);
    writeFileSync(l, '');
    const after = chainSnapshot([l]);
    assert.equal(after[l].broken, 0, 'nothing left to break — the unwitnessed zero');
    const d = chainDegradation(before, after);
    assert.equal(d.ok, false, 'and it is caught anyway, on examined');
    assert.match(d.degraded[0].why, /examined \d+ -> 0/);
  });

  test('an unchanged ledger degrades nothing, and a repair is never reported as degradation', () => {
    const l = ledger();
    const a = chainSnapshot([l]);
    assert.equal(chainDegradation(a, chainSnapshot([l])).ok, true, 'no change, no complaint');

    const broken = lines(l); broken[2] = broken[2].replace('alpha', 'beta');
    writeFileSync(l, broken.join('\n') + '\n');
    const worse = chainSnapshot([l]);
    assert.equal(chainDegradation(worse, a).ok, true, 'going from broken to sound is NOT degradation');
  });

  test('a path absent from the baseline is not a regression', () => {
    const l = ledger();
    assert.equal(chainDegradation({}, chainSnapshot([l])).ok, true);
  });

  test('an unreadable ledger fails closed and never becomes the baseline that excuses a rewrite', () => {
    const l = ledger();
    const before = chainSnapshot([l]);
    chmodSync(l, 0o000);
    try {
      const after = chainSnapshot([l]);
      if (after[l].state === 'unreadable') {           // skipped when running as root
        assert.equal(after[l].broken, null, 'not zero — unknown');
        assert.equal(chainDegradation(before, after).ok, false, 'became unreadable = degraded');
      }
    } finally { chmodSync(l, 0o644); }
  });
});

describe('the CLI is the half a rewriting pass actually calls', () => {
  test('snapshot then check: clean passes (exit 0), a content rewrite fails (exit 1)', () => {
    const l = ledger();
    const snap = join(dirname(l), 'before.json');
    assert.equal(run(['--snapshot', snap, l]).status, 0, 'baseline written');

    assert.equal(run(['--check', snap, l]).status, 0, 'unchanged -> exit 0');

    const all = lines(l); all[2] = all[2].replace('alpha', 'beta');
    writeFileSync(l, all.join('\n') + '\n');
    const bad = run(['--check', snap, l]);
    assert.equal(bad.status, 1, 'rewritten -> exit 1');
    assert.match(bad.stderr, /DEGRADED/);
  });

  test('a missing baseline REFUSES rather than reporting a pass', () => {
    const l = ledger();
    const r = run(['--check', join(dirname(l), 'nope.json'), l]);
    assert.equal(r.status, 1, 'fail closed');
    assert.match(r.stderr, /UNREADABLE|refusing/i);
  });

  test('one-shot: exit 1 on a broken ledger, 0 on a sound one', () => {
    const l = ledger();
    assert.equal(run([l]).status, 0);
    const all = lines(l); all[2] = all[2].replace('alpha', 'beta');
    writeFileSync(l, all.join('\n') + '\n');
    assert.equal(run([l]).status, 1);
  });

  test('naming no ledger is a usage error, never a silent pass', () => {
    assert.equal(run([]).status, 2);
    assert.equal(run(['--snapshot', 'x.json', '--check', 'y.json', 'z.jsonl']).status, 2);
  });
});
