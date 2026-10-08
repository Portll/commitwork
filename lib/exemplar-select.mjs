// lib/exemplar-select.mjs — pick a small, safe set of past adjudications to anchor a triage
// prompt for the same check. The projection is an ALLOWLIST (four named fields, nothing else
// copied) so raw evidence/basis text can never reach a prompt; ties break on field values, never
// array position, so output is deterministic regardless of input order.

import { identityFor } from '../monitor/detail-schema.mjs';

export const EXEMPLAR_COUNT_DEFAULT = 2;
// ~600 chars — a couple of sentences per exemplar; this rides in every future prompt for the check.
export const EXEMPLAR_CHAR_BUDGET = 600;

const TRUE_ALARM = 'true-alarm';
const FALSE_ALARM = 'false-alarm';

/**
 * The scanner check (finding-adjudication `category`) an issue belongs to, from its source key:
 *   'sc:<repo>|<category>|<rule>|<file>|<line>'   scanner-row issue
 *   'gs:<repo>|<category>|<rule>'                 scanner-row GROUP issue
 *   'f:<key>' / 'g:<repo>|<pkg>'                   dependency issue -> fixed 'dependency-cve' lane
 * Anything else yields null: honestly "no check", never a guessed one.
 */
export function checkForIssue(issue) {
  const key = issue && issue.source && issue.source.key;
  if (typeof key !== 'string' || !key) return null;
  const colon = key.indexOf(':');
  if (colon === -1) return null;
  const prefix = key.slice(0, colon);
  if (prefix === 'sc' || prefix === 'gs') {
    const parts = key.slice(colon + 1).split('|');
    return parts[1] || null;
  }
  if (prefix === 'f' || prefix === 'g') return 'dependency-cve';
  return null;
}

// Best-effort "rule" label parsed from findingKey using identityFor(category)'s tuple order;
// dependency keys carry the CVE id second. A tuple with no 'rule' field yields null, never a guess.
function ruleForRecord(record) {
  const key = typeof record.findingKey === 'string' ? record.findingKey : '';
  if (record.category === 'dependency-cve') {
    return key.split('|')[1] || null;
  }
  const fields = identityFor(record.category);
  if (!fields) return null;
  const idx = fields.indexOf('rule');
  if (idx === -1) return null;
  return key.split('|')[2 + idx] || null;
}

// Defensive cap on the one field treated as display text.
function safeReason(v) {
  if (typeof v !== 'string' || !v) return '(no disposition recorded)';
  return v.length > 80 ? `${v.slice(0, 80)}…` : v;
}

function projectExemplar(record) {
  return {
    identity: record.findingKey,
    rule: ruleForRecord(record),
    verdict: record.truth,
    reason: safeReason(record.humanVerdict),
  };
}

/** One prompt-ready line per exemplar — the SAME rendering used to measure the char budget. */
export function renderExemplarLine(e) {
  return `- [${e.verdict}] ${e.rule ?? e.identity} — prior disposition: ${e.reason}`;
}

function atThenKeyAsc(a, b) {
  if (a.at < b.at) return -1;
  if (a.at > b.at) return 1;
  return a.findingKey < b.findingKey ? -1 : a.findingKey > b.findingKey ? 1 : 0;
}
function atThenKeyDesc(a, b) { return atThenKeyAsc(b, a); }

/**
 * selectExemplars(ledgerRecords, {check, k}) -> [{identity, rule, verdict, reason}, …]
 * Eligible: kind 'finding-adjudication', category === check, human-tier (`model` nullish), truth
 * in {true-alarm, false-alarm}. Records collapse to the LATEST per findingKey (earlier ones are
 * superseded); selection alternates most-recent true/false alarms up to k, then trims from the
 * tail until the rendered size fits EXEMPLAR_CHAR_BUDGET.
 */
export function selectExemplars(ledgerRecords, { check, k = EXEMPLAR_COUNT_DEFAULT } = {}) {
  if (!check || !Array.isArray(ledgerRecords) || !ledgerRecords.length) return [];

  const eligible = ledgerRecords.filter((r) => r
    && r.kind === 'finding-adjudication'
    && r.category === check
    && r.model == null
    && (r.truth === TRUE_ALARM || r.truth === FALSE_ALARM)
    && typeof r.findingKey === 'string' && r.findingKey
    && typeof r.at === 'string' && r.at);

  // Sort ascending first so latest-per-key is deterministic regardless of input order.
  const ascending = [...eligible].sort(atThenKeyAsc);
  const latestByKey = new Map();
  for (const r of ascending) latestByKey.set(r.findingKey, r);
  const current = [...latestByKey.values()];

  const trueAlarms = current.filter((r) => r.truth === TRUE_ALARM).sort(atThenKeyDesc);
  const falseAlarms = current.filter((r) => r.truth === FALSE_ALARM).sort(atThenKeyDesc);

  const picked = [];
  let ti = 0;
  let fi = 0;
  while (picked.length < k && (ti < trueAlarms.length || fi < falseAlarms.length)) {
    if (ti < trueAlarms.length) { picked.push(trueAlarms[ti++]); if (picked.length >= k) break; }
    if (fi < falseAlarms.length) picked.push(falseAlarms[fi++]);
  }

  const out = picked.map(projectExemplar);
  const rendered = (list) => list.reduce((sum, e) => sum + renderExemplarLine(e).length + 1, 0);
  while (out.length && rendered(out) > EXEMPLAR_CHAR_BUDGET) out.pop();
  return out;
}

/** Prompt-ready lines, or null when there are none — absent, not an empty heading. */
export function formatExemplarBlock(exemplars) {
  if (!exemplars || !exemplars.length) return null;
  return [
    'Recent adjudications for this same check (for calibration, not binding precedent):',
    ...exemplars.map(renderExemplarLine),
  ].join('\n');
}
