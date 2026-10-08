// node --test monitor/test/ — the surfaces added to the persistence lens on 2026-09-18 (editor
// extensions, sudoers, ssh, git config, resolution, pam, kexts, system extensions, configuration
// profiles, login items) and the rule that keeps them from lying to an operator who already has a
// baseline: an item of a kind the baseline never covered is UNBASELINED, never `added`.
//
// The hashes are checked against a second witness (createHash over the bytes the test itself
// wrote), not against a constant this module printed — a lens that hashes the wrong file agrees
// with its own golden forever.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  surfaceFor, surfaceKinds, collectPersistence, diffPersistence, baselineCovers, countByKind,
  runLens, acceptBaseline, NEW_KINDS,
} from '../persistence-diff.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) { try { chmodSync(d, 0o755); } catch { /* best effort */ } rmSync(d, { recursive: true, force: true }); }
});
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-persist-surf-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const sha = (s) => createHash('sha256').update(s).digest('hex');
const itemFor = (r, id) => r.items.find((i) => i.id === id);
const unknownFor = (r, id) => r.unknowns.find((u) => u.id === id);
// A test running as root reads files this suite makes unreadable on purpose.
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('the declared surface', () => {
  test('darwin declares every new surface; linux carries the obvious equivalents', () => {
    const mac = surfaceKinds(surfaceFor('darwin', '/Users/x'));
    for (const k of ['editor-extension', 'sudoers', 'ssh', 'git-config', 'hosts', 'resolver', 'pam', 'kext', 'system-extension', 'config-profile', 'login-item']) {
      assert.ok(mac.includes(k), `darwin must declare ${k}`);
    }
    const lin = surfaceKinds(surfaceFor('linux', '/home/x'));
    for (const k of ['editor-extension', 'sudoers', 'ssh', 'git-config', 'hosts', 'pam', 'ld-preload']) {
      assert.ok(lin.includes(k), `linux must declare ${k}`);
    }
    // NEW_KINDS is the compatibility rule's only writing-down. A kind listed there and declared by
    // no platform can never be pinned, so it would sit in `unbaselined` forever.
    const declared = new Set([...mac, ...lin, ...surfaceKinds(surfaceFor('win32', 'C:\\Users\\x'))]);
    for (const k of NEW_KINDS) assert.ok(declared.has(k), `${k} is in NEW_KINDS but no platform declares it`);
  });

  test('the editor roots are the three editors, and the home comes from CW_PERSIST_HOME at CALL time', async () => {
    await env({ CW_PERSIST_HOME: '/tmp/fake-home' }, async () => {
      const roots = surfaceFor('darwin').roots.filter((r) => r.kind === 'editor-extension').map((r) => r.dir);
      assert.deepEqual(roots, ['/tmp/fake-home/.vscode/extensions', '/tmp/fake-home/.cursor/extensions', '/tmp/fake-home/.windsurf/extensions']);
    })();
  });
});

// A scratch surface shaped like the real one: a directory-entry root with a manifest, a plain root,
// single files, and command sources.
function surfaceOn(dir, { exec } = {}) {
  const ext = join(dir, 'extensions');
  const agents = join(dir, 'LaunchAgents');
  const kexts = join(dir, 'kext-root');   // NOT 'Extensions': this filesystem is case-insensitive and would merge it with the editor root
  mkdirSync(join(ext, 'pub.good-1.0.0'), { recursive: true });
  mkdirSync(join(ext, 'pub.nomanifest-2.0.0'), { recursive: true });
  mkdirSync(agents, { recursive: true });
  mkdirSync(join(kexts, 'Thing.kext', 'Contents'), { recursive: true });
  writeFileSync(join(ext, 'pub.good-1.0.0', 'package.json'), '{"name":"good","version":"1.0.0"}');
  writeFileSync(join(ext, 'extensions.json'), '[{"identifier":"pub.good"}]');
  writeFileSync(join(agents, 'com.example.keeper.plist'), '<plist>SENTINEL-AGENT-BODY</plist>');
  writeFileSync(join(kexts, 'Thing.kext', 'Contents', 'Info.plist'), '<plist>kext</plist>');
  writeFileSync(join(dir, 'hosts'), '127.0.0.1 localhost\n');
  return {
    surface: {
      roots: [
        { dir: ext, kind: 'editor-extension', manifest: ['package.json'] },
        { dir: agents, kind: 'launchagent-user' },
        { dir: kexts, kind: 'kext', manifest: ['Contents/Info.plist', 'Info.plist'] },
      ],
      files: [{ path: join(dir, 'hosts'), kind: 'hosts' }, { path: join(dir, 'absent-ssh-config'), kind: 'ssh' }],
      profiles: [],
      commands: [],
    },
    exec,
    ext,
    agents,
    kexts,
  };
}

