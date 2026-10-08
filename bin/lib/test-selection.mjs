// bin/lib/test-selection.mjs — which test files a change can affect, or why that cannot be decided.
//
// A diff of test files selects nothing for the change that matters most: one commit changed the rollup
// source and broke six tests in files it never touched. So selection walks CONSUMERS, not paths.
//
// Four edges, unioned, because each one is blind where another sees:
//   import   the reverse closure of relative static and dynamic imports
//   mention  a source whose text names the changed file's basename. Tests spawn scripts by a
//            composed path (join(REPO, 'bin', 'x.mjs')) and read registries by path; neither is an
//            import. Over-selection costs seconds; a miss reports green over a break.
//   fixture  a file under <dir>/test/fixtures/<name>/ selects the tests in <dir>/test that name <name>
//   runner   a declared test that runs other tests by a source pattern (RUNNER_TESTS)
//
// Measured by bin/test-selection-witness.mjs over all 677 test files on 2026-09-15: 168 misses, all
// from store-contamination (a runner) and get-focused-hook (runs ~/.claude/hooks/get-focused.sh,
// indexed by bin/test-select.mjs as an extra mention source).
//
// Every case the edges cannot decide runs the full suite and names the reason. A selector that
// silently selects nothing is worse than the cost it removes.

import { basename, dirname, join } from 'node:path';
import { measuredExec, measuredRun } from '../measured.mjs';

// A change to anything that decides selection or runs the suite cannot be judged by the selector.
export const SELECTOR_INPUTS = new Set([
  'bin/lib/test-selection.mjs', 'bin/test-select.mjs', 'bin/lib/tracked-imports.mjs',
  'bin/gate-tests.mjs', 'bin/gate-tests-core.mjs', 'bin/lib/head-partition.mjs', 'package.json',
]);

// Tests that run OTHER test files they choose by a pattern over test source. No edge can see that
// choice, so each is declared with its pattern and selected whenever a test it would run is.
// bin/test/test-selection.test.mjs fails if a pattern here stops matching the runner's own source.
export const RUNNER_TESTS = new Map([
  ['bin/test/store-contamination.test.mjs', /(gate-spine|gate-tests|gate-ratchet|touch-ledger|spine-ledger|agent-tag|issue-loop|verdict-journal(?:-core)?|adjudicat\w*)\.mjs/],
]);

const FILE_TOKEN = /[A-Za-z0-9_][A-Za-z0-9_.-]*\.[A-Za-z0-9]+/g;

function fixtureOwner(path) {
  const m = path.match(/^(.*\/test)\/fixtures\/([^/]+)/);
  return m ? { testDir: m[1], name: m[2] } : null;
}

/**
 * @param changed  repo-relative paths that differ from HEAD (edited, added or deleted)
 * @param modules  Map path -> { deps: string[] | null, text: string | null, raw?: string }; deps null = unparseable,
 *                 text is what mentions are read from, raw is the source a runner's pattern reads
 * @param tests    every test file path in the suite's population
 * -> { mode: 'full', reason } | { mode: 'none', reason } | { mode: 'selective', tests, why: Map test -> reason }
 */
