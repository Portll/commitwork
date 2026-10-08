#!/usr/bin/env node
// bin/lane-fixture.mjs — turn a seed project into a lane-capability golden fixture, or refuse.
//
// The seed is only an input: the real check runs over it through `commitwork run`, and the artifact
// the tool wrote is the candidate. A drafted artifact (--draft) is accepted only when the manifest
// says a real run cannot measure the lane here: it reads a live target (egress `target` or
// `github`), or a declared tool, secret or Docker daemon is unavailable. The fixture is then recorded
// as `synthetic`. For every other lane a real run that wrote nothing, or wrote an artifact the
// extractor reads as zero, is a rejection: the draft is the seed author's claim and the tool is the
// witness.
//
// Machine paths are scrubbed, and gitleaks re-reads the candidate so that any secret value in it is
// replaced with REDACTED-FIXTURE before it can be installed.
//
// The seed becomes one commit by a fixed synthetic identity. A lane that reads history (commit
// provenance, commit velocity, secrets in history) declares the commits it needs in the seed's
// .lane-history.json: {commits:[{message, date, author:{name,email}, committer?, files:{path:text}}]},
// replayed in order after the seed commit and never committed itself.
//
// usage: node bin/lane-fixture.mjs --category <cat> [--seed <dir>] [--draft <dir>] [--out <dir>]
//                                  [--install] [--replace] [--drafted-by <text>]
// prints one JSON verdict; exit 0 accepted, 1 rejected, 2 usage or setup error.
// CW_LANE_FIXTURES overrides the install root, read at call time. CW_NOW pins `accepted`.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCANNER_SPECS } from '../monitor/extractors.mjs';
import { probeCategory } from '../monitor/lane-capability.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REDACTED = 'REDACTED-FIXTURE (value removed before commit)';
const PLACEHOLDER_REPO = '/fixture/repo';
const PLACEHOLDER_HOME = '/src/fixture';

const fixtureRoot = () => process.env.CW_LANE_FIXTURES || join(CW, 'monitor', 'test', 'fixtures', 'lane-capability');

export function laneSpec(category) {
  const row = SCANNER_SPECS.find(([c]) => c === category);
  if (!row) return null;
  const [, checkId, extract] = row;
  const artifacts = [...new Set([...extract.toString().matchAll(/'([^']+\.(?:json|jsonl|ndjson|sarif|txt|log))'/g)].map((m) => m[1]))];
  return { category, checkId, extract, artifacts };
}

// fact: a check is looked up in every bundled manifest, security-baseline first / test-hermetic lives in manifests/hermetic-tests.json, and a baseline-only lookup read it as "not in the bundled manifest" and demanded a draft (expiry: never, prev: broken)
/** The check with that id and the bundled manifest that declares it, or null. */
export function manifestCheck(checkId) {
  const dir = join(CW, 'manifests');
  const others = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'security-baseline.json').sort();
  for (const file of ['security-baseline.json', ...others]) {
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const check = Array.isArray(doc?.checks) ? doc.checks.find((c) => c.id === checkId) : null;
    if (check) return { ...check, manifest: file.slice(0, -'.json'.length) };
  }
  return null;
}

const onPath = (tool) => spawnSync('/bin/sh', ['-c', `command -v ${JSON.stringify(tool)}`], { stdio: 'ignore' }).status === 0;
const dockerUp = () => spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 20000 }).status === 0;

