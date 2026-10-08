// node --test monitor/test/ — tier 1 of the app sweep. Pinned hardest: identity is the PLACE, so
// an upgrade is 'changed' and never remove+add; an absent package manager is a quiet absent
// source while a failing one is unknown (different states, different reader actions); a bundle
// whose plist will not parse is counted, never skipped; and the lens claims inventory only —
// no vulnerability language anywhere in it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodesign, collectInventory, readBaseline, runLens, acceptBaseline } from '../app-inventory.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-appinv-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

// A whole fake box: one apps root with one bundle, brew, npm (non-zero exit + valid JSON — the
// peer-warning shape), pipx absent, a Chrome extension, no Firefox.
function fakeBox({ demoVersion = '1.2.3', codesignFor = {} } = {}) {
  const home = scratch();
  const appsRoot = join(home, 'FakeApplications');
  mkdirSync(join(appsRoot, 'Demo.app', 'Contents'), { recursive: true });
  writeFileSync(join(appsRoot, 'Demo.app', 'Contents', 'Info.plist'), 'binary-or-xml, irrelevant: plutil is injected');
  const extDir = join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Extensions', 'abcdefext', '2.0.1');
  mkdirSync(extDir, { recursive: true });
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify({ name: 'Blocker', version: '2.0.1' }));

  const run = (cmd, args) => {
    if (cmd === 'plutil') return { status: 0, stdout: JSON.stringify({ CFBundleIdentifier: 'com.x.demo', CFBundleShortVersionString: demoVersion, CFBundleName: 'Demo' }), stderr: '', errCode: null };
    if (cmd === 'codesign') {
      return codesignFor[args[1]] ?? { status: 0, stdout: '', stderr: 'Identifier=com.x.demo\nAuthority=Developer ID Application: Example Pty (TEAM1234)\nAuthority=Developer ID Certification Authority\nTeamIdentifier=TEAM1234\n', errCode: null };
    }
    if (cmd === 'xattr') return { status: 1, stdout: '', stderr: '', errCode: null };
    if (cmd === 'brew' && args.includes('--cask')) return { status: 0, stdout: 'firefox 129.0\n', stderr: '', errCode: null };
    if (cmd === 'brew') return { status: 0, stdout: 'jq 1.7.1\nnode 22.1.0 22.2.0\n', stderr: '', errCode: null };
    if (cmd === 'npm') return { status: 1, stdout: JSON.stringify({ dependencies: { corepack: { version: '0.29.3' } } }), stderr: 'npm warn peer dep', errCode: null };
    if (cmd === 'pipx') return { status: null, stdout: '', stderr: '', errCode: 'ENOENT' };
    throw new Error(`unexpected ${cmd}`);
  };
  return { home, appsRoot, run };
}

describe('parseCodesign', () => {
  test('signed, adhoc, unsigned, and failure classify distinctly', () => {
    assert.deepEqual(parseCodesign(0, 'Authority=Dev ID\nTeamIdentifier=T1\n'), { signMode: 'signed', signer: 'Dev ID', teamId: 'T1' });
    assert.equal(parseCodesign(0, 'CodeDirectory v=20400 flags=0x2(adhoc)\nSignature=adhoc\nTeamIdentifier=not set\n').signMode, 'adhoc');
    assert.equal(parseCodesign(1, 'Demo.app: code object is not signed at all\n').signMode, 'unsigned');
    assert.equal(parseCodesign(1, 'some other failure').signMode, 'unknown');
    assert.equal(parseCodesign(0, 'TeamIdentifier=not set\n').teamId, null, '"not set" is null, not a team called not-set');
  });
});

