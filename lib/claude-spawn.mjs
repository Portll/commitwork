// lib/claude-spawn.mjs — the one builder for every `claude` commitwork starts (agent/MCP review
// 2026-10-07, prerequisite W). Each caller names a profile; the builder adds what no caller may omit:
// no settings read from the cwd (a scanned repo's hooks, permissions and env never load), an explicit
// empty MCP config under --strict-mcp-config, an explicit --tools list, and llmEnv. The cwd is a fresh
// scratch directory unless the profile edits the repo.

import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { llmEnv } from '../bin/lib/scanner-env.mjs';

// A file, not an inline JSON string: `"` is a cmd.exe metacharacter, so lib/win-spawn.mjs would refuse
// the inline form wherever `claude` is a batch shim. A missing file makes claude exit, never run wider.
export const EMPTY_MCP_CONFIG = fileURLToPath(new URL('./claude-mcp-none.json', import.meta.url));

// fact: `project` and `local` are read from the cwd, and the cwd of an edit run is the scanned repo / measured 2026-10-07 on CLI 2.1.289 with network denied: a cwd SessionStart hook ran with no flag and with `project`, and did not run with `''`; `bogus` is rejected before start (expiry: when the CLI changes what a source loads, prev: broken)
// fact: `''` keeps OAuth, where --bare and CLAUDE_CODE_SIMPLE=1 drop it / bin/daily-run.mjs runs under `''` from launchd with no API key in its env and reported 11 suggestions on 2026-10-07 (expiry: when the CLI changes how it authenticates, prev: unknown)
export const SETTING_SOURCES = Object.freeze(['', 'user']);

// Flags the builder owns. A caller passing one through `extra` could undo the confinement, so it is refused.
const OWNED = /^--(?:setting-sources|settings|mcp-config|strict-mcp-config|tools|allowed-?tools|allowedTools|disallowed-?tools|disallowedTools|add-dir|permission-mode|permission-prompts|dangerously-skip-permissions|allow-dangerously-skip-permissions|model|output-format|plugin-dir|agents?)(?:=|$)/;

// Each caller's tool list and mode as they stood before the helper, except where the review named a
// defect. Read by the callers and by monitor/envelope-witness.mjs, so the witness runs codeql's argv.
export const PROFILES = Object.freeze({
  // admin/routes/codeql-remediation.mjs: read-only analysis; reads the repo through --add-dir.
  codeql: Object.freeze({ model: 'opus', outputFormat: 'json', tools: 'Read,Grep,Glob', permissionPrompts: 'none' }),
  // bin/issue-loop.mjs: edits the repo. `user` keeps the operator's permission mode and allow rules
  // it ran under before; the repo's own project/local settings are what D2 removes.
  issueLoop: Object.freeze({ tools: 'default', settingSources: 'user', editsRepo: true }),
  // bin/finding-analysis.mjs: an independent opinion from an empty directory.
  findingAnalysis: Object.freeze({ tools: 'default' }),
  // lib/cobolwork-remediation-engines.mjs: a review of a drafted diff; needs no tool (D10).
  cobolworkReviewer: Object.freeze({ outputFormat: 'json', tools: '' }),
  // bin/daily-run.mjs: schema-bound suggestions, no tools.
  daily: Object.freeze({ tools: '' }),
  // admin/routes/remediation.mjs Terminal fallback: an attended interactive session in the repo.
  handoff: Object.freeze({ print: false, tools: 'default', settingSources: 'user', editsRepo: true }),
});

/** The argv after the binary. Throws on anything that would widen what the child loads. */
export function claudeArgs({ print = true, model = null, outputFormat = null, tools, settingSources = '', permissionPrompts = null, addDirs = [], extra = [] } = {}) {
  if (typeof tools !== 'string') throw new Error('claude-spawn: tools must be explicit ("" for none, "default" for the built-in set)');
  if (!SETTING_SOURCES.includes(settingSources)) throw new Error(`claude-spawn: setting sources ${JSON.stringify(settingSources)} refused; project and local are read from the cwd`);
  for (const d of addDirs) if (typeof d !== 'string' || !isAbsolute(d)) throw new Error(`claude-spawn: --add-dir needs an absolute path, got ${JSON.stringify(d)}`);
  const bad = extra.find((a) => OWNED.test(String(a)));
  if (bad) throw new Error(`claude-spawn: ${bad} is set by the builder, not by a caller`);
  return [
    ...(print ? ['-p'] : []),
    ...(model ? ['--model', model] : []),
    ...(outputFormat ? ['--output-format', outputFormat] : []),
    ...extra,
    '--setting-sources', settingSources,
    ...(permissionPrompts ? ['--permission-prompts', permissionPrompts] : []),
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
  const args = claudeArgs({ ...flags, addDirs: editsRepo ? [] : readDirs.filter(Boolean), extra });
  const cleanup = () => { if (scratch) { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort tmp */ } scratch = null; } };
  return { file: bin, args, cwd, env: llmEnv(env), scratch, cleanup };
}
