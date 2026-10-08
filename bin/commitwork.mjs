#!/usr/bin/env node
// commitwork — run a repo's GitHub Actions CI locally, without spending Actions minutes.
//
// Driven by a per-repo manifest (see ../schema/manifest.schema.json) that maps each
// workflow to its local-equivalent command(s). Hybrid: most checks run as plain local
// commands; checks with an `act` block can be run faithfully via nektos/act.
//
// Zero runtime dependencies, ESM. The supported Node.js range is package.json `engines.node`.

import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readdirSync, openSync, closeSync, renameSync, realpathSync, fstatSync, readSync } from 'node:fs';
import { redactSnippet } from './lib/pattern-core.mjs';
import { dockerReachable } from '../lib/docker-reachable.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, dirname, isAbsolute, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInto } from '../lib/secrets.mjs';
import { versionsForTools } from '../monitor/tool-version.mjs';
import { resolvePinnedTool, toolEnvVar } from '../lib/cobolwork-resolve.mjs';
import { laneProgress } from '../monitor/lane-progress.mjs'; // per-lane run state for a watching panel
import { containerName, killByPrefix, selfOwner } from '../monitor/containers.mjs'; // a container the runner starts is one it can stop
import { sidecarLockDir } from '../monitor/preflight-build.mjs'; // sidecar lockfile directory per repo
import { shellPlan, posixShellHint, shellDiagnostics } from '../lib/posix-shell.mjs'; // `sh` is absent on stock Windows; resolve it, never assume it
import { killTree, describeKill } from '../lib/proc-tree.mjs'; // kill(-pid) is POSIX-only and was silently a no-op on Windows
import { findGitRepos } from '../lib/repo-walk.mjs'; // GNU `find` is not on Windows; walk in Node instead
import { homedir, tmpdir, cpus, loadavg, totalmem } from 'node:os';
import { ensureFirstRunSetup, runSetup, parseSetupArgs, installHintFor } from './setup.mjs';
import { runInit, parseInitArgs } from './init.mjs';
import { scannerEnv, laneEnv, laneCredentialEnv, laneJavaEnv } from './lib/scanner-env.mjs';
import { scannedGit } from './lib/git-env.mjs';
import { cargoLaneEnv } from './lib/cargo-target.mjs'; // a sweep's cargo lanes build in their own folder, never the shared target-dir
import { applyIsolation, compactBoundaries, containerLaneIsolation, laneBoundary } from './lib/isolation.mjs';
import { hostSandboxArgv, probeHostSandbox, preflightHostSandbox, symlinkReads, targetLoopbackPorts } from './lib/sandbox.mjs';
import { loadProfiles, lanePlan } from '../monitor/perf-tuning.mjs';
import { CHECK_ALIASES } from '../monitor/scanner-checks.mjs';
import { repoLevels } from '../monitor/repo-tuning.mjs';
import { getSetting } from '../monitor/settings.mjs';
import { flagFor, offMessage } from '../lib/feature-flags.mjs';
import { nodeFloorCheck } from '../lib/node-floor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
process.env.CW_ROOT = ROOT; // manifests reference $CW_ROOT so check commands stay machine-portable
const expandHome = (p) => (p && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

// CW_REPORT_DIR is inherited by check subshells whose cwd is the TARGET REPO — a relative
// value would resolve there (or fail its redirect and be swallowed by the checks' `|| true`,
// a silent write-to-void that still reports "pass"). Normalise to absolute + ensure it exists
// BEFORE any check runs, resolved against the caller's cwd.
if (process.env.CW_REPORT_DIR) {
  process.env.CW_REPORT_DIR = resolve(process.env.CW_REPORT_DIR);
  mkdirSync(process.env.CW_REPORT_DIR, { recursive: true });
} else {
  // Unset is worse than relative: "$CW_REPORT_DIR/<file>" becomes "/<file>", the writes fail on a
  // read-only root, `|| true` swallows the error, and the lane reports a pass over zero artifacts.
  //
  // DEFAULT, LOUDLY — do not refuse. Refusing was the first fix and it was wrong: three tests in
  // this repo invoke `run` without the variable, and they passed BECAUSE the writes went to a root
  // they could not reach. That is the tell. The hazard was never "no directory was named", it was
  // "the named directory is unwritable and nobody notices"; a real writable directory removes it
  // entirely, and the artifacts then exist to be classified honestly.
  //
  // The path is printed rather than silently chosen, because evidence nobody can find is the other
  // half of the same failure.
  process.env.CW_REPORT_DIR = mkdtempSync(join(tmpdir(), 'commitwork-report-'));
  console.error(`commitwork: CW_REPORT_DIR was not set — artifacts for this run go to ${process.env.CW_REPORT_DIR}\n`
    + '        (unset, every "$CW_REPORT_DIR/<file>" resolves to the filesystem root, the writes\n'
    + '        fail, and a lane can report a pass over evidence that was never written.)');
}

// ── output theme ─────────────────────────────────────────────────────────────
// Palette and on/off rule live in bin/lib/theme.mjs so the CLI and the panel console render one
// run in one set of colours; ANSI-16 could not tell skipped, noscan and pass apart. The legacy
// names keep their semantic role so the ~50 call sites still read naturally.
import { bold, dim, mut, acc, heading, STATUS, colorEnabled, crit, live, part, high } from './lib/theme.mjs';
// The two axes a check is described with, declared once in monitor/check-vocabulary.mjs. bin/
// already imports monitor/ (deploy.mjs, races.mjs), so this is not a layering violation.
import { CHECK_STATUS, SEVERITY, isCheckStatus, isSeverity, toWireStatus } from '../monitor/check-vocabulary.mjs';
import { readSarif, ruleIndex } from '../monitor/sarif-read.mjs';
import { coverageForLane } from '../monitor/codeql-coverage.mjs';
import { parseSarif } from './lib/report-parsers/sarif.mjs';
import { parseTrufflehog, parseGitleaks, parseBetterleaks, parseWeakRandom } from './lib/report-parsers/secrets.mjs';
import { parseNpmAudit, parseTrivy, parseSbom, parseRetire, parseGradleWrapper, parseScorecard, parseDepscan } from './lib/report-parsers/supply-chain.mjs';
import { parseNuclei, parseSchemathesis, parseTlsHeaders, parseA11y, parseAuthzBola } from './lib/report-parsers/dast.mjs';
import { parseHadolint, parseCspmGithub, parseJacksonGuard } from './lib/report-parsers/posture.mjs';
import { parseRuleCounts, parseBearer, parseShellcheck, parseCobolInventory, parseActionlint } from './lib/report-parsers/sast-lint.mjs';
import { parseMinify } from './lib/report-parsers/tree-contents.mjs';
import { parseSocket } from './lib/report-parsers/socket.mjs'; // the one SARIF reader (guards hoisted from here 2026-08-21)
import { recordRun } from '../monitor/perf-feedback.mjs'; // measured lane cost — the only writer
import { isMainModule } from '../lib/is-main.mjs';
import { useScopedDockerConfig } from '../lib/docker-config.mjs';
import { readScanConfig, gateChecks } from './lib/scan-config.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { buildBrief, renderBriefText, renderBriefMarkdown, renderBriefHtml } from './lib/brief.mjs';
import { writeRunSarif, commitworkVersion, SARIF_FILE } from './lib/sarif-export.mjs';
import { nowISO } from '../lib/clock.mjs';
import { runBriefTui } from './lib/brief-tui.mjs';
import { loadKevCatalog, loadEpssScores } from '../monitor/dep-findings.mjs';
import { resolveScanPath, scanOutDir, discoverPcRepos } from './lib/scan-target.mjs';
import { createInterface } from 'node:readline/promises';
const red = crit;      // failure
const green = live;    // success
const yellow = part;   // skipped / needs attention but expected
const cyan = high;     // noscan — ran, nothing trustworthy came back

function die(msg) {
  console.error(red(`commitwork: ${msg}`));
  process.exit(2);
}

// ── manifest resolution ──────────────────────────────────────────────────────
// Returns { path, source } where source ∈ explicit | bundled | repo-local.
// Provenance matters: manifest commands execute via the shell, so a manifest
// AUTO-DISCOVERED from the target repo (repo-local commitwork.json) is untrusted
// input — running `commitwork` inside a hostile checkout must not be an RCE.
function resolveManifestPath(flagVal) {
  // explicit flag/env wins
  const explicit = flagVal || process.env.COMMITWORK_MANIFEST;
  if (explicit) {
    // allow bare repo name → manifests/<name>.json
    const named = join(ROOT, 'manifests', `${explicit}.json`);
    if (existsSync(named)) return { path: named, source: 'bundled' };
    if (existsSync(explicit)) return { path: resolve(explicit), source: 'explicit' };
    die(`manifest not found: ${explicit}`);
  }
  // a commitwork.json in cwd — repo-local, therefore untrusted by default
  const local = resolve(process.cwd(), 'commitwork.json');
  if (existsSync(local)) return { path: local, source: 'repo-local' };
  die('no manifest given. Use --manifest <path|name>, set COMMITWORK_MANIFEST, or add commitwork.json to the cwd.\n' +
      `Bundled manifests: ${listBundled().join(', ') || '(none)'}`);
}

function listBundled() {
  try {
    return readdirSync(join(ROOT, 'manifests'), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => e.name.replace(/\.json$/, ''))
      .sort();
  } catch { return []; }
}

// ── manifest validation (zero-dep, mirrors schema/manifest.schema.json) ─────
// Structural discipline before anything from the manifest reaches the shell:
// wrong types die; unknown keys warn (forward compat, but visible).
const CHECK_KEYS = new Set(['id', 'timeoutSec', 'description', 'workflow', 'local', 'act', 'requires', 'report',
  'appliesIfExists', 'appliesIfGit', 'requiresUrl', 'producesIfExists', 'groups', 'skipsOnGitHub', 'notes',
  'remediationPrompt', // the per-check LLM fix prompt, used on every check — was warning as unknown
  'formatNotes', // scanner-specific FORMAT FACTS composed into every triage handoff (measured
  // 2026-08-03: engines invented .gitleaksignore syntax the prompt never showed them)
  // scopeNotes: the bound keys the command is expected to imply, cross-checked by
  // monitor/scan-scope.mjs against what it derives. Derivation alone fails silently (a bound that
  // stops matching just stops being disclosed); disagreement either way yields known:false.
  'scopeNotes',
  // coverageSignals: patterns in this check's log meaning a LANE of it did not run, even though the
  // tool exited 0 — the only way to catch a capability that died quietly (osv-scanner emits 11 real
  // results and logs "Skipping call analysis on Go code since Go is not installed"). Declared here
  // AND in schema/manifest.schema.json because this repo validates manifests twice, by two
  // mechanisms with separate key lists: the JSON Schema alone lets a key through as an "unknown key"
  // warning that cra/test/cra.test.mjs fails on. Adding a check key means both places.
  'coverageSignals',
  'executesRepoCode', // guard: unsandboxed repo-code lanes report reduced coverage
  'requiresRepoTrust', // the command runs a script the scanned tree supplies: runs only with --trust-repo-manifest
  'egress', 'sandboxExtraReads', 'sandboxExtraWrites', // the host sandbox posture, declared per lane
  // appliesIfSourceExt: the check applies when a SOURCE FILE with one of these extensions exists in
  // the tree (bounded walk, vendored/build dirs skipped). Exists because appliesIfExists was the
  // wrong proxy for CodeQL: it gated on package.json/build.gradle/pom.xml, but the JS extractor
  // needs JS/TS SOURCES, not a build manifest — four fleet projects all carry JS and no
  // package.json anywhere, so the fleet's only public project sat CodeQL-VOID behind an n/a that
  // was measuring the wrong thing (VOID-SPLIT-2026-08-02).
  'appliesIfSourceExt',
  // aliasOf: this check is a SECOND DECLARATION of another manifest's check — the same helper against
  // the same target writing the same artifact, under a different id. Declared so the rollup can credit
  // one run to one category instead of the panel showing a live scanner's numbers beside its twin's
  // "no live counts"; monitor/scanner-checks.mjs holds the map and its test asserts the two agree.
  'aliasOf',
  // containment: a lane's exclusion from a group as data, { excludedFrom, reason, reviewBy }, not
  // prose. A formatNotes sentence once claimed "deep only" while groups said ["all","deep"], and
  // three sweeps ran third-party build tooling. bin/test/build-mode-containment.test.mjs checks the
  // declaration against the command-derived predicate in both directions; reviewBy stops a
  // containment outliving its judgement.
  'containment']);
const TOP_KEYS = new Set(['$schema', 'repo', 'repoPath', 'groups', 'checks', 'note', 'title', 'images']); // mirror of schema/manifest.schema.json properties
// Formats parseReport handles specially + the pass-through ones bundled manifests use.
// Unknown formats fall through to parseReport's generic branch, so they warn, never die.
const REPORT_FORMATS = new Set(['sarif', 'trufflehog', 'npm-audit', 'sbom', 'json', 'text',
  'trivy', 'gitleaks', 'betterleaks', 'retire', 'socket', 'hadolint', 'nuclei', 'generic', 'config',
  'schemathesis', 'tls-headers', 'cspm-github', 'scorecard', 'depscan', 'gradle-wrapper', 'authz-bola', 'a11y', 'actionlint', 'shellcheck', 'minify', 'bearer', 'weak-random', 'rule-counts',
  'cobol-inventory', 'jackson-guard']);
// Handler lint (F8): a declared format is PARSED (a parseReport branch derives severity),
// PASSTHROUGH (presence is the only signal, by design), or silent-bug (neither: it hits the generic
// branch and scores green regardless of contents). Keep PARSED_FORMATS in lockstep with the
// `if (format === …)` branches below.
export const PARSED_FORMATS = new Set(['sarif', 'trufflehog', 'npm-audit', 'trivy', 'sbom', 'gitleaks', 'betterleaks', 'retire', 'hadolint', 'socket', 'nuclei',
  'schemathesis', 'tls-headers', 'cspm-github', 'scorecard', 'depscan', 'gradle-wrapper', 'authz-bola', 'a11y', 'actionlint', 'shellcheck', 'minify', 'bearer', 'weak-random', 'rule-counts',
  'cobol-inventory', 'jackson-guard']);
export const PASSTHROUGH_FORMATS = new Set(['json', 'text', 'generic', 'config']);
const isStr = (v) => typeof v === 'string';
const isStrArr = (v) => Array.isArray(v) && v.every(isStr);

export function validateManifest(m, path) {
  const errors = [], warnings = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push('manifest is not an object'); return { errors, warnings }; }
  for (const k of Object.keys(m)) if (!TOP_KEYS.has(k)) warnings.push(`unknown top-level key: ${k}`);
  if (!isStr(m.repo) || !m.repo.trim()) errors.push('repo (string) is required');
  if (m.repoPath !== undefined && !isStr(m.repoPath)) errors.push('repoPath must be a string');
  if (m.groups !== undefined) {
    if (!m.groups || typeof m.groups !== 'object' || Array.isArray(m.groups)) errors.push('groups must be an object of string arrays');
    else for (const [g, ids] of Object.entries(m.groups)) if (!isStrArr(ids)) errors.push(`groups.${g} must be an array of check ids`);
  }
  if (!Array.isArray(m.checks)) { errors.push('checks[] (array) is required'); return { errors, warnings }; }
  const seen = new Set();
  m.checks.forEach((c, i) => {
    const at = `checks[${i}]`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(`${at} is not an object`); return; }
    for (const k of Object.keys(c)) if (!CHECK_KEYS.has(k)) warnings.push(`${at} (${c.id || '?'}): unknown key ${k}`);
    if (!isStr(c.id) || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) errors.push(`${at}: id must match ^[a-z0-9][a-z0-9-]*$`);
    else if (seen.has(c.id)) errors.push(`${at}: duplicate check id '${c.id}'`);
    else seen.add(c.id);
    if (!isStrArr(c.local)) errors.push(`${at} (${c.id || '?'}): local must be an array of command strings`);
    else if (c.local.some((s) => !s.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s))) {
      errors.push(`${at} (${c.id || '?'}): local commands must be non-empty and free of control characters`);
    }
    // coverageSignals — REJECTED AT INGEST, NEVER TRUNCATED AT RENDER.
    //
    // `lane` is manifest-supplied free text that becomes coverageReason and travels to three sinks:
    // the panel (HTML), the MCP payload (JSON), and index.md (Markdown). A repo-local commitwork.json
    // is untrusted input — assertManifestTrusted() refuses to EXECUTE its commands without explicit
    // consent — but that gate is drawn at execution, and this field crosses it as data. Every sink
    // escapes for itself; this is the bound behind that, so a hostile lane never enters the store.
    //
    // Bounded here rather than clipped later on purpose. coverageReason's entire job is to NAME the
    // capability that was lost, so a silently shortened lane is a coverage report that no longer
    // identifies what is missing — trading an injection risk for an honesty one. A manifest that
    // declares an unusable lane is a manifest bug, and it gets an error at load, where it is fixable.
    if (c.coverageSignals !== undefined) {
      if (!Array.isArray(c.coverageSignals)) errors.push(`${at} (${c.id || '?'}): coverageSignals must be an array`);
      else c.coverageSignals.forEach((s, j) => {
        const sat = `${at} (${c.id || '?'}) coverageSignals[${j}]`;
        if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`${sat} is not an object`); return; }
        if (!isStr(s.pattern) || !s.pattern.trim()) errors.push(`${sat}: pattern must be a non-empty string`);
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- this is the load-time validity check of a manifest-declared pattern; it only compiles, never matches input
        else { try { new RegExp(s.pattern); } catch (e) { errors.push(`${sat}: pattern is not a valid regex (${e.message})`); } }
        // A LABEL, NOT PROSE. Letters, digits, space and a few separators — enough for "Go call
        // analysis" and nothing that means anything to HTML, Markdown or a shell.
        if (!isStr(s.lane) || !s.lane.trim()) errors.push(`${sat}: lane must be a non-empty string naming the lost capability`);
        else if (s.lane.length > 60) errors.push(`${sat}: lane must be at most 60 characters (it is a label, not a description)`);
        else if (!/^[A-Za-z0-9 ._/()+-]+$/.test(s.lane)) errors.push(`${sat}: lane may contain only letters, digits, space and . _ / ( ) + - — got ${JSON.stringify(s.lane)}`);
        if (!c.report || !c.report.log) warnings.push(`${sat}: declared but the check has no report.log to read, so it can never match`);
      });
    }
    if (c.requires !== undefined) {
      const r = c.requires;
      if (!r || typeof r !== 'object' || Array.isArray(r)) errors.push(`${at}: requires must be an object`);
      else {
        for (const k of ['tools', 'secrets', 'services']) if (r[k] !== undefined && !isStrArr(r[k])) errors.push(`${at}: requires.${k} must be an array of strings`);
        if (r.docker !== undefined && typeof r.docker !== 'boolean') errors.push(`${at}: requires.docker must be a boolean`);
      }
    }
    if (c.report !== undefined) {
      if (!c.report || typeof c.report !== 'object') errors.push(`${at}: report must be an object`);
      else {
        if (!isStr(c.report.file) || c.report.file.includes('..') || isAbsolute(c.report.file)) errors.push(`${at}: report.file must be a relative filename without ..`);
        if (!isStr(c.report.format) || !c.report.format.trim()) errors.push(`${at}: report.format must be a non-empty string`);
        else if (!REPORT_FORMATS.has(c.report.format)) warnings.push(`${at} (${c.id || '?'}): report.format '${c.report.format}' not in the known set — parsed generically`);
        // F8: a format with no handler and no pass-through declaration scores green regardless of
        // contents, the bug that hid gitleaks findings. A warning, not an error, so the shipping
        // manifest validates before every handler exists.
        else if (!PARSED_FORMATS.has(c.report.format) && !PASSTHROUGH_FORMATS.has(c.report.format)) {
          warnings.push(`${at} (${c.id || '?'}): report.format '${c.report.format}' has no parseReport handler and is not a declared pass-through — it scores GREEN regardless of findings (silent-green). Add a parseReport handler, then PARSED_FORMATS; or declare it a pass-through.`);
        }
      }
    }
    for (const k of ['appliesIfExists', 'appliesIfSourceExt', 'producesIfExists', 'groups', 'skipsOnGitHub']) {
      if (c[k] !== undefined && !isStrArr(c[k])) errors.push(`${at}: ${k} must be an array of strings`);
    }
    for (const k of ['appliesIfGit', 'requiresUrl', 'requiresRepoTrust']) {
      if (c[k] !== undefined && typeof c[k] !== 'boolean') errors.push(`${at}: ${k} must be a boolean`);
    }
  });
  return { errors, warnings };
}

