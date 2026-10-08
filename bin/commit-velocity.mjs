#!/usr/bin/env node
// usage: commit-velocity.mjs [repoDir]
// env: CW_VELOCITY_DEPTH (commits read, default 500), CW_VELOCITY_WINDOW_MIN (rolling window, default 60),
//      CW_VELOCITY_COMMITS_PER_HOUR (default 30), CW_VELOCITY_WORKFLOW_PER_HOUR (default 6),
//      CW_VELOCITY_SENSITIVE_PER_HOUR (default 12), CW_VELOCITY_ALLOWLIST / CW_VELOCITY_ALLOWLIST_SCHEMA
//      (default monitor/velocity-allowlist.json, schema/velocity-allowlist.schema.json), CW_NOW
// exit: 0 ran · 2 could not run (not a git repository, git log failed, a bad env value)
// writes: rule-counts JSON {tool, summary:{findings, byRule, filesScanned, commitsScanned, windowMin, allowlisted, allowlistExpired, allowlistUnreadable?, ...}, findings:[{rule, path, sev, detail}]}
//
// The July 2026 Hugging Face intrusion ran ~17,600 attacker actions across 4.5 days — machine speed
// that read as routine because nothing escalated on RATE. This lane raises a finding when an author's
// commit or CI-file or sensitive-file edits cross a per-hour threshold no human sustains.
import { scannedGit } from './lib/git-env.mjs';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWho } from '../monitor/attribution.mjs';
import { validateAgainstSchema } from '../monitor/registry.mjs';

export const TOOL = 'commit-velocity';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_ROOT = resolve(HERE, '..');

export const RULE_CWE = Object.freeze({
  'machine-speed-commits': 'CWE-799',
  'workflow-edit-burst': 'CWE-799',
  'sensitive-file-burst': 'CWE-799',
});
export const RULE_SEV = Object.freeze({
  'machine-speed-commits': 'high',
  'workflow-edit-burst': 'high',
  'sensitive-file-burst': 'med',
});
export const RULES = Object.freeze(Object.keys(RULE_CWE));

const FIELD = '\x1f';
const RECORD = '\x1e';
const FORMAT = `${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%at`;

const WORKFLOW = /^\.github\/(?:workflows|actions)\//;
const SENSITIVE = /(?:^|\/)\.mcp\.json$|(?:^|\/)\.claude\/|(?:^|\/)\.cursor\/|(?:^|\/)\.env(?:\.|$)|(?:^|\/)\.npmrc$|(?:^|\/)\.netrc$|(?:^|\/)\.aws\/|(?:^|\/)id_(?:rsa|ed25519|ecdsa)|(?:^|\/)secrets?(?:\.|\/)|\.pem$|\.p12$/i;

