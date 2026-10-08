// bin/verify-branch-protection.mjs with a FAKE `gh` first on a PATH that holds no real one, so no
// query leaves the machine. The fake answers `gh api <path>` from canned files (stdout body + exit
// code, the way gh prints an HTTP error's JSON body and exits 1). Pins the exit contract —
// 0 PASS, 3 MISMATCH, 4 CANNOT-VERIFY — including the two readings that must not be confused: a
// CONFIRMED-unprotected branch missing an expected check is a MISMATCH, while an unconfirmed read is
// CANNOT-VERIFY and never green; plus the manifest and gh preflight refusals, and --snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'verify-branch-protection.mjs');
const POSIX = process.platform !== 'win32';

// `gh api a/b/c` → canned/a_b_c.json (stdout) + a_b_c.code (exit); anything uncanned is a 404 body.
const FAKE_GH = `#!/bin/sh
case "$1" in
  --version) echo "gh version 0.0.0 (fake)"; exit 0 ;;
  auth) if [ -f "$FAKE_GH_DIR/auth-fails" ]; then echo "You are not logged into any GitHub hosts" >&2; exit 1; fi; exit 0 ;;
  api)
    key=$(printf '%s' "$2" | tr '/' '_')
    if [ -f "$FAKE_GH_DIR/$key.json" ]; then
      cat "$FAKE_GH_DIR/$key.json"
      if [ -f "$FAKE_GH_DIR/$key.code" ]; then exit "$(cat "$FAKE_GH_DIR/$key.code")"; fi
      exit 0
    fi
    echo '{"message":"Not Found","status":"404"}'; exit 1 ;;
esac
exit 1
`;

function sandbox(t, { gh = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-branch-protection-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const canned = join(dir, 'canned'); mkdirSync(canned);
  if (gh) { writeFileSync(join(bin, 'gh'), FAKE_GH); chmodSync(join(bin, 'gh'), 0o755); }
  // Only the two commands the fake calls. A system directory is not enough: GitHub's Ubuntu runners
  // install gh in /usr/bin, and there /bin is the same directory.
  const tools = join(dir, 'tools'); mkdirSync(tools);
  for (const cmd of ['tr', 'cat']) symlinkSync(execFileSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).trim(), join(tools, cmd));
  return { dir, bin, tools, canned, manifest: join(dir, 'branch-protection.json') };
}

const RSC = (repo, branch = 'main') => `repos/${repo}/branches/${branch}/protection/required_status_checks`;
function answer(s, path, body, code = 0) {
  const key = path.replace(/\//g, '_');
  writeFileSync(join(s.canned, `${key}.json`), JSON.stringify(body));
  if (code) writeFileSync(join(s.canned, `${key}.code`), String(code));
}
const manifest = (s, repos) => writeFileSync(s.manifest, JSON.stringify({ repos }));

function run(s, args = []) {
  const env = { ...process.env, PATH: `${s.bin}:${s.tools}`, FAKE_GH_DIR: s.canned };
  const r = spawnSync(process.execPath, [CLI, '--manifest', s.manifest, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const summary = (out) => JSON.parse(/summary: (\[.*\])/.exec(out)[1]);

test('live required checks that cover the expected set PASS (exit 0), with untracked extras noted', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: ['ci/test', 'ci/lint'] }]);
  answer(s, RSC('example-org/widget'), { contexts: ['ci/test'], checks: [{ context: 'ci/lint' }, { context: 'ci/build' }] });
  const r = run(s);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /source: {3}protection\/required_status_checks \(200, direct read\)/);
  assert.match(r.out, /note: live also requires 1 check\(s\) not yet tracked in the manifest: ci\/build/);
  assert.deepEqual(summary(r.out), [{ repo: 'example-org/widget', branch: 'main', state: 'PASS' }]);
  assert.match(r.out, /result: PASS \(exit 0\)/);
});

test('an expected check missing from a confirmed read is MISMATCH (exit 3), naming it', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: ['ci/test', 'ci/e2e'] }]);
  answer(s, RSC('example-org/widget'), { contexts: ['ci/test'] });
  const r = run(s);
  assert.equal(r.code, 3);
  assert.match(r.out, /MISMATCH — missing from live: ci\/e2e/);
  assert.match(r.out, /result: MISMATCH \(exit 3\)/);
});

test('a 404 "Branch not protected" is a CONFIRMED empty set: an expected check makes it MISMATCH, not CANNOT-VERIFY', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: ['ci/test'] }]);
  answer(s, RSC('example-org/widget'), { message: 'Branch not protected', status: '404' }, 1);
  const r = run(s);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /404 "Branch not protected" — branch not protected \(confirmed\)/);
  assert.match(r.out, /MISMATCH — missing from live: ci\/test/);
});

