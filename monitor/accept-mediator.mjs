#!/usr/bin/env node
// monitor/accept-mediator.mjs — carry a human `accept` from the annotation store into the issue
// store's `accepted` closure, so a judgement made once is a judgement the issue ledger knows about.
//
// fact: the annotation store and the issue store both record a human `accept` / nothing else joins them, so the issue ledger never learns of one (expiry: never, prev: missing)
// fact: a false-positive rate needs a confirmed-true denominator / `accepted` closures are where that side of the ledger comes from (expiry: never, prev: unknown)
//
// TWO JOINS, AND ONLY ONE OF THEM MAY EVER ACT.
//
//   EXACT — (repo, advisory, package). An accept names a repo; the issue names the same repo. This
//   is the same judgement about the same thing, and it closes the issue as `accepted`.
//
//   CROSS-REPO — (advisory, package) with a DIFFERENT repo. Surfaced as a candidate for a human,
//   NEVER applied. An accept reasons about one repo's context ("dev/build-only chain, yarn-1
//   resolution") and that reasoning may not transfer; annotation.schema.json warns that an
//   omitted `repo` acts as a fleet-wide wildcard for the same reason.
//
// IDENTITY EXCLUDES LINE AND PATH. An accept keyed on a path would un-accept itself the next time
// a lockfile moved. repo + advisory + package is the place.
//
// Nothing here writes. planAcceptClosures() returns a PROPOSAL; applying it is a separate,
// operator-gated act (the CLI at the foot of this file), because a mediator that closed issues on
// its own would be adjudicating.

import { isMainModule } from '../lib/is-main.mjs';

/** The place an annotation is about. Never the line, never the path. */
export const acceptIdentity = (a) => ({
  repo: String((a && a.repo) || ''),
  advisory: String((a && a.id) || ''),
  pkg: String((a && a.package) || ''),
});

/**
 * The place an issue is about, recovered from source.key.
 * Dependency findings key as `f:<repo>|<tool>|<advisory>|<package>|<path>`; the path is dropped
 * here deliberately. Returns null for any key this cannot read — a shape it does not recognise is
 * NOT silently treated as a non-match on a guess, it is reported as unreadable.
 */
export function issueIdentity(issue) {
  const key = issue && issue.source && issue.source.key;
  if (typeof key !== 'string' || !key) return null;
  const [head, ...rest] = key.split('|');
  if (rest.length < 3) return null;                       // g:<repo>|<pkg> and friends: not advisory-keyed
  const repo = String(head).includes(':') ? head.slice(head.indexOf(':') + 1) : head;
  const [, advisory, pkg] = rest;                          // rest = [tool, advisory, package, ...path]
  if (!/^(CVE|GHSA|GO|MAL|RUSTSEC|PYSEC|OSV)-/i.test(String(advisory))) return null;
  return { repo: String(repo), advisory: String(advisory), pkg: String(pkg) };
}

const sameThing = (a, b) => a.repo === b.repo && a.advisory === b.advisory && a.pkg === b.pkg;
const sameFinding = (a, b) => a.advisory === b.advisory && a.pkg === b.pkg;

/**
 * Plan which issues an `accept` annotation should close, and which merely deserve a human's eye.
 *
 * @returns {{ exact: Array, crossRepo: Array, report: object }}
 *   exact     — {annotation, issueId, identity, evidence} ready to close as `accepted`
 *   crossRepo — {annotation, issueId, identity, why} for review; NEVER auto-applied
 *   report    — counts, including the unreadable-key count, so a zero yield is explained
 */