export class CouldNotRun extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function git(repo, args) {
  // the sandbox is one layer: a signature check (%G?) also runs whatever gpg.program the repo names
  const r = scannedGit(repo, args, { maxBuffer: 128 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: String(r.error.message || r.error) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const firstLine = (s) => String(s || '').split('\n')[0].trim();

function posIntEnv(env, key, dflt) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new CouldNotRun(`${key} must be a positive integer, got '${raw}'`);
  return n;
}

// fact: each record is the formatted line then --name-only paths until the next RS (expiry: never, prev: not built)
export function parseLog(text) {
  const out = [];
  for (const rec of String(text).split(RECORD)) {
    if (!rec.trim()) continue;
    const lines = rec.split('\n');
    const f = lines[0].split(FIELD);
    if (f.length < 4) continue;
    const at = Number(f[3]);
    if (!Number.isFinite(at)) continue;
    out.push({
      sha: f[0], authorName: f[1], authorEmail: f[2], at,
      paths: lines.slice(1).map((l) => l.trim()).filter(Boolean),
    });
  }
  return out;
}

// guard: max events in any rolling window, computed per author from sorted epochs
function maxInWindow(epochsSec, windowSec) {
  const e = [...epochsSec].sort((a, b) => a - b);
  let best = 0, lo = 0;
  for (let hi = 0; hi < e.length; hi++) {
    while (e[hi] - e[lo] > windowSec) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export function rateSignal(commits, opts = {}) {
  const windowMin = opts.windowMin ?? 60;
  const windowSec = windowMin * 60;
  const perHour = windowMin / 60; // scale a per-hour threshold to the window
  const thresholds = {
    commits: (opts.commitsPerHour ?? 30) * perHour,
    workflow: (opts.workflowPerHour ?? 6) * perHour,
    sensitive: (opts.sensitivePerHour ?? 12) * perHour,
  };
  const byAuthor = new Map();
  const key = (c) => `${c.authorName} <${c.authorEmail}>`;
  for (const c of commits) {
    const k = key(c);
    if (!byAuthor.has(k)) byAuthor.set(k, { commits: [], workflow: [], sensitive: [], machine: classifyWho(c.authorName) === 'machine' || classifyWho(c.authorEmail) === 'machine' });
    const a = byAuthor.get(k);
    a.commits.push(c.at);
    if (c.paths.some((p) => WORKFLOW.test(p))) a.workflow.push(c.at);
    if (c.paths.some((p) => SENSITIVE.test(p))) a.sensitive.push(c.at);
  }
  const findings = [];
  for (const [author, a] of [...byAuthor.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const who = a.machine ? 'machine' : 'human';
    const commitBurst = maxInWindow(a.commits, windowSec);
    if (commitBurst > thresholds.commits) findings.push({ rule: 'machine-speed-commits', path: author, sev: RULE_SEV['machine-speed-commits'], cwe: RULE_CWE['machine-speed-commits'], detail: `${commitBurst} commits in a ${windowMin}m window (threshold ${Math.round(thresholds.commits)}); author=${who}` });
    const wfBurst = maxInWindow(a.workflow, windowSec);
    if (wfBurst > thresholds.workflow) findings.push({ rule: 'workflow-edit-burst', path: author, sev: RULE_SEV['workflow-edit-burst'], cwe: RULE_CWE['workflow-edit-burst'], detail: `${wfBurst} commits touching .github/workflows or actions in a ${windowMin}m window (threshold ${Math.round(thresholds.workflow)}); author=${who}` });
    const senBurst = maxInWindow(a.sensitive, windowSec);
    if (senBurst > thresholds.sensitive) findings.push({ rule: 'sensitive-file-burst', path: author, sev: RULE_SEV['sensitive-file-burst'], cwe: RULE_CWE['sensitive-file-burst'], detail: `${senBurst} commits touching credential/config files in a ${windowMin}m window (threshold ${Math.round(thresholds.sensitive)}); author=${who}` });
  }
  findings.sort((x, y) => (x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : x.path < y.path ? -1 : 1));
  return { findings, authors: byAuthor.size };
}

// guard: an unreadable or schema-failing allowlist suppresses nothing
export function loadAllowlist(env = process.env) {
  const p = env.CW_VELOCITY_ALLOWLIST || join(SELF_ROOT, 'monitor', 'velocity-allowlist.json');
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { entries: [] } : { entries: [], unreadable: `${p}: ${e.code || 'error'}` }; }
  let doc;
  try { doc = JSON.parse(raw); } catch { return { entries: [], unreadable: `${p}: not JSON` }; }
  const v = validateAgainstSchema(doc, { path: env.CW_VELOCITY_ALLOWLIST_SCHEMA || join(SELF_ROOT, 'schema', 'velocity-allowlist.schema.json') });
  if (v.errors.length) return { entries: [], unreadable: `${p} fails schema/velocity-allowlist.schema.json: ${v.errors.join('; ')}` };
  return { entries: doc.allow };
}

const emailOf = (author) => (/<([^>]+)>$/.exec(author) || [])[1] || null;

export function applyAllowlist(findings, entries, { repo, selfScan, now }) {
  let expired = 0;
  const active = entries.filter((a) => {
    const applies = a.repo ? (a.repo === repo || (a.repo === 'commitwork' && selfScan)) : selfScan;
    if (!applies) return false;
    const exp = Date.parse(a.expires);
    if (!Number.isFinite(exp)) return false;
    if (exp < now) { expired++; return false; }
    return true;
  });
  const kept = [];
  let suppressed = 0;
  for (const f of findings) {
    const hit = active.some((a) => a.rule === f.rule && (a.author === f.path || a.author === emailOf(f.path)));
    if (hit) suppressed++; else kept.push(f);
  }
  return { findings: kept, suppressed, expired };
}

export function scan(repoDir, env = process.env) {
  const repo = resolve(repoDir || '.');
  const depth = posIntEnv(env, 'CW_VELOCITY_DEPTH', 500);
  const windowMin = posIntEnv(env, 'CW_VELOCITY_WINDOW_MIN', 60);
  const inside = git(repo, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') throw new CouldNotRun(`not a git repository: ${firstLine(inside.stderr) || repo}`);
  const log = git(repo, ['log', '-n', String(depth), `--format=${FORMAT}`, '--name-only', '--no-merges']);
  let commits = [];
  if (log.status === 0) commits = parseLog(log.stdout);
  else if (!/does not have any commits yet|bad default revision/i.test(log.stderr)) throw new CouldNotRun(`git log failed: ${firstLine(log.stderr)}`);
  const raw = rateSignal(commits, {
    windowMin,
    commitsPerHour: posIntEnv(env, 'CW_VELOCITY_COMMITS_PER_HOUR', 30),
    workflowPerHour: posIntEnv(env, 'CW_VELOCITY_WORKFLOW_PER_HOUR', 6),
    sensitivePerHour: posIntEnv(env, 'CW_VELOCITY_SENSITIVE_PER_HOUR', 12),
  });
  const al = loadAllowlist(env);
  const now = Number.isFinite(Date.parse(env.CW_NOW || '')) ? Date.parse(env.CW_NOW) : Date.now();
  const applied = applyAllowlist(raw.findings, al.entries, { repo: basename(repo), selfScan: repo === SELF_ROOT, now });
  const { findings } = applied;
  const byRule = {};
  for (const r of RULES) byRule[r] = 0;
  for (const f of findings) byRule[f.rule] += 1;
  const summary = {
    findings: findings.length, byRule, filesScanned: commits.length, commitsScanned: commits.length, windowMin, authors: raw.authors, depth,
    allowlisted: applied.suppressed, allowlistExpired: applied.expired,
    ...(al.unreadable ? { allowlistUnreadable: al.unreadable } : {}),
  };
  if (al.unreadable) process.stderr.write(`${TOOL}: allowlist ${al.unreadable} — suppressing NOTHING\n`);
  if (!commits.length) summary.void = 'no non-merge commits reachable from HEAD';
  return { tool: TOOL, summary, findings };
}

function emit(o) { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); }

export function main(argv = process.argv, env = process.env) {
  try { emit(scan(argv[2] || '.', env)); return 0; }
  catch (e) {
    if (!(e instanceof CouldNotRun)) throw e;
    emit({ tool: TOOL, summary: { findings: 0, byRule: {}, filesScanned: 0, commitsScanned: 0, couldNotRun: e.reason }, findings: [] });
    process.stderr.write(`${TOOL}: could not run — ${e.reason}\n`);
    return 2;
  }
}

if (process.argv[1] && /commit-velocity\.mjs$/.test(process.argv[1])) process.exit(main());
