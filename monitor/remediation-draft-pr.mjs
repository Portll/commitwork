// monitor/remediation-draft-pr.mjs — open a dependency-remediation pull request for an advisory the
// remediation plan proposes, on the repository's default branch, as a draft unless policy lets it
// open ready. Runs only when the remediation policy's mode is draft-pr or above. Order: policy,
// plan, the advisory's issue, caps, identity and target, a scratch clone of the default branch,
// opt-out, duplicate search, head probe, the fix, build and advisory check, commit, create-pr. Each
// outcome past the issue lookup is an event on that issue (draft-pr-ledger.mjs).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nowISO } from '../lib/clock.mjs';
import { createPr } from '../bin/create-pr.mjs';
import { DEFAULT_POLICY, draftPrEnabled } from './remediation-policy.mjs';
import { planRemediationPR, branchFor } from './remediation-pr.mjs';
import { loadIssues } from './issue-store.mjs';
import { CLA_FILES, CONTRIBUTING_FILES, DCO_FILES, OPT_OUT_FILES, contributionRequirements, duplicatesOf, optOut, opensAsDraft } from './draft-pr-gates.mjs';
import { renderDraftPrBody } from './draft-pr-body.mjs';
import { capReached, issueForAdvisory, openPrs, recordPrEvent, withLedger } from './draft-pr-ledger.mjs';
import { ghSeams, gitSeams } from './draft-pr-live.mjs';
import { goSeams } from './draft-pr-go.mjs';

export const WATCHED_FILES = [...new Set([...OPT_OUT_FILES, ...CONTRIBUTING_FILES, ...CLA_FILES, ...DCO_FILES])];
export const draftBranchFor = (adv) => `commitwork/${branchFor(adv)}`;

export function liveSeams(env) {
  return {
    ...ghSeams(env), ...gitSeams(env), ...goSeams(env),
    createPr,
    scratch: () => mkdtempSync(join(tmpdir(), 'cw-draft-pr-')),
    cleanup: (dir) => rmSync(dir, { recursive: true, force: true }),
  };
}

const stop = (reason, detail, extra = {}) => ({ stop: reason, detail: detail == null ? null : String(detail).slice(0, 600), ...extra });
const issueOpts = (issues) => ({ ...(issues.path ? { path: issues.path } : {}), ...(issues.schemaPath ? { schemaPath: issues.schemaPath } : {}) });

/**
 * @param {object} adv  remediation-pr's advisory, plus `repo`: the scanned repository it was found in
 * @param {{policy, headState, seams?, issues?:{path,schemaPath}, env?, dryRun?:boolean}} opts
 * @returns {{state:'disabled'|'skipped'|'already-open'|'ready-to-attempt'|'not-opened'|'opened'|'existing', reason?, detail?, url?, draft?, issueId?, recorded:boolean, recordError?}}
 */
export function openDraftRemediationPR(adv, { policy, headState, seams = {}, issues = {}, env = process.env, dryRun = false }) {
  if (!draftPrEnabled(policy)) return { state: 'disabled', reason: `mode=${policy?.mode ?? 'unset'} opens no pull requests`, recorded: false };
  const plan = planRemediationPR(adv, { headState });
  if (plan.action !== 'propose') return { state: 'skipped', reason: plan.reason, recorded: false };
  const doc = loadIssues(issueOpts(issues));
  const issueId = issueForAdvisory(doc, adv);
  if (!issueId) return { state: 'not-opened', reason: 'no-issue', detail: `no issue holds ${adv.id} in ${adv.package}; a PR opens only where it can be recorded`, recorded: false };
  const mine = openPrs(doc).find((e) => e.issueId === issueId && e.data.advisory === adv.id);
  if (mine) return { state: 'already-open', url: mine.data.url, issueId, recorded: false };
  const at = nowISO(env);
  const draftPr = { ...DEFAULT_POLICY.draftPr, ...(policy.draftPr || {}) };
  const ctx = { adv, plan, draftPr, at, env, issues, issueId, slug: adv.upstream.repo, s: { ...liveSeams(env), ...seams } };
  const cap = capReached(doc, { slug: ctx.slug, at, ...draftPr });
  if (dryRun) return { state: cap ? 'not-opened' : 'ready-to-attempt', reason: cap?.reason ?? null, detail: cap?.detail ?? null, issueId, recorded: false };
  if (cap) return record(ctx, stop(cap.reason, cap.detail));
  const dir = ctx.s.scratch();
  try { return record(ctx, attempt(ctx, dir)); } finally { ctx.s.cleanup(dir); }
}