function loadManifest(path) {
  let m;
  try { m = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { die(`could not parse manifest ${path}: ${e.message}`); }
  const { errors, warnings } = validateManifest(m, path);
  for (const w of warnings) console.error(yellow(`manifest warning: ${w}`));
  if (errors.length) die(`invalid manifest ${path}:\n  - ${errors.join('\n  - ')}`);
  return m;
}

/** The operator's consent to execute or be steered by repo-supplied content. Env read at call time. */
export function repoTrusted(opts) {
  return !!(opts && opts.trustRepoManifest) || process.env.COMMITWORK_TRUST_REPO_MANIFEST === '1';
}

// Commands from a repo-local manifest run only with explicit consent.
function assertManifestTrusted(source, path, opts) {
  if (source !== 'repo-local') return;
  if (repoTrusted(opts)) return;
  die(`refusing to execute commands from repo-local manifest ${path}\n` +
      `  A commitwork.json inside the target repo is untrusted input (arbitrary shell).\n` +
      `  Inspect it first:  commitwork run all --dry-run\n` +
      `  Then opt in with:  --trust-repo-manifest   (or COMMITWORK_TRUST_REPO_MANIFEST=1)`);
}

function repoPathFor(manifest, flagVal) {
  const p = expandHome(flagVal || process.env.COMMITWORK_REPO || manifest.repoPath || process.cwd());
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  if (!existsSync(abs)) die(`repoPath does not exist: ${abs}`);
  return abs;
}

// ── requirement gating ───────────────────────────────────────────────────────
// Tools whose presence on PATH does not mean they WORK, so the probe runs them.
//
// macOS ships /usr/bin/java as a stub that exists, is executable, and exits 1 with "Unable to
// locate a Java Runtime" when no JDK is installed. `command -v java` therefore succeeded on a box
// with no JVM at all, sast-codeql-java was declared applicable, CodeQL's extractor indexed zero
// files, and all 20 in-scope clientA services recorded `noscan — no output (tool absent/failed)`
// (measured 2026-08-01). The distinction matters to whoever reads it: a noscan says the scanner
// broke, a blocked void naming tool:java says install a JDK.
//
// Kept to a NAMED SET rather than probing everything: running an arbitrary scanner binary to see
// whether it works costs a process spawn per check per repo, and for most tools existence really is
// the answer. Each entry is a cheap, side-effect-free version flag.
const RUN_PROBE = Object.freeze({ java: ['-version'] });

function hasTool(name) {
  // `sh -c 'command -v "$1"' sh <name>` — passes name as $1 (no shell interpolation).
  const r = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', name], { stdio: 'ignore' });
  if (r.status !== 0) return false;
  const probe = RUN_PROBE[name];
  if (!probe) return true;
  // argv array, never a shell string; the tool name is a manifest-declared key of RUN_PROBE, so
  // nothing caller-supplied reaches a command line here either.
  const p = spawnSync(name, probe, { stdio: 'ignore', timeout: 20_000 });
  return p.status === 0;
}

// Warn ONCE per process if the perf-feedback log cannot be written. A per-lane warning on a 34-lane
// sweep would be 34 identical lines and would train the operator to skip them.
let perfFeedbackWarned = false;

// An absent env var is null, never 0 — and an unparseable one is null too, never a silent 0 that
// would read as "depth 0" in the tuning history.
function numEnv(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

let _dockerUp = null;
function dockerUp() {
  if (_dockerUp === null) {
    _dockerUp = dockerReachable();
  }
  return _dockerUp;
}

// ── SECRETS: a missing CREDENTIAL is not a broken TOOL ──────────────────────────────────────
// supply-chain-socket reported `noscan — socket did not run — Input error` on 23 of 24 areas. The
// tool was fine; it has no API token, so it cannot resolve an org. That read identically to
// CodeQL's missing query pack, which was a completely different failure — and both read as
// "the scanner ran and found nothing to say". A credential gap must name itself.
//
// `requires.secrets` already existed and was checked against process.env + repoPath/.env only,
// which cannot see a keychain-held credential. So a declared secret is now satisfied by EITHER,
// and when it resolves from the keychain the value is handed to THAT CHECK's command and nowhere
// else — not merged into process.env, where every other check and every spawned scanner would
// inherit a token none of them need.
function secretsFor(check, envKeys) {
  const names = (check.requires || {}).secrets || [];
  if (!names.length) return { env: {}, missing: [] };
  const need = names.filter((n) => !envKeys.has(n));
  if (!need.length) return { env: {}, missing: [] };
  let r;
  try { r = resolveInto(need, { env: {} }); }
  catch (e) { return { env: {}, missing: need.map((n) => `secret:${n} (secrets table unreadable: ${e.message})`) }; }
  const env = {};
  for (const { name } of r.resolved) env[name] = r.env[name];
  // the REASON travels: 'not-found' (never stored), 'locked' (a headless run cannot answer a
  // keychain prompt) and 'undeclared' (no ref recorded) demand different actions from the operator.
  return { env, missing: r.missing.map((m) => `secret:${m.name} (${m.reason})`) };
}

function readEnvKeys(repoPath) {
  const keys = new Set(Object.keys(process.env).filter((k) => process.env[k]));
  const envFile = join(repoPath, '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && m[2] && !/^(""|'')$/.test(m[2])) keys.add(m[1]);
    }
  }
  return keys;
}

// Returns { ok, missing: [..reasons], secretEnv, toolEnv, toolsMissing }
// A pinned tool (lib/cobolwork-resolve.mjs) is never looked up on PATH: the lane reads the resolved
// executable from CW_TOOL_<NAME>, and an unresolved one is named with the resolver's reason.
// toolsMissing lists every required tool that did not resolve, pinned or on PATH.
function evalRequirements(check, repoPath, envKeys) {
  const req = check.requires || {};
  const missing = [], toolsMissing = [], toolEnv = {};
  for (const t of req.tools || []) {
    const pinned = resolvePinnedTool(t);
    if (!pinned) {
      if (!hasTool(t)) { missing.push(`tool:${t} (${RUN_PROBE[t] ? 'not on PATH, or does not run' : 'not on PATH'})`); toolsMissing.push(t); }
      continue;
    }
    if (pinned.ok) toolEnv[toolEnvVar(t)] = pinned.path;
    else { missing.push(`tool:${t} (${pinned.reason})`); toolsMissing.push(t); }
  }
  if (req.docker && !dockerUp()) missing.push('docker daemon not running');
  const sec = secretsFor(check, envKeys);
  missing.push(...sec.missing);
  return { ok: missing.length === 0, missing, secretEnv: sec.env, toolEnv, toolsMissing };
}

// ── check selection ──────────────────────────────────────────────────────────
// GROUP MEMBERSHIP IS DECLARED IN TWO PLACES, so it is resolved as their UNION.
//
// A manifest can put a check in a group two ways: the top-level `groups` map lists ids, and each
// check may tag itself with `groups: [...]`. The per-check tags used to be a FALLBACK — consulted
// only when the map had no entry for the target — so for any group the map named, they were dead.
// Both files drifted, silently and in the direction that loses work. Measured on
// manifests/security-baseline.json, 2026-08-20:
//
//   all   map 31 · own 33 — `deno-lint`, `deno-check`, `jackson-caseinsensitive-guard` tag
//                           themselves into it and appear in no map, so they were unreachable
//                           from EVERY group and could never run in any sweep
//   fast  map  5 · own  9 — the same three, plus actions-zizmor (which runs anyway, via `all`)
//   supply-chain map 10 · own 6 — five checks are in the map without tagging themselves
//
// That last row is why this is a union and not a switch to the tags: deriving from tags alone would
// silently drop deps-osv, npm-audit, yarn-audit, sbom and sbom-syft out of supply-chain, trading one
// invisible loss for another. The union is the only combination under which no check LOSES a group.
// Map order first (it is curated — the fast group is ordered by cost), then tagged extras in
// declaration order, deduped by id.
export function groupMembers(manifest, target) {
  const byId = new Map(manifest.checks.map((c) => [c.id, c]));
  const out = [], seen = new Set();
  for (const id of manifest.groups?.[target] || []) {
    const c = byId.get(id);
    if (c && !seen.has(id)) { seen.add(id); out.push(c); }
  }
  for (const c of manifest.checks) {
    if ((c.groups || []).includes(target) && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
  }
  return out;
}

export function selectChecks(manifest, target) {
  const byId = new Map(manifest.checks.map((c) => [c.id, c]));
  if (!target || target === 'all') {
    const grp = groupMembers(manifest, 'all');
    return grp.length ? grp : manifest.checks;
  }
  if (byId.has(target)) return [byId.get(target)];
  const tagged = groupMembers(manifest, target);
  if (tagged.length) return tagged;
  die(`unknown check or group: ${target}\n` +
      `checks: ${manifest.checks.map((c) => c.id).join(', ')}\n` +
      `groups: ${Object.keys(manifest.groups || {}).join(', ')}`);
}

// ── commands ─────────────────────────────────────────────────────────────────
// A check's wall-clock bound. Manifest `timeoutSec` per check, else CW_CHECK_TIMEOUT_SEC, else
// 1800 s — above every lane's measured maximum on the 100-repo corpus except the two that declare
// their own (deps-reachability 1981 s, posture-scorecard 1352 s; sweep-20260822153004, 51 repos).
// Read at call time, never at import.
export function checkTimeoutSec(check) {
  const own = Number(check && check.timeoutSec);
  if (Number.isFinite(own) && own > 0) return own;
  const env = Number(process.env.CW_CHECK_TIMEOUT_SEC);
  return Number.isFinite(env) && env > 0 ? env : 1800;
}

// Runs one manifest command, BOUNDED. Before this there was no timeout at all: deps-osv on
// 1Panel sat 32,005 s inside `docker pull` and held a 100-repo sweep for 8.9 h with no alarm.
//
// Killing `sh` is not enough — `docker run` is a client, and the container it started keeps
// running on the daemon with the source mounted and the report dir writable. So the child is
// spawned detached (its own process group, killed whole), and every container this check
// started is named cw-<slice>-<repo>-<check>[-suffix] via CW_CONTAINER_NAME and removed by prefix.
function runShell(cmd, cwd, extraEnv = null, bound = null) {
  // sh -c argv-array (not shell:true string) — the manifest cmd is still an intentional
  // shell one-liner, but it's now passed as a bounded argument, not interpolated into a
  // parent shell command line, closing the injection footgun in the string-through-shell form.
  //
  // The SHELL ITSELF is resolved rather than assumed. `sh` is absent from PATH on a stock
  // Windows 11 box (measured 2026-09-04), and this function used to spawn it unconditionally:
  // spawnSync then set r.error.code = 'ENOENT' with r.status === null, only ETIMEDOUT was
  // inspected, and the ENOENT fell through to `ok: r.status === 0` — false, with NO REASON. Every
  // local check on Windows became an unexplained failure shaped exactly like a real non-zero exit.
  // lib/posix-shell.mjs finds the bash.exe that ships inside the Git for Windows install which
  // commitwork already hard-requires, so a standard box needs nothing extra; and when there is
  // genuinely no shell it says so, once, in words naming the one action that clears it.
  //
  // extraEnv carries this check's resolved secrets and is scoped to this spawn: the value reaches
  // the command that declared it and no other. It is never echoed — `$ cmd` is printed, the
  // environment is not.
  // A lane's base env is chosen by the check (scanner-env.mjs laneEnv); a bound with no check keeps the denylist.
  const env = { ...(bound && bound.check ? laneEnv(bound.check, process.env) : scannerEnv(process.env)), ...(extraEnv || {}) };
  // CW_CONTAINER_OWNER labels every container the lane starts with THIS process, overriding one
  // inherited from a parent run, so a sweep spares them while this run lives and reaps them after.
  env.CW_CONTAINER_OWNER = selfOwner();
  const timeoutSec = bound && bound.timeoutSec;
  const plan = shellPlan(cmd);
  if (plan.kind === 'no-shell') return { ok: false, timedOut: false, noShell: true, reason: plan.reason };
  // The host sandbox exists only on darwin and linux, where it always runs the command under sh.
  let argv = plan.argv;
  if (bound && bound.sandbox) {
    Object.assign(env, bound.sandboxEnv || {});
    try { argv = hostSandboxArgv({ ...bound.sandbox, cmd }).argv; } catch (e) { return { ok: false, timedOut: false, refused: `host sandbox refused: ${e.message}` }; }
  }
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd, stdio: bound && bound.quiet ? 'ignore' : 'inherit', env, detached: true,
    ...(timeoutSec ? { timeout: timeoutSec * 1000, killSignal: 'SIGKILL' } : {}),
  });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    // Platform-aware: the negative-pid group kill this used to do is a POSIX-only convention that
    // throws on Windows, where it was swallowed by a bare catch and the children ran on. The
    // outcome is now RETURNED, because a timeout record claiming a clean kill while a scanner is
    // still writing into the report directory is a false statement nothing else contradicts.
    const kill = r.pid ? killTree(r.pid) : { ok: false, survived: true, error: 'no pid' };
    const containers = bound && bound.containerPrefix ? killByPrefix(bound.containerPrefix) : null;
    return { ok: false, timedOut: true, timeoutSec, containers, kill };
  }
  // An ENOENT/EACCES on the shell or the argv-direct target is a PREREQUISITE fault, not a check
  // result. Only `r.status` being a number means the command actually ran.
  if (r.error) {
    const code = r.error.code || r.error.message;
    // The wrapper was probed and preflighted for this lane, so failing to start it now is a
    // refusal of the lane, not a missing prerequisite of the command.
    if (argv !== plan.argv) return { ok: false, timedOut: false, refused: `host sandbox ${argv[0]} could not be executed (${code}), so the lane did not run` };
    return { ok: false, timedOut: false, noShell: true,
      reason: plan.kind === 'shell'
        ? `the resolved POSIX shell ${argv[0]} could not be executed (${code}) — ${posixShellHint()}`
        : `${argv[0]} could not be executed (${code}) — the command is not installed or not on PATH` };
  }
  return { ok: r.status === 0, timedOut: false, status: r.status };
}

// What a timed-out check leaves on disk must not be mistaken for a scan: the report (if any) is
// set aside as <file>.killed and the exit witness records 124, so emptyClean's second-witness
// rule sees a kill, not a clean-and-empty run.
function quarantineKilledReport(check) {
  const dir = process.env.CW_REPORT_DIR;
  if (!dir || !check.report || !check.report.file) return;
  const f = join(dir, check.report.file);
  try { if (existsSync(f)) renameSync(f, `${f}.killed`); } catch { /* best effort */ }
  try { writeFileSync(`${f}.exit`, '124\n'); } catch { /* best effort */ }
}

// ── HOST SANDBOX: decided once per lane, and its absence is always written on the row ──────────
let sandboxNoticed = false;
const sandboxNotice = (msg) => { if (sandboxNoticed) return; sandboxNoticed = true; console.error(yellow(`  (host sandbox: ${msg})`)); };

// A docker lane is declared twice, in perf-profiles.json (`container: true`) and in the check's own
// `requires`; bin/test/manifest-egress.test.mjs holds both against the command text.
function isContainerLane(check) {
  if (check.requires?.docker === true || (check.requires?.tools || []).includes('docker')) return true;
  try { return loadProfiles().scanners?.[check.id]?.container === true; } catch { return false; }
}

const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };

