// monitor/feed-groups.mjs — the one findings feed's group model. Pure functions over a rollup's
// scannerFindings; no I/O, no env. Groups are keyed on PLACE (repo · lane · subject) and sub-rows
// on each lane's declared line-free identity, so a finding that moves lines stays the same finding.

import { identityFor } from './detail-schema.mjs';
import { normaliseSeverity, SEV_RANK, ISSUE_STATES, CLOSED_AS, scannerIdentityParts } from './issue-store.mjs';

const SEP = '\u0000';

// Annotation actions that take a row out of Focus. Mirrors CLOSED_ACTIONS in admin/static/panel-core.js.
export const SUPPRESSING_ACTIONS = Object.freeze(['accept', 'false-positive', 'wont-fix', 'incorrect-scan-result']);

// A group's subject is WHAT was found (rule, package, control …); the rest of the identity says WHERE.
// Dependency lanes group by the package because that is the unit a fix addresses.
const PACKAGE_FIELDS = ['package', 'component'];
const SUBJECT_FIELDS = ['rule', 'control', 'criterion', 'marker', 'detector', 'kind', 'issue', 'probe', 'operation'];
const FALLBACK_SUBJECT_FIELDS = ['rule', 'package', 'control', 'id', 'marker', 'detector', 'name'];

// Derived from the store's own vocabulary: a closedAs the store adds becomes a feed state without a
// second list to keep in step. `fixed` splits into fixed (row gone) and claimed-fixed (row present).
export const FEED_STATES = Object.freeze([
  ...ISSUE_STATES.filter((s) => s !== 'closed'), 'suppressed', 'claimed-fixed', 'fixed',
  ...CLOSED_AS.filter((c) => c !== 'fixed'), 'gone',
]);
export const FOCUS_STATES = Object.freeze(['open', 'claimed', 'blocked', 'claimed-fixed']);

// KEV floors a row's display rank to the band between high and critical; a critical is never pulled down.
const EXPLOITED_RANK = 3.5;
export const displayRank = (sev, kev) => (kev === true ? Math.max(SEV_RANK[sev], EXPLOITED_RANK) : SEV_RANK[sev]);

const str = (v) => (v === undefined || v === null ? '' : String(v));

export function subjectFieldsFor(lane) {
  const identity = identityFor(lane);
  if (!identity) return { fields: null, declared: false };
  const pkg = identity.filter((f) => PACKAGE_FIELDS.includes(f));
  if (pkg.length) return { fields: pkg.concat(identity.includes('ecosystem') ? ['ecosystem'] : []), declared: true };
  const subj = identity.filter((f) => SUBJECT_FIELDS.includes(f));
  return { fields: subj.length ? [subj[0]] : identity.slice(), declared: true };
}

function subjectOf(lane, row) {
  const { fields, declared } = subjectFieldsFor(lane);
  if (declared) return { subject: fields.map((f) => str(row[f])).join(SEP), fields, declared };
  const f = FALLBACK_SUBJECT_FIELDS.find((k) => row[k] !== undefined && row[k] !== null);
  return { subject: f ? str(row[f]) : '', fields: f ? [f] : [], declared: false };
}

export function groupKeyFor(lane, row) {
  const { subject, fields, declared } = subjectOf(lane, row);
  return { key: [str(row.repo), lane, subject].join(SEP), subject, subjectFields: fields, identityDeclared: declared };
}

// The issue store's own key for a scanner row (`sc:repo|lane|part|…`, minted by monitor/issue-ingest.mjs
// from scannerIdentityParts), so a ruling joins a row with no second key scheme. Null when the row
// is unkeyable there too.
export function storeKeyFor(lane, row) {
  const { parts } = scannerIdentityParts(row, lane);
  return parts.length ? `sc:${str(row.repo)}|${lane}|${parts.join('|')}` : null;
}

// The sub-row key is the store key where one exists, else the declared identity in full. `line` is
// never part of any identity, which the test suite asserts over every lane, so both are line-free.
export function subRowKeyFor(lane, row) {
  const sk = storeKeyFor(lane, row);
  if (sk) return sk;
  const identity = identityFor(lane) || FALLBACK_SUBJECT_FIELDS.filter((k) => row[k] !== undefined);
  return [str(row.repo), lane, ...identity.map((f) => str(row[f]))].join(SEP);
}

/** An issueFor over a loaded issues document: the open or closed record the store holds for a row. */
export const issueForDoc = (doc) => (lane, row, subRowKey) => {
  const id = doc && doc.byKey ? doc.byKey[subRowKey] : undefined;
  return id && doc.issues && doc.issues[id] ? doc.issues[id] : null;
};

export const isSuppressed = (row) => !!(row && row.annotation && SUPPRESSING_ACTIONS.includes(row.annotation.action));

