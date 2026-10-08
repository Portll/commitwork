#!/usr/bin/env node
/*
 * agent-surface.mjs — install and toggle commitwork's operator-local agent surface: PreToolUse/Stop
 * hooks, MCP servers and launch programs (manifests/agent-surface.json). This is the ONE actuator
 * over agent config in this repo, a scoped exception to declaration-split-from-authority: it writes
 * .claude/settings.json (hooks) and ~/.claude.json (mcpServers), never fleet or deployment surfaces.
 *
 *   node bin/agent-surface.mjs list
 *   node bin/agent-surface.mjs status [<id>]
 *   node bin/agent-surface.mjs enable  <id>
 *   node bin/agent-surface.mjs disable <id>
 * exit: 0 ok · 1 usage/unknown id · 2 failure
 * env: CW_AGENT_SURFACE (manifest), CW_SETTINGS (repo .claude/settings.json), CW_CLAUDE_JSON (~/.claude.json)
 *
 * Three states, never a boolean: registered (in the config file), live (selftest passes / socket
 * answers), installed (the target exists). A hook toggle re-pins config-integrity through repin() so
 * the change is journaled, never laundered.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { writeAtomic, acquireLockOrReason, forceReleaseLock } from '../monitor/lockfile.mjs';
import { repin } from '../monitor/config-integrity.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = () => process.env.CW_AGENT_SURFACE || join(CW, 'manifests', 'agent-surface.json');
const settingsPath = () => process.env.CW_SETTINGS || join(CW, '.claude', 'settings.json');
const claudeJsonPath = () => process.env.CW_CLAUDE_JSON || join(homedir(), '.claude.json');
const LOCK = () => `${settingsPath()}.agent-surface.lock`;
const HOOK_MARK = 'guard-destructive.mjs';

const expand = (s) => String(s)
  .replaceAll('$CW_ROOT', CW).replaceAll('$HOME', homedir())
  .replaceAll('$NODE', process.execPath);

export function loadManifest() {
  const doc = JSON.parse(readFileSync(manifestPath(), 'utf8'));
  const entries = {};
  for (const group of ['hooks', 'mcp', 'launch']) for (const [id, e] of Object.entries(doc[group] || {})) entries[id] = { id, ...e };
  return entries;
}

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// guard: registered, live and installed are three facts, never one boolean
function hookRegistered(entry, settings) {
  return (settings?.hooks?.[entry.event] || []).some((g) => (g?.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARK)));
}
function mcpRegistered(entry, cj) { const s = cj?.mcpServers?.[entry.id]; return !!(s && (s.command || s.url)); }

function hookLive(entry) {
  if (!Array.isArray(entry.selftest)) return { live: null, why: 'no selftest declared' };
  const [cmd, ...args] = entry.selftest.map(expand);
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 });
  if (r.status === null) return { live: null, why: `selftest did not complete (${r.error?.code || 'signal'})` };
  const ok = r.status === 0 && (!entry.selftestExpect || (r.stdout || '').includes(entry.selftestExpect));
  return { live: ok, why: ok ? 'selftest passed' : `selftest exit ${r.status}: ${(r.stdout || r.stderr || '').trim().slice(0, 80)}` };
}
function launchLive(entry) {
  if (entry.probe) {
    const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '2', expand(entry.probe)], { encoding: 'utf8' });
    const code = (r.stdout || '').trim();
    return { live: /^2\d\d$/.test(code), why: `probe ${entry.probe} → ${code || 'no answer'}` };
  }
  const r = spawnSync('launchctl', ['print', `gui/${process.getuid()}/${entry.plist}`], { encoding: 'utf8' });
  const running = r.status === 0 && /\bstate = running\b/.test(r.stdout || '');
  return { live: running, why: r.status === 0 ? (running ? 'launchd: running' : 'launchd: loaded, not running') : 'launchd: not loaded' };
}
function installed(entry) {
  if (entry.kind === 'mcp' && Array.isArray(entry.args) && entry.args[0]) return existsSync(expand(entry.args[0]));
  if (entry.kind === 'launch') { try { return statSync(join(homedir(), 'Library', 'LaunchAgents', `${entry.plist}.plist`)).isFile(); } catch { return false; } }
  if (entry.kind === 'hook') return existsSync(expand(entry.command).replace(/^node\s+/, ''));
  return null;
}

export function statusOf(entry, { settings, claudeJson } = {}) {
  const s = settings ?? readJSON(settingsPath());
  const cj = claudeJson ?? readJSON(claudeJsonPath());
  const registered = entry.kind === 'hook' ? hookRegistered(entry, s) : entry.kind === 'mcp' ? mcpRegistered(entry, cj) : null;
  const liveR = entry.kind === 'hook' ? hookLive(entry) : entry.kind === 'launch' ? launchLive(entry) : { live: null, why: 'liveness not probed for this kind' };
  return { id: entry.id, kind: entry.kind, registered, live: liveR.live, liveWhy: liveR.why, installed: installed(entry) };
}

function withLock(fn) {
  const lock = LOCK();
  const got = acquireLockOrReason(lock, { staleMs: 30_000 });
  if (!got.ok) throw new Error(`another agent-surface writer holds the lock (${got.reason}${got.holder ? `, held by ${got.holder}` : ''})`);
  try { return fn(); } finally { forceReleaseLock(lock); }
}

function setHook(entry, on) {
  const p = settingsPath();
  const s = readJSON(p) || {};
  s.hooks = s.hooks || {};
  const arr = s.hooks[entry.event] || [];
  const filtered = arr.filter((g) => !(g?.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARK)));
  if (on) filtered.push({ matcher: entry.matcher, hooks: [{ type: 'command', command: expand(entry.command), timeout: 10 }] });
  s.hooks[entry.event] = filtered;
  writeAtomic(p, `${JSON.stringify(s, null, 2)}\n`);
  repin({ who: `agent-surface:${process.env.USER || 'operator'}`, why: `${on ? 'enable' : 'disable'} ${entry.id}` });
}

function setMcp(entry, on) {
  const p = claudeJsonPath();
  const cj = readJSON(p) || {};
  cj.mcpServers = cj.mcpServers || {};
  if (on) cj.mcpServers[entry.id] = { type: 'stdio', command: expand(entry.command), args: (entry.args || []).map(expand) };
  else delete cj.mcpServers[entry.id];
  writeAtomic(p, `${JSON.stringify(cj, null, 2)}\n`);
}

export function toggle(entry, on) {
  return withLock(() => {
    if (entry.kind === 'hook') { setHook(entry, on); if (on) { const l = hookLive(entry); if (l.live === false) throw new Error(`${entry.id} registered but its selftest fails: ${l.why}`); } }
    else if (entry.kind === 'mcp') setMcp(entry, on);
    else if (entry.kind === 'launch') return { note: `launch programs load/unload through launchctl (${entry.plist}); disable here is a no-op by design — registration-only, never a stop` };
    return statusOf(entry);
  });
}

const fmt = (st) => `${st.id.padEnd(18)} ${st.kind.padEnd(7)} registered=${st.registered ?? '—'}  live=${st.live ?? '—'}  installed=${st.installed ?? '—'}${st.liveWhy ? `  (${st.liveWhy})` : ''}`;

if (isMainModule(import.meta.url)) {
  const [cmd, id] = process.argv.slice(2);
  const entries = loadManifest();
  try {
    if (cmd === 'list') { for (const e of Object.values(entries)) console.log(`${e.id.padEnd(18)} ${e.kind.padEnd(7)} ${e.why || ''}`); process.exit(0); }
    if (cmd === 'status') { if (id && !entries[id]) { console.error(`unknown id: ${id}`); process.exit(1); } for (const e of (id ? [entries[id]] : Object.values(entries))) console.log(fmt(statusOf(e))); process.exit(0); }
    if (cmd === 'enable' || cmd === 'disable') {
      if (!entries[id]) { console.error(`unknown id: ${id} (see: agent-surface list)`); process.exit(1); }
      const r = toggle(entries[id], cmd === 'enable');
      console.log(r.note ? `${id}: ${r.note}` : fmt(r));
      process.exit(0);
    }
    console.error('usage: agent-surface list | status [<id>] | enable <id> | disable <id>');
    process.exit(1);
  } catch (e) { console.error(`agent-surface: ${e.message}`); process.exit(2); }
}
