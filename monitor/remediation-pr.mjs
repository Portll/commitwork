#!/usr/bin/env node
// remediation-pr.mjs — PREPARE an upstream dependency-remediation PR. Never open one.
//
// WHY THIS EXISTS. Twice by hand (trufflehog 2026-08-26, gitleaks 2026-08-26) the same flow ran:
// a reachable dependency advisory -> resolve the patched floor -> bump the direct parent -> verify
// the build and that govulncheck no longer reports it -> open a draft PR a human then submits.
// This file is that flow's decidable core, so the judgement is a tested function and not a habit.
//
// THE LOAD-BEARING LESSON, from gitleaks. gitleaks 8.30.1 (the shipped release) is reachable by
// GO-2025-3922 in ulikunitz/xz, but upstream `master` ALREADY carries the fix (mholt/archives
// v0.1.5 -> xz v0.5.15) and simply has not been released. A PR bumping xz would be a no-op against
// master — noise, and the kind of check a reader runs. So reachability-in-the-release is necessary
// and NOT sufficient: this engine proposes a PR only when it can confirm the advisory is STILL
// live on the upstream default branch. When it cannot confirm that, it fails closed to
// `undetermined` and proposes nothing — explicit uncertainty.
//
// DECLARATION SPLIT FROM AUTHORITY (house invariant; renovate-dryrun.mjs already honours it). This
// engine emits a PLAN: a branch name, a commit/PR body, and the exact git/gh commands. It NEVER
// pushes, forks, or runs `gh pr create`. Applying stays a human act — the same boundary the
// trufflehog/gitleaks PRs crossed only when the operator marked them ready.
//
// DETERMINISM. Same inputs -> byte-identical plan. No Date.now(); a timestamp appears only if
// CW_NOW is set, and then verbatim. Env is read at CALL time so tests can set CW_* per case.
//
// INPUT CONTRACT (one normalized reachable advisory; compatible with advisory-reach + fix-range):
//   { id, package, ecosystem, currentVersion, fixed,           // fixed = patched floor (fix-range)
//     reachable,                                                // true | false | 'undetermined'
//     bump?: { module, from, to },                             // the DIRECT dep to move (optional)
//     upstream: { repo, defaultBranch } }                      // e.g. { repo:'gitleaks/gitleaks', defaultBranch:'master' }
// Plus a probe verdict per advisory: headState ∈ { fixed:true|false|null }  (null = unverified).

import { writeAtomic } from './lockfile.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';

const env = (k) => process.env[k]; // read at call time — never captured at module load

// The prepared PLAN is copy-paste shell a human runs, so every field that reaches a command line
// is charset-validated first. Declare-only is NOT a defence when the artifact's purpose is
// runnable commands: an unvalidated slug/module/version from a hostile or typo'd slice would be a
// paste-and-run injection. A field that fails validation makes the advisory non-proposable (fail
// closed) — never a sanitised-but-wrong guess.
export const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export const MODULE_RE = /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/;       // Go import path charset, no shell metachars
export const VERSION_RE = /^v?[0-9][A-Za-z0-9.+\-]*$/;           // semver-ish, no spaces/metachars
export const ADVISORY_RE = /^[A-Za-z0-9-]+$/;                    // GO-…/CVE-…/GHSA-… — safe in a URL

export const isSlug = (s) => typeof s === 'string' && SLUG_RE.test(s);
export const isModulePath = (s) => typeof s === 'string' && MODULE_RE.test(s);
export const isVersion = (s) => typeof s === 'string' && VERSION_RE.test(s);
export const isAdvisoryId = (s) => typeof s === 'string' && ADVISORY_RE.test(s);

/** Every command-line-bound field is well-formed. A false here means "do not propose". */
export function fieldsSafe(adv) {
  if (!adv) return false;
  if (!isAdvisoryId(adv.id)) return false;
  if (!isSlug(adv.upstream?.repo)) return false;
  const mod = adv.bump?.module || adv.package;
  const ver = adv.bump?.to || adv.fixed;
  if (!isModulePath(mod)) return false;
  if (!isVersion(ver)) return false;
  if (adv.bump?.module && !isModulePath(adv.package)) return false; // package also appears in the body
  return true;
}

