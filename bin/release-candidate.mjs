#!/usr/bin/env node
// bin/release-candidate.mjs — build the public snapshot of a committed ref as a fresh one-commit
// repository, then run every release gate on that candidate: tree witness, secrets with reviewed
// dispositions, private names, docs freshness, the launchlist's publication content checks, and the
// suite with no private data reachable.
// Read-only to this repository. The record is journalled to the sidecar.
//
// usage:
//   node bin/release-candidate.mjs [--project <name>] [--ref <rev>] [--out <dir>] [--date <iso>] [--message <text>]
//                                  [--skip-tests] [--test-timeout <minutes>] [--json] [--no-journal]
//
// --project builds another fleet repository. Its repo, publicTest and selfNames come from the
// launchlist config; a gate with no meaning for it reports cannot-check with the reason.
// commitwork (the default) builds from this checkout, with its own tools in the candidate.
//
// env: CW_RELEASE_SOURCE commitwork's source repository (default: this checkout), read at call time
//      CW_LAUNCHLIST_DIR, CW_FLEET_ROOT where a --project's config and repository resolve
//
// exit: 0 accepted · 1 blocked · 2 incomplete (a gate could not run, or was skipped)
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNames, mask, offenderRows, withoutNames } from './lib/release-scope.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { journal } from './lib/verdict-journal-core.mjs';
import { sidecarDir } from './lib/release-reviews.mjs';
import {
  resolveCommit, sourceMeta, extractSnapshot, dateOnlyStamps, commitFreshRoot, blobWitness, stripShas, pruneBaselineShas, swapPublicClaude, regenerateDerived,
  treeTexts, publicEnv, runStep, testCounts, overallVerdict, PUBLIC_CLAUDE, STRIP_TARGETS, STRIP_TARGETS_MD,
} from './lib/release-candidate-core.mjs';
import { loadSpec, loadConfig, loadState, profilesOf, evaluateProject, safeSlug } from '../lib/launchlist.mjs';
import { runChecks } from '../lib/launchlist-checks.mjs';
import { fleetRepos, repoPathFor } from './launchlist.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = 'release-candidate';
export const SELF = 'commitwork';
export const sourceRepo = () => resolve(process.env.CW_RELEASE_SOURCE || REPO);

export function parseArgs(argv) {
  const opts = { project: SELF, ref: 'HEAD', out: null, date: null, message: null, skipTests: false, testTimeoutMin: null, json: false, journalIt: true };
  const value = (i, flag) => { const v = argv[i]; if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--project') opts.project = safeSlug(value(++i, a));
      else if (a === '--ref') opts.ref = value(++i, a);
      else if (a === '--out') opts.out = resolve(value(++i, a));
      else if (a === '--date') opts.date = value(++i, a);
      else if (a === '--message') opts.message = value(++i, a);
      else if (a === '--test-timeout') opts.testTimeoutMin = Number(value(++i, a));
      else if (a === '--skip-tests') opts.skipTests = true;
      else if (a === '--json') opts.json = true;
      else if (a === '--no-journal') opts.journalIt = false;
      else if (a === '--help' || a === '-h') opts.help = true;
      else return { error: `unknown flag: ${a}` };
    }
  } catch (e) { return { error: e.message }; }
  if (opts.testTimeoutMin !== null && !(opts.testTimeoutMin > 0)) return { error: '--test-timeout must be a positive number of minutes' };
  return opts;
}

/**
 * A fleet project's inputs, all from the launchlist config: its repository (`repo` against the fleet
 * root, as `launchlist run` resolves it), its publicTest and its self-names. No config entry aborts
 * the build: a candidate cannot be judged against declarations that do not exist.
 */
export async function projectPlan(project, { config = loadConfig(), fleet = null } = {}) {
  const cfg = (config.projects || {})[project];
  if (!cfg) throw new Error(`no launchlist config for ${project}${config.absent ? ' (the config is absent)' : ''}: its repository, tests and self-names are declared there`);
  const repos = fleet || await fleetRepos();
  const repo = repoPathFor(project, config, repos);
  if (!repo) throw new Error(`${project} has no repository path (config repo, or a fleet registry entry)`);
  return { project, repo: resolve(repo), repoName: basename(repo), cfg, config, fleetNames: repos.map((r) => r.name) };
}

