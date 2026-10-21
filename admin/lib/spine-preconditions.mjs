// admin/lib/spine-preconditions.mjs — is the spine CONFIGURED on this box, as distinct from reachable?
//
// The Overwatch tab reads the spine and forwards four verbs to it. Every one of the four things
// that make the spine usable by an agent session is hand-set OUTSIDE this repository: the MCP
// registration in ~/.claude.json, two inline hooks in ~/.claude/settings.json, and a launchd
// plist. None was checked anywhere, so a fresh box reported "spine unreachable" — honest — and
// offered no path from that state to a working one. The overwatch layer's own handoff records the
// the defect this exists for: an `mcpServers` block written into settings.json, a key Claude Code
// never reads, and a global hook instructing every session to call `mcp__conductor__*` tools that
// were registered nowhere. Both looked configured. Neither was.
//
// DECLARATION ONLY. Nothing here writes, and nothing here applies: the remedy for each check is
// the command text carried by manifests/install-catalog.json `tools.overwatch-layer-spine.steps`,
// by the same ids, so the panel can show exactly what to run and a human runs it.
//
// FIVE STATES, never three: present · absent · misregistered · unreadable · not-applicable.
// `misregistered` is the load-bearing one — something IS there and it names the wrong thing.
// An unreadable file is never reported as absent (fail closed), and absent is never reported as
// a pass. Every path is resolved at CALL time so a test that sets the env afterwards is honoured.

import { readFileSync, lstatSync, realpathSync, readlinkSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { spineStorePath } from './overwatch-layer-read.mjs';

export const claudeJsonPath = () => process.env.CW_CLAUDE_JSON || join(homedir(), '.claude.json');
export const claudeSettingsPath = () => process.env.CW_CLAUDE_SETTINGS || join(homedir(), '.claude', 'settings.json');
export const launchAgentsDir = () => process.env.CW_LAUNCH_AGENTS_DIR || join(homedir(), 'Library', 'LaunchAgents');
/** The `@fn:` primitive tree. One directory symlink, and nothing resolves it at runtime. */
export const functionsTreePath = () => process.env.CW_CLAUDE_FUNCTIONS || join(homedir(), '.claude', '_functions');
export const launchLabel = () => process.env.CW_SUBSTRATE_LAUNCH_LABEL || 'net.portll.substrate';
const platform = () => process.env.CW_PRECOND_PLATFORM || process.platform;

/**
 * The MCP server name the hooks instruct sessions to call, DERIVED from the tool prefix rather than
 * written beside it. `mcp__…__` is the one form monitor/release-redactions.json exempts for this
 * identity, so deriving leaves ONE literal: the name and the prefix cannot drift apart, and the
 * release gate has nothing to strip. The pair used to run the other way round.
 */
const TOOL_PREFIX = 'mcp__spine__';
export const MCP_NAME = TOOL_PREFIX.slice('mcp__'.length, -'__'.length);
/** The predecessor the hook used to name — registered nowhere, so a hook naming it is misregistered. */
const DEAD_PREFIX = 'mcp__conductor__';

/** ok → {state:'ok', json}; ENOENT → absent; anything else (permission, parse) → unreadable. */
function readJson(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent', why: `${path} does not exist` };
    return { state: 'unreadable', why: `${path}: ${e && e.message ? e.message : 'read failed'}` };
  }
  try { return { state: 'ok', json: JSON.parse(text) }; }
  catch (e) { return { state: 'unreadable', why: `${path} is not valid JSON: ${e.message}` }; }
}

function readText(path) {
  try { return { state: 'ok', text: readFileSync(path, 'utf8') }; }
  catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent', why: `${path} does not exist` };
    return { state: 'unreadable', why: `${path}: ${e && e.message ? e.message : 'read failed'}` };
  }
}

/** Every hook command string under one event, flattened; the file's shape is nested twice. */
function hookCommands(settings, event) {
  const groups = settings && settings.hooks && Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  const out = [];
  for (const g of groups) for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) if (h && typeof h.command === 'string') out.push(h.command);
  return out;
}