/** Slugify an advisory id into a branch-safe token. Deterministic. */
export function branchFor(adv) {
  const id = String(adv?.id || 'advisory').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `deps/${id}`;
}

/** The one direct-dependency bump the PR performs, as a `go get`-style spec (display only). */
export function bumpSpec(adv) {
  const b = adv?.bump;
  if (b && b.module && b.to) return `${b.module}@${b.to}`;
  if (adv?.package && adv?.fixed) return `${adv.package}@${adv.fixed}`;
  return '';
}

/**
 * The decidable core. Returns one of:
 *   { action:'propose',      reason, branch, title, body, commands }
 *   { action:'skip',         reason }                       // not reachable / no fix / already fixed upstream
 *   { action:'undetermined', reason }                       // upstream state unverifiable — fail closed
 * `headState.fixed`: true  = upstream default branch no longer carries the advisory (skip),
 *                    false = still live upstream (propose),
 *                    null  = could not verify (undetermined; NEVER propose on a guess).
 * `headState.inFlight`: true = an open upstream PR / dependabot branch already bumps this module,
 *                    so proposing another duplicates work in flight (skip). `headState.sha`, if
 *                    present, is the upstream commit the head state was measured at — recorded so a
 *                    stale plan is not acted on later.
 */
export function planRemediationPR(adv, { headState } = {}) {
  if (!adv || typeof adv !== 'object') return { action: 'skip', reason: 'no-advisory' };

  if (adv.reachable !== true) {
    // 'undetermined' reachability or false — both are non-actionable, and an undetermined
    // reachability must never be promoted into a proposed fix (explicit uncertainty).
    return { action: 'skip', reason: adv.reachable === 'undetermined' ? 'reachability-undetermined' : 'not-reachable' };
  }
  if (!adv.fixed && !adv.bump?.to) return { action: 'skip', reason: 'no-fix-target' };

  // Fields that will be spliced into a runnable command must be well-formed, or the advisory is
  // not proposable — an injection-shaped slug/module/version fails closed rather than being emitted.
  if (!fieldsSafe(adv)) return { action: 'skip', reason: 'unsafe-fields' };

  if (headState?.inFlight === true) return { action: 'skip', reason: 'upstream-pr-in-flight' };

  const fixed = headState?.fixed;
  if (fixed === true) return { action: 'skip', reason: 'upstream-already-fixed' };
  if (fixed !== false) return { action: 'undetermined', reason: 'upstream-state-unverified' };

  const branch = branchFor(adv);
  const spec = bumpSpec(adv);
  const title = `deps: bump ${adv.bump?.module || adv.package} to clear ${adv.id}`;
  const out = {
    action: 'propose',
    reason: 'reachable-and-live-upstream',
    branch,
    title,
    body: renderPRBody(adv, { spec }),
    commands: renderCommands(adv, { branch, spec }),
  };
  if (headState?.sha) out.probedSha = headState.sha; // the upstream commit this verdict was measured at
  return out;
}