/** Why a real run cannot measure this lane on this machine, or null when it can. */
export function realRunBlocker(check, { hasTool = onPath, env = process.env, docker = dockerUp } = {}) {
  if (!check) return 'the check is not in the bundled manifest';
  if (['target', 'github'].includes(check.egress)) return `the lane reads a live target (egress ${check.egress}), not the repository`;
  const req = check.requires || {};
  const missing = (req.tools || []).filter((t) => !hasTool(t));
  if (missing.length) return `tools not installed: ${missing.join(', ')}`;
  const unset = (req.secrets || []).filter((k) => !env[k]);
  if (unset.length) return `required secrets unset: ${unset.join(', ')}`;
  if (req.docker && !docker()) return 'the Docker daemon is not running';
  return null;
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Replace every spelling of the scratch repo path and the home directory with fixed placeholders. */
export function scrubPaths(text, repoPaths, home = homedir()) {
  let s = text;
  for (const p of [...new Set(repoPaths)].sort((a, b) => b.length - a.length)) s = s.split(p).join(PLACEHOLDER_REPO);
  if (home && home.length > 1) s = s.split(home).join(PLACEHOLDER_HOME);
  return s;
}

/** A SARIF run carries every rule the tool loaded (Semgrep: megabytes); a fixture needs only the
 *  rules its results cite. ruleIndex is remapped so each result still resolves to its rule. */
export function pruneSarif(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { text, pruned: false }; }
  if (!Array.isArray(doc?.runs)) return { text, pruned: false };
  let removed = 0;
  for (const run of doc.runs) {
    const rules = run?.tool?.driver?.rules;
    if (!Array.isArray(rules)) continue;
    const indexOf = (r) => (Number.isInteger(r.ruleIndex) ? r.ruleIndex : rules.findIndex((x) => x.id === r.ruleId));
    const keep = new Map();
    for (const r of run.results || []) {
      const i = indexOf(r);
      if (i >= 0 && !keep.has(i)) keep.set(i, keep.size);
    }
    for (const r of run.results || []) if (Number.isInteger(r.ruleIndex) && keep.has(r.ruleIndex)) r.ruleIndex = keep.get(r.ruleIndex);
    removed += rules.length - keep.size;
    run.tool.driver.rules = [...keep.keys()].map((i) => rules[i]);
  }
  return removed ? { text: JSON.stringify(doc, null, 1) + '\n', pruned: true, removed } : { text, pruned: false };
}

export const HISTORY_FILE = '.lane-history.json';
const SEED_IDENTITY = { name: 'Lane Fixture', email: 'fixture@example.com', date: '2026-01-01T00:00:00Z' };

/** A seed's declared commit history, validated, or [] when it declares none. Throws on a malformed one. */
export function readHistory(seedDir) {
  const path = join(seedDir, HISTORY_FILE);
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`${HISTORY_FILE}: ${e.message}`);
  }
  const who = (p, at) => {
    if (!p || typeof p.name !== 'string' || !p.name || typeof p.email !== 'string' || !p.email) throw new Error(`${HISTORY_FILE}: ${at} needs a name and an email`);
    return { name: p.name, email: p.email };
  };
  if (!Array.isArray(doc?.commits) || !doc.commits.length) throw new Error(`${HISTORY_FILE}: expected {commits:[...]} with at least one commit`);
  return doc.commits.map((c, i) => {
    const at = `commit #${i + 1}`;
    if (typeof c.message !== 'string' || !c.message) throw new Error(`${HISTORY_FILE}: ${at} needs a message`);
    if (!Number.isFinite(Date.parse(c.date))) throw new Error(`${HISTORY_FILE}: ${at} needs an ISO date`);
    const files = c.files || {};
    if (typeof files !== 'object' || Array.isArray(files) || Object.values(files).some((v) => typeof v !== 'string')) throw new Error(`${HISTORY_FILE}: ${at} files must map paths to text`);
    for (const p of Object.keys(files)) if (p.startsWith('/') || p.split('/').includes('..')) throw new Error(`${HISTORY_FILE}: ${at} path ${p} leaves the repository`);
    const author = who(c.author, `${at} author`);
    return { message: c.message, date: c.date, files, author, committer: c.committer ? who(c.committer, `${at} committer`) : author };
  });
}

