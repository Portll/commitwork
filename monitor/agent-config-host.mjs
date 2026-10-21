// monitor/agent-config-host.mjs — the developer's own agent configuration, read where the agents
// read it: the user scope. bin/agent-config.mjs reads a scanned repository's .mcp.json, settings and
// command files; the same rules apply to ~/.claude.json (user-level MCP servers, and each project's),
// ~/.claude/settings*.json (hooks, permissions, env), ~/.claude/commands, ~/.claude/hooks and
// ~/.cursor/mcp.json, which no repository scan ever opens. Values are withheld as agent-config
// withholds them; a key name and a host are the evidence.

// Only JSON is read. ~/.codex/config.toml, when present, is stated as not read rather than passed.
//
//   node monitor/agent-config-host.mjs [--json]
//
// env (read at call time): CW_AGENT_CONFIG_HOME (default the home directory), CW_AGENT_CONFIG_MAX_BYTES, CW_NOW
// exit: 0 read and clean · 21 findings · 2 nothing readable (no agent configuration at all, or every file unparseable)
import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { scanAgentConfig, scanConfigDoc, parseJsonc } from '../bin/agent-config.mjs';

export const EXIT = Object.freeze({ clean: 0, findings: 21, nothingRead: 2 });
export const USER_FILE = '.claude.json';
export const NOT_READ = Object.freeze(['.codex/config.toml']);
const home = (env) => env.CW_AGENT_CONFIG_HOME || homedir();

/** ~/.claude.json: the user-level mcpServers block, and each project's own, as separate documents. */
export function userFileDocs(text) {
  const parsed = parseJsonc(text);
  if (parsed.error !== undefined || !parsed.value || typeof parsed.value !== 'object') return { error: parsed.error || 'not an object', docs: [] };
  const doc = parsed.value;
  const docs = [];
  if (doc.mcpServers && typeof doc.mcpServers === 'object') docs.push({ rel: USER_FILE, doc: { mcpServers: doc.mcpServers } });
  if (doc.projects && typeof doc.projects === 'object') {
    for (const [path, p] of Object.entries(doc.projects).sort()) {
      if (p && typeof p === 'object' && p.mcpServers && typeof p.mcpServers === 'object' && Object.keys(p.mcpServers).length) {
        docs.push({ rel: `${USER_FILE}#projects/${basename(path)}`, doc: { mcpServers: p.mcpServers } });
      }
    }
  }
  return { docs, projects: doc.projects && typeof doc.projects === 'object' ? Object.keys(doc.projects).length : 0 };
}

export function runLens({ env = process.env } = {}) {
  const root = home(env);
  const now = nowISO(env);
  const scoped = scanAgentConfig(root);
  const findings = [...scoped.findings];
  const files = { present: [...scoped.summary.filesPresent], scanned: scoped.summary.filesScanned, unparseable: [...scoped.summary.unparseableFiles], unreadable: scoped.summary.unreadableFiles.map((u) => u.path) };
  const undetermined = [];
  const userPath = join(root, USER_FILE);
  if (existsSync(userPath)) {
    files.present.push(USER_FILE);
    let text = null;
    try { text = readFileSync(userPath, 'utf8'); } catch (e) { files.unreadable.push(USER_FILE); undetermined.push(`${USER_FILE}: unreadable (${e.code || 'ERROR'})`); }
    if (text !== null) {
      const u = userFileDocs(text);
      if (u.error !== undefined) { files.unparseable.push(USER_FILE); undetermined.push(`${USER_FILE}: ${u.error}`); } else {
        files.scanned += 1;
        for (const d of u.docs) findings.push(...scanConfigDoc(d.rel, d.doc));
        files.userProjects = u.projects;
      }
    }
  }
  for (const rel of NOT_READ) if (existsSync(join(root, rel))) { files.present.push(rel); undetermined.push(`${rel}: present and not read (TOML); its MCP servers and hooks are unjudged`); }
  for (const u of scoped.summary.unreadableHookScriptFiles) undetermined.push(`${u.hook} runs ${u.script}: ${u.reason}`);
  files.present.sort();
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  findings.sort((a, b) => cmp(a.path, b.path) || cmp(a.rule, b.rule) || cmp(a.key, b.key));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return { generated: now, home: root === homedir() ? '~' : root, files, findings, byRule, undetermined, void: files.scanned === 0 };
}

export const exitCodeFor = (r) => (r.void ? EXIT.nothingRead : r.findings.length ? EXIT.findings : EXIT.clean);

if (isMainModule(import.meta.url)) {
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`agent-config-host: ${r.files.scanned} file(s) read of ${r.files.present.length} present under ${r.home} — ${r.findings.length} finding(s) ${JSON.stringify(r.byRule)}`);
    const shown = new Map();
    for (const f of r.findings) {
      const k = `${f.path}|${f.rule}`; const n = (shown.get(k) || 0) + 1; shown.set(k, n);
      if (n <= 5) console.log(`  ${f.sev.padEnd(6)} ${f.rule.padEnd(26)} ${f.path}  ${f.detail}`);
      else if (n === 6) console.log(`  …      ${f.rule.padEnd(26)} ${f.path}  ${r.byRule[f.rule]} in total for this rule (--json lists every one)`);
    }
    for (const u of r.undetermined) console.log(`  undetermined: ${u}`);
    if (r.void) console.log('  nothing read: no agent configuration under this home was readable, which is not a clean one');
  }
  process.exitCode = exitCodeFor(r);
}
