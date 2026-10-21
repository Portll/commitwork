// lib/claude-spawn.mjs — the one builder for every `claude` commitwork starts.
// Each caller names a profile; the builder adds what no caller may omit:
// no settings read from the cwd (a scanned repo's hooks, permissions and env never load), an explicit
// empty MCP config under --strict-mcp-config, an explicit --tools list, and llmEnv. The cwd is a fresh
// scratch directory unless the profile edits the repo.

import { mkdtempSync, realpathSync, rmSync, statSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmEnv } from '../bin/lib/scanner-env.mjs';
import { postureFor } from './security-posture.mjs';

// A file, not an inline JSON string: `"` is a cmd.exe metacharacter, so lib/win-spawn.mjs would refuse
// the inline form wherever `claude` is a batch shim. A missing file makes claude exit, never run wider.
export const EMPTY_MCP_CONFIG = fileURLToPath(new URL('./claude-mcp-none.json', import.meta.url));

// fact: `project` and `local` are read from the cwd, and the cwd of an edit run is the scanned repo / a cwd SessionStart hook runs with no flag and with `project`, not with `''`, and an unknown source is rejected before start (expiry: when the CLI changes what a source loads, prev: broken)
// fact: `''` keeps OAuth, where --bare and CLAUDE_CODE_SIMPLE=1 drop it / bin/daily-run.mjs runs under `''` from launchd with no API key in its env (expiry: when the CLI changes how it authenticates, prev: unknown)
export const SETTING_SOURCES = Object.freeze(['', 'user']);

// Flags the builder owns. A caller passing one through `extra` could undo the confinement, so it is refused.
const OWNED = /^--(?:setting-sources|settings|mcp-config|strict-mcp-config|tools|allowed-?tools|allowedTools|disallowed-?tools|disallowedTools|add-dir|permission-mode|permission-prompts|dangerously-skip-permissions|allow-dangerously-skip-permissions|model|output-format|plugin-dir|agents?)(?:=|$)/;

// Each caller's tool list and mode. Read by the callers and by monitor/envelope-witness.mjs, so the
// witness runs codeql's argv.
// `unattended`: nobody answers a prompt. `guarded`: loads the destructive-command guard. Both act
// only while the unattendedPosture setting is not off (see posturedFlags).
// fact: the issue-loop agent has no Bash / `node -e` runs any program and `npm test` runs whatever the agent writes into package.json, so a Bash allowlist confines nothing; tests run in the gate after the agent (expiry: never, prev: broken)
export const ISSUE_LOOP_TOOLS = 'Read,Edit,Write,Grep,Glob';
export const PROFILES = Object.freeze({
  // admin/routes/codeql-remediation.mjs: read-only analysis; reads the repo through --add-dir.
  codeql: Object.freeze({ model: 'opus', outputFormat: 'json', tools: 'Read,Grep,Glob', permissionPrompts: 'none', unattended: true }),
  // bin/issue-loop.mjs: edits the repo with a closed tool list and no shell; edits inside the repo
  // are accepted, every other call refused and visible in the stream-json record bin/issue-loop.mjs
  // judges before it accepts the diff. `user` keeps the operator's own allow rules; under a posture
  // only the guard loads.
  issueLoop: Object.freeze({ outputFormat: 'stream-json', verbose: true, tools: ISSUE_LOOP_TOOLS, permissionMode: 'acceptEdits', settingSources: 'user', editsRepo: true, unattended: true, guarded: true }),
  // bin/finding-analysis.mjs: an independent opinion from an empty directory.
  findingAnalysis: Object.freeze({ tools: 'default', unattended: true }),
  // lib/cobolwork-remediation-engines.mjs: a review of a drafted diff; needs no tool.
  cobolworkReviewer: Object.freeze({ outputFormat: 'json', tools: '', unattended: true }),
  // bin/daily-run.mjs: schema-bound suggestions, no tools.
  daily: Object.freeze({ tools: '', unattended: true }),
  // monitor/divergence-review.mjs: reads the evidence both analysts were given, in the prompt; no tool.
  divergenceReview: Object.freeze({ model: 'opus', outputFormat: 'json', tools: '', unattended: true }),
  // admin/routes/remediation.mjs Terminal fallback: an attended interactive session in the repo.
  handoff: Object.freeze({ print: false, tools: 'default', settingSources: 'user', editsRepo: true, guarded: true }),
});

// ── the guard settings file ────────────────────────────────────────────────────────────────────
export const GUARD_HOOK = fileURLToPath(new URL('../bin/hooks/guard-destructive.mjs', import.meta.url));
// manifests/agent-surface.json's matcher for the guard; Read gates key reads through the Read tool (D27).
const GUARD_MATCHER = 'Bash|Write|Edit|MultiEdit|NotebookEdit|Read';

