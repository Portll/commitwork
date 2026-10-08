// bin/test/bundler-audit-scan.test.mjs — the lockfile discovery this lane needed and did not have.
//
// The defect, measured 2026-09-02 on Homebrew/brew: `appliesIfExists: ["Gemfile.lock"]` resolves
// through appliesExists(), which walks the WHOLE TREE for a bare filename, while `bundle-audit
// check` reads ./Gemfile.lock in the working directory and nothing else. brew carries
// docs/Gemfile.lock and Library/Homebrew/Gemfile.lock and none at root, so the gate admitted the
// lane and the tool could not possibly succeed — two real dependency trees, scanned by nothing,
// reported as `noscan`.
//
// The discovery half is pure and is tested WITHOUT bundle-audit, because that is the half that was
// wrong. The end-to-end half needs the binary and skips without it: a box that has not run setup
// has nothing to assert, but a box WITH the tool and a broken scan is publishing a void.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN = join(REPO, 'bin', 'bundler-audit-scan.mjs');

const haveTool = (() => {
  try { execFileSync('command', ['-v', 'bundle-audit'], { shell: true, stdio: 'ignore' }); return true; }
  catch { return false; }
})();

/** A scratch repo with lockfiles at the given relative paths. Contents are irrelevant to discovery. */
function repoWith(paths) {
  const d = mkdtempSync(join(tmpdir(), 'cw-ba-'));
  for (const p of paths) {
    mkdirSync(join(d, dirname(p)), { recursive: true });
    writeFileSync(join(d, p), 'GEM\n  specs:\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n');
  }
  return d;
}
const run = (dir, out) => {
  try { execFileSync(process.execPath, [SCAN, dir, out], { encoding: 'utf8', stdio: 'pipe' }); return 0; }
  catch (e) { return typeof e.status === 'number' ? e.status : -1; }
};

test('a NESTED-only lockfile is found — the case that produced a noscan on a real repo', { skip: haveTool ? false : 'bundle-audit not installed' }, () => {
  const d = repoWith(['docs/Gemfile.lock', 'Library/Homebrew/Gemfile.lock']);
  const out = join(d, 'result.json');
  try {
    const code = run(d, out);
    assert.ok(code === 0 || code === 1, `expected a clean/findings exit, got ${code}`);
    assert.ok(existsSync(out), 'no artifact written for a repo whose lockfiles are all nested');
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j._scanned.length, 2, `both lockfiles must be audited, got ${JSON.stringify(j._scanned)}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a root lockfile still works, and is audited FIRST', { skip: haveTool ? false : 'bundle-audit not installed' }, () => {
  const d = repoWith(['Gemfile.lock', 'sub/Gemfile.lock']);
  const out = join(d, 'result.json');
  try {
    run(d, out);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j._scanned[0], 'Gemfile.lock', 'the root lockfile must be audited first');
    assert.equal(j._scanned.length, 2);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('vendored and build directories are NOT audited — those trees belong to someone else', { skip: haveTool ? false : 'bundle-audit not installed' }, () => {
  const d = repoWith(['Gemfile.lock', 'vendor/bundle/Gemfile.lock', 'node_modules/x/Gemfile.lock', 'tmp/Gemfile.lock']);
  const out = join(d, 'result.json');
  try {
    run(d, out);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(j._scanned, ['Gemfile.lock'],
      `vendored trees were audited: ${JSON.stringify(j._scanned)} — their advisories are the vendoring party's, and reporting them points remediation at a directory nobody edits`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('NO lockfile writes NO artifact and exits 2 — an empty results array would be a clean bill for a scan that never ran', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-ba-empty-'));
  const out = join(d, 'result.json');
  try {
    assert.equal(run(d, out), 2);
    assert.equal(existsSync(out), false, 'an artifact for a repo with no lockfile reads as a clean scan');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('every row carries the lockfile it came from — a monorepo must be attributable', { skip: haveTool ? false : 'bundle-audit not installed' }, () => {
  const d = repoWith(['Gemfile.lock']);
  const out = join(d, 'result.json');
  try {
    run(d, out);
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.ok(Array.isArray(j.results), 'the extractor keys on results[] — see _bundlerAuditCounts');
    for (const r of j.results) assert.ok(r.lockfile, 'a result row with no lockfile cannot be attributed');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