// D25 is commitwork's ruling. Another project ships a public CLAUDE.md only when it carries the
// variant as a file, and the swap never writes through a tracked link.
const SWAP_TOUCHES = Object.freeze([PUBLIC_CLAUDE, 'CLAUDE.md', 'README.md', '.gitattributes']);
export const carriesPublicClaude = (snap) => snap.files.includes(PUBLIC_CLAUDE) && !SWAP_TOUCHES.some((p) => snap.links.includes(p));

export function treeGate(snap, witness) {
  const problems = [...witness, ...snap.links.map((p) => `symlink ${p}`), ...snap.gitlinks.map((p) => `gitlink ${p}`)];
  return { gate: 'tree', status: problems.length ? 'fail' : 'pass', detail: { excluded: snap.excluded, problems: problems.slice(0, 50), problemCount: problems.length } };
}

export function secretsGate(dest, logs, { project = SELF } = {}) {
  const own = project === SELF;
  // Another project's candidate is scanned by this checkout's pre-publish. The sidecar's reviewed
  // dispositions are keyed to commitwork's paths, so none of them settles another project's finding.
  const env = { ...process.env, CW_SECRETS_ROOT: dest, CW_VERDICT_DIR: join(logs, 'verdicts'), CW_SIDECAR: own ? sidecarDir() : join(logs, 'no-reviews') };
  if (!own) delete env.CW_RELEASE_REVIEWS;
  const tool = own ? join(dest, 'bin', 'pre-publish.mjs') : join(REPO, 'bin', 'pre-publish.mjs');
  const r = runStep(process.execPath, [tool, '--json', '--no-journal'], { cwd: dest, env, timeoutMs: 900_000, log: join(logs, 'secrets.json') });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* guard: unparseable is cannot-check */ }
  const status = !out ? 'cannot-check' : r.code === 0 ? 'pass' : r.code === 1 ? 'fail' : 'cannot-check';
  return {
    gate: 'secrets', status,
    detail: out ? { verdict: out.verdict, summary: out.summary, reviews: out.reviews, error: out.error } : { code: r.code, signal: r.signal, error: r.error || r.stderr.slice(0, 400) },
  };
}

export async function identityGate(dest, { selfNames = [] } = {}) {
  const skip = (why) => ({ gate: 'identity', status: 'cannot-check', detail: { error: why } });
  let scan;
  try { scan = await import('./lib/release-names-head-scan.mjs'); } catch (e) {
    return skip(`the name scan cannot load (${e.code || e.message})`);
  }
  if (typeof scan.loadScope !== 'function' || typeof scan.scanEntries !== 'function') {
    return skip('the shared name matcher (loadScope/scanEntries) is not in this tree');
  }
  let full;
  try { full = scan.loadScope(); } catch (e) { return skip(e.message); }
  if (!full) return skip('no sidecar: a candidate cannot be cleared of private names without the private scope');
  // The launchlist's identities check drops the same names: a repository's own name is not a leak in it.
  const scope = withoutNames(full, selfNames);
  const g = identityReport(scan.scanEntries(treeTexts(dest), scope), scope);
  const excluded = full.words.length + full.prefixes.length - scope.words.length - scope.prefixes.length;
  // A count only: the detail is printed and journalled, and a self-name can itself be a scoped name.
  if (excluded) g.detail.selfNamesExcluded = excluded;
  return g;
}

/** The identity gate's verdict. Paths are masked to the source that scopes them and rows carry no
 *  matched text: this detail is printed, journalled, and with the map on CI written to a public log. */
export function identityReport(r, scope) {
  const rows = offenderRows(r.content, scope);
  return {
    gate: 'identity',
    status: r.paths.length || r.content.length ? 'fail' : 'pass',
    detail: {
      scope: scope.fingerprint,
      offendingPaths: r.paths.slice(0, 50).map((p) => mask(p, findNames(p, scope))),
      offendingFiles: r.content.length,
      rows: rows.slice(0, 100),
      rowCount: r.content.reduce((n, c) => n + c.hits.length, 0),
    },
  };
}