/** The settings JSON that wires the guard: absolute node and hook paths, so any cwd works. */
export function guardSettingsJson({ node = process.execPath, hook = GUARD_HOOK } = {}) {
  // `$` and a backtick stay live inside the double quotes the hook shell sees
  for (const p of [node, hook]) if (/[$`\n]/.test(p)) throw new Error(`claude-spawn: ${JSON.stringify(p)} cannot be quoted into a hook command`);
  const command = `${JSON.stringify(node)} ${JSON.stringify(hook)}`;
  return `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: GUARD_MATCHER, hooks: [{ type: 'command', command, timeout: 10 }] }] } }, null, 2)}\n`;
}

/**
 * Write (or reuse) the guard settings file and return its path. Named by its content, so checkouts and
 * node versions never overwrite each other's file under a running session. CW_CLAUDE_GUARD_DIR moves
 * it, read at call time. Throws when the hook is missing: a hook that cannot start fails open.
 */
export function guardSettingsFile({ env = process.env } = {}) {
  if (!existsSync(GUARD_HOOK)) throw new Error(`claude-spawn: the guard ${GUARD_HOOK} is missing, so no guarded session can start`);
  const body = guardSettingsJson();
  const dir = env.CW_CLAUDE_GUARD_DIR ? resolve(env.CW_CLAUDE_GUARD_DIR) : join(homedir(), '.commitwork', 'claude-guard');
  const file = join(dir, `guard-settings-${createHash('sha256').update(body).digest('hex').slice(0, 12)}.json`);
  let cur = null;
  try { cur = readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (cur !== body) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, file);
  }
  return file;
}

/**
 * The flags the unattendedPosture setting adds, read at call time: --permission-prompts none on an
 * unattended -p run (the harness refuses what would prompt), and for a guarded profile no setting
 * source but the guard's own --settings file. Posture off changes nothing.
 */
function posturedFlags({ print, unattended, guarded, settingSources, permissionPrompts, env }) {
  const out = { settingSources, permissionPrompts, settings: null };
  const promptable = unattended && print && !permissionPrompts;
  if (!promptable && !guarded) return out;
  if (postureFor(env).mode === 'off') return out;
  if (promptable) out.permissionPrompts = 'none';
  if (guarded) { out.settingSources = ''; out.settings = guardSettingsFile({ env }); }
  return out;
}

/** The argv after the binary. Throws on anything that would widen what the child loads. */
export function claudeArgs({ print = true, model = null, outputFormat = null, verbose = false, tools, settingSources = '', permissionPrompts = null, permissionMode = null, addDirs = [], extra = [], unattended = false, guarded = false, env = process.env } = {}) {
  if (typeof tools !== 'string') throw new Error('claude-spawn: tools must be explicit ("" for none, "default" for the built-in set)');
  if (!SETTING_SOURCES.includes(settingSources)) throw new Error(`claude-spawn: setting sources ${JSON.stringify(settingSources)} refused; project and local are read from the cwd`);
  for (const d of addDirs) if (typeof d !== 'string' || !isAbsolute(d)) throw new Error(`claude-spawn: --add-dir needs an absolute path, got ${JSON.stringify(d)}`);
  if (permissionMode !== null && !['default', 'acceptEdits', 'plan'].includes(permissionMode)) throw new Error(`claude-spawn: permission mode ${JSON.stringify(permissionMode)} refused`);
  const bad = extra.find((a) => OWNED.test(String(a)));
  if (bad) throw new Error(`claude-spawn: ${bad} is set by the builder, not by a caller`);
  const p = posturedFlags({ print, unattended, guarded, settingSources, permissionPrompts, env });
  return [
    ...(print ? ['-p'] : []),
    ...(model ? ['--model', model] : []),
    ...(outputFormat ? ['--output-format', outputFormat] : []),
    ...(verbose ? ['--verbose'] : []),
    ...extra,
    '--setting-sources', p.settingSources,
    ...(p.settings ? ['--settings', p.settings] : []),
    ...(p.permissionPrompts ? ['--permission-prompts', p.permissionPrompts] : []),
    ...(permissionMode ? ['--permission-mode', permissionMode] : []),
    ...(addDirs.length ? ['--add-dir', ...addDirs] : []),
    '--tools', tools,
    '--mcp-config', EMPTY_MCP_CONFIG,
    // last and boolean: --add-dir, --tools and --mcp-config are variadic and would swallow a trailing prompt
    '--strict-mcp-config',
  ];
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/**
 * profile + call → { file, args, cwd, env, scratch, cleanup }. An edit profile runs in `repo`, which
 * must be an existing absolute directory; every other profile runs in a fresh realpath'd scratch
 * directory (or the caller's `scratchDir`, which is never removed) and reads `readDirs` via --add-dir.
 */
export function claudeSpawnPlan(profile, { repo = null, readDirs = [], scratchDir = null, extra = [], env = process.env, bin = 'claude' } = {}) {
  if (!profile || typeof profile !== 'object') throw new Error('claude-spawn: a profile is required');
  const { editsRepo = false, ...flags } = profile;
  let cwd, scratch = null;
  if (editsRepo) {
    if (typeof repo !== 'string' || !isAbsolute(repo) || !isDir(repo)) throw new Error(`claude-spawn: an edit run needs an existing absolute repo directory, got ${JSON.stringify(repo)}`);
    cwd = repo;
  } else if (scratchDir) {
    cwd = scratchDir;
  } else {
    // realpath: the child reports tool paths under the resolved cwd (/private/var/… on macOS)
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cw-claude-')));
    cwd = scratch;
  }
  const args = claudeArgs({ ...flags, addDirs: editsRepo ? [] : readDirs.filter(Boolean), extra, env });
  const cleanup = () => { if (scratch) { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort tmp */ } scratch = null; } };
  return { file: bin, args, cwd, env: llmEnv(env), scratch, cleanup };
}
