// monitor/process-ancestry.mjs — item 8: who spawned each commitwork-relevant process? A scanner
// run, the panel, an engine — each has an ordinary parentage (a shell, a terminal, launchd, the
// agent harness). A relevant process whose DIRECT parent is none of those is the signal: sweeps
// launched by things that do not launch sweeps is the living-off-the-land shape.
//
// Observational, no baseline: the assessment is per-run against a small declared parent-class
// allowlist (exported, test-pinned). The judgment is deliberately about the DIRECT parent — on
// macOS every chain ends at launchd, so "chain contains launchd" is vacuous; who forked YOU is
// the fact that discriminates. The full chain is recorded on every row for the reader.
//
// Two ps reads, joined by pid: `-o pid,ppid,comm` (executable path, spaces intact, no arguments)
// for clean parent names, and `-o pid,args` for matching which processes are relevant at all.
// A chain that cannot be walked (a ppid vanished between the two reads) is unknown('truncated'),
// its own state — never expected, never a finding.
//
// Env: CW_NOW. Enumeration is injectable for tests; failure is unknown, never an empty box.
//
//   node monitor/process-ancestry.mjs [--json]   exit 0 all expected, 1 unexpected parent, 2 grey

import { nowISO } from '../lib/clock.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// What makes a process OURS to judge: repo scripts, the panel, the mcp server, the engines.
// `ownParents` names the parents that are ordinary FOR THAT ENTRY ONLY — a GUI-wrapped engine
// spawns its own workers (LM Studio's app parents its inference processes, Ollama.app parents
// `ollama serve`), and the first live run flagged every one of them: a lens firing on ~100% of a
// category is a predicate defect, not a compromised box. The exception is declared per entry,
// never widened into the global allowlist.
export const RELEVANT = [
  { key: 'panel', re: /admin\/serve\.mjs/ },
  { key: 'sweep', re: /monitor\/sweep\.mjs/ },
  { key: 'rollup', re: /monitor\/rollup\.mjs/ },
  { key: 'mcp', re: /mcp\/server\.mjs/ },
  { key: 'engine-ollama', re: /(^|\/)ollama\b/i, ownParents: ['Ollama', 'ollama'] },
  { key: 'engine-lmstudio', re: /LM Studio/, ownParents: ['LM Studio', 'LM Studio Helper'] },
];

// The parent classes that ordinarily launch our processes. Small on purpose: growing this list is
// a decision, and an over-broad allowlist is a lens that cannot fire.
export const ALLOWED_PARENTS = new Set([
  'launchd', 'zsh', 'bash', 'sh', 'fish', 'login', 'tmux', 'cron',
  'node',                                   // the agent harness and every repo script spawn via node
  'Terminal', 'iTerm2', 'alacritty', 'kitty', 'wezterm-gui',
  'Code Helper', 'Code Helper (Plugin)', 'Code Helper (Renderer)', 'Electron', 'claude',
]);

export function parsePidPpidComm(text) {
  const rows = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim() });
  }
  return rows;
}

export function parsePidArgs(text) {
  const rows = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (m) rows.set(Number(m[1]), m[2].trim());
  }
  return rows;
}

const shortName = (comm) => basename(String(comm || ''));

/** Pure assessment over the two joined tables. */
export function assessAncestry(procs, argsByPid, { relevant = RELEVANT, allowed = ALLOWED_PARENTS, selfPid = null } = {}) {
  const rows = [];
  for (const [pid, args] of [...argsByPid.entries()].sort(([a], [b]) => a - b)) {
    if (pid === selfPid) continue;                       // the lens itself is not evidence about the box
    const hit = relevant.find((r) => r.re.test(args));
    if (!hit) continue;
    const me = procs.get(pid);
    if (!me) { rows.push({ pid, entry: hit.key, args: args.slice(0, 200), ...unknown('truncated', 'process vanished between reads') }); continue; }
    const parent = procs.get(me.ppid);
    // pid 1 as the direct parent IS launchd even if the table has no row for it.
    const parentName = parent ? shortName(parent.comm) : me.ppid === 1 ? 'launchd' : null;
    const chain = [];
    let cur = me;
    let guard = 0;
    let broken = false;
    while (cur && cur.ppid > 1 && guard++ < 64) {
      const up = procs.get(cur.ppid);
      if (!up) { broken = true; break; }
      chain.push(shortName(up.comm));
      cur = up;
    }
    if (cur && cur.ppid === 1) chain.push('launchd');
    const row = { pid, entry: hit.key, args: args.slice(0, 200), parent: { pid: me.ppid, name: parentName }, chain };
    const parentOk = (n) => allowed.has(n) || (hit.ownParents ?? []).includes(n);
    if (parentName === null) rows.push({ ...row, verdict: null, ...unknown('truncated', `ppid ${me.ppid} not in the table`) });
    else if (broken) rows.push({ ...row, verdict: parentOk(parentName) ? 'expected' : 'unexpected-parent', chainIncomplete: true });
    else rows.push({ ...row, verdict: parentOk(parentName) ? 'expected' : 'unexpected-parent' });
  }
  const findings = rows.filter((r) => r.verdict === 'unexpected-parent');
  const greys = rows.filter((r) => r.unknown);
  const state = findings.length ? 'findings' : greys.length ? 'partial' : 'ok';
  return { rows, findings, state };
}

export function runLens({ exec = execFileSync, selfPid = process.pid } = {}) {
  let commText;
  let argsText;
  try {
    commText = exec('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
    argsText = exec('ps', ['-axo', 'pid=,args='], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    return { at: nowISO(), ...unknown('tool-failed', `ps: ${e.code || e.message}`), state: 'unknown' };
  }
  return { at: nowISO(), ...assessAncestry(parsePidPpidComm(commText), parsePidArgs(argsText), { selfPid }) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/process-ancestry.mjs [--json]   who spawned each commitwork-relevant process\n'
      + 'exit 0 all expected, 1 unexpected direct parent, 2 grey (nothing relevant running is ok+empty; unknowns are partial)');
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`process-ancestry: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`process-ancestry: ${r.state}  (${r.rows.length} relevant process(es), ${r.at})`);
    for (const row of r.rows) {
      const v = row.verdict ?? `unknown(${row.unknownReason})`;
      console.log(`  ${String(v).toUpperCase().padEnd(18)} ${row.entry}  pid ${row.pid}  ← ${row.parent?.name ?? '?'}${row.chain?.length ? `  [${row.chain.join(' ← ')}]` : ''}`);
    }
  }
  process.exit(r.unknown ? 2 : r.findings?.length ? 1 : r.state === 'partial' ? 2 : 0);
}
