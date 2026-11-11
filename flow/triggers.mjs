// C1 — triggers: what starts a module when nobody types its name.
//
// Four sources, each read from the thing that DECLARES the trigger rather than inferred from names:
//   launchd:<label>            monitor/install-agents.mjs — its own AGENTS table (label, argv, schedule)
//   workflow:<file>#schedule   .github/workflows/*.yml and workflows/*.yml with `on: schedule`
//   cron:<file>                a tracked crontab
//   timer:<module> / watch:<module>   setInterval, a self-rescheduling setTimeout, fs.watch
//
// Every edge is `triggers` scheduler -> module, witness static, existence unknown: a declared
// schedule is not evidence the job ever fired. A declaration that names no tracked module is
// reported as an unanalysable site, never dropped — a scheduler with nothing behind it is exactly
// the kind of dead job this graph exists to show.
//
// The launchd generator is IMPORTED, in a child process, not executed: the module's own guard
// (isMainModule) keeps its install/launchctl half from running on import, and the child keeps its
// top-level reads (the registry, settings) out of this process. Its labels depend on the registry
// of the machine that builds the graph — which is also what the real plists depend on.

import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join, normalize, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { matchBracket } from './lexer.mjs';

export const LAUNCHD_GENERATOR = 'monitor/install-agents.mjs';

// ── in-module timers and watches (over the MASKED source) ───────────────────────────────────────

