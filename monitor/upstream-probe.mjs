#!/usr/bin/env node
// upstream-probe.mjs — is a reachable advisory STILL live on the upstream default branch?
//
// WHY. gitleaks GO-2025-3922 is reachable in the shipped release but already fixed on master. A
// remediation PR judged from the release alone would have been a no-op — noise. This module answers
// the one question that makes a proposal non-redundant: does the CURRENT upstream default branch
// still carry the advisory? Only 'still live' warrants a PR.
//
// THE EXIT-CODE TRAP (the reason the parse is careful). govulncheck signals findings by EXIT CODE
// in text mode (exit 3 = vulnerabilities found), so "exit 0 => fixed" is wrong the moment the tree
// has ANY other vuln, and "non-zero => unknown" would mark a fully-analysed tree UNKNOWN. So the
// probe runs `-format json`, which exits 0 on a successful analysis regardless of findings, and
// reads the RESULT, not the status. The status is only a second witness: a run that produced no
// parseable `config` record did not analyse anything, and that is UNKNOWN — never a reassuring
// 'fixed'. (The house rule: non-zero exit + zero parsed = unreadable, never clean.)
//
// FAIL CLOSED. tool missing, build failure, empty output, checkout of the wrong repo -> { fixed:null }.
// null routes to 'undetermined' in remediation-pr and proposes nothing. A guess here manufactures
// or suppresses a PR; neither is acceptable.

import { spawnSync } from 'node:child_process';
import { scannedGit } from '../bin/lib/git-env.mjs';
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';

/**
 * Interpret a govulncheck `-format json` run for ONE advisory id. Pure.
 * @param {string} advId
 * @param {{ status:number|null, stdout:string }} r
 * @returns {{ fixed: true|false|null, reason:string }}
 *   fixed:false = advisory still present upstream (propose)
 *   fixed:true  = analysed, advisory absent (skip — already fixed)
 *   fixed:null  = could not analyse (UNKNOWN, fail closed)
 */
export function interpretGovulncheck(advId, { status, stdout } = {}) {
  const records = parseConcatJson(stdout || '');
  const analysed = records.some((o) => o && o.config);           // the tool emitted a report header
  if (!analysed) return { fixed: null, reason: `no-analysis(status=${status})` };

  // PRESENCE is trustworthy regardless of exit status: if govulncheck traced a reachable call path
  // to advId, it is live — a partial run that still found it only strengthens that.
  const live = records.some((o) => {
    const f = o && o.finding;
    if (!f || f.osv !== advId) return false;
    return Array.isArray(f.trace) && f.trace.some((t) => t && t.function);
  });
  if (live) return { fixed: false, reason: 'still-reachable-upstream' };

  // ABSENCE only proves "fixed" when the analysis COMPLETED. In `-format json` govulncheck exits 0
  // on a successful scan (with or without findings); a non-zero status means packages failed to
  // load/build, so the scan may simply never have reached the vulnerable symbol. Absence under a
  // failed build is UNKNOWN, never a reassuring "fixed" — measured on the corpus, 1Panel/agentscope/
  // coze-loop all exited 1 with the advisory unseen, which is "could not analyse", not remediated.
  if (status !== 0) return { fixed: null, reason: `incomplete-analysis(status=${status})` };
  return { fixed: true, reason: 'analysed-advisory-absent' };
}

/** Parse a stream of concatenated JSON objects (govulncheck's output shape). Never throws. */
export function parseConcatJson(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    // resync to the next object opener, skipping whitespace AND any non-JSON noise between objects
    while (i < n && text[i] !== '{') i++;
    if (i >= n) break;
    let depth = 0, start = i, inStr = false, esc = false, closed = false;
    for (; i < n; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { i++; closed = true; break; } }
    }
    if (!closed) break;
    try { out.push(JSON.parse(text.slice(start, i))); } catch { /* skip a bad chunk, keep going */ }
  }
  return out;
}

/**
 * Probe one advisory against a local checkout of the upstream default branch. Composes injected
 * seams so the pure verdict is testable without a network or a real tool.
 * @param {{id:string, upstream?:{repo?:string}}} adv
 * @param {{ checkoutDir:string, run?:Function, originOf?:Function, shaOf?:Function }} opts
 *   run(dir)     -> { status, stdout } from govulncheck -format json ./...
 *   originOf(dir)-> 'owner/name'|null  (the checkout's GitHub slug)
 *   shaOf(dir)   -> commit sha string  (recorded so a stale plan is not acted on later)
 * @returns {{ fixed:true|false|null, sha?:string, reason:string }}
 */
export function probeUpstreamHead(adv, { checkoutDir, run = govulncheckRunner, originOf = originRunner, shaOf = shaRunner } = {}) {
  // Provenance (O5): a checkout whose origin is not the repo we intend to PR against measures the
  // wrong tree. Refuse rather than trust it.
  const wantSlug = adv?.upstream?.repo;
  const gotSlug = originOf(checkoutDir);
  if (wantSlug && gotSlug && gotSlug !== wantSlug) {
    return { fixed: null, reason: `checkout-origin-mismatch(${gotSlug}!=${wantSlug})` };
  }
  const sha = shaOf(checkoutDir) || undefined;
  const r = run(checkoutDir);
  const verdict = interpretGovulncheck(adv?.id, r || {});
  return { ...verdict, sha };
}

// ── default live runners (each fails closed to a shape interpret/probe treats as UNKNOWN) ────────

function govulncheckRunner(dir) {
  const r = spawnSync('govulncheck', ['-format', 'json', './...'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { status: null, stdout: '' };            // tool missing -> no-analysis -> null
  return { status: r.status, stdout: r.stdout || '' };
}

function originRunner(dir) {
  const r = scannedGit(dir, ['remote', 'get-url', 'origin']);
  if (r.status !== 0) return null;
  return slugFromGitUrl((r.stdout || '').trim());
}

function shaRunner(dir) {
  const r = scannedGit(dir, ['rev-parse', 'HEAD']);
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/** github.com URL (https or ssh) -> 'owner/name'; anything else (gitlab, self-hosted) -> null. */
export function slugFromGitUrl(url) {
  const m = String(url || '').match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// tiny self-check when run directly against a checkout dir: prints the verdict, changes nothing
function main(argv) {
  const dir = argv[0], id = argv[1];
  if (!dir || !id) { process.stderr.write('usage: upstream-probe.mjs <checkoutDir> <advisoryId>\n'); process.exit(2); }
  const v = probeUpstreamHead({ id, upstream: {} }, { checkoutDir: dir });
  process.stdout.write(JSON.stringify(v) + '\n');
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