describe('directories are items too', () => {
  test('an extension is identified by its package.json, and the id is the extension DIRECTORY', () => {
    const dir = scratch();
    const { surface } = surfaceOn(dir);
    const r = collectPersistence({ surface });
    const good = itemFor(r, join(surface.roots[0].dir, 'pub.good-1.0.0'));
    assert.ok(good, 'the extension directory is the item');
    assert.equal(good.kind, 'editor-extension');
    assert.equal(good.sha256, sha('{"name":"good","version":"1.0.0"}'), 'hashed over package.json, not over the tree');
  });

  test('an extension update is CHANGED on the same place, not a new place', () => {
    const dir = scratch();
    const { surface, ext } = surfaceOn(dir);
    const before = collectPersistence({ surface });
    writeFileSync(join(ext, 'pub.good-1.0.0', 'package.json'), '{"name":"good","version":"1.0.1","main":"./evil.js"}');
    const after = collectPersistence({ surface });
    const d = diffPersistence(after, { at: 't0', surfaces: after.surfaces, items: before.items });
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.changed.map((i) => i.id), [join(ext, 'pub.good-1.0.0')]);
    assert.equal(d.state, 'findings');
  });

  test('a missing manifest is unknown(no-subject) — never a hash over the next best thing', () => {
    const dir = scratch();
    const { surface, ext } = surfaceOn(dir);
    const r = collectPersistence({ surface });
    const u = unknownFor(r, join(ext, 'pub.nomanifest-2.0.0'));
    assert.ok(u, 'the manifest-less extension directory is counted');
    assert.equal(u.unknownReason, 'no-subject');
    assert.ok(!itemFor(r, join(ext, 'pub.nomanifest-2.0.0')), 'and it is not an item');
  });

  test('an unreadable manifest is unknown(not-permitted) — and its pinned item is UNVERIFIED, never REMOVED',
    { skip: asRoot && 'running as root' }, () => {
      const dir = scratch();
      const { surface, ext } = surfaceOn(dir);
      const pinned = collectPersistence({ surface }).items;
      chmodSync(join(ext, 'pub.good-1.0.0', 'package.json'), 0o000);
      const r = collectPersistence({ surface });
      assert.equal(unknownFor(r, join(ext, 'pub.good-1.0.0'))?.unknownReason, 'not-permitted');

      const d = diffPersistence(r, { at: 't0', surfaces: r.surfaces, items: pinned });
      assert.deepEqual(d.removed, [], 'a permission error is not a deletion');
      assert.deepEqual(d.added, []);
      assert.deepEqual(d.unverified.map((i) => i.id), [join(ext, 'pub.good-1.0.0')]);
      assert.equal(d.state, 'partial');
    });

  test('an unreadable ROOT leaves everything pinned under it unverified, never a wave of REMOVEDs',
    { skip: asRoot && 'running as root' }, () => {
      const dir = scratch();
      const { surface, agents } = surfaceOn(dir);
      const pinned = collectPersistence({ surface }).items;
      chmodSync(agents, 0o000);
      const r = collectPersistence({ surface });
      assert.equal(unknownFor(r, agents)?.unknownReason, 'not-permitted');
      const d = diffPersistence(r, { at: 't0', surfaces: r.surfaces, items: pinned });
      assert.deepEqual(d.removed, []);
      assert.deepEqual(d.unverified.map((i) => i.id), [join(agents, 'com.example.keeper.plist')]);
      assert.equal(d.state, 'partial');
      chmodSync(agents, 0o755);
    });

  test('a kext falls back from Contents/Info.plist to a root Info.plist; a file beside the dirs is hashed as itself', () => {
    const dir = scratch();
    const { surface, kexts, ext } = surfaceOn(dir);
    mkdirSync(join(kexts, 'Old.kext'), { recursive: true });
    writeFileSync(join(kexts, 'Old.kext', 'Info.plist'), '<plist>old</plist>');
    const r = collectPersistence({ surface });
    assert.equal(itemFor(r, join(kexts, 'Thing.kext')).sha256, sha('<plist>kext</plist>'));
    assert.equal(itemFor(r, join(kexts, 'Old.kext')).sha256, sha('<plist>old</plist>'));
    // VS Code decides what to LOAD from extensions.json, so the registry file is as much a surface
    // as the directories it points at.
    assert.equal(itemFor(r, join(ext, 'extensions.json')).sha256, sha('[{"identifier":"pub.good"}]'));
  });

  test('a directory in a plain root is hashed over its child NAMES — a new child is CHANGED, not silence', () => {
    const dir = scratch();
    const { surface, agents } = surfaceOn(dir);
    mkdirSync(join(agents, 'nested'), { recursive: true });
    const before = collectPersistence({ surface });
    const nested = itemFor(before, join(agents, 'nested'));
    assert.ok(nested, 'a directory inside a launchd root is observed, not skipped');
    writeFileSync(join(agents, 'nested', 'com.evil.plist'), '<plist/>');
    const after = collectPersistence({ surface });
    assert.notEqual(itemFor(after, join(agents, 'nested')).sha256, nested.sha256);
  });
});