// fact: a tool prefix is dirname(dirname(realpath)) and never `/` or the home directory / bash resolves to /bin/bash, whose grandparent is the filesystem root (expiry: never, prev: not built)
export function toolPrefixes(check, home) {
  const out = [];
  for (const t of check.requires?.tools || []) {
    // A pinned tool is readable where it resolves: its install directory, or the override it names.
    const pinned = resolvePinnedTool(t);
    if (pinned && !pinned.ok) continue;
    if (pinned && pinned.dir) { out.push(realOr(pinned.dir)); continue; }
    const named = pinned ? pinned.path : t;
    let p = named;
    if (!named.includes('/')) {
      const r = spawnSync('sh', ['-c', 'command -v "$1"', 'sh', named], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (r.status !== 0) continue;
      p = (r.stdout || '').trim();
    }
    if (!p.startsWith('/')) continue;
    const real = realOr(p);
    const prefix = dirname(dirname(real));
    out.push(prefix === '/' || prefix === home ? dirname(real) : prefix);
  }
  return [...new Set(out)];
}

// fact: a linked worktree's `.git` is a FILE naming a gitdir under another checkout, and that checkout's commondir holds the objects / commit-provenance on a worktree died at "not a git repository" under a profile that allowed the tree (expiry: never, prev: broken)
export function linkedGitDirs(repoPath) {
  const out = [];
  try {
    const dotGit = join(repoPath, '.git');
    const head = readFileSync(dotGit, 'utf8');
    const m = /^gitdir:\s*(.+)\s*$/m.exec(head);
    if (!m) return out;
    const gitdir = realOr(resolve(repoPath, m[1].trim()));
    out.push(gitdir);
    try {
      const common = readFileSync(join(gitdir, 'commondir'), 'utf8').trim();
      if (common) out.push(realOr(resolve(gitdir, common)));
    } catch { /* a bare gitdir has no commondir */ }
  } catch { /* a directory .git, or no .git at all, needs nothing beyond the tree */ }
  return out;
}

// fact: a networked lane reads the scoped docker config / trivy's OCI client opens $DOCKER_CONFIG/config.json before it downloads its vulnerability DB and died at "operation not permitted", so deps-jvm wrote nothing under the registry profile, measured 2026-10-04 (expiry: never, prev: broken)
export const scopedDockerReads = (check, env = process.env) => (check.egress && check.egress !== 'none' && env.DOCKER_CONFIG ? [env.DOCKER_CONFIG] : []);

function hostSandboxFor(check, repoPath, reportDir, laneWrites = [], targetEnv = process.env) {
  if (process.env.CW_SANDBOX === 'off') {
    sandboxNotice('CW_SANDBOX=off; every lane runs unconfined and each row says so');
    return { wrap: null, isolation: 'none', isolationReason: 'CW_SANDBOX=off: host sandbox disabled by the operator' };
  }
  if (isContainerLane(check)) return { wrap: null, ...containerLaneIsolation(check) };
  // fact: CW_SANDBOX=require refuses, as noscan, any host lane the sandbox cannot confine / the container image sets it, so a runtime that withholds user namespaces stops lanes rather than running them unconfined (expiry: never, prev: missing)
  const required = process.env.CW_SANDBOX === 'require';
  if (!check.egress) {
    if (required) return { refused: 'CW_SANDBOX=require and the check declares no egress class, so the lane did not run' };
    return { wrap: null, isolation: 'none', isolationReason: 'check declares no egress class; ran unconfined rather than under a guessed one' };
  }
  const probe = probeHostSandbox();
  if (!probe.available && required) {
    sandboxNotice(`${probe.why}; CW_SANDBOX=require, so every host lane is refused as noscan`);
    return { refused: `CW_SANDBOX=require and the host sandbox is unavailable, so the lane did not run: ${probe.why}` };
  }
  if (!probe.available) {
    sandboxNotice(`${probe.why}; every lane runs unconfined and each row says so`);
    return { wrap: null, isolation: 'none', isolationReason: `host sandbox unavailable: ${probe.why}` };
  }
  try {
    const home = homedir();
    const links = symlinkReads(realOr(repoPath), check.sandboxExtraReads || [], { home });
    const javaEnv = laneJavaEnv(check, process.env, javaHome);
    const spec = {
      egress: check.egress, repoPath: realOr(repoPath), reportDir: realOr(reportDir), platform: process.platform,
      cwRoot: realOr(ROOT), nodePrefix: dirname(dirname(realOr(process.execPath))), tmpDir: realOr(tmpdir()), home,
      developerDir: probe.developerDir, toolPrefixes: toolPrefixes(check, home), userCacheDir: darwinUserCacheDir(),
      extraReads: [...linkedGitDirs(realOr(repoPath)), ...links.reads, ...(check.sandboxExtraReads || []), ...scopedDockerReads(check),
        ...(javaEnv.JAVA_HOME ? [realOr(javaEnv.JAVA_HOME)] : [])],
      extraWrites: [...(check.sandboxExtraWrites || []), ...laneWrites],
      loopbackPorts: check.egress === 'target' ? targetLoopbackPorts(targetEnv) : [],
    };
    const wrap = hostSandboxArgv({ ...spec, cmd: 'exit 0' });
    const pre = preflightHostSandbox(wrap);
    if (!pre.ok) return { refused: `host sandbox profile could not be applied, so the lane did not run: ${pre.why}` };
    const isolationReason = links.refused.length ? `symlink target(s) not made readable: ${links.refused.join('; ')}` : null;
    return { wrap: spec, env: { ...laneCredentialEnv(check, process.env, ghAuthToken), ...javaEnv }, isolation: wrap.isolation, isolationReason };
  } catch (e) {
    return { refused: `host sandbox refused, so the lane did not run: ${e.message}` };
  }
}

const darwinUserCacheDir = () => {
  if (process.platform !== 'darwin') return null;
  const r = spawnSync('getconf', ['DARWIN_USER_CACHE_DIR'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  const dir = r.status === 0 ? (r.stdout || '').trim().replace(/\/+$/, '') : '';
  return dir.startsWith('/') ? realOr(dir) : null;
};

const javaHome = () => {
  if (process.platform !== 'darwin') return '';
  const r = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  return r.status === 0 && (r.stdout || '').trim().startsWith('/') ? r.stdout.trim() : '';
};

const ghAuthToken = () => {
  const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
  return r.status === 0 ? (r.stdout || '').trim() : '';
};

const withBoundary = (res, sb) => (sb && sb.boundary ? { ...res, boundary: sb.boundary } : res);
const withIsolation = (res, sb) => withBoundary({ ...res, isolation: sb ? sb.isolation : 'none', ...(sb && sb.isolationReason ? { isolationReason: sb.isolationReason } : {}) }, sb);

// A lane that matches the repo and cannot run because a tool it requires is absent. It is a void
// one install clears, never an n/a: the rollup counts n/a as a correct exclusion, and that reads an
// uninstalled scanner as a repo with nothing for it to scan.
function toolVoid(check, reason) {
  return { id: check.id, status: 'noscan', blocked: true, blockedReason: reason, reason,
    coverage: 'unknown', coverageReason: 'the lane never ran: a tool it requires is not installed' };
}

export const UNTRUSTED_SCRIPT_REASON = 'repo-supplied script; pass --trust-repo-manifest to run it';

/** A bundled lane whose command runs a script the scanned tree ships (`requiresRepoTrust`) is held
 *  without consent. It is a void, never a pass and never a finding: the script did not run. */
export function untrustedScriptVoid(check) {
  return { id: check.id, status: 'noscan', reason: UNTRUSTED_SCRIPT_REASON, durationMs: null, isolation: 'none',
    coverage: 'unknown', coverageReason: 'the lane did not run — coverage could not be established',
    coverageBasis: 'untrusted-repo-script' };
}

function refusedResult(check, reason) {
  return { id: check.id, status: 'noscan', reason, isolation: 'none', coverage: 'unknown', coverageReason: 'the lane never ran' };
}

function timedOutResult(check, r) {
  return {
    id: check.id, status: 'noscan', timedOut: true,
    reason: `exceeded ${r.timeoutSec}s and was killed — a truncated analysis is not a clean one (raise timeoutSec on this check in the manifest, or CW_CHECK_TIMEOUT_SEC)`
      + (r.containers && r.containers.killed.length ? `; removed container(s) ${r.containers.killed.join(', ')}` : '')
      // A kill that did not take is reported, not assumed. Before this the Windows kill threw into
      // a bare catch and the record still said "was killed".
      + describeKill(r.kill),
    coverage: 'unknown', coverageReason: `killed at ${r.timeoutSec}s — coverage could not be established`,
  };
}

// ── SUBJECT-INTEGRITY FINGERPRINT ────────────────────────────────────────────────────────────
// A cheap, whole-tree snapshot: the commit, plus every dirty and untracked path. The PATHS are
// kept rather than a count, because a count cannot tell "the scan created 5 files" from "the scan
// created 5 and an operator added 2" — and that distinction decides whether a cleanup is safe to
// automate. It is what makes the drift message name the file instead of a number.
//
// `--untracked-files=all` is deliberate: the first real instance of this defect (slint-ui_slint)
// added UNTRACKED files — a bootstrapped gradle wrapper — which the default `normal` mode reports
// only as the containing directory. Returns null for a non-repo or an unreadable one, and a null
// fingerprint disables the comparison rather than inventing a clean baseline.
function treeFingerprint(repoPath) {
  try {
    // scannedGit: this runs on the host around every lane, and status refreshes the index (core.fsmonitor)
    const sha = scannedGit(repoPath, ['rev-parse', 'HEAD']);
    if (sha.status !== 0) return null;
    const st = scannedGit(repoPath, ['status', '--porcelain', '--untracked-files=all'], { maxBuffer: 64 * 1024 * 1024 });
    if (st.status !== 0) return null;
    return {
      sha: (sha.stdout || '').trim(),
      paths: new Set((st.stdout || '').split('\n').map((l) => l.slice(3)).filter(Boolean)),
    };
  } catch { return null; }
}

// -> a human sentence naming what changed, or null when the subject is untouched.
function describeTreeDrift(before, after) {
  if (!before || !after) return null;
  if (before.sha !== after.sha) return `HEAD moved ${before.sha.slice(0, 8)} -> ${after.sha.slice(0, 8)}`;
  const added = [...after.paths].filter((p) => !before.paths.has(p));
  const removed = [...before.paths].filter((p) => !after.paths.has(p));
  if (!added.length && !removed.length) return null;
  const bits = [];
  // Named, capped, and the remainder COUNTED rather than dropped — a truncated list that does not
  // say it truncated is the same silent-shortfall this repo refuses everywhere else.
  if (added.length) bits.push(`wrote ${added.length}: ${added.slice(0, 4).join(', ')}${added.length > 4 ? ` (+${added.length - 4} more)` : ''}`);
  if (removed.length) bits.push(`removed ${removed.length}: ${removed.slice(0, 4).join(', ')}${removed.length > 4 ? ` (+${removed.length - 4} more)` : ''}`);
  return bits.join('; ');
}

// ── PROVENANCE: WHICH BUILD PRODUCED THIS REPORT ───────────────────────────────────────────────
// Written BEFORE the check runs, next to whatever the check writes.
//
// It has to be captured here rather than derived at rollup time, and the difference is the whole
// point. Stamping "whatever is installed when the rollup runs" onto findings produced days earlier
// would attribute them to a binary that never touched them — an inference re-entering as fact, and
// strictly worse than no stamp at all. This records what was on PATH at the moment of the run.
//
// ONE FILE PER CHECK, never a shared map. Checks run concurrently, and read-modify-write on a
// single JSON file loses updates — the same defect the stop hooks hit. Per-check files have no
// shared state to lose.
function recordToolProvenance(check) {
  const dir = process.env.CW_REPORT_DIR;
  const tools = (check.requires && check.requires.tools) || [];
  if (!dir || !tools.length) return;
  try {
    const versions = versionsForTools(tools);
    // The filename is derived from the check id, which the manifest schema already constrains; the
    // replace is belt-and-braces against a path separator reaching a filename.
    const safe = String(check.id).replace(/[^A-Za-z0-9._-]/g, '_');
    writeFileSync(join(dir, `tool-version-${safe}.json`), `${JSON.stringify({
      check: check.id, probedAt: new Date().toISOString(), tools: versions,
    }, null, 2)}\n`);
  } catch { /* provenance is additive: failing to record it must never fail the check */ }
}

// A fail row names why. Lanes send their tool's output to a declared log, whose last line is
// usually the tool's own verdict. It is redacted and capped because this row reaches the rollup.
const FAIL_LOG_TAIL_BYTES = 4096;
export function failReason(check, status, dir = process.env.CW_REPORT_DIR) {
  const head = `exited ${status ?? 'without a status (signalled)'}`;
  const log = check && check.report && check.report.log;
  if (!dir || !log) return head;
  let tail = '';
  let fd = null;
  try {
    fd = openSync(join(dir, log), 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, FAIL_LOG_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    tail = buf.toString('utf8');
  } catch { return head; } finally { if (fd !== null) closeSync(fd); }
  const last = tail.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return last ? `${head} — ${redactSnippet(last).text.slice(0, 200)}` : head;
}

export function runCheckLocal(check, repoPath, dryRun = false, secretEnv = null) {
  const cmds = check.local || [];
  if (cmds.length === 0) {
    console.log(yellow(`  (no local command — ${check.act?.enabled ? 'run with --act' : 'nothing to run'})`));
    return { id: check.id, status: 'skipped', reason: 'no local command' };
  }
  if (!dryRun) recordToolProvenance(check);
  // Every container this check starts is named under one prefix, so a timeout can remove them by
  // name; a leftover from an earlier kill is removed BEFORE starting, or `--name` would refuse.
  const containerPrefix = containerName(check.id);
  const cargo = dryRun ? { env: {}, writes: [] } : cargoLaneEnv(check, repoPath);
  if (cargo.refused) return refusedResult(check, cargo.refused);
  const sb = dryRun ? null : hostSandboxFor(check, repoPath, process.env.CW_REPORT_DIR, cargo.writes);
  if (sb && sb.refused) return refusedResult(check, sb.refused);
  if (sb) sb.boundary = laneBoundary(check, sb, { container: isContainerLane(check), buildsTree: buildsScannedTree(check) });
  const bound = { check, timeoutSec: checkTimeoutSec(check), containerPrefix, sandbox: sb && sb.wrap, sandboxEnv: sb && sb.env };
  if (!dryRun) killByPrefix(containerPrefix);
  // fact: an explicit CW_LOCKFILE_DIR overrides the sidecar lock dir (expiry: never, prev: unknown)
  const lockDir = process.env.CW_LOCKFILE_DIR ? null : sidecarLockDir(repoPath);
  const env = { ...(secretEnv || {}), ...cargo.env, CW_CONTAINER_NAME: containerPrefix,
    ...(lockDir && existsSync(lockDir) ? { CW_LOCKFILE_DIR: lockDir } : {}) };
  for (const cmd of cmds) {
    console.log(dim(`  $ ${cmd}`));
    if (dryRun) continue;
    const r = runShell(cmd, repoPath, env, bound);
    if (r.timedOut) { quarantineKilledReport(check); return withBoundary(timedOutResult(check, r), sb); }
    if (r.refused) return withBoundary(refusedResult(check, r.refused), sb);
    // A prerequisite that is absent is a VOID, never a FAIL. Reporting "fail" here would publish
    // a finding-shaped result for a lane that never ran — the grey-as-red direction, which this
    // repo treats as the more expensive error of the two. `blocked` marks it as the kind of void
    // one human action clears.
    if (r.noShell) {
      return withBoundary({ id: check.id, status: 'noscan', blocked: true, blockedReason: r.reason, cmd,
        reason: r.reason, coverage: 'unknown', coverageReason: `could not execute — ${r.reason}` }, sb);
    }
    if (!r.ok) return withIsolation({ id: check.id, status: 'fail', cmd, reason: failReason(check, r.status) }, sb);
  }
  if (dryRun) return { id: check.id, status: 'skipped', reason: 'dry-run (commands printed, not executed)' };
  return withIsolation({ id: check.id, status: 'pass' }, sb);
}

function runCheckAct(check, repoPath, dryRun = false) {
  if (!check.act?.enabled) {
    die(`check '${check.id}' has no act block; remove --act or run it locally.`);
  }
  if (!check.workflow) die(`check '${check.id}' has no workflow path for act.`);
  const args = ['-W', check.workflow];
  if (check.act.job) args.push('-j', check.act.job);
  if (Array.isArray(check.act.args)) args.push(...check.act.args);
  // A dry-run prints the intended act invocation and executes NOTHING. It needs neither `act` nor
  // a Docker daemon, and it must never spawn `act` — the trust gate deliberately exempts dry-runs
  // for inspection, so a dry-run that still ran act would let an untrusted repo-local manifest's
  // workflow execute via `--dry-run --act` (RCE). Honour the flag here, before any spawn.
  if (dryRun) {
    console.log(dim(`  $ act ${args.join(' ')}`));
    return { id: check.id, status: 'skipped', reason: 'dry-run (act command printed, not executed)' };
  }
  if (!hasTool('act')) die("act is not installed. Install: brew install act");
  if (!dockerUp()) die('act needs a running Docker daemon.');
  console.log(dim(`  $ act ${args.join(' ')}`));
  return spawnSync('act', args, { cwd: repoPath, stdio: 'inherit', env: scannerEnv(process.env) }).status === 0
    ? { id: check.id, status: 'pass' }
    : { id: check.id, status: 'fail', cmd: `act ${args.join(' ')}` };
}

// A lane CONTAINED for safety leaves no trace, and absence of a trace reads as absence of risk.
//
// `sast-codeql-swift` autobuilds the scanned tree, so it is confined to `deep`. Confinement alone
// left a Swift repo with no Swift row under a default sweep, byte-identical to a repo with no
// Swift: "deliberately not run here" and "nothing to scan" must not render the same.
//
// DERIVED, NOT LISTED. The predicate is the command, matching bin/test/build-mode-containment.mjs,
// so a future building lane inherits the void row by being what it is. `--build-mode=none` is the
// declared non-executing form and never matches.
//
// Scoped to containment on purpose: `compare` engines are unselected without being voids, and
// reporting them as gaps would be the mirror failure. Exported so
// bin/test/build-mode-containment.test.mjs asserts this predicate rather than its own copy.
export const buildsScannedTree = (check) => {
  const cmd = (Array.isArray(check && check.local) ? check.local : []).join(' ');
  // build-mode none never compiles, so it never runs the tree's own build.
  if (/--build-mode[ =]none/.test(cmd)) return false;
  // autobuild is one way to build the scanned tree. An EXPLICIT --command is another, and it is
  // the stronger case rather than the weaker: the lane names a build script and hands it the
  // repository. Keying the predicate on `autobuild` alone meant that replacing autobuild with a
  // clean build script — which is what GitHub documents for compiled languages — silently
  // removed the lane from containment while it went on doing MORE building than before. The
  // non-vacuity assertion in bin/test/build-mode-containment.test.mjs is what caught that.
  if (/--build-mode[ =]autobuild/.test(cmd) || /database create[\s\S]*?--command[ =]/.test(cmd)) return true;
  // cargo is the third way. clippy, check, build and test all type-check the crate, and type-checking
  // runs build.rs and proc-macro expansion from the tree AND its dependencies. Found 2026-09-13 by
  // the audit this predicate was written to make unnecessary: lint-rust-clippy's own notes said
  // "IT COMPILES THE SCANNED REPOSITORY" and the lane sat in `all` — prose again, one layer along.
  return /\bcargo\s+(?:\+\S+\s+)?(?:clippy|check|build|test|run|bench|doc)\b/.test(cmd);
};

export function containedVoids(manifest, selected, repoPath, envKeys) {
  const chosen = new Set(selected.map((c) => c.id));
  const out = [];
  for (const check of manifest.checks) {
    if (chosen.has(check.id) || !buildsScannedTree(check)) continue;
    // Only a void where the lane WOULD have applied. A repo with no Swift is not missing a Swift
    // scan, and saying so would manufacture a gap on every repo in the fleet. A matched lane whose
    // tool is absent still gets its row: the repo has the sources whether or not the box has the tool.
    const ap = checkApplies(check, repoPath, envKeys);
    if (!ap.applies && !ap.toolVoid) continue;
    out.push({
      id: check.id,
      status: 'noscan',
      reason: `contained — this lane builds the scanned repository and is confined to the \`deep\` group, `
        + `so a default sweep does not run it. ${check.appliesIfSourceExt ? `${check.appliesIfSourceExt.join('/')} sources ARE present here` : 'It applies to this repo'} `
        + `and were NOT analysed. This is a deliberate coverage gap, not a clean result.`,
      durationMs: null,
      coverage: 'unknown',
      coverageReason: 'the lane did not run — coverage could not be established',
      coverageBasis: 'contained',
    });
  }
  return out;
}

/** A lane the operator disabled, or whose binary they have not approved, is a declared coverage
 *  gap. It reports as a void for the same reason a contained lane does: a sweep that simply
 *  omitted it would render "refused" and "clean" identically. */
export function consentVoids(blocked) {
  return blocked.map((b) => ({
    id: b.id,
    status: 'noscan',
    reason: b.reason === 'disabled'
      ? 'disabled in this box\'s scan configuration — a deliberate coverage gap, not a clean result.'
      : `awaiting approval to execute ${b.tools.join(', ')} on this machine — the lane did not run, `
        + 'which is not the same as finding nothing. Approve it on /config to close the gap.',
    durationMs: null,
    coverage: 'unknown',
    coverageReason: 'the lane did not run — coverage could not be established',
    coverageBasis: b.reason === 'disabled' ? 'disabled' : 'unapproved-tool',
  }));
}

/**
 * Depth and the per-lane overrides, APPLIED (operator ruling 2026-09-25). Until then the runner ran
 * every selected lane and depth only sized the sweep, so the panel's "not run at this depth" was a
 * projection nothing honoured. A lane depth holds back is a void, never an omission, for the same
 * reason a contained lane is.
 *
 * A check named on the command line is the operator's explicit ask and runs whatever depth says.
 * A model that cannot be read runs every lane, loudly: over-scanning is the direction that cannot
 * publish a gap as clean.
 */
export function depthGate(checks, { repo, explicit = false, levels = null, overrides = null, doc = null } = {}) {
  const plans = new Map();
  let lv = levels;
  let model = doc;
  try {
    lv = lv || repoLevels(repo);
    model = model || loadProfiles();
  } catch (e) {
    return { runnable: checks, voids: [], plans, levels: lv, warning: `depth NOT applied — the tuning model could not be read (${e.message}); every selected lane runs` };
  }
  const ov = overrides || (() => { try { return getSetting('scannerOverrides').value || {}; } catch { return {}; } })();
  const runnable = [];
  const voids = [];
  for (const check of checks) {
    const plan = lanePlan(check.id, { depth: lv.depth.value, intensity: lv.intensity.value, override: ov[check.id] || 'auto', doc: model });
    plans.set(check.id, plan);
    if (plan.run || explicit) { runnable.push(check); continue; }
    voids.push({
      id: check.id, status: 'noscan', reason: plan.reason, durationMs: null,
      coverage: 'unknown', coverageReason: 'the lane did not run — coverage could not be established',
      coverageBasis: plan.basis,
    });
  }
  return { runnable, voids, plans, levels: lv, warning: null };
}

function cmdRun(manifest, repoPath, target, opts) {
  const selected = selectChecks(manifest, target);
  const gate = gateChecks(selected, readScanConfig());
  const repoSlug = process.env.CW_REPO_SLUG || basename(resolve(repoPath));
  const explicit = !!target && manifest.checks.some((c) => c.id === target);
  const dg = depthGate(gate.runnable, { repo: repoSlug, explicit });
  const checks = dg.runnable;
  const envKeys = readEnvKeys(repoPath);
  const results = [...containedVoids(manifest, selected, repoPath, envKeys), ...consentVoids(gate.blocked), ...dg.voids];
  // For the lane-progress lines only: a watching panel needs to know which repo a lane belongs to,
  // and the sweep spawns one runner per repo. Trailing separators are stripped so `/a/b/` and
  // `/a/b` do not announce themselves as two different subjects.
  const repoName = basename(resolve(repoPath));
  // Runtime scanners (requiresUrl) need a live base URL. Honor --url / $CW_TARGET_URL and
  // expose them to the check commands; auto-detect an OpenAPI spec for the api-fuzz check.
  const runUrl = opts.url || process.env.CW_TARGET_URL || '';
  if (opts.url) process.env.CW_TARGET_URL = opts.url;
  if (!process.env.CW_OPENAPI) {
    const oa = ['openapi.yaml', 'openapi.json', 'openapi.yml'].map((f) => join(repoPath, f)).find(existsSync);
    if (oa) process.env.CW_OPENAPI = oa;
  }
  console.log(heading(`commitwork run ${target || 'all'}`) + dim(`  (${manifest.repo} @ ${repoPath})`) + (runUrl ? mut(`  → ${runUrl}`) : ''));
  if (gate.blocked.length) {
    const held = gate.blocked.filter((b) => b.reason === 'unapproved-tool').length;
    console.log(mut(`  ${gate.blocked.length} lane(s) held by this box's scan configuration`)
      + dim(held ? ` — ${held} awaiting binary approval on /config` : ' — disabled on /config'));
  }
  if (dg.warning) console.error(yellow(`  (${dg.warning})`));
  else if (dg.levels) {
    const { depth, intensity } = dg.levels;
    console.log(mut(`  depth ${depth.value} (${depth.source}), intensity ${intensity.value} (${intensity.source})`)
      + (dg.voids.length ? dim(` — ${dg.voids.length} lane(s) not run at this depth or forced off`) : '')
      + (explicit ? dim(' — named explicitly, so depth does not hold it back') : ''));
  }
  console.log('');
  for (const [ix, check] of checks.entries()) {
    // `description` is documentation, not run output; it stays behind `--verbose` so the ✓/⊘ pattern
    // is readable. The X/Y denominator is this run's selected checks, not the manifest total, so a
    // lane blocked on a scanner is distinguishable from a hung run.
    console.log(`${acc('▸')} ${dim(`[${ix + 1}/${checks.length}]`)} ${bold(check.id)}`);
    if (opts.verbose && check.description) console.log(dim(`  ${check.description}`));
    laneProgress('start', { repo: repoName, check: check.id });
    // EVERY exit from this loop body records the lane as finished, and there is one place that does
    // it. Pushing a result and announcing the lane are the same act: three of these branches predate
    // the announcement, and a fourth added later would otherwise leave the panel spinning a lane
    // forever with nothing to say it had stopped. `bin/test/lane-progress.test.mjs` asserts the loop
    // body contains no bare `results.push`.
    const finish = (r) => {
      laneProgress('end', { repo: repoName, check: check.id, status: r.status, ms: r.durationMs ?? null });
      results.push(r);
    };
    // carries this check's resolved secrets from checkApplies() to the command that declared them
    let applies = null;

    // A runtime scanner with no live URL is recorded as skipped (a visible coverage gap in
    // checks-status.json → the rollup), never run against an empty target.
    if (check.requiresUrl && !runUrl) {
      finish({ id: check.id, status: 'skipped', reason: 'runtime scanner — no live URL (set --url / CW_TARGET_URL)' });
      console.log(`  ${STATUS.skipped('runtime scanner needs a live URL (--url / CW_TARGET_URL)')}`);
      console.log('');
      continue;
    }

    const useAct = opts.act && check.act?.enabled;
    if (!useAct) {
      // F1: gate with checkApplies (appliesIfExists/appliesIfGit + requirements), matching cmdScan.
      // Before F1 the run path checked only evalRequirements, so a check declaring appliesIfExists
      // (e.g. authz-test → security/authz-isolation-test.sh) ran unconditionally in repos lacking
      // the file, produced a 0-byte report, and recorded a false pass. An inapplicable check is a
      // skip (n/a), never a pass.
      const ap = checkApplies(check, repoPath, envKeys);
      applies = ap;
      if (!ap.applies) {
        const msg = ap.why;
        if (opts.strict) { finish({ id: check.id, status: 'fail', reason: msg }); console.log(`  ${STATUS.fail(msg)}`); }
        // The lane applies here and a tool it requires is not installed: a void one action clears, never n/a.
        else if (ap.toolVoid) { finish(toolVoid(check, msg)); console.log(`  ${STATUS.blocked(msg)}`); }
        else { finish({ id: check.id, status: 'skipped', reason: `n/a — ${msg}` }); console.log(`  ${STATUS.na(msg)}`); }
        if (check.skipsOnGitHub?.length) console.log(dim(`    GitHub-only steps dropped: ${check.skipsOnGitHub.length}`));
        console.log('');
        continue;
      }
      // Checked after applicability: a tree without the script is n/a, not a held lane.
      if (check.requiresRepoTrust === true && !repoTrusted(opts)) {
        finish(untrustedScriptVoid(check));
        console.log(`  ${STATUS.blocked(UNTRUSTED_SCRIPT_REASON)}`);
        console.log('');
        continue;
      }
    }
    if (check.skipsOnGitHub?.length && opts.verbose) {
      for (const s of check.skipsOnGitHub) console.log(dim(`    skip(GitHub): ${s}`));
    }

    // A SCANNER MUST NOT MODIFY WHAT IT SCANS, and until 2026-08-21 nothing here checked.
    // `deno check` was materialising a pnpm catalog into package.json mid-sweep; every lane that
    // ran after it on that repo scanned a file the batch anchor no longer described, while the
    // slice recorded them all against one sliceId as though they had seen one tree. It surfaced
    // only because a later rescan happened to compare anchors, and naming the culprit then took
    // eleven bisection runs.
    //
    // PER CHECK, not per repo. A per-repo assertion detects the mutation but cannot say WHICH lane
    // did it, which is the expensive half of the answer. Fingerprinting either side of each check
    // names the writer for free.
    //
    // WHAT IT CANNOT DO, stated so the next reader does not over-trust it: deno wrote a path
    // OUTSIDE its own working directory (cwd was apps/web, the write landed on the repo-root
    // package.json), so a lane that escapes the repository ENTIRELY is invisible here — this
    // watches one tree, not the filesystem. Treat a clean result as "this repo was not modified",
    // never as "this lane wrote nothing anywhere".
    //
    // Cost is real and was measured, not assumed: `git status --porcelain` runs 89-103ms on the
    // largest repos in the fleet, so two calls per lane is ~6.5s on a 34-lane repo — about 4% of a
    // sweep. Default ON because the failure it catches is silent and corrupts a whole slice;
    // CW_ASSERT_TREE=0 turns it off for a run where that 4% matters more than the guarantee.
    const assertTree = process.env.CW_ASSERT_TREE !== '0' && !opts.dryRun;
    const before = assertTree ? treeFingerprint(repoPath) : null;

    const plan = dg.plans.get(check.id);
    const levelEnv = plan && plan.known ? plan.env : {};
    const t0 = Date.now();
    const res = useAct ? runCheckAct(check, repoPath, opts.dryRun)
      : runCheckLocal(check, repoPath, opts.dryRun, { ...(applies?.secretEnv || {}), ...(applies?.toolEnv || {}), ...levelEnv });
    res.durationMs = Date.now() - t0;
    if (plan && plan.known && plan.depth.level) res.depthLevel = { ...plan.depth.level, depth: plan.depth.value };

    if (before) {
      const after = treeFingerprint(repoPath);
      const drift = describeTreeDrift(before, after);
      if (drift) {
        res.mutatedSubject = drift;
        // LOUD, and on stderr: this is not a finding about the repo, it is a defect in the scanner
        // that just ran, and it invalidates the provenance of every lane after it in this repo.
        console.error(red(`  !! ${check.id} MODIFIED THE REPOSITORY IT SCANNED — ${drift}`));
        console.error(red('     A scanner must not modify what it scans. Findings recorded after this'));
        console.error(red('     point in this repo describe a tree the batch anchor no longer matches.'));
      }
    }
    // F1: a shell exit-0 is NOT proof the check found nothing — the command ends `|| true`, so a
    // crashed/absent tool also exits 0. Re-classify against the actual report: an exit-0 pass whose
    // report is empty/missing/artifact-less is a `noscan` (void), not a green. Only reclassify a
    // shell-`pass` on a real dry-run-free run with a report dir to read.
    const reportDir = process.env.CW_REPORT_DIR;
    if (res.status === 'pass' && !opts.dryRun && reportDir && check.report) {
      applyReportVerdict(res, classifyReport(check, reportDir, repoPath));
    }
    // fact: a failed lane that wrote no report is a void as well as a failure / status stays fail so the run still exits 1, and noReport lets the rollup count it — six codeql lanes failed this way from 2026-08-29 and no rollup listed them (expiry: never, prev: missing)
    if (res.status === 'fail' && !opts.dryRun && reportDir && check.report && !existsSync(join(reportDir, check.report.file))) {
      res.noReport = true;
      res.reason = `exited non-zero and wrote no ${check.report.file} — nothing was scanned`;
    }
    // COVERAGE IS COMPUTED FOR EVERY STATUS, not just the clean ones. The case that matters most is
    // a check that FOUND things while half-blind — 11 osv results with Go call analysis dead — and
    // gating this on `pass` would drop coverage exactly where the two axes most need to be separate.
    // A killed check is NOT read for coverage: whatever it left on disk is evidence of a kill,
    // not of a scan, and timedOutResult already says coverage is unknown.
    // An n/a carries no coverage here or below, the same as an appliesIf miss: nothing was there to see.
    if (!opts.dryRun && reportDir && check.report && !res.timedOut && res.status !== 'skipped') {
      const { coverage, coverageReason } = laneCoverage(check, reportDir);
      res.coverage = coverage;
      res.coverageReason = coverageReason;
    }
    // A lane run below the top of its own ladder looked at less than it can. Its findings are real;
    // its silence covers only the level it ran at, and the row has to say which.
    if (res.depthLevel && res.depthLevel.rank < res.depthLevel.of && !res.timedOut && res.coverage !== 'unknown' && res.status !== 'skipped') {
      const was = res.coverage === 'reduced' && res.coverageReason ? `${res.coverageReason}; ` : '';
      res.coverage = 'reduced';
      res.coverageReason = `${was}ran at level "${res.depthLevel.label}" (${res.depthLevel.rank} of ${res.depthLevel.of}) for depth ${res.depthLevel.depth}, not its full level`;
      res.coverageBasis = 'depth-level';
    }
    if (!opts.dryRun && !res.timedOut) applyIsolation(res, check);
    finish(res);
    // MEASURED COST, recorded here because this is the only place a lane's duration exists.
    // perf-profiles.json declares what a scanner COSTS; until 2026-08-26 nothing ever recorded what
    // it cost, so monitor/perf-feedback.mjs had no writer and drift() compared against an empty set
    // forever — every cost class stayed a declaration. This is that writer.
    //
    // NEVER FAILS A SCAN, and never silently: recordRun returns its error rather than raising, and
    // a failure is warned ONCE per process. A telemetry log that can break a sweep is worse than no
    // log; one that fails invisibly is worse than both.
    //
    // `exit` is null on purpose — this runner reports a STATUS vocabulary, not a numeric code, so
    // the honest value is "not exposed here". It is carried as null rather than 0 (see the guard in
    // recordRun; passing null used to coerce to a clean 0).
    if (!opts.dryRun) {
      const fb = recordRun({
        scanner: check.id,
        repo: basename(repoPath),
        ms: res.durationMs,
        exit: null,
        profileId: process.env.CW_PERF_PROFILE || null,
        // Numbers, not the strings process.env hands back: summarise() groups and compares these,
        // and "3" never equals 3.
        depth: dg.levels ? dg.levels.depth.value : numEnv(process.env.CW_SCAN_DEPTH),
        intensity: dg.levels ? dg.levels.intensity.value : numEnv(process.env.CW_SCAN_INTENSITY),
        jobs: numEnv(process.env.CW_SWEEP_JOBS),
        cores: cpus().length,
        ramGB: Math.round(totalmem() / (1024 ** 3)),
        loadAtStart: loadavg()[0],
      });
      if (!fb.ok && !perfFeedbackWarned) {
        perfFeedbackWarned = true;
        console.error(yellow(`  (perf feedback not recorded: ${fb.error} — tuning stays a declaration this run)`));
      }
    }
    // Timing always prints, in a unit that cannot round to a bare "0s": a 40s pass and a 0.2s pass
    // are different claims about whether the tool worked, and an absent number must not look like
    // a small one.
    const took = dim(res.durationMs < 1000 ? `  ${res.durationMs}ms` : `  ${(res.durationMs / 1000).toFixed(1)}s`);
    if (res.status === 'pass') console.log(`  ${STATUS.pass()}${took}`);
    // A blocked void renders as its own thing: same `noscan` status on the wire, different
    // colour on the terminal, because the operator's next action differs entirely.
    else if (res.status === 'noscan') console.log(`  ${(res.blocked ? STATUS.blocked : STATUS.noscan)(res.reason)}${took}`);
    else if (res.status === 'skipped') console.log(`  ${STATUS.na(String(res.reason).replace(/^n\/a — /, ''))}${took}`);
    else if (res.status === 'fail') console.log(`  ${STATUS.fail(res.cmd || '')}${took}`);
    console.log('');
    if (res.status === 'fail' && opts.failFast) break;
  }
  printSummary(results);
  if (!opts.dryRun) writeChecksStatus(results); // a dry-run is not tool-run provenance
  const failed = results.filter((r) => r.status === 'fail');
  process.exit(failed.length ? 1 : 0);
}

// WHICH COMMITWORK produced this repo's rows. A sweep spawns this file fresh per repo and the tree
// it lives in is committed to by many sessions while the sweep runs — 25 commits landed inside
// sweep-20260822153004 — so a 100-row batch can be the output of a dozen different runners and
// nothing recorded which. Written as its own receipt (toolchain.json) beside checks-status.json,
// once per invocation, so the rollup can count distinct vintages instead of assuming one.
//
// sourceDirtyHash is over the CONTENT of dirty source paths, not their count: the sweep itself
// dirties monitor/issues.json and PROJECTSTATUS.md, so a count never reads zero and "same sha,
// same count" is still not "same code". Test paths are excluded — a lane's output does not
// change when its test does. Same {sha, sourceDirtyHash} ⇒ same runner; anything else ⇒ not.
export function toolchainVintage(root = ROOT) {
  const git = (args) => {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  };
  const at = new Date().toISOString();
  const sha = git(['rev-parse', 'HEAD']);
  if (sha === null) return { sha: null, branch: null, sourceDirty: null, sourceDirtyHash: null, at, reason: 'commitwork is not a git checkout here — vintage unrecorded, not clean' };
  const st = git(['status', '--porcelain', '--untracked-files=all', '--', 'bin', 'monitor', 'manifests', 'cra', 'admin', 'schema', 'lib']);
  if (st === null) return { sha, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), sourceDirty: null, sourceDirtyHash: null, at, reason: 'git status failed — dirt unrecorded, not absent' };
  const sourceDirty = st.split('\n').filter(Boolean).map((l) => l.slice(3))
    .filter((p) => !/(^|\/)test\//.test(p) && !/\.test\.mjs$/.test(p)).sort();
  const h = createHash('sha256');
  for (const p of sourceDirty) {
    const blob = existsSync(join(root, p)) ? git(['hash-object', '--', p]) : 'deleted';
    h.update(`${p}\0${blob ?? 'unreadable'}\n`);
  }
  return { sha, branch: git(['rev-parse', '--abbrev-ref', 'HEAD']), sourceDirty, sourceDirtyHash: sourceDirty.length ? h.digest('hex') : null, at };
}

function writeToolchainReceipt() {
  const dir = process.env.CW_REPORT_DIR;
  if (!dir || !existsSync(dir)) return;
  try { writeFileSync(join(dir, 'toolchain.json'), JSON.stringify(toolchainVintage(), null, 2)); } catch (e) {
    console.error(yellow(`  (toolchain.json not written: ${e.message})`));
  }
}

// Per-check status for the monitor (slice tool-run provenance). Merge-on-write keyed by
// check id: a repo may run multiple manifests into the same CW_REPORT_DIR, and the second
// invocation must not clobber the first's statuses.
function writeChecksStatus(results) {
  const dir = process.env.CW_REPORT_DIR;
  if (!dir || !existsSync(dir)) return;
  writeToolchainReceipt();
  const p = join(dir, 'checks-status.json');
  let prev = [];
  try { prev = JSON.parse(readFileSync(p, 'utf8')); if (!Array.isArray(prev)) prev = []; } catch {}
  const byCheck = new Map(prev.map((r) => [r.check, r]));
  for (const r of results) {
    // THE VOCABULARY IS ENFORCED HERE, at the wire, rather than asserted in a comment. This is the
    // one place a status becomes durable and readable by thirteen consumers, so it is the place
    // worth holding to the canon: a status outside CHECK_STATUS is a bug in the runner, and writing
    // it would teach every downstream reader a word the schema does not define. Loud, not silent —
    // the row still writes, because losing provenance is worse than carrying an odd status, but
    // nobody gets to not know.
    const wire = toWireStatus(r.status);
    if (!isCheckStatus(wire)) {
      console.error(yellow(`  (checks-status: '${r.id}' has status '${wire}', which is not one of ${CHECK_STATUS.join('|')} — recorded, but the vocabulary has drifted)`));
    }
    byCheck.set(r.id, {
      check: r.id,
      status: wire, // canon: monitor/check-vocabulary.mjs CHECK_STATUS (noscan = ran, no trustworthy output)
      reason: r.reason,
      durationMs: r.durationMs ?? null,
      at: new Date().toISOString(),
      // COVERAGE RIDES ALONGSIDE status, never inside it. `status` says what the check concluded;
      // `coverage` says how much of it ran. A check can be `pass` with reduced coverage (it looked
      // where it could and found nothing there) or `fail` with reduced coverage (it found things AND
      // was half-blind) — two facts that a single enum cannot carry without one erasing the other.
      //
      // WRITTEN EVEN WHEN FULL, on purpose. Omitting it would make "full coverage" and "written by a
      // build that predates this field" the same absence, and a consumer could not tell a verified
      // claim from a missing one. Rows genuinely written before this shipped have no key at all,
      // which is the honest third state and is why the field is emitted rather than defaulted.
      // coverageBasis says HOW: 'per-file' is a measured k-of-n, 'signal' is a regex match whose
      // gap size is unknown. Both are `reduced`; only one is a number a reader can weigh.
      ...(r.coverage ? { coverage: r.coverage, coverageReason: r.coverageReason ?? null, ...(r.coverageBasis ? { coverageBasis: r.coverageBasis } : {}) } : {}),
      ...(r.isolation ? { isolation: r.isolation } : {}),
      ...(r.isolationReason ? { isolationReason: r.isolationReason } : {}),
      // the lane's per-command threat model: declared boundary against measured effects, beside status
      ...(r.boundary ? { boundary: r.boundary } : {}),
      // a kill is its own fact beside the noscan: a reader can tell "the tool found nothing to
      // read" from "the runner stopped the tool"
      ...(r.timedOut ? { timedOut: true } : {}),
      ...(r.noReport ? { noReport: true } : {}),
      ...(r.depthLevel ? { depthLevel: r.depthLevel } : {}),
    });
  }
  try { writeFileSync(p, JSON.stringify([...byCheck.values()], null, 2)); } catch (e) {
    console.error(yellow(`  (checks-status.json not written: ${e.message})`));
  }
}

function printSummary(results) {
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail');
  const skip = results.filter((r) => r.status === 'skipped');
  // NOSCAN WAS COUNTED NOWHERE. The tallies read "13 passed 0 failed 9 skipped" for a 23-check
  // run: the one check that ran and produced nothing trustworthy (socket, "Input error") fell out
  // of the arithmetic entirely, so the summary balanced only by accident and the void was invisible
  // unless you read every line above it. A void is the one status that most needs the headline —
  // it is the difference between "we looked and it was clean" and "we did not look".
  const nos = results.filter((r) => r.status === 'noscan');
  console.log(heading('── summary ──'));
  console.log([
    green(`${pass} passed`),
    fail.length ? red(`${fail.length} failed`) : mut('0 failed'),
    nos.length ? cyan(`${nos.length} noscan`) : mut('0 noscan'),
    mut(`${skip.length} skipped`),
    dim(`· ${results.length} checks`),
  ].join('   ').replace(/^/, '  '));
  for (const f of fail) console.log(`    ${STATUS.fail(`${f.id}${f.reason ? ` — ${f.reason}` : ''}`)}`);
  // Blocked lanes are listed FIRST in the void summary and in the darker red — they are the only
  // entries in this list a reader can act on today, and burying them among unfixable voids is
  // how the actionable one stops being read.
  for (const n of [...nos].sort((a, b) => (b.blocked ? 1 : 0) - (a.blocked ? 1 : 0))) {
    const paint = n.blocked ? STATUS.blocked : STATUS.noscan;
    console.log(`    ${paint(`${n.id}${n.reason ? ` — ${n.reason}` : ''}`)}`);
  }
  for (const s of skip) console.log(`    ${STATUS.skipped(`${s.id}${s.reason ? ` — ${s.reason}` : ''}`)}`);
}

function cmdList(manifest, repoPath) {
  const envKeys = readEnvKeys(repoPath);
  console.log(bold(`commitwork — ${manifest.repo}`) + dim(`  (${repoPath})`));
  console.log('');
  for (const check of manifest.checks) {
    const { ok, missing } = evalRequirements(check, repoPath, envKeys);
    const badge = ok ? green('ready') : yellow('blocked');
    const act = check.act?.enabled ? cyan(' [act]') : '';
    console.log(`  ${ok ? green('●') : yellow('○')} ${bold(check.id.padEnd(22))} ${badge}${act}`);
    if (check.description) console.log(dim(`      ${check.description}`));
    if (!ok) console.log(yellow(`      needs: ${missing.join(', ')}`));
    if (check.skipsOnGitHub?.length) console.log(dim(`      GitHub-only steps dropped: ${check.skipsOnGitHub.length}`));
  }
  console.log('');
  if (manifest.groups) {
    console.log(bold('groups:'));
    for (const [g, ids] of Object.entries(manifest.groups)) console.log(`  ${cyan(g.padEnd(12))} ${dim(ids.join(', '))}`);
  }
}

function cmdDoctor(manifest, repoPath) {
  const tools = new Set(['node', 'npm', 'docker', 'act']);
  for (const check of manifest.checks) for (const t of check.requires?.tools || []) tools.add(t);
  console.log(bold('commitwork doctor'));
  console.log('');
  console.log(dim('tools:'));
  let anyMissing = false;
  for (const t of [...tools].sort()) {
    const pinned = resolvePinnedTool(t);
    const ok = pinned ? pinned.ok : hasTool(t);
    if (!ok) anyMissing = true;
    const hint = ok || pinned ? null : installHintFor(t);
    const note = pinned ? (ok ? `${pinned.source}${pinned.version ? ` ${pinned.version}` : ''}: ${pinned.path}` : pinned.reason)
      : ok ? null : `not on PATH${hint ? ` — ${hint}` : ''}`;
    console.log(`  ${ok ? green('✓') : red('✗')} ${t}${note ? dim(`  (${note})`) : ''}`);
  }
  if (anyMissing) console.log(dim('  → `commitwork setup` installs the missing scanners'));
  console.log('');
  console.log(dim('services:'));
  const runtime = nodeFloorCheck();
  console.log(`  ${runtime.ok ? green('✓') : red('✗')} Node.js ${runtime.version}${dim(`  (package.json requires ${runtime.range})`)}`);
  if (!runtime.ok) console.log(yellow(`      ${runtime.message}`));
  console.log(`  ${dockerUp() ? green('✓') : red('✗')} docker daemon`);
  const sandbox = process.env.CW_SANDBOX === 'off' ? { available: false, why: 'CW_SANDBOX=off' } : probeHostSandbox();
  console.log(`  ${sandbox.available ? green('✓') : red('✗')} host sandbox${dim(`  (${sandbox.why})`)}`);
  if (!sandbox.available) {
    console.log(yellow(process.env.CW_SANDBOX === 'require' ? '      CW_SANDBOX=require: every host lane is refused as noscan'
      : '      lanes run unconfined and each row records isolation: none'));
  }
  if (process.platform === 'linux' && sandbox.available && !hasTool('pasta')) {
    console.log(yellow('      pasta (package passt) is absent: every lane with network egress is refused as noscan'));
  }
  // The POSIX shell is a PREREQUISITE, not a scanner, and it was invisible here — so a Windows
  // operator's first signal that no shell existed was 68 unexplained check failures. Reported
  // before any scan, with where we looked, so an absence is diagnosable rather than mysterious.
  const sh = shellDiagnostics();
  console.log(`  ${sh.ok ? green('✓') : red('✗')} POSIX shell${sh.ok ? dim(`  (${sh.path}${sh.source === 'git-adjacent' ? ' — from the Git install' : ''})`) : ''}`);
  if (!sh.ok) {
    console.log(dim(`      ${sh.hint}`));
    console.log(dim(`      looked in: ${sh.searched.join(', ')}`));
    console.log(yellow('      every `local` check in security-baseline.json needs this — without it they report noscan, not pass'));
  }
  console.log('');
  console.log(dim(`target repo: ${repoPath} ${existsSync(repoPath) ? green('(exists)') : red('(MISSING)')}`));
}

// ── scan: run a baseline across many repos and write reports ─────────────────
// Walks in Node. This used to shell out to `find <root> -maxdepth 5 -type d -name .git -not -path
// '*/node_modules/*'` — GNU findutils. On Windows `find` resolves to C:\WINDOWS\system32\find.exe,
// a TEXT SEARCH tool (verified 2026-09-04), which rejects those operands and exits non-zero with
// EMPTY STDOUT. The caller read only `r.stdout`, so `commitwork scan --root <dir>` — the flagship
// fleet path in the README quick start — discovered nothing but roots that were themselves repos
// and reported no error at all. Not an ENOENT: a different program answering, wrongly, in silence.
//
// lib/repo-walk.mjs also RECORDS unreadable subtrees instead of letting an EACCES shrink the fleet,
// and its `skip` matching is separator-aware: the predicate here tested `/${s}/` against paths that
// use `\` on Windows, so `--skip` matched nothing.
function discoverRepos(roots, skip) {
  const { repos, errors, missingRoots } = findGitRepos(roots, { skip });
  for (const abs of missingRoots) console.error(yellow(`  (root not found: ${abs})`));
  // Named, capped, remainder counted — a truncated list that does not say it truncated is the
  // silent shortfall this repo refuses everywhere else.
  if (errors.length) {
    const shown = errors.slice(0, 3).map((e) => `${e.path} (${e.code})`).join(', ');
    console.error(yellow(`  (${errors.length} subtree(s) unreadable during discovery — the fleet below may be INCOMPLETE: ${shown}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''})`));
  }
  return repos;
}

export function parseReport(format, path) {
  if (!existsSync(path)) return { ok: false, summary: 'no report' };
  if (format === 'sarif') return parseSarif(path);
  if (format === 'trufflehog') return parseTrufflehog(path);
  if (format === 'npm-audit') return parseNpmAudit(path);
  if (format === 'trivy') return parseTrivy(path);
  if (format === 'sbom') return parseSbom(path);
  if (format === 'nuclei') return parseNuclei(path);
  if (format === 'gitleaks') return parseGitleaks(path);
  if (format === 'betterleaks') return parseBetterleaks(path);
  if (format === 'retire') return parseRetire(path);
  if (format === 'hadolint') return parseHadolint(path);
  if (format === 'weak-random') return parseWeakRandom(path);
  if (format === 'rule-counts') return parseRuleCounts(path);
  if (format === 'bearer') return parseBearer(path);
  if (format === 'shellcheck') return parseShellcheck(path);
  if (format === 'minify') return parseMinify(path);
  if (format === 'cobol-inventory') return parseCobolInventory(path);
  if (format === 'actionlint') return parseActionlint(path);
  if (format === 'socket') return parseSocket(path);
  if (format === 'schemathesis') return parseSchemathesis(path);
  if (format === 'tls-headers') return parseTlsHeaders(path);
  if (format === 'a11y') return parseA11y(path);
  if (format === 'authz-bola') return parseAuthzBola(path);
  if (format === 'cspm-github') return parseCspmGithub(path);
  if (format === 'jackson-guard') return parseJacksonGuard(path);
  if (format === 'gradle-wrapper') return parseGradleWrapper(path);
  if (format === 'scorecard') return parseScorecard(path);
  if (format === 'depscan') return parseDepscan(path);
  // PASSTHROUGH, but not credulous. Content stays unparsed by design — the real read happens at
  // rollup via SCANNER_SPECS — yet a lane declaring `json` must at minimum have written JSON.
  // Presence of an ERROR MESSAGE is not presence of a report, and the two are the same file to a
  // check that only asks whether the path exists.
  //
  // Measured 2026-09-02: sobelow's artifact on phoenix was the 145-byte text
  // `Mix requires the Hex package manager to fetch dependencies / Shall I install Hex? [Yn]` —
  // an interactive prompt to a non-tty. That is a lane that never scanned, and it reached this
  // branch as `ok/written`. The exit code had been masking it; once the exit-code inference was
  // (correctly) dropped for passthrough formats, this became a clean pass over a prompt.
  //
  // Only `json` is checked, because only `json` declares a shape. `text`, `generic` and `config`
  // promise nothing about their bytes and a validity check on them would be invented, not derived.
  if (format === 'json' && existsSync(path)) {
    try { JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) {
      return { ok: false, sev: 'noscan',
        summary: `artifact is not JSON, which this lane declares it writes (${String(e.message).slice(0, 60)}) — the tool wrote something other than a report` };
    }
  }
  return { ok: existsSync(path), sev: 'ok', summary: 'written' };
}

// Bounded tree walk: does any file under `root` (≤ maxDepth deep) satisfy `pred(name)`?
// `skip` names the dirs to prune. For source-manifest discovery we prune build/target
// (source doesn't live there); for built-artifact detection we must NOT prune them.
const SKIP_SOURCE = new Set(['node_modules', '.git', 'dist', 'reports', 'reference', 'vendor', 'build', 'target', '.gradle']);
const SKIP_ARTIFACT = new Set(['node_modules', '.git', 'dist', 'reports', 'reference', 'vendor']);
function treeHasFile(root, pred, { maxDepth = 5, skip = SKIP_SOURCE } = {}) {
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, d] = stack.pop();
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && pred(e.name)) return true;
      if (e.isDirectory() && !skip.has(e.name) && d < maxDepth) stack.push([join(dir, e.name), d + 1]);
    }
  }
  return false;
}

