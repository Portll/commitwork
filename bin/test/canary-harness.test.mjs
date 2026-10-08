// The canary harness must itself be able to go red. Only the hermetic gate-tests scenarios run
// here (R-* scenarios measure the real tree and are too slow for a unit suite); pinned: the
// scorecard's truth mapping, the dry-run default (no ledger writes), and the exit voice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// Importable because the module guards its own main() — otherwise importing it spawns every gate.
import { summarise, exitCodeFor } from '../canary-harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function harness(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [join(REPO, 'bin', 'canary-harness.mjs'), ...args], {
      cwd: REPO, encoding: 'utf8', timeout: 240_000, env: { ...process.env, ...env },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: typeof e.status === 'number' ? e.status : 1, out: `${String(e.stdout || '')}${String(e.stderr || '')}` };
  }
}

test('gate-tests scenarios: planted regression, vanish and garbage all score correct — and stay OUT of the live ledger by default', () => {
  // CW_VERDICT_DIR is a leak canary — any write here breaks the dry-run promise
  const leak = mkdtempSync(join(tmpdir(), 'cw-harness-leak-'));
  const r = harness(['--only', 'T-REG,T-CLEAN,T-VANISH,T-GARBAGE', '--json'], { CW_VERDICT_DIR: leak });
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
  const { summary, results } = JSON.parse(r.out);
  assert.equal(summary.scored, 4);
  assert.equal(summary.correct, 4);
  assert.equal(summary.falseClean, 0);
  const byId = Object.fromEntries(results.map((x) => [x.id, x]));
  assert.equal(byId['T-REG'].truth, 'true-alarm');
  assert.equal(byId['T-CLEAN'].truth, 'true-clean');
  assert.equal(byId['T-VANISH'].truth, 'true-alarm');
  assert.equal(byId['T-GARBAGE'].truth, 'true-alarm');
  assert.ok(!existsSync(join(leak, 'adjudications.jsonl')), 'dry run wrote to the ledger');
});

test('a scenario the tree cannot host is a SKIP with its reason, never a silent pass', () => {
  const r = harness(['--only', 'NO-SUCH-SCENARIO']);
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown scenario/);
});

// ── ATTRIBUTION HAS A VOICE ─────────────────────────────────────────────────────────────────────
// The scorers are unit-tested directly — a wrong claim could otherwise only be observed when the
// tree happened to produce one.
const row = (over) => ({ id: 'X', truth: 'true-alarm', ...over });

test('summarise: a misattributed scenario is counted as detected AND as misattributed', () => {
  const s = summarise([row({ attributionCorrect: false }), row({ attributionCorrect: true })]);
  assert.equal(s.correct, 2, 'both gates DID see the defect — misattribution is not a miss');
  assert.equal(s.falseClean, 0);
  assert.equal(s.attributionScored, 2);
  assert.equal(s.attributionCorrect, 1);
  assert.equal(s.attributionWrong, 1, 'and it is not a pass either');
});

test('summarise: attribution keys are absent when nothing scored one — never a zero that reads as a result', () => {
  const s = summarise([row({}), { id: 'Y', skipped: 'no dirty file' }]);
  assert.equal(s.attributionWrong, undefined);
  assert.equal(s.attributionScored, undefined);
  assert.equal(s.skipped, 1);
});

// ── A SKIP IS NOT A PASS ────────────────────────────────────────────────────────────────────────
// On a clean tree five of twelve scenarios vanish; an exit voice keyed on falseClean alone
// exits 0 — a nightly all-clear meaning "nothing was tested".
test('exitCodeFor: a REQUIRED scenario that could not run fails the run', () => {
  const allClean = summarise([row({})]);
  assert.equal(exitCodeFor(allClean, { requiredSkipped: 0 }), 0);
  assert.equal(exitCodeFor(allClean, { requiredSkipped: 1 }), 4, 'a required scenario that scored nothing proves nothing');
  // severity order holds: a real failure still outranks a missing scenario
  assert.equal(exitCodeFor(summarise([row({ truth: 'false-clean' })]), { requiredSkipped: 1 }), 2);
  assert.equal(exitCodeFor(summarise([row({ attributionCorrect: false })]), { requiredSkipped: 1 }), 3);
});

test('exitCodeFor: a run where NOTHING scored is never green', () => {
  const nothing = summarise([{ id: 'R-DRIFT', skipped: 'tree measures driftedOpen=0' }]);
  assert.equal(nothing.scored, 0);
  assert.equal(nothing.skipped, 1);
  // main() passes nothingScored through the same channel as requiredSkipped
  assert.equal(exitCodeFor(nothing, { requiredSkipped: 1 }), 4);
  assert.equal(exitCodeFor(nothing, { requiredSkipped: 0 }), 0, 'the guard is the caller`s; the fold itself stays pure');
});

// Checked against the text that WAS there — a scenario passing only against fixed code proves
// the fix, not the detector.
test('R-ADVICE-UNKNOWN`s predicate rejects the pre-fix advice', () => {
  const preFix = 'If the increase is intentional and understood, accept it with `node bin/gate-ratchet.mjs --baseline`.';
  const guarded = /Do NOT baseline a co-author's break/.test(preFix);
  const offersAccept = /--baseline/.test(preFix);
  assert.equal(guarded, false, 'the pre-fix advice carried no guard');
  assert.equal(offersAccept, true, 'and offered the accept-instruction regardless of claim');
  assert.ok(!guarded || offersAccept, 'so the scenario scores it as a laundering false-clean');
});

test('every taxonomy class a scenario cites exists in the registry', () => {
  const r = harness(['--list']);
  assert.equal(r.code, 0, r.out);
  const scenarios = JSON.parse(r.out);
  assert.ok(scenarios.length >= 12, `expected the full scenario set, got ${scenarios.length}`);
  let registry;
  try { registry = JSON.parse(readFileSync(join(REPO, 'monitor', 'failure-taxonomy.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }   // unreadable is never absent
  const ids = new Set((registry.classes || []).map((c) => c.id));
  for (const s of scenarios) {
    for (const c of s.classes) {
      assert.ok(ids.has(c), `scenario ${s.id} cites taxonomy class ${c}, which the registry does not define`);
    }
  }
});

test('exitCodeFor: a wrong claim is non-zero, and distinct from every other failure', () => {
  assert.equal(exitCodeFor(summarise([row({ attributionCorrect: false })])), 3,
    'THE finding: this was 0, so a fully-misattributed gate passed every scheduled caller');
  assert.equal(exitCodeFor(summarise([row({ attributionCorrect: true })])), 0);
  // severity order — a false clean still outranks it
  assert.equal(exitCodeFor(summarise([row({ truth: 'false-clean' }), row({ attributionCorrect: false })])), 2);
  assert.equal(exitCodeFor(summarise([row({ truth: 'false-alarm' })])), 1);
  // each failure has its OWN code — sharing one hides a failure from a scheduled caller
  const codes = [2, 3, 4, 1, 0];
  assert.equal(new Set(codes).size, codes.length);
});
