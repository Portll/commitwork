// bin/update.mjs (commitwork update): argument parsing, the token commands, how a run is wired to
// lib/update/run.mjs, the exit codes, and the subcommand's registration in bin/commitwork.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { main, parseUpdateArgs, EXIT } from '../update.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const TOKEN = 'ghp_' + 'b'.repeat(36);

function rig({ result = { outcome: 'current', code: 0 }, tok = { token: null, source: null }, isTTY = false, stdin = '' } = {}) {
  const w = { err: '', runs: [], stored: [], deleted: 0 };
  w.deps = {
    env: { PORTLL_GITHUB_CLIENT_ID: 'Iv1.test' },
    stdin: Readable.from([stdin]),
    stderr: { write: (s) => { w.err += s; } },
    fetch: async () => { throw new Error('no network in this test'); },
    settings: () => ({ auto: 'install', channel: 'stable', sources: ['portll', 'github'] }),
    run: async (o) => { w.runs.push(o); if (o.mode === 'install' && w.confirmWith !== undefined) w.confirmed = await o.confirm('2.0.0'); return result; },
    tokens: {
      resolveToken: () => tok,
      storeToken: (t) => { w.stored.push(t); if (t === 'bad') throw new Error('that is not a GitHub or update token'); return { where: 'file', file: '/cfg/update-token' }; },
      deleteToken: () => { w.deleted++; return w.deleted === 1 ? { where: 'keychain' } : null; },
      requestDeviceCode: async ({ clientId }) => { if (!clientId) throw new Error('PORTLL_GITHUB_CLIENT_ID is not set'); return { deviceCode: 'dc', userCode: 'WXYZ-9876', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 }; },
      pollDeviceToken: async () => TOKEN,
    },
    dir: () => '/cfg',
    isTTY,
  };
  return w;
}

describe('parseUpdateArgs', () => {
  test('reads every flag, in both value forms', () => {
    // Arrange
    const argv = ['--check', '--channel', 'beta', '--source=github', '-y'];
    // Act
    const { opts } = parseUpdateArgs(argv);
    // Assert
    assert.deepEqual(opts, { check: true, yes: true, login: false, tokenStdin: false, logout: false, channel: 'beta', source: 'github' });
  });

  test('refuses unknown arguments, bad values and two token commands at once', () => {
    // Arrange
    const cases = [['--force'], ['--channel', 'nightly'], ['--source', 'ftp'], ['--login', '--logout'], ['--channel']];
    // Act
    const errors = cases.map((c) => parseUpdateArgs(c).error);
    // Assert
    assert.match(errors[0], /unknown argument "--force"/);
    assert.match(errors[1], /stable or beta/);
    assert.match(errors[2], /portll or github/);
    assert.match(errors[3], /separate runs/);
    assert.match(errors[4], /--channel needs a value/);
  });
});

