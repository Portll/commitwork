// App bundle inventory with signing and quarantine state per root (monitor/app-inventory.mjs collectApps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectApps } from '../app-inventory.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'collectApps-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const makeApp = (root, name) => {
  const bundle = join(root, name);
  mkdirSync(join(bundle, 'Contents'), { recursive: true });
  writeFileSync(join(bundle, 'Contents', 'Info.plist'), '<plist/>');
  return bundle;
};
const fake = (plutil, codesign, xattr) => (cmd) => (cmd === 'plutil' ? plutil : cmd === 'codesign' ? codesign : xattr);
const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
const fail = (status, stderr = '', stdout = '') => ({ status, stdout, stderr });
const withSha = (it) => ({
  ...it,
  sha256: createHash('sha256')
    .update(JSON.stringify([it.version, it.signer, it.signMode, it.teamId, it.quarantined, it.name, it.bundleId].map((v) => v ?? null)))
    .digest('hex'),
});
const unparseable = (id) => ({ id, kind: 'app', unknown: true, unknownReason: 'unparseable', unknownDetail: 'Info.plist unreadable' });

test('A root that does not exist is skipped without recording anything', () => {
  withDir((dir) => {
    const r = collectApps({ roots: [join(dir, 'missing')], run: fake(ok(), ok(), ok()) });
    assert.deepEqual(r, { items: [], unknowns: [] });
  });
});

test('A root that is a regular file is recorded as not-permitted with its error code', () => {
  withDir((dir) => {
    const root = join(dir, 'file.txt');
    writeFileSync(root, 'x');
    const r = collectApps({ roots: [root], run: fake(ok(), ok(), ok()) });
    assert.deepEqual(r, {
      items: [],
      unknowns: [{ id: root, kind: 'app', unknown: true, unknownReason: 'not-permitted', unknownDetail: 'ENOTDIR' }],
    });
  });
});

test('Entries whose names do not end in .app are ignored', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    mkdirSync(join(root, 'Notes.apps'), { recursive: true });
    writeFileSync(join(root, 'readme.txt'), 'x');
    const plist = JSON.stringify({ CFBundleName: 'X' });
    const r = collectApps({ roots: [root], run: fake(ok(plist), ok('', 'Authority=Dev'), fail(1)) });
    assert.deepEqual(r, { items: [], unknowns: [] });
  });
});

test('A plutil exit status of 1 marks the bundle unparseable even when stdout is JSON', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    const bundle = makeApp(root, 'A.app');
    const plist = JSON.stringify({ CFBundleName: 'A', CFBundleIdentifier: 'id.a' });
    const r = collectApps({ roots: [root], run: fake(fail(1, 'err', plist), ok('', 'Authority=Dev'), fail(1)) });
    assert.deepEqual(r, { items: [], unknowns: [unparseable(bundle)] });
  });
});

test('Plutil output that is not JSON marks the bundle unparseable', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    const bundle = makeApp(root, 'B.app');
    const r = collectApps({ roots: [root], run: fake(ok('not-json'), ok('', 'Authority=Dev'), fail(1)) });
    assert.deepEqual(r, { items: [], unknowns: [unparseable(bundle)] });
  });
});

test('A signed app without quarantine takes its name from CFBundleName', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    const bundle = makeApp(root, 'C.app');
    const plist = JSON.stringify({ CFBundleName: 'Pretty Name', CFBundleIdentifier: 'id.c', CFBundleShortVersionString: '1.0', CFBundleVersion: '9' });
    const r = collectApps({ roots: [root], run: fake(ok(plist), ok('', 'Authority=Dev\nTeamIdentifier=ABC'), fail(1)) });
    assert.deepEqual(r, {
      items: [withSha({ id: bundle, kind: 'app', name: 'Pretty Name', bundleId: 'id.c', version: '1.0', signMode: 'signed', signer: 'Dev', teamId: 'ABC', quarantined: false })],
      unknowns: [],
    });
  });
});

test('An adhoc signed app whose quarantine lookup exits 0 is quarantined', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    const bundle = makeApp(root, 'D.app');
    const plist = JSON.stringify({ CFBundleName: 'D', CFBundleIdentifier: 'id.d', CFBundleShortVersionString: '2.0' });
    const r = collectApps({ roots: [root], run: fake(ok(plist), ok('', 'Signature=adhoc'), ok()) });
    assert.deepEqual(r, {
      items: [withSha({ id: bundle, kind: 'app', name: 'D', bundleId: 'id.d', version: '2.0', signMode: 'adhoc', signer: null, teamId: null, quarantined: true })],
      unknowns: [],
    });
  });
});

test('Without CFBundleName the name comes from the file name and an unsigned app with xattr status 2 is not quarantined', () => {
  withDir((dir) => {
    const root = join(dir, 'apps');
    const bundle = makeApp(root, 'E.app');
    const plist = JSON.stringify({ CFBundleVersion: '42' });
    const r = collectApps({ roots: [root], run: fake(ok(plist), fail(1, 'code object is not signed at all'), fail(2)) });
    assert.deepEqual(r, {
      items: [withSha({ id: bundle, kind: 'app', name: 'E', bundleId: null, version: '42', signMode: 'unsigned', signer: null, teamId: null, quarantined: false })],
      unknowns: [],
    });
  });
});

test('Apps are listed root by root in sorted name order and a missing root in between is skipped', () => {
  withDir((dir) => {
    const rootA = join(dir, 'one');
    const rootB = join(dir, 'two');
    makeApp(rootA, 'b.app');
    makeApp(rootA, 'a.app');
    makeApp(rootB, 'c.app');
    const plist = JSON.stringify({ CFBundleIdentifier: 'id.x', CFBundleShortVersionString: '1' });
    const r = collectApps({
      roots: [rootA, join(dir, 'missing'), rootB],
      run: fake(ok(plist), ok('', 'Authority=Dev\nTeamIdentifier=not set'), fail(1)),
    });
    const expected = [[rootA, 'a'], [rootA, 'b'], [rootB, 'c']].map(([root, n]) => withSha({
      id: join(root, `${n}.app`), kind: 'app', name: n, bundleId: 'id.x', version: '1',
      signMode: 'signed', signer: 'Dev', teamId: null, quarantined: false,
    }));
    assert.deepEqual(r, { items: expected, unknowns: [] });
  });
});