describe('single files', () => {
  test('an absent file is absent; an unreadable one is unknown, never absent', { skip: asRoot && 'running as root' }, () => {
    const dir = scratch();
    const { surface } = surfaceOn(dir);
    const r = collectPersistence({ surface });
    assert.ok(itemFor(r, join(dir, 'hosts')));
    assert.ok(!itemFor(r, join(dir, 'absent-ssh-config')), 'ENOENT is legitimate absence');
    assert.ok(!unknownFor(r, join(dir, 'absent-ssh-config')), 'and is NOT an unknown');

    chmodSync(join(dir, 'hosts'), 0o000);
    const locked = collectPersistence({ surface });
    assert.equal(unknownFor(locked, join(dir, 'hosts'))?.unknownReason, 'not-permitted');
    chmodSync(join(dir, 'hosts'), 0o644);
  });
});

describe('command sources', () => {
  const cmdSurface = (commands) => ({ roots: [], files: [], profiles: [], commands });

  test('a tool saying "none installed" on exit 0 is legitimately empty — not an item that CHANGES on the first install', () => {
    const surface = cmdSurface([{
      key: 'profiles-list', kind: 'config-profile', cmd: 'profiles', args: ['list'],
      emptyOut: /^There are no configuration profiles installed/m,
    }]);
    const empty = collectPersistence({ surface, exec: () => "There are no configuration profiles installed for user 'someone'\n" });
    assert.deepEqual(empty.items, []);
    assert.deepEqual(empty.unknowns, []);

    const installed = collectPersistence({ surface, exec: () => '_computerlevel[1] attribute: profileIdentifier: com.example.mdm\n' });
    assert.equal(installed.items.length, 1);
    assert.equal(installed.items[0].kind, 'config-profile');
  });

  test('a store that needs root is unknown(not-permitted); any other failure is tool-failed', () => {
    const surface = cmdSurface([{
      key: 'sfltool-dumpbtm', kind: 'login-item', cmd: 'sfltool', args: ['dumpbtm'],
      notPermitted: /root|privilege|not permitted|Operation not permitted/i,
    }]);
    const denied = collectPersistence({ surface, exec: () => { const e = new Error('x'); e.status = 1; e.stderr = 'sfltool: must be run as root'; throw e; } });
    assert.equal(denied.unknowns[0].unknownReason, 'not-permitted');
    assert.deepEqual(denied.items, []);

    const broken = collectPersistence({ surface, exec: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; } });
    assert.equal(broken.unknowns[0].unknownReason, 'tool-failed');
  });

  test('git reads the SAME home the file sources do — the command source carries HOME, at call time', async () => {
    const seen = [];
    await env({ CW_PERSIST_HOME: '/tmp/fake-home' }, async () => {
      const s = surfaceFor('darwin');
      const git = s.commands.find((c) => c.key === 'git-config-global');
      collectPersistence({
        surface: { roots: [], files: [], profiles: [], commands: [git] },
        exec: (cmd, args, opts) => { seen.push({ cmd, args, home: opts.env.HOME }); return 'core.hookspath=/tmp/hooks\n'; },
      });
    })();
    assert.deepEqual(seen, [{ cmd: 'git', args: ['config', '--global', '--list'], home: '/tmp/fake-home' }]);
  });
});

