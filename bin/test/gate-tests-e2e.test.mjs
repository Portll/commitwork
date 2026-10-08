// gate-tests, end to end — the REAL script, spawned, over canned tallies and scratch state via
// the CW_GATE_TESTS_CMD / CW_GATE_TESTS_BASELINE seams. The regression paths (pristine-HEAD
// worktree) stay out of scope; their decisions are pinned in gate-tests-core.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE = join(REPO, 'bin', 'gate-tests.mjs');
const T = mkdtempSync(join(tmpdir(), 'gate-e2e-'));

// The canned suite prints the state file's next tally then consumes the line — one invocation
// that runs the suite twice sees two readings, like a tree settling under a live co-author.
const tallyScript = join(T, 'tally.mjs');
writeFileSync(tallyScript, [
  "import { readFileSync, writeFileSync } from 'node:fs';",
  'const p = process.env.T_STATE;',
  "const lines = readFileSync(p, 'utf8').trim().split('\\n');",
  'const cur = lines.shift();',
  "if (lines.length) writeFileSync(p, lines.join('\\n') + '\\n');",
  "const [pass, fail, ...names] = cur.split('|');",
  'for (const n of names.filter(Boolean)) console.log(`\\u2716 ${n} (1ms)`);',
  // `node --test` prints a TOTAL and the gate's coverage check reads it — a fixture that omits it
  // makes the coverage path unreachable, so the transient/loss cases would pass by never running.
  'console.log(`\\u2139 tests ${Number(pass) + Number(fail)}`);',
  'console.log(`\\u2139 pass ${pass}`);',
  'console.log(`\\u2139 fail ${fail}`);',
].join('\n'));

/**
 * A `node <script>` COMMAND STRING for the CW_GATE_TESTS_CMD seam, quoted.
 *
 * measuredExec runs this through execSync — a shell — and the default Windows node lives under
 * `C:\Program Files\`. Unquoted, the shell took `C:\Program` as the executable, the
 * canned suite never ran, and the gate reported "could not read a pass/fail tally … its reporter may
 * have changed. This is NOT a pass." The gate was right and its diagnosis was wrong, which is the
 * more dangerous half: it failed closed on a real absence of evidence while naming a cause that
 * would have sent the next reader to the reporter.
 *
 * Defined once because a test also ASSERTS on this exact string as the recorded provenance; two
 * copies would let the quoting drift from the thing that pins it.
 */
const nodeCmd = (script) => `"${process.execPath}" "${script}"`;

const BASELINE = join(T, 'baseline.json');

function runGate(tallies, { session = 'e2e00001-0000-4000-8000-000000000000', stdin, env = {} } = {}) {
  const state = join(T, 'state.txt');
  writeFileSync(state, tallies.map((t) => t.join('|')).join('\n') + '\n');
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
    input: stdin !== undefined ? stdin : JSON.stringify({ session_id: session }),
    env: {
      ...process.env,
      CW_GATE_TESTS_CMD: nodeCmd(tallyScript),
      T_STATE: state,
      CW_GATE_TESTS_BASELINE: BASELINE,
      CW_HOOK_STATE: join(T, 'hook-emit'),
      CW_VERDICT_DIR: join(T, 'verdicts'),
      ...env,
    },
  });
}

const journal = () =>
  readFileSync(join(T, 'verdicts', 'gate-tests.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const last = () => journal().at(-1);

test('first run arms the floor: speaks, writes the baseline, journals armed with the stdin session', () => {
  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /armed: 100 passing, 0 failing/);
  assert.ok(existsSync(BASELINE), 'baseline written');
  assert.equal(JSON.parse(readFileSync(BASELINE, 'utf8')).fail, 0);
  const rec = last();
  assert.equal(rec.verdict, 'armed');
  assert.equal(rec.session, 'e2e00001-0000-4000-8000-000000000000',
    'the stdin session_id lands on the record in full — truncation to 8 is the touch-ledger\'s convention, not the journal\'s, and redaction strips session from anything served');
  assert.ok(rec.headSha, 'headSha recorded');
});

test('steady speaks once…', () => {
  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /100 passing, 0 failing/);
  const rec = last();
  assert.equal(rec.verdict, 'steady');
  assert.equal(rec.suppressed, false);
  assert.equal(rec.floorRaised, false);
});

