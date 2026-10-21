#!/usr/bin/env node
// docsite-publish-scheduled.mjs — publish the docsite from a ref's COMMITTED content, unattended.
// Exports the ref with `git archive` (and, when this checkout has a private docsite root, that
// root's committed tree from its own repository), runs the docsite checks inside the export, and
// assembles and deploys the bundle with the export's own bin/docsite-publish.mjs. The working tree
// is never read: a shared checkout holds other sessions' uncommitted edits.
//
// usage: node bin/docsite-publish-scheduled.mjs [--ref <ref>] [--repo <dir>] [--force] [--public-only] [--dry-run]
//        node bin/docsite-publish-scheduled.mjs --status [--limit <n>]
// exit: 0 published, unchanged, already live, dry run clean, or status shown · 20 refused: a check
//       failed at the named stage, or still fails for this ref · 21 the deploy failed or named no
//       deployment · 22 an input could not be read (the ref, an export, the ledger) · 23 another
//       publish holds the lock · 24 usage
// env, read at call time: CW_DOCSITE_PUBLISH_LEDGER (default <reports>/docsite-publish/attempts.jsonl),
//   CW_REPORTS_ROOT, CW_DOCSITE_PRIVATE (the private root, via monitor/store-paths.mjs), CW_NOW, and
//   what bin/docsite-publish.mjs reads for the deploy (CW_WRANGLER, CW_DOCSITE_PROJECT,
//   CW_DOCSITE_BRANCH, CW_CLOUDFLARE_ZONE_ID, CW_DOCSITE_NO_PURGE)
//
// Stages, each named in the ledger when it fails: export, private-root, build (a docsite-build
// check), doctor (docs-doctor), tests (bin/test/docsite-*.test.mjs), bundle (a docsite-publish dry
// run), deploy. One JSON line per attempt; a run that finds the ref and private tree already live,
// or a check failure already recorded for them, writes nothing. A bundle byte-identical to the last
// live one is recorded as `unchanged` and not deployed.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { acquireLock, writeAtomic } from '../monitor/lockfile.mjs';
import { privateDocsiteDirFor, reportsRootFor } from '../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXIT = { OK: 0, REFUSED: 20, DEPLOY: 21, UNREADABLE: 22, LOCKED: 23, USAGE: 24 };
// Failures at these stages repeat for the same inputs, so they are not retried without --force.
export const CHECK_STAGES = new Set(['private-root', 'build', 'doctor', 'tests', 'bundle']);
const TIMEOUT = { build: 120_000, doctor: 120_000, tests: 600_000, bundle: 300_000, deploy: 600_000 };

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const nowIso = () => process.env.CW_NOW || new Date().toISOString();

export const ledgerPath = (repo = REPO) => (process.env.CW_DOCSITE_PUBLISH_LEDGER
  ? resolve(process.env.CW_DOCSITE_PUBLISH_LEDGER)
  : join(reportsRootFor(repo), 'docsite-publish', 'attempts.jsonl'));

/** Every attempt, oldest first. Absent = none; a line that is not JSON is an error, never a skip. */
export function readLedger(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (text && !text.endsWith('\n')) throw new Error(`${path}: the last line is incomplete`);
  return text.split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`${path}: line ${i + 1} is not JSON`); }
  });
}

