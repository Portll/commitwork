// deps-osv sidecar mount and osv-declared /locks/ reads

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
const OSV = MANIFEST.checks.find((c) => c.id === 'deps-osv');
const SCAN = (OSV.local || [])[0];

describe('deps-osv mounts the sidecar lockfile directory and passes it with -L', () => {
  test('the mount and the -L list are both conditional on CW_LOCKFILE_DIR naming a directory', () => {
    assert.match(SCAN, /\[ -n "\$\{CW_LOCKFILE_DIR:-\}" \] && \[ -d "\$CW_LOCKFILE_DIR" \]/,
      'an unset or dangling CW_LOCKFILE_DIR must leave the command exactly as it was');
    assert.match(SCAN, /--mount \$CW_LOCKFILE_DIR:\/locks:ro/, 'the sidecar is mounted READ-ONLY at /locks');
    assert.match(SCAN, /-L \/locks\/\$\(basename "\$f"\)/, 'every file in the directory is handed to osv-scanner by name');
  });

  test('the sandbox call receives the mount and the scan receives the -L list, before /src', () => {
    assert.match(SCAN, /--mount-source "\$PWD:\/src:ro" \$LOCKM\)/, 'the extra mount rides the sandbox invocation, not a hand-rolled docker flag');
    assert.match(SCAN, /--format=sarif \$LOCKL \/src >/, 'the lockfile list precedes the source directory osv-scanner still recurses');
  });

  test('the source tree stays read-only — the sidecar mount added no writable path', () => {
    assert.ok(!/:rw/.test(SCAN), 'no rw mount anywhere in the deps-osv command');
  });
});

describe('osv-declared reads a /locks/ location from CW_LOCKFILE_DIR', () => {
  const TOOL = join(REPO, 'bin', 'osv-declared.mjs');
  const T = mkdtempSync(join(tmpdir(), 'cw-osv-sidecar-'));
  test.after(() => rmSync(T, { recursive: true, force: true }));

  const result = (pkg, ver, uri) => ({
    message: { text: `Package '${pkg}@${ver}' is vulnerable to 'CVE-X'.` },
    locations: [{ physicalLocation: { artifactLocation: { uri } } }],
  });
  function run(name, { repoFiles = {}, lockFiles = null, results, env = {} }) {
    const root = join(T, name); mkdirSync(root, { recursive: true });
    for (const [rel, body] of Object.entries(repoFiles)) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); }
    let lockDir = null;
    if (lockFiles) {
      lockDir = join(T, `${name}-locks`); mkdirSync(lockDir, { recursive: true });
      for (const [rel, body] of Object.entries(lockFiles)) writeFileSync(join(lockDir, rel), body);
    }
    const sarif = join(root, 'osv.sarif');
    writeFileSync(sarif, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner' } }, results }] }));
    const e = { ...process.env, ...env };
    if (lockDir) e.CW_LOCKFILE_DIR = lockDir; else delete e.CW_LOCKFILE_DIR;
    return JSON.parse(execFileSync('node', [TOOL, root, sarif], { encoding: 'utf8', env: e }));
  }
  // fact: v3 lock keys are node_modules/<name>
  const LOCK = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/nanoid': { version: '3.3.6' } } }, null, 1);

  test('a sidecar lockfile is readable, marked external, and declares the version it pins', () => {
    const j = run('pinned', { lockFiles: { 'package-lock.json': LOCK }, results: [result('nanoid', '3.3.6', 'file:///locks/package-lock.json')] });
    const m = j.manifests['file:///locks/package-lock.json'];
    assert.equal(m.readable, true, 'the lock was read from CW_LOCKFILE_DIR');
    assert.equal(m.external, true);
    assert.equal(m.source, 'sidecar');
    assert.equal(m.declaredCount, 1, 'a lockfile pins by construction');
    assert.equal(m.byConstruction, true, 'and says so');
    assert.equal(m.resolvedCount, 0, 'nothing is demoted off a sidecar pin');
  });

  // fact: window scan alone demotes v3 locks
  test('a v3 package-lock in the repository declares by construction, even though its key is node_modules/<name>', () => {
    const j = run('v3-in-repo', { repoFiles: { 'package-lock.json': LOCK }, results: [result('nanoid', '3.3.6', 'file:///src/package-lock.json')] });
    const m = j.manifests['file:///src/package-lock.json'];
    assert.equal(m.readable, true);
    assert.equal(m.declaredCount, 1, 'a lockfile finding must never be demoted as "resolved"');
    assert.equal(m.resolvedCount, 0);
    assert.equal(m.byConstruction, true);
    assert.equal(m.external, undefined);
  });

  test('requirements.txt is NOT a lockfile by construction — a floor still resolves, a pin still declares', () => {
    const j = run('floors', {
      repoFiles: { 'requirements.txt': 'pillow>=9.0\naiohttp==3.9.5\n' },
      results: [result('pillow', '9.5.0', 'file:///src/requirements.txt'), result('aiohttp', '3.9.5', 'file:///src/requirements.txt')],
    });
    const m = j.manifests['file:///src/requirements.txt'];
    assert.equal(m.byConstruction, undefined, 'the text window decides here, and says so by saying nothing');
    assert.deepEqual(m.resolved, ['pillow@9.5.0']);
    assert.equal(m.declaredCount, 1);
  });

  test('without CW_LOCKFILE_DIR the same location is unreadable — no verdict, no guess', () => {
    const j = run('unset', { results: [result('nanoid', '3.3.6', 'file:///locks/package-lock.json')] });
    const m = j.manifests['file:///locks/package-lock.json'];
    assert.equal(m.readable, false);
    assert.equal(m.external, undefined, 'nothing is called external when no sidecar was consulted');
    assert.equal(m.declaredCount + m.resolvedCount, 0);
  });

  test('a repo-relative location is still read from the repository, never from the sidecar', () => {
    const j = run('repo-first', {
      repoFiles: { 'package-lock.json': LOCK },
      lockFiles: { 'package-lock.json': '{"lockfileVersion":3,"packages":{}}' },
      results: [result('nanoid', '3.3.6', 'file:///src/package-lock.json')],
    });
    const m = j.manifests['file:///src/package-lock.json'];
    assert.equal(m.readable, true);
    assert.equal(m.external, undefined);
    assert.equal(m.declaredCount, 1, 'declared from the repo copy, which pins 3.3.6 — the sidecar copy pins nothing');
  });
});
