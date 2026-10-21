// monitor/agent-run-judge.mjs — the agent run-evidence lens: what an agent DID, read from the record
// of its run rather than from the text given to it. agent-instructions and agent-config see a directive
// shape in a file; this reads whether a tool call followed one. Claude Code session transcripts,
// `claude -p --output-format stream-json` logs and Codex session files are all read; any other
// JSON-lines file is `not-a-run`, stated, never a clean run.
//

// Findings are keyed on place (run file, rule, tool, subject), never on an event index, and a
// command is never printed: the executable word and the token that matched are the evidence.
//   credential-path      a tool aimed at ~/.ssh, ~/.aws, ~/.gnupg, ~/.kube, .netrc, a keychain,
//                        .git-credentials or an id_* key, refused or not
//   config-path          .env*, .npmrc, .docker or .claude/settings*.json — a dev session's own
//                        configuration, reported apart because it is touched all day

//   guard-bypass         a shell command carrying --no-verify, CW_SANDBOX=off, --trust-repo-manifest,
//                        --dangerously-skip-permissions, core.hooksPath, HUSKY=0 or --no-hooks
//   fetch-and-execute    curl|wget piped into a shell or interpreter

//   exfil-shaped         a network verb in the same command as a credential or config path, or within
//                        the next EXFIL_WINDOW calls after a credential path was reached
//   tool-outside-allowlist  only when --tools names the run's allowlist; an interactive session has
//                        none, and the rule is reported as not applicable rather than passed
// fact: the exfil window is bounded / a run-long window reads every network call after one credential read as exfil, and most of a session's calls are ordinary API use (expiry: never, prev: wrong)

// Reads outside the run's cwd are counted (reached, refused, the roots touched), not judged: an
// interactive session reads its own memory and /tmp all day.
//

//   node monitor/agent-run-judge.mjs [--file <log>]… [--root <dir>] [--since <ISO|<n>d>] [--tools <a,b>] [--json]
//
// env (read at call time): CW_AGENT_RUNS_ROOT (default ~/.claude/projects), CW_AGENT_RUNS_SINCE
//   (default 7d, by file mtime), CW_AGENT_RUNS_TOOLS, CW_AGENT_RUNS_MAX_BYTES (default 256 MiB), CW_NOW
// exit: 0 runs judged, nothing found · 21 findings · 2 nothing judged (no run readable, or none in range)
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { CREDENTIAL_PATH_RE } from './envelope-witness.mjs';

