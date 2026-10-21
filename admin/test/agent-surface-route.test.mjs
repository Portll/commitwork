import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routes } from '../routes/agent-surface.mjs';

const GET = routes.find((r) => r.method === 'GET' && r.path === '/api/agent-surface');
const POST = routes.find((r) => r.method === 'POST' && r.path === '/api/agent-surface');

function fixtureEnv() {
  const d = mkdtempSync(join(tmpdir(), 'cw-surface-route-'));
  const surface = join(d, 'agent-surface.json');
  writeFileSync(surface, JSON.stringify({
    hooks: { 'guard-destructive': { kind: 'hook', event: 'PreToolUse', matcher: 'Bash', command: 'node $CW_ROOT/bin/hooks/guard-destructive.mjs', selftest: ['node', '$CW_ROOT/bin/hooks/guard-destructive.mjs', '--selftest'], selftestExpect: 'live', why: 'the pre-action gate' } },
    mcp: { commitwork: { kind: 'mcp', command: 'node', args: ['$CW_ROOT/mcp/server.mjs'] } },
    launch: {},
  }));
  const settings = join(d, 'settings.json'); writeFileSync(settings, JSON.stringify({ hooks: {} }));
  const claudeJson = join(d, 'claude.json'); writeFileSync(claudeJson, JSON.stringify({ mcpServers: {} }));
  const baseline = join(d, 'confint.json');
  const targets = join(d, 'targets.json'); writeFileSync(targets, JSON.stringify([{ path: settings, kind: 'config' }]));
  return { d, env: { CW_AGENT_SURFACE: surface, CW_SETTINGS: settings, CW_CLAUDE_JSON: claudeJson, CW_CONFINT_BASELINE: baseline, CW_CONFINT_TARGETS: targets }, settings, claudeJson };
}

function ctx({ loopback = true, body = null } = {}) {
  const calls = [];
  return {
    ctx: {
      req: {}, isLoopbackReq: loopback, adminSession: () => null,
      send: (code, payload) => { calls.push({ code, payload }); return payload; },
      readJsonBody: (_req, cb) => cb(body, body ? null : 'no body'),
    },
    calls,
  };
}

const withEnv = (kv, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally { for (const k of Object.keys(kv)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

test('GET returns every entry with the three states', () => {
  const f = fixtureEnv();
  withEnv(f.env, () => {
    const { ctx: c, calls } = ctx();
    GET.handle(c);
    assert.equal(calls[0].code, 200);
    const ids = calls[0].payload.entries.map((e) => e.id).sort();
    assert.deepEqual(ids, ['commitwork', 'guard-destructive']);
    const hook = calls[0].payload.entries.find((e) => e.id === 'guard-destructive');
    assert.equal(hook.registered, false);
    assert.equal(hook.installed, true);
    assert.equal(hook.live, true);
  });
});

test('a non-loopback request with no session is refused', () => {
  const f = fixtureEnv();
  withEnv(f.env, () => {
    const { ctx: c, calls } = ctx({ loopback: false });
    GET.handle(c);
    assert.equal(calls[0].code, 401);
  });
});

test('POST enable then disable a hook toggles the settings file', () => {
  const f = fixtureEnv();
  withEnv(f.env, () => {
    const on = ctx({ body: { id: 'guard-destructive', action: 'enable' } });
    POST.handle(on.ctx);
    assert.equal(on.calls[0].code, 200);
    assert.equal(on.calls[0].payload.state.entries.find((e) => e.id === 'guard-destructive').registered, true);
    assert.ok(JSON.parse(readFileSync(f.settings, 'utf8')).hooks.PreToolUse.length === 1);

    const off = ctx({ body: { id: 'guard-destructive', action: 'disable' } });
    POST.handle(off.ctx);
    assert.equal(off.calls[0].payload.state.entries.find((e) => e.id === 'guard-destructive').registered, false);
  });
});

test('POST rejects an unknown id and a bad action', () => {
  const f = fixtureEnv();
  withEnv(f.env, () => {
    const a = ctx({ body: { id: 'nope', action: 'enable' } });
    POST.handle(a.ctx);
    assert.equal(a.calls[0].code, 400);
    const b = ctx({ body: { id: 'guard-destructive', action: 'destroy' } });
    POST.handle(b.ctx);
    assert.equal(b.calls[0].code, 400);
  });
});

test('an MCP toggle never writes settings.json', () => {
  const f = fixtureEnv();
  withEnv(f.env, () => {
    const on = ctx({ body: { id: 'commitwork', action: 'enable' } });
    POST.handle(on.ctx);
    assert.equal(on.calls[0].code, 200);
    assert.equal(JSON.parse(readFileSync(f.settings, 'utf8')).mcpServers, undefined);
    assert.ok(JSON.parse(readFileSync(f.claudeJson, 'utf8')).mcpServers.commitwork);
  });
});
