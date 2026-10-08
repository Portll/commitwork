// bin/commitwork.mjs `requires.secrets` — a missing CREDENTIAL is not a broken TOOL. Pins:
// (1) an undeclared, unstored secret BLOCKS with a named reason; (2) env vars and keychain refs
// both satisfy it, with `undeclared` vs `not-found` carried distinctly; (3) the resolved value
// actually reaches the declaring command — the keychain→spawn carrier once shipped broken.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'commitwork.mjs');

// A repo + manifest whose one check declares a secret and, if it ever runs, PROVES whether the
// value reached it by writing the env var it received into the report.
function fixture({ secretName = 'CW_TEST_TOKEN' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-reqsec-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', version: '1.0.0' }));
  const manifest = {
    repo: 'fx',
    repoPath: dir,
    checks: [{
      id: 'needs-secret',
      description: 'writes whatever token it was handed',
      local: [`printf '%s' "\${${secretName}:-ABSENT}" > "$CW_REPORT_DIR/token.txt"`],
      report: { file: 'token.txt', format: 'text' },
      requires: { secrets: [secretName] },
      groups: ['all'],
    }],
    groups: { all: ['needs-secret'] },
  };
  const mf = join(dir, 'manifest.json');
  writeFileSync(mf, JSON.stringify(manifest));
  // CW_REPORT_DIR is set by the SWEEP — without it the command fails in a way that mimics a secrets failure
  const reportDir = join(dir, 'out');
  mkdirSync(reportDir, { recursive: true });
  return { dir, mf, secretName, reportDir };
}

const run = (args, env = {}) => {
  try {
    return execFileSync(process.execPath, [CLI, ...args],
      { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
};

describe('requires.secrets — a credential gap names itself', () => {
  test('an unstored, undeclared secret BLOCKS the check and says which one', () => {
    const { dir, mf, secretName } = fixture();
    const out = run(['list', '--manifest', mf, '--repo', dir], { CW_SECRETS_FILE: join(dir, 'none.json') });
    assert.match(out, /needs-secret/);
    assert.match(out, /blocked/, 'a check whose credential is absent must not read as ready');
    assert.match(out, new RegExp(`secret:${secretName}`), 'the missing secret must be NAMED');
    assert.match(out, /undeclared/, 'and its reason distinguished — nothing was even recorded for it');
  });

  test('the run path SKIPS it with that reason — it must never execute and produce a void', () => {
    const fx = fixture();
    const { dir, mf } = fx;
    const { reportDir } = fx;
    const out = run(['run', 'all', '--manifest', mf, '--repo', dir],
      { CW_SECRETS_FILE: join(dir, 'none.json'), CW_REPORT_DIR: reportDir });
    assert.match(out, /n\/a — secret:CW_TEST_TOKEN/, 'skipped for a named credential reason');
    assert.equal(/✓ pass/.test(out), false, 'a check missing its credential must not report pass');
  });

  test('an env var satisfies it', () => {
    const { dir, mf } = fixture();
    const out = run(['list', '--manifest', mf, '--repo', dir],
      { CW_TEST_TOKEN: 'from-env', CW_SECRETS_FILE: join(dir, 'none.json') });
    assert.match(out, /ready/, 'a credential present in the environment satisfies the requirement');
    assert.equal(/blocked/.test(out), false);
  });

  test('a keychain REF that does not resolve reports not-found, NOT undeclared', () => {
    // undeclared = never recorded; not-found = recorded but the item is missing — different fixes
    const { dir, mf } = fixture();
    const table = join(dir, 'secrets.json');
    writeFileSync(table, JSON.stringify({
      version: 1, secrets: { CW_TEST_TOKEN: `keychain:commitwork/cw-absent-${process.pid}` },
    }));
    const out = run(['list', '--manifest', mf, '--repo', dir], { CW_SECRETS_FILE: table });
    assert.match(out, /secret:CW_TEST_TOKEN/);
    assert.equal(/undeclared/.test(out), false, 'a recorded ref is a declaration — do not call it undeclared');
    assert.match(out, process.platform === 'darwin' ? /not-found/ : /unsupported-platform/);
  });

  test('the resolved value reaches the declaring command, and is not printed', () => {
    const { dir, mf, reportDir } = fixture();
    const out = run(['run', 'all', '--manifest', mf, '--repo', dir],
      { CW_TEST_TOKEN: 'sentinel-value-42', CW_SECRETS_FILE: join(dir, 'none.json'), CW_REPORT_DIR: reportDir });
    assert.match(out, /✓ pass/, 'with the credential present the check runs');
    // the command echoes what it received into its report; the CLI must not echo it to stdout
    assert.equal(out.includes('sentinel-value-42'), false,
      'the credential must not appear in the run output — only the command line is printed');
  });
});

// The keychain → spawn carrier, end to end against a throwaway keychain item — nothing else exercises it.
describe('a keychain-held secret actually reaches the command', () => {
  const SERVICE = 'commitwork-test';
  const ACCOUNT = `cw-fixture-${process.pid}`;
  const VALUE = 'fixture-value-not-a-credential';
  let unavailable = process.platform === 'darwin' ? null : 'the keychain is macOS only';
  let attempted = false;

  before(() => {
    if (unavailable) return;
    // Under a HOME with no default keychain (a clean-export run's scratch HOME), add-generic-password
    // opens a "keychain cannot be found" dialog and the suite blocks on it; this probe exits 1 instead.
    if (spawnSync('security', ['default-keychain', '-d', 'user'], { timeout: 15_000 }).status !== 0) {
      unavailable = 'this HOME has no default keychain, so the keychain carrier was NOT verified here';
      return;
    }
    attempted = true;
    // a fixture string, not a secret — the argv rule exists to protect real credentials
    const r = spawnSync('security', ['add-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w', VALUE, '-U'], { timeout: 30_000 });
    if (r.status !== 0) unavailable = `security add-generic-password failed (${r.error ? r.error.message : `exit ${r.status}`}), so the keychain carrier was NOT verified here`;
  });
  after(() => {
    if (!attempted) return;
    spawnSync('security', ['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE], { stdio: 'ignore', timeout: 30_000 });
  });

  test('resolved from the keychain, it arrives in the declaring command', (t) => {
    if (unavailable) return t.skip(unavailable);
    const { dir, mf, reportDir } = fixture();
    const table = join(dir, 'secrets.json');
    writeFileSync(table, JSON.stringify({
      version: 1, secrets: { CW_TEST_TOKEN: `keychain:${SERVICE}/${ACCOUNT}` },
    }));
    // CW_TEST_TOKEN deliberately NOT in the env — the keychain is the only source
    const out = run(['run', 'all', '--manifest', mf, '--repo', dir],
      { CW_SECRETS_FILE: table, CW_REPORT_DIR: reportDir, CW_TEST_TOKEN: undefined });
    assert.match(out, /✓ pass/, 'the check must run once the secret resolves');
    const got = readFileSync(join(reportDir, 'token.txt'), 'utf8');
    assert.equal(got, VALUE, `the command received ${JSON.stringify(got)} — the keychain value never arrived`);
  });

  // The scan path resolved the secret, applied the lane on it, and then ran the command without it.
  test('the scan path hands it to the declaring command as well', (t) => {
    if (unavailable) return t.skip(unavailable);
    const { dir, mf } = fixture();
    execFileSync('git', ['init', '-q', dir]);
    const table = join(dir, 'secrets.json');
    writeFileSync(table, JSON.stringify({ version: 1, secrets: { CW_TEST_TOKEN: `keychain:${SERVICE}/${ACCOUNT}` } }));
    const out = mkdtempSync(join(tmpdir(), 'cw-reqsec-scan-'));
    run(['scan', '--manifest', mf, '--root', dir, '--out', out], { CW_SECRETS_FILE: table, CW_TEST_TOKEN: undefined });
    const got = readFileSync(join(out, basename(dir), 'token.txt'), 'utf8');
    assert.equal(got, VALUE, `the scanned command received ${JSON.stringify(got)} — the keychain value never arrived`);
  });
});