// The host headroom line overrides suppression on purpose (gate-tests.mjs), so on a volume under the
// 15% warning line the repeat below would measure the disk rather than the say-once rule. Both
// thresholds at 0 hold the host healthy for that one assertion. The test after it holds the
// override itself, with thresholds no real volume passes.
const HEALTHY_DISK = { CW_DISK_WARN_PCT: '0', CW_DISK_FAIL_PCT: '0' };

test('…and the identical repeat is byte-silent on stdout while STILL journaled', () => {
  const r = runGate([[100, 0]], { env: HEALTHY_DISK });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'suppressed turn emits nothing');
  const rec = last();
  assert.equal(rec.verdict, 'steady');
  assert.equal(rec.suppressed, true);
  assert.equal(rec.silenced, 1, 'the silence is counted, not lost');
});

test('…unless the volume is under the warning line: the repeat then speaks, and names the disk', () => {
  const r = runGate([[100, 0]], { env: { CW_DISK_WARN_PCT: '100', CW_DISK_FAIL_PCT: '0' } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DISK HEADROOM WARN/);
  const rec = last();
  assert.equal(rec.verdict, 'steady');
  assert.equal(rec.suppressed, false, 'a filling volume is never said once and then dropped');
  assert.equal(rec.host.verdict, 'warn');
});

test('a floor above reality ratchets DOWN and says how much could have hidden', () => {
  writeFileSync(BASELINE, JSON.stringify({ fail: 5, pass: 100, at: new Date().toISOString() }));
  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /floor lowered 5 -> 0/);
  assert.match(r.stdout, /up to 5 real regression\(s\) could have landed unreported/);
  assert.equal(last().verdict, 'floor-lowered');
  assert.equal(JSON.parse(readFileSync(BASELINE, 'utf8')).fail, 0, 'baseline follows reality down');
});

test('a coverage dip that recovers on the confirming re-run is transient, not an alarm', () => {
  const r = runGate([[90, 0], [100, 0]]); // first reading 90, the gate re-runs, second reads 100
  assert.equal(r.status, 0);
  assert.match(r.stdout, /dipped to 90 and recovered to 100/);
  const rec = last();
  assert.equal(rec.verdict, 'coverage-transient');
  assert.equal(rec.dip, 90);
  assert.equal(rec.recovered, 100);
});

test('no stdin means session null — an honest absence, never a fabricated identity', () => {
  const r = runGate([[100, 0]], { stdin: '' });
  assert.equal(r.status, 0);
  assert.equal(last().session, null);
});

test('corrupt baseline file → baseline-unreadable verdict, file untouched, exit 0', () => {
  writeFileSync(BASELINE, 'not valid json at all {');
  const originalContent = readFileSync(BASELINE, 'utf8');

  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /baseline file is corrupt or unreadable/);
  assert.match(r.stdout, /remains untouched/);

  const finalContent = readFileSync(BASELINE, 'utf8');
  assert.equal(finalContent, originalContent, 'baseline file left untouched');

  const rec = last();
  assert.equal(rec.verdict, 'baseline-unreadable', 'verdict recorded as baseline-unreadable');
  assert.ok(rec.message, 'error message recorded');
});

// P1-EXTEND (cw-adjudication-integrity task 10): the record must say the reading was OBTAINED,
// not merely remembered.
test('every record carries measurement provenance: the suite run itself, digested', () => {
  writeFileSync(BASELINE, JSON.stringify({ fail: 0, pass: 100, at: new Date().toISOString() }));
  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);
  const rec = last();
  assert.ok(rec.measured, 'a record with no measured block cannot prove the suite ran');
  assert.match(rec.measured.digest, /^sha256:[0-9a-f]{16}$/, 'the digest is of the suite\'s raw output, before parsing');
  assert.equal(rec.measured.source, nodeCmd(tallyScript),
    'the source names the command that actually ran — the injected fixture, not a claimed npm test');
  assert.equal(rec.measured.ok, true);
  assert.equal(rec.measured.exit, 0);
  assert.ok(rec.measured.ms >= 0, 'a duration exists — it cannot be produced without running');
});

