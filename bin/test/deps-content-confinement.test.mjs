// Lockfile keys are untrusted: a package.json read must stay inside the scanned root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scan } from '../deps-content.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'deps-confinement-')); }
function writePkg(root, key, version) {
  const p = join(root, key, 'package.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ name: key.split('/').pop(), version }));
}
function writeLock(root, packages) {
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...packages } }));
}

test('a .. segment in a lockfile key is never read and is reported', () => {
  const d = tmp();
  try {
    const root = join(d, 'a', 'b');
    mkdirSync(root, { recursive: true });
    writeLock(root, {
      'node_modules/../../outside-pkg': { version: '1.0.0', resolved: 'https://r/outside.tgz', integrity: 'sha512-X' },
    });
    writePkg(root, 'node_modules/../../outside-pkg', '9.9.9');
    const { report } = scan(root, {});
    assert.equal(report.findings.some((f) => f.rule === 'dep-version-drift'), false);
    assert.deepEqual(report.summary.skippedOutsideRoot, [
      { key: 'node_modules/../../outside-pkg', why: 'key has a .. segment' },
    ]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a node_modules symlink leaving the scanned root is not read', (t) => {
  const d = tmp();
  try {
    const root = join(d, 'root');
    const outside = join(d, 'outside');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writePkg(outside, '.', '9.9.9');
    try {
      symlinkSync(outside, join(root, 'node_modules', 'linked'));
    } catch (e) {
      if (e.code === 'EPERM') { t.skip('symlinks need privileges on this platform'); return; }
      throw e;
    }
    writeLock(root, {
      'node_modules/linked': { version: '1.0.0', resolved: 'https://r/linked.tgz', integrity: 'sha512-L' },
    });
    const { report } = scan(root, {});
    assert.equal(report.findings.some((f) => f.rule === 'dep-version-drift'), false);
    assert.deepEqual(report.summary.skippedOutsideRoot, [
      { key: 'node_modules/linked', why: 'resolves outside the scanned root through a link' },
    ]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a workspace symlink that stays inside the root is read', (t) => {
  const d = tmp();
  try {
    const root = join(d, 'root');
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writePkg(root, 'packages/ws', '2.0.0');
    try {
      symlinkSync(join(root, 'packages', 'ws'), join(root, 'node_modules', 'ws'));
    } catch (e) {
      if (e.code === 'EPERM') { t.skip('symlinks need privileges on this platform'); return; }
      throw e;
    }
    writeLock(root, {
      'node_modules/ws': { version: '1.0.0', resolved: 'https://r/ws.tgz', integrity: 'sha512-W' },
    });
    const { report } = scan(root, {});
    const f = report.findings.find((x) => x.rule === 'dep-version-drift');
    assert.deepEqual(f && { path: f.path, detail: f.detail }, { path: 'node_modules/ws', detail: 'installed 2.0.0 ≠ locked 1.0.0' });
    assert.equal(Object.hasOwn(report.summary, 'skippedOutsideRoot'), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a normal installed package with drift is still reported', () => {
  const d = tmp();
  try {
    const root = join(d, 'root');
    mkdirSync(root, { recursive: true });
    writePkg(root, 'node_modules/normal', '2.0.0');
    writeLock(root, {
      'node_modules/normal': { version: '1.0.0', resolved: 'https://r/normal.tgz', integrity: 'sha512-N' },
    });
    const { report } = scan(root, {});
    assert.equal(report.findings.some((f) => f.rule === 'dep-version-drift'), true);
    assert.equal(Object.hasOwn(report.summary, 'skippedOutsideRoot'), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an unread .. key keeps its lockfile-only integrity finding and count', () => {
  const d = tmp();
  try {
    const root = join(d, 'root');
    mkdirSync(root, { recursive: true });
    writeLock(root, {
      'node_modules/../../evil': { version: '1.0.0', resolved: 'https://r/evil.tgz' },
    });
    const { report } = scan(root, {});
    assert.equal(report.summary.packagesChecked, 1);
    assert.deepEqual(report.findings.map((f) => f.rule), ['dep-missing-integrity']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('unread keys are sorted by key regardless of lockfile order', () => {
  const d = tmp();
  try {
    const root = join(d, 'root');
    mkdirSync(root, { recursive: true });
    writeLock(root, {
      'node_modules/../../zzz': { version: '1.0.0', resolved: 'https://r/z.tgz', integrity: 'sha512-Z' },
      'node_modules/../../aaa': { version: '1.0.0', resolved: 'https://r/a.tgz', integrity: 'sha512-A' },
    });
    const { report } = scan(root, {});
    assert.deepEqual(report.summary.skippedOutsideRoot.map((s) => s.key), [
      'node_modules/../../aaa',
      'node_modules/../../zzz',
    ]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
