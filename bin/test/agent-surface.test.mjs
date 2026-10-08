import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, statusOf, toggle } from '../agent-surface.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-surface-'));

function fixture() {
  const d = scratch();
  const surface = join(d, 'agent-surface.json');
  writeFileSync(surface, JSON.stringify({
    hooks: { 'guard-destructive': { kind: 'hook', event: 'PreToolUse', matcher: 'Bash', command: 'node $CW_ROOT/bin/hooks/guard-destructive.mjs', selftest: ['node', '$CW_ROOT/bin/hooks/guard-destructive.mjs', '--selftest'], selftestExpect: 'live' } },
    mcp: { commitwork: { kind: 'mcp', command: 'node', args: ['$CW_ROOT/mcp/server.mjs'] } },
    launch: { veld: { kind: 'launch', plist: 'net.portll.veld-desktop', probe: 'http://127.0.0.1:59999/none' } },
  }));
  const settings = join(d, 'settings.json'); writeFileSync(settings, JSON.stringify({ hooks: {} }));
  const claudeJson = join(d, 'claude.json'); writeFileSync(claudeJson, JSON.stringify({ mcpServers: {} }));
  const baseline = join(d, 'confint.json');
  const targets = join(d, 'targets.json'); writeFileSync(targets, JSON.stringify([{ path: settings, kind: 'config' }]));
  return { d, surface, settings, claudeJson, baseline, targets };
}

const withEnv = (kv, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally { for (const k of Object.keys(kv)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

test('the manifest loads hooks, mcp and launch into one id-keyed map', () => {
  const { surface } = fixture();
  withEnv({ CW_AGENT_SURFACE: surface }, () => {
    assert.deepEqual(Object.keys(loadManifest()).sort(), ['commitwork', 'guard-destructive', 'veld']);
    assert.equal(loadManifest()['guard-destructive'].kind, 'hook');
  });
});

test('a hook reports registered/live/installed as three separate facts', () => {
  const f = fixture();
  withEnv({ CW_AGENT_SURFACE: f.surface, CW_SETTINGS: f.settings, CW_CLAUDE_JSON: f.claudeJson }, () => {
    const st = statusOf(loadManifest()['guard-destructive']);
    assert.equal(st.registered, false);
    assert.equal(st.live, true, 'the real --selftest passes for the installed script');
    assert.equal(st.installed, true);
  });
});

test('enable then disable a hook is a clean round trip, and the journal records each pin', () => {
  const f = fixture();
  withEnv({ CW_AGENT_SURFACE: f.surface, CW_SETTINGS: f.settings, CW_CLAUDE_JSON: f.claudeJson, CW_CONFINT_BASELINE: f.baseline, CW_CONFINT_TARGETS: f.targets }, () => {
    const entry = loadManifest()['guard-destructive'];
    toggle(entry, true);
    assert.equal(statusOf(entry).registered, true);
    const on = JSON.parse(readFileSync(f.settings, 'utf8'));
    assert.equal(on.hooks.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('guard-destructive'))).length, 1);
    toggle(entry, false);
    assert.equal(statusOf(entry).registered, false);
    const journal = readFileSync(join(dirname(f.baseline), 'config-integrity-journal.jsonl'), 'utf8').trim().split('\n');
    assert.equal(journal.length, 2);
    assert.match(JSON.parse(journal[0]).why, /enable guard-destructive/);
    assert.match(JSON.parse(journal[1]).why, /disable guard-destructive/);
  });
});

test('enabling a hook twice does not duplicate the registration', () => {
  const f = fixture();
  withEnv({ CW_AGENT_SURFACE: f.surface, CW_SETTINGS: f.settings, CW_CLAUDE_JSON: f.claudeJson, CW_CONFINT_BASELINE: f.baseline, CW_CONFINT_TARGETS: f.targets }, () => {
    const entry = loadManifest()['guard-destructive'];
    toggle(entry, true); toggle(entry, true);
    const s = JSON.parse(readFileSync(f.settings, 'utf8'));
    assert.equal(s.hooks.PreToolUse.filter((g) => g.hooks.some((h) => h.command.includes('guard-destructive'))).length, 1);
  });
});

test('an MCP toggle writes ~/.claude.json (mcpServers), NEVER settings.json', () => {
  const f = fixture();
  withEnv({ CW_AGENT_SURFACE: f.surface, CW_SETTINGS: f.settings, CW_CLAUDE_JSON: f.claudeJson, CW_CONFINT_BASELINE: f.baseline, CW_CONFINT_TARGETS: f.targets }, () => {
    const entry = loadManifest().commitwork;
    toggle(entry, true);
    assert.ok(JSON.parse(readFileSync(f.claudeJson, 'utf8')).mcpServers.commitwork.command.endsWith('node'));
    assert.equal(JSON.parse(readFileSync(f.settings, 'utf8')).mcpServers, undefined, 'an MCP server must never land in settings.json');
    toggle(entry, false);
    assert.equal(JSON.parse(readFileSync(f.claudeJson, 'utf8')).mcpServers.commitwork, undefined);
  });
});

test('a launch probe that does not answer reports live=false, and disable is a declared no-op', () => {
  const f = fixture();
  withEnv({ CW_AGENT_SURFACE: f.surface, CW_SETTINGS: f.settings, CW_CLAUDE_JSON: f.claudeJson }, () => {
    const entry = loadManifest().veld;
    assert.equal(statusOf(entry).live, false);
    assert.match(toggle(entry, false).note, /no-op by design/);
  });
});
