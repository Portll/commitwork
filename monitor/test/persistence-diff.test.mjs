// node --test monitor/test/ — the persistence-diff host lens. What matters here: identity is the
// PLACE (path/key), content is compared by hash and never stored (a plist can carry another
// party's arguments and the baseline lives where an audit may quote it); an unreadable item is an
// unknown that is counted, never skipped and never a finding; ENOENT is the only legitimate
// absence, for roots and baseline alike.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  surfaceFor, collectPersistence, diffPersistence, readBaseline, runLens, acceptBaseline,
} from '../persistence-diff.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-persist-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

// A fully injected surface over scratch dirs — the collector's real fs walk, fake roots.
function fakeSurface(dir, { crontabOut = 'MAILTO=x\n* * * * * /bin/true\n', crontabFails = null } = {}) {
  const agents = join(dir, 'LaunchAgents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'com.example.keeper.plist'), '<plist>SENTINEL-CONTENT-A</plist>');
  writeFileSync(join(dir, '.zshrc'), 'export PATH=$PATH\n');
  const exec = (cmd) => {
    if (cmd !== 'crontab') throw new Error(`unexpected exec ${cmd}`);
    if (crontabFails) { const e = new Error('crontab failed'); Object.assign(e, crontabFails); throw e; }
    return crontabOut;
  };
  return {
    surface: {
      roots: [{ dir: agents, kind: 'launchagent-user' }, { dir: join(dir, 'NoSuchDir'), kind: 'launchdaemon' }],
      profiles: [join(dir, '.zshrc'), join(dir, '.bash_profile')],
      commands: [{ key: 'crontab', kind: 'cron', cmd: 'crontab', args: ['-l'], emptyExit: /no crontab for/i }],
    },
    exec,
    agents,
  };
}

describe('surfaceFor', () => {
  test('each platform names its mutable surface', () => {
    const mac = surfaceFor('darwin', '/Users/x');
    assert.ok(mac.roots.some((r) => r.dir === '/Library/LaunchDaemons'));
    assert.ok(mac.roots.every((r) => !r.dir.startsWith('/System')), '/System is SIP-sealed vendor noise');
    assert.ok(mac.profiles.some((p) => p.endsWith('.zshrc')));
    const lin = surfaceFor('linux', '/home/x');
    assert.ok(lin.roots.some((r) => r.dir === '/etc/systemd/system'));
    const win = surfaceFor('win32', 'C:\\Users\\x');
    assert.ok(win.commands.some((c) => c.kind === 'runkey'));
  });
});

describe('collection', () => {
  test('files are hashed and sorted; an absent root is legitimate emptiness; commands become items', () => {
    const dir = scratch();
    const { surface, exec } = fakeSurface(dir);
    const r = collectPersistence({ surface, exec });
    assert.deepEqual(r.unknowns, []);
    assert.deepEqual(r.items.map((i) => i.kind).sort(), ['cron', 'launchagent-user', 'shell-profile']);
    for (const i of r.items) assert.match(i.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(r.items.map((i) => i.id), [...r.items.map((i) => i.id)].sort(), 'deterministic order');
  });

  test('collection is deterministic — two observations of the same surface are identical', () => {
    const dir = scratch();
    const { surface, exec } = fakeSurface(dir);
    assert.deepEqual(collectPersistence({ surface, exec }), collectPersistence({ surface, exec }));
  });

  test('an unreadable root is an unknown, never silence and never a finding', () => {
    const dir = scratch();
    const notADir = join(dir, 'file-not-dir');
    writeFileSync(notADir, 'x');
    const r = collectPersistence({ surface: { roots: [{ dir: notADir, kind: 'launchdaemon' }], profiles: [], commands: [] } });
    assert.equal(r.unknowns.length, 1);
    assert.equal(r.unknowns[0].unknownReason, 'not-permitted');
  });

  test('"no crontab" is legitimately empty; any other crontab failure is unknown', () => {
    const dir = scratch();
    const empty = fakeSurface(dir, { crontabFails: { status: 1, stderr: 'no crontab for portll' } });
    const r1 = collectPersistence({ surface: empty.surface, exec: empty.exec });
    assert.ok(!r1.items.some((i) => i.kind === 'cron'));
    assert.deepEqual(r1.unknowns, []);

    const dir2 = scratch();
    const broken = fakeSurface(dir2, { crontabFails: { status: 127, stderr: 'command mangled' } });
    const r2 = collectPersistence({ surface: broken.surface, exec: broken.exec });
    assert.equal(r2.unknowns.length, 1);
    assert.equal(r2.unknowns[0].unknownReason, 'tool-failed');
  });
});

describe('the diff — added is THE signal', () => {
  const observedOf = (items, unknowns = []) => ({ items, unknowns });
  const I = (id, sha256 = 'a'.repeat(64)) => ({ id, kind: 'launchagent-user', sha256, size: 1 });

  test('no baseline is its own state, with zero findings', () => {
    const r = diffPersistence(observedOf([I('/a')]), null);
    assert.equal(r.state, 'no-baseline');
    assert.deepEqual([r.added, r.changed, r.removed], [[], [], []]);
  });

  test('added, changed, removed classify; identical is ok', () => {
    const base = { at: 't0', items: [I('/a'), I('/b', 'b'.repeat(64))] };
    const r = diffPersistence(observedOf([I('/a'), I('/b', 'c'.repeat(64)), I('/new')]), base);
    assert.deepEqual(r.added.map((i) => i.id), ['/new']);
    assert.deepEqual(r.changed.map((i) => i.id), ['/b']);
    assert.equal(r.changed[0].baselineSha256, 'b'.repeat(64));
    assert.equal(r.state, 'findings');

    const same = diffPersistence(observedOf([I('/a')]), { at: 't0', items: [I('/a')] });
    assert.equal(same.state, 'ok');
    assert.equal(same.unchanged, 1);
  });

  test('a vanished item is removed — a wiped launch agent is as much an event as a planted one', () => {
    const r = diffPersistence(observedOf([]), { at: 't0', items: [I('/a')] });
    assert.deepEqual(r.removed.map((i) => i.id), ['/a']);
    assert.equal(r.state, 'findings');
  });

  test('unknowns with no diffs is partial — never ok, never findings', () => {
    const r = diffPersistence(observedOf([I('/a')], [{ id: '/locked', kind: 'launchdaemon', unknown: true, unknownReason: 'not-permitted' }]),
      { at: 't0', items: [I('/a')] });
    assert.equal(r.state, 'partial');
  });
});

describe('baseline discipline, end to end', () => {
  test('accept → ok → plant an agent → ADDED; and the baseline stores hashes, never content', async () => {
    const dir = scratch();
    const base = join(dir, 'persist.json');
    const { surface, exec, agents } = fakeSurface(dir);
    await env({ CW_PERSIST_BASELINE: base, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      assert.equal(runLens({ surface, exec }).state, 'no-baseline');
      const a = acceptBaseline({ surface, exec });
      assert.equal(a.pinned, 3);
      assert.ok(!readFileSync(base, 'utf8').includes('SENTINEL-CONTENT-A'),
        'the baseline must never store item content — it lives where an audit may quote it');
      assert.equal(runLens({ surface, exec }).state, 'ok');
      writeFileSync(join(agents, 'com.evil.implant.plist'), '<plist>persist me</plist>');
      const r = runLens({ surface, exec });
      assert.equal(r.state, 'findings');
      assert.deepEqual(r.added.map((i) => i.id), [join(agents, 'com.evil.implant.plist')]);
    })();
  });

  test('an unreadable baseline THROWS; only ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'persist.json');
    writeFileSync(b, '{nope');
    await env({ CW_PERSIST_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_PERSIST_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });
});
