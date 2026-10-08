#!/usr/bin/env node
// usage: commit-provenance.mjs [repoDir]
// env: CW_PROVENANCE_DEPTH (commits read, default 200), CW_PROVENANCE_BOTS (comma list of registered bot names/emails),
//      CW_PROVENANCE_BOT_FILE (default <repo>/.commitwork-bots.json), CW_PROVENANCE_REPO (owner/name; default from origin),
//      CW_BRANCH_PROTECTION (default manifests/branch-protection.json)
// exit: 0 ran · 2 could not run (not a git repository, git log failed, an input file unreadable or unparseable)
// writes: JSON to stdout {tool, summary:{findings, byRule, filesScanned, commitsScanned, notApplicable, ...}, findings:[{rule, path, sha, sev, cwe, detail}]}
import { scannedGit } from './lib/git-env.mjs';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWho } from '../monitor/attribution.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOOL = 'commit-provenance';

export const RULE_CWE = Object.freeze({
  'unsigned-on-protected-branch': 'CWE-347',
  'bot-authored-merge': 'CWE-345',
  'author-committer-mismatch': 'CWE-345',
  'machine-author-unregistered': 'CWE-345',
});
export const RULE_SEV = Object.freeze({
  'unsigned-on-protected-branch': 'med',
  'bot-authored-merge': 'med',
  'author-committer-mismatch': 'low',
  'machine-author-unregistered': 'high',
});
export const RULES = Object.freeze(Object.keys(RULE_CWE));

// fact: fields are split on US and records on RS / a body carries newlines and any printable byte (expiry: never, prev: not built)
const FIELD = '\x1f';
const RECORD = '\x1e';
const FORMAT = `%H${FIELD}%an${FIELD}%ae${FIELD}%cn${FIELD}%ce${FIELD}%P${FIELD}%s${FIELD}%b${RECORD}`;
// fact: %G? runs the signature verifier once per signed commit, ~50ms each measured 2026-09-15 / read only where the rule applies (expiry: on re-measure, prev: slow)
const SIGNATURE_FORMAT = `%H${FIELD}%G?`;
const AUTHORISED_BY = /authori[sz]ed[\s-]+by[:\s]+([^\r\n]+)/i;

export class CouldNotRun extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

function git(repo, args) {
  // the sandbox is one layer: a signature check (%G?) also runs whatever gpg.program the repo names
  const r = scannedGit(repo, args, { maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: String(r.error.message || r.error) };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const firstLine = (s) => String(s || '').split('\n')[0].trim();

function depthFrom(env) {
  const raw = env.CW_PROVENANCE_DEPTH;
  if (raw === undefined || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new CouldNotRun(`CW_PROVENANCE_DEPTH must be a positive integer, got '${raw}'`);
  return n;
}

export function parseLog(text) {
  const out = [];
  for (const rec of String(text).split(RECORD)) {
    if (!rec.trim()) continue;
    const f = rec.replace(/^\n/, '').split(FIELD);
    if (f.length < 7) continue;
    out.push({
      sha: f[0], authorName: f[1], authorEmail: f[2], committerName: f[3], committerEmail: f[4],
      parents: f[5].trim() ? f[5].trim().split(/\s+/) : [], subject: f[6], body: f.slice(7).join(FIELD),
    });
  }
  return out;
}

/** `sha -> %G?` for the commits reachable from `ref`, read only when a signing expectation exists. */
export function parseSignatures(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const [sha, status] = line.split(FIELD);
    if (sha && sha.trim()) map.set(sha.trim(), (status || '').trim());
  }
  return map;
}

const readJSONOrAbsent = (path) => {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return undefined;
    throw new CouldNotRun(`${path}: ${e && e.code ? e.code : e}`);
  }
  try { return JSON.parse(raw); } catch (e) { throw new CouldNotRun(`${path}: not valid JSON (${firstLine(e && e.message)})`); }
};

function botRegistry(repo, env) {
  const names = new Set();
  const sources = [];
  const add = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); if (s) names.add(s); };
  const botFile = env.CW_PROVENANCE_BOT_FILE || join(repo, '.commitwork-bots.json');
  const bf = readJSONOrAbsent(botFile);
  if (bf !== undefined) {
    const list = Array.isArray(bf) ? bf : bf && Array.isArray(bf.bots) ? bf.bots : null;
    if (!list) throw new CouldNotRun(`${botFile}: expected an array of names/emails or {bots:[...]}`);
    list.forEach(add); sources.push('.commitwork-bots.json');
  }
  const cw = readJSONOrAbsent(join(repo, 'commitwork.json'));
  if (cw && Array.isArray(cw.bots)) { cw.bots.forEach(add); sources.push('commitwork.json'); }
  if (env.CW_PROVENANCE_BOTS) { env.CW_PROVENANCE_BOTS.split(',').forEach(add); sources.push('CW_PROVENANCE_BOTS'); }
  return { names, sources };
}

export function repoIdentity(repo, env) {
  if (env.CW_PROVENANCE_REPO) return String(env.CW_PROVENANCE_REPO).trim().toLowerCase();
  const r = git(repo, ['remote', 'get-url', 'origin']);
  if (r.status !== 0) return null;
  const m = r.stdout.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  return m ? m[1].toLowerCase() : null;
}

