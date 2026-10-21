#!/usr/bin/env node
// bin/pre-publish.mjs — the one command to run before anything leaves this repository.
// Gates PUBLICATION, deliberately not commit — a pre-commit gate on sensitive context would be
// bypassed into gate theatre. Publication posture: SENSITIVE-CONTEXT is fatal (--fail-on-context),
// fixture self-declarations are ignored (--no-fixture-exempt), and the committed tree is scanned
// (--head), not the working copy. Fail closed: any path that is not a clean scan exits non-zero.
// The verdict is journalled whichever way it goes — "clean" most needs a timestamp beside it.
//
// usage:
//   node bin/pre-publish.mjs                        # the committed tree (HEAD)
//   node bin/pre-publish.mjs --paths dist/packet    # a specific packet, as it sits on disk
//   node bin/pre-publish.mjs --ref v1.2.0 --json
//   node bin/pre-publish.mjs --no-journal           # do not write a verdict record
//   node bin/pre-publish.mjs --draft-reviews        # pending rows for the sidecar release/reviews.json
//
// exit: 0 nothing to declare · 1 findings — do not publish · 2 the check could not be completed
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journal } from './lib/verdict-journal-core.mjs';
import { loadReviews, applyReviews, blobShas, draftRows, BLOCKING } from './lib/release-reviews.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SCANNER = join(HERE, 'secrets-sweep.mjs');
const GATE = 'pre-publish';

export function parseArgs(argv) {
  const opts = { paths: null, ref: null, json: false, journalIt: true, draft: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-journal') opts.journalIt = false;
    else if (a === '--draft-reviews') opts.draft = true;
    else if (a === '--paths') {
      const v = argv[++i];
      if (!v) return { error: '--paths needs a value' };
      opts.paths = v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--ref') {
      const v = argv[++i];
      if (!v) return { error: '--ref needs a value' };
      opts.ref = v;
    } else if (a === '--help' || a === '-h') opts.help = true;
    else return { error: `unknown flag: ${a}` };
  }
  if (opts.paths && opts.ref) return { error: '--paths and --ref name different worlds; pick one' };
  return opts;
}

/**
 * Run the scanner with the publication posture. Returns {code, result, error}.
 * A scanner that cannot be run at all yields code 2 — never a clean result.
 */
export function runScan({ paths = null, ref = null, root = null } = {}) {
  // Read the seam at call time — a module-load default silently defeats CW_SECRETS_ROOT.
  root = root || process.env.CW_SECRETS_ROOT || REPO;
  const args = ['--json', '--fail-on-context', '--no-fixture-exempt'];
  if (paths) args.push('--paths', paths.join(','));
  else args.push('--head', ref || 'HEAD');   // the committed tree is what ships

  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [SCANNER, ...args], {
      cwd: root, encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, CW_SECRETS_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 2;
    stdout = String(e.stdout || '');
    if (code !== 1 && code !== 0) {
      // Scanner failed rather than found: report 2 — never 0, and never 1 ("findings").
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* no result to salvage */ }
      return { code: 2, result: parsed, error: `scanner exited ${code}: ${String(e.stderr || '').trim().slice(0, 400)}` };
    }
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    return { code: 2, result: null, error: 'scanner produced no parseable result' };
  }
  return { code, result, error: null };
}

/** Attach the reviewed-disposition split to a scan. A review that cannot be read fails the scan. */
export function reviewScan(scan, { paths = null, ref = null, root = null } = {}) {
  if (scan.error || !scan.result) return scan;
  root = root || process.env.CW_SECRETS_ROOT || REPO;
  try {
    const reviews = loadReviews();
    const shas = blobShas(root, scan.result.unscanned.map((u) => u.file), paths ? null : (ref || 'HEAD'));
    return { ...scan, review: { source: reviews.source, ...applyReviews(scan.result, reviews, shas) } };
  } catch (e) {
    return { ...scan, error: `reviews: ${e.message}` };
  }
}

export function verdictFor({ result, error, review = null }) {
  if (error || !result) return { verdict: 'cannot-check', publish: false, exit: 2 };
  if (result.failures.length) return { verdict: 'cannot-check', publish: false, exit: 2 };
  const open = (v) => (review ? review.unreviewed.filter((f) => f.verdict === v).length : result.summary[v] || 0);
  if (open('REAL-SECRET') > 0) return { verdict: 'blocked-secret', publish: false, exit: 1 };
  if (open('SENSITIVE-CONTEXT') > 0) return { verdict: 'blocked-context', publish: false, exit: 1 };
  const unscanned = review ? review.assetsUnreviewed.length : result.unscanned.length;
  if (unscanned) return { verdict: 'unreviewed-unscanned', publish: false, exit: 2 };
  if (review && (review.reviewed.length || review.assetsReviewed.length)) return { verdict: 'clean-reviewed', publish: true, exit: 0 };
  return { verdict: 'clean', publish: true, exit: 0 };
}

export function reviewCounts(review) {
  if (!review) return null;
  const by = (rows) => Object.fromEntries(BLOCKING.map((v) => [v, rows.filter((f) => f.verdict === v).length]));
  return {
    source: review.source,
    reviewed: by(review.reviewed),
    open: by(review.unreviewed),
    assetsReviewed: review.assetsReviewed.length,
    assetsOpen: review.assetsUnreviewed.length,
    stale: review.stale.length,
  };
}

