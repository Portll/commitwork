#!/usr/bin/env node
// commitwork verify-branch-protection — A5: probe live GitHub branch-protection
// required-status-checks against manifests/branch-protection.json.
//
// usage: node bin/verify-branch-protection.mjs [--manifest <path>] [--snapshot <dir>]
//   --manifest <path>   read the expected-set manifest from here (relative to CWD if relative)
//   --snapshot <dir>    also write the raw live-query result, timestamped, into this dir
//
// Exit codes:
//   0  PASS            live required-checks ⊇ expected (empty==empty passes with a loud WARNING)
//   3  MISMATCH        an expected check is missing from a CONFIRMED live read
//   4  CANNOT-VERIFY   gh/network/manifest failure or an UNRESOLVED live state — never green
//
// Plan-gate: on a private repo the protection detail APIs 403 regardless of protection
// state; the un-gated branches/<branch> `protected` boolean distinguishes confirmed
// unprotected from protected-but-opaque.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const tty = process.stdout.isTTY;
const col = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => col('1', s), dim = (s) => col('2', s), red = (s) => col('31', s), grn = (s) => col('32', s), yel = (s) => col('33', s), cy = (s) => col('36', s);

const A = process.argv.slice(2);
const opt = (k) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : undefined; };
const manifestPath = resolve(opt('--manifest') || join(ROOT, 'manifests', 'branch-protection.json'));
const snapshotDir = opt('--snapshot') ? resolve(opt('--snapshot')) : null;

const stamp = () => new Date().toISOString();

function die(code, title, detail) {
  console.error(red(bold(`\n${title}`)));
  if (detail) console.error(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
  process.exit(code);
}

// ── manifest ────────────────────────────────────────────────────────────────
if (!existsSync(manifestPath)) die(4, `CANNOT-VERIFY: manifest not found at ${manifestPath}`, 'Nothing to check against — hard stop, not a skip.');
let manifest;
try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
catch (e) { die(4, `CANNOT-VERIFY: manifest at ${manifestPath} is not valid JSON`, String(e)); }
const repos = Array.isArray(manifest.repos) ? manifest.repos : [];
if (!repos.length) die(4, 'CANNOT-VERIFY: manifest has no repos[] entries', manifestPath);

console.log(dim(`manifest: ${manifestPath}`));

// ── gh preflight ────────────────────────────────────────────────────────────
const ghVersion = spawnSync('gh', ['--version'], { stdio: 'ignore' });
if (ghVersion.error || ghVersion.status !== 0) die(4, 'CANNOT-VERIFY: `gh` CLI not found on PATH', 'Install/auth the GitHub CLI. This probe refuses to report green without a real query.');

const ghAuth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
if (ghAuth.status !== 0) die(4, 'CANNOT-VERIFY: `gh auth status` failed — not authenticated', ghAuth.stderr || ghAuth.stdout);

// ── helpers ─────────────────────────────────────────────────────────────────
function ghApi(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  let body = null;
  try { body = JSON.parse(r.stdout || 'null'); } catch { /* not JSON, leave null */ }
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: r.stderr, body };
}

// contexts from either shape: legacy `contexts: string[]` or newer `checks: [{context}]`
function extractContexts(body) {
  if (!body) return [];
  const fromContexts = Array.isArray(body.contexts) ? body.contexts : [];
  const fromChecks = Array.isArray(body.checks) ? body.checks.map((chk) => chk?.context).filter(Boolean) : [];
  return [...new Set([...fromContexts, ...fromChecks])];
}

