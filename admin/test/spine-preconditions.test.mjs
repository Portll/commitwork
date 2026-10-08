// admin/test/spine-preconditions.test.mjs — reachable is not configured, and each of the five
// states must be reachable from a fixture, with the read-failure states never collapsing into
// absent. Every path is env-overridden AFTER import, which is the only way the call-time rule is
// actually tested rather than assumed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { spinePreconditions, registeredStore, commandPaths, resolveTarget, MCP_NAME } from '../lib/spine-preconditions.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-precond-'));
const ENV = ['CW_CLAUDE_JSON', 'CW_CLAUDE_SETTINGS', 'CW_LAUNCH_AGENTS_DIR', 'CW_SUBSTRATE_LAUNCH_LABEL', 'CW_PRECOND_PLATFORM', 'CW_CLAUDE_FUNCTIONS', 'SUBSTRATE_TASKS_DB'];
const saved = {};

before(() => { for (const k of ENV) saved[k] = process.env[k]; });
after(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

/** A fresh fixture home per case; returns the paths and points every override at it. */
function home(name) {
  const h = join(TMP, name);
  mkdirSync(join(h, 'LaunchAgents'), { recursive: true });
  process.env.CW_CLAUDE_JSON = join(h, 'claude.json');
  process.env.CW_CLAUDE_SETTINGS = join(h, 'settings.json');
  process.env.CW_LAUNCH_AGENTS_DIR = join(h, 'LaunchAgents');
  process.env.CW_PRECOND_PLATFORM = 'darwin';
  process.env.CW_CLAUDE_FUNCTIONS = join(h, '_functions');
  process.env.SUBSTRATE_TASKS_DB = join(h, 'tasks.db');
  return h;
}
const byId = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

const goodRegistration = (h) => ({ mcpServers: { [MCP_NAME]: { type: 'stdio', command: 'node', args: ['/x/overwatch-layer/spine/mcp.mjs'], env: { SUBSTRATE_TASKS_DB: join(h, 'tasks.db') } } } });
const goodHooks = {
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf \'{"additionalContext":"SPINE: use mcp__spine__* tools"}\'' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'printf \'{"systemMessage":"spine: did Claude call mcp__spine__update_task?"}\'' }] }],
  },
};
const goodPlist = '<plist><dict><key>Label</key><string>net.portll.substrate</string><key>ProgramArguments</key><array><string>node</string><string>/x/overwatch-layer/server/serve.mjs</string></array></dict></plist>';
// The corpus `corpus-links` resolves: the `@fn:` tree plus one command. A configured box HAS these
// — 69 of them on the real machine — so a fixture that omits them is not "fully configured", and
// usable:false would then be the honest answer rather than a broken expectation.
const goodCorpus = (h) => {
  mkdirSync(join(h, '_functions', 'p0'), { recursive: true });
  mkdirSync(join(h, 'commands'), { recursive: true });
  writeFileSync(join(h, 'commands', 'close.md'), '# close\n');
};

test('a fully configured box is usable, and every check is present', () => {
  const h = home('good');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify(goodHooks));
  writeFileSync(join(h, 'LaunchAgents', 'net.portll.substrate.plist'), goodPlist);
  goodCorpus(h);
  const r = spinePreconditions();
  assert.equal(r.usable, true);
  assert.deepEqual(r.checks.map((c) => c.state), ['present', 'present', 'present', 'present', 'present', 'present']);
  assert.equal(r.summary.present, 6);
  assert.equal(byId(r)['mcp-registration'].store, join(h, 'tasks.db'));
});

test('an empty home is ABSENT on every check, never usable, and each why names the file', () => {
  home('empty');
  const r = spinePreconditions();
  assert.equal(r.usable, false);
  for (const c of r.checks) {
    assert.equal(c.state, 'absent', `${c.id} must be absent on an empty home`);
    assert.ok(c.why && c.why.length, `${c.id} must say why`);
  }
});

test('the dead key — mcpServers in settings.json — is MISREGISTERED, not absent and not present', () => {
  const h = home('deadkey');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify({ mcpServers: {} }));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify({ ...goodHooks, ...goodRegistration(h) }));
  const c = byId(spinePreconditions())['mcp-registration'];
  assert.equal(c.state, 'misregistered');
  assert.match(c.why, /does not read/);
});