/** Deterministic PR/commit body. No timestamp unless CW_NOW is set. */
export function renderPRBody(adv, { spec } = {}) {
  const now = env('CW_NOW');
  const lines = [];
  lines.push('### Description', '');
  lines.push(`\`govulncheck\` (symbol level) reports [${adv.id}](https://pkg.go.dev/vuln/${adv.id}) reachable through \`${adv.package}@${adv.currentVersion || '?'}\`.`, '');
  if (adv.bump?.module) {
    lines.push(`The module is pulled transitively via \`${adv.bump.module}\`. Bumping \`${adv.bump.module}\` ${adv.bump.from ? `${adv.bump.from} → ` : ''}${adv.bump.to} pulls the patched \`${adv.package}\` (${adv.fixed || 'fixed'}), which removes the advisory from the graph.`, '');
  } else {
    lines.push(`Bump \`${adv.package}\` to \`${adv.fixed}\` (the patched floor).`, '');
  }
  lines.push('### Verification', '');
  lines.push('- [ ] `go build ./...` passes', '- [ ] `govulncheck ./...` no longer reports this advisory', '');
  if (spec) lines.push('```', `go get ${spec}`, 'go mod tidy', '```', '');
  if (now) lines.push(`_Prepared ${now} by commitwork remediation-pr (declare-only; a human submits)._`);
  else lines.push('_Prepared by commitwork remediation-pr (declare-only; a human submits)._');
  return lines.join('\n');
}

/** The exact commands a human runs to apply and submit. The engine runs NONE of them. */
export function renderCommands(adv, { branch, spec } = {}) {
  const repo = adv.upstream?.repo || '<owner/repo>';
  const base = adv.upstream?.defaultBranch || 'main';
  return [
    `gh repo fork ${repo} --clone=false`,
    `git clone --filter=blob:none https://github.com/<you>/${repo.split('/').pop()} /tmp/rem && cd /tmp/rem`,
    `git remote add upstream https://github.com/${repo} && git fetch --depth 1 upstream ${base}`,
    `git checkout -b ${branch} upstream/${base}`,
    spec ? `go get ${spec} && go mod tidy` : `# apply the fix`,
    `go build ./... && govulncheck ./...`,
    `git commit -am ${JSON.stringify('deps: clear ' + adv.id)} && git push origin ${branch}`,
    `gh pr create --repo ${repo} --draft --head <you>:${branch} --title ${JSON.stringify('deps: clear ' + adv.id)} --body-file body.md`,
  ];
}

/** Plan a batch. Partitions into proposed / skipped / undetermined; order preserved for determinism. */
export function planBatch(advisories, headStates = {}) {
  const proposed = [], skipped = [], undetermined = [];
  for (const adv of Array.isArray(advisories) ? advisories : []) {
    const plan = planRemediationPR(adv, { headState: headStates[adv?.id] });
    const row = { id: adv?.id, package: adv?.package, ...plan };
    if (plan.action === 'propose') proposed.push(row);
    else if (plan.action === 'undetermined') undetermined.push(row);
    else skipped.push(row);
  }
  return { proposed, skipped, undetermined, counts: { proposed: proposed.length, skipped: skipped.length, undetermined: undetermined.length } };
}

// ── CLI: declare-only. Reads a normalized advisories JSON, writes a plan artifact, prints a summary.
//    NEVER forks, pushes, or opens a PR. --write persists the artifact; default is stdout only.
function main(argv) {
  const inPath = env('CW_REMEDIATION_INPUT') || argv.find((a) => !a.startsWith('--'));
  if (!inPath) {
    process.stderr.write('usage: remediation-pr.mjs <advisories.json> [--write]\n  input: { advisories: [...], headStates: { <id>: { fixed } } }\n');
    process.exit(2);
  }
  let doc;
  try { doc = JSON.parse(readFileSync(inPath, 'utf8')); }
  catch (e) { process.stderr.write(`cannot read ${inPath}: ${e.message}\n`); process.exit(2); }

  const plan = planBatch(doc.advisories, doc.headStates || {});
  const artifact = JSON.stringify({ plan, note: 'PREPARED, NOT APPLIED. commitwork declares; a human submits.' }, null, 2);

  if (argv.includes('--write')) {
    const out = env('CW_REMEDIATION_OUT') || 'reports/remediation-pr-plan.json';
    writeAtomic(out, artifact + '\n', { mkdir: true });
    process.stderr.write(`wrote ${out}\n`);
  } else {
    process.stdout.write(artifact + '\n');
  }
  process.stderr.write(`propose=${plan.counts.proposed} skip=${plan.counts.skipped} undetermined=${plan.counts.undetermined}\n`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