// Publication checks that read a live repository or the network describe the project, not the
// candidate, so they stay with `launchlist run`. Every publication check is in exactly one set, and a
// test holds the spec to that.
export const CANDIDATE_CHECKS = Object.freeze([
  'licenceFile', 'licensingDoc', 'copyrightHolders', 'secretsHead', 'identities', 'absolutePaths', 'emails',
  'symlinks', 'binaryAssets', 'agentInstructions', 'siblingRefs', 'readme', 'securityPolicy', 'contributing', 'workflows',
]);
export const PROJECT_CHECKS = Object.freeze({
  githubExposure: 'reads the live GitHub repository',
  packageNames: 'probes the package registries',
  readmeBadges: 'probes the package registries',
  githubSecrets: 'reads the live GitHub repository',
  secretsHistory: 'the candidate has one commit; history is the source repository\'s',
  publicTest: 'the tests gate runs the suite on this candidate',
  dirtyTree: 'the candidate is a fresh commit with no working-tree state',
  originSync: 'the candidate has no origin',
});

async function launchlistContext(project) {
  const spec = loadSpec();
  const config = loadConfig();
  const state = loadState();
  const fleetNames = (await fleetRepos()).map((r) => r.name);
  return { spec, config, state, fleetNames };
}

export async function launchlistGate(dest, { project = SELF, repoName = project, load = launchlistContext, run = runChecks } = {}) {
  const skip = (why) => ({ gate: 'launchlist', status: 'cannot-check', detail: { error: why } });
  let loaded;
  try { loaded = await load(project); } catch (e) { return skip(`the launchlist spec or config cannot load (${e.message})`); }
  const { spec, config, state, fleetNames } = loaded;
  const cfg = (config.projects || {})[project];
  if (!cfg) return skip(`no launchlist config for ${project}: the private store is absent, so the candidate cannot be checked against the project's declarations`);
  const publication = spec.items.filter((it) => it.check && profilesOf(it).includes('publication'));
  const items = publication.filter((it) => CANDIDATE_CHECKS.includes(it.check));
  const notRun = publication.filter((it) => !CANDIDATE_CHECKS.includes(it.check))
    .map((it) => ({ id: it.id, check: it.check, reason: PROJECT_CHECKS[it.check] || 'not declared as a candidate check' }));
  const ctx = { project, repo: dest, repoName, cfg, accounts: config.accounts || {}, fleetNames, flags: { history: false, tests: false } };
  const results = await run(ctx, items);
  // Judged as the launchlist page judges it: a ruled acceptance on the same evidence closes a row.
  const ids = new Set(items.map((it) => it.id));
  const rows = evaluateProject(project, { spec, config, state, results: { results } }).rows
    .filter((r) => ids.has(r.id))
    .map((r) => ({ id: r.id, severity: r.severity, status: r.result.status, done: r.done, accepted: r.accepted, summary: r.result.summary, evidence: (r.result.evidence || []).slice(0, 5) }));
  if (!items.length || rows.length !== items.length) return skip(`${project} does not carry the publication profile, so ${items.length - rows.length} of ${items.length} candidate checks have no row to judge`);
  const blocking = rows.filter((r) => r.severity === 'HARD' && !r.done);
  const status = blocking.some((r) => r.status !== 'unmeasured') ? 'fail' : blocking.length ? 'cannot-check' : 'pass';
  return { gate: 'launchlist', status, detail: { blocking: blocking.map((r) => r.id), rows, notRun } };
}