/** The store the registered MCP server will open, or the spine's own default when env is unset. */
export function registeredStore(entry) {
  const env = entry && entry.env && typeof entry.env === 'object' ? entry.env : {};
  return env.SPINE_TASKS_DB || env.SUBSTRATE_TASKS_DB || join(homedir(), '.spine', 'tasks.db');
}

function checkRegistration(claudeJson, settings) {
  const id = 'mcp-registration';
  if (claudeJson.state !== 'ok') return { id, state: claudeJson.state, why: claudeJson.why };
  const servers = claudeJson.json && claudeJson.json.mcpServers && typeof claudeJson.json.mcpServers === 'object' ? claudeJson.json.mcpServers : {};
  const entry = servers[MCP_NAME];
  if (!entry) {
    // The dead key: settings.json is where the first attempt went, and Claude Code never reads it.
    const dead = settings.state === 'ok' && settings.json && settings.json.mcpServers && settings.json.mcpServers[MCP_NAME];
    if (dead) return { id, state: 'misregistered', why: `mcpServers.${MCP_NAME} is in ${claudeSettingsPath()}, a key Claude Code does not read; the registration lives in ${claudeJsonPath()}` };
    return { id, state: 'absent', why: `no mcpServers.${MCP_NAME} in ${claudeJsonPath()} — sessions are instructed to call ${TOOL_PREFIX}* and have no such server` };
  }
  const args = Array.isArray(entry.args) ? entry.args.join(' ') : '';
  const cmd = `${entry.command || ''} ${args}`;
  if (!/spine\/mcp\.mjs/.test(cmd)) return { id, state: 'misregistered', why: `mcpServers.${MCP_NAME} runs "${cmd.trim()}", not the spine's mcp.mjs` };
  // Two stores is the two-resolvers-one-env-var trap: the panel reads one file, sessions write another.
  const theirs = registeredStore(entry);
  const ours = spineStorePath();
  if (theirs !== ours) return { id, state: 'misregistered', why: `the registration writes ${theirs}; this panel reads ${ours} — two stores, so the tab cannot see what sessions file`, store: theirs };
  return { id, state: 'present', why: `mcpServers.${MCP_NAME} → ${cmd.trim()}`, store: theirs };
}

function checkHook(settings, event, id, label) {
  if (settings.state !== 'ok') return { id, state: settings.state, why: settings.why };
  const cmds = hookCommands(settings.json, event);
  const live = cmds.filter((c) => c.includes(TOOL_PREFIX) || /\bspine\b/i.test(c));
  if (live.length) return { id, state: 'present', why: `${event} hook ${label} (${live.length} of ${cmds.length} commands)` };
  const dead = cmds.filter((c) => c.includes(DEAD_PREFIX));
  if (dead.length) return { id, state: 'misregistered', why: `${event} hook names ${DEAD_PREFIX}* — a server registered nowhere; it must name ${TOOL_PREFIX}*` };
  return { id, state: 'absent', why: `no ${event} hook in ${claudeSettingsPath()} ${label}` };
}

/** ~ and $HOME expand. Any other `$` is not resolvable from here and is SKIPPED, never guessed. */
function expandPath(tok) {
  if (tok.startsWith('~/')) return join(homedir(), tok.slice(2));
  if (tok.startsWith('$HOME/')) return join(homedir(), tok.slice(6));
  if (tok.startsWith('${HOME}/')) return join(homedir(), tok.slice(8));
  return tok.includes('$') ? null : tok;
}

/**
 * The EXECUTABLE paths a hook command names — never text inside its payload.
 *
 * This reads the first three tokens and STOPS at the first quoted one, because that is where the
 * argument text begins. A regex over the whole command would have been simpler and wrong here: the
 * live prompt hooks emit JSON payloads whose prose cites paths (`See ~/.claude/skills/drift/.`),
 * and a checker that resolved those would report on documentation rather than on what runs.
 */