// fact: the rule is not-applicable unless the manifest lists the repo with requireSigned:true / an absent expectation is not an unmet one (expiry: never, prev: not built)
function protectionFor(repo, env, depth) {
  const path = env.CW_BRANCH_PROTECTION || join(HERE, '..', 'manifests', 'branch-protection.json');
  const manifest = readJSONOrAbsent(path);
  if (manifest === undefined) return { state: 'manifest-absent', applicable: false };
  const repos = manifest && Array.isArray(manifest.repos) ? manifest.repos : null;
  if (!repos) throw new CouldNotRun(`${path}: expected {repos:[...]}`);
  const id = repoIdentity(repo, env);
  const entry = id ? repos.find((e) => e && String(e.repo || '').toLowerCase() === id) : null;
  if (!entry) return { state: id ? 'not-in-manifest' : 'repo-unidentified', applicable: false };
  if (entry.requireSigned !== true) return { state: 'not-required', branch: entry.branch, applicable: false };
  const branch = String(entry.branch || 'main');
  const rl = git(repo, ['log', '-n', String(depth), `--format=${SIGNATURE_FORMAT}`, branch, '--']);
  if (rl.status !== 0) return { state: 'branch-missing', branch, applicable: true, signatures: null };
  return { state: 'checked', branch, applicable: true, signatures: parseSignatures(rl.stdout) };
}

const isMachine = (name, email) => classifyWho(name) === 'machine' || classifyWho(email) === 'machine';
const registered = (names, name, email) => names.has(String(name || '').toLowerCase()) || names.has(String(email || '').toLowerCase());
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export function judge(commit, ctx) {
  const out = [];
  const a = isMachine(commit.authorName, commit.authorEmail) ? 'machine' : 'human';
  const c = isMachine(commit.committerName, commit.committerEmail) ? 'machine' : 'human';
  const push = (rule, detail) => out.push({ rule, path: ctx.branch, sha: commit.sha, sev: RULE_SEV[rule], cwe: RULE_CWE[rule], detail });
  if (ctx.protection.signatures && ctx.protection.signatures.get(commit.sha) === 'N') {
    push('unsigned-on-protected-branch', `signature=N on protected branch ${ctx.protection.branch}`);
  }
  if (commit.parents.length >= 2 && a === 'machine') {
    const m = `${commit.subject}\n${commit.body}`.match(AUTHORISED_BY);
    const human = m && classifyWho(m[1]) !== 'machine';
    if (!human) push('bot-authored-merge', `merge of ${commit.parents.length} parents, author=machine, no authorized-by marker`);
  }
  if (a === 'human' && c === 'human'
    && !(same(commit.authorName, commit.committerName) && same(commit.authorEmail, commit.committerEmail))) {
    push('author-committer-mismatch', 'author=human committer=human, identities differ');
  }
  if (a === 'machine' && !registered(ctx.bots.names, commit.authorName, commit.authorEmail)) {
    push('machine-author-unregistered', `author=machine, not in the declared bot list (${ctx.bots.names.size} registered)`);
  }
  return out;
}

export function scan(repoDir, env = process.env) {
  const repo = resolve(repoDir || '.');
  const depth = depthFrom(env);
  const inside = git(repo, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') throw new CouldNotRun(`not a git repository: ${firstLine(inside.stderr) || repo}`);
  const sym = git(repo, ['symbolic-ref', '--short', '-q', 'HEAD']);
  const branch = sym.status === 0 && sym.stdout.trim() ? sym.stdout.trim() : 'HEAD';
  const log = git(repo, ['log', '-n', String(depth), `--format=${FORMAT}`]);
  let commits = [];
  if (log.status === 0) commits = parseLog(log.stdout);
  else if (!/does not have any commits yet|bad default revision/i.test(log.stderr)) throw new CouldNotRun(`git log failed: ${firstLine(log.stderr)}`);
  const bots = botRegistry(repo, env);
  const protection = protectionFor(repo, env, depth);
  const ctx = { branch, bots, protection };
  const findings = [];
  let machineAuthored = 0;
  for (const c of commits) {
    if (isMachine(c.authorName, c.authorEmail)) machineAuthored += 1;
    findings.push(...judge(c, ctx));
  }
  findings.sort((x, y) => (x.sha < y.sha ? -1 : x.sha > y.sha ? 1 : x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : 0));
  const byRule = {};
  for (const r of RULES) byRule[r] = 0;
  for (const f of findings) byRule[f.rule] += 1;
  const rulesNotApplicable = protection.applicable ? [] : ['unsigned-on-protected-branch'];
  const unmeasured = protection.state === 'branch-missing' ? ['unsigned-on-protected-branch'] : [];
  const signatureStates = {};
  if (protection.signatures) for (const s of protection.signatures.values()) signatureStates[s || '?'] = (signatureStates[s || '?'] || 0) + 1;
  const summary = {
    findings: findings.length, byRule,
    filesScanned: commits.length, commitsScanned: commits.length, depth, branch,
    notApplicable: rulesNotApplicable.length, rulesNotApplicable, unmeasured,
    protectedBranch: { state: protection.state, ...(protection.branch ? { branch: protection.branch } : {}),
      ...(protection.signatures ? { signatureStates } : {}) },
    botRegistry: { sources: bots.sources, count: bots.names.size },
    machineAuthored,
  };
  if (!commits.length) summary.void = 'no commits reachable from HEAD';
  return { tool: TOOL, summary, findings };
}

function emit(o) { process.stdout.write(`${JSON.stringify(o, null, 2)}\n`); }

export function main(argv = process.argv, env = process.env) {
  try {
    emit(scan(argv[2] || '.', env));
    return 0;
  } catch (e) {
    if (!(e instanceof CouldNotRun)) throw e;
    emit({ tool: TOOL, summary: { findings: 0, byRule: {}, filesScanned: 0, commitsScanned: 0, notApplicable: 0, couldNotRun: e.reason }, findings: [] });
    process.stderr.write(`${TOOL}: could not run — ${e.reason}\n`);
    return 2;
  }
}

if (process.argv[1] && /commit-provenance\.mjs$/.test(process.argv[1])) process.exit(main());