test('a registration pointing at a different store than the panel reads is MISREGISTERED — two resolvers, one store', () => {
  const h = home('twostores');
  const reg = goodRegistration(h);
  reg.mcpServers[MCP_NAME].env.SUBSTRATE_TASKS_DB = join(h, 'elsewhere.db');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(reg));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify(goodHooks));
  const c = byId(spinePreconditions())['mcp-registration'];
  assert.equal(c.state, 'misregistered');
  assert.match(c.why, /two stores/);
  assert.equal(c.store, join(h, 'elsewhere.db'));
  // No env on the entry means the spine's own default, which is what the panel defaults to as well.
  // The store moved from ~/.substrate to ~/.spine (spine-store-move-20260916); the predecessor's
  // variable name is still honoured so a registration written before the move resolves.
  assert.match(registeredStore({}), /\.spine\/tasks\.db$/);
  assert.equal(registeredStore({ env: { SUBSTRATE_TASKS_DB: '/legacy/tasks.db' } }), '/legacy/tasks.db');
  assert.equal(registeredStore({ env: { SPINE_TASKS_DB: '/new/tasks.db', SUBSTRATE_TASKS_DB: '/legacy/tasks.db' } }), '/new/tasks.db');
});

test('a hook naming the conductor predecessor is MISREGISTERED — it instructs a server registered nowhere', () => {
  const h = home('conductor');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf "Use mcp__conductor__* tools; call mcp__conductor__list_projects first"' }] }],
  } }));
  const r = byId(spinePreconditions());
  assert.equal(r['prompt-hook'].state, 'misregistered');
  assert.match(r['prompt-hook'].why, /mcp__conductor__/);
  assert.equal(r['stop-hook'].state, 'absent');
});

test('an UNREADABLE settings file is unreadable on both hook checks, never absent — fail closed', () => {
  const h = home('badjson');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, '{"hooks": {oops');
  const r = byId(spinePreconditions());
  assert.equal(r['prompt-hook'].state, 'unreadable');
  assert.equal(r['stop-hook'].state, 'unreadable');
  assert.match(r['prompt-hook'].why, /not valid JSON/);
  assert.equal(spinePreconditions().usable, false);
});

test('a permission-denied claude.json is unreadable, not absent', { skip: process.getuid && process.getuid() === 0 ? 'root reads everything' : false }, () => {
  const h = home('perm');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  chmodSync(process.env.CW_CLAUDE_JSON, 0o000);
  try {
    const c = byId(spinePreconditions())['mcp-registration'];
    assert.equal(c.state, 'unreadable');
    assert.doesNotMatch(c.why, /does not exist/);
  } finally { chmodSync(process.env.CW_CLAUDE_JSON, 0o600); }
});

test('a plist that exists and launches something else is MISREGISTERED; off macOS the check is not-applicable and does not veto usable', () => {
  const h = home('plist');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify(goodHooks));
  writeFileSync(join(h, 'LaunchAgents', 'net.portll.substrate.plist'), '<plist><dict><key>ProgramArguments</key><array><string>/usr/bin/true</string></array></dict></plist>');
  assert.equal(byId(spinePreconditions())['launch-agent'].state, 'misregistered');
  process.env.CW_PRECOND_PLATFORM = 'linux';
    goodCorpus(h);
  const r = spinePreconditions();
  assert.equal(byId(r)['launch-agent'].state, 'not-applicable');
  assert.equal(r.usable, true, 'an inapplicable check must not veto the three that passed');
  assert.equal(r.summary['not-applicable'], 1);
});

test('a hook whose target is a DANGLING SYMLINK is misregistered — declared, and firing nothing', () => {
  // D18, measured 2026-09-06: ~/.claude holds 69 symlinks into one checkout, and settings.json
  // names the hooks THROUGH them. Retire that checkout and every session's close path resolves to
  // nothing at the same instant, while all four other checks here stay green.
  const h = home('dangling');
  mkdirSync(join(h, 'hooks'), { recursive: true });
  const link = join(h, 'hooks', 'close-session.sh');
  symlinkSync(join(h, 'retired-checkout', 'hooks', 'close-session.sh'), link);
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify({ hooks: {
    ...goodHooks.hooks,
    SessionEnd: [{ hooks: [{ type: 'command', command: `bash ${link}` }] }],
  } }));
  const r = spinePreconditions();
  const c = byId(r)['hook-targets'];
  assert.equal(c.state, 'misregistered');
  assert.match(c.why, /do not resolve/);
  assert.equal(c.broken.length, 1);
  assert.equal(c.broken[0].state, 'dangling');
  assert.equal(r.usable, false, 'a close path that resolves to nothing must not read as configured');
});

test('a hook naming a file that was never there is misregistered too, and says missing rather than dangling', () => {
  const h = home('missing');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: `node ${join(h, 'fleet', 'register.mjs')}` }] }],
  } }));
  const c = byId(spinePreconditions())['hook-targets'];
  assert.equal(c.state, 'misregistered');
  assert.equal(c.broken[0].state, 'missing');
});

