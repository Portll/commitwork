// The gate. Builds the graph over HEAD and fails when the two witnesses stop agreeing.
//
// WHY THIS EXISTS AS A TEST AND NOT A MEASUREMENT. "Zero divergence across 1,063 files" was true
// when it was measured and nothing would have noticed it becoming false. CLAUDE.md names that
// exact shape: the import guard "had been right all along, and that was never the problem — it had
// no FLOOR, no reason it HAD to be right, and therefore no way to notice when it stopped being."
// A streak is not a property. This makes it one.
//
// HEAD, not the working tree. Eight-plus sessions write this tree at once, so a peer's in-flight
// edit would fail this on work that is not theirs to have finished — the same reason
// bin/test/tracked-imports.test.mjs reads HEAD. It costs ~9s, which is why codegraph/report.mjs
// reads every blob in one `cat-file --batch` rather than spawning `git show` 1,063 times.
//
// vm.SourceTextModule needs --experimental-vm-modules, so this file re-runs ITSELF in a child that
// has the flag rather than skipping: a skipped gate reports nothing and looks exactly like a
// passing one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const EXPECTED_TESTS = 9;

if (typeof vm.SourceTextModule !== 'function') {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  // spec, named: Node 22 writes TAP to a pipe, and the summary below is read in spec form.
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=spec', SELF],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  test('the divergence gate ran in a child carrying --experimental-vm-modules', () => {
    assert.notEqual(r.status, null,
      `the child could not START (${r.signal || r.error}) — not the same as a test failing`);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const pass = Number((/^ℹ pass (\d+)$/m.exec(out) || [])[1] ?? -1);
    const fail = Number((/^ℹ fail (\d+)$/m.exec(out) || [])[1] ?? -1);
    assert.ok(pass >= 0 && fail >= 0, `the child produced no test summary — it ran nothing:\n${out.slice(-2000)}`);
    assert.equal(fail, 0, `child failures:\n${out.slice(-6000)}`);
    assert.ok(pass >= EXPECTED_TESTS,
      `child reported only ${pass} passing tests, expected >= ${EXPECTED_TESTS} — the delegation is hollow`);
  });
} else {
  const { analyse } = await import('../build.mjs');
  const { build, headSources, repoRoot } = await import('../report.mjs');
  const { NOT_MODULES } = await import('../../bin/lib/parse-gate.mjs');

  // One build, shared. Nine seconds is worth paying once, not once per assertion.
  const graph = await build({ head: true });

  // ANTI-VACUITY FLOOR, and it is load-bearing for four of the tests below.
  //
  // Measured 2026-09-25 by running this file's own assertions over an empty population:
  // falsePositive, falseNegative, unreadable and partial are all `[]` when NOTHING was analysed, so
  // four of these six tests are satisfied most easily by a graph of nothing. That is the anti-guard
  // shape docs/TRAPS.md now names — a check that reads greener the less there is to check.
  //
  // So each of those four asserts the floor itself rather than trusting the population test to have
  // run first. node:test does not order tests by dependency, and a precondition held in a sibling
  // test is a precondition nothing enforces. 900 is well below the real count (1,060+) and is a
  // floor, not a pin: it catches a glob that collapsed, not a week's growth.
  const FLOOR = 900;
  const nonVacuous = () => assert.ok(graph.summary.analysed > FLOOR,
    `only ${graph.summary.analysed} modules analysed — below the floor of ${FLOOR}, so this `
    + 'assertion would pass on an empty graph and proves nothing. Fix the population, not the floor.');

  test('the gate can FAIL — a manufactured divergence is reported', async () => {
    // First, and it is not ceremony. Every assertion below is also satisfied by a gate that reports
    // empty for any input, and this repository has shipped exactly that kind of checker before.
    const files = { 'a.mjs': 'export let uninitialised;\n' };
    const g = await analyse({
      files: Object.keys(files),
      readFile: (p) => files[p],
    });
    assert.deepEqual(g.summary.divergence.falseNegative, [{ path: 'a.mjs', names: ['uninitialised'] }],
      'a name V8 exports that W1 never found must be reported, or this whole file proves nothing');
  });

  test('the re-export gate can FAIL, in both directions', async () => {
    const files = {
      'b.mjs': 'export const v = 1;\nexport const a = 2;\n',
      // W1's line-anchored import reader misses a mid-line import, so it reads `export { a }` as local
      'missed.mjs': "const z = 1; import { a } from './b.mjs'; export { a };\n",
      // W1 misses `export var v`, so it believes the star carries the `v` this module demands of b
      'invented.mjs': "export var v;\nexport { v as w } from './b.mjs';\nexport * from './b.mjs';\n",
    };
    const g = await analyse({ files: Object.keys(files), readFile: (p) => files[p] });
    assert.deepEqual(g.summary.divergence.reexports, {
      falsePositive: [{ path: 'invented.mjs', reexports: ['v <- ./b.mjs#v'] }],
      falseNegative: [{ path: 'missed.mjs', reexports: ['a <- ./b.mjs#a'] }],
    });
    assert.ok(!g.summary.divergence.falseNegative.some((f) => f.path === 'invented.mjs'),
      'the export SURFACE agrees on invented.mjs — only the re-export comparison sees this one');
  });

  test('the population is the repository, not a subset that happens to agree', () => {
    // A gate that quietly narrowed its input would pass forever. The count is asserted against the
    // tree itself rather than pinned to a number, which would go stale within the week.
    const expected = headSources(repoRoot()).length;
    assert.ok(expected > 900, `only ${expected} sources found at HEAD — the listing, not the tree, is wrong`);
    assert.equal(graph.files.input, expected);
    assert.equal(
      graph.summary.analysed + graph.summary.partial + graph.summary.unreadable,
      graph.files.input,
      'the three states must SUM to the input — a file in none of them is a file silently dropped',
    );
  });

  test('W1 claims no export V8 does not have (the FALSE POSITIVE direction)', () => {
    nonVacuous();
    assert.deepEqual(graph.summary.divergence.falsePositive, [],
      'the lexer invented an export. That is a symbol that is not there, and every answer resting '
      + 'on it — dead exports above all — is now reporting something that does not exist.');
  });

  test('V8 has no export W1 never found (the FALSE NEGATIVE direction)', () => {
    nonVacuous();
    // Kept apart from the test above on purpose: only one of these directions lies to you, and
    // summing them into one "divergence" number loses which one it was. This is the direction that
    // shrinks a surface — it makes a live export look dead.
    assert.deepEqual(graph.summary.divergence.falseNegative, [],
      'the lexer missed an export V8 can see. Closing 27 of these is what made the floor real.');
  });

  // Also satisfied by a graph with no re-exports in it, so it asserts there are some: one is the
  // floor, because the count is the tree's to change and a pin would go stale.
  const reexportsSeen = () => assert.ok(graph.edges.some((e) => e.kind === 'reexports' && e.witness === 'both'),
    'no re-export edge that both witnesses read — the comparison below would pass over nothing');

  test('W1 reads no re-export V8 does not resolve (the FALSE POSITIVE direction)', () => {
    nonVacuous();
    reexportsSeen();
    assert.deepEqual(graph.summary.divergence.reexports.falsePositive, [],
      'the lexer invented a re-export. It mints no edge alone, and it is still a reading that is wrong.');
  });

  test('V8 resolves no re-export W1 never read (the FALSE NEGATIVE direction)', () => {
    nonVacuous();
    reexportsSeen();
    assert.deepEqual(graph.summary.divergence.reexports.falseNegative, [],
      'the lexer missed a re-export V8 resolves, so W1 no longer floors the edge that keeps its target alive');
  });

  test('no file at HEAD is unreadable', () => {
    nonVacuous();
    assert.deepEqual(graph.files.unreadable, [],
      'an unreadable file is not a small loss: it makes every reachability answer a lower bound, '
      + 'and it empties `dead` entirely. It is the one state that degrades every other answer.');
  });

  test('every PARTIAL file is one the repository has already declared not a module', () => {
    nonVacuous();
    // Reuses bin/lib/parse-gate.mjs's declaration rather than keeping a second list. Two lists of
    // the same exceptions drift, and the drift is silent in whichever one nobody is reading.
    const declared = new Set(Object.keys(NOT_MODULES));
    const undeclared = graph.files.partial.filter((p) => !declared.has(p.path));
    assert.deepEqual(undeclared, [],
      'a source V8 refuses that nothing declares as a non-module. Either it is broken — in which '
      + 'case bin/test/parse-gate should be saying so — or it is a legitimate exception and belongs '
      + 'in NOT_MODULES with its reason, not absorbed into a category that quietly holds anything.');
  });
}