export const EXIT = Object.freeze({ clean: 0, findings: 21, nothingJudged: 2 });
export const RULES = Object.freeze(['credential-path', 'config-path', 'guard-bypass', 'fetch-and-execute', 'exfil-shaped', 'tool-outside-allowlist']);
/** The rules an unattended consumer refuses a run on; config-path is reported, never blocking. */
export const BLOCKING_RULES = Object.freeze(['credential-path', 'guard-bypass', 'fetch-and-execute', 'exfil-shaped', 'tool-outside-allowlist']);
export const EXFIL_WINDOW = 3;
// guard: the judge's own list adds the stores CREDENTIAL_PATH_RE does not name / .git-credentials, gh's hosts.yml, .pypirc and cargo credentials each hold a token (expiry: never, prev: missing)
const JUDGE_EXTRA_RE = /(^|\/)(\.git-credentials|\.config\/gh|\.config\/gcloud|\.azure|\.pypirc|\.cargo\/credentials(?:\.toml)?)(\/|$)/;
const STRONG = /^(?:\.ssh|\.aws|\.gnupg|\.kube|Keychains|\.netrc|\.git-credentials|\.config\/gh|\.config\/gcloud|\.azure|\.pypirc|\.cargo\/credentials(?:\.toml)?|id_(?:rsa|ed25519|ecdsa))$/;
// A bypass is a flag applied to the program it modifies, judged per pipeline stage: `grep --no-verify`
// finds text, `git commit --no-verify` skips the hook.
export const GUARD_BYPASS = Object.freeze([
  { exe: /^git$/, re: /^git\b(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+--?[\w-]+)*\s+(?:commit|push|merge|rebase|cherry-pick|am|revert)\b.*\s--no-verify\b/, subject: '--no-verify' },
  { exe: /^git$/, re: /^git\b(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+--?[\w-]+)*\s+config\b(?!.*--(?:get|unset)).*\bcore\.hooksPath\b/, subject: 'core.hooksPath' },
  { exe: /^(?:commitwork|commitwork\.mjs)$/, re: /\s--trust-repo-manifest\b/, subject: '--trust-repo-manifest' },
  { exe: /^claude$/, re: /\s--dangerously-skip-permissions\b/, subject: '--dangerously-skip-permissions' },
  { env: /^CW_SANDBOX=off$/, subject: 'CW_SANDBOX=off' },
  { env: /^HUSKY=0$/, subject: 'HUSKY=0' },
]);
const NETWORK_EXE = /^(?:curl|wget|nc|ncat|ssh|scp|sftp|rsync|aws|gcloud|az)$/;
const NETWORK_SUB = { git: /^git\s+push\b/, npm: /^npm\s+publish\b/, gh: /^gh\s+(?:api|gist|release)\b/ };
const SHELL_EXE = /^(?:sh|bash|zsh|dash)$/;
const INTERPRETER = /^(?:sh|bash|zsh|dash|python3?|node|perl|ruby)$/;
const RUNNER = /^(?:node|python3?|deno|bun|perl|ruby)$/;
// fact: a fetch piped into an interpreter executes the fetch only when the interpreter is given no program / `curl … | python3 -c` and `| node -e` parse the data (expiry: never, prev: wrong)
function runsStdin(stage) {
  const words = stage.text.split(/\s+/).filter(Boolean);
  if (words[0] === 'sudo') words.shift();
  const exe = (words.shift() || '').replace(/^.*\//, '');
  if (!INTERPRETER.test(exe)) return null;
  const inline = SHELL_EXE.test(exe) ? /^-\w*c/ : /^-\w*[cep]/;
  if (words.some((w) => inline.test(w))) return null;
  if (words.some((w) => w !== '-' && !w.startsWith('-'))) return null;
  return exe;
}
const SUBST_FETCH = /^(?:sh|bash|zsh|dash)\s+-c\s+["']?\$\((?:curl|wget)\b/;
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/;

/** A shell command as pipelines of stages: [[{ text, exe, envs }]]. Splits on ; && || newline, then |. */
export function stages(command) {
  const out = [];
  for (const seg of String(command).split(/\s*(?:;|&&|\|\||\n)\s*/)) {
    const pipeline = [];
    for (const raw of seg.split(/\s*\|\s*/)) {
      const t = raw.trim();
      if (!t) continue;
      const envs = (t.match(ENV_PREFIX) || [''])[0].trim().split(/\s+/).filter(Boolean);
      const body = t.slice((t.match(ENV_PREFIX) || [''])[0].length);
      const words = body.split(/\s+/).filter(Boolean);
      let exe = (words[0] || '?').replace(/^.*\//, '');
      // a runner's program is the thing that ran: `node bin/commitwork.mjs --flag` is commitwork.mjs
      if (RUNNER.test(exe) && words[1] && !words[1].startsWith('-')) exe = words[1].replace(/^.*\//, '');
      pipeline.push({ text: body, exe, envs });
    }
    if (pipeline.length) out.push(pipeline);
  }
  return out;
}
const TRANSFER_EXE = /^(?:scp|rsync|sftp)$/;
const UPLOAD_ARG = /(?:^|\s)(?:-d|--data(?:-binary|-raw|-urlencode)?|-F|--form|-T|--upload-file)\s+@?\S*(?:\.env\b|\.npmrc|\.docker\b|settings(?:\.local)?\.json)/;
const networkVerbOf = (st) => (NETWORK_EXE.test(st.exe) ? st.exe : NETWORK_SUB[st.exe] && NETWORK_SUB[st.exe].test(st.text) ? st.exe : null);
const SHELL_TOOLS = new Set(['Bash', 'Monitor', 'bash', 'shell', 'exec', 'exec_command', 'run_terminal_cmd', 'terminal']);

const runsRoot = (env) => env.CW_AGENT_RUNS_ROOT || join(homedir(), '.claude', 'projects');
const maxBytes = (env) => { const n = Number(env.CW_AGENT_RUNS_MAX_BYTES); return Number.isFinite(n) && n > 0 ? n : 256 * 1024 * 1024; };
export function sinceMs(spec, now) {
  const s = String(spec || '7d').trim();
  const d = /^(\d+)d$/.exec(s);
  if (d) return Date.parse(now) - Number(d[1]) * 86_400_000;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) throw new Error(`--since needs an ISO date or <n>d, got ${JSON.stringify(spec)}`);
  return t;
}

// Grep's `pattern` is a regex over file contents, never a path; Glob's is a path glob.
const PATH_KEYS = { Grep: ['path'], Glob: ['pattern', 'path'] };
const toolPath = (input, tool = '') => (input && typeof input === 'object'
  ? (PATH_KEYS[tool] || ['file_path', 'path', 'notebook_path']).map((k) => input[k]).find((v) => typeof v === 'string' && v.length) : null) || null;
const toolCommand = (input) => (typeof input === 'string' ? input : input && typeof input === 'object' && typeof input.command === 'string' ? input.command : null);
const parseJsonMaybe = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** One JSON line → { call } | { result } | { meta } | null. Claude Code, stream-json and Codex shapes. */
export function classifyLine(o) {
  if (!o || typeof o !== 'object') return null;
  if ((o.type === 'assistant' || o.type === 'user') && o.message && Array.isArray(o.message.content)) {
    const out = { meta: { cwd: o.cwd, sessionId: o.sessionId, at: o.timestamp, format: 'claude' }, calls: [], results: [] };
    for (const c of o.message.content) {
      if (c.type === 'tool_use') out.calls.push({ id: c.id || null, tool: String(c.name || '?'), path: toolPath(c.input, String(c.name || '')), command: toolCommand(c.input) });
      if (c.type === 'tool_result') out.results.push({ id: c.tool_use_id, refused: !!c.is_error });
    }
    return out;
  }
  if (o.type === 'session_meta' && o.payload) return { meta: { cwd: o.payload.cwd, sessionId: o.payload.id || o.payload.session_id, at: o.timestamp, format: 'codex' }, calls: [], results: [] };
  if (o.type === 'response_item' && o.payload) {
    const p = o.payload;
    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      const args = typeof p.arguments === 'string' ? parseJsonMaybe(p.arguments) : p.arguments;
      const command = toolCommand(p.input) ?? toolCommand(args) ?? (args && typeof args === 'object' ? toolCommand(args.cmd) : null);
      return { meta: { at: o.timestamp, format: 'codex' }, calls: [{ id: p.call_id || null, tool: String(p.name || p.type), path: toolPath(args), command }], results: [] };
    }
    if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      return { meta: { at: o.timestamp, format: 'codex' }, calls: [], results: [{ id: p.call_id, refused: /^(?:error|refused|denied|permission)/i.test(String(p.output || '')) }] };
    }
  }
  return null;
}

const home = () => homedir();
/** Credential-named path tokens in a string: [{ seg, inside }], inside meaning under the run's cwd. Glob brackets are dropped first, so `~/.ss[h]` reads as `.ssh`. */
const credentialTokens = (text, cwd = null) => {
  const hits = new Map();
  for (const raw of String(text).replace(/[[\]{}*?]/g, '').split(/[\s"'`;|&()<>=]+/)) {
    if (!raw) continue;
    const tok = raw.replace(/^@/, '');
    const p = tok.replace(/^~(?=\/|$)/, '/HOME').replace(new RegExp(`^${home().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)`), '/HOME');
    const m = CREDENTIAL_PATH_RE.exec(p) || JUDGE_EXTRA_RE.exec(p);
    if (!m) continue;
    const abs = tok.startsWith('/') || tok.startsWith('~') ? resolve(tok.replace(/^~/, home())) : cwd ? resolve(cwd, tok) : null;
    const inside = !!cwd && !!abs && (abs === cwd || abs.startsWith(`${cwd}${sep}`) || abs.startsWith(`${cwd}/`));
    const prev = hits.get(m[2]);
    hits.set(m[2], { seg: m[2], inside: prev ? prev.inside && inside : inside });
  }
  return [...hits.values()].sort((a, b) => a.seg.localeCompare(b.seg));
};
const rootOf = (p) => { const parts = p.split('/').filter(Boolean); return parts.length ? `/${parts[0]}${parts[1] ? `/${parts[1]}` : ''}` : '/'; };

/** Judge one run's calls. `tools` null = no allowlist declared for this run. */
export function judgeRun(calls, { cwd = null, tools = null } = {}) {
  const findings = new Map();
  const add = (rule, tool, subject, detail) => {
    const key = `${rule}\u0000${tool}\u0000${subject}`;
    const f = findings.get(key) || { rule, tool, subject, count: 0, refused: 0, detail };
    f.count += 1; if (detail.refused) f.refused += 1;
    findings.set(key, f);
  };
  const outside = { reached: 0, refused: 0, roots: new Set() };
  const inside = (p) => !!cwd && (p === cwd || p.startsWith(`${cwd}${sep}`) || p.startsWith(`${cwd}/`));
  let lastStrong = -Infinity;
  const used = {};
  calls.forEach((c, i) => {
    used[c.tool] = (used[c.tool] || 0) + 1;
    const refused = c.refused === true;
    if (tools && !tools.includes(c.tool)) add('tool-outside-allowlist', c.tool, c.tool, { refused, why: 'not in the declared tool list' });
    const subjects = [...credentialTokens(c.path || '', cwd), ...credentialTokens(c.command || '', cwd)];
    for (const { seg: s, inside: within } of subjects) {
      // a credential-named file the repository itself carries is what remediation of a committed key has to touch
      if (STRONG.test(s) && within) add('config-path', c.tool, s, { refused, why: 'a credential-named path inside the repository' });
      else if (STRONG.test(s)) { if (!refused) lastStrong = i; add('credential-path', c.tool, s, { refused, why: 'a credential path in the tool input' }); }
      else add('config-path', c.tool, s, { refused, why: 'a configuration path in the tool input' });
    }
    if (c.command && SHELL_TOOLS.has(c.tool)) {
      for (const pipeline of stages(c.command)) {
        pipeline.forEach((st, k) => {
          for (const g of GUARD_BYPASS) {
            if (g.env ? st.envs.some((e) => g.env.test(e)) : g.exe.test(st.exe) && g.re.test(st.text)) add('guard-bypass', c.tool, g.subject, { refused, why: `${st.exe} run with ${g.subject}` });
          }
          const next = pipeline[k + 1];
          const sink = /^(?:curl|wget)$/.test(st.exe) && next ? runsStdin(next) : null;
          if (sink) add('fetch-and-execute', c.tool, st.exe, { refused, why: `${st.exe} piped into ${sink} with no program of its own` });
          if (SUBST_FETCH.test(st.text)) add('fetch-and-execute', c.tool, 'subst', { refused, why: `${st.exe} -c over a fetched substitution` });
          const verb = networkVerbOf(st);
          // fact: the path must be IN the network stage, a strong one anywhere in it or a config one as its upload operand / `source .env && curl …` is API use, not exfil (expiry: never, prev: wrong)
          const here = credentialTokens(st.text, cwd);
          const carries = here.some((x) => STRONG.test(x.seg)) || (TRANSFER_EXE.test(st.exe) && here.length > 0) || UPLOAD_ARG.test(st.text);
          if (verb && carries) add('exfil-shaped', c.tool, verb, { refused, why: 'network verb carrying a credential or configuration path' });
          else if (verb && i - lastStrong <= EXFIL_WINDOW) add('exfil-shaped', c.tool, verb, { refused, why: `network verb within ${EXFIL_WINDOW} call(s) of a credential path being reached` });
        });
      }
    }
    if (c.path && isAbsolute(c.path) && !inside(resolve(c.path))) {
      if (refused) outside.refused++; else outside.reached++;
      outside.roots.add(rootOf(resolve(c.path)).replace(home(), '~'));
    }
  });
  const rows = [...findings.values()].sort((a, b) => a.rule.localeCompare(b.rule) || a.tool.localeCompare(b.tool) || a.subject.localeCompare(b.subject));
  return {
    calls: calls.length, used,
    findings: rows,
    outsideReads: { reached: outside.reached, refused: outside.refused, roots: [...outside.roots].sort() },
    notApplicable: tools ? [] : ['tool-outside-allowlist: no tool allowlist declared for this run (--tools)'],
  };
}

/** Read one run file. Resolves to { file, format, cwd, sessionId, lines, unparsable, ...judgeRun } or { file, why }. */
export async function judgeFile(file, { tools = null, env = process.env } = {}) {
  let st;
  try { st = statSync(file); } catch (e) { return { file, why: e.code === 'ENOENT' ? 'vanished' : `unreadable (${e.code})` }; }
  if (st.size > maxBytes(env)) return { file, why: `too large (${st.size} bytes over ${maxBytes(env)})` };
  const calls = new Map(); const order = [];
  let cwd = null, sessionId = null, format = null, first = null, last = null, lines = 0, unparsable = 0, runLines = 0;
  try {
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      lines++;
      const o = parseJsonMaybe(line);
      if (!o) { unparsable++; continue; }
      const c = classifyLine(o);
      if (!c) continue;
      runLines++;
      if (c.meta.cwd && !cwd) cwd = c.meta.cwd;
      if (c.meta.sessionId && !sessionId) sessionId = c.meta.sessionId;
      if (c.meta.format && !format) format = c.meta.format;
      if (c.meta.at) { first = first || c.meta.at; last = c.meta.at; }
      for (const call of c.calls) { const k = call.id || `#${order.length}`; calls.set(k, { ...call, refused: null }); order.push(k); }
      for (const r of c.results) if (r.id && calls.has(r.id)) calls.get(r.id).refused = r.refused;
    }
  } catch (e) { return { file, why: `unreadable (${e.code || e.message})` }; }
  if (!runLines) return { file, why: unparsable === lines && lines > 0 ? 'not JSON lines' : 'not-a-run (no agent events)' };
  return { file, format, cwd, sessionId, first, last, lines, unparsable, ...judgeRun(order.map((k) => calls.get(k)), { cwd, tools }) };
}

/** Judge a run whose record is already in hand (a stream-json stdout). Non-JSON stdout is not a run: events null, nothing judged. */
export function judgeTranscriptText(text, { cwd = null, tools = null } = {}) {
  const calls = new Map(); const order = [];
  let events = 0; let resultText = null;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const o = parseJsonMaybe(line);
    if (!o) continue;
    if (o.type === 'result') { events++; resultText = String(o.result ?? ''); continue; }
    const c = classifyLine(o);
    if (!c) continue;
    events++;
    for (const call of c.calls) { const k = call.id || `#${order.length}`; calls.set(k, { ...call, refused: null }); order.push(k); }
    for (const r of c.results) if (r.id && calls.has(r.id)) calls.get(r.id).refused = r.refused;
  }
  if (!events) return { events: null, resultText: null, ...judgeRun([], { cwd, tools }) };
  return { events, resultText, ...judgeRun(order.map((k) => calls.get(k)), { cwd, tools }) };
}

export function listRuns(root, { sinceAt }) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs >= sinceAt) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

