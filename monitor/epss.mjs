// monitor/epss.mjs — parsing the FIRST.org EPSS feed, in a module a test can import.
//
// fact: this parse is its OWN file because rollup.mjs does its work at MODULE SCOPE — importing it runs a real rollup and publishes / as an inline arrow in rollup.mjs's fetch loop the parse was unreachable from any test (expiry: if rollup.mjs stops working at module scope, prev: broken)
// fact: that is how `fetched[d.cve] = +d.epss` dropped `percentile` and `date` at the door for months / the comment above it then observed that epss.json "carries no version/date field of its own to measure freshness from" — a gap that line created, described as if it were weather (expiry: never, prev: broken)
//
// Third instance of the same class in this repository (govulncheck aliases, CodeQL codeFlows, this):
// the evidence was already arriving and was thrown away at the parse boundary. The common feature
// is not carelessness, it is that none of the three parses could be called by a test.
//
// Zero deps. Pure: no I/O, no clock, no network.

/** The score-cache value shape is load-bearing — consumers do arithmetic on it and check
 *  `typeof === 'number'` — so it stays a number and the full triple lives beside it. */
export function epssRecordsFrom(json) {
  const scores = Object.create(null);
  const detail = Object.create(null);
  for (const d of (json?.data || [])) {
    // `d.cve` is the RESPONSE's key, not our request echoed back. Shape-validate before it becomes
    // a key in a shared cross-area cache, so a compromised feed cannot plant `__proto__` or
    // arbitrary keys that every area's rollup then reads back as CVE ids.
    if (!d || typeof d.cve !== 'string' || !/^CVE-\d{4}-\d{4,}$/.test(d.cve)) continue;

    const n = Number(d.epss);
    // A non-numeric score is NOT recorded as 0 — that would read as "measured, and negligible".
    if (d.epss !== undefined && d.epss !== null && d.epss !== '' && Number.isFinite(n)) scores[d.cve] = n;

    // The sidecar needs all three or none. CSAF 2.1 requires percentile, probability and timestamp
    // together; a padded triple would publish a percentile nobody measured, which costs more than
    // an omitted metric. Strings are kept VERBATIM because 2.1 constrains both values to a fixed
    // decimal pattern and a float round-trip renders small numbers in exponential form, which the
    // pattern rejects.
    if (d.epss !== undefined && d.percentile !== undefined && d.date !== undefined
        && d.epss !== null && d.percentile !== null && d.date !== null) {
      detail[d.cve] = {
        probability: String(d.epss),
        percentile: String(d.percentile),
        date: String(d.date),
      };
    }
  }
  return { scores, detail };
}

const DAY_MS = 86_400_000;
// A calendar date, optionally followed by a time. The calendar part as WRITTEN is what is compared
// and printed; a time part only has to parse as an ISO timestamp for the whole string to count.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T.+)?$/;

function calendarDate(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value);
  if (!m) return null;
  if (m[4] !== undefined && !Number.isFinite(Date.parse(value))) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  // 2026-02-30 rolls over to March; a date that does not exist is not dated.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, ms };
}

/**
 * Freshness of the score cache from the dates in the full-triple sidecar.
 *
 * Judged PER ENTRY and by the OLDEST date: epss.json accumulates scores across fetches, so one
 * recent fetch would otherwise stamp years of old scores as fresh. An id with no sidecar entry, or
 * a date that does not parse, is UNDATED — never old and never new — and any undated entry keeps
 * the state 'unknown' rather than letting the dated subset vouch for the whole cache.
 *
 * @param {string[]} scoreIds ids that have a score in epss.json
 * @param {object} detail    sidecar `{ [cve]: { probability, percentile, date } }`
 * @param {{ now: Date|number, staleDays: number }} clock and threshold supplied by the caller; a
 *   threshold that is not a finite number >= 0 cannot judge anything and yields 'unknown'
 */
export function epssFreshnessFrom(scoreIds, detail, { now, staleDays } = {}) {
  const ids = Array.isArray(scoreIds) ? scoreIds : [];
  const sidecar = detail !== null && typeof detail === 'object' ? detail : {};
  const entries = ids.length;
  let dated = 0, oldest = null, newest = null;
  for (const id of ids) {
    const rec = Object.hasOwn(sidecar, id) ? sidecar[id] : null;
    const parsed = rec !== null && typeof rec === 'object' ? calendarDate(rec.date) : null;
    if (!parsed) continue;
    dated++;
    if (!oldest || parsed.ms < oldest.ms) oldest = parsed;
    if (!newest || parsed.ms > newest.ms) newest = parsed;
  }
  const undated = entries - dated;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  // typeof, not Number(): Number(null) is 0, which would turn a threshold that FAILED to load into
  // "everything is stale today".
  const thresholdUsable = typeof staleDays === 'number' && Number.isFinite(staleDays) && staleDays >= 0;
  const threshold = staleDays;
  const oldestDate = oldest ? oldest.date : null;
  const newestDate = newest ? newest.date : null;
  const ageDays = oldest && Number.isFinite(nowMs) ? Math.floor((nowMs - oldest.ms) / DAY_MS) : null;

  let state = 'unknown';
  if (thresholdUsable && ageDays !== null && ageDays > threshold) state = 'stale';
  else if (thresholdUsable && ageDays !== null && entries > 0 && undated === 0) state = 'fresh';

  const note = state === 'fresh'
    ? `${entries} scored CVE(s), all dated; oldest ${oldestDate}, ${ageDays}d old (limit ${threshold}d)`
    : state === 'stale'
      ? `${entries} scored CVE(s), ${undated} undated; oldest ${oldestDate}, ${ageDays}d old (limit ${threshold}d)`
      : `${entries} scored CVE(s), ${undated} undated; freshness undetermined`;

  return { state, entries, dated, undated, oldestDate, newestDate, ageDays, note };
}