// fact: every seed commit has a fixed identity and date / the run inherits the operator's git identity otherwise, and a fixture that records an author would publish it (expiry: never, prev: missing)
/** Build the scratch repository: the seed as one commit, then each declared history commit in order. */
export function seedRepo(seedDir, repo) {
  mkdirSync(repo, { recursive: true });
  const history = seedDir && existsSync(seedDir) ? readHistory(seedDir) : [];
  if (seedDir && existsSync(seedDir)) cpSync(seedDir, repo, { recursive: true });
  rmSync(join(repo, HISTORY_FILE), { force: true });
  const commit = (message, author, committer, date) => {
    const env = { ...process.env, GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email, GIT_COMMITTER_DATE: date };
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', message], { cwd: repo, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`seed commit "${message}" failed: ${(r.stderr || '').trim().slice(0, 200)}`);
  };
  spawnSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' });
  spawnSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
  commit('lane fixture seed', SEED_IDENTITY, SEED_IDENTITY, SEED_IDENTITY.date);
  for (const c of history) {
    for (const [p, text] of Object.entries(c.files)) {
      mkdirSync(dirname(join(repo, p)), { recursive: true });
      writeFileSync(join(repo, p), text);
    }
    spawnSync('git', ['add', '-A'], { cwd: repo, stdio: 'ignore' });
    commit(c.message, c.author, c.committer, c.date);
  }
  return { commits: 1 + history.length };
}

function runReal(spec, seedDir, scratch, manifest = 'security-baseline') {
  const repo = join(scratch, 'repo');
  seedRepo(seedDir, repo);
  const reports = join(scratch, 'reports');
  mkdirSync(reports, { recursive: true });
  const r = spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'run', spec.checkId,
    '--manifest', manifest, '--repo', repo, '--no-fail-fast'], {
    cwd: scratch, encoding: 'utf8', timeout: 45 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', CW_SELF_SWEEP: '0' },
  });
  const wanted = new Set(spec.artifacts.flatMap((a) => [a, `${a}.exit`]));
  const found = listFiles(reports).filter((p) => wanted.has(p.split('/').pop()));
  return { repo, reports, status: r.status, signal: r.signal, tail: `${r.stdout || ''}${r.stderr || ''}`.slice(-1500), found };
}