export function commandPaths(command) {
  const out = [];
  const toks = String(command || '').trim().split(/\s+/);
  for (const t of toks.slice(0, 3)) {
    if (t.startsWith("'") || t.startsWith('"')) break;
    if (t.startsWith('-') || !t.includes('/')) continue;
    const p = expandPath(t);
    if (p) out.push(p);
  }
  return out;
}

/** ok · missing · dangling · unreadable. A dangling link is not a missing file: something IS there. */
/**
 * The three corpus paths derive from ONE root — the directory holding the `@fn:` tree — so a single
 * `CW_CLAUDE_FUNCTIONS` override sandboxes all of them. The first cut gave each its own env var,
 * and the existing fixture sets only the functions one: the check then read the OPERATOR'S REAL
 * `~/.claude/commands` from inside a test, reported 63 live links against a fixture home, and
 * failed for a reason that had nothing to do with the case under test. An override on one member
 * of a set is not a seam for the set.
 */
export const claudeCorpusDir = () => dirname(functionsTreePath());
export const commandsDir = () => process.env.CW_CLAUDE_COMMANDS || join(claudeCorpusDir(), 'commands');
export const skillsDir = () => process.env.CW_CLAUDE_SKILLS || join(claudeCorpusDir(), 'skills');

/**
 * Where a user-scope entry's link actually lands, as a coarse bucket. The MIGRATION is the reason
 * this exists: under D18 the command corpus, the skills and the `@fn:` tree move out of sleight and
 * into the spine, and the only way to tell a finished move from a half-finished one is to ask each
 * link where it points. `other` is neither, and is reported rather than folded into one of them.
 */
export function linkHome(target) {
  if (!target) return 'unlinked';
  if (/[/\\]sleight[/\\]/.test(target) || /[/\\]sleight$/.test(target)) return 'sleight';
  if (/[/\\](?:substrate|spine)[/\\]/.test(target) || /[/\\](?:substrate|spine)$/.test(target)) return 'spine';
  return 'other';
}

/**
 * Resolve one user-scope entry: does it resolve, and if it is a link, where to. A plain file or
 * directory is `ok` with home `unlinked` — a copy that was never a link is a legitimate state and
 * must not read as a broken one.
 */
export function inspectEntry(path) {
  const r = resolveTarget(path);
  let target = null;
  try { if (lstatSync(path).isSymbolicLink()) target = realpathSync(path); }
  catch { try { target = readlinkSync(path); } catch { /* unreadable link */ } }
  return { ...r, target, home: target ? linkHome(target) : 'unlinked' };
}

/**
 * The 52 commands, 10 skills and the ONE directory link carrying the whole `@fn:` primitive tree.
 *
 * WHY THIS IS A CHECK AND NOT A COMMENT. `@fn:` resolution is a discipline the session maintains —
 * there is NO runtime resolver — so a broken `_functions` link removes every primitive from every
 * command with nothing raising an error anywhere. It was described in this file's header and
 * checked nowhere: `functionsTreePath()` was consulted only inside checkHookTargets, and only when
 * ALREADY dangling, so a healthy tree was never counted and "7 hook target(s) resolve" said nothing
 * about whether the `@fn:` tree had been looked at. A healthy state and an unchecked one rendered
 * identically, which is this repository's own named failure.
 *
 * Reports BOTH directions: how many resolve, and where they point. During the sleight→spine move a
 * partially repointed corpus is the dangerous state — every link resolving while half still answer
 * to a checkout that is being deleted — so `homes` is carried even when nothing is broken.
 */