// Monorepo-aware existence check: root hit (original behaviour) OR, for a bare filename
// (no path separator), the same file carried by a service submodule below root. Nested
// paths and directory entries keep the strict root-only semantics.
function appliesExists(repoPath, f) {
  if (existsSync(join(repoPath, f))) return true;
  if (!f.includes('/')) return treeHasFile(repoPath, (n) => n === f);
  return false;
}

function checkApplies(check, repoPath, envKeys) {
  if (check.appliesIfGit && !existsSync(join(repoPath, '.git'))) return { applies: false, why: 'not a git repo' };
  if (Array.isArray(check.appliesIfExists) && !check.appliesIfExists.some((f) => appliesExists(repoPath, f))) {
    return { applies: false, why: `none of ${check.appliesIfExists.join('/')} present` };
  }
  // Source-extension gate: applies when a source file with one of these extensions exists anywhere
  // in the (bounded, vendored-dirs-skipped) tree. The signal is the SOURCES themselves, never a
  // build-manifest proxy — see the CHECK_KEYS note for the CodeQL void this closed.
  if (Array.isArray(check.appliesIfSourceExt)
    && !treeHasFile(repoPath, (n) => check.appliesIfSourceExt.some((x) => n.toLowerCase().endsWith(x.toLowerCase())))) {
    return { applies: false, why: `no ${check.appliesIfSourceExt.join('/')} sources found` };
  }
  // Past the gates above the lane matches this repo, so a tool it cannot find makes it a void, not
  // an exclusion. A missing secret or a stopped Docker daemon is still reported as n/a here.
  const { ok, missing, secretEnv, toolEnv, toolsMissing } = evalRequirements(check, repoPath, envKeys);
  if (!ok) return { applies: false, why: missing.join(', '), ...(toolsMissing.length ? { toolVoid: true } : {}) };
  // the resolved secrets travel WITH the verdict so the run path can hand them to this check's
  // command. Dropping secretEnv here is silent: the check still runs, still reports pass/noscan,
  // and the credential simply never arrives — which is how it shipped, because the tests cover the
  // BLOCKED path and the ENV path (where process.env already carries the value) but not the
  // keychain -> spawn path that this line is the only carrier for.
  return { applies: true, secretEnv, toolEnv };
}

