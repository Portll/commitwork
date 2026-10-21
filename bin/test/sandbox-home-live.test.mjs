// The Linux host sandbox hides the home directory (threat model R4), measured with canaries: a lane
// cannot read a file in the home it was not given, and still reads the repository and the git config
// bound back into it. Each refusal sits beside the allowance that proves the lane ran at all. Skips
// with the reason where Linux or bwrap is absent, because a not-run confinement check is not a pass.

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostSandboxArgv } from '../lib/sandbox.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bwrapOk = process.platform === 'linux' && (() => {
  const r = spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--die-with-parent', '--', '/bin/true'], { stdio: 'ignore', timeout: 20_000 });
  return !r.error && r.status === 0;
})();
const skip = process.platform !== 'linux' ? 'not Linux: the home-directory confinement is NOT verified here'
  : (bwrapOk ? false : 'bwrap cannot create a namespace on this host: the home-directory confinement is NOT verified here');

// Under the real home, not TMPDIR or /tmp: /tmp is a fresh tmpfs inside the lane, so a canary there
// would be unreadable for the wrong reason.
const T = skip ? null : realpathSync(mkdtempSync(join(homedir(), '.cw-sbx-home-')));
after(() => { if (T) rmSync(T, { recursive: true, force: true }); });
const HOME = T && join(T, 'home');
const REPO = T && join(HOME, 'work', 'repo');
const CANARY = 'CW-CANARY-7f3a';
if (T) {
  mkdirSync(join(REPO, 'src'), { recursive: true });
  mkdirSync(join(HOME, 'other-repo'), { recursive: true });
  mkdirSync(join(HOME, '.cache', 'tool'), { recursive: true });
  mkdirSync(join(T, 'report'));
  writeFileSync(join(REPO, 'src', 'app.js'), 'REPO-OK\n');
  writeFileSync(join(HOME, '.gitconfig'), '[user]\n\tname = canary\n');
  writeFileSync(join(HOME, '.bash_history'), `${CANARY} history\n`);
  writeFileSync(join(HOME, 'other-repo', '.env'), `${CANARY} env\n`);
}

const run = (cmd, over = {}) => {
  const { argv } = hostSandboxArgv({
    cmd, egress: 'none', repoPath: REPO, reportDir: join(T, 'report'), platform: 'linux', cwRoot: realpathSync(CW),
    nodePrefix: dirname(dirname(realpathSync(process.execPath))), tmpDir: realpathSync(tmpdir()), home: HOME, ...over,
  });
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', cwd: REPO, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME } });
  return { status: r.status, out: `${r.stdout}`.trim(), err: `${r.stderr}`.trim() };
};

describe('Linux lane home directory, measured with canaries', { skip }, () => {
  test('the lane reads the repository and the git config bound back into the home (the control)', () => {
    const r = run('cat src/app.js && git config --global user.name');
    assert.equal(r.out, 'REPO-OK\ncanary', `exit ${r.status}: ${r.err}`);
  });

  test('a file in the home the lane was not given is unreadable, and the home lists only what was bound back', () => {
    const r = run(`cat "$HOME/.bash_history" "$HOME/other-repo/.env" 2>/dev/null; ls -A "$HOME"; echo RAN`);
    assert.match(r.out, /RAN/, `exit ${r.status}: ${r.err}`);
    assert.doesNotMatch(r.out, new RegExp(CANARY), 'a canary in the home was read');
    assert.doesNotMatch(r.out, /other-repo|\.bash_history/, 'the home still lists entries outside the read set');
  });

  test('the home is read-only, and a declared write under it is writable (the control)', () => {
    const r = run('touch "$HOME/planted" 2>/dev/null && echo PLANTED; touch "$HOME/.cache/tool/ok" && echo CACHED; echo RAN', { extraWrites: ['~/.cache/tool'] });
    assert.match(r.out, /CACHED/, `exit ${r.status}: ${r.err}`);
    assert.doesNotMatch(r.out, /PLANTED/, 'the hidden home accepted a write');
    assert.ok(existsSync(join(HOME, '.cache', 'tool', 'ok')));
    assert.equal(existsSync(join(HOME, 'planted')), false);
  });

  const pastaOk = spawnSync('pasta', ['--version'], { stdio: 'ignore', timeout: 20_000 }).status === 0;
  test('an open lane behind pasta hides the home the same way', { skip: pastaOk ? false : 'pasta (package passt) is absent: the open-lane home is NOT verified here' }, () => {
    const r = run(`cat src/app.js; cat "$HOME/.bash_history" 2>/dev/null; echo RAN`, { egress: 'registry' });
    assert.match(r.out, /REPO-OK[\s\S]*RAN/, `exit ${r.status}: ${r.err}`);
    assert.doesNotMatch(r.out, new RegExp(CANARY), 'a canary in the home was read by an open lane');
  });

  test('a declared read of the whole home brings it back, with the credential stores still masked', () => {
    mkdirSync(join(HOME, '.ssh'), { recursive: true });
    writeFileSync(join(HOME, '.ssh', 'id_ed25519'), `${CANARY} key\n`);
    const r = run('cat "$HOME/.bash_history"; cat "$HOME/.ssh/id_ed25519" 2>/dev/null; echo RAN', { extraReads: ['~/'] });
    assert.match(r.out, new RegExp(`${CANARY} history`), `exit ${r.status}: ${r.err}`);
    assert.doesNotMatch(r.out, new RegExp(`${CANARY} key`), 'a credential store was readable under a read of the home');
  });
});
