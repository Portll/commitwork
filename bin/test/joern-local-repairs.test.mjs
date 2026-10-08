// bin/test/joern-local-repairs.test.mjs — the preflight for joernwork's local joern repairs.
//
// WHY A TEST AND NOT A NOTE IN A README. Every repair in joernwork/ lives inside the
// Homebrew Cellar, so `brew upgrade joern` silently reverts all of it. The symptom is not an error:
// it is a scan that finds nothing and exits 0. fix-local-joern.sh says "run this after any joern
// upgrade" and nothing enforced it, which is the remembered-instead-of-enforced shape this repo
// keeps paying for. The suite asks now.
//
// SKIPS WHEN JOERN IS ABSENT, FAILS WHEN JOERN IS PRESENT AND UNREPAIRED. That asymmetry is the
// whole design: a box without joern has nothing to assert, but a box WITH joern and a reverted
// repair is publishing a lane that cannot find anything. Absent is a legitimate skip; present and
// broken is never one.
//
// Cheap by construction — it reads files and resolves paths. It never invokes joern, which takes
// 60-90s per scan and would put a JVM in the unit suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** The joern prefix, or null when joern is not installed here. */
function joernPrefix() {
  if (process.env.CW_JOERN_PREFIX) return existsSync(process.env.CW_JOERN_PREFIX) ? process.env.CW_JOERN_PREFIX : null;
  try {
    const p = execFileSync('brew', ['--prefix', 'joern'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return p && existsSync(p) ? p : null;
  } catch { return null; }
}

const PREFIX = joernPrefix();
const skip = PREFIX ? false : 'joern is not installed on this box — nothing to keep repaired';

// REPAIR 1 — the launcher must report the JVM's real exit status.
// joern-cli's joern-scan ends with `if [ $? -eq 2 ]`, and that if is the script's LAST command, so
// the script exits with the IF's status: every failure code but 2 becomes 0. That single defect is
// the root cause of four separately-recorded silent failures (unknown --format, a frontend-args
// crash, rust2cpg dying, an explicit --language husk). See joernwork/patches/01.
test('joern launcher reports the real exit code, not the retry-if\'s', { skip }, () => {
  const launcher = join(PREFIX, 'libexec', 'joern-scan');
  assert.ok(existsSync(launcher), `no launcher at ${launcher} — the distribution layout changed`);
  const s = readFileSync(launcher, 'utf8');
  assert.match(s, /exit \$status/,
    'the launcher has reverted to ending on the retry `if`, so a failed scan exits 0 and every lane '
    + 'reads a husk as a clean repository. Re-run joernwork/bin/fix-local-joern.sh');
});

// REPAIR 2 — the astgen binaries are shipped under libexec/frontends/<fe>/bin/astgen/ but
// AstGenRunner looks for <root>/bin/astgen/. Without the links, gosrc2cpg / rust2cpg / swiftsrc2cpg
// fail with "Local <x> binary not found" and joern-scan reports that as exit 0.
test('every shipped astgen binary is linked where AstGenRunner looks for it', { skip }, () => {
  const shipped = [];
  const fdir = join(PREFIX, 'libexec', 'frontends');
  if (existsSync(fdir)) {
    for (const fe of readdirSync(fdir)) {
      const d = join(fdir, fe, 'bin', 'astgen');
      if (!existsSync(d)) continue;
      for (const b of readdirSync(d)) if (statSync(join(d, b)).isFile()) shipped.push(b);
    }
  }
  assert.ok(shipped.length > 0, 'no astgen binaries found under libexec/frontends — layout changed');
  const linkDir = join(PREFIX, 'bin', 'astgen');
  const linked = existsSync(linkDir) ? new Set(readdirSync(linkDir)) : new Set();
  const missing = shipped.filter((b) => !linked.has(b));
  assert.deepEqual(missing, [],
    `${missing.length} astgen binary/binaries are shipped but not linked into bin/astgen: the `
    + 'frontends that need them fail and joern-scan still exits 0. Re-run '
    + 'joernwork/bin/fix-local-joern.sh');
});

// REPAIR 3 — jssrc2cpg passes a BARE RELATIVE `astgen` to ProcessBuilder, which Java resolves
// against the process CWD rather than PATH. Measured 2026-09-02: from a cwd with no ./astgen the
// JS CPG comes back 4,607 bytes with 0 methods; from a cwd containing one, 55,398 bytes and 27
// methods. This assertion does not fix that — it records that SOMETHING named astgen is resolvable,
// so a box that has lost it is told rather than left producing empty JS graphs.
test('an astgen executable is resolvable — jssrc2cpg cannot build a CPG without one', { skip }, () => {
  const onPath = (() => {
    try { execFileSync('command', ['-v', 'astgen'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] }); return true; }
    catch { return false; }
  })();
  const linked = existsSync(join(PREFIX, 'bin', 'astgen'));
  assert.ok(onPath || linked,
    'no astgen on PATH and none linked under the joern prefix. jssrc2cpg resolves a bare relative '
    + '"astgen" against the process CWD, so every JS scan silently produces an empty CPG');
});