function writeSnapshot(repo, branch, payload) {
  if (!snapshotDir) return;
  mkdirSync(snapshotDir, { recursive: true });
  const safeRepo = repo.replace(/\//g, '-');
  const f = join(snapshotDir, `${safeRepo}-${branch}-${stamp().replace(/[:.]/g, '-')}.json`);
  writeFileSync(f, JSON.stringify({ queriedAt: stamp(), repo, branch, ...payload }, null, 2));
  console.log(dim(`  snapshot -> ${f}`));
}

// ── main ────────────────────────────────────────────────────────────────────
let worstExit = 0;
const summary = [];

for (const entry of repos) {
  const { repo, branch, requiredChecks } = entry;
  const expected = Array.isArray(requiredChecks) ? requiredChecks : [];
  if (!repo || !branch) {
    console.log(red(bold(`\nCANNOT-VERIFY: manifest entry missing repo/branch: ${JSON.stringify(entry)}`)));
    summary.push({ repo: repo || '?', branch: branch || '?', state: 'CANNOT-VERIFY' });
    worstExit = Math.max(worstExit, 4);
    continue;
  }

  console.log(bold(cy(`\n${repo}@${branch}`)));
  console.log(dim(`  expected: ${expected.length ? expected.join(', ') : '(none — pre-ratchet baseline)'}`));
  if (entry.warning) console.log(yel(`  manifest warning: ${entry.warning}`));

  const rsc = ghApi(`repos/${repo}/branches/${branch}/protection/required_status_checks`);

  let liveContexts = null;      // null = state NOT confirmed; array = confirmed (possibly empty)
  let confirmedEmpty = false;   // true only for a directly-confirmed "nothing required" read
  let sourceNote = '';
  let fallback = null;

  if (rsc.ok) {
    liveContexts = extractContexts(rsc.body);
    sourceNote = 'protection/required_status_checks (200, direct read)';
  } else {
    const errBody = rsc.body; // gh api prints the error JSON body to stdout even on non-zero exit
    const httpStatus = errBody?.status ? Number(errBody.status) : null;
    const msg = errBody?.message || '';

    if (httpStatus === 404) {
      // Only a 404 whose message says "not protected" counts as confirmed empty.
      if (/not protected/i.test(msg)) {
        confirmedEmpty = true;
        sourceNote = `404 "${msg}" — branch not protected (confirmed)`;
      } else {
        sourceNote = `404 with unexpected message "${msg || '(none)'}" — NOT confirmed as "branch not protected"`;
      }
    } else if (httpStatus === 403 && /upgrade/i.test(msg)) {
      // Plan-gated 403 — fall back to the un-gated branches/<branch> `protected` boolean.
      fallback = ghApi(`repos/${repo}/branches/${branch}`);
      if (fallback.ok && fallback.body?.protected === false) {
        confirmedEmpty = true;
        sourceNote = `403 plan-gated on required_status_checks ("${msg}"); fallback repos/.../branches/${branch} confirms protected:false`;
      } else if (fallback.ok && fallback.body?.protected === true) {
        sourceNote = `403 plan-gated on required_status_checks ("${msg}"); fallback shows protected:true but the check list is NOT readable at this plan tier — cannot enumerate`;
      } else {
        sourceNote = `403 plan-gated on required_status_checks ("${msg}"); fallback branches/${branch} ALSO failed (status ${fallback.status})`;
      }
    } else {
      sourceNote = `unexpected failure (http ${httpStatus ?? 'unknown'}, exit ${rsc.status}): ${msg || rsc.stderr || rsc.stdout || 'no detail'}`;
    }
  }

  console.log(dim(`  source:   ${sourceNote}`));
  writeSnapshot(repo, branch, {
    primaryQuery: { status: rsc.status, body: rsc.body ?? (rsc.stdout || null) },
    fallbackQuery: fallback ? { status: fallback.status, body: fallback.body ?? (fallback.stdout || null) } : null,
    sourceNote,
    interpretedLiveContexts: rsc.ok ? liveContexts : (confirmedEmpty ? [] : null),
  });

  // A confirmed-empty live set missing an expected check is a real MISMATCH,
  // never downgraded to CANNOT-VERIFY; only an unresolved read is CANNOT-VERIFY.
  const confirmed = rsc.ok || confirmedEmpty;
  if (!confirmed) {
    console.log(red(bold('  CANNOT-VERIFY — live required-check state could not be confirmed')));
    summary.push({ repo, branch, state: 'CANNOT-VERIFY', reason: sourceNote });
    worstExit = Math.max(worstExit, 4);
    continue;
  }

  const live = rsc.ok ? liveContexts : [];
  console.log(dim(`  live:     ${live.length ? live.join(', ') : '(none)'}`));
  const missing = expected.filter((chk) => !live.includes(chk));
  if (missing.length) {
    console.log(red(bold(`  MISMATCH — missing from live: ${missing.join(', ')}`)));
    summary.push({ repo, branch, state: 'MISMATCH', missing, live });
    worstExit = Math.max(worstExit, 3);
    continue;
  }
  const extra = live.filter((x) => !expected.includes(x));
  if (extra.length) console.log(dim(`  note: live also requires ${extra.length} check(s) not yet tracked in the manifest: ${extra.join(', ')}`));
  if (expected.length === 0 && live.length === 0) {
    console.log(yel(bold('  WARNING: zero required checks — every CI job is currently advisory at the merge gate')));
    summary.push({ repo, branch, state: 'PASS-WITH-WARNING', live });
  } else {
    console.log(grn(bold('  PASS')));
    summary.push({ repo, branch, state: 'PASS', live });
  }
}

console.log();
console.log(bold('summary:'), JSON.stringify(summary.map((r) => ({ repo: r.repo, branch: r.branch, state: r.state }))));
const label = worstExit === 0 ? grn('PASS') : worstExit === 3 ? red('MISMATCH') : red('CANNOT-VERIFY');
console.log(bold(`result: ${label} (exit ${worstExit})`));
process.exit(worstExit);
