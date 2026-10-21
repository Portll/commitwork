// The Linux host sandbox, measured on what an ordinary lane needs: /dev/null and the other data
// devices open inside it, under no network and under the pasta namespace alike, and a declared
// write that does not exist on this host leaves the lane running with that path read-only. Each
// allowance sits beside a control the sandbox must still refuse. Skips with the reason where Linux,
// bwrap or pasta is absent, because a not-run confinement check is not a pass.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostSandboxArgv } from '../lib/sandbox.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const has = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 20_000 }); return !r.error && r.status === 0; };
const bwrapOk = process.platform === 'linux' && has('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true']);
const bwrapSkip = process.platform !== 'linux' ? 'not Linux: the bwrap and pasta confinement is NOT verified here'
  : (bwrapOk ? false : 'bwrap cannot create a namespace on this host: confinement NOT verified here');
const pastaSkip = bwrapSkip || (has('pasta', ['--version']) ? false : 'pasta (package passt) is absent: open-lane confinement NOT verified here');

// Under the home directory, not TMPDIR or /tmp: /tmp is a fresh tmpfs inside the lane and TMPDIR is
// writable by design, so a fixture there would be missing or pass a refusal for the wrong reason.
const T = bwrapSkip ? null : realpathSync(mkdtempSync(join(homedir(), '.cw-sbx-dev-')));
after(() => { if (T) rmSync(T, { recursive: true, force: true }); });
const run = (cmd, over = {}) => {
  const repo = join(T, 'repo'); const report = join(T, 'report'); const home = join(T, 'home');
  for (const d of [repo, report, home]) mkdirSync(d, { recursive: true });
  const { argv } = hostSandboxArgv({
    cmd, egress: 'none', repoPath: repo, reportDir: report, platform: 'linux', cwRoot: realpathSync(CW),
    nodePrefix: dirname(dirname(realpathSync(process.execPath))), tmpDir: realpathSync(tmpdir()), home, ...over,
  });
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: repo, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home } });
  return { status: r.status, out: `${r.stdout}`.trim(), err: `${r.stderr}`.trim() };
};
const DEVICES = 'for d in null zero full random urandom; do head -c 1 /dev/$d >/dev/null || exit 3; done; echo x > /dev/null || exit 4; git --version >/dev/null || exit 5; node -e "process.exitCode = require(\'node:child_process\').spawnSync(\'true\', { stdio: \'ignore\' }).error ? 6 : 0" || exit 6; echo DEVICES';

describe('Linux lane devices, measured', { skip: bwrapSkip }, () => {
  test('a lane with no network opens the data devices, spawns git and ignores stdio; a write to the tree is still refused (the control)', () => {
    const r = run(DEVICES);
    assert.equal(r.out, 'DEVICES', `exit ${r.status}: ${r.err}`);
    const control = run('echo x > leak && echo WROTE');
    assert.notEqual(control.out, 'WROTE', 'the read-only root let a lane write the scanned tree');
    assert.equal(existsSync(join(T, 'repo', 'leak')), false);
  });

  test('a declared write absent on this host neither refuses the lane nor becomes writable; a present one is writable (the control)', () => {
    const present = join(T, 'home', '.cache', 'tool'); mkdirSync(present, { recursive: true });
    const r = run('touch "$HOME/.cache/tool/ok" && echo PRESENT; mkdir -p "$HOME/Library/Caches/tool" 2>/dev/null && echo ABSENT-WROTE; echo RAN', {
      extraWrites: ['~/Library/Caches/tool', '~/.cache/tool'],
    });
    assert.match(r.out, /PRESENT/, `exit ${r.status}: ${r.err}`);
    assert.match(r.out, /RAN/);
    assert.doesNotMatch(r.out, /ABSENT-WROTE/, 'an absent declared write became writable');
    assert.ok(existsSync(join(present, 'ok')));
    assert.equal(existsSync(join(T, 'home', 'Library')), false);
  });
});

describe('Linux lane devices behind pasta, measured', { skip: pastaSkip }, () => {
  test('an open lane opens the data devices too: the device binds and the pasta namespace coexist', () => {
    const r = run(DEVICES, { egress: 'registry' });
    assert.equal(r.out, 'DEVICES', `exit ${r.status}: ${r.err}`);
  });
});
