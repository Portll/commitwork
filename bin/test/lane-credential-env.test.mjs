// The host sandbox denies the keychain gh keeps its token in, so gh inside a lane ran anonymously:
// actions-health read public repos at 60 requests an hour and voided on private ones, and
// posture-scorecard and cspm-github skipped as if gh were logged out. The runner now resolves the
// session outside the sandbox, and these cases pin who may receive it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laneCredentialEnv, laneJavaEnv, laneSemgrepEnv, GH_STORE, SEMGREP_STORE } from '../lib/scanner-env.mjs';

const counting = (value) => {
  const fn = () => { fn.calls++; return value; };
  fn.calls = 0;
  return fn;
};

test('a lane that declares the gh store receives the session token', () => {
  const resolve = counting('tok');
  assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: [GH_STORE] }, {}, resolve), { GH_TOKEN: 'tok' });
  assert.equal(resolve.calls, 1);
});

test('an undeclared lane gets nothing, and the session is never asked', () => {
  const resolve = counting('tok');
  assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: ['~/.local/bin'] }, {}, resolve), {});
  assert.deepEqual(laneCredentialEnv({}, {}, resolve), {});
  assert.equal(resolve.calls, 0);
});

test('a lane that executes repository code never receives it, even when it declares the store', () => {
  const resolve = counting('tok');
  assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: [GH_STORE], executesRepoCode: true }, {}, resolve), {});
  assert.equal(resolve.calls, 0);
});

test('CI must hand a token over explicitly; the ambient session is not used', () => {
  const resolve = counting('tok');
  assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: [GH_STORE] }, { CI: 'true' }, resolve), {});
  assert.equal(resolve.calls, 0);
});

test('a token the operator already set is left alone', () => {
  const resolve = counting('tok');
  for (const env of [{ GH_TOKEN: 'mine' }, { GITHUB_TOKEN: 'mine' }]) {
    assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: [GH_STORE] }, env, resolve), {});
  }
  assert.equal(resolve.calls, 0);
});

test('no session resolves to no variable, not an empty one', () => {
  assert.deepEqual(laneCredentialEnv({ sandboxExtraReads: [GH_STORE] }, {}, counting('')), {});
});

test('a lane that runs java gets JAVA_HOME resolved outside the sandbox, and nothing else does', () => {
  const resolve = () => '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home';
  const java = { requires: { tools: ['codeql', 'java'] } };
  assert.deepEqual(laneJavaEnv(java, {}, resolve), { JAVA_HOME: '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home' });
  assert.deepEqual(laneJavaEnv(java, { JAVA_HOME: '/theirs' }, resolve), {}, 'an inherited JAVA_HOME wins');
  assert.deepEqual(laneJavaEnv({ requires: { tools: ['codeql'] } }, {}, resolve), {}, 'a lane without java gets nothing');
  assert.deepEqual(laneJavaEnv(java, {}, () => ''), {}, 'an unresolvable JDK sets nothing rather than an empty JAVA_HOME');
});

test('a sandboxed Semgrep lane keeps its three user files inside the declared store, whatever XDG says', () => {
  const sast = { requires: { tools: ['semgrep'] }, sandboxExtraWrites: [SEMGREP_STORE] };
  assert.deepEqual(laneSemgrepEnv(sast, '/home/runner'), {
    SEMGREP_SETTINGS_FILE: '/home/runner/.semgrep/settings.yml',
    SEMGREP_LOG_FILE: '/home/runner/.semgrep/semgrep.log',
    SEMGREP_VERSION_CACHE_PATH: '/home/runner/.semgrep/semgrep_version',
  });
  assert.deepEqual(laneSemgrepEnv({ requires: { tools: ['semgrep'] } }, '/home/runner'), {}, 'no declared store, no pin into a path the sandbox denies');
  assert.deepEqual(laneSemgrepEnv({ requires: { tools: ['opengrep'] }, sandboxExtraWrites: [SEMGREP_STORE] }, '/home/runner'), {}, 'another tool is not handed Semgrep variables');
});

test('every manifest lane that runs semgrep declares the store its pin points into', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
  const lanes = manifest.checks.filter((c) => (c.requires?.tools || []).includes('semgrep'));
  assert.ok(lanes.length >= 2, 'sast and sast-auto');
  for (const c of lanes) {
    assert.ok((c.sandboxExtraWrites || []).includes(SEMGREP_STORE), `${c.id} declares ${SEMGREP_STORE}`);
    assert.equal(Object.keys(laneSemgrepEnv(c, '/h')).length, 3, `${c.id} is pinned`);
    assert.ok(!(c.sandboxExtraWrites || []).some((w) => w.includes('semgrep_version')), `${c.id} declares no version cache outside the store`);
  }
});