function appendLedger(path, record) {
  let prior = '';
  try { prior = readFileSync(path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  writeAtomic(path, `${prior}${JSON.stringify(record)}\n`, { mkdir: true });
}

/** sha256 over every bundle file's relative path and bytes, in sorted path order. */
export function bundleDigest(dir) {
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(dir);
  const rows = files.map((f) => [relative(dir, f).split(sep).join('/'), f]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash('sha256');
  for (const [rel, full] of rows) h.update(`${rel}\0${createHash('sha256').update(readFileSync(full)).digest('hex')}\n`);
  return { digest: h.digest('hex'), files: rows.length };
}

function exportTree(repo, treeish, dest) {
  const tar = join(dest, '..', `${dest.split(sep).pop()}.tar`);
  git(repo, ['archive', '--format=tar', '-o', tar, treeish]);
  try { execFileSync('tar', ['-x', '-f', tar, '-C', dest], { stdio: ['ignore', 'pipe', 'pipe'] }); } finally { rmSync(tar, { force: true }); }
}

/**
 * The private root's committed tree, or null when this checkout has none. A root that exists but
 * whose content is not committed in a repository throws: what would publish could not be named.
 */
export function resolvePrivateRoot(repo) {
  let dir;
  try { dir = realpathSync(privateDocsiteDirFor(repo)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  let top;
  let prefix;
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']);
    prefix = git(dir, ['rev-parse', '--show-prefix']).replace(/\/$/, '');
  } catch { throw new Error(`the private docsite root ${dir} is not inside a git repository, so its committed content cannot be named`); }
  let tree;
  try { tree = git(top, ['rev-parse', '--verify', prefix ? `HEAD:${prefix}` : 'HEAD^{tree}']); } catch {
    throw new Error(`the private docsite root ${dir} has no committed content at its repository's HEAD`);
  }
  return { dir, top, tree };
}

function defaultRun(stage, argv, { cwd, env }) {
  const r = spawnSync(process.execPath, argv, { cwd, env, encoding: 'utf8', timeout: TIMEOUT[stage], maxBuffer: 1 << 26 });
  const timedOut = r.error && r.error.code === 'ETIMEDOUT';
  return { status: timedOut ? null : r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? (timedOut ? `timed out after ${TIMEOUT[stage] / 1000}s` : r.error.message) : null };
}

const tail = (r) => `${r.error ? `${r.error}; ` : ''}${`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-4).join(' | ')}` || `exit ${r.status}`;

// Children see the export, never the operator's fixture or dist overrides, and git inside an
// export cannot climb into whatever repository holds the temp dir.
function childEnv(base, exportDir, extra) {
  const env = { ...base };
  for (const k of ['CW_DOCSITE_ROOT', 'CW_DOCSITE_DIST', 'NODE_TEST_CONTEXT']) delete env[k];
  Object.assign(env, { GIT_CEILING_DIRECTORIES: dirname(exportDir) }, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env;
}

// The suites set their own fixtures; anything that could reach the live private root, a real
// deploy target or a cache purge is removed.
function testEnv(base, exportDir) {
  const env = childEnv(base, exportDir, { CW_DOCSITE_NO_PURGE: '1' });
  for (const k of Object.keys(env)) if (/^CW_(DOCSITE_(?!NO_PURGE)|WRANGLER|CLOUDFLARE_)/.test(k)) delete env[k];
  return env;
}

/**
 * One scheduled publish. `run(stage, argv, { cwd, env })` executes a node script and returns
 * { status, stdout, stderr, error }; tests inject it so no command and no deploy is real.
 */
export function publishScheduled({
  repo = REPO, ref = 'main', force = false, dryRun = false, publicOnly = false,
  run = defaultRun, log = (s) => console.log(s), env = process.env,
} = {}) {
  const ledger = ledgerPath(repo);
  let records;
  try { records = readLedger(ledger); } catch (e) { log(`docsite-publish-scheduled: ledger unreadable: ${e.message}`); return { code: EXIT.UNREADABLE }; }

  let sha;
  try { sha = git(repo, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]); } catch (e) {
    log(`docsite-publish-scheduled: cannot resolve ${ref} in ${repo}: ${(e.stderr || e.message).toString().trim()}`);
    return { code: EXIT.UNREADABLE };
  }
  const short = sha.slice(0, 12);
  let priv = null;
  let privErr = null;
  if (!publicOnly) { try { priv = resolvePrivateRoot(repo); } catch (e) { privErr = e.message; } }
  const privateTree = priv ? priv.tree : null;

  const lastLive = records.filter((r) => r.ok).at(-1);
  if (!force && !dryRun && !privErr && lastLive && lastLive.sha === sha && lastLive.privateTree === privateTree) {
    log(`${short} is already live${lastLive.deploymentId ? ` as ${lastLive.deploymentId}` : ''}; nothing to publish`);
    return { code: EXIT.OK, skipped: 'live' };
  }
  const lastSame = records.filter((r) => r.sha === sha && r.privateTree === privateTree).at(-1);
  if (!force && !dryRun && !privErr && lastSame && !lastSame.ok && CHECK_STAGES.has(lastSame.stage)
    && !(publicOnly && lastSame.stage === 'private-root')) {
    log(`${short} was refused at ${lastSame.stage} on ${lastSame.at}: ${lastSame.error}\n  run with --force after fixing it`);
    return { code: EXIT.REFUSED, skipped: 'refused' };
  }

  let lock = null;
  if (!dryRun) {
    try { lock = acquireLock(`${ledger}.lock`, { label: 'docsite-publish-scheduled', staleMs: 60 * 60_000 }); } catch (e) {
      log(`docsite-publish-scheduled: cannot take the lock: ${e.message}`);
      return { code: EXIT.UNREADABLE };
    }
    if (!lock.ok) { log('docsite-publish-scheduled: another publish holds the lock'); return { code: EXIT.LOCKED }; }
  }

  const base = { at: nowIso(), ref, sha, privateTree };
  const finish = (code, fields) => {
    const record = { ...base, ...fields };
    if (!dryRun) {
      try { appendLedger(ledger, record); } catch (e) {
        log(`docsite-publish-scheduled: could not record the attempt in ${ledger}: ${e.message}\n  ${JSON.stringify(record)}`);
        return { code: EXIT.UNREADABLE, record };
      }
    }
    const verdict = record.ok ? record.result : `${record.result} at ${record.stage}: ${record.error}`;
    log(`${short} ${dryRun ? '(dry run) ' : ''}${verdict}${record.deploymentId ? ` ${record.deploymentId}` : ''}`);
    return { code, record };
  };
  const refuse = (stage, error) => finish(EXIT.REFUSED, { ok: false, result: 'refused', stage, error });

  const work = mkdtempSync(join(tmpdir(), 'cw-docsite-sched-'));
  try {
    if (privErr) return finish(EXIT.UNREADABLE, { ok: false, result: 'failed', stage: 'export', error: privErr });
    if (!priv && lastLive && lastLive.privateTree && !publicOnly) {
      return refuse('private-root', 'the last live publish carried the private docsite root and this checkout has none; '
        + 'publishing would withdraw its hidden documents. Pass --public-only to publish the public site alone');
    }
    const exp = join(work, 'export');
    mkdirSync(exp);
    let privExp = join(work, 'no-private-root');
    try {
      exportTree(repo, sha, exp);
      if (priv) { privExp = join(work, 'private'); mkdirSync(privExp); exportTree(priv.top, priv.tree, privExp); }
    } catch (e) {
      return finish(EXIT.UNREADABLE, { ok: false, result: 'failed', stage: 'export', error: String(e.stderr || e.message).trim().split('\n')[0] });
    }

    const envFor = (extra = {}) => childEnv(env, exp, { CW_DOCSITE_PRIVATE: privExp, ...extra });
    const step = (stage, argv, stageEnv) => {
      const r = run(stage, argv, { cwd: exp, env: stageEnv });
      return r.status === 0 && !r.error ? null : r;
    };

    let r = step('build', [join(exp, 'bin', 'docsite-build.mjs'), '--check'], envFor());
    if (r) return refuse('build', tail(r));
    r = step('doctor', [join(exp, 'bin', 'docs-doctor.mjs')], envFor({ CW_DOCS_GIT: '0', CW_DOCS_CACHE: '0' }));
    if (r) return refuse('doctor', tail(r));
    let suites = [];
    try { suites = readdirSync(join(exp, 'bin', 'test')).filter((f) => /^docsite-.*\.test\.mjs$/.test(f)).sort(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!suites.length) return refuse('tests', 'the export has no bin/test/docsite-*.test.mjs, so the docsite is untested');
    r = step('tests', ['--test', '--test-reporter=tap', ...suites.map((f) => join(exp, 'bin', 'test', f))], testEnv(env, exp));
    if (r) return refuse('tests', tail(r));

    const dist = join(work, 'bundle');
    mkdirSync(dist);
    r = step('bundle', [join(exp, 'bin', 'docsite-publish.mjs'), '--dry-run'], envFor({ CW_DOCSITE_DIST: dist }));
    if (r) return refuse('bundle', tail(r));
    const { digest, files } = bundleDigest(dist);
    if (!files) return refuse('bundle', 'the bundle is empty');

    if (!force && lastLive && lastLive.bundleDigest === digest) {
      return finish(EXIT.OK, { ok: true, result: 'unchanged', bundleDigest: digest, files, deploymentId: lastLive.deploymentId || null });
    }
    if (dryRun) { log(`${short} checks pass; bundle ${digest.slice(0, 12)} (${files} files) would deploy`); return { code: EXIT.OK }; }

    const deployDist = join(work, 'deploy');
    mkdirSync(deployDist);
    const d = run('deploy', [join(exp, 'bin', 'docsite-publish.mjs')], { cwd: exp, env: envFor({ CW_DOCSITE_DIST: deployDist }) });
    if (d.status !== 0 || d.error) return finish(EXIT.DEPLOY, { ok: false, result: 'failed', stage: 'deploy', error: tail(d), bundleDigest: digest });
    const out = `${d.stdout}\n${d.stderr}`;
    const m = out.match(/https:\/\/([0-9a-f]{8})\.[a-z0-9-]+\.pages\.dev\b/);
    if (!m) return finish(EXIT.DEPLOY, { ok: false, result: 'failed', stage: 'deploy', error: 'the deploy exited 0 but named no deployment URL, so what went live is unknown', bundleDigest: digest });
    const edge = (out.match(/^edge cache: (.*)$/m) || [])[1] || null;
    return finish(EXIT.OK, { ok: true, result: 'published', deploymentId: m[1], url: m[0], bundleDigest: digest, files, edgeCache: edge });
  } catch (e) {
    return finish(EXIT.UNREADABLE, { ok: false, result: 'failed', stage: 'internal', error: String(e.message || e).split('\n')[0] });
  } finally {
    rmSync(work, { recursive: true, force: true });
    if (lock) lock.release();
  }
}

/** The last `limit` attempts, newest last, one line each. */
export function statusLines(records, limit = 10) {
  return records.slice(-limit).map((r) => [
    r.at, (r.sha || '').slice(0, 12), r.ok ? r.result : `${r.result} at ${r.stage}`,
    r.deploymentId || '', r.ok ? '' : r.error,
  ].filter(Boolean).join('  '));
}

function main(argv) {
  const known = new Set(['--status', '--force', '--dry-run', '--public-only', '--ref', '--repo', '--limit']);
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    if (!known.has(argv[i])) { console.error(`docsite-publish-scheduled: unknown argument ${argv[i]}`); return EXIT.USAGE; }
    if (['--ref', '--repo', '--limit'].includes(argv[i])) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) { console.error(`docsite-publish-scheduled: ${argv[i]} needs a value`); return EXIT.USAGE; }
      i++;
    }
  }
  const repo = resolve(opt('--repo') || REPO);
  if (argv.includes('--status')) {
    const limit = Number(opt('--limit') || 10);
    if (!Number.isInteger(limit) || limit < 1) { console.error('docsite-publish-scheduled: --limit takes a positive integer'); return EXIT.USAGE; }
    let records;
    try { records = readLedger(ledgerPath(repo)); } catch (e) { console.error(`docsite-publish-scheduled: ledger unreadable: ${e.message}`); return EXIT.UNREADABLE; }
    if (!records.length) console.log(`no publish attempts recorded in ${ledgerPath(repo)}`);
    for (const line of statusLines(records, limit)) console.log(line);
    return EXIT.OK;
  }
  return publishScheduled({
    repo, ref: opt('--ref') || 'main', force: argv.includes('--force'), dryRun: argv.includes('--dry-run'), publicOnly: argv.includes('--public-only'),
  }).code;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