// The mapping from an issue record plus scanner presence to the feed's one State column.
// `fixed` needs BOTH a fixed ruling and the scanner no longer presenting the row; a fixed ruling the
// scanner still contradicts is `claimed-fixed`. Exhaustively tested over every combination.
export function feedState({ issue = null, present = true, suppressed = false } = {}) {
  if (!issue) {
    if (!present) return 'gone';
    return suppressed ? 'suppressed' : 'open';
  }
  if (!ISSUE_STATES.includes(issue.state)) throw new Error(`feedState: unknown issue state ${JSON.stringify(issue.state)}`);
  if (issue.state !== 'closed') return issue.state;
  if (!CLOSED_AS.includes(issue.closedAs)) throw new Error(`feedState: closed issue with closedAs ${JSON.stringify(issue.closedAs)}`);
  if (issue.closedAs === 'fixed') return present ? 'claimed-fixed' : 'fixed';
  return issue.closedAs;
}

const emptyCounts = () => ({ crit: 0, high: 0, med: 0, low: 0, unknown: 0 });

function newGroup(lane, row, gk) {
  return {
    key: gk.key, repo: str(row.repo), lane, subject: gk.subject, subjectFields: gk.subjectFields,
    identityDeclared: gk.identityDeclared,
    worst: 'unknown', rank: 0, kev: false,
    members: 0, suppressed: 0, undetermined: 0, counts: emptyCounts(), states: {},
    subRows: new Set(),
  };
}

/**
 * Group a rollup's scannerFindings. Options:
 *   issueFor(lane, row, subRowKey) -> issue record or null (default: none)
 *   lanes: restrict to these lane keys
 * Returns { groups, totals, undeclaredLanes } with groups sorted by display rank, then size, then key.
 * Nothing is dropped: undetermined and suppressed rows are counted on every group and in totals.
 */
export function buildFeedGroups(scannerFindings, { issueFor = null, lanes = null } = {}) {
  if (!scannerFindings || typeof scannerFindings !== 'object' || Array.isArray(scannerFindings)) {
    throw new Error('buildFeedGroups: scannerFindings must be an object keyed by lane');
  }
  const groups = new Map();
  const undeclaredLanes = new Set();
  const totals = { rows: 0, groups: 0, focus: 0, suppressed: 0, undetermined: 0, graded: 0, kev: 0, counts: emptyCounts(), states: {} };
  for (const [lane, rows] of Object.entries(scannerFindings)) {
    if (lanes && !lanes.includes(lane)) continue;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const gk = groupKeyFor(lane, row);
      if (!gk.identityDeclared) undeclaredLanes.add(lane);
      let g = groups.get(gk.key);
      if (!g) { g = newGroup(lane, row, gk); groups.set(gk.key, g); }
      const sev = normaliseSeverity(row.sev ?? row.severity);
      const suppressed = isSuppressed(row);
      const subKey = subRowKeyFor(lane, row);
      const issue = issueFor ? issueFor(lane, row, subKey) : null;
      const state = feedState({ issue, present: true, suppressed });
      g.members += 1; totals.rows += 1;
      g.subRows.add(subKey);
      g.counts[sev] += 1; totals.counts[sev] += 1;
      g.states[state] = (g.states[state] || 0) + 1; totals.states[state] = (totals.states[state] || 0) + 1;
      if (sev === 'unknown') { g.undetermined += 1; totals.undetermined += 1; } else totals.graded += 1;
      if (suppressed) { g.suppressed += 1; totals.suppressed += 1; }
      if (row.kev === true && !g.kev) { g.kev = true; }
      if (row.kev === true) totals.kev += 1;
      if (SEV_RANK[sev] > SEV_RANK[g.worst] || g.worst === 'unknown' && sev !== 'unknown') g.worst = sev;
    }
  }
  const out = [];
  for (const g of groups.values()) {
    g.rank = displayRank(g.worst, g.kev);
    g.distinct = g.subRows.size;
    delete g.subRows;
    g.inFocus = g.worst !== 'unknown' && FOCUS_STATES.some((s) => g.states[s] > 0);
    if (g.inFocus) totals.focus += 1;
    out.push(g);
  }
  out.sort((a, b) => (b.rank - a.rank) || (b.members - a.members) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  totals.groups = out.length;
  return { groups: out, totals, undeclaredLanes: [...undeclaredLanes].sort() };
}

/** The rows behind one group, for drill-down. Same key function as the build, so they agree. */
export function feedGroupMembers(scannerFindings, groupKey) {
  const members = [];
  for (const [lane, rows] of Object.entries(scannerFindings || {})) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === 'object' && groupKeyFor(lane, row).key === groupKey) {
        members.push({ lane, subRowKey: subRowKeyFor(lane, row), suppressed: isSuppressed(row), sev: normaliseSeverity(row.sev ?? row.severity), row });
      }
    }
  }
  return members;
}

/** Focus keeps groups with graded, still-open work; All keeps every group. Counts travel with both. */
export function feedView(built, { mode = 'focus' } = {}) {
  if (mode !== 'focus' && mode !== 'all') throw new Error(`feedView: mode must be focus|all, got ${JSON.stringify(mode)}`);
  const groups = mode === 'focus' ? built.groups.filter((g) => g.inFocus) : built.groups;
  return { mode, groups, totals: built.totals, hidden: built.totals.groups - groups.length, undeclaredLanes: built.undeclaredLanes };
}
