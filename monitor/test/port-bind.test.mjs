// node --test monitor/test/ — the port/bind lens. The seam it closes: route auth and socket bind
// are decided by different code, so every route test can stay green while the process listens on
// 0.0.0.0. These tests pin the verdict discipline hardest: 'match' only when every declared axis
// decided ok; an undecidable axis is undetermined (never a pass, never a finding); absent is its
// own state; enumeration failure is unknown, never an empty result.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ifaceClass, parseLsofListeners, parseSsListeners, assessBinds, probeAuth, collectListeners, runLens,
} from '../port-bind.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-bind-')); dirs.push(d); return d; };

const DECL = (over = {}) => ({
  binds: [{
    port: 7878, iface: 'loopback', purpose: 'panel', owner: 'commitwork',
    entryMatch: 'admin/serve.mjs', auth: null, probePath: null, required: false, ...over,
  }],
  stdio: [],
});
const L = (over = {}) => ({ pid: 11, command: 'node', args: 'node admin/serve.mjs', addr: '127.0.0.1', port: 7878, ...over });

describe('ifaceClass', () => {
  test('loopback, any, addressed — v4 and v6 forms', () => {
    assert.equal(ifaceClass('127.0.0.1'), 'loopback');
    assert.equal(ifaceClass('127.0.0.2'), 'loopback');
    assert.equal(ifaceClass('[::1]'), 'loopback');
    assert.equal(ifaceClass('*'), 'any');
    assert.equal(ifaceClass('0.0.0.0'), 'any');
    assert.equal(ifaceClass('[::]'), 'any');
    assert.equal(ifaceClass('192.168.1.5'), 'addressed');
  });
});

describe('parsers', () => {
  test('lsof -Fpcn field output, v4 and v6', () => {
    const rows = parseLsofListeners('p11\ncnode\nn127.0.0.1:7878\nn[::1]:7878\np22\ncollama\nn*:11434\n');
    assert.deepEqual(rows, [
      { pid: 11, command: 'node', addr: '127.0.0.1', port: 7878 },
      { pid: 11, command: 'node', addr: '[::1]', port: 7878 },
      { pid: 22, command: 'ollama', addr: '*', port: 11434 },
    ]);
  });

  test('ss -ltnpH rows, with and without the process column', () => {
    const rows = parseSsListeners(
      'LISTEN 0 511 127.0.0.1:7878 0.0.0.0:* users:(("node",pid=11,fd=23))\n'
      + 'LISTEN 0 511 0.0.0.0:22 0.0.0.0:*\n',
    );
    assert.deepEqual(rows, [
      { pid: 11, command: 'node', addr: '127.0.0.1', port: 7878 },
      { pid: null, command: null, addr: '0.0.0.0', port: 22 },
    ]);
  });
});

describe('assessBinds — the verdict discipline', () => {
  test('everything declared decides ok ⇒ match', () => {
    const r = assessBinds(DECL(), [L()]);
    assert.equal(r.rows[0].verdict, 'match');
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.findings, []);
  });

  test('THE seam: loopback declared, 0.0.0.0 observed ⇒ mismatch, and it alarms', () => {
    const r = assessBinds(DECL(), [L({ addr: '0.0.0.0' })]);
    assert.equal(r.rows[0].verdict, 'mismatch');
    assert.equal(r.rows[0].iface.ok, false);
    assert.equal(r.state, 'findings');
  });

  test('narrower than declared is fine — declared any, observed loopback ⇒ match', () => {
    const r = assessBinds(DECL({ iface: 'any' }), [L()]);
    assert.equal(r.rows[0].verdict, 'match');
  });

  test('a port bound loopback AND any is judged by its worst bind', () => {
    const r = assessBinds(DECL(), [L(), L({ addr: '[::]' })]);
    assert.equal(r.rows[0].verdict, 'mismatch');
    assert.equal(r.rows[0].iface.observed, 'any');
  });

  test('not listening ⇒ absent — its own state, never a finding, never clean', () => {
    const r = assessBinds(DECL(), []);
    assert.equal(r.rows[0].verdict, 'absent');
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.findings, []);
  });

  test('an unknown program on our port ⇒ process mismatch (the impersonation seam)', () => {
    const r = assessBinds(DECL(), [L({ args: 'python3 -m http.server 7878' })]);
    assert.equal(r.rows[0].verdict, 'mismatch');
    assert.equal(r.rows[0].process.ok, false);
  });

  test('no command line available ⇒ the process axis is undetermined, and the verdict follows', () => {
    const r = assessBinds(DECL(), [L({ args: null })]);
    assert.equal(r.rows[0].process.ok, null);
    assert.equal(r.rows[0].process.unknown, true);
    assert.equal(r.rows[0].verdict, 'undetermined', 'a match may not be claimed over an undecided axis');
    assert.equal(r.state, 'undetermined');
    assert.deepEqual(r.findings, [], 'undetermined never alarms');
  });

  test('auth declared challenged, probe observed open ⇒ mismatch', () => {
    const r = assessBinds(DECL({ auth: 'challenged', probePath: '/api/x' }), [L()], { 7878: { observed: 'open', status: 200 } });
    assert.equal(r.rows[0].verdict, 'mismatch');
    assert.equal(r.rows[0].auth.ok, false);
  });

  test('auth declared but the probe did not run ⇒ undetermined, not match', () => {
    const r = assessBinds(DECL({ auth: 'challenged', probePath: '/api/x' }), [L()]);
    assert.equal(r.rows[0].auth.ok, null);
    assert.equal(r.rows[0].verdict, 'undetermined');
  });

  test('a stdio-by-design entry holding a TCP socket is a finding', () => {
    const decl = { binds: [], stdio: [{ purpose: 'mcp', entryMatch: 'mcp/server.mjs' }] };
    const r = assessBinds(decl, [L({ args: 'node mcp/server.mjs', port: 9999, addr: '127.0.0.1' })]);
    assert.equal(r.stdioFindings.length, 1);
    assert.equal(r.stdioFindings[0].verdict, 'stdio-violation');
    assert.equal(r.state, 'findings');
  });
});