describe('collection', () => {
  test('the whole fake box inventories: app fields, brew multi-version, npm-despite-exit-1, pipx absent, chrome extension', () => {
    const { home, appsRoot, run } = fakeBox();
    const r = collectInventory({ home, run, roots: [appsRoot] });
    assert.deepEqual(r.unknowns, []);
    const kinds = r.items.map((i) => i.kind).sort();
    assert.deepEqual(kinds, ['app', 'brew-cask', 'brew-formula', 'brew-formula', 'chrome-extension', 'npm-global']);
    const app = r.items.find((i) => i.kind === 'app');
    assert.equal(app.version, '1.2.3');
    assert.equal(app.signMode, 'signed');
    assert.equal(app.teamId, 'TEAM1234');
    assert.equal(app.quarantined, false);
    assert.equal(r.items.find((i) => i.name === 'node').version, '22.1.0 22.2.0', 'multiple brew versions survive whole');
    assert.equal(r.items.find((i) => i.kind === 'npm-global').version, '0.29.3', 'valid JSON on a non-zero npm exit still reads');
    assert.deepEqual(r.absentSources, ['pipx'], 'an uninstalled manager is a quiet absent source');
    const ext = r.items.find((i) => i.kind === 'chrome-extension');
    assert.equal(ext.id, 'chrome:Default:abcdefext');
    assert.equal(ext.name, 'Blocker');
  });

  test('an unreadable Info.plist is a counted unknown, never a silent skip', () => {
    const { home, appsRoot } = fakeBox();
    const run = (cmd) => (cmd === 'plutil'
      ? { status: 1, stdout: '', stderr: 'bad plist', errCode: null }
      : { status: null, stdout: '', stderr: '', errCode: 'ENOENT' });
    const r = collectInventory({ home, run, roots: [appsRoot] });
    assert.equal(r.items.filter((i) => i.kind === 'app').length, 0);
    assert.equal(r.unknowns[0].unknownReason, 'unparseable');
  });

  test('a failing manager is unknown — a different state from an absent one', () => {
    const { home, run: base } = fakeBox();
    const run = (cmd, args) => (cmd === 'brew' ? { status: 2, stdout: '', stderr: 'brew broke', errCode: null } : base(cmd, args));
    const r = collectInventory({ home, run, roots: [join(home, 'nothing-here')] });
    assert.ok(r.unknowns.some((u) => u.kind === 'brew-formula' && u.unknownReason === 'tool-failed'));
    assert.ok(!r.absentSources.includes('brew-formula'));
  });

  test('deterministic: two observations of the same box are identical', () => {
    const { home, appsRoot, run } = fakeBox();
    assert.deepEqual(collectInventory({ home, run, roots: [appsRoot] }), collectInventory({ home, run, roots: [appsRoot] }));
  });
});

describe('the diff — identity is the place', () => {
  test('accept → ok; a version bump is CHANGED with the delta named, never remove+add', async () => {
    const box = fakeBox();
    const base = join(scratch(), 'appinv.json');
    await env({ CW_APPINV_BASELINE: base, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      assert.equal(runLens({ home: box.home, run: box.run, roots: [box.appsRoot] }).state, 'no-baseline');
      acceptBaseline({ home: box.home, run: box.run, roots: [box.appsRoot] });
      assert.equal(runLens({ home: box.home, run: box.run, roots: [box.appsRoot] }).state, 'ok');

      const upgraded = fakeBox({ demoVersion: '1.3.0' });
      // Same bundle path is the identity — rebuild the fake box at the same root.
      const r = runLens({ home: box.home, run: upgraded.run, roots: [box.appsRoot] });
      assert.equal(r.state, 'findings');
      assert.deepEqual(r.added, [], 'an upgrade must not read as a new installation');
      assert.deepEqual(r.removed, [], 'nor as a disappearance');
      assert.equal(r.changed.length, 1);
      assert.equal(r.changed[0].was.version, '1.2.3');
      assert.equal(r.changed[0].version, '1.3.0');
    })();
  });

  test('a signer change on an unchanged version is CHANGED too — the supply-chain-shaped delta', async () => {
    const box = fakeBox();
    const base = join(scratch(), 'appinv.json');
    await env({ CW_APPINV_BASELINE: base, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline({ home: box.home, run: box.run, roots: [box.appsRoot] });
      const resigned = fakeBox({
        codesignFor: { [join(box.appsRoot, 'Demo.app')]: { status: 0, stdout: '', stderr: 'Authority=Somebody Else\nTeamIdentifier=EVIL9999\n', errCode: null } },
      });
      const r = runLens({ home: box.home, run: resigned.run, roots: [box.appsRoot] });
      assert.equal(r.changed.length, 1);
      assert.equal(r.changed[0].was.teamId, 'TEAM1234');
      assert.equal(r.changed[0].teamId, 'EVIL9999');
    })();
  });

  test('an unreadable baseline THROWS; only ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'appinv.json');
    writeFileSync(b, '{nope');
    await env({ CW_APPINV_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_APPINV_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });
});

describe('inventory is not a verdict', () => {
  test('no row carries vulnerability language — tier 1 claims identity and change only', () => {
    const { home, appsRoot, run } = fakeBox();
    const text = JSON.stringify(collectInventory({ home, run, roots: [appsRoot] }));
    for (const word of ['vulnerab', 'severity', 'critical', 'exploit', 'CVE']) {
      assert.ok(!text.includes(word), `'${word}' has no business in an inventory row`);
    }
  });
});