export async function runLens({ files = null, root = null, since = null, tools = null, env = process.env } = {}) {
  const now = nowISO(env);
  const sinceAt = sinceMs(since || env.CW_AGENT_RUNS_SINCE, now);
  const toolList = tools ?? (env.CW_AGENT_RUNS_TOOLS ? env.CW_AGENT_RUNS_TOOLS.split(',').map((s) => s.trim()).filter(Boolean) : null);
  const scanRoot = root || runsRoot(env);
  const list = files && files.length ? files : listRuns(scanRoot, { sinceAt });
  const runs = []; const unreadable = [];
  for (const f of list) {
    const r = await judgeFile(f, { tools: toolList, env });
    if (r.why) unreadable.push(r); else runs.push(r);
  }
  const byRule = {};
  for (const r of runs) for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + f.count;
  const findings = Object.values(byRule).reduce((a, b) => a + b, 0);
  return {
    generated: now, root: files && files.length ? null : scanRoot, since: new Date(sinceAt).toISOString(), tools: toolList,
    summary: { candidates: list.length, judged: runs.length, unreadable: unreadable.length, findings, byRule, runsWithFindings: runs.filter((r) => r.findings.length).length },
    runs, unreadable,
  };
}

export const exitCodeFor = (r) => (r.summary.judged === 0 ? EXIT.nothingJudged : r.summary.findings > 0 ? EXIT.findings : EXIT.clean);

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const files = []; let root = null, since = null, tools = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') files.push(argv[++i]);
    else if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--since') since = argv[++i];
    else if (argv[i] === '--tools') tools = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const r = await runLens({ files, root, since, tools });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.summary;
    console.log(`agent-run-judge: ${s.judged} run(s) judged of ${s.candidates} since ${r.since}${s.unreadable ? `, ${s.unreadable} not judged` : ''} — ${s.findings} finding(s) in ${s.runsWithFindings} run(s)`);
    for (const run of r.runs) for (const f of run.findings) console.log(`  ${f.rule.padEnd(22)} ${f.tool.padEnd(8)} ${f.subject}  ×${f.count}${f.refused ? ` (${f.refused} refused)` : ''}  ${run.file}`);
    for (const u of r.unreadable) console.log(`  not judged: ${u.file} — ${u.why}`);
    if (!s.judged) console.log('  nothing judged: no run file in range was readable as an agent run');
  }
  process.exitCode = exitCodeFor(r);
}