export function docsGate(dest, logs, { project = SELF } = {}) {
  // docs-doctor enforces commitwork's documentation tiers; no other project has declared that contract.
  if (project !== SELF) return { gate: 'docs', status: 'cannot-check', detail: { error: `no docs freshness contract declared for ${project}` } };
  const env = { ...process.env, CW_DOCS_CACHE: '0', CW_VERDICT_DIR: join(logs, 'verdicts') };
  const r = runStep(process.execPath, [join(dest, 'bin', 'docs-doctor.mjs'), '--json'], { cwd: dest, env, log: join(logs, 'docs.json') });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* guard: unparseable is cannot-check */ }
  if (!out) return { gate: 'docs', status: 'cannot-check', detail: { code: r.code, error: r.error || r.stderr.slice(0, 400) } };
  const tallies = {};
  for (const d of out.docs) tallies[d.status] = (tallies[d.status] || 0) + 1;
  const flagged = out.docs.filter((d) => d.status === 'orange' || d.status === 'grey').map((d) => ({ path: d.path, status: d.status, reasons: d.reasons }));
  const status = r.code === 0 ? 'pass' : r.code === 1 ? 'fail' : 'cannot-check';
  return { gate: 'docs', status, detail: { exit: r.code, tallies, indexFindings: out.indexFindings.length, flagged: flagged.slice(0, 60), flaggedCount: flagged.length } };
}

function testOutcome(r) {
  const text = `${r.stdout}\n${r.stderr}`;
  const failing = [...text.matchAll(/^\s*(?:✖|not ok \d+ -) (.+?)(?: \(\d[\d.]*m?s\))?$/gm)].map((m) => m[1]);
  const status = r.code === 0 ? 'pass' : r.code === null ? 'cannot-check' : 'fail';
  return { status, detail: { exit: r.code, signal: r.signal, ms: r.ms, counts: testCounts(text), failing: [...new Set(failing)].slice(0, 80) } };
}

export function testsGate(dest, scratch, logs, { skip, timeoutMs, project = SELF, publicTest = null }) {
  if (skip) return { gate: 'tests', status: 'not-run', detail: { reason: '--skip-tests' } };
  if (project !== SELF) return projectTestsGate(dest, scratch, logs, { project, t: publicTest, timeoutMs });
  const r = runStep(process.execPath, [join(dest, 'bin', 'test-run.mjs')], { cwd: dest, env: publicEnv(scratch), timeoutMs, log: join(logs, 'tests.log') });
  return { gate: 'tests', ...testOutcome(r) };
}

// The project's declared publicTest, run in the candidate with the allowlisted environment plus what
// the declaration adds. A setup that does not complete leaves the suite unmeasured, not failed.
function projectTestsGate(dest, scratch, logs, { project, t, timeoutMs }) {
  if (!t || !t.cmd) return { gate: 'tests', status: 'cannot-check', detail: { error: `no publicTest declared for ${project} in the launchlist config` } };
  const env = { ...publicEnv(scratch), ...(t.env || {}) };
  const command = [t.cmd, ...(t.args || [])];
  if (t.setup && t.setup.cmd) {
    const s = runStep(t.setup.cmd, t.setup.args || [], { cwd: dest, env, timeoutMs: t.setup.timeoutMs || 900_000, log: join(logs, 'tests-setup.log') });
    if (s.code !== 0) {
      const how = s.code === null ? `did not complete (${s.error || s.signal})` : `exited ${s.code}`;
      return { gate: 'tests', status: 'cannot-check', detail: { command, error: `setup ${t.setup.cmd} ${how}, so the suite did not run`, exit: s.code, signal: s.signal, ms: s.ms } };
    }
  }
  const r = runStep(t.cmd, t.args || [], { cwd: dest, env, timeoutMs, log: join(logs, 'tests.log') });
  const out = testOutcome(r);
  return { gate: 'tests', status: out.status, detail: { command, ...out.detail, ...(r.error ? { error: r.error } : {}) } };
}

function outDir(opts, project = SELF) {
  if (!opts.out) return mkdtempSync(join(tmpdir(), project === SELF ? 'cw-release-candidate-' : `cw-release-candidate-${project}-`));
  if (existsSync(opts.out) && readdirSync(opts.out).length) throw new Error(`--out ${opts.out} is not empty`);
  mkdirSync(opts.out, { recursive: true });
  return opts.out;
}