// Shared report classifier (F1): the single source of truth for turning a produced report into a
// severity, used by BOTH cmdScan and the run path. Separates "ran & genuinely clean" from "ran but
// produced nothing" (a void). A green 0 is only trustworthy if the tool actually had something to
// scan — a missing report, a SARIF with no sources, or a build-gated scanner with no artifact is a
// `noscan`, never a silent pass. Before F1 this logic lived only inside cmdScan, so the scheduled
// `run` path scored crashed/absent checks as green; extracting it makes the two paths agree.
export function classifyReport(check, repoDir, repo) {
  const rep = check.report ? parseReport(check.report.format, join(repoDir, check.report.file)) : { sev: 'ok', total: 0, summary: 'done' };
  // `ok:false` is a parser saying it could not read what it was given. Defaulting that to 'ok'
  // put an honest "no gitleaks data" summary beside a green severity across thirteen formats.
  // A parser that failed is a void; only a parser that succeeded may say clean.
  let sev = rep.sev || (rep.ok === false ? 'noscan' : 'ok');
  let summary = rep.summary;
  // `unreasoned` = the parser returned no severity of its own and we supplied one above. Those
  // still deserve the refinement below, which knows things the parser cannot: whether the file was
  // absent, whether any source matched, whether a build artifact was needed. Without this the
  // missing-report case regressed from "no output (tool absent/failed)" to a bare "no report" —
  // the verdict stayed right and the ACTIONABLE part was dropped, which a test caught immediately.
  //
  // A parser that DID classify (sarif's "tool reported failure — …HTTP 404", socket's "did not run")
  // is left alone: it has already looked at the artifact and knows more than the refinement does,
  // and overwriting it with a generic void message would throw away the one line naming the cause.
  const unreasoned = !rep.sev;
  const emptyClean = (sev === 'ok' || (sev === 'noscan' && unreasoned)) && (rep.total === 0 || rep.total == null);
  if (emptyClean) {
    const reportMissing = !!check.report && !existsSync(join(repoDir, check.report.file));
    const needsArtifact = Array.isArray(check.producesIfExists) && check.producesIfExists.length > 0 &&
      !check.producesIfExists.some((g) => {
        const m = /^\*(\.[A-Za-z0-9]+)$/.exec(g);
        const pred = m ? (n) => n.endsWith(m[1]) : (n) => n === g;
        return treeHasFile(repo, pred, { skip: SKIP_ARTIFACT });
      });
    // THE EXIT CODE, finally consulted. Every lane ends in `|| true` so a crashed tool cannot abort
    // the sweep, which means the process's own verdict was being thrown away at the one moment it
    // was decisive. The gap this closes is trufflehog's zero-byte report: a clean secrets scan
    // writes NOTHING, and so does one killed on its first syscall, so the file alone genuinely
    // cannot tell them apart and no smarter parser ever will. The exit code can.
    //
    // Only consulted INSIDE emptyClean, and that restriction is the whole design. A non-zero exit
    // is the NORMAL, successful state for most of these tools — gitleaks, semgrep and shellcheck
    // all exit 1 precisely when they find something — so a blanket "non-zero ⇒ void" would grey out
    // every lane that did its job. Here we have already concluded "nothing was found", and the only
    // question left is whether that is a result or a failure to produce one.
    const exitFile = check.report && join(repoDir, `${check.report.file}.exit`);
    let toolExit = null;
    if (exitFile && existsSync(exitFile)) {
      const n = Number(String(readFileSync(exitFile, 'utf8')).trim());
      if (Number.isInteger(n)) toolExit = n;
    }
    // A PASSTHROUGH FORMAT HAS NO FINDINGS BY CONSTRUCTION, so `emptyClean` tells us nothing about
    // it and the exit code must not be read as if it did. parseReport returns {sev:'ok'} for
    // json/text/generic/config deliberately — presence is the only check-time signal, and the real
    // parse happens at rollup via SCANNER_SPECS. That made `rep.total == null` universal for these
    // lanes, so ANY tool that exits non-zero when it SUCCEEDS fell into the branch below.
    //
    // Measured 2026-09-02: brakeman exits 3 on findings, bundle-audit and sobelow exit 1. All three
    // wrote valid artifacts and were published as noscan — maybe-finance/maybe carried a 420KB
    // bundler-audit.json the rollup extractor reads as 180 advisories (crit 1, high 27, med 40,
    // low 11, undetermined 101) while the check status said "nothing found". Two parsing layers
    // disagreeing, with the weaker one in front of the operator.
    //
    // The artifact's PRESENCE is still checked (reportMissing, above) and still fails closed. What
    // is dropped is only the inference from an exit code about content nothing at this layer read.
    const passthrough = check.report && PASSTHROUGH_FORMATS.has(check.report.format);
    if (reportMissing) { sev = 'noscan'; summary = 'no output (tool absent/failed)'; }
    else if (rep.nosrc) { sev = 'noscan'; summary = 'ran — no source matched'; }
    else if (toolExit !== null && toolExit !== 0 && !passthrough && !(toolExit === 1 && rep.exitOneIsReport === true)) {
      sev = 'noscan';
      summary = `nothing found, but the tool exited ${toolExit} — cannot tell clean from failed`;
    }
    // NO exit witness AND an artifact that cannot self-certify. The branch above answers "the tool
    // said it failed"; this one answers "nothing said anything at all", which the null case was
    // silently reading as clean. osv-scanner with egress severed writes exactly this: valid SARIF,
    // zero results, empty invocations[] — indistinguishable from a genuine clean scan by the file.
    // Reaches only artifacts that predate the lane writing its sidecar; every current scan carries
    // one, so this greys history rather than the fleet.
    else if (toolExit === null && rep.unwitnessedZero) {
      sev = 'noscan';
      summary = 'nothing found, and nothing witnessed the run — no exit code, no invocation record';
    } else if (needsArtifact) { sev = 'noscan'; summary = 'no scannable artifact (build first)'; }
  }
  // The severity axis, held to its canon at the point it leaves the classifier. Same reasoning as
  // the status check in writeChecksStatus: this value reaches the rollup, the panel and index.md,
  // and a severity nobody declared is a word three surfaces must each guess the meaning of. It does
  // not throw — a scan that reached a verdict is worth recording — but it cannot pass unremarked.
  if (!isSeverity(sev)) {
    console.error(yellow(`  (classifyReport: '${check.id}' produced severity '${sev}', not one of ${SEVERITY.join('|')})`));
  }
  // `blocked` survives the trip so the renderer can colour a clearable void differently. Passed
  // through explicitly, not spread: this return is the parser/runner boundary, and a spread here
  // would silently promote every future parser field into the run result.
  return { sev, summary, blocked: rep.blocked === true, empty: sev === 'ok' && rep.empty === true };
}

// Moves a shell pass by its classified report: `noscan` to a void, `skip` to the n/a an appliesIf
// miss records. The `n/a` prefix is what the rollup's NA_SKIP reads as not-applicable rather than
// blocked. `skip` used to fall through here, so a parser's "no subject" published as a pass.
// `blocked` rides along with the void so the renderer can colour it. Destructured, never spread:
// this is the one place a parser fact becomes a run result.
export function applyReportVerdict(res, { sev, summary, blocked, empty }) {
  if (sev === 'noscan') { res.status = 'noscan'; res.reason = summary; if (blocked) res.blocked = true; }
  else if (sev === 'skip') { res.status = 'skipped'; res.reason = `n/a — ${summary}`; }
  else if (empty) res.reason = summary;
  return res;
}

