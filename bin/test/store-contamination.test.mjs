// The suite must not write to a PRODUCTION store. Asserted as an EFFECT.
//
// `.claude/store` and `.claude/verdicts` are directory symlinks into a private sidecar repo, so a
// test that seams its inputs and not its outputs writes into another repository's tracked history.
// Two files did: 809 of 993 gate-spine journal records and 28,837 of 28,838 agent-tag rows are
// fixtures. Those rows are inside verdict-journal's `prev` hash chain, so excising them now reads
// as an interior edit — the cost compounds.
//
// HOW THIS WORKS, and why it is not the obvious thing. The first version of this guard counted
// FIXTURE SIGNATURES in the live stores — a known session id, a frozen CW_NOW. An independent
// witness broke it in two moves: rename the fixture constants inside the guarded files (nine
// contaminating writes, guard green), or add a NEW unseamed test whose session is a plausible
// random uuid (a real row into the production store, guard green). It also fired a false positive
// on an unrelated rotation, publishing `+-7` as a finding. A signature is a marker.
//
// So the store is RELOCATED instead of inspected. Every default resolves through CW_STORE_DIR,
// CW_VERDICT_DIR or CW_HOOK_STATE, so pointing those at an empty directory makes the DEFAULT path
// land there. A correctly seamed test writes to its own fixture dir and this directory stays empty;
// a test that writes to the default is caught whatever its constants are called. That also makes
// the check immune to the concurrent sessions writing to the real stores continuously, which is
// what pushed the first version toward signatures in the first place.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every test file that names a gate, ledger or journal binary. Enumerated, never a list.
 *
 * git is preferred and NOT required: a `git archive` checkout has no `.git`, and an enumeration that
 * throws there would make this guard unrunnable in exactly the isolated checkout most worth running
 * it in. The walk is the same population by a different route, so a git failure costs nothing.
 */
function candidates() {
  let out;
  try {
    out = execFileSync('git', ['ls-files', '*.test.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch {
    out = walk(ROOT).filter((f) => f.endsWith('.test.mjs') && !f.startsWith('node_modules'));
  }
  const re = /(gate-spine|gate-tests|gate-ratchet|touch-ledger|spine-ledger|agent-tag|issue-loop|verdict-journal(?:-core)?|adjudicat\w*)\.mjs/;
  return out.filter((f) => { try { return re.test(readFileSync(join(ROOT, f), 'utf8')); } catch { return false; } });
}

/** Files present anywhere under a directory, relative to it. */
function walk(dir, base = dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const p = join(dir, n);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

describe('the suite does not write to production stores', () => {
  test('no test writes to the DEFAULT store, whatever its fixtures are named', (t) => {
    const sandbox = mkdtempSync(join(tmpdir(), 'cw-storeguard-'));
    t.after(() => rmSync(sandbox, { recursive: true, force: true }));
    const store = join(sandbox, 'store');
    const verdicts = join(sandbox, 'verdicts');
    const hook = join(sandbox, 'hook-emit');
    for (const d of [store, verdicts, hook]) mkdirSync(d, { recursive: true });

    const files = candidates();
    // Floor: the population must be real. A broken enumeration yields zero files, zero writes and a
    // green guard — the shape that let a subset be read as the whole everywhere else in this repo.
    assert.ok(files.length >= 20,
      `enumeration degenerated (${files.length} candidate test files) — this guard would pass vacuously`);

    const ran = [];
    for (const f of files) {
      const env = { ...process.env, CW_STORE_DIR: store, CW_VERDICT_DIR: verdicts, CW_HOOK_STATE: hook };
      // NODE_TEST_CONTEXT is deleted deliberately. `node --test` sets it to `child-v8` in children,
      // and a nested run then does not merely go quiet — it RUNS NOTHING ("skipping running files")
      // and exits 0. Inherited, every child below would be a no-op and this guard would be green
      // because nothing executed. Measured: 0 bytes of stdout inherited, 125 cleaned.
      delete env.NODE_TEST_CONTEXT;
      // spec, named: Node 22 writes TAP to a pipe, and `silent` below reads the spec summary.
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', f], { cwd: ROOT, encoding: 'utf8', timeout: 180_000, env });
      ran.push({ f, status: r.status, out: `${r.stdout || ''}` });
    }

    // COVERAGE, not correctness — and the distinction is the whole fix. A child that did not run
    // wrote nothing, so the sandbox assertion below is still sound; what is reduced is how much of
    // the population this run actually exercised. Requiring all 30 made one unrelated flake in any
    // of thirty files render as a contamination finding, and a guard that goes red for somebody
    // else's timeout is a guard that gets deleted. Report the misses, floor the proportion.
    const silent = ran.filter((r) => !/^ℹ pass \d+/m.test(r.out));
    const covered = ran.length - silent.length;
    for (const r of silent) t.diagnostic(`uncovered: ${r.f} (exit ${r.status}) — did not report a tally, so it was not exercised`);
    if (silent.length) t.diagnostic(`coverage: ${covered}/${ran.length} candidate files exercised`);
    // The floor stops coverage degenerating silently: at 0 exercised, an empty sandbox proves
    // nothing at all and this test would be green for the emptiest possible reason.
    assert.ok(covered >= Math.ceil(ran.length * 0.8),
      `only ${covered} of ${ran.length} candidate files ran, so an empty sandbox is not evidence. `
      + `Uncovered: ${silent.map((r) => r.f).join(', ')}`);

    const written = walk(sandbox);
    assert.deepEqual(written, [],
      'a test wrote to the DEFAULT store path. Under normal operation that directory is a symlink '
      + 'into the sidecar repo, so this is a write into another repository\'s tracked history. '
      + `Files: ${written.join(', ')}`);
  });
});
