#!/usr/bin/env node
// actions-gaps.mjs — four GitHub Actions workflow findings the fleet could not see: a job on a
// self-hosted runner, a privileged trigger (workflow_run / pull_request_target) whose job checks
// out or downloads the triggering run's head, a job with no permissions: block above it, and a
// run step whose exit status is a pipe's last command rather than the command that did the work.
// Reports rule ids, workflow paths, job and step names only — never a script body.
//   node bin/actions-gaps.mjs [rootDir]        exit 0 ran · 2 could not run
//   env, read at call time: CW_ACTIONS_GAPS_ROOT (overrides rootDir)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

export const RULE_CWE = Object.freeze({
  'self-hosted-runner': 'CWE-1104, CWE-284',
  'workflow-run-trigger': 'CWE-829',
  'permissions-absent': 'CWE-250',
  'exit-masked-by-pipe': 'CWE-252',
});

export const RULE_SEV = Object.freeze({
  'self-hosted-runner': 'high',
  'workflow-run-trigger': 'high',
  'permissions-absent': 'med',
  'exit-masked-by-pipe': 'med',
});

export const WORKFLOWS_DIR = '.github/workflows';
const PRIVILEGED_TRIGGERS = new Set(['workflow_run', 'pull_request_target']);
const MAX_TEXT_BYTES = 1024 * 1024;

// ── a block-YAML reader sufficient for workflow files ────────────────────────────────────────────
// Mappings, sequences, plain/quoted scalars, flow [a, b] and {k: v}, and | / > block scalars.
// Every node carries the 1-based line it started on. Anchors, tags and multi-document files are
// out of scope: a workflow using them parses as far as it goes and the rest is reported unparseable.
const stripComment = (line) => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};

const unquote = (s) => {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
  return t;
};

function splitFlow(body) {
  const out = [];
  let cur = ''; let depth = 0; let q = null;
  for (const c of body) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function scalarNode(text, line) {
  const t = text.trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    return { type: 'seq', line, items: splitFlow(t.slice(1, -1)).map((s) => scalarNode(s, line)) };
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const entries = new Map();
    for (const part of splitFlow(t.slice(1, -1))) {
      const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(part);
      if (m) entries.set(unquote(m[1]), scalarNode(m[2], line));
    }
    return { type: 'map', line, entries };
  }
  return { type: 'scalar', line, value: unquote(t) };
}