// ── COVERAGE: HOW MUCH OF THE CHECK ACTUALLY RAN ────────────────────────────────────────────────
//
// Separate from classifyReport because it answers a separate question: severity is what the check
// found, coverage is whether it could see everything. A check can find HIGH findings while
// half-blind, and on one axis that case has nowhere to live.
//
// The concrete case this exists for: osv-scanner emits 11 real results AND logs "Skipping call
// analysis on Go code since Go is not installed". Eleven findings is a true severity. One dead lane
// is a true coverage loss. Reported as one number, either is a lie.
//
// THREE STATES, NOT TWO. 'full' and 'reduced' are the plan's vocabulary; 'unknown' is added because
// the alternative is worse. If a check declares a log and the log is missing or unreadable, we have
// not established that coverage was full — we have failed to look. Returning 'full' there would
// assert completeness nobody verified, which is this repo's central defect wearing a new field
// name. Only a log that was READ and matched nothing yields 'full'.
export function laneCoverage(check, repoDir) {
  const base = laneCoverageBase(check, repoDir);
  // The exit code and an absent report decide before any per-file reading, as they always did.
  if (!check || !check.report || check.report.format !== 'sarif'
    || base.coverageBasis === 'exit-code' || base.coverageBasis === 'report-absent') return base;
  // A SARIF that names files its extractor could not parse. The rest of the tree was read, so
  // the run is real; these files were not, so its coverage is not full. A declared signal that
  // ALSO matched keeps its reason: both facts are reported, never one in place of the other.
  const r = readSarif(join(repoDir, check.report.file));
  if (r.state !== 'ok') return base;
  const failed = r.extractionErrors;
  // THE UNREAD REMAINDER, not only the files that errored. CodeQL's own baseline names how many
  // files of this language it expected and how many it extracted, and the gap is usually silent:
  // measured 2026-10-04 on a 1,818-file Go repository, the lane recorded `pass, coverage full`
  // while CodeQL's log said it scanned 1,441 of them. monitor/codeql-coverage.mjs derived the same
  // 79% and withheld the zero-licence, so the two readers of one artifact disagreed, and the row a
  // person reads was the one claiming completeness.
  const ratio = coverageForLane(r.runs, check.id);
  const shortfall = ratio.state === 'partial'
    ? `extracted ${ratio.extracted} of ${ratio.expected} ${check.id.includes('codeql') ? 'files CodeQL expected' : 'expected files'} (${Math.round(ratio.ratio * 100)}%)`
    : null;
  if (!failed.length && !shortfall) return base;
  const shown = failed.slice(0, 5).map((f) => `${f.uri}${f.line ? `:${f.line}` : ''} (${String(f.error).slice(0, 60)})`);
  const perFile = [
    failed.length ? `${failed.length} file${failed.length === 1 ? '' : 's'} failed extraction and were not analysed — `
      + `${shown.join(', ')}${failed.length > shown.length ? `, +${failed.length - shown.length} more` : ''}` : null,
    shortfall,
  ].filter(Boolean).join('; ');
  if (base.coverage === 'full') return { coverage: 'reduced', coverageReason: perFile, coverageBasis: 'per-file' };
  return {
    coverage: 'reduced',
    coverageReason: `${perFile}; also ${base.coverageReason}`,
    coverageBasis: base.coverageBasis === 'per-file' ? 'per-file' : `per-file+${base.coverageBasis}`,
  };
}

function laneCoverageBase(check, repoDir) {
  // `coverageBasis` says HOW the verdict was reached, because after this function grew a per-file
  // counter the word `reduced` came to mean two different strengths: "2 of 146 yarn.lock files
  // could not be parsed" and "a regex matched somewhere in the log". Both are reduced; only one is
  // measured. A reader comparing lanes needs the difference in a field, not in prose.
  const full = { coverage: 'full', coverageReason: null, coverageBasis: 'none' };
  if (!check || !check.report) return full;
  // fact: neither the report nor its exit sidecar exists when the command never reached its scanner / the codeql lanes that died at shell parse recorded coverage full (expiry: never, prev: wrong)
  const logDecides = check.report.log && Array.isArray(check.coverageSignals) && check.coverageSignals.length;
  const leftNothing = !existsSync(join(repoDir, check.report.file)) && !existsSync(join(repoDir, `${check.report.file}.exit`))
    && !(check.report.log && existsSync(join(repoDir, check.report.log)));
  if (!logDecides && leftNothing) {
    return { coverage: 'unknown', coverageReason: `${check.report.file} and its exit sidecar were never written — coverage could not be established`, coverageBasis: 'report-absent' };
  }

  // 1. THE EXIT CODE, read from the sidecar every lane now writes.
  //
  // Exit 1 is success for gitleaks, semgrep, shellcheck and gosec: they exit 1 when they find
  // something. Treating any non-zero as reduced coverage marked every lane that did its job as
  // half-blind, so only >1 reduces coverage.
  //
  // The threshold is not invented here: deps-osv's own manifest command already encodes it as
  // `if [ $rc -gt 1 ]` with the note "127=tool error, 128=no packages scanned -- NOT a clean scan".
  // Above 1 is the tool in trouble (127 not found, 126 not executable, 2 usage, 128+n signalled);
  // 1 is the tool reporting. So >1 reduces coverage and 1 does not.
  //
  // A tool whose convention differs would need this declared per check rather than assumed — noted
  // rather than built, because no such lane exists in this manifest today and a knob nobody turns is
  // the defect this whole line of work keeps finding.
  const exitFile = join(repoDir, `${check.report.file}.exit`);
  if (existsSync(exitFile)) {
    const n = Number(String(readFileSync(exitFile, 'utf8')).trim());
    if (Number.isInteger(n) && n > 1) {
      return { coverage: 'reduced', coverageReason: `the tool exited ${n}`, coverageBasis: 'exit-code' };
    }
  }

  // 2. THE DECLARED SIGNALS. A tool that loses a capability usually says so on stderr and carries on
  //    exiting 0 — which is why the exit code alone cannot close this. Patterns are DECLARED in the
  //    manifest per check rather than guessed centrally, because only the check's author knows which
  //    of its chatter means a lane died.
  const signals = Array.isArray(check.coverageSignals) ? check.coverageSignals : [];
  if (!signals.length) return full;

  const logName = check.report.log;
  if (!logName) return full;                      // nothing declared to read; exit code was the whole story
  const logPath = join(repoDir, logName);
  if (!existsSync(logPath)) {
    // A declared log that is not there means the run did not get far enough to write one. That is
    // not evidence of full coverage; it is the absence of the evidence we came for.
    return { coverage: 'unknown', coverageReason: `declared log ${logName} is absent — coverage could not be established`, coverageBasis: 'log-absent' };
  }
  let text;
  // Bounded: the pattern is manifest-declared, and a repo-local manifest under
  // --trust-repo-manifest could otherwise point a backtracking regex at a 64 MB log.
  try { text = readFileSync(logPath, 'utf8').slice(0, 2 * 1024 * 1024); } catch (e) {
    return { coverage: 'unknown', coverageReason: `declared log ${logName} unreadable (${e.code || 'error'}) — coverage could not be established`, coverageBasis: 'log-unreadable' };
  }
  for (const s of signals) {
    if (!s || typeof s.pattern !== 'string') continue;
    let re;
    // A malformed pattern is a declaration bug, and it must not silently mean "no signal matched" —
    // that would turn a typo into a permanent clean claim.
    // 'm' so a pattern may anchor to a LINE with ^: an unanchored pattern can match the middle of
    // a path a scanned repo controls, and `^` without this flag silently matches nothing but the
    // first line — a permanently-clean claim from a correct-looking declaration.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern comes from a bundled manifest coverageSignals entry, validated at load (line 235); repo-local manifests need --trust-repo-manifest; a bad pattern fails closed
    try { re = new RegExp(s.pattern, 'm'); } catch {
      return { coverage: 'unknown', coverageReason: `coverageSignals pattern is not a valid regex: ${s.pattern}` };
    }
    if (!re.test(text)) continue;

    // A COUNT, WHERE THE LOG CARRIES ONE. "yarn.lock version resolution did not run" was true and
    // unactionable: osv parsed 904 lockfiles in dependabot-core, 146 of them yarn.lock, and refused
    // 2 — both deliberately-broken fixtures. One binary flag turned a 1.4% gap into a lane that
    // sounds dead. When a signal declares `denominatorPattern`, the reason carries k of n and names
    // the files, so the reader can judge the gap instead of taking the word `reduced` at face value.
    let count = null;
    if (typeof s.denominatorPattern === 'string') {
      try {
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern comes from a bundled manifest coverageSignals entry, validated at load; repo-local manifests need --trust-repo-manifest
        const nRe = new RegExp(s.denominatorPattern, 'gm');
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern comes from a bundled manifest coverageSignals entry, validated at load; repo-local manifests need --trust-repo-manifest
        const kRe = new RegExp(s.pattern, 'gm');
        const cap = Number.isInteger(s.capture) ? s.capture : 1;
        const denom = [...text.matchAll(nRe)];
        const hits = [...text.matchAll(kRe)];
        // Only claim a ratio when the denominator actually matched: k of 0 is not a coverage
        // statement, it is a broken declaration, and reporting "2 of 0" would be worse than silence.
        if (denom.length) {
          count = {
            k: hits.length, n: denom.length,
            paths: hits.map((m) => (m[cap] || '').trim()).filter(Boolean).slice(0, 8),
          };
        }
      } catch {
        return { coverage: 'unknown', coverageReason: `coverageSignals denominatorPattern is not a valid regex: ${s.denominatorPattern}`, coverageBasis: 'declaration-error' };
      }
    }
    const lane = s.lane || `matched ${s.pattern}`;
    if (count) {
      const unit = s.unit || 'file';
      return {
        coverage: 'reduced',
        coverageReason: `${lane}: ${count.k} of ${count.n} ${unit}${count.n === 1 ? '' : 's'}`
          + (count.paths.length ? ` — ${count.paths.join(', ')}${count.k > count.paths.length ? `, +${count.k - count.paths.length} more` : ''}` : '')
          + ' (counted from the tool log)',
        coverageBasis: 'per-file',
      };
    }
    // The reason names the LANE and nothing else — that contract predates this function's counter
    // and still holds. `coverageBasis: 'signal'` is where "this gap has no measured size" lives:
    // it is a field a consumer can branch on, and repeating it in the prose would put one fact in
    // two places and break every reader that pins the sentence.
    return {
      coverage: 'reduced',
      coverageReason: s.lane ? `${s.lane} did not run` : `matched ${s.pattern}`,
      coverageBasis: 'signal',
    };
  }
  return full;
}

// noscan ranks above skip (it was in scope and should have produced output) but below any
// real severity, so a void never inflates a repo's worst-of status to a false HIGH.
// UNKNOWN OUTRANKS CLEAN. `noscan` means the check ran and produced nothing trustworthy, so the
// repo's real state is unknown — and unknown is worse news than a scan that came back clean, never
// better. It sat at 0.5, below `ok`, which inverted the house rule wherever this map decides an
// ordering: a fully-blind repo sorted as the safest thing in the table (writeIndex, "worst first").
//
// 1.5 places it where it belongs — above `ok`, below any real finding — so a blind repo rises above
// a clean one while a repo with actual `med`/`high` results still outranks a blind one.
//
// THIS IS NOT COVERAGE LEAKING INTO THE SEVERITY AXIS. `noscan` is already a severity value here and
// has been since this map was written; only its ORDER changes. The rule that coverage must stay
// orthogonal to severity (see the sweep-truthfulness work) forbids something different and more
// specific: reclassifying a cell that found real things AS noscan because one of its lanes went
// blind, which would take a `high` down to this rank and hide findings. Nothing here reclassifies.
//
// The exact same judgement is already made one module over: monitor/issue-store.mjs ranks
// `unknown: 1.5` between `low: 1` and `med: 2`. Two names for one idea; this brings them into line.
//
// The label thresholds that read this map are unaffected: they test `worst >= 3` and `worst === 2`,
// and 1.5 satisfies neither, so a blind repo still falls through to the `voids` label rather than
// `clean` — which it already did, via a separate void count, and now agrees with the ranking.
const SEV_RANK = { high: 3, med: 2, ok: 1, noscan: 1.5, skip: 0 };
function sevBadge(sev) {
  return sev === 'high' ? red('HIGH') : sev === 'med' ? yellow('med') : sev === 'ok' ? green('ok') : dim('—');
}

// Runtime scanners (nuclei/testssl/authz-bola/schemathesis) need a live base URL per repo.
// Resolution order: --urls <file> map (slug or basename → url) › repo-local `commitwork.url`
// (only with --trust-repo-manifest: the scanned tree must not choose where live lanes send traffic)
// › --url <u> single target › $CW_TARGET_URL. Empty ⇒ no runtime target (those checks skip,
// visibly, as a coverage void — never silently dropped).
function loadUrlMap(opts) {
  if (!opts.urls) return {};
  try {
    const p = isAbsolute(opts.urls) ? opts.urls : resolve(process.cwd(), opts.urls);
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch (e) { console.error(yellow(`  (urls map not loaded: ${e.message})`)); return {}; }
}
export function resolveRepoUrl(repo, slug, urlMap, opts, warn = (m) => console.error(yellow(m))) {
  if (urlMap[slug]) return urlMap[slug];
  if (urlMap[basename(repo)]) return urlMap[basename(repo)];
  const f = join(repo, 'commitwork.url');
  if (existsSync(f)) {
    if (repoTrusted(opts)) { const u = readFileSync(f, 'utf8').trim(); if (u) return u; }
    else warn(`  (${f} ignored: a repo-supplied DAST target; pass --trust-repo-manifest to use it, or --url/--urls)`);
  }
  return opts.url || process.env.CW_TARGET_URL || '';
}

/** The check `check` stands in for, when CHECK_ALIASES declares it an alias of one that writes the
 *  same report file in this manifest; otherwise null. */
export function standbyPrimary(manifest, check) {
  const primaryId = Object.hasOwn(CHECK_ALIASES, check.id) ? CHECK_ALIASES[check.id] : null;
  const primary = primaryId && manifest.checks.find((c) => c.id === primaryId);
  return primary && primary.report && check.report && primary.report.file === check.report.file ? primaryId : null;
}

function cmdScan(manifest, opts) {
  const roots = opts.roots?.length ? opts.roots : [process.cwd()];
  const skip = opts.skip || [];
  const repos = opts.repos?.length ? opts.repos : discoverRepos(roots, skip);
  if (!repos.length) die('no git repos discovered under: ' + roots.join(', '));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = opts.out ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)) : join(ROOT, 'reports', stamp);
  mkdirSync(runDir, { recursive: true });

  console.log(bold(`commitwork scan`) + dim(`  baseline=${manifest.repo}  repos=${repos.length}  out=${runDir}`));
  if (skip.length) console.log(dim(`  skipping: ${skip.join(', ')}`));
  console.log('');

  const envKeys = readEnvKeys(process.cwd());
  const urlMap = loadUrlMap(opts);
  const rows = []; // { repo, slug, cells: { checkId: {sev, summary} } }
  const usedSlugs = new Set();

  for (const repo of repos) {
    let slug = basename(repo);
    while (usedSlugs.has(slug)) slug = `${slug}_${usedSlugs.size}`;
    usedSlugs.add(slug);
    const repoDir = join(runDir, slug);
    mkdirSync(repoDir, { recursive: true });

    const repoUrl = resolveRepoUrl(repo, slug, urlMap, opts);
    const openapiFile = ['openapi.yaml', 'openapi.json', 'openapi.yml'].map((f) => join(repo, f)).find(existsSync) || '';

    process.stdout.write(`▸ ${bold(slug)} ` + (repoUrl ? dim(`(→ ${repoUrl}) `) : ''));
    const cells = {};
    for (const check of manifest.checks) {
      // Runtime scanners are in the sweep by default; without a live URL they skip VISIBLY
      // (a coverage void), so "ALL scanners" is always accounted for, never quietly absent.
      if (check.requiresUrl && !repoUrl) { cells[check.id] = { sev: 'noscan', summary: 'runtime scanner did not run — no live URL (pass --url/--urls or add commitwork.url)' }; process.stdout.write(cyan('▚')); continue; }
      const ap = checkApplies(check, repo, envKeys);
      if (!ap.applies && ap.toolVoid) {
        const v = toolVoid(check, ap.why);
        cells[check.id] = { sev: 'noscan', summary: ap.why, blocked: true, blockedReason: ap.why, coverage: v.coverage, coverageReason: v.coverageReason };
        process.stdout.write(cyan('▚'));
        continue;
      }
      if (!ap.applies) { cells[check.id] = { sev: 'skip', summary: ap.why }; process.stdout.write(dim('·')); continue; }
      if (check.requiresRepoTrust === true && !repoTrusted(opts)) {
        const v = untrustedScriptVoid(check);
        cells[check.id] = { sev: 'noscan', summary: v.reason, coverage: v.coverage, coverageReason: v.coverageReason, isolation: 'none' };
        process.stdout.write(cyan('▚'));
        continue;
      }
      // A scan runs every check, groups aside. A standby that writes its primary's report file runs
      // only when the primary produced nothing: after one that did, it replaced the primary's
      // findings with its own (semgrep.sarif, Semgrep then Opengrep, 2026-10-07).
      const standbyFor = standbyPrimary(manifest, check);
      if (standbyFor && cells[standbyFor] && !['noscan', 'skip'].includes(cells[standbyFor].sev)) {
        cells[check.id] = { sev: 'skip', summary: `standby for ${standbyFor}, which ran; running it would overwrite ${check.report.file}` };
        process.stdout.write(dim('·'));
        continue;
      }
      // Same bound as the check path: a scan-path lane could otherwise hang the whole fleet scan.
      const scanPrefix = containerName(check.id, { repo: slug });
      const cargo = cargoLaneEnv(check, repo);
      if (cargo.refused) { cells[check.id] = { sev: 'noscan', summary: cargo.refused, coverage: 'unknown', coverageReason: 'the lane never ran', isolation: 'none' }; process.stdout.write(cyan('▚')); continue; }
      const sb = hostSandboxFor(check, repo, repoDir, cargo.writes, { CW_TARGET_URL: repoUrl, CW_OPENAPI: openapiFile, CW_TLS_URL: process.env.CW_TLS_URL });
      if (sb.refused) { cells[check.id] = { sev: 'noscan', summary: sb.refused, coverage: 'unknown', coverageReason: 'the lane never ran', isolation: 'none' }; process.stdout.write(cyan('▚')); continue; }
      sb.boundary = laneBoundary(check, sb, { container: isContainerLane(check), buildsTree: buildsScannedTree(check) });
      const scanBound = { check, timeoutSec: checkTimeoutSec(check), containerPrefix: scanPrefix, quiet: true, sandbox: sb.wrap, sandboxEnv: sb.env }; // the scan prints one glyph per lane; tool output stays out of it
      killByPrefix(scanPrefix);
      let killed = null, refused = null, noShell = null;
      for (const cmd of check.local || []) {
        // sh -c argv-array (not shell:true string) — same manifest-command hardening as
        // runShell() above: bounded argument instead of parent-shell interpolation.
        // fact: a keychain-resolved secret reaches the declaring command here as on the run path / without it the scan applied socket and ran it tokenless, "requires a Socket API token", measured 2026-09-30 on cobolwork (expiry: never, prev: missing)
        const r = runShell(cmd, repo, { ...(ap.secretEnv || {}), ...(ap.toolEnv || {}), ...cargo.env, CW_REPORT_DIR: repoDir, PWD: repo, CW_TARGET_URL: repoUrl, CW_OPENAPI: openapiFile, CW_CONTAINER_NAME: scanPrefix }, scanBound);
        if (r.timedOut) { killed = r; break; }
        if (r.refused) { refused = r.refused; break; }
        if (r.noShell) { noShell = r; break; }
      }
      // Same rule as the check path: an unexecutable prerequisite is a blocked void. Falling
      // through to classifyReport() here would read an ABSENT report as a clean lane on every repo
      // in the fleet — the exact grey-rendered-as-green failure the house invariant names first.
      if (noShell) {
        cells[check.id] = withBoundary({ sev: 'noscan', summary: noShell.reason, blocked: true, blockedReason: noShell.reason,
          coverage: 'unknown', coverageReason: `could not execute — ${noShell.reason}` }, sb);
        process.stdout.write(cyan('▚'));
        continue;
      }
      if (refused) { cells[check.id] = withBoundary({ sev: 'noscan', summary: refused, coverage: 'unknown', coverageReason: 'the lane never ran', isolation: 'none' }, sb); process.stdout.write(cyan('▚')); continue; }
      if (killed) {
        const saved = process.env.CW_REPORT_DIR; process.env.CW_REPORT_DIR = repoDir;
        try { quarantineKilledReport(check); } finally { if (saved === undefined) delete process.env.CW_REPORT_DIR; else process.env.CW_REPORT_DIR = saved; }
        const t = timedOutResult(check, killed);
        cells[check.id] = withBoundary({ sev: 'noscan', summary: t.reason, coverage: t.coverage, coverageReason: t.coverageReason, timedOut: true }, sb);
        process.stdout.write(cyan('▚'));
        continue;
      }
      const { sev, summary } = classifyReport(check, repoDir, repo); // F1: shared classifier
      // A parser's n/a is written as an appliesIf miss is: no coverage, the n/a glyph, never the green dot.
      if (sev === 'skip') { cells[check.id] = { sev, summary }; process.stdout.write(dim('·')); continue; }
      // The scan path needs coverage for the same reason the check path does, and the CLI has
      // already committed to it: the run summary tells the operator to open index.md for coverage,
      // so a coverage fact that never reaches index.md is one the reader was sent to find and
      // cannot. Computed here beside the classifier, on the same two axes.
      const { coverage, coverageReason } = laneCoverage(check, repoDir);
      cells[check.id] = withIsolation({ sev, summary, coverage, coverageReason }, sb);
      process.stdout.write(sev === 'high' ? red('!') : sev === 'med' ? yellow('+') : sev === 'noscan' ? cyan('▚') : green('.'));
    }
    rows.push({ repo, slug, cells });
    const worst = Object.values(cells).reduce((m, c) => Math.max(m, SEV_RANK[c.sev] || 0), 0);
    const nVoid = Object.values(cells).filter((c) => c.sev === 'noscan').length;
    const voidTag = nVoid ? cyan(` ⬜${nVoid} void`) : '';
    console.log('  ' + (worst >= 3 ? red('HIGH') : worst === 2 ? yellow('findings') : nVoid ? cyan('voids') : green('clean')) + voidTag);
    writeRepoSummary(repoDir, slug, repo, manifest, cells);
  }

  writeIndex(runDir, manifest, rows);
  // The cells exactly as classified, so a brief can be rebuilt from this directory later.
  const scanDoc = compactBoundaries(rows.map((r) => ({ repo: r.repo, slug: r.slug, cells: r.cells })));
  writeAtomic(join(runDir, 'scan.json'), `${JSON.stringify({ version: 1, baseline: manifest.repo, ...(Object.keys(scanDoc.boundaries).length ? { boundaries: scanDoc.boundaries } : {}), repos: scanDoc.repos }, null, 2)}\n`);
  if (opts.sarif) exportSarif(runDir, rows);
  console.log('');
  console.log(bold('── scan complete ──'));
  console.log(`  ${rows.length} repos · report index: ${cyan(join(runDir, 'index.md'))}`);
  const highs = rows.filter((r) => Object.values(r.cells).some((c) => c.sev === 'high'));
  if (highs.length) {
    console.log(red(`  ${highs.length} repo(s) with HIGH findings:`));
    for (const r of highs) {
      const which = Object.entries(r.cells).filter(([, c]) => c.sev === 'high').map(([k, c]) => `${k} (${c.summary})`);
      console.log(red(`    ✗ ${r.slug}: ${which.join('; ')}`));
    }
  }
  const voidTotal = rows.reduce((n, r) => n + Object.values(r.cells).filter((c) => c.sev === 'noscan').length, 0);
  if (voidTotal) {
    const voidRepos = rows.filter((r) => Object.values(r.cells).some((c) => c.sev === 'noscan')).length;
    console.log(cyan(`  ⬜ ${voidTotal} coverage void(s) across ${voidRepos} repo(s) — in-scope checks that produced no output (see index.md → Coverage voids). A void is not a pass.`));
  }
  return { runDir, rows };
}

