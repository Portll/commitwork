// bin/test/bundler-audit-scan-offline.test.mjs — the offline retry in bundler-audit-scan.mjs.
//
// `--update` is a NETWORK FETCH and it is optional: the advisory database is cached on disk, so a
// scan is possible with no network at all. Passing it unconditionally made the scan IMPOSSIBLE on
// an offline host — bundle-audit 0.9.3 exits 1 and writes no JSON when the fetch fails, which the
// script read as "the tool failed" and turned into exit 3 for every lockfile.
//
// These tests use a FAKE bundle-audit on PATH rather than the real one, for two reasons: the
// behaviour under test is the script's reaction to a FAILED FETCH, which cannot be provoked on a
// host that has a network; and the sibling test file skips entirely when the binary is absent, so
// a regression here would go unnoticed on exactly the hosts that need the fallback. A fake makes
// every case runnable everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCAN = join(REPO, 'bin', 'bundler-audit-scan.mjs');

// The fake answers by MODE, and only ever misbehaves when --update is present — that is the whole
// distinction the script draws: a failed FETCH is retryable, a failed SCAN is not.
const FAKE = `#!/bin/sh
out=""; prev=""
for a in "$@"; do
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
has_update=0
for a in "$@"; do [ "$a" = "--update" ] && has_update=1; done

if [ "$has_update" = "1" ]; then
  case "$FAKE_MODE" in
    fetch-fail) exit 1 ;;
    findings)   printf '{"results":[{"gem":"rack","cve":"CVE-2020-0001"}]}' > "$out"; exit 1 ;;
    hard-fail)  exit 3 ;;
  esac
fi
printf '{"results":[]}' > "$out"
exit 0
`;

/** A scratch repo with one root lockfile, plus a PATH whose bundle-audit is the fake above. */
function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'cw-ba-offline-'));
  const bin = join(d, 'fakebin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'bundle-audit'), FAKE);
  chmodSync(join(bin, 'bundle-audit'), 0o755);
  const repo = join(d, 'repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'Gemfile.lock'), 'GEM\n  specs:\n\nPLATFORMS\n  ruby\n\nDEPENDENCIES\n');
  return { d, bin, repo, out: join(d, 'result.json') };
}

/** Run the scan against the fake, returning exit code and stderr. */
function run(s, mode) {
  // spawnSync, not execFileSync: the script reports on STDERR and exits 0 on a healthy scan, and
  // execFileSync hands back stdout alone on success — which would make every stderr assertion below
  // pass vacuously against an empty string.
  const r = spawnSync(process.execPath, [SCAN, s.repo, s.out], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH}`, FAKE_MODE: mode },
  });
  return { code: typeof r.status === 'number' ? r.status : -1, stderr: r.stderr ?? '' };
}

test('a FAILED FETCH falls back to the cached database and still writes an artifact', () => {
  const s = scratch();
  try {
    const { code, stderr } = run(s, 'fetch-fail');
    assert.equal(code, 0, `a failed --update must not fail the scan; got exit ${code}: ${stderr}`);
    assert.ok(existsSync(s.out), 'no artifact — the offline host is back to being scanned by nothing');
    const j = JSON.parse(readFileSync(s.out, 'utf8'));
    assert.deepEqual(j._scanned, ['Gemfile.lock'], 'the lockfile was not audited against the cached database');
  } finally { rmSync(s.d, { recursive: true, force: true }); }
});

test('the offline fallback SAYS SO on stderr — a stale database is a weaker witness', () => {
  const s = scratch();
  try {
    const { stderr } = run(s, 'fetch-fail');
    assert.match(stderr, /could not be refreshed/,
      `a scan against a cached database must announce itself, or a missed CVE reads as a clean result: ${stderr}`);
  } finally { rmSync(s.d, { recursive: true, force: true }); }
});

test('a real findings run is NOT retried — exit 1 with output is an answer, not a failure', () => {
  const s = scratch();
  try {
    const { code, stderr } = run(s, 'findings');
    assert.equal(code, 1, `advisories must still exit 1; got ${code}: ${stderr}`);
    const j = JSON.parse(readFileSync(s.out, 'utf8'));
    assert.equal(j.results.length, 1, 'the advisory was lost');
    assert.equal(j.results[0].lockfile, 'Gemfile.lock', 'the row lost its lockfile attribution');
    assert.doesNotMatch(stderr, /could not be refreshed/,
      'a findings run was reported as an offline scan — the retry fired when it should not have');
  } finally { rmSync(s.d, { recursive: true, force: true }); }
});

test('a hard tool failure is NOT retried and writes NO artifact', () => {
  const s = scratch();
  try {
    const { code } = run(s, 'hard-fail');
    assert.equal(code, 3, `a tool failure must exit 3; got ${code}`);
    assert.ok(!existsSync(s.out),
      'an artifact was written for a scan that never ran — an empty results array is a clean bill of health');
  } finally { rmSync(s.d, { recursive: true, force: true }); }
});

test('a successful fetch reports no offline warning', () => {
  const s = scratch();
  try {
    const { code, stderr } = run(s, 'online');
    assert.equal(code, 0, `a clean online scan must exit 0; got ${code}: ${stderr}`);
    assert.doesNotMatch(stderr, /could not be refreshed/, 'the offline warning fired on a healthy scan');
  } finally { rmSync(s.d, { recursive: true, force: true }); }
});