export async function build(opts) {
  const project = opts.project || SELF;
  const own = project === SELF;
  const plan = own ? null : await projectPlan(project);
  const repo = own ? sourceRepo() : plan.repo;
  const sha = resolveCommit(repo, opts.ref);
  const meta = sourceMeta(repo, sha);
  const base = outDir(opts, project);
  const dest = join(base, project);
  const logs = join(base, 'logs');
  mkdirSync(logs, { recursive: true });

  const snap = extractSnapshot(repo, sha, dest);
  const claude = own || carriesPublicClaude(snap) ? swapPublicClaude(dest) : { changed: [], removed: [] };
  const files = [...new Set([...snap.files.filter((f) => !claude.removed.includes(f)), ...claude.changed])].sort();
  // fs reads and writes through a symlink, so a rewrite of a tracked link would edit its target outside
  // the candidate. The tree gate reports every link; the text transforms touch none.
  const links = new Set(snap.links);
  const editable = files.filter((f) => !links.has(f));
  const stamps = dateOnlyStamps(dest, editable);
  const shas = stripShas(repo, dest, editable, own ? STRIP_TARGETS : STRIP_TARGETS_MD);
  const baseline = own ? pruneBaselineShas(repo, dest, editable) : { changed: [] };
  // The docsite generators are commitwork's code; no other project's code runs before its tests gate.
  const derived = own ? regenerateDerived(dest, files, { redactions: process.env.CW_PUBLISH_REDACTIONS || join(repo, 'monitor', 'private', 'publish-redactions.json') }) : [];
  const transformed = [...new Set([...claude.changed, ...stamps, ...shas.changed, ...baseline.changed, ...derived])];
  // CLAUDE.md is export-ignored and the swap adds it back; the public variant's path ships nowhere.
  const excluded = [...snap.excluded.filter((p) => !claude.changed.includes(p)), ...claude.removed];
  const date = opts.date || process.env.CW_NOW || meta.date;
  const message = opts.message || `${project} ${meta.version ?? ''}`.trim();
  const fresh = commitFreshRoot(dest, { name: meta.name, email: meta.email, date, message });
  const witness = blobWitness(snap.tracked, fresh.entries, transformed, excluded);

  const selfNames = own ? [SELF] : [...(plan.cfg.selfNames || []), project, plan.repoName];
  // One config read per build: the launchlist gate judges against the declarations the source came from.
  const load = own ? undefined : async () => ({ spec: loadSpec(), config: plan.config, state: loadState(), fleetNames: plan.fleetNames });
  const gates = [
    treeGate(snap, witness), secretsGate(dest, logs, { project }), await identityGate(dest, { selfNames }), docsGate(dest, logs, { project }),
    await launchlistGate(dest, { project, repoName: own ? project : plan.repoName, load }),
  ];
  // The scratch HOME must not sit beside the checkout: a parent holding HOME overlaps ~/.ssh, which no
  // real clone outside ~ does, and tests that refuse the checkout's parent would refuse it for that.
  const envScratch = mkdtempSync(join(tmpdir(), own ? 'cw-release-candidate-env-' : `cw-release-candidate-${project}-env-`));
  const publicTest = own ? null : plan.cfg.publicTest || null;
  const timeoutMs = opts.testTimeoutMin != null ? opts.testTimeoutMin * 60_000 : (publicTest && publicTest.timeoutMs) || 45 * 60_000;
  gates.push(testsGate(dest, envScratch, logs, { skip: opts.skipTests, timeoutMs, project, publicTest }));
  const v = overallVerdict(gates);
  // An entry without a project is commitwork's, as every entry was before --project existed.
  return {
    verdict: v.verdict, exit: v.exit, ...(own ? {} : { project }),
    source: { ref: opts.ref, sha, tree: meta.tree, version: meta.version, ...(own ? {} : { repo }) },
    candidate: { path: dest, root: fresh.root, tree: fresh.tree, files: fresh.entries.length, excluded: snap.excluded.length, stampsDateOnly: stamps.length, shasStripped: shas.changed.length, commitsNamed: shas.commits, derivedRegenerated: derived.length, signed: false, date, message,
      ...(own ? {} : { publicClaude: claude.changed.length > 0 }) },
    gates,
  };
}