function writeRepoSummary(repoDir, slug, repo, manifest, cells) {
  const lines = [`# Security report — ${slug}`, '', `Repo: \`${repo}\``, '', '| Check | Severity | Findings |', '|---|---|---|'];
  for (const check of manifest.checks) {
    const c = cells[check.id];
    if (!c) continue;
    const sev = c.sev === 'skip' ? 'n/a' : c.sev.toUpperCase();
    lines.push(`| ${check.id} | ${sev} | ${c.summary} |`);
  }
  lines.push('', '_Artifacts (SARIF/JSON) for each check are in this directory._', '');
  writeFileSync(join(repoDir, 'summary.md'), lines.join('\n'));
}

// Only `ok` earns the clean mark. A default of 🟢 painted depscan's off-canon 'warn' (7 dependency
// findings on one fleet repository, 2026-10-04) as clean while classifyReport was already warning about it.
export function severityMark(sev) {
  return { high: '🔴', med: '🟡', noscan: '⬜', ok: '🟢' }[sev] || '❔';
}

// Per repo, the in-scope checks that produced nothing. Only `noscan`; `skip` is not applicable and
// is never a void.
export function coverageVoidRows(ranked, ids) {
  return ranked
    .map((r) => ({
      slug: r.slug,
      voids: ids
        .map((id) => ({ id, c: r.cells[id] }))
        .filter(({ c }) => c && c.sev === 'noscan')
        .map(({ id, c }) => `${id} (⬜ ${c.summary})`),
    }))
    .filter((r) => r.voids.length);
}

// A noscan cell is already a void and produced no output, so it is not also "ran but half-blind".
export function degradedLaneRows(ranked, ids) {
  return ranked
    .map((r) => ({
      slug: r.slug,
      lanes: ids
        .map((id) => ({ id, c: r.cells[id] }))
        .filter(({ c }) => c && c.sev !== 'noscan' && (c.coverage === 'reduced' || c.coverage === 'unknown'))
        .map(({ id, c }) => `${id} (${c.coverage}${c.coverageReason ? ` — ${c.coverageReason}` : ''})`),
    }))
    .filter((r) => r.lanes.length);
}

function writeIndex(runDir, manifest, rows) {
  const ids = manifest.checks.map((c) => c.id);
  const lines = [`# Security scan — ${manifest.repo}`, '', `${rows.length} repos · baseline checks: ${ids.join(', ')}`, ''];
  // Sort: worst first — AND A BLIND REPO IS NOT A GOOD ONE.
  //
  // The ordering key is SEV_RANK, where `noscan` now sits at 1.5 (see the constant). Before that it
  // was 0.5, BELOW `ok`, so a repo whose every lane produced nothing sorted beneath a repo that
  // genuinely scanned clean — last, in a table headed "worst first". The run summary points the
  // operator at this very file with the words "A void is not a pass" (see cmdScan), while the
  // ordering underneath it said exactly that. The per-repo console line already special-cased
  // voids; this consumer of the same data did not.
  //
  // The tiebreak is the second half. Equal severity is common — most repos sit at ok — so between
  // two repos that rank the same, the one carrying more voids is the one worth opening first.
  // Severity still decides before it does: a repo with real findings outranks a blind one, which is
  // the property that must not regress in the course of fixing the other.
  const voidsOf = (r) => Object.values(r.cells).filter((c) => c.sev === 'noscan').length;
  const ranked = [...rows].sort((a, b) => {
    const wa = Math.max(...Object.values(a.cells).map((c) => SEV_RANK[c.sev] || 0));
    const wb = Math.max(...Object.values(b.cells).map((c) => SEV_RANK[c.sev] || 0));
    return wb - wa || voidsOf(b) - voidsOf(a) || a.slug.localeCompare(b.slug);
  });
  lines.push('| Repo | ' + ids.join(' | ') + ' |');
  lines.push('|---|' + ids.map(() => '---').join('|') + '|');
  for (const r of ranked) {
    const cells = ids.map((id) => {
      const c = r.cells[id];
      if (!c || c.sev === 'skip') return '–';
      return `${severityMark(c.sev)} ${c.summary}`;
    });
    lines.push(`| [${r.slug}](${r.slug}/summary.md) | ` + cells.join(' | ') + ' |');
  }
  lines.push('', '🔴 high · 🟡 findings · 🟢 clean · ⬜ in-scope but no output (void) · ❔ severity outside the canon (not clean) · – not applicable', '');

  // ── Coverage voids ────────────────────────────────────────────────────────
  // A void = an in-scope check that produced no trustworthy result (noscan). A `skip` cell is n/a
  // (appliesIf miss): summary.md says n/a for it, so listing it here contradicted that file.
  const voidRows = coverageVoidRows(ranked, ids);
  const noscanCount = ranked.reduce((n, r) => n + Object.values(r.cells).filter((c) => c.sev === 'noscan').length, 0);
  lines.push('## Coverage voids', '',
    `${noscanCount} in-scope check(s) produced no output (⬜) across ${voidRows.length} repo(s). ` +
    'A void is not a clean result — a tool that could not run leaves a gap, not a pass.', '');
  if (voidRows.length) {
    lines.push('| Repo | Voided checks |', '|---|---|');
    for (const r of voidRows) lines.push(`| [${r.slug}](${r.slug}/summary.md) | ${r.voids.join('; ')} |`);
  } else {
    lines.push('_No voids — every in-scope check produced output._');
  }
  lines.push('');

  // ── Degraded lanes ────────────────────────────────────────────────────────
  // A DIFFERENT FACT FROM THE VOIDS ABOVE, and deliberately its own section rather than another
  // column in that table. A void is a check that produced nothing; a degraded lane is a check that
  // produced something while half-blind. Merging them would lose exactly the distinction this field
  // was added for — the run with 11 real findings and a dead Go analysis lane belongs in neither
  // "clean" nor "void", and before this it had nowhere to be reported at all.
  //
  // Markdown is its own sink: coverageReason interpolates a manifest-supplied log filename, and a
  // pipe there splits the table row. Backslash first, then pipe, or `\|` in the input becomes
  // `\\|`, a literal backslash followed by a live separator (CodeQL js/incomplete-sanitization).
  const mdCell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const degradedRows = degradedLaneRows(ranked, ids);
  if (degradedRows.length) {
    const n = degradedRows.reduce((t, r) => t + r.lanes.length, 0);
    lines.push('## Degraded lanes', '',
      `${n} check(s) ran but could not see everything, across ${degradedRows.length} repo(s). ` +
      'These are NOT voids — each produced output, and any findings it reports are real. ' +
      'They are also not clean: a lane of the check did not run, so the findings are a floor rather than a total.', '');
    lines.push('| Repo | Degraded checks |', '|---|---|');
    for (const r of degradedRows) lines.push(`| [${r.slug}](${r.slug}/summary.md) | ${mdCell(r.lanes.join('; '))} |`);
    lines.push('');
  }
  writeFileSync(join(runDir, 'index.md'), lines.join('\n'));
}

// ── sarif: the run's findings as one SARIF 2.1.0 log per repository ──────────
function exportSarif(runDir, rows, file = null) {
  let written;
  try { written = writeRunSarif({ runDir, rows, toolVersion: commitworkVersion(), generatedAt: nowISO(), file }); } catch (e) { die(`SARIF export failed: ${e.message}`); }
  for (const w of written) {
    console.log(`  ${cyan(w.path)}  ${dim(`${w.results} result(s) · ${w.undetermined} undetermined (in properties) · ${w.notMeasured} lane note(s)`)}`);
  }
  return written;
}

function cmdSarif(manifest, opts, positional) {
  const from = opts.from || positional[0] || process.cwd();
  const runDir = isAbsolute(from) ? from : resolve(process.cwd(), from);
  if (!existsSync(runDir)) die(`run dir not found: ${runDir}`);
  const { rows } = runRows(manifest, runDir);
  if (!rows.length) die(`${runDir} holds no repository's reports: it is not a commitwork scan or sweep run`);
  const file = opts.out ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)) : null;
  if (file && rows.length !== 1) die(`--out names one SARIF file and this run holds ${rows.length} repositories; omit --out to write ${SARIF_FILE} into each repository's directory`);
  console.log(bold('commitwork sarif') + dim(`  dir=${runDir}  repos=${rows.length}`));
  exportSarif(runDir, rows, file);
}

// ── reindex: regenerate index.md + summaries from report files already on disk ─
// (no checks re-run — use after manually refreshing a report file)
function cmdReindex(manifest, opts) {
  const runDir = opts.out ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)) : process.cwd();
  if (!existsSync(runDir)) die(`run dir not found: ${runDir}`);
  const slugs = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (!slugs.length) die(`no repo subdirs under ${runDir}`);
  console.log(bold('commitwork reindex') + dim(`  baseline=${manifest.repo}  dir=${runDir}  repos=${slugs.length}`));
  const rows = [];
  for (const slug of slugs) {
    const repoDir = join(runDir, slug);
    // recover original repo path from an existing summary, else fall back to the slug
    let repoPath = slug;
    const sm = join(repoDir, 'summary.md');
    if (existsSync(sm)) { const m = readFileSync(sm, 'utf8').match(/Repo:\s*`([^`]+)`/); if (m) repoPath = m[1]; }
    const cells = {};
    for (const check of manifest.checks) {
      if (!check.report) continue;
      const file = join(repoDir, check.report.file);
      // An absent report is n/a here (mirrors scan's skip). Keyed on the file, not the summary: trivy
      // also says 'no report' for a file that does not parse, and that was rendered n/a.
      if (!existsSync(file)) { cells[check.id] = { sev: 'skip', summary: 'n/a' }; continue; }
      const rep = parseReport(check.report.format, file);
      // As classifyReport: a parser that could not read its report is a void, never clean.
      cells[check.id] = { sev: rep.sev || (rep.ok === false ? 'noscan' : 'ok'), summary: rep.summary };
    }
    rows.push({ repo: repoPath, slug, cells });
    writeRepoSummary(repoDir, slug, repoPath, manifest, cells);
  }
  writeIndex(runDir, manifest, rows);
  console.log(green(`  ✓ regenerated ${join(runDir, 'index.md')} + ${rows.length} summaries`));
}

// ── brief: scan a target, then rank what to fix ──────────────────────────────
const gitHead = (repo) => {
  const r = scannedGit(repo, ['rev-parse', 'HEAD'], { timeout: 15_000 });
  return r.status === 0 ? r.stdout.trim() : null;
};

// A sweep batch writes no summary.md; its batch-manifest.json names each repository's path and the
// commit the sweep scanned.
function batchAnchors(runDir) {
  const p = join(runDir, 'batch-manifest.json');
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; die(`${p} could not be read (${e.code || e.message})`); }
  try { return JSON.parse(raw).anchors || {}; } catch (e) { die(`${p} is not JSON (${e.message}); the repositories it names are unknown, not absent`); }
}

// The lane statuses `commitwork run` wrote beside its reports, keyed by check id. Absent only on ENOENT.
function laneStatuses(dir) {
  const p = join(dir, 'checks-status.json');
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return new Map(); die(`${p} could not be read (${e.code || e.message}); which lanes measured is unknown, not all of them`); }
  let rows;
  try { rows = JSON.parse(raw); } catch (e) { die(`${p} is not JSON (${e.message}); which lanes measured is unknown, not all of them`); }
  if (!Array.isArray(rows)) die(`${p} is not an array of lane statuses; which lanes measured is unknown, not all of them`);
  return new Map(rows.filter((r) => r && typeof r.check === 'string').map((r) => [r.check, r]));
}

// The cells a finished run recorded. A run without scan.json (a `run`, an older scan, or a sweep
// batch) is rebuilt from the reports it holds, then from checks-status.json for a lane without one.
// fact: a lane `run` voids for a missing tool writes no report, so the rebuild gave it no cell and the SARIF named no void / `run fast` without gitleaks, semgrep and zizmor exported 0 results and 0 notes for them, measured 2026-10-08 (expiry: never, prev: missing)
function runRows(manifest, runDir) {
  const p = join(runDir, 'scan.json');
  if (existsSync(p)) {
    let doc;
    try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die(`${p} could not be read (${e.message}); the run's cells are unknown, not empty`); }
    return { rows: doc.repos.map((r) => ({ ...r, commit: r.commit ?? null })), rebuilt: false };
  }
  const anchors = batchAnchors(runDir);
  const holdsReports = (dir) => existsSync(join(dir, 'summary.md')) || existsSync(join(dir, 'checks-status.json'))
    || manifest.checks.some((c) => c.report && existsSync(join(dir, c.report.file)));
  const slugs = readdirSync(runDir, { withFileTypes: true }).filter((d) => d.isDirectory() && holdsReports(join(runDir, d.name))).map((d) => d.name).sort();
  const rows = slugs.map((slug) => {
    const repoDir = join(runDir, slug);
    const anchor = anchors[slug] || {};
    let repo = anchor.path || slug;
    const sm = join(repoDir, 'summary.md');
    if (existsSync(sm)) { const m = readFileSync(sm, 'utf8').match(/Repo:\s*`([^`]+)`/); if (m) repo = m[1]; }
    const cells = {};
    const statuses = laneStatuses(repoDir);
    for (const check of manifest.checks) {
      if (!check.report) continue;
      if (existsSync(join(repoDir, check.report.file))) {
        const { sev, summary } = classifyReport(check, repoDir, repo);
        cells[check.id] = { sev, summary, ...laneCoverage(check, repoDir) };
        continue;
      }
      // No report: the status is the only record. A pass without one is left out, as before.
      const st = statuses.get(check.id);
      if (st?.status === 'skip') cells[check.id] = { sev: 'skip', summary: String(st.reason || 'n/a').replace(/^n\/a — /, '') };
      else if (st?.status === 'noscan' || st?.status === 'fail') {
        cells[check.id] = { sev: 'noscan', summary: st.reason || (st.status === 'fail' ? 'the lane failed and wrote no report' : 'no reason recorded'),
          coverage: 'unknown', coverageReason: `wrote no ${check.report.file}` };
      }
    }
    return { repo, slug, commit: anchor.sha || null, cells };
  });
  return { rows, rebuilt: true };
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

// With no target named: on a terminal, offer this directory or the whole PC; otherwise this directory.
async function chooseTarget(cwd, out, skip) {
  const here = resolveScanPath(cwd, { outBase: out.base });
  if (!process.stdin.isTTY || !process.stdout.isTTY) return { mode: 'path', resolved: here };
  console.log(bold('commitwork brief') + dim('  no target named'));
  console.log(here.ok ? `  1) this directory: ${here.path} (${discoverRepos([here.path], skip).length} repositories)` : `  1) this directory: ${dim(here.error)}`);
  console.log(`  2) the whole PC: every repository under ${homedir()}, each scanned on its own`);
  const pick = await ask(`Choice [${here.ok ? '1' : '2'}]: `) || (here.ok ? '1' : '2');
  if (pick === '2') return { mode: 'pc' };
  if (pick === '1') return { mode: 'path', resolved: here };
  die(`no such choice: ${pick}`);
}

async function cmdBrief(manifest, opts, positional) {
  const nowMs = process.env.CW_NOW ? Date.parse(process.env.CW_NOW) : Date.now();
  if (!Number.isFinite(nowMs)) die(`CW_NOW is not a date: ${process.env.CW_NOW}`);
  let runDir;
  let rows;
  let target;
  let rebuilt = false;
  if (opts.from) {
    runDir = isAbsolute(opts.from) ? opts.from : resolve(process.cwd(), opts.from);
    if (!existsSync(runDir)) die(`run dir not found: ${runDir}`);
    ({ rows, rebuilt } = runRows(manifest, runDir));
    if (!rows.length) die(`${runDir} holds no repository's reports: it is not a commitwork scan or sweep run, so its brief is unknown, not empty`);
    target = { mode: 'from', runDir };
  } else {
    const outPath = opts.out ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)) : null;
    const sidecar = scanOutDir();
    if (!outPath && !sidecar.ok) die(sidecar.error);
    // The sidecar is guarded even when --out names somewhere else: it holds every earlier report.
    const out = { base: [sidecar.ok ? sidecar.base : null, outPath].filter(Boolean), dir: outPath || sidecar.dir };
    const skip = opts.skip || [];
    const named = positional[0] || opts.roots?.[0];
    let choice = opts.pc ? { mode: 'pc' }
      : named ? { mode: 'path', resolved: resolveScanPath(isAbsolute(named) ? named : resolve(process.cwd(), named), { outBase: out.base }) }
        : await chooseTarget(process.cwd(), out, skip);
    let repos;
    if (choice.mode === 'pc') {
      const found = discoverPcRepos({ outBase: out.base, skip, includeCollections: !!opts.includeCollections });
      repos = found.repos;
      target = { mode: 'pc', root: homedir(), excluded: found.excluded.length, unreadable: found.errors.length,
        collections: found.collections, collectionsIncluded: !!opts.includeCollections };
      console.log(dim(`  the whole PC: ${repos.length} repositories under ${homedir()}`));
      for (const e of found.excluded) console.log(dim(`    excluded ${e.path}: ${e.reason}`));
      for (const c of found.collections) console.log(dim(`    ${opts.includeCollections ? 'included' : 'set aside'}: ${c.dir} (${c.count} repositories; a collection, not projects${opts.includeCollections ? '' : '; --include-collections scans them'})`));
      if (found.errors.length) console.log(dim(`    ${found.errors.length} director${found.errors.length === 1 ? 'y' : 'ies'} could not be read, so the list may be incomplete: ${found.errors.slice(0, 3).map((e) => `${e.path} (${e.code})`).join(', ')}`));
      if (!opts.dryRun && process.stdin.isTTY && process.stdout.isTTY && !opts.yes) {
        const yes = await ask(`Scan ${repos.length} repositories? [y/N]: `);
        if (!/^y(es)?$/i.test(yes)) { console.log('  not started'); return; }
      }
    } else {
      if (!choice.resolved.ok) die(`${choice.resolved.error}${/credential store|contains the commitwork checkout/.test(choice.resolved.error) ? '\n  to scan every repository on this machine instead, run: commitwork brief --pc' : ''}`);
      repos = discoverRepos([choice.resolved.path], skip);
      target = { mode: 'path', root: choice.resolved.path };
    }
    if (!repos.length) die(`no git repositories found for ${target.mode === 'pc' ? 'the whole PC' : target.root}`);
    if (opts.dryRun) { for (const r of repos) console.log(r); return; }
    const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    runDir = outPath || join(out.dir, `brief-${stamp}`);
    ({ rows } = cmdScan(manifest, { ...opts, sarif: false, repos, out: runDir }));
    for (const r of rows) r.commit = gitHead(r.repo);
  }
  if (opts.sarif) exportSarif(runDir, rows);
  const brief = buildBrief({ runDir, rows, manifest, kev: loadKevCatalog(undefined, { now: nowMs }), epss: loadEpssScores(),
    generatedAt: new Date(nowMs).toISOString(), target: { ...target, ...(rebuilt ? { rebuilt: 'scan.json absent: a lane that wrote no report is listed only when checks-status.json records it' } : {}) } });
  writeAtomic(join(runDir, 'brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
  writeAtomic(join(runDir, 'brief.md'), renderBriefMarkdown(brief));
  writeAtomic(join(runDir, 'brief.html'), renderBriefHtml(brief));
  if (opts.tui && process.stdin.isTTY && process.stdout.isTTY) await runBriefTui(brief, { color: colorEnabled });
  else {
    if (opts.tui) console.error(dim('  --tui needs an interactive terminal; printing the brief instead'));
    console.log('');
    process.stdout.write(renderBriefText(brief));
  }
  console.log('');
  console.log(`  ${cyan(join(runDir, 'brief.html'))}  ${dim('(also brief.md, brief.json)')}`);
}

// ── scan-images: CVE-scan local container images (OS + lang layers) via Trivy ──
function listDockerImages() {
  const r = spawnSync('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', 'dangling=false'], { encoding: 'utf8', timeout: 30_000 });
  if (r.status !== 0) die(`docker images did not answer (${r.error ? r.error.code : `exit ${r.status}`}) — the image list is unknown, not empty`);
  return [...new Set((r.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => !s.includes('<none>')))].sort();
}

