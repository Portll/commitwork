// lib/coverage-gaps.mjs — what a scan was meant to cover against what it measured. A declared pair
// with no measured row is not-run; only a measured outcome counts as covered.

const OUTCOMES = Object.freeze({ measured: 'covered', failed: 'failed', skipped: 'skipped', unavailable: 'unavailable' });
const STATUSES = Object.freeze(['covered', 'failed', 'skipped', 'unavailable', 'not-run', 'undeclared']);

function pairOf(row, at) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`${at} must be an object`);
  for (const f of ['lane', 'subject']) {
    if (typeof row[f] !== 'string' || row[f].trim() === '') throw new TypeError(`${at}.${f} must be a non-empty string`);
  }
  return JSON.stringify([row.lane, row.subject]);
}

function indexPairs(list, name, check = () => {}) {
  if (!Array.isArray(list)) throw new TypeError(`${name} must be an array`);
  const byPair = new Map();
  for (const [i, row] of list.entries()) {
    const key = pairOf(row, `${name}[${i}]`);
    check(row, `${name}[${i}]`);
    if (byPair.has(key)) throw new Error(`duplicate ${name} pair: ${row.lane} / ${row.subject}`);
    byPair.set(key, row);
  }
  return byPair;
}

function checkMeasured(row, at) {
  if (!Object.hasOwn(OUTCOMES, row.outcome)) throw new TypeError(`${at}.outcome must be one of ${Object.keys(OUTCOMES).join(', ')}: ${JSON.stringify(row.outcome)}`);
  if (row.reason != null && typeof row.reason !== 'string') throw new TypeError(`${at}.reason must be a string when present`);
}

export function coverageGaps({ declared, measured } = {}) {
  const want = indexPairs(declared, 'declared');
  const got = indexPairs(measured, 'measured', checkMeasured);

  const rows = [];
  for (const [key, d] of want) {
    const m = got.get(key);
    rows.push(m
      ? { lane: d.lane, subject: d.subject, status: OUTCOMES[m.outcome], outcome: m.outcome, reason: m.reason ?? null }
      : { lane: d.lane, subject: d.subject, status: 'not-run', outcome: null, reason: null });
  }
  for (const [key, m] of got) {
    if (!want.has(key)) rows.push({ lane: m.lane, subject: m.subject, status: 'undeclared', outcome: m.outcome, reason: m.reason ?? null });
  }
  rows.sort((a, b) => (a.lane !== b.lane ? (a.lane < b.lane ? -1 : 1) : a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));

  const totals = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) totals[r.status]++;
  return { rows, totals };
}