const KEY_RE = /^([^\s'"#{}[\]-][^:]*?|'[^']*'|"[^"]*")\s*:(?:\s+(.*)|\s*)$/;

export function parseYaml(text) {
  const src = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const lines = [];
  for (let i = 0; i < src.length; i++) {
    const t = stripComment(src[i]);
    if (!t.trim() || t.trim() === '---') continue;
    lines.push({ indent: t.match(/^\s*/)[0].length, text: t.trim(), raw: src[i], line: i + 1, idx: i });
  }
  let pos = 0;

  const blockScalar = (parentIndent, startIdx) => {
    let end = startIdx + 1;
    while (end < src.length) {
      const l = src[end];
      if (l.trim() === '' || l.match(/^\s*/)[0].length > parentIndent) { end++; continue; }
      break;
    }
    const body = src.slice(startIdx + 1, end).join('\n');
    while (pos < lines.length && lines[pos].idx < end) pos++;
    return body;
  };

  const parseNode = (indent) => {
    if (pos >= lines.length) return { type: 'scalar', line: 0, value: '' };
    const l = lines[pos];
    if (l.text === '-' || l.text.startsWith('- ')) return parseSeq(l.indent);
    if (KEY_RE.test(l.text)) return parseMap(l.indent);
    // a plain or flow scalar continued onto its own line(s) under an empty-valued key
    const parts = [];
    while (pos < lines.length && lines[pos].indent >= l.indent && !(lines[pos].indent === l.indent && KEY_RE.test(lines[pos].text))) parts.push(lines[pos++].text);
    return scalarNode(parts.join(' '), l.line);
  };

  const parseSeq = (indent) => {
    const node = { type: 'seq', line: lines[pos].line, items: [] };
    while (pos < lines.length && lines[pos].indent === indent && (lines[pos].text === '-' || lines[pos].text.startsWith('- '))) {
      const l = lines[pos];
      const after = l.text === '-' ? '' : l.text.slice(2);
      const rest = after.trimStart();
      if (!rest) {
        pos++;
        node.items.push(pos < lines.length && lines[pos].indent > indent ? parseNode(lines[pos].indent) : { type: 'scalar', line: l.line, value: '' });
        continue;
      }
      // `- key: value` opens a mapping whose first key sits on the same line, at the content column
      const contentIndent = indent + 2 + (after.length - rest.length);
      lines[pos] = { ...l, indent: contentIndent, text: rest };
      if (KEY_RE.test(rest)) node.items.push(parseMap(contentIndent));
      else { pos++; node.items.push(scalarNode(rest, l.line)); }
    }
    return node;
  };

  const parseMap = (indent) => {
    const node = { type: 'map', line: lines[pos].line, entries: new Map() };
    while (pos < lines.length && lines[pos].indent === indent) {
      const l = lines[pos];
      const m = KEY_RE.exec(l.text);
      if (!m) throw new Error(`line ${l.line}: expected a mapping key`);
      const key = unquote(m[1]);
      const rest = m[2] == null ? '' : m[2].trim();
      if (/^[|>][-+]?\d*$/.test(rest)) {
        node.entries.set(key, { type: 'scalar', line: l.line, value: blockScalar(indent, l.idx), block: true });
        continue;
      }
      pos++;
      if (rest) { node.entries.set(key, scalarNode(rest, l.line)); continue; }
      const next = lines[pos];
      if (next && (next.indent > indent || (next.indent === indent && (next.text === '-' || next.text.startsWith('- '))))) {
        node.entries.set(key, parseNode(next.indent));
      } else node.entries.set(key, { type: 'scalar', line: l.line, value: '' });
    }
    if (pos < lines.length && lines[pos].indent > indent) throw new Error(`line ${lines[pos].line}: unexpected indentation`);
    return node;
  };

  if (!lines.length) return { type: 'map', line: 0, entries: new Map() };
  const root = parseNode(lines[0].indent);
  if (pos < lines.length) throw new Error(`line ${lines[pos].line}: unexpected content`);
  return root;
}

// ── node helpers ─────────────────────────────────────────────────────────────────────────────────
const get = (node, key) => (node && node.type === 'map' ? node.entries.get(key) : undefined);
const scalars = (node, out = []) => {
  if (!node) return out;
  if (node.type === 'scalar') out.push(node.value);
  else if (node.type === 'seq') node.items.forEach((n) => scalars(n, out));
  else if (node.type === 'map') node.entries.forEach((n) => scalars(n, out));
  return out;
};
const isSelfHosted = (s) => String(s).trim().toLowerCase() === 'self-hosted';
const isExpression = (s) => /\$\{\{/.test(String(s));

// ── rules ────────────────────────────────────────────────────────────────────────────────────────
/** How a job's runs-on names the self-hosted label, or '' when it does not. */
export function selfHostedForm(runsOn, strategy) {
  if (!runsOn) return '';
  if (runsOn.type === 'scalar') {
    if (isSelfHosted(runsOn.value)) return 'scalar';
    if (isExpression(runsOn.value) && scalars(get(strategy, 'matrix')).some(isSelfHosted)) return 'matrix';
    return '';
  }
  if (runsOn.type === 'seq') return runsOn.items.some((n) => n.type === 'scalar' && isSelfHosted(n.value)) ? 'list' : '';
  if (runsOn.type === 'map') return scalars(get(runsOn, 'labels')).some(isSelfHosted) ? 'labels' : '';
  return '';
}

/** Trigger names declared under `on`, whatever shape it takes. */
export function triggerNames(on) {
  if (!on) return [];
  if (on.type === 'scalar') return on.value ? [on.value] : [];
  if (on.type === 'seq') return on.items.filter((n) => n.type === 'scalar').map((n) => n.value);
  return [...on.entries.keys()];
}

const TRIGGERING_HEAD = /github\.event\.workflow_run\.(?:head_sha|head_branch|head_commit|head_repository|id)|github\.event\.pull_request\.(?:head\b|number|merge_commit_sha)|github\.head_ref|refs\/pull\/[^\s'"]*\/(?:head|merge)/;
const FETCH_VERB = /\bgit\s+(?:fetch|checkout|pull|switch)\b|\bgh\s+(?:run\s+download|pr\s+checkout)\b|\/artifacts\b/;

/** Why a step brings the triggering run's content onto the runner, or '' when it does not. */
export function stepPullsTriggeringHead(step) {
  const uses = get(step, 'uses');
  const withNode = get(step, 'with');
  const withValues = scalars(withNode);
  if (uses && uses.type === 'scalar') {
    const u = uses.value.toLowerCase();
    if (/(^|\/)checkout(@|$)/.test(u) && TRIGGERING_HEAD.test(String((get(withNode, 'ref') || {}).value || '') + ' ' + String((get(withNode, 'repository') || {}).value || ''))) {
      return 'checks out the triggering head';
    }
    if (/download-artifact/.test(u) && withValues.some((v) => /github\.event\.workflow_run/.test(String(v)))) {
      return 'downloads the triggering run\'s artifacts';
    }
  }
  const run = get(step, 'run');
  if (run && run.type === 'scalar' && TRIGGERING_HEAD.test(run.value) && FETCH_VERB.test(run.value)) {
    return 'fetches the triggering head in a run step';
  }
  return '';
}

// ── exit-masked-by-pipe ──────────────────────────────────────────────────────────────────────────
// GitHub runs a step with no `shell:` as `bash -e {0}`: no pipefail, so a test run piped into
// `tee out.txt` exits with tee's status and the job cannot fail on a failing test. veld's Tests job was built that
// way on 2026-05-21 and hid 216 failures until 2026-09-27. `shell: bash` runs `-eo pipefail`;
// `sh`, a custom template without pipefail, and the unset default do not.
const SINKS = new Set(['tee', 'cat', 'head', 'tail', 'sed', 'awk', 'cut', 'tr', 'sort', 'uniq', 'grep']);
// grep and find are lookups: an empty result is their ordinary signal, and the step is rarely there
// to run them (a second-opinion pass over the fleet found `$(find … | head -1)` guarded by the next command).
const NO_FAILURE_TO_HIDE = new Set(['echo', 'printf', 'cat', 'true', 'yes', ':', 'grep', 'find']);
const CONDITION_WORDS = new Set(['if', 'elif', 'while', 'until', '!']);
// Words that open a command without being it: `count() { grep … | awk …; }`, `then make | tee`.
const SKIP_WORDS = new Set(['time', 'sudo', 'then', 'do', 'else', '{', '(', 'exec']);

/** The shell a step runs under: the step's, else the job's, else the workflow's defaults, else ''. */
export function effectiveShell(doc, job, step) {
  const v = (n) => (n && n.type === 'scalar' ? String(n.value).trim() : '');
  return v(get(step, 'shell')) || v(get(get(get(job, 'defaults'), 'run'), 'shell')) || v(get(get(get(doc, 'defaults'), 'run'), 'shell'));
}

/** True when GitHub runs this shell without pipefail. */
export function shellDropsPipefail(shell) {
  if (!shell) return true;
  if (shell === 'bash') return false;
  if (shell === 'pwsh' || shell === 'powershell' || shell === 'cmd' || shell === 'python') return false;
  return !/pipefail/.test(shell);
}

const firstWord = (text) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sub = words.length ? /^[A-Za-z_][A-Za-z0-9_]*=\$\((.+)$/.exec(words[0]) : null;
  if (sub) return sub[1].replace(/^["']|["']$/g, '');
  if (words[0] === 'for' || words[0] === 'select') {
    const inner = words.find((w) => w.startsWith('$('));
    if (inner) return inner.slice(2).replace(/^["']|["']$/g, '');
  }
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || SKIP_WORDS.has(words[i]) || /^[A-Za-z_][A-Za-z0-9_-]*\(\)$/.test(words[i]))) i++;
  return words[i] === undefined ? '' : words[i].replace(/^["'(]+|["')]+$/g, '');
};

/**
 * Each pipeline in a run script whose failure its last command would hide: [{ source, sink }].
 * Quotes are respected, comments and heredoc bodies skipped, backslash continuations joined.
 */
export function maskedPipelines(script) {
  const out = [];
  const raw = String(script).split('\n');
  const lines = [];
  let heredoc = null;
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    if (heredoc) { if (line.replace(/^\t+/, '').trim() === heredoc) heredoc = null; continue; }
    while (/\\\s*$/.test(line) && i + 1 < raw.length) line = line.replace(/\\\s*$/, ' ') + raw[++i];
    const h = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
    if (h) heredoc = h[1];
    lines.push(line);
  }
  for (const line of lines) {
    const segments = [];
    let cur = '';
    let pipes = [];
    let q = null;
    const flush = (sep) => { pipes.push(cur); segments.push({ pipes, sep }); pipes = []; cur = ''; };
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
      if (c === '|' && line[i + 1] === '|') { flush('||'); i++; continue; }
      if (c === '&' && line[i + 1] === '&') { flush('&&'); i++; continue; }
      if (c === ';') { flush(';'); continue; }
      if (c === '|') { pipes.push(cur); cur = ''; continue; }
      cur += c;
    }
    flush('');
    for (const seg of segments) {
      if (seg.pipes.length < 2 || seg.sep === '||') continue;
      const source = firstWord(seg.pipes[0]);
      const sinkText = seg.pipes[seg.pipes.length - 1];
      const sink = firstWord(sinkText);
      if (!source || CONDITION_WORDS.has(source) || NO_FAILURE_TO_HIDE.has(source)) continue;
      if (!SINKS.has(sink) || (sink === 'grep' && /\s-[A-Za-z]*q/.test(` ${sinkText}`))) continue;
      out.push({ source, sink });
    }
  }
  return out;
}

const stepLabel = (step, i) => {
  const name = get(step, 'name');
  return name && name.type === 'scalar' && name.value ? name.value : `step ${i + 1}`;
};

/** Findings and counters for one parsed workflow. */
export function scanWorkflow(path, doc) {
  const findings = [];
  const counters = { jobs: 0, runsOnDynamic: 0, runnerGroups: 0, privileged: false };
  const add = (rule, job, step, line, detail) => findings.push({ rule, path, sev: RULE_SEV[rule], cwe: RULE_CWE[rule], job, step, line, detail });
  const triggers = triggerNames(get(doc, 'on') || get(doc, 'true'));
  const privileged = triggers.filter((t) => PRIVILEGED_TRIGGERS.has(t)).sort();
  counters.privileged = privileged.length > 0;
  const workflowPermissions = !!get(doc, 'permissions');
  const jobs = get(doc, 'jobs');
  if (!jobs || jobs.type !== 'map') return { findings, counters };

  for (const [jobName, job] of jobs.entries) {
    if (job.type !== 'map') continue;
    counters.jobs++;
    const runsOn = get(job, 'runs-on');
    const strategy = get(job, 'strategy');
    const form = selfHostedForm(runsOn, strategy);
    if (form) add('self-hosted-runner', jobName, '', runsOn.line, `runs-on names the self-hosted label (${form})`);
    else if (runsOn && runsOn.type === 'scalar' && isExpression(runsOn.value) && !scalars(get(strategy, 'matrix')).length) counters.runsOnDynamic++;
    else if (runsOn && runsOn.type === 'map' && get(runsOn, 'group')) counters.runnerGroups++;

    if (privileged.length) {
      const steps = get(job, 'steps');
      const hits = [];
      if (steps && steps.type === 'seq') {
        steps.items.forEach((step, i) => {
          if (step.type !== 'map') return;
          const why = stepPullsTriggeringHead(step);
          if (why) hits.push({ label: stepLabel(step, i), line: step.line, why });
        });
      }
      if (hits.length) {
        const more = hits.length > 1 ? `; ${hits.length - 1} more step(s) do the same` : '';
        add('workflow-run-trigger', jobName, hits[0].label, hits[0].line, `on ${privileged.join(' + ')}: ${hits[0].why}${more}`);
      }
    }

    const onWindows = runsOn && runsOn.type === 'scalar' && /windows/i.test(runsOn.value);
    const allSteps = get(job, 'steps');
    // One finding per job, naming the first step and counting the rest: the row identity is
    // (rule, workflow, job), so a finding per step would give two steps one identity.
    if (!onWindows && allSteps && allSteps.type === 'seq') {
      const hits = [];
      allSteps.items.forEach((step, i) => {
        if (step.type !== 'map') return;
        const run = get(step, 'run');
        // PIPESTATUS read in the script is the status handed back on purpose, as good as pipefail.
        if (!run || run.type !== 'scalar' || /\bpipefail\b|\bPIPESTATUS\b/.test(run.value)) return;
        const shell = effectiveShell(doc, job, step);
        if (!shellDropsPipefail(shell)) return;
        const masked = maskedPipelines(run.value);
        if (masked.length) hits.push({ label: stepLabel(step, i), line: step.line, shell, masked });
      });
      if (hits.length) {
        const [h] = hits;
        const how = h.shell ? `shell: ${h.shell}` : 'the default shell (bash -e, no pipefail)';
        const more = hits.length > 1 ? `; ${hits.length - 1} more step(s) in this job do the same` : '';
        add('exit-masked-by-pipe', jobName, h.label, h.line,
          `a pipeline into ${h.masked[0].sink} on ${how}: the step's status is ${h.masked[0].sink}'s, so a failure of ${h.masked[0].source} cannot fail the job${more}`);
      }
    }

    if (!workflowPermissions && !get(job, 'permissions')) {
      const reusable = get(job, 'uses') ? 'a reusable-workflow call ' : '';
      add('permissions-absent', jobName, '', job.line, `${reusable}with no permissions: block on the job or the workflow — GITHUB_TOKEN takes the repository default`);
    }
  }
  return { findings, counters };
}

// ── the walk ─────────────────────────────────────────────────────────────────────────────────────
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Scan one target root. Pure over the filesystem; the output is byte-stable for the same tree. */
export function scanActionsGaps(root) {
  const dir = join(root, WORKFLOWS_DIR);
  const findings = [];
  const unparseable = [];
  const unreadable = [];
  const skipped = [];
  let filesScanned = 0;
  let jobsScanned = 0;
  let privilegedTriggerWorkflows = 0;
  let runsOnDynamic = 0;
  let runnerGroups = 0;
  let workflowsDir = true;
  let names = [];
  try { names = readdirSync(dir); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    workflowsDir = false;
  }
  // GitHub reads workflow files from the top of .github/workflows only, so neither does this.
  for (const name of names.filter((n) => /\.ya?ml$/i.test(n)).sort()) {
    const rel = `${WORKFLOWS_DIR}/${name}`;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch (e) { unreadable.push({ path: rel, code: e.code || 'EUNKNOWN' }); continue; }
    if (!st.isFile()) continue;
    if (st.size > MAX_TEXT_BYTES) { skipped.push({ path: rel, why: 'over 1 MiB' }); continue; }
    let text;
    try { text = readFileSync(p, 'utf8'); } catch (e) { unreadable.push({ path: rel, code: e.code || 'EUNKNOWN' }); continue; }
    let doc;
    try { doc = parseYaml(text); } catch (e) { unparseable.push({ path: rel, why: e.message }); continue; }
    if (doc.type !== 'map') { unparseable.push({ path: rel, why: 'top level is not a mapping' }); continue; }
    filesScanned++;
    const r = scanWorkflow(rel, doc);
    findings.push(...r.findings);
    jobsScanned += r.counters.jobs;
    runsOnDynamic += r.counters.runsOnDynamic;
    runnerGroups += r.counters.runnerGroups;
    if (r.counters.privileged) privilegedTriggerWorkflows++;
  }

  findings.sort((a, b) => cmp(a.path, b.path) || cmp(a.rule, b.rule) || cmp(a.job, b.job));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const summary = {
    findings: findings.length,
    byRule,
    filesScanned,
    filesExamined: filesScanned + unparseable.length + unreadable.length + skipped.length,
    workflowsDir,
    jobsScanned,
    privilegedTriggerWorkflows,
    runsOnDynamic,
    runnerGroups,
    unparseable: unparseable.length,
    unparseableFiles: unparseable.sort((a, b) => cmp(a.path, b.path)),
    unreadable: unreadable.length,
    unreadableFiles: unreadable.sort((a, b) => cmp(a.path, b.path)),
    skipped: skipped.length,
    skippedFiles: skipped.sort((a, b) => cmp(a.path, b.path)),
    void: filesScanned === 0,
  };
  if (filesScanned === 0) {
    summary.voidReason = !workflowsDir ? 'no .github/workflows directory in this tree — a stated void, not a clean tree'
      : summary.filesExamined ? 'workflows are present but none could be read — a stated void, not a clean tree'
        : '.github/workflows holds no yaml — a stated void, not a clean tree';
  }
  return { tool: 'actions-gaps', summary, findings };
}

function main() {
  const root = resolve(process.env.CW_ACTIONS_GAPS_ROOT || process.argv[2] || '.');
  let st;
  try { st = statSync(root); } catch (e) { process.stderr.write(`actions-gaps: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`actions-gaps: ${root} is not a directory\n`); process.exit(2); }
  let out;
  try { out = scanActionsGaps(root); } catch (e) { process.stderr.write(`actions-gaps: ${e.code || ''} ${e.message}\n`); process.exit(2); }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