describe('a run', () => {
  test('--check runs in check mode with the settings channel and sources, and the resolved token', async () => {
    // Arrange
    const w = rig({ result: { outcome: 'available', code: 10 }, tok: { token: TOKEN, source: 'gh' } });
    // Act
    const code = await main(['--check'], w.deps);
    // Assert
    assert.equal(code, EXIT.AVAILABLE);
    assert.deepEqual([w.runs[0].mode, w.runs[0].channel, w.runs[0].sources, w.runs[0].token], ['check', 'stable', ['portll', 'github'], TOKEN]);
  });

  test('--channel and --source override the settings', async () => {
    // Arrange
    const w = rig();
    // Act
    await main(['--channel', 'beta', '--source', 'github'], w.deps);
    // Assert
    assert.deepEqual([w.runs[0].mode, w.runs[0].channel, w.runs[0].sources], ['install', 'beta', ['github']]);
  });

  test('without a terminal and without --yes nothing is installed; --yes confirms', async () => {
    // Arrange
    const quiet = rig(); quiet.confirmWith = true;
    const yes = rig(); yes.confirmWith = true;
    // Act
    await main([], quiet.deps);
    await main(['--yes'], yes.deps);
    // Assert
    assert.equal(quiet.confirmed, false);
    assert.match(quiet.err, /pass --yes to install it without a terminal/);
    assert.equal(yes.confirmed, true);
  });

  test('on a terminal the operator is asked', async () => {
    // Arrange
    const w = rig({ isTTY: true, stdin: 'y\n' }); w.confirmWith = true;
    // Act
    await main([], w.deps);
    // Assert
    assert.equal(w.confirmed, true);
    assert.match(w.err, /Install commitwork 2\.0\.0\? \[y\/N\]/);
  });

  test('an install says where and that running copies need a restart; a failure prints its detail', async () => {
    // Arrange
    const ok = rig({ result: { outcome: 'installed', code: 0, version: '2.0.0', dest: '/p/lib/commitwork' } });
    const bad = rig({ result: { outcome: 'refused', code: 20, detail: 'sha256 differs' } });
    const warn = rig({ tok: { token: null, source: null, warning: 'update-token is readable by other users' } });
    // Act
    const a = await main([], ok.deps);
    const b = await main([], bad.deps);
    await main([], warn.deps);
    // Assert
    assert.equal(a, 0);
    assert.match(ok.err, /installed commitwork 2\.0\.0 in \/p\/lib\/commitwork\. Restart the panel/);
    assert.equal(b, 20);
    assert.match(bad.err, /refused: sha256 differs/);
    assert.match(warn.err, /readable by other users/);
  });

  test('usage errors exit 2, and --help exits 0', async () => {
    // Arrange
    const w = rig();
    // Act
    const bad = await main(['--nope'], w.deps);
    const help = await main(['--help'], w.deps);
    // Assert
    assert.equal(bad, EXIT.USAGE);
    assert.equal(help, EXIT.OK);
    assert.match(w.err, /usage: commitwork update/);
  });
});

describe('the token commands', () => {
  test('--login prints the device URL and code, polls, and stores the token', async () => {
    // Arrange
    const w = rig();
    // Act
    const code = await main(['--login'], w.deps);
    // Assert
    assert.equal(code, 0);
    assert.match(w.err, /open https:\/\/github\.com\/login\/device and enter the code WXYZ-9876/);
    assert.deepEqual(w.stored, [TOKEN]);
    assert.match(w.err, /signed in; token stored \(\/cfg\/update-token\)/);
  });

  test('--login without a client id fails with 23', async () => {
    // Arrange
    const w = rig();
    w.deps.env = {};
    // Act
    const code = await main(['--login'], w.deps);
    // Assert
    assert.equal(code, EXIT.LOGIN_FAILED);
    assert.match(w.err, /PORTLL_GITHUB_CLIENT_ID is not set/);
  });

  test('--token-stdin stores what stdin carries, trimmed, and refuses a bad one', async () => {
    // Arrange
    const ok = rig({ stdin: `${TOKEN}\n` });
    const bad = rig({ stdin: 'bad' });
    // Act
    const a = await main(['--token-stdin'], ok.deps);
    const b = await main(['--token-stdin'], bad.deps);
    // Assert
    assert.equal(a, 0);
    assert.deepEqual(ok.stored, [TOKEN]);
    assert.equal(b, EXIT.LOGIN_FAILED);
  });

  test('--logout removes the stored token, and says when there was none', async () => {
    // Arrange
    const w = rig();
    // Act
    await main(['--logout'], w.deps);
    await main(['--logout'], w.deps);
    // Assert
    assert.match(w.err, /removed the stored token \(keychain\)/);
    assert.match(w.err, /no token was stored/);
  });

  test('storing to the Keychain names the item', async () => {
    // Arrange
    const w = rig({ stdin: TOKEN });
    w.deps.tokens.storeToken = () => ({ where: 'keychain', item: 'PORTLL_UPDATE_TOKEN' });
    // Act
    await main(['--token-stdin'], w.deps);
    // Assert
    assert.match(w.err, /Keychain item PORTLL_UPDATE_TOKEN/);
  });
});

describe('bin/commitwork.mjs', () => {
  test('update is a registered command that writes no report directory', () => {
    // Arrange
    const env = { ...process.env, CW_SETTINGS: '/nonexistent/settings.json' };
    delete env.CW_REPORT_DIR;
    // Act
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'commitwork.mjs'), 'update', '--bogus'], { encoding: 'utf8', env });
    // Assert
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown argument "--bogus"/);
    assert.doesNotMatch(r.stderr, /CW_REPORT_DIR was not set/);
  });
});