describe('baseline compatibility — an old baseline must not publish 37 extensions as a compromise', () => {
  const observedOf = (items, unknowns = [], surfaces = []) => ({ items, unknowns, surfaces });
  const I = (id, kind, sha256 = 'a'.repeat(64)) => ({ id, kind, sha256, size: 1 });

  test('baselineCovers: a surfaces list is the answer; no list covers everything except the new kinds', () => {
    assert.equal(baselineCovers({ surfaces: ['launchagent-user'] }, 'launchagent-user'), true);
    assert.equal(baselineCovers({ surfaces: ['launchagent-user'] }, 'editor-extension'), false);
    assert.equal(baselineCovers({ items: [] }, 'editor-extension'), false, 'a pre-surfaces baseline never covered a new kind');
    assert.equal(baselineCovers({ items: [] }, 'launchagent-user'), true, 'and did cover the old ones');
    // listening-ports.mjs reuses this diff with its own kind; a pre-surfaces baseline must keep
    // working there, or a port diff starts reporting every port as unbaselined.
    assert.equal(baselineCovers({ items: [] }, 'listener'), true);
  });

  test('items of an uncovered kind are UNBASELINED and partial — never added, never findings', () => {
    const legacy = { at: 't0', items: [I('/Users/x/Library/LaunchAgents/a.plist', 'launchagent-user')] };
    const r = diffPersistence(observedOf([
      I('/Users/x/Library/LaunchAgents/a.plist', 'launchagent-user'),
      I('/Users/x/.vscode/extensions/pub.a-1.0.0', 'editor-extension'),
      I('/Users/x/.vscode/extensions/pub.b-1.0.0', 'editor-extension'),
      I('/etc/hosts', 'hosts'),
    ]), legacy);
    assert.deepEqual(r.added, [], 'nothing the baseline never looked at may be a finding');
    assert.equal(r.unbaselined.length, 3);
    assert.deepEqual(countByKind(r.unbaselined), { 'editor-extension': 2, hosts: 1 });
    assert.equal(r.state, 'partial');
    assert.equal(r.unchanged, 1);
  });

  test('a baseline that DOES cover the kind treats a new extension as the finding it is', () => {
    const base = { at: 't0', surfaces: ['editor-extension', 'launchagent-user'], items: [I('/Users/x/.vscode/extensions/pub.a-1.0.0', 'editor-extension')] };
    const r = diffPersistence(observedOf([
      I('/Users/x/.vscode/extensions/pub.a-1.0.0', 'editor-extension'),
      I('/Users/x/.vscode/extensions/pub.evil-9.9.9', 'editor-extension'),
      I('/etc/sudoers', 'sudoers'),
    ]), base);
    assert.deepEqual(r.added.map((i) => i.id), ['/Users/x/.vscode/extensions/pub.evil-9.9.9']);
    assert.deepEqual(r.unbaselined.map((i) => i.kind), ['sudoers'], 'a kind outside the recorded surfaces is still unbaselined');
    assert.equal(r.state, 'findings');
  });

  test('end to end: legacy baseline → unbaselined, re-accept → pinned, then a planted extension → ADDED', async () => {
    const dir = scratch();
    const basePath = join(dir, 'persist.json');
    const { surface, ext } = surfaceOn(dir);
    await env({ CW_PERSIST_BASELINE: basePath, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      // a baseline written before any of this existed: launchd only, no surfaces field
      const legacyItems = collectPersistence({ surface }).items.filter((i) => i.kind === 'launchagent-user');
      writeFileSync(basePath, `${JSON.stringify({ at: '2026-08-01T00:00:00.000Z', items: legacyItems }, null, 2)}\n`);
      const stale = runLens({ surface });
      assert.equal(stale.state, 'partial');
      assert.deepEqual(stale.added, []);
      assert.ok(stale.unbaselined.length >= 3);
      assert.equal(stale.baselineSurfaces, null, 'the payload says the baseline recorded no surfaces');

      const a = acceptBaseline({ surface });
      assert.deepEqual(a.surfaces, ['editor-extension', 'hosts', 'kext', 'launchagent-user', 'ssh']);
      const pinned = runLens({ surface });
      assert.deepEqual([pinned.added, pinned.changed, pinned.removed, pinned.unbaselined], [[], [], [], []]);
      // partial, not ok: the manifest-less extension directory is still an unknown, and an unknown
      // nobody could pin is exactly what must not round down to a clean run.
      assert.equal(pinned.state, 'partial');
      assert.equal(pinned.unknowns.length, 1);

      mkdirSync(join(ext, 'pub.evil-9.9.9'), { recursive: true });
      writeFileSync(join(ext, 'pub.evil-9.9.9', 'package.json'), '{"name":"evil","main":"./beacon.js"}');
      const r = runLens({ surface });
      assert.equal(r.state, 'findings');
      assert.deepEqual(r.added.map((i) => i.id), [join(ext, 'pub.evil-9.9.9')]);
      assert.deepEqual(r.unbaselined, []);
    })();
  });

  test('the baseline records kinds that held nothing, so the first item to appear there is a finding', async () => {
    const dir = scratch();
    const basePath = join(dir, 'persist.json');
    const empty = join(dir, 'resolver');
    mkdirSync(empty, { recursive: true });
    const surface = { roots: [{ dir: empty, kind: 'resolver' }], files: [], profiles: [], commands: [] };
    await env({ CW_PERSIST_BASELINE: basePath, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      const a = acceptBaseline({ surface });
      assert.equal(a.pinned, 0);
      assert.deepEqual(a.surfaces, ['resolver'], 'an empty surface is still a covered surface');
      writeFileSync(join(empty, 'internal.example'), 'nameserver 10.0.0.1\n');
      const r = runLens({ surface });
      assert.equal(r.state, 'findings');
      assert.equal(r.added.length, 1);
      assert.deepEqual(r.unbaselined, []);
    })();
  });

  test('collection over the widened surface is deterministic and stores no content', async () => {
    const dir = scratch();
    const basePath = join(dir, 'persist.json');
    const { surface } = surfaceOn(dir);
    assert.deepEqual(collectPersistence({ surface }), collectPersistence({ surface }));
    await env({ CW_PERSIST_BASELINE: basePath, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      acceptBaseline({ surface });
      const written = readFileSync(basePath, 'utf8');
      assert.ok(!written.includes('SENTINEL-AGENT-BODY'), 'a launch agent body never reaches the baseline');
      assert.ok(!written.includes('"name":"good"'), 'nor an extension manifest body');
      acceptBaseline({ surface });
      assert.equal(readFileSync(basePath, 'utf8'), written, 'same inputs, byte-identical baseline');
    })();
  });
});