function target(ctx) {
  const { s, slug, draftPr } = ctx;
  if (!s.whoami()) return stop('no-gh-identity', 'gh has no authenticated identity');
  const perm = s.permission(slug);
  if (!perm) return stop('target-unreadable', `the gh identity's permission on ${slug} could not be read`);
  const kind = perm === 'ADMIN' ? 'own' : 'upstream';
  if (!draftPr.targets.includes(kind)) return stop('target-not-enabled', `${slug} is ${kind} (${perm}); draftPr.targets is [${draftPr.targets.join(', ')}]`, { target: kind });
  return { kind };
}

function upstreamAllows(ctx, clone) {
  const { s, slug, adv } = ctx;
  const read = s.readFiles(clone, WATCHED_FILES);
  const o = optOut({ files: read?.files ?? null, labels: s.labels(slug) });
  if (o.optedOut !== false) return stop(o.optedOut === null ? 'opt-out-unreadable' : 'opted-out', o.why);
  const found = s.search(slug, { prTerms: [...new Set([adv.id, adv.package, adv.bump?.module].filter(Boolean))], issueTerms: [adv.id] });
  if (!found) return stop('dedupe-unreadable', `open PRs and issues on ${slug} could not be searched`);
  const dups = duplicatesOf(adv, found);
  if (dups.length) return stop('already-proposed', dups.map((d) => d.url).join(' '), { duplicates: dups });
  return { req: contributionRequirements(read) };
}

function attempt(ctx, dir) {
  const { s, adv, slug, plan, draftPr, env } = ctx;
  const t = target(ctx);
  if (t.stop) return t;
  const clone = join(dir, 'repo');
  const c = s.clone(slug, clone);
  if (!c.ok) return stop('default-branch-unreadable', c.error, { target: t.kind });
  const u = upstreamAllows(ctx, clone);
  if (u.stop) return { ...u, target: t.kind };
  const p = s.probe(adv, clone);
  if (p.fixed !== false) return stop(p.fixed === true ? 'upstream-already-fixed' : 'head-probe-undetermined', p.reason, { target: t.kind });
  const a = s.apply(adv, clone);
  if (!a.ok) return stop('fix-did-not-apply', a.reason, { target: t.kind });
  const v = s.verify(adv, clone);
  if (!v.ok) return stop(String(v.reason).startsWith('build') ? 'build-failed' : 'advisory-check-failed', v.reason, { target: t.kind });
  const branch = draftBranchFor(adv);
  const committed = s.commit(clone, { branch, message: plan.title, signoff: u.req.dco });
  if (!committed.ok) return stop('commit-failed', committed.reason, { target: t.kind });
  const asks = u.req.cla ? [`This repository asks for a contributor licence agreement (${u.req.claWhy}). A person signs it before this leaves draft.`] : [];
  const draft = opensAsDraft({ ready: draftPr.ready, target: t.kind, asks });
  const bodyFile = join(dir, 'body.md');
  const probe = { base: c.base, sha: c.sha, reason: p.reason, trace: p.trace };
  writeFileSync(bodyFile, renderDraftPrBody({ adv, probe, versions: a.versions, steps: [...a.steps, ...v.steps], asks, dcoWhy: u.req.dco ? u.req.dcoWhy : null, now: env.CW_NOW || null }));
  const r = s.createPr({ repo: clone, branch, title: plan.title, bodyFile, draft, upstream: t.kind === 'upstream' ? slug : null, env });
  if (r.state !== 'opened' && r.state !== 'existing') return stop(`create-pr-${r.state}`, r.reason, { target: t.kind });
  return { pr: r, target: t.kind, base: c.base, sha: c.sha, branch, asks, dco: u.req.dco };
}

function record(ctx, out) {
  const { adv, slug, issueId, at, issues } = ctx;
  const base = { advisory: adv.id, package: adv.package, upstream: slug };
  const [type, data, result] = out.stop
    ? ['remediation-pr-not-opened', { ...base, reason: out.stop, detail: out.detail, ...(out.target ? { target: out.target } : {}) },
      { state: 'not-opened', reason: out.stop, detail: out.detail, ...(out.duplicates ? { duplicates: out.duplicates } : {}) }]
    : ['remediation-pr-opened', { ...base, url: out.pr.url, draft: !!out.pr.draft, target: out.target, fork: out.pr.fork || null, base: out.base,
      probedSha: out.sha, branch: out.branch, asks: out.asks, dco: out.dco, ...(out.pr.state === 'existing' ? { existing: true } : {}) },
      { state: out.pr.state, url: out.pr.url, draft: !!out.pr.draft, target: out.target, asks: out.asks }];
  try {
    const ev = withLedger((doc) => recordPrEvent(doc, issueId, type, data, at), issueOpts(issues));
    return { ...result, issueId, recorded: !!ev };
  } catch (e) {
    return { ...result, issueId, recorded: false, recordError: e.message };
  }
}