test('prose inside a hook PAYLOAD is not a hook target — the guard that keeps this reporting what RUNS', () => {
  // The live prompt hooks emit JSON whose text cites paths ("See ~/.claude/skills/drift/."). A
  // checker that resolved those would report on documentation and fail on every box that reads it.
  const h = home('prose');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: `printf '{"additionalContext":"use mcp__spine__* tools. See ${join(h, 'does', 'not', 'exist')}/ for more."}'` }] }],
  } }));
  assert.equal(byId(spinePreconditions())['hook-targets'].state, 'present');
  // ...and the inversion, or the rule passes against itself: the EXECUTABLE path is still read.
  assert.deepEqual(commandPaths(`node ${join(h, 'x.mjs')} --flag`), [join(h, 'x.mjs')]);
  assert.deepEqual(commandPaths(`/usr/bin/env node ${join(h, 'y.mjs')}`), ['/usr/bin/env', join(h, 'y.mjs')]);
  assert.deepEqual(commandPaths("printf '/not/a/target'"), []);
  assert.deepEqual(commandPaths('printf hello'), []);
  // A variable this process cannot expand is SKIPPED, never guessed at.
  assert.deepEqual(commandPaths('node ${CLAUDE_PLUGIN_ROOT}/server/index.js'), []);
});

test('the @fn: tree is flagged when it DANGLES, not when it is absent — a box that never had the primitives did not lose them', () => {
  const h = home('fn');
  writeFileSync(process.env.CW_CLAUDE_JSON, JSON.stringify(goodRegistration(h)));
  writeFileSync(process.env.CW_CLAUDE_SETTINGS, JSON.stringify(goodHooks));
  assert.equal(byId(spinePreconditions())['hook-targets'].state, 'present', 'absent is not lost');
  // The migration failure: one directory symlink, resolved by session discipline with no runtime
  // resolver, so a dangling tree produces silence rather than an error.
  symlinkSync(join(h, 'retired-checkout', '.claude', '_functions'), join(h, '_functions'));
  const c = byId(spinePreconditions())['hook-targets'];
  assert.equal(c.state, 'misregistered');
  assert.match(c.why, /@fn:/);
});

test('resolveTarget keeps ok, missing and dangling apart', () => {
  const h = home('resolve');
  writeFileSync(join(h, 'real.sh'), '#!/bin/sh\n');
  symlinkSync(join(h, 'real.sh'), join(h, 'good-link.sh'));
  symlinkSync(join(h, 'never.sh'), join(h, 'bad-link.sh'));
  assert.equal(resolveTarget(join(h, 'real.sh')).state, 'ok');
  assert.equal(resolveTarget(join(h, 'good-link.sh')).state, 'ok');
  assert.equal(resolveTarget(join(h, 'bad-link.sh')).state, 'dangling');
  assert.equal(resolveTarget(join(h, 'nothing.sh')).state, 'missing');
});

test('every check id has a remedy step in the install catalog, keyed identically', () => {
  home('ids');
  const cat = JSON.parse(readFileSync(join(REPO, 'manifests', 'install-catalog.json'), 'utf8'));
  const entry = cat.tools['overwatch-layer-spine'];
  assert.ok(entry && entry.manual === true, 'overwatch-layer-spine must be catalogued as manual — nothing here auto-installs it');
  const ids = spinePreconditions().checks.map((c) => c.id);
  assert.deepEqual(ids.sort(), Object.keys(entry.steps).sort(), 'a check with no remedy step is a red chip pointing at nothing');
  // The registration step must name the file Claude Code reads, since the wrong file was the first failure.
  assert.match(entry.steps['mcp-registration'], /claude mcp add/);
});

test('the state route carries preconditions, and reachable does not imply configured', async () => {
  home('route');   // empty: every check absent
  const { routes } = await import('../routes/overwatch-layer.mjs');
  const originalFetch = global.fetch;
  global.fetch = async (url) => new Response(JSON.stringify(String(url).endsWith('/api/v1/spine')
    ? { data: { plans: [], byProject: {}, unattributed: [], taskCount: 0 } }
    : { data: { sessions: [], backends: [], slots: null } }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const sent = [];
    const ctx = { req: {}, isLoopbackReq: true, adminSession: () => ({ user: 'op' }), readJsonBody: (_r, cb) => cb({}, null), send: (code, payload) => { sent.push({ code, payload }); } };
    await routes.find((r) => r.method === 'GET' && r.path === '/api/overwatch-layer/state').handle(ctx);
    const p = sent[0].payload;
    assert.equal(p.sources.spine.state, 'live', 'the socket answered');
    assert.equal(p.preconditions.usable, false, '...and the box is still not configured');
    assert.equal(p.preconditions.summary.absent, 6);
  } finally { global.fetch = originalFetch; }
});