// Trivy's own deadline. Read at CALL time so a test can shorten it; a scanner with no bound is a
// hang that renders as a missing report, which is the same green this function used to print.
const TRIVY_TIMEOUT_MS = () => Number(process.env.CW_TRIVY_TIMEOUT_MS) || 600_000;

function cmdScanImages(opts) {
  if (!dockerUp()) die('docker daemon not running');
  if (!hasTool('trivy')) die('trivy not installed (brew install trivy)');
  let images = listDockerImages();
  const filt = opts.filter || [];
  if (filt.length) images = images.filter((img) => filt.some((f) => img.includes(f)));
  const skip = opts.skip || [];
  if (skip.length) images = images.filter((img) => !skip.some((s) => img.includes(s)));
  if (!images.length) die('no local images matched (filters: ' + (filt.join(', ') || 'none') + ')');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = opts.out ? (isAbsolute(opts.out) ? opts.out : resolve(process.cwd(), opts.out)) : join(ROOT, 'reports', `images-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  console.log(bold('commitwork scan-images') + dim(`  images=${images.length}  out=${runDir}`));
  if (filt.length) console.log(dim(`  filter: ${filt.join(', ')}`));
  console.log('');

  const rows = [];
  const usedSlugs = new Set();
  for (const img of images) {
    let slug = img.replace(/[\/:@]/g, '_');
    while (usedSlugs.has(slug)) slug = `${slug}_${usedSlugs.size}`;
    usedSlugs.add(slug);
    const imgDir = join(runDir, slug);
    mkdirSync(imgDir, { recursive: true });
    process.stdout.write(`▸ ${bold(img)} `);
    spawnSync('trivy', ['image', '--scanners', 'vuln', '--quiet', '--format', 'json', '--output', join(imgDir, 'trivy.json'), img], { timeout: TRIVY_TIMEOUT_MS(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    // Self-heal: a corrupt local docker layer store (a missing content-store blob, typically from a
    // partial layer write under VM-disk pressure) fails the daemon scan silently -> empty output, and
    // survives rmi+pull because the manifest digest still matches. Retry straight from the registry,
    // which bypasses the local store entirely. (Only works for registry images; locally-built app
    // images aren't pullable, but those are freshly built so not affected.)
    let usedRemote = false;
    const _jf = join(imgDir, 'trivy.json');
    if (!existsSync(_jf) || readFileSync(_jf, 'utf8').length < 100) {
      spawnSync('trivy', ['image', '--image-src', 'remote', '--scanners', 'vuln', '--quiet', '--format', 'json', '--output', _jf, img], { timeout: TRIVY_TIMEOUT_MS(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
      usedRemote = true;
    }
    // NO SHELL. The previous form was defensible and stayed flagged: `img` and the output path went
    // in as $1/$2 positional params rather than concatenated text, so it was not injectable — but it
    // was still a shell invocation carrying a `codeql[...]` comment that suppresses nothing under
    // `codeql database analyze` (that is a Code Scanning platform feature — CLAUDE.md), so the
    // finding simply persisted and the argument had to be re-made by every reader.
    //
    // The shell was only ever there for `>` redirection, and a file descriptor does that natively.
    // Passing the fd as stdout drops the interpreter entirely: no quoting question, nothing to
    // re-parse, and the flag-vs-value boundary is the argv array rather than whitespace.
    const txt = openSync(join(imgDir, 'trivy.txt'), 'w');
    try {
      spawnSync('trivy', ['image', ...(usedRemote ? ['--image-src', 'remote'] : []),
        '--scanners', 'vuln', '--quiet', '--format', 'table', img],
      { timeout: TRIVY_TIMEOUT_MS(), stdio: ['ignore', txt, 'ignore'] });   // stderr discarded, as the `2>/dev/null` did
    } finally { closeSync(txt); }
    const rep = parseReport('trivy', join(imgDir, 'trivy.json'));
    rows.push({ img, slug, rep });
    // UNSCANNED IS ITS OWN STATE. `sev` is undefined when parseReport fails closed (absent or
    // unreadable report), and the previous ternary tested only `sev`, so undefined fell through to
    // green — a scan that never ran was reported as a clean image. parseReport was already correct;
    // the caller discarded its `ok:false`.
    console.log(rep.ok === false ? cyan(`UNSCANNED — ${rep.summary}`)
      : rep.sev === 'high' ? red(rep.summary) : rep.sev === 'med' ? yellow(rep.summary) : green(rep.summary));
  }

  writeImageIndex(runDir, rows);
  console.log('');
  console.log(bold('── image scan complete ──'));
  console.log(`  ${rows.length} images · report index: ${cyan(join(runDir, 'index.md'))}`);
  const highs = rows.filter((r) => r.rep.sev === 'high').sort((a, b) => (b.rep.crit || 0) - (a.rep.crit || 0));
  if (highs.length) {
    console.log(red(`  ${highs.length} image(s) with CRITICAL/HIGH:`));
    for (const r of highs) console.log(red(`    ✗ ${r.img}: ${r.rep.summary}`));
  }
}

export function writeImageIndex(runDir, rows) {
  const sum = (k) => rows.reduce((s, r) => s + (r.rep[k] || 0), 0);
  const unscanned = rows.filter((r) => r.rep.ok === false);
  const ranked = [...rows].sort((a, b) => (b.rep.crit || 0) - (a.rep.crit || 0) || (b.rep.high || 0) - (a.rep.high || 0) || (b.rep.total || 0) - (a.rep.total || 0) || a.img.localeCompare(b.img));
  const lines = [
    `# Container-image CVE scan (Trivy: OS packages + language deps)`, '',
    `${rows.length} local images · scanned ${new Date().toISOString().slice(0, 10)}`, '',
    `**Fleet totals: ${sum('crit')} CRITICAL · ${sum('high')} HIGH · ${sum('med')} MEDIUM · ${sum('low')} LOW**`,
    // A total computed over images that were never scanned is not a fleet total, and stating the
    // count is the difference between a number a reader can trust and one they cannot.
    ...(unscanned.length
      ? ['', `**⚠️ ${unscanned.length} of ${rows.length} image(s) UNSCANNED — no report was produced.** They contribute 0 to every total above and are NOT known to be clean: ${unscanned.map((r) => r.img).join(', ')}`]
      : []), '',
    '| Image | 🔴 Critical | 🟠 High | 🟡 Medium | ⚪ Low | Total |',
    '|---|--:|--:|--:|--:|--:|',
  ];
  for (const r of ranked) {
    const p = r.rep;
    // explicit uncertainty. An absent report has no crit/high/med/low, and a CLEAN image has zeroes —
    // but `p.crit || ''` renders both as empty and `p.total || 0` renders both as 0, so the two rows
    // were BYTE-IDENTICAL. An unscanned image read as a clean one in the published index.
    if (p.ok === false) {
      lines.push(`| [${r.img}](${r.slug}/trivy.txt) | — | — | — | — | **UNSCANNED** |`);
      continue;
    }
    lines.push(`| [${r.img}](${r.slug}/trivy.txt) | ${p.crit || ''} | ${p.high || ''} | ${p.med || ''} | ${p.low || ''} | **${p.total || 0}** |`);
  }
  lines.push(`| **TOTAL** | **${sum('crit')}** | **${sum('high')}** | **${sum('med')}** | **${sum('low')}** | **${rows.reduce((s, r) => s + (r.rep.total || 0), 0)}** |`, '');
  writeFileSync(join(runDir, 'index.md'), lines.join('\n'));
}

// Commands in an experimental group (manifests/feature-charter.json). ON: listed in place and
// labelled; OFF: moved under "experimental (off)", and running one is refused in main().
const EXPERIMENTAL_HELP = {
  'scan-images': [
    '  commitwork scan-images [--filter s] CVE-scan local container images (Trivy:',
    '                                      OS packages + language deps)',
  ],
};
const experimentalOff = () => Object.keys(EXPERIMENTAL_HELP).map((c) => [c, flagFor('cli-command', c)]).filter(([, f]) => f && !f.on);
function helpInPlace(cmd) {
  const f = flagFor('cli-command', cmd);
  if (f && !f.on) return '';
  const lines = [...EXPERIMENTAL_HELP[cmd]];
  if (f) lines[lines.length - 1] += ' [experimental]';
  return lines.join('\n') + '\n';
}
function helpOff() {
  const off = experimentalOff();
  if (!off.length) return '';
  return `\n${bold('experimental (off)')}\n` + off.map(([c, f]) =>
    `${EXPERIMENTAL_HELP[c].join('\n')}\n                                      switched off: ${f.envVar}=on, or panel Settings`).join('\n') + '\n';
}

function usage() {
  console.log(`${bold('commitwork')} — run a repo's GitHub CI locally, without spending Actions minutes

${bold('usage')}
  commitwork list                     list checks + readiness for the manifest
  commitwork run <check|group|all>    run a check, a group, or everything
  commitwork scan --root <dir> ...    run the portable security baseline across
                                      every git repo under one or more roots
${helpInPlace('scan-images')}  commitwork brief [dir] [--pc]       scan a repository or a directory of them (default:
                                      this one; on a terminal, offers the whole PC), then
                                      list fixes: dependency CVEs with KEV first, other
                                      security findings, and every lane that did not run
  commitwork brief --from <run dir>   rebuild the brief for a finished scan or sweep batch
  commitwork brief ... --tui          browse the brief in the terminal instead of printing it
  commitwork sarif [--from <run dir>] [--out <file>]
                                      export a finished run's findings as SARIF 2.1.0:
                                      <run dir>/<repo>/commitwork.sarif per repository,
                                      or one file with --out (single-repository runs)
  commitwork reindex --out <dir>      regenerate index.md + summaries from the
                                      report files already in a scan dir (no re-run)
  commitwork doctor                   report tool/service availability
  commitwork init [--root <dir>]... [--repo <path>]... [--private-dir <dir>] [--dry-run]
                                      create the private store dir, a fleet registry
                                      and ~/.commitwork; never overwrites
  commitwork setup [--yes] [--only a,b]  install missing scanners via the local
                                      package manager (brew/winget/scoop/pipx);
                                      also offered on the first interactive launch
  commitwork hook install [--repo <path>] [--chain] [--lanes secrets,gitleaks] [--unrun block|warn]
                                      a pre-commit hook that checks the staged content
                                      (the index) for secrets before a commit lands;
                                      hook uninstall / hook run (see bin/hook.mjs)
  commitwork help
${helpOff()}
${bold('options')}
  --manifest <path|name>   manifest file, or a bundled name (see the list below)
  --repo <path>            target repo path (overrides manifest.repoPath)
  --root <dir>             (scan) root to discover git repos under; repeatable
  --skip <name>            (scan/scan-images) name substring to exclude; repeatable
  --filter <substr>        (scan-images) only images whose ref contains substr; repeatable
  --out <dir>              (scan) report output dir (default reports/<timestamp>);
                           (brief) default the private scan-path directory (CW_SCAN_PATH_OUT)
  --sarif                  (scan/brief) also write <out>/<repo>/commitwork.sarif
  --pc                     (brief) every repository under the home directory, each scanned
                           on its own; credential stores and this checkout are excluded
  --include-collections    (brief --pc) also scan collections: directories holding 100 or
                           more repositories (CW_PC_COLLECTION_MIN), set aside by default
  --yes                    (brief) skip the --pc confirmation on a terminal
  --url <baseURL>          (scan) live base URL for runtime scanners (single target)
  --urls <file>            (scan) JSON map slug|basename → baseURL for a fleet of running apps
                           ($CW_TARGET_URL also honored; a per-repo commitwork.url file
                           only with --trust-repo-manifest)
  --act                    run via nektos/act where a check defines one (faithful)
  --strict                 fail (don't skip) checks whose requirements are unmet
  --dry-run                (run) print each check's commands without executing them;
                           (brief) list the repositories it would scan
  --trust-repo-manifest    execute commands from a repo-local commitwork.json, run lanes
                           that execute a repo-supplied script (requiresRepoTrust), and
                           honour a repo's commitwork.url
                           (auto-discovered manifests are untrusted by default;
                           also COMMITWORK_TRUST_REPO_MANIFEST=1)
  --no-fail-fast           keep going after a failing check
  --verbose                print the GitHub-only steps each check drops

${bold('env')}
  COMMITWORK_MANIFEST  default --manifest    COMMITWORK_REPO  default --repo

${dim('bundled manifests: ')}${listBundled().join(', ') || '(none)'}`);
}

// ── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { act: false, strict: false, failFast: true, verbose: false, dryRun: false, trustRepoManifest: false, roots: [], skip: [], filter: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--act') opts.act = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--trust-repo-manifest') opts.trustRepoManifest = true;
    else if (a === '--no-fail-fast') opts.failFast = false;
    else if (a === '--pc') opts.pc = true;
    else if (a === '--include-collections') opts.includeCollections = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--from') opts.from = argv[++i];
    else if (a === '--tui') opts.tui = true;
    else if (a === '--sarif') opts.sarif = true;
    else if (a.startsWith('--from=')) opts.from = a.split('=')[1];
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--manifest' || a === '-m') opts.manifest = argv[++i];
    else if (a === '--repo' || a === '-r') opts.repo = argv[++i];
    else if (a === '--root') opts.roots.push(argv[++i]);
    else if (a === '--skip') opts.skip.push(argv[++i]);
    else if (a === '--filter') opts.filter.push(argv[++i]);
    else if (a === '--out' || a === '-o') opts.out = argv[++i];
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--urls') opts.urls = argv[++i];
    else if (a.startsWith('--manifest=')) opts.manifest = a.split('=')[1];
    else if (a.startsWith('--repo=')) opts.repo = a.split('=')[1];
    else if (a.startsWith('--root=')) opts.roots.push(a.split('=')[1]);
    else if (a.startsWith('--skip=')) opts.skip.push(a.split('=')[1]);
    else if (a.startsWith('--filter=')) opts.filter.push(a.split('=')[1]);
    else if (a.startsWith('--out=')) opts.out = a.split('=')[1];
    else if (a.startsWith('--url=')) opts.url = a.split('=')[1];
    else if (a.startsWith('--urls=')) opts.urls = a.split('=')[1];
    else positional.push(a);
  }
  return { opts, positional };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();
  // doctor runs below the floor so it can report it; everything else refuses rather than fail later
  const runtime = nodeFloorCheck();
  if (!runtime.ok && cmd !== 'doctor') { console.error(red(`commitwork: ${runtime.message}`)); process.exitCode = 2; return; }
  // Before first-run setup: a switched-off command does nothing, including offering installs.
  const flag = flagFor('cli-command', cmd);
  if (flag && !flag.on) { console.error(`commitwork ${cmd}: ${offMessage(flag)}`); process.exitCode = 2; return; }
  if (cmd === 'setup') return runSetup(parseSetupArgs(argv.slice(1)));
  if (cmd === 'init') { process.exitCode = runInit(parseInitArgs(argv.slice(1))); return; }
  // ahead of the first-run setup prompt: a commit hook must never stop at an interactive question
  if (cmd === 'hook') { const { main: hookMain } = await import('./hook.mjs'); process.exitCode = hookMain(argv.slice(1)); return; }
  // first interactive launch: check the scanner toolchain and offer to install (once, stamped)
  await ensureFirstRunSetup();

  const { opts, positional } = parseArgs(argv.slice(1));
  // `scan-images` is image-centric (not repo/manifest-bound) — handle before manifest resolution.
  if (cmd === 'scan-images') return cmdScanImages(opts);
  // `scan`/`reindex` default to the portable security baseline and aren't tied to one repoPath.
  if ((cmd === 'scan' || cmd === 'reindex' || cmd === 'brief' || cmd === 'sarif') && !opts.manifest) opts.manifest = 'security-baseline';
  const { path: manifestPath, source: manifestSource } = resolveManifestPath(opts.manifest);
  const manifest = loadManifest(manifestPath);

  // Commands that EXECUTE manifest-supplied shell require provenance trust
  // (list/doctor only inspect; --dry-run only prints).
  if ((cmd === 'run' && !opts.dryRun) || cmd === 'scan' || (cmd === 'brief' && !opts.from && !opts.dryRun)) assertManifestTrusted(manifestSource, manifestPath, opts);

  if (cmd === 'scan') return cmdScan(manifest, opts);
  if (cmd === 'reindex') return cmdReindex(manifest, opts);
  if (cmd === 'sarif') return cmdSarif(manifest, opts, positional);
  if (cmd === 'brief') return cmdBrief(manifest, opts, positional);

  const repoPath = repoPathFor(manifest, opts.repo);
  switch (cmd) {
    case 'list': return cmdList(manifest, repoPath);
    case 'doctor': return cmdDoctor(manifest, repoPath);
    case 'run': return cmdRun(manifest, repoPath, positional[0], opts);
    default: die(`unknown command: ${cmd} (try: list, run, scan, scan-images, reindex, brief, sarif, doctor, setup, init, hook, help)`);
  }
}

// Run the CLI only when invoked directly, not when imported (e.g. by the test suite,
// which needs parseReport/validateManifest without triggering a scan). INC-0: testable internals.
// main() is async (portability commit), so await when we are the entrypoint.
// Point docker/trivy/grype at commitwork's own docker config before anything spawns them —
// see lib/docker-config.mjs. The agents get this declared on their plist; a hand-run scan got
// it from nowhere, which is why the App Data prompt outlived the fleet fix.
if (isMainModule(import.meta.url)) { useScopedDockerConfig(); await main(); }
