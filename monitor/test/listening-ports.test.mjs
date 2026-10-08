// node --test monitor/test/ — item 5, the host-wide listener diff. Pinned: identity is the PORT,
// so a restart (new pid, same command/iface) is unchanged and an owner change on the same port is
// 'changed'; the finding is change nobody accepted, never presence; enumeration failure is
// unknown for the whole lens.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aggregateByPort, readBaseline, runLens, acceptBaseline } from '../listening-ports.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-lports-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

describe('aggregateByPort', () => {
  test('one item per port; v4+v6 binds of one service collapse; sorted by port', () => {
    const rows = aggregateByPort([
      { pid: 11, command: 'node', addr: '127.0.0.1', port: 7878 },
      { pid: 11, command: 'node', addr: '[::1]', port: 7878 },
      { pid: 22, command: 'ollama', addr: '*', port: 11434 },
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.port), [7878, 11434]);
    assert.deepEqual(rows[0].ifaces, ['loopback']);
    assert.deepEqual(rows[1].ifaces, ['any']);
  });

  test('a pid change with the same command and iface hashes identically — restarts are not events', () => {
    const a = aggregateByPort([{ pid: 11, command: 'node', addr: '127.0.0.1', port: 7878 }]);
    const b = aggregateByPort([{ pid: 999, command: 'node', addr: '127.0.0.1', port: 7878 }]);
    assert.equal(a[0].sha256, b[0].sha256);
  });

  test('an owner change on the same port hashes differently', () => {
    const a = aggregateByPort([{ pid: 11, command: 'node', addr: '127.0.0.1', port: 7878 }]);
    const b = aggregateByPort([{ pid: 11, command: 'python3', addr: '127.0.0.1', port: 7878 }]);
    assert.notEqual(a[0].sha256, b[0].sha256);
  });
});

describe('the lens end to end, on fixtures', () => {
  const L = (over = {}) => ({ pid: 11, command: 'node', args: 'node admin/serve.mjs', addr: '127.0.0.1', port: 7878, ...over });
  const fixtures = (listeners) => {
    const dir = scratch();
    const lst = join(dir, 'listeners.json');
    writeFileSync(lst, JSON.stringify(listeners));
    return { dir, lst };
  };

  test('accept → ok; a NEW listener is the event; a vanished one is GONE; declared binds join for context', async () => {
    const { dir, lst } = fixtures([L()]);
    const base = join(dir, 'ports.json');
    await env({ CW_PORTS_BASELINE: base, CW_BIND_LISTENERS: lst, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      assert.equal(runLens().state, 'no-baseline');
      assert.equal(acceptBaseline().pinned, 1);
      assert.equal(runLens().state, 'ok');

      writeFileSync(lst, JSON.stringify([L(), L({ pid: 666, command: 'nc', args: 'nc -l 4444', addr: '0.0.0.0', port: 4444 })]));
      const r = runLens();
      assert.equal(r.state, 'findings');
      assert.equal(r.added.length, 1);
      assert.equal(r.added[0].port, 4444);
      assert.deepEqual(r.added[0].ifaces, ['any']);

      writeFileSync(lst, JSON.stringify([]));
      const gone = runLens();
      assert.equal(gone.removed.length, 1);
      assert.equal(gone.removed[0].declared !== undefined, true, 'port 7878 joins its declaration for context');
    })();
  });

  test('an owner change on a known port reads CHANGED with the old owner named', async () => {
    const { dir, lst } = fixtures([L()]);
    const base = join(dir, 'ports.json');
    await env({ CW_PORTS_BASELINE: base, CW_BIND_LISTENERS: lst, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline();
      writeFileSync(lst, JSON.stringify([L({ command: 'python3', args: 'python3 -m http.server 7878' })]));
      const r = runLens();
      assert.equal(r.changed.length, 1);
      assert.deepEqual(r.changed[0].was.commands, ['node']);
      assert.deepEqual(r.changed[0].commands, ['python3']);
    })();
  });

  test('enumeration failure is unknown — never an empty listener set', async () => {
    const dir = scratch();
    await env({ CW_PORTS_BASELINE: join(dir, 'ports.json') }, async () => {
      const r = runLens({ exec: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } });
      assert.equal(r.unknown, true);
      assert.equal(r.state, 'unknown');
    })();
  });

  test('an unreadable baseline THROWS; only ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'ports.json');
    writeFileSync(b, '{corrupt');
    await env({ CW_PORTS_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_PORTS_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });
});