export function checkCorpusLinks() {
  const id = 'corpus-links';
  const roots = [
    { label: '@fn: tree', paths: [functionsTreePath()] },
    { label: 'commands', paths: listDir(commandsDir()) },
    { label: 'skills', paths: listDir(skillsDir()) },
  ];
  const entries = [];
  for (const r of roots) for (const p of r.paths) entries.push({ label: r.label, path: p, ...inspectEntry(p) });

  // NOTHING INSTALLED is `absent`, not `misregistered`. The distinction is the whole state
  // vocabulary here: `missing` means no link was ever made (a fresh box, and the remedy is to
  // install), `dangling` means a link exists and points at nothing (something moved or was deleted
  // under it, and the remedy is to repair). A dangling entry is a misregistration even when the
  // rest of the corpus is empty, because somebody DID declare it.
  const installed = entries.filter((e) => e.state !== 'missing');
  if (!installed.length) {
    return {
      id,
      state: 'absent',
      why: `no command corpus at ${commandsDir()} and no @fn: tree at ${functionsTreePath()} — nothing is installed at user scope`,
      homes: {},
      entries: 0,
    };
  }
  const homes = {};
  for (const e of installed) if (e.state === 'ok') homes[e.home] = (homes[e.home] || 0) + 1;
  // `missing` is excluded on purpose: a corpus with no @fn: tree yet is under-installed, not
  // MISregistered, and the two carry different remedies. Only a declaration that resolves to
  // nothing (`dangling`) or cannot be read is a misregistration.
  const broken = installed.filter((e) => e.state !== 'ok');
  const fnEntry = entries.find((e) => e.label === '@fn: tree');
  const where = Object.entries(homes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ');

  if (broken.length) {
    // The `@fn:` tree is named FIRST whatever else is broken: one link, and its loss is silent.
    const first = broken.find((b) => b.label === '@fn: tree') || broken[0];
    return {
      id,
      state: 'misregistered',
      why: `${broken.length} of ${installed.length} user-scope corpus entr${broken.length === 1 ? 'y does' : 'ies do'} not resolve — declared and resolving to nothing. ${first.label}: ${first.why || first.state}`
        + (fnEntry && fnEntry.state !== 'ok' ? ' — the @fn: tree is one directory link with no runtime resolver, so every command silently loses its primitives' : ''),
      homes,
      broken: broken.map((b) => ({ label: b.label, path: b.path, state: b.state })),
      entries: installed.length,
    };
  }
  return {
    id,
    state: 'present',
    why: `${installed.length} user-scope corpus entr${entries.length === 1 ? 'y resolves' : 'ies resolve'} (${where})`
      + (homes.sleight && homes.spine ? ' — SPLIT across both checkouts: a migration is part-done, and deleting either breaks the half that still points at it' : ''),
    homes,
    entries: installed.length,
  };
}

function listDir(dir) {
  try { return readdirSync(dir).map((n) => join(dir, n)); }
  catch { return []; }
}

export function resolveTarget(path) {
  let st;
  try { st = lstatSync(path); }
  catch (e) {
    return e && e.code === 'ENOENT'
      ? { state: 'missing', why: `${path} does not exist` }
      : { state: 'unreadable', why: `${path}: ${(e && e.code) || 'stat failed'}` };
  }
  if (!st.isSymbolicLink()) return { state: 'ok' };
  try { realpathSync(path); return { state: 'ok' }; }
  catch {
    let target = null;
    try { target = readlinkSync(path); } catch { /* the link itself is unreadable */ }
    return { state: 'dangling', why: `${path} → ${target || 'an unreadable target'}, which does not resolve` };
  }
}

/**
 * Every hook target settings.json names, resolved.
 *
 * THE FAILURE THIS EXISTS FOR (measured 2026-09-06, D18): `~/.claude` holds 69 symlinks into the
 * vscode-skills checkout — 52 commands, 10 skills, 6 hooks, and `_functions` as ONE directory link
 * carrying the whole `@fn:` tree. settings.json names the hooks THROUGH those links, so retiring
 * the checkout before repointing them takes out four prompt hooks and `close-session.sh` at the
 * same instant, fleet-wide. Nothing reports it: a hook whose target is gone is still declared, and
 * `@fn:` is resolved by session discipline with no runtime resolver at all, so a dangling tree
 * produces silence rather than an error. The other four checks here would all stay green.
 *
 * The `@fn:` tree is flagged only when it is a DANGLING LINK, never when it is simply absent: a box
 * that never had the primitives is not a box that lost them, and conflating the two would fail this
 * check on every clean machine.
 */
function checkHookTargets(settings) {
  const id = 'hook-targets';
  if (settings.state !== 'ok') return { id, state: settings.state, why: settings.why };
  const hooks = settings.json && settings.json.hooks && typeof settings.json.hooks === 'object' ? settings.json.hooks : {};
  const declared = [];
  for (const event of Object.keys(hooks)) {
    for (const c of hookCommands(settings.json, event)) for (const p of commandPaths(c)) declared.push({ event, path: p });
  }
  const fn = functionsTreePath();
  const fnState = resolveTarget(fn);
  if (fnState.state === 'dangling') declared.push({ event: '@fn:', path: fn, pre: fnState });

  const broken = [];
  for (const d of declared) {
    const r = d.pre || resolveTarget(d.path);
    if (r.state !== 'ok') broken.push({ ...d, ...r });
  }
  if (broken.length) {
    const named = broken.slice(0, 3).map((b) => `${b.event}: ${b.why}`).join('; ');
    return {
      id,
      state: 'misregistered',
      why: `${broken.length} of ${declared.length} declared hook target(s) do not resolve — declared and firing nothing. ${named}${broken.length > 3 ? ` (+${broken.length - 3} more)` : ''}`,
      broken: broken.map((b) => ({ event: b.event, path: b.path, state: b.state })),
    };
  }
  return {
    id,
    state: 'present',
    why: declared.length
      ? `${declared.length} declared hook target(s) resolve`
      : `no hook command in ${claudeSettingsPath()} names an external file, so none can dangle`,
  };
}

function checkLaunchAgent() {
  const id = 'launch-agent';
  if (platform() !== 'darwin') return { id, state: 'not-applicable', why: `launchd is macOS; on ${platform()} the overwatch layer's supervisor is not checked here` };
  const path = join(launchAgentsDir(), `${launchLabel()}.plist`);
  const r = readText(path);
  if (r.state !== 'ok') return { id, state: r.state, why: r.why, path };
  if (!/server\/serve\.mjs|\.substrate/.test(r.text)) return { id, state: 'misregistered', why: `${path} exists and does not launch the overwatch layer's server`, path };
  return { id, state: 'present', why: path, path };
}

/**
 * All checks, with a summary a renderer can put in one chip. `usable` is TRUE only when every
 * applicable check is present — a single absent or misregistered one means an agent session on
 * this box cannot file work, whatever the socket says.
 */
export function spinePreconditions() {
  const claudeJson = readJson(claudeJsonPath());
  const settings = readJson(claudeSettingsPath());
  const checks = [
    checkRegistration(claudeJson, settings),
    checkHook(settings, 'UserPromptSubmit', 'prompt-hook', `instructs sessions to file work through ${TOOL_PREFIX}*`),
    checkHook(settings, 'Stop', 'stop-hook', 'asks whether task progress was recorded'),
    checkHookTargets(settings),
    checkCorpusLinks(),
    checkLaunchAgent(),
  ];
  const summary = { present: 0, absent: 0, misregistered: 0, unreadable: 0, 'not-applicable': 0 };
  for (const c of checks) summary[c.state] = (summary[c.state] || 0) + 1;
  const applicable = checks.filter((c) => c.state !== 'not-applicable');
  return {
    ok: true,
    checks,
    summary,
    usable: applicable.length > 0 && applicable.every((c) => c.state === 'present'),
    paths: { claudeJson: claudeJsonPath(), settings: claudeSettingsPath(), launchAgents: launchAgentsDir(), store: spineStorePath(), functions: functionsTreePath() },
    note: 'declaration only — nothing here writes; the remedy for each id is manifests/install-catalog.json tools.overwatch-layer-spine.steps[id]',
  };
}