test('a 404 with any other message is NOT confirmed and is CANNOT-VERIFY (exit 4), never green', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: [] }]);
  // uncanned path: the fake answers {"message":"Not Found","status":"404"}
  const r = run(s);
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /404 with unexpected message "Not Found" — NOT confirmed/);
  assert.match(r.out, /CANNOT-VERIFY — live required-check state could not be confirmed/);
  assert.match(r.out, /result: CANNOT-VERIFY \(exit 4\)/);
});

test('a plan-gated 403 falls back to the branch\'s protected flag: false confirms an empty set, true cannot enumerate', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [
    { repo: 'example-org/open', branch: 'main', requiredChecks: [] },
    { repo: 'example-org/opaque', branch: 'main', requiredChecks: ['ci/test'] },
  ]);
  const gated = { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.', status: '403' };
  answer(s, RSC('example-org/open'), gated, 1);
  answer(s, 'repos/example-org/open/branches/main', { name: 'main', protected: false });
  answer(s, RSC('example-org/opaque'), gated, 1);
  answer(s, 'repos/example-org/opaque/branches/main', { name: 'main', protected: true });
  const r = run(s);
  assert.equal(r.code, 4, r.out);
  assert.match(r.out, /fallback repos\/\.\.\.\/branches\/main confirms protected:false/);
  assert.match(r.out, /WARNING: zero required checks — every CI job is currently advisory at the merge gate/);
  assert.match(r.out, /fallback shows protected:true but the check list is NOT readable at this plan tier/);
  assert.deepEqual(summary(r.out).map((x) => x.state), ['PASS-WITH-WARNING', 'CANNOT-VERIFY']);
});

test('--snapshot writes the raw query and its interpretation per repo', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  manifest(s, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: ['ci/test'] }]);
  answer(s, RSC('example-org/widget'), { contexts: ['ci/test'] });
  const snaps = join(s.dir, 'snaps');
  const r = run(s, ['--snapshot', snaps]);
  assert.equal(r.code, 0, r.out + r.err);
  const files = readdirSync(snaps);
  assert.equal(files.length, 1);
  assert.match(files[0], /^example-org-widget-main-\d{4}-\d{2}-\d{2}T.*\.json$/);
  const snap = JSON.parse(readFileSync(join(snaps, files[0]), 'utf8'));
  assert.equal(snap.repo, 'example-org/widget');
  assert.deepEqual(snap.interpretedLiveContexts, ['ci/test']);
  assert.deepEqual(snap.primaryQuery, { status: 0, body: { contexts: ['ci/test'] } });
  assert.equal(snap.fallbackQuery, null);
});

test('manifest refusals are CANNOT-VERIFY (exit 4): missing, not JSON, no repos, an entry without repo/branch', { skip: !POSIX }, (t) => {
  const s = sandbox(t);
  const missing = run(s);
  assert.equal(missing.code, 4);
  assert.match(missing.err, /CANNOT-VERIFY: manifest not found at .*branch-protection\.json/);
  writeFileSync(s.manifest, '{ "repos": [');
  assert.match(run(s).err, /CANNOT-VERIFY: manifest at .* is not valid JSON/);
  manifest(s, []);
  const empty = run(s);
  assert.equal(empty.code, 4);
  assert.match(empty.err, /CANNOT-VERIFY: manifest has no repos\[\] entries/);
  manifest(s, [{ repo: 'example-org/widget' }]);
  const partial = run(s);
  assert.equal(partial.code, 4);
  assert.match(partial.out, /CANNOT-VERIFY: manifest entry missing repo\/branch/);
});

test('no gh on PATH, or gh not authenticated, is CANNOT-VERIFY (exit 4) before any query', { skip: !POSIX }, (t) => {
  const none = sandbox(t, { gh: false });
  assert.ok(spawnSync('gh', ['--version'], { env: { PATH: `${none.bin}:${none.tools}` } }).error,
    'precondition: a gh is reachable on the sandbox PATH, so this cannot test its absence');
  manifest(none, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: [] }]);
  const r = run(none);
  assert.equal(r.code, 4);
  assert.match(r.err, /CANNOT-VERIFY: `gh` CLI not found on PATH/);

  const unauth = sandbox(t);
  manifest(unauth, [{ repo: 'example-org/widget', branch: 'main', requiredChecks: [] }]);
  writeFileSync(join(unauth.canned, 'auth-fails'), '');
  const u = run(unauth);
  assert.equal(u.code, 4);
  assert.match(u.err, /CANNOT-VERIFY: `gh auth status` failed — not authenticated\n.*not logged into any GitHub hosts/);
});