test('a failing suite is still an OK measurement — nonzero exit is the normal state for this source', () => {
  writeFileSync(BASELINE, JSON.stringify({ fail: 1, pass: 99, at: new Date().toISOString() }));
  const r = runGate([[99, 1, 'x fails']]);
  assert.equal(r.status, 0, 'one pre-existing failure at an armed floor of 1 is steady');
  const rec = last();
  assert.ok(rec.measured, 'the failing run still carries provenance');
  // The canned tally exits 0 even for a red suite; what this pins is that the DIGEST moved when
  // the suite's output moved — the responsiveness signal the provenance exists to feed.
  const all = journal().filter((x) => x.measured && x.measured.digest);
  assert.ok(new Set(all.map((x) => x.measured.digest)).size >= 2,
    'different suite output must yield a different digest across records');
});

test('corrupt baseline does not bank a new floor', () => {
  writeFileSync(BASELINE, 'not valid json at all {');

  const r = runGate([[100, 0]]);
  assert.equal(r.status, 0);

  const content = readFileSync(BASELINE, 'utf8');
  assert.equal(content, 'not valid json at all {', 'baseline not overwritten with new floor');
});

// The no-tally headline used to assert "the suite did not run, or its reporter changed" — two
// causes it had no evidence for, while measuredExec had already recorded exit, signal and stderr
// and the branch discarded all three. The common real cause is a suite KILLED at the timeout:
// output is genuine but truncated before the tally. A gate that names the wrong cause gets
// discounted, and a discounted gate is how the next genuine unreadable is waved through.
test('no-tally names the MEASURED cause, and distinguishes a dead suite from a changed reporter', () => {
  const dead = join(T, 'dead.mjs');
  writeFileSync(dead, "console.log('ran a bit'); process.exit(7);");
  const r = spawnSync(process.execPath, [GATE], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
    input: JSON.stringify({ session_id: 'e2e00002-0000-4000-8000-000000000000' }),
    env: { ...process.env,
      CW_GATE_TESTS_CMD: nodeCmd(dead),
      CW_GATE_TESTS_BASELINE: join(T, 'baseline-dead.json'),
      CW_HOOK_STATE: join(T, 'hook-emit-dead'),
      CW_VERDICT_DIR: join(T, 'verdicts-dead') },
  });
  assert.equal(r.status, 0, 'a broken harness must not rewake — it says so and exits 0');
  assert.match(r.stdout, /This is NOT a pass/, 'unreadable is never green');
  assert.match(r.stdout, /did not complete: exit 7/, 'the measured exit code, not a guessed cause');
  assert.doesNotMatch(r.stdout, /its reporter changed/,
    'a suite that exited 7 is not evidence the reporter changed — that was the guess this replaces');

  // The other arm: a suite that exits CLEANLY but prints no tally IS a reporter question, and must
  // read differently. Two arms that render the same string would pin nothing.
  const quiet = join(T, 'quiet.mjs');
  writeFileSync(quiet, "console.log('no tally here'); process.exit(0);");
  const q = spawnSync(process.execPath, [GATE], {
    cwd: REPO, encoding: 'utf8', timeout: 120_000,
    input: JSON.stringify({ session_id: 'e2e00003-0000-4000-8000-000000000000' }),
    env: { ...process.env,
      CW_GATE_TESTS_CMD: nodeCmd(quiet),
      CW_GATE_TESTS_BASELINE: join(T, 'baseline-quiet.json'),
      CW_HOOK_STATE: join(T, 'hook-emit-quiet'),
      CW_VERDICT_DIR: join(T, 'verdicts-quiet') },
  });
  assert.match(q.stdout, /reporter may have changed/, 'exit 0 with no tally IS the reporter case');
  assert.notEqual(
    /did not complete/.test(r.stdout), /did not complete/.test(q.stdout),
    'the two causes must render differently or the message carries no information');
});