/** Body `{…}` range of a function named `name` declared in this module, or null. */
export function functionBody(masked, name) {
  const n = name.replace(/\$/g, '\\$');
  const decl = new RegExp(`\\bfunction\\s*\\*?\\s+${n}\\s*\\(`, 'g');
  const arrow = new RegExp(`\\b(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s+)?(?:function\\b[^{(]*\\(|\\(|[\\w$]+\\s*=>)`, 'g');
  for (const re of [decl, arrow]) {
    const m = re.exec(masked);
    if (!m) continue;
    let i = m.index + m[0].length - 1;
    if (masked[i] === '(') {
      const close = matchBracket(masked, i);
      if (close === -1) return null;
      i = close;
    }
    // The body must follow the parameters directly: `(a) => 1` has none, and the next `{` in the
    // file belongs to something else.
    const head = /^\s*(?:=>\s*)?\{/.exec(masked.slice(i + 1));
    if (!head) return null;
    const open = i + head[0].length;
    const close = matchBracket(masked, open);
    return close === -1 ? null : { start: open, end: close };
  }
  return null;
}

/**
 * -> { timers:[{at, how}], watches:[{at, how}], pollRanges:[{start,end}] }
 *
 * A timer is `setInterval(`, or a `setTimeout(NAME` inside NAME's own body (a loop). A bare
 * `setTimeout(r, ms)` is a delay, not a trigger, and is not counted. `pollRanges` are the code
 * regions such a loop runs repeatedly: a read there is a polling read.
 */
export function timerSites(masked, { fsNamespaces = new Set(['fs', 'fsp']), fsNamed = new Map() } = {}) {
  const timers = [];
  const pollRanges = [];
  for (const m of masked.matchAll(/(?<![.\w$])setInterval\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(masked, open);
    timers.push({ at: m.index, how: 'setInterval' });
    if (close !== -1) pollRanges.push({ start: open, end: close });
    const cb = /^\(\s*([\w$]+)\s*[,)]/.exec(masked.slice(open));
    const body = cb ? functionBody(masked, cb[1]) : null;
    if (body) pollRanges.push(body);
  }
  for (const m of masked.matchAll(/(?<![.\w$])setTimeout\s*\(\s*([\w$]+)\s*[,)]/g)) {
    const body = functionBody(masked, m[1]);
    if (!body || m.index < body.start || m.index > body.end) continue;
    timers.push({ at: m.index, how: `setTimeout-loop ${m[1]}` });
    pollRanges.push(body);
  }
  const watches = [];
  for (const m of masked.matchAll(/(?<![\w$])([\w$]+)\.(watch|watchFile)\s*\(/g)) {
    if (fsNamespaces.has(m[1]) || m[1] === 'promises') watches.push({ at: m.index, how: `${m[1]}.${m[2]}` });
  }
  const locals = [...fsNamed].filter(([, imported]) => imported === 'watch' || imported === 'watchFile').map(([l]) => l);
  if (locals.length) {
    const re = new RegExp(`(?<![\\w$.])(${locals.map((l) => l.replace(/\$/g, '\\$')).join('|')})\\s*\\(`, 'g');
    for (const m of masked.matchAll(re)) watches.push({ at: m.index, how: m[1] });
  }
  watches.sort((a, b) => a.at - b.at);
  return { timers, watches, pollRanges };
}

export function inRanges(ranges, at) {
  return ranges.some((r) => at > r.start && at < r.end);
}

// ── launchd ─────────────────────────────────────────────────────────────────────────────────────

/** The plist fragment an agent carries -> a structured schedule. */
export function parseLaunchdSchedule(fragment) {
  const s = String(fragment || '');
  if (/<key>KeepAlive<\/key>/.test(s)) return { type: 'KeepAlive' };
  const iv = /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/.exec(s);
  if (iv) return { type: 'StartInterval', seconds: Number(iv[1]) };
  if (/<key>StartCalendarInterval<\/key>/.test(s)) {
    const at = [];
    for (const d of s.matchAll(/<dict>([\s\S]*?)<\/dict>/g)) {
      const o = {};
      for (const kv of d[1].matchAll(/<key>(\w+)<\/key>\s*<integer>(\d+)<\/integer>/g)) o[kv[1]] = Number(kv[2]);
      at.push(o);
    }
    return { type: 'StartCalendarInterval', at };
  }
  return { type: 'unknown' };
}

/**
 * Import the generator in a child and return its AGENTS table, or { error }. Pure data out:
 * label, argv, schedule, service.
 */
export function loadLaunchdAgents(root, { env = process.env, timeoutMs = 30000 } = {}) {
  const url = pathToFileURL(join(root, LAUNCHD_GENERATOR)).href;
  const code = `const m = await import(${JSON.stringify(url)});`
    + 'process.stdout.write(JSON.stringify({ cw: m.CW ?? null, agents: (m.AGENTS || []).map((a) => '
    + '({ label: a.label, argv: a.argv, schedule: a.schedule, service: !!a.service })) }));';
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code],
    { cwd: root, env: childEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    const lines = String(r.stderr || r.error || r.signal).trim().split('\n');
    return { error: `generator import failed: ${[...lines].reverse().find((l) => /\b\w*Error\b/.test(l)) || lines.slice(-1)[0]}` };
  }
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    return { error: `generator output unreadable: ${e.message}` };
  }
}

function lineOfText(text, needle) {
  if (!needle) return null;
  const i = text.indexOf(needle);
  return i === -1 ? null : text.slice(0, i).split('\n').length;
}

/** The module a launchd argv runs, relative to `root`, or null. */
export function argvModule(argv, root, cw = root) {
  if (!Array.isArray(argv) || argv.length < 2) return null;
  if (!/(^|\/)node(\.exe)?$/.test(String(argv[0])) && argv[0] !== process.execPath) return null;
  const script = argv.slice(1).find((a) => !String(a).startsWith('-'));
  if (!script) return null;
  const abs = isAbsolute(script) ? script : join(cw, script);
  const rel = relative(cw, abs);
  return rel.startsWith('..') || isAbsolute(rel) ? null : normalize(rel);
}

/** -> { schedulers:[{key, extra, targets:[{module, evidence}]}], sites:[…] } */
export function launchdSchedulers(loaded, { root, generatorSource = '', tracked = new Set() } = {}) {
  const schedulers = [];
  const sites = [];
  if (loaded.error) {
    sites.push({ at: `${LAUNCHD_GENERATOR}:1`, kind: 'launchd', reason: loaded.error });
    return { schedulers, sites };
  }
  for (const a of loaded.agents) {
    const mod = argvModule(a.argv, root, loaded.cw || root);
    const line = lineOfText(generatorSource, a.label)
      || lineOfText(generatorSource, `label: \`${String(a.label).replace(/-[^-]*$/, '-${')}`)
      || (mod ? lineOfText(generatorSource, `'${basename(mod)}'`) : null) || 1;
    const evidence = `${LAUNCHD_GENERATOR}:${line} launchd`;
    const entry = { key: `launchd:${a.label}`, extra: { schedule: parseLaunchdSchedule(a.schedule), ...(a.service ? { service: true } : {}) }, targets: [] };
    if (mod && tracked.has(mod)) entry.targets.push({ module: mod, evidence });
    else sites.push({ at: `${LAUNCHD_GENERATOR}:${line}`, kind: 'launchd', reason: `${a.label} runs no tracked module (${mod || 'argv not a node script'})` });
    schedulers.push(entry);
  }
  return { schedulers, sites };
}

// ── GitHub workflows ────────────────────────────────────────────────────────────────────────────

const NODE_SCRIPT_RE = /(?:^|[\s;&|(])node\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*((?:\.\/)?[\w@./-]+\.(?:mjs|cjs|js))\b/g;

/** Every `node <script>` in a shell fragment. */
export function nodeScripts(shell) {
  return [...String(shell).matchAll(NODE_SCRIPT_RE)].map((m) => normalize(m[1]));
}

/**
 * -> { cron:[…], runs:[{line, script}] } or null when the workflow has no `on: schedule`.
 * Line-based on purpose: no YAML dependency, and the two facts needed are both line-shaped.
 */
export function parseWorkflow(text) {
  const lines = String(text).split('\n');
  const cron = [];
  let inOn = false;
  let onIndent = -1;
  let inSchedule = false;
  let schedIndent = -1;
  for (const raw of lines) {
    const ln = raw.replace(/\s+#.*$/, '');
    if (!ln.trim()) continue;
    const indent = ln.length - ln.trimStart().length;
    if (/^(?:on|"on"|'on')\s*:/.test(ln)) { inOn = true; onIndent = indent; continue; }
    if (inOn && indent <= onIndent) { inOn = false; inSchedule = false; }
    if (!inOn) continue;
    if (/^\s*schedule\s*:/.test(ln)) { inSchedule = true; schedIndent = indent; continue; }
    if (inSchedule && indent <= schedIndent) inSchedule = false;
    const c = inSchedule && /cron\s*:\s*['"]?([^'"]+?)['"]?\s*$/.exec(ln);
    if (c) cron.push(c[1]);
  }
  if (!cron.length) return null;
  const runs = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-?\s*run\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const ownIndent = m[1].length;
    const chunk = [];
    if (/^[|>][-+]?\s*$/.test(m[2])) {
      for (let j = i + 1; j < lines.length; j += 1) {
        const l = lines[j];
        if (l.trim() && l.length - l.trimStart().length <= ownIndent) break;
        chunk.push({ text: l, line: j + 1 });
      }
    } else chunk.push({ text: m[2], line: i + 1 });
    for (const c of chunk) for (const script of nodeScripts(c.text)) runs.push({ line: c.line, script });
  }
  return { cron, runs };
}

// ── crontab ─────────────────────────────────────────────────────────────────────────────────────

/** -> [{line, schedule, script}] for each crontab line that runs `node <script>`. */
export function parseCrontab(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => {
    if (!l.trim() || l.trim().startsWith('#') || /^\s*\w+=/.test(l)) return;
    const m = /^\s*(@\w+|(?:\S+\s+){4}\S+)\s+(.*)$/.exec(l);
    if (!m) return;
    for (const script of nodeScripts(m[2])) out.push({ line: i + 1, schedule: m[1], script });
  });
  return out;
}

// ── discovery and assembly ──────────────────────────────────────────────────────────────────────

export const WORKFLOW_DIRS = ['.github/workflows', 'workflows'];
export const isCrontab = (f) => /(^|\/)crontab$|\.(?:cron|crontab)$/.test(f);

/**
 * Workflow and crontab files under `root`. `lsFiles` lists the tracked files (flow/static.mjs owns
 * the one git call); without it, or when it throws (not a checkout), the two workflow directories
 * are read instead and no crontab is looked for.
 */
export function triggerFiles(root, lsFiles = null) {
  try {
    if (!lsFiles) throw new Error('no file lister');
    const out = lsFiles();
    return {
      workflows: out.filter((f) => WORKFLOW_DIRS.some((d) => f.startsWith(`${d}/`)) && /\.ya?ml$/.test(f)),
      crontabs: out.filter(isCrontab),
    };
  } catch {
    const workflows = [];
    for (const d of WORKFLOW_DIRS) {
      try {
        for (const f of readdirSync(join(root, d))) if (/\.ya?ml$/.test(f)) workflows.push(`${d}/${f}`);
      } catch { /* absent directory: nothing declared there */ }
    }
    return { workflows: workflows.sort(), crontabs: [] };
  }
}

function readOr(root, f) {
  try { return readFileSync(join(root, f), 'utf8'); } catch { return null; }
}

/**
 * -> { schedulers:[{key, extra, targets}], sites:[{at, kind, reason}] } across every source.
 * `modules` are analyseSource() records (their `triggers` carry the in-module timers/watches).
 */
export function analyseTriggers({ root, files, modules = [], launchd, workflows, crontabs, lsFiles = null, env = process.env } = {}) {
  const tracked = new Set(files);
  const schedulers = [];
  const sites = [];
  const discovered = (workflows && crontabs) ? null : triggerFiles(root, lsFiles);

  if (tracked.has(LAUNCHD_GENERATOR) || launchd) {
    const loaded = launchd || loadLaunchdAgents(root, { env });
    const r = launchdSchedulers(loaded, { root, generatorSource: readOr(root, LAUNCHD_GENERATOR) || '', tracked });
    schedulers.push(...r.schedulers);
    sites.push(...r.sites);
  }

  for (const f of workflows || discovered.workflows) {
    const text = readOr(root, f);
    const wf = text === null ? null : parseWorkflow(text);
    if (!wf) continue;
    const entry = { key: `workflow:${f}#schedule`, extra: { cron: wf.cron }, targets: [] };
    for (const r of wf.runs) {
      if (tracked.has(r.script)) entry.targets.push({ module: r.script, evidence: `${f}:${r.line} workflow-run` });
      else sites.push({ at: `${f}:${r.line}`, kind: 'workflow', reason: `node ${r.script} is not a tracked module` });
    }
    schedulers.push(entry);
  }

  for (const f of crontabs || discovered.crontabs) {
    const rows = parseCrontab(readOr(root, f) || '');
    if (!rows.length) continue;
    const entry = { key: `cron:${f}`, extra: { cron: [...new Set(rows.map((r) => r.schedule))] }, targets: [] };
    for (const r of rows) {
      if (tracked.has(r.script)) entry.targets.push({ module: r.script, evidence: `${f}:${r.line} cron` });
      else sites.push({ at: `${f}:${r.line}`, kind: 'cron', reason: `node ${r.script} is not a tracked module` });
    }
    schedulers.push(entry);
  }

  for (const m of modules) {
    if (m.state !== 'analysed' || !m.triggers) continue;
    for (const [kind, list] of [['timer', m.triggers.timers], ['watch', m.triggers.watches]]) {
      if (!list.length) continue;
      schedulers.push({ key: `${kind}:${m.path}`, extra: {}, targets: list.map((t) => ({ module: m.path, evidence: t.evidence })) });
    }
  }
  return { schedulers, sites };
}