describe('probeAuth — classification, injected fetch', () => {
  const withStatus = (status, headers = {}) => async () => ({ status, headers: { get: (k) => headers[k] ?? null } });

  test('401/403 and redirects read as challenged', async () => {
    assert.equal((await probeAuth(1, '/x', { fetchImpl: withStatus(401) })).observed, 'challenged');
    const r = await probeAuth(1, '/x', { fetchImpl: withStatus(302, { location: '/login' }) });
    assert.equal(r.observed, 'challenged');
    assert.equal(r.redirect, '/login');
  });

  test('2xx reads as open', async () => {
    assert.equal((await probeAuth(1, '/x', { fetchImpl: withStatus(200) })).observed, 'open');
  });

  test('404 means the probePath names nothing — unknown, NEVER challenged', async () => {
    const r = await probeAuth(1, '/x', { fetchImpl: withStatus(404) });
    assert.equal(r.observed, null);
    assert.equal(r.unknownReason, 'no-subject');
  });

  test('5xx is unstated — the service answered and could not say', async () => {
    const r = await probeAuth(1, '/x', { fetchImpl: withStatus(503) });
    assert.equal(r.unknownReason, 'unstated');
  });

  test('connection refused is absent; a network failure is unknown', async () => {
    const refused = async () => { const e = new Error('fetch failed'); e.cause = { code: 'ECONNREFUSED' }; throw e; };
    assert.equal((await probeAuth(1, '/x', { fetchImpl: refused })).observed, 'absent');
    const dead = async () => { const e = new Error('fetch failed'); e.cause = { code: 'EHOSTUNREACH' }; throw e; };
    assert.equal((await probeAuth(1, '/x', { fetchImpl: dead })).unknownReason, 'tool-failed');
  });
});

describe('the lens end to end, on fixtures', () => {
  const env = (kv, fn) => async () => {
    const saved = {};
    for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
    try { await fn(); } finally {
      for (const k of Object.keys(kv)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    }
  };

  test('fixture listeners + fixture declarations, probe off — deterministic verdicts', async () => {
    const dir = scratch();
    const decls = join(dir, 'decls.json');
    const lst = join(dir, 'listeners.json');
    writeFileSync(decls, JSON.stringify(DECL()));
    writeFileSync(lst, JSON.stringify([L()]));
    await env({ CW_BIND_DECLARATIONS: decls, CW_BIND_LISTENERS: lst, CW_BIND_PROBE: '0', CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      const r = await runLens();
      assert.equal(r.state, 'ok');
      assert.equal(r.method, 'fixture');
      assert.equal(r.at, '2026-08-27T00:00:00.000Z');
      assert.equal(r.rows[0].verdict, 'match');
    })();
  });

  test('enumeration failure is unknown — never "no listeners"', async () => {
    const dir = scratch();
    const decls = join(dir, 'decls.json');
    writeFileSync(decls, JSON.stringify(DECL()));
    await env({ CW_BIND_DECLARATIONS: decls, CW_BIND_PROBE: '0' }, async () => {
      const r = await runLens({ exec: () => { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } });
      assert.equal(r.unknown, true);
      assert.equal(r.unknownReason, 'tool-failed');
      assert.equal(r.rows, undefined, 'an unenumerable box must not carry rows that read as results');
    })();
  });

  test('a fixture that is not an array fails closed', async () => {
    const dir = scratch();
    const lst = join(dir, 'bad.json');
    writeFileSync(lst, JSON.stringify({ not: 'an array' }));
    await env({ CW_BIND_LISTENERS: lst }, async () => {
      assert.throws(() => collectListeners());
    })();
  });
});

describe('the schema is applied, not merely listed', () => {
  test('an invalid declarations file REFUSES to load — never asserts whatever parsed', async () => {
    const dir = scratch();
    const decls = join(dir, 'decls.json');
    writeFileSync(decls, JSON.stringify({ binds: [{ ...DECL().binds[0], port: '7878' }], stdio: [] }));   // port as a string
    const saved = process.env.CW_BIND_DECLARATIONS;
    process.env.CW_BIND_DECLARATIONS = decls;
    try { await assert.rejects(() => runLens(), /invalid/); }
    finally { if (saved === undefined) delete process.env.CW_BIND_DECLARATIONS; else process.env.CW_BIND_DECLARATIONS = saved; }
  });
});

describe('the shipped declarations file', () => {
  test('parses, and every row is well-formed', async () => {
    const { readFileSync } = await import('node:fs');
    const d = JSON.parse(readFileSync(new URL('../bind-declarations.json', import.meta.url), 'utf8'));
    assert.ok(Array.isArray(d.binds) && d.binds.length >= 3);
    for (const b of d.binds) {
      assert.ok(Number.isInteger(b.port) && b.port > 0, `port ${b.port}`);
      assert.ok(['loopback', 'any'].includes(b.iface), `iface ${b.iface}`);
      assert.ok(typeof b.purpose === 'string' && b.purpose.length, 'purpose');
      assert.ok(b.auth === null || b.auth === 'challenged', `auth ${b.auth}`);
      if (b.auth) assert.ok(typeof b.probePath === 'string' && b.probePath.startsWith('/'), 'a declared auth needs a probePath');
    }
    for (const s of d.stdio || []) assert.ok(typeof s.entryMatch === 'string' && s.entryMatch.length);
  });
});
