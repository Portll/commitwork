// bin/osv-declared.mjs — did the repository DECLARE the version osv-scanner reported?
//
// The verdict this file emits causes DEMOTION, so its dangerous failure is the opposite of most
// scanners': a wrong `resolved` moves a real lockfile finding out of the headline. Every test below
// pins one half of that, and the first two are the inversion this was actually shipped with.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = join(dirname(fileURLToPath(import.meta.url)), '..', 'osv-declared.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-osvdecl-'));
let n = 0;

function run(files, results) {
  const root = join(T, `r${n++}`);
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body);
  }
  const sarif = join(root, 'osv.sarif');
  writeFileSync(sarif, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner' } }, results }] }));
  return JSON.parse(execFileSync('node', [TOOL, root, sarif], { encoding: 'utf8' }));
}
const result = (pkg, ver, uri) => ({ message: { text: `Package '${pkg}@${ver}' is vulnerable to 'CVE-X'.` }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });

// A LOCKFILE PINS BY CONSTRUCTION. This is the half that was inverted: the first implementation
// required the version on the package's own LINE, and Cargo.lock spells them three lines apart —
//   [[package]] / name = "anyhow" / version = "1.0.100"
// — so every lockfile read as fully RESOLVED and would have had its real findings demoted wholesale.
test('a Cargo.lock declares every version it pins, even though name and version are on separate lines', () => {
  const j = run(
    { 'Cargo.lock': '[[package]]\nname = "anyhow"\nversion = "1.0.100"\n\n[[package]]\nname = "lru"\nversion = "0.12.5"\n' },
    [result('anyhow', '1.0.100', 'file:///src/Cargo.lock'), result('lru', '0.12.5', 'file:///src/Cargo.lock')],
  );
  const m = j.manifests['file:///src/Cargo.lock'];
  assert.equal(m.declaredCount, 2);
  assert.equal(m.resolvedCount, 0, 'a lockfile must never be read as resolving anything');
});

// The motivating case, exactly: the manifest carries `>=` floors and does not name the package at
// all, so osv-scanner resolved it. memory-layer's benchmarks/requirements.txt names neither pillow nor
// aiohttp, and osv reported both — 54 of 135 findings, including both criticals and the only KEV.
test('an unpinned requirements.txt does not declare a package it never names', () => {
  const j = run(
    { 'benchmarks/requirements.txt': 'datasets>=2.14.0\ntqdm>=4.65.0\nopenai>=1.0.0\n' },
    [result('pillow', '9.5.0', 'file:///src/benchmarks/requirements.txt')],
  );
  const m = j.manifests['file:///src/benchmarks/requirements.txt'];
  assert.deepEqual(m.resolved, ['pillow@9.5.0']);
  assert.equal(m.declaredCount, 0);
});

test('a PINNED requirements.txt declares what it pins — pinning is the fix, so it must read as fixed', () => {
  const j = run(
    { 'benchmarks/requirements.txt': 'datasets==5.0.1\npillow==9.5.0\n' },
    [result('pillow', '9.5.0', 'file:///src/benchmarks/requirements.txt')],
  );
  assert.equal(j.manifests['file:///src/benchmarks/requirements.txt'].resolvedCount, 0);
});

// A version number elsewhere in the file must not vouch for an unrelated package.
test('a version appearing far from the package name does not count as declared', () => {
  const j = run(
    { 'reqs.txt': 'pillow>=1.0\n# a hundred lines of nothing\n\n\n\n\n\n\n\nsomething-else==9.5.0\n' },
    [result('pillow', '9.5.0', 'file:///src/reqs.txt')],
  );
  assert.deepEqual(j.manifests['file:///src/reqs.txt'].resolved, ['pillow@9.5.0']);
});

// FAIL CLOSED IN THE DEMOTING DIRECTION. A SARIF that never ran must produce NO verdict, because
// "no findings, therefore nothing was resolved" is indistinguishable from "nothing was read", and
// only one of those may be allowed to change a headline.
test('a never-ran SARIF emits no verdict at all, so the rollup demotes nothing', () => {
  const root = join(T, 'norun'); mkdirSync(root, { recursive: true });
  const sarif = join(root, 'osv.sarif'); writeFileSync(sarif, JSON.stringify({ version: '2.1.0' }));
  const j = JSON.parse(execFileSync('node', [TOOL, root, sarif], { encoding: 'utf8' }));
  assert.equal(j.ran, false);
  assert.equal(j.reason, 'never-ran');
  assert.deepEqual(j.manifests, {});
});

// An unreadable manifest is not a resolved one. Emitting `resolved` for a file we could not open
// would demote every finding in it on no evidence.
test('a manifest that is not on disk yields no verdict for its findings', () => {
  const j = run({ 'other.txt': 'x\n' }, [result('pillow', '9.5.0', 'file:///src/gone/requirements.txt')]);
  const m = j.manifests['file:///src/gone/requirements.txt'];
  assert.equal(m.readable, false);
  assert.equal(m.resolvedCount, 0);
  assert.equal(m.declaredCount, 0);
});