export function planAcceptClosures(annotations, issues, { now = null } = {}) {
  const accepts = (annotations || []).filter((a) => a && a.action === 'accept');
  const entries = Object.entries(issues || {});
  const open = [];
  let unreadableKey = 0;
  for (const [id, iss] of entries) {
    if (!iss || iss.state === 'closed') continue;
    const ident = issueIdentity(iss);
    if (!ident) { unreadableKey++; continue; }
    open.push({ id, ident });
  }

  const exact = []; const crossRepo = [];
  for (const a of accepts) {
    const want = acceptIdentity(a);
    // An annotation with no repo is a WILDCARD that would act fleet-wide, so it never drives a
    // closure. It is reported, not acted on.
    if (!want.repo) { crossRepo.push({ annotation: a, issueId: null, identity: want, why: 'annotation names no repo — wildcard, refused' }); continue; }
    for (const o of open) {
      if (sameThing(want, o.ident)) {
        exact.push({
          annotation: a, issueId: o.id, identity: o.ident,
          evidence: `accepted per monitor/annotations.json (${a.who || 'unknown'}, ${a.at || 'undated'}): ${String(a.reason || '').slice(0, 400)}`,
        });
      } else if (sameFinding(want, o.ident)) {
        crossRepo.push({
          annotation: a, issueId: o.id, identity: o.ident,
          why: `same advisory and package, DIFFERENT repo (accepted in ${want.repo}, open in ${o.ident.repo}) — the acceptance reasoning is repo-scoped and may not transfer`,
        });
      }
    }
  }

  return {
    exact,
    crossRepo,
    report: {
      at: now,
      accepts: accepts.length,
      openIssues: open.length,
      unreadableKey,
      exact: exact.length,
      crossRepo: crossRepo.length,
      // A zero here is a FACT about the two stores, not a failure of the join, and it is stated so
      // that a reader is never left to infer which.
      note: exact.length === 0
        ? `no open issue shares (repo, advisory, package) with any accept annotation — the two stores currently describe different repositories, ${unreadableKey} issue keys were not advisory-shaped`
        : `${exact.length} open issue(s) carry a human accept that the issue ledger did not know about`,
    },
  };
}

export default { acceptIdentity, issueIdentity, planAcceptClosures };

// ---- CLI -----------------------------------------------------------------------------------
// usage: node monitor/accept-mediator.mjs [--apply]
// Without --apply this prints the proposal and writes nothing, which is the default because the
// operator is the adjudicator. --apply closes only the EXACT matches; cross-repo candidates are
// printed for a human and never applied by any flag.

if (isMainModule(import.meta.url)) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { join, dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // store-paths resolves a relative override, so one CW_ISSUES value names one file from any cwd.
  const { issuesPathFor, annotationsPathFor } = await import('./store-paths.mjs');
  const annPath = annotationsPathFor(CW);
  const issPath = issuesPathFor(CW);
  const apply = process.argv.includes('--apply');

  const ann = JSON.parse(readFileSync(annPath, 'utf8')).annotations || [];
  const doc = JSON.parse(readFileSync(issPath, 'utf8'));
  const plan = planAcceptClosures(ann, doc.issues, { now: process.env.CW_NOW || new Date().toISOString() });

  process.stdout.write(`${JSON.stringify(plan.report, null, 2)}\n`);
  for (const c of plan.crossRepo) {
    process.stdout.write(`CANDIDATE (never auto-applied) ${c.issueId || '-'}: ${c.why}\n`);
  }
  if (!apply) {
    process.stdout.write(`${plan.exact.length} exact match(es); re-run with --apply to close them as accepted.\n`);
    process.exit(0);
  }
  if (!plan.exact.length) { process.stdout.write('nothing to apply.\n'); process.exit(0); }

  const { closeIssue } = await import('./issue-store.mjs');
  const at = process.env.CW_NOW || new Date().toISOString();
  for (const e of plan.exact) {
    closeIssue(doc, e.issueId, { as: 'accepted', evidence: e.evidence, force: true, at });
    process.stdout.write(`closed ${e.issueId} as accepted\n`);
  }
  writeFileSync(issPath, `${JSON.stringify(doc, null, 2)}\n`);
  process.stdout.write(`applied ${plan.exact.length} closure(s).\n`);
}