const HELP = `commitwork pre-publish — the check before anything leaves this repository

  node bin/pre-publish.mjs [--paths <p>[,<p>…] | --ref <rev>] [--json] [--no-journal] [--draft-reviews]

  Runs bin/secrets-sweep.mjs in publication posture: sensitive context is FATAL, self-declared
  fixture exemptions are IGNORED, and the COMMITTED tree is scanned rather than the working copy.
  Findings and unscanned blobs are settled only by reviewed rows in the sidecar's
  release/reviews.json, read from its HEAD (CW_RELEASE_REVIEWS reads a file instead).
  --draft-reviews prints pending rows for everything still open.
  Deliberately not a pre-commit hook — see the header of this file.

  exit: 0 nothing to declare · 1 findings, do not publish · 2 the check could not be completed`;

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.error) { process.stderr.write(`${opts.error}\n\n${HELP}\n`); return 2; }
  if (opts.help) { process.stdout.write(`${HELP}\n`); return 0; }

  let scan;
  try {
    scan = reviewScan(runScan({ paths: opts.paths, ref: opts.ref }), { paths: opts.paths, ref: opts.ref });
  } catch (e) {
    scan = { code: 2, result: null, error: `pre-publish aborted: ${e && e.message ? e.message : e}` };
  }
  const v = verdictFor(scan);
  const target = opts.paths ? opts.paths.join(',') : `ref:${opts.ref || 'HEAD'}`;
  const summary = scan.result?.summary ?? null;
  const reviews = reviewCounts(scan.review);

  if (opts.journalIt) {
    const res = journal(GATE, {
      kind: 'gate', verdict: v.verdict, publish: v.publish, target,
      summary, unscanned: scan.result?.unscanned?.length ?? null,
      failures: scan.result?.failures?.length ?? null,
      reviews,
      error: scan.error ?? null,
    }, { session: 'pre-publish' });
    if (!res.ok) {
      // An unrecorded PASS is downgraded to cannot-check.
      process.stderr.write(`pre-publish: verdict not journalled: ${res.error}\n`);
      if (v.exit === 0) {
        v.verdict = 'cannot-check';
        v.publish = false;
        v.exit = 2;
        process.stderr.write('pre-publish: a pass that cannot be recorded is not a pass.\n');
      }
    }
  }

  if (opts.draft) {
    if (!scan.review) { process.stderr.write(`pre-publish: no draft: ${scan.error || 'no review split'}\n`); return 2; }
    process.stdout.write(`${JSON.stringify(draftRows(scan.review), null, 2)}\n`);
    return v.exit;
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      verdict: v.verdict, publish: v.publish, target, summary, reviews,
      open: scan.review?.unreviewed ?? null,
      openAssets: scan.review?.assetsUnreviewed ?? null,
      error: scan.error ?? null,
    }, null, 2)}\n`);
    return v.exit;
  }

  const L = [`pre-publish — ${target}`, ''];
  if (scan.error) L.push(`  ERROR  ${scan.error}`);
  if (summary) {
    const rv = (k) => (reviews ? `   (${reviews.reviewed[k]} reviewed, ${reviews.open[k]} open)` : '');
    L.push(`  REAL-SECRET        ${summary['REAL-SECRET']}${rv('REAL-SECRET')}`);
    L.push(`  SENSITIVE-CONTEXT  ${summary['SENSITIVE-CONTEXT']}${rv('SENSITIVE-CONTEXT')}   (fatal here; advisory elsewhere)`);
    L.push(`  FALSE-POSITIVE     ${summary['FALSE-POSITIVE']}`);
    L.push(`  files scanned      ${summary.scannedFiles}`);
    L.push(`  UNSCANNED          ${summary.unscannedFiles}${reviews ? `   (${reviews.assetsReviewed} reviewed, ${reviews.assetsOpen} open)` : ''}   (not scanned is not clean)`);
    L.push(`  scan failures      ${summary.scanFailures}`);
    if (reviews) L.push(`  reviews            ${reviews.source}${reviews.stale ? ` · ${reviews.stale} stale row(s)` : ''}`);
  }
  L.push('');
  L.push(v.publish
    ? `  VERDICT: ${v.verdict} — nothing to declare.`
    : `  VERDICT: ${v.verdict} — DO NOT PUBLISH.`);
  if (!v.publish && v.exit === 1) {
    L.push('  Run `node bin/secrets-sweep.mjs --head --fail-on-context --no-fixture-exempt --all`');
    L.push('  for the itemised list. Rotate any REAL-SECRET before scrubbing it.');
  }
  if (v.verdict === 'unreviewed-unscanned') {
    for (const a of scan.review.assetsUnreviewed) L.push(`    unreviewed  ${a.file}  ${a.blob || '(no blob hash)'}`);
  }
  if (!v.publish && scan.review) L.push('  --draft-reviews prints pending rows for release/reviews.json in the sidecar.');
  process.stdout.write(`${L.join('\n')}\n`);
  return v.exit;
}

// exitCode, not exit(): process.exit() truncates async piped stdout.
if (isMainModule(import.meta.url)) process.exitCode = main();
