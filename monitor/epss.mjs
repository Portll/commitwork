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