export function planSelection({ changed, modules, tests, runners = RUNNER_TESTS }) {
  const files = [...new Set(changed)].filter(Boolean).sort();
  if (!files.length) return { mode: 'none', reason: 'nothing differs from HEAD' };

  const gate = files.find((f) => SELECTOR_INPUTS.has(f));
  if (gate) return { mode: 'full', reason: `${gate} decides selection or runs the suite` };

  const unparseable = files.find((f) => modules.get(f)?.deps === null);
  if (unparseable) return { mode: 'full', reason: `${unparseable} could not be parsed, so its imports are unknown` };

  const importers = new Map();
  for (const [from, m] of modules) {
    for (const to of m.deps || []) {
      if (!importers.has(to)) importers.set(to, new Set());
      importers.get(to).add(from);
    }
  }
  // Mentions are followed at every step, not only from the changed file: a test that spawns
  // rollup.mjs by path executes everything rollup.mjs imports, and names none of it.
  const mentioners = new Map();
  for (const [path, m] of modules) {
    for (const [token] of (m.text || '').matchAll(FILE_TOKEN)) {
      if (!mentioners.has(token)) mentioners.set(token, new Set());
      mentioners.get(token).add(path);
    }
  }
  const testSet = new Set(tests);
  const why = new Map();
  const note = (t, reason) => { if (!why.has(t)) why.set(t, reason); };

  for (const f of files) {
    const seeds = new Map([[f, 'changed']]);
    const owner = fixtureOwner(f);
    if (owner) {
      for (const t of tests) {
        if (dirname(t) === owner.testDir && modules.get(t)?.text?.includes(owner.name)) seeds.set(t, `uses fixture ${owner.name}`);
      }
    }

    const reached = new Map(seeds);
    const queue = [...seeds.keys()];
    while (queue.length) {
      const at = queue.pop();
      const name = basename(at);
      const next = [
        ...[...(importers.get(at) || [])].map((up) => [up, `imports ${at}`]),
        ...[...(mentioners.get(name) || [])].map((up) => [up, `names ${name}`]),
      ];
      for (const [up, reason] of next) {
        if (!reached.has(up)) { reached.set(up, reason); queue.push(up); }
      }
    }
    for (const [runner, pattern] of runners) {
      if (reached.has(runner) || !testSet.has(runner)) continue;
      const run = [...reached.keys()].find((p) => p !== runner && testSet.has(p) && pattern.test(modules.get(p)?.raw ?? modules.get(p)?.text ?? ''));
      if (run) reached.set(runner, `runs ${run}`);
    }
    let selectedHere = 0;
    for (const [path, reason] of reached) {
      if (!testSet.has(path)) continue;
      selectedHere++;
      note(path, path === f ? 'changed' : `${f}: ${reason}`);
    }
    // A change nothing is known to consume is not a change nothing consumes.
    if (!selectedHere) return { mode: 'full', reason: `no test is known to reach ${f}` };
  }

  return { mode: 'selective', tests: [...why.keys()].sort(), why };
}

/**
 * Whether a Stop-hook turn may run only the selected tests.
 * @param plan      planSelection's result, or null when it could not be computed
 * @param lastFull  { at: ISO string, names: string[] } from the last full run, or null
 * -> { run: 'selective' | 'skip' | 'full', reason }
 */
export function turnDecision(plan, lastFull, { now = Date.now(), fullEveryMs = 6 * 3600_000 } = {}) {
  const at = Date.parse(lastFull?.at ?? '');
  if (!lastFull || !Array.isArray(lastFull.names) || !Number.isFinite(at)) {
    return { run: 'full', reason: 'no full run is on record to compare a selection against' };
  }
  const age = now - at;
  if (age < 0 || age >= fullEveryMs) return { run: 'full', reason: `the last full run was ${Math.round(age / 60_000)} min ago, and a full run is due every ${Math.round(fullEveryMs / 60_000)} min` };
  if (plan?.mode === 'full') return { run: 'full', reason: String(plan.reason) };
  if (plan?.mode === 'none') return { run: 'skip', reason: String(plan.reason) };
  if (plan?.mode === 'selective' && Array.isArray(plan.tests) && plan.tests.length && plan.tests.every((t) => typeof t === 'string')) {
    return { run: 'selective', reason: `${plan.tests.length} test file(s) can reach this turn's changes` };
  }
  return { run: 'full', reason: 'the selection could not be computed' };
}

/** Failures in a selective run that the last full run did not already record. */
export function freshFailures(names, lastFullNames) {
  const known = new Set(lastFullNames);
  return [...new Set(names)].filter((n) => !known.has(n));
}

/** Relative dependency specifiers resolved against the module set, first candidate that exists. */
export function resolveDeps(fromFile, specs, exists) {
  const out = [];
  for (const spec of specs) {
    const base = join(dirname(fromFile), spec);
    const hit = [base, `${base}.mjs`, `${base}.js`, join(base, 'index.mjs'), join(base, 'index.js')].find(exists);
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Run the selector and record the measurement. CW_GATE_TESTS_SELECT_CMD is a shell line the operator
 * wrote; the default runs test-select.mjs as an argv, because JSON quoting is not shell quoting and a
 * checkout path holding `$` or a backtick would be expanded.
 */
export function runSelector(repo, { env = process.env, timeout = 180_000 } = {}) {
  const cmd = env.CW_GATE_TESTS_SELECT_CMD;
  if (cmd) return measuredExec(cmd, cmd, { cwd: repo, timeout });
  return measuredRun('test-select --json', [join(repo, 'bin', 'test-select.mjs'), '--json'], { cwd: repo, timeout });
}
