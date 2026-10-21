import { readFileSync } from 'node:fs';
import { ruleIndex } from '../../../monitor/sarif-read.mjs';

export function safeReadJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// OSV `MAL-` advisories are the OpenSSF malicious-packages feed (ossf/malicious-packages, ingested
// by osv.dev) arriving on the SAME osv.sarif the CVE lane already reads — a confirmed-malicious
// package, not a scored weakness. Bucketing it by SARIF `level` buried it: osv-scanner emits most
// results at `warning`, so a worm landed as one more line inside `247 (12e/235w)` at `med`.
//
// osv-scanner GROUPS aliases, so the MAL id is frequently not the primary `ruleId` — it rides in the
// rule's id or description text. The id shape (MAL-YYYY-N) is distinctive enough to match directly;
// the only way prose produces a hit is by quoting a real advisory id, which is not a false positive.
const MAL_ID = /\bMAL-\d{4}-\d+\b/g;

// Takes the runs array off a readSarif 'ok' record, never a raw parsed document
export function sarifMalicious(runs) {
  const ids = new Set(); let hits = 0;
  for (const run of runs) {
    const rules = ruleIndex(run);
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      const found = [res.ruleId, rule.id,
        rule.shortDescription && rule.shortDescription.text, rule.fullDescription && rule.fullDescription.text,
        res.message && res.message.text]
        .filter((s) => typeof s === 'string').join('\n').match(MAL_ID);
      if (found) { hits++; for (const id of found) ids.add(id); }
    }
  }
  return { hits, ids: [...ids].sort() };
}

// ── A VOID WITH AN OWNER IS NOT THE SAME AS A VOID WITHOUT ONE ───────────────────────────────
// `noscan` means "ran, produced nothing trustworthy", and for most lanes there is nothing anybody
// can do about it: a11y with no served HTML, BOLA with no OpenAPI spec, TLS with no live target.
// Those are structural absences and grey is the honest colour.
//
// An absent CREDENTIAL or an absent TOOL is a different animal wearing the same skin. The lane
// could report; it is not being allowed to; and ONE HUMAN ACTION clears it. Rendered the same grey,
// it sits — because the operator has correctly learned that grey means "nothing to do here", which
// for every other grey is true. cspm-github's dedicated token went unset for eleven days behind
// exactly that reading.
//
// Decided from the reason the runner ALREADY writes rather than a new field every script would have
// to learn to emit. Deliberately narrow: it matches credentials and missing executables, and does
// NOT match "no target", "no spec" or "no served HTML" — over-matching would paint structural
// absence red and retire the distinction within a week.
const CLEARABLE_VOID = /\btoken\b|\bcredential\b|\bunset\b|not installed|\bPAT\b|\bscope\b|command not found|no such file/i;

export function voidResult(reason, fallbackLabel, fallbackReason) {
  const why = String(reason || fallbackReason);
  const blocked = CLEARABLE_VOID.test(why);
  return {
    ok: false,
    sev: 'noscan',            // the AXIS is unchanged: every existing consumer still reads a void
    blocked,                  // the new fact rides alongside, so old readers stay correct
    blockedReason: blocked ? why.slice(0, 140) : null,
    // The summary carries the LABEL and the REASON, never the word BLOCKED: that is presentation,
    // supplied by the status token, and putting it here too rendered "■ BLOCKED — BLOCKED — …".
    // Data says what happened; the renderer decides how loud. A consumer that wants the emphasis
    // reads the `blocked` field rather than pattern-matching prose.
    summary: `${fallbackLabel} — ${why.slice(0, 70)}`,
  };
}
