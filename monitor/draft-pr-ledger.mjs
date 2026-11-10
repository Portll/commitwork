// monitor/draft-pr-ledger.mjs — remediation pull requests on the issue store's hash chain. Each PR
// opened, each one that could not be opened, and each later merge or close is an event on the
// issue the advisory was filed as. A merge lodges a dep-upgrade fix, so the next slice verifies or
// contradicts it through the store's fix-verified and reopened-contradiction path.
import { appendIssueEvent, identityProblems, issuesPath, loadIssues, lodgeFix, saveIssues, withIssuesLock } from './issue-store.mjs';
import { scannerSourceKey } from './issue-ingest.mjs';

export const PR_EVENT_TYPES = Object.freeze(['remediation-pr-opened', 'remediation-pr-not-opened', 'remediation-pr-merged', 'remediation-pr-closed']);
const [OPENED, NOT_OPENED, MERGED, CLOSED] = PR_EVENT_TYPES;
export const ADVISORY_CATEGORY = 'depsGo';
export const MERGE_WHO = 'commitwork remediation-draft-pr';

/** The issue the advisory's finding was filed as (its own key, or a group holding it), or null. */
export function issueForAdvisory(doc, adv) {
  if (!adv?.repo || !adv.id || !adv.package) return null;
  const key = scannerSourceKey({ repo: adv.repo, id: adv.id, package: adv.package }, ADVISORY_CATEGORY);
  const direct = key && doc.byKey?.[key];
  if (direct && doc.issues[direct]) return direct;
  const group = Object.values(doc.issues).find((i) => Array.isArray(i.groupMembers) && i.groupMembers.includes(key));
  return group ? group.id : null;
}

const prEvents = (doc) => doc.events.filter((e) => PR_EVENT_TYPES.includes(e.type));

/** Opened PRs with no later merge or close, by URL. */
export function openPrs(doc) {
  const open = new Map();
  for (const e of prEvents(doc)) {
    const url = e.data?.url;
    if (!url) continue;
    if (e.type === OPENED) open.set(url, e);
    else if (e.type === MERGED || e.type === CLOSED) open.delete(url);
  }
  return [...open.values()];
}

/** The first cap this PR would exceed, or null. Day is the UTC date of `at`. */
export function capReached(doc, { slug, at, maxOpenPerRepo, maxOpenPerDay }) {
  const perRepo = openPrs(doc).filter((e) => e.data.upstream === slug).length;
  if (perRepo >= maxOpenPerRepo) return { reason: 'cap-per-repo', detail: `${perRepo} open on ${slug}; maxOpenPerRepo is ${maxOpenPerRepo}` };
  const day = String(at).slice(0, 10);
  const perDay = prEvents(doc).filter((e) => e.type === OPENED && !e.data.existing && String(e.at).slice(0, 10) === day).length;
  if (perDay >= maxOpenPerDay) return { reason: 'cap-per-day', detail: `${perDay} opened on ${day}; maxOpenPerDay is ${maxOpenPerDay}` };
  return null;
}

const lastFor = (doc, issueId, advisory) => prEvents(doc).filter((e) => e.issueId === issueId && e.data?.advisory === advisory).at(-1) || null;

/** Append one PR event. A not-opened that repeats the last one for this advisory is not written again. */
export function recordPrEvent(doc, issueId, type, data, at) {
  if (!PR_EVENT_TYPES.includes(type)) throw new Error(`PR event type must be one of ${PR_EVENT_TYPES.join('|')}`);
  if (!doc.issues[issueId]) throw new Error(`unknown issue ${issueId}`);
  if (!at || Number.isNaN(Date.parse(at))) throw new Error('a PR event requires a parseable at instant');
  if (type === OPENED && !data?.url) throw new Error('an opened PR event requires its url');
  if (type === NOT_OPENED && !data?.reason) throw new Error('a not-opened PR event requires its reason');
  const last = lastFor(doc, issueId, data.advisory);
  if (type === NOT_OPENED && last?.type === NOT_OPENED && last.data.reason === data.reason) return null;
  if (type === OPENED && openPrs(doc).some((e) => e.data.url === data.url)) return null;
  return appendIssueEvent(doc, type, issueId, data, at);
}

/**
 * Load, mutate and save under the store lock. fn(doc) returns its result; the store is written only
 * when fn appended an event.
 */
export function withLedger(fn, { path = issuesPath(), schemaPath } = {}) {
  const paths = { path, ...(schemaPath ? { schemaPath } : {}) };
  return withIssuesLock(() => {
    const doc = loadIssues(paths);
    const before = doc.events.length;
    const out = fn(doc);
    if (doc.events.length === before) return out;
    const problems = identityProblems(doc);
    if (problems.length) throw new Error(`refusing to save the issue store: ${problems.join('; ')}`);
    saveIssues(doc, paths);
    return out;
  }, { path });
}

/**
 * Ask `view(url)` for each open PR's state and record merges and closes.
 * view -> { state:'OPEN'|'MERGED'|'CLOSED', mergedAt?, closedAt?, mergedBy? } | null (unreadable)
 */
export function reconcilePrOutcomes(doc, { view, at }) {
  const seen = [];
  for (const e of openPrs(doc)) {
    const { url, advisory, package: pkg, upstream } = e.data;
    const v = view(url);
    const state = v?.state || 'unreadable';
    seen.push({ url, issueId: e.issueId, state });
    if (state !== 'MERGED' && state !== 'CLOSED') continue;
    const data = { url, advisory, package: pkg, upstream };
    if (state === 'CLOSED') { appendIssueEvent(doc, CLOSED, e.issueId, { ...data, closedAt: v.closedAt || null }, at); continue; }
    appendIssueEvent(doc, MERGED, e.issueId, { ...data, mergedAt: v.mergedAt || null, mergedBy: v.mergedBy || null }, at);
    if (!doc.issues[e.issueId].fix) {
      lodgeFix(doc, e.issueId, { fixType: 'dep-upgrade', notes: `remediation pull request merged: ${url}`, who: v.mergedBy || MERGE_WHO, at });
    }
  }
  return seen;
}