const HELP = `commitwork release-candidate — the public snapshot of a ref, built and checked

  node bin/release-candidate.mjs [--project <name>] [--ref <rev>] [--out <dir>] [--date <iso>] [--message <text>]
                                 [--skip-tests] [--test-timeout <minutes>] [--json] [--no-journal]

  git archive <ref> (export-ignore applies) -> the public CLAUDE.md swapped in -> verified-against
  stamps made date-only -> cited commit SHAs stripped, derived docsite pages regenerated -> one
  unsigned root commit (author and date from the source commit, so a rebuild is identical) ->
  gates: tree witness, pre-publish with reviewed dispositions, private-name scan, docs-doctor,
  the launchlist's publication content checks, and npm test with an allowlisted environment, a scratch HOME and no sidecar.

  --project <name> builds another fleet repository from its launchlist config (repo, publicTest,
  selfNames). Its candidate is scanned by this checkout's pre-publish with no reviewed dispositions,
  stripped of commit SHAs in .md only, and tested with its publicTest. The docs gate is cannot-check
  (no docs freshness contract declared); the public CLAUDE.md is swapped in only if the project carries one.

  exit: 0 accepted · 1 blocked · 2 incomplete (a gate could not run, or was skipped)`;

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) { process.stderr.write(`${opts.error}\n\n${HELP}\n`); return 2; }
  if (opts.help) { process.stdout.write(`${HELP}\n`); return 0; }

  let report;
  try {
    report = await build(opts);
  } catch (e) {
    report = { verdict: 'incomplete', exit: 2, ...(opts.project !== SELF ? { project: opts.project } : {}), error: `release-candidate aborted: ${e.message}`, gates: [] };
  }
  if (report.candidate) writeFileSync(join(dirname(report.candidate.path), 'release-candidate.json'), `${JSON.stringify(report, null, 2)}\n`);

  if (opts.journalIt) {
    const res = journal(GATE, {
      kind: 'gate', verdict: report.verdict, ...(report.project ? { project: report.project } : {}), source: report.source ?? null, candidate: report.candidate ?? null,
      gates: report.gates.map((g) => ({ gate: g.gate, status: g.status })), error: report.error ?? null,
    }, { session: GATE });
    if (!res.ok) {
      process.stderr.write(`release-candidate: verdict not journalled: ${res.error}\n`);
      if (report.exit === 0) { report.verdict = 'incomplete'; report.exit = 2; }
    }
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.exit;
  }
  const src = report.source;
  const L = [`release-candidate — ${report.project ? `${report.project} ` : ''}${src ? `${src.ref} ${src.sha.slice(0, 12)}${src.version != null ? ` (v${src.version})` : ''}` : '(no source)'}`, ''];
  if (report.error) L.push(`  ERROR  ${report.error}`);
  if (report.candidate) {
    const c = report.candidate;
    if (src && src.repo) L.push(`  source     ${src.repo}`);
    L.push(`  candidate  ${c.path}`);
    L.push(`  root       ${c.root}  tree ${c.tree}`);
    L.push(`  files      ${c.files} (${c.excluded} export-ignored, ${c.stampsDateOnly} stamps made date-only, ${c.shasStripped} files with ${c.commitsNamed} commit SHAs stripped, ${c.derivedRegenerated} derived pages regenerated)`);
    L.push('');
  }
  for (const g of report.gates) L.push(`  ${g.status.padEnd(12)} ${g.gate}${g.detail?.error ? `  — ${g.detail.error}` : ''}`);
  L.push('', `  VERDICT: ${report.verdict}`);
  if (report.candidate) L.push(`  report: ${join(dirname(report.candidate.path), 'release-candidate.json')}`);
  process.stdout.write(`${L.join('\n')}\n`);
  return report.exit;
}

if (isMainModule(import.meta.url)) main().then((code) => { process.exitCode = code; });