function redactSecrets(dir) {
  if (!onPath('gitleaks')) return { ran: false, redacted: 0 };
  const report = join(mkdtempSync(join(tmpdir(), 'cw-lane-gitleaks-')), 'recheck.json');
  spawnSync('gitleaks', ['detect', '--no-git', '--no-banner', '--source', dir, '--report-format', 'json', '--report-path', report, '--exit-code', '0'], { stdio: 'ignore' });
  let hits = [];
  try { hits = JSON.parse(readFileSync(report, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  let redacted = 0;
  for (const h of hits) {
    const file = resolve(dir, h.File);
    if (!file.startsWith(resolve(dir)) || !existsSync(file) || !h.Secret) continue;
    const before = readFileSync(file, 'utf8');
    const after = before.split(h.Secret).join(REDACTED);
    if (after !== before) { writeFileSync(file, after); redacted++; }
  }
  return { ran: true, redacted, hits: hits.length };
}

// `machine` is realRunBlocker's view of this box (hasTool, env, docker). Left out, it is probed;
// a test names it, so its verdict does not depend on which scanners the machine running it has.
export function acceptLane({ category, seed = null, draft = null, out = null, machine = {} }) {
  const spec = laneSpec(category);
  if (!spec) return { category, accepted: false, error: `unknown lane category ${category}` };
  const scratch = mkdtempSync(join(tmpdir(), `cw-lane-${category}-`));
  const candidate = out ? resolve(out) : join(scratch, 'candidate');
  rmSync(candidate, { recursive: true, force: true });
  mkdirSync(candidate, { recursive: true });
  const check = manifestCheck(spec.checkId);
  const blocker = realRunBlocker(check, machine);
  const seeded = !!seed && listFiles(seed).length > 0;
  const verdict = { category, check: spec.checkId, artifacts: spec.artifacts, tools: check?.requires?.tools || [], seeded, ...(blocker ? { blocker } : {}) };

  let source = null;
  if (!blocker) {
    if (!seeded) {
      return { ...verdict, accepted: false, source: null, candidate,
        reason: 'the lane reads repository files and can run here, so it needs a seed; an empty seed cannot measure it' };
    }
    let real;
    try { real = runReal(spec, seed, scratch, check.manifest); } catch (e) { return { ...verdict, accepted: false, error: `seed: ${e.message}` }; }
    verdict.run = { status: real.status, signal: real.signal, wrote: real.found.map((p) => relative(real.reports, p)) };
    if (!real.found.some((p) => !p.endsWith('.exit'))) {
      verdict.run.tail = real.tail;
      return { ...verdict, accepted: false, source: null, candidate,
        reason: 'the real run wrote no artifact (see run.tail: a check reported n/a lacks its trigger file; noscan means the tool failed); the draft is not a substitute' };
    }
    const repoPaths = [real.repo];
    try { repoPaths.push(realpathSync(real.repo)); } catch { /* scratch removed underneath us: scrub what we have */ }
    for (const p of real.found) {
      const name = p.split('/').pop();
      let text = scrubPaths(readFileSync(p, 'utf8'), repoPaths);
      if (name.endsWith('.sarif')) {
        const pr = pruneSarif(text);
        if (pr.pruned) { text = pr.text; verdict.pruned = `${pr.removed} unreferenced SARIF rule definitions removed`; }
      }
      writeFileSync(join(candidate, name), text);
    }
    source = 'real';
  } else if (draft && existsSync(draft) && listFiles(draft).length) {
    for (const p of listFiles(draft)) cpSync(p, join(candidate, p.split('/').pop()));
    source = 'synthetic';
  } else {
    return { ...verdict, accepted: false, source: null, reason: `no artifact: a real run cannot measure this lane here (${blocker}) and no draft was given`, candidate };
  }
  verdict.secrets = redactSecrets(candidate);
  const probe = probeCategory(category, spec.extract, candidate);
  const accepted = probe.witness === 'counting';
  return {
    ...verdict, source, witness: probe.witness, ...(probe.note ? { note: probe.note } : {}), accepted, candidate,
    ...(accepted ? {} : { reason: source === 'real' && probe.witness === 'zero-on-golden'
      ? 'the real tool found nothing in the seed; the draft is not a substitute'
      : `extractor classified the ${source} candidate ${probe.witness}` }),
  };
}

export function installFixture(result, { replace = false, draftedBy = null } = {}) {
  const root = fixtureRoot();
  const dest = join(root, result.category);
  if (existsSync(dest) && readdirSync(dest).length && !replace) {
    throw new Error(`${dest} already holds a fixture; pass --replace to overwrite it`);
  }
  const stage = `${dest}.tmp-${process.pid}`;
  rmSync(stage, { recursive: true, force: true });
  cpSync(result.candidate, stage, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  renameSync(stage, dest);

  const provPath = join(root, 'PROVENANCE.json');
  let prov = { note: 'How each lane-capability fixture was produced. real: the lane\'s own tool ran over a seed project through `commitwork run`. synthetic: no real run produced an artifact, so a drafted artifact was accepted on the extractor\'s reading alone, which proves the parser and not the tool\'s output shape. Written by bin/lane-fixture.mjs.', lanes: {} };
  try { prov = JSON.parse(readFileSync(provPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  prov.lanes[result.category] = {
    source: result.source,
    ...(result.blocker ? { why: result.blocker } : {}),
    ...(result.pruned ? { pruned: result.pruned } : {}),
    check: result.check,
    tools: result.tools,
    files: readdirSync(dest).sort(),
    ...(draftedBy ? { draftedBy } : {}),
    accepted: process.env.CW_NOW || new Date().toISOString().slice(0, 10),
  };
  prov.lanes = Object.fromEntries(Object.entries(prov.lanes).sort(([a], [b]) => (a < b ? -1 : 1)));
  const tmp = `${provPath}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(prov, null, 1) + '\n');
  renameSync(tmp, provPath);
  return dest;
}

function main() {
  const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : null; };
  const has = (name) => process.argv.includes(`--${name}`);
  const category = arg('category');
  if (!category) { console.error('usage: lane-fixture.mjs --category <cat> [--seed <dir>] [--draft <dir>] [--out <dir>] [--install] [--replace] [--drafted-by <text>]'); process.exit(2); }
  const result = acceptLane({ category, seed: arg('seed'), draft: arg('draft'), out: arg('out') });
  if (result.error) { console.log(JSON.stringify(result)); process.exit(2); }
  if (result.accepted && has('install')) result.installed = installFixture(result, { replace: has('replace'), draftedBy: arg('drafted-by') });
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.accepted ? 0 : 1);
}

if (isMainModule(import.meta.url)) main();
