#!/usr/bin/env node
// bin/rater-accuracy.mjs — anchor rater judgements to constructed truth, so accuracy stops being
// inferred from agreement.
//
// bin/rate-llm.mjs measures INTERRATER AGREEMENT and says so in its own header: both raters see the
// same evidence, so agreement is about consistency, not accuracy. Two raters wrong the same way
// agree perfectly. This reads the same ledger and asks the other question — against items whose
// answer is known by construction, how often is each rater RIGHT, and in which direction is it wrong.
//
// exit: 0 every rater at or above the floor on an anchored cohort · 2 a rater below it
//       3 GREY — no anchored overlap, so accuracy is UNDEFINED (never a pass)
//       4 ledger unreadable or absent
//
// usage: node bin/rater-accuracy.mjs [--dir <verdicts>] [--floor 0.7] [--json]

import { readAdjudications, TRUTHS } from './lib/verdict-journal-core.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIR = () => flag('--dir', process.env.CW_VERDICT_DIR || undefined);
const FLOOR = () => Number(flag('--floor', process.env.CW_RATER_FLOOR || '0.7'));
const JSON_OUT = args.includes('--json');

// fix: `truth` carries the VERDICT in rate-llm and the PROVENANCE ('by-construction') in
// secrets-canary — same name, same type, opposite meaning across a seam. Normalise at read time and
// report it; a silent coercion here would compare a verdict against the string 'by-construction'.
// A plant is truth by construction whatever the writer called it. Three conventions are live:
// secrets-canary says truth:'by-construction' with the answer in `verdict`; canary-harness says
// canary:<id> with the answer in `truth`; rate-llm says truth:<verdict> and no canary. Keying on the
// SPELLING filed 9,198 anchors as a tenth rater — key on the presence of a plant id.
export function normalise(r) {
  if (!r || r.kind !== 'adjudication') return null;
  const byConstruction = r.truth === 'by-construction';
  const anchored = byConstruction || r.canary != null;
  const verdict = byConstruction ? r.verdict : r.truth;
  if (!TRUTHS.includes(verdict)) return null;
  return {
    anchored,
    verdict,
    rater: anchored ? null : (r.method || r.adjudicatedBy || '(unnamed rater)'),
    subject: subjectKey(r),
  };
}

// The join key both writers must agree on. Stated once so a disagreement is visible rather than
// producing an empty intersection that reads as "no disagreement".
export function subjectKey(r) {
  if (r.gate && r.recordAt) return `${r.gate}@${r.recordAt}`;
  if (r.canary) return `canary:${r.canary}`;
  return null;
}

export function score(records, { floor = 0.7 } = {}) {
  const rows = records.map(normalise).filter(Boolean);
  const truthBySubject = new Map();
  for (const r of rows) if (r.anchored && r.subject) truthBySubject.set(r.subject, r.verdict);

  const raters = new Map();
  for (const r of rows) {
    if (r.anchored) continue;
    if (!raters.has(r.rater)) {
      raters.set(r.rater, { rater: r.rater, judged: 0, anchorable: 0, correct: 0, confusion: {} });
    }
    raters.get(r.rater).judged++;
  }
  // second pass, so `judged` is complete before accuracy is computed over a subset of it
  for (const r of rows) {
    if (r.anchored || !r.subject) continue;
    const truth = truthBySubject.get(r.subject);
    if (truth === undefined) continue;
    const s = raters.get(r.rater);
    s.anchorable++;
    if (r.verdict === truth) s.correct++;
    else {
      const k = `${truth}->${r.verdict}`;
      s.confusion[k] = (s.confusion[k] || 0) + 1;
    }
  }

  const out = [...raters.values()].map((s) => ({
    ...s,
    // UNKNOWN, not 1.0 and not 0.0 — a rater with nothing anchorable has no accuracy.
    accuracy: s.anchorable > 0 ? s.correct / s.anchorable : null,
    // The costly direction gets its own number; an aggregate hides it.
    falseCleanMisses: Object.entries(s.confusion)
      .filter(([k]) => k.startsWith('false-clean->')).reduce((a, [, v]) => a + v, 0),
    belowFloor: s.anchorable > 0 && s.correct / s.anchorable < floor,
  })).sort((a, b) => (b.anchorable - a.anchorable) || a.rater.localeCompare(b.rater));

  return { anchors: truthBySubject.size, raters: out, floor };
}

// fix: readAdjudications returns {absent, records, torn, chain} — an earlier cut read `.verified`,
// got undefined, and reported 0 raters over a ledger holding 14,898 records. Assert the shape.
export function readLedger(read) {
  if (!read || typeof read !== 'object') return { fatal: 'ledger read returned nothing' };
  if (read.absent) return { fatal: 'no adjudication ledger — never ran is not zero raters' };
  if (!Array.isArray(read.records)) {
    return { fatal: `ledger shape unrecognised (no records[]; keys: ${Object.keys(read).join(',')})` };
  }
  const chain = read.chain || {};
  return {
    records: read.records,
    warnings: [
      read.torn ? `${read.torn} torn line(s) — the ledger was read PARTIALLY` : null,
      chain.broken ? `${chain.broken} record(s) off the hash chain` : null,
      chain.raced ? `${chain.raced} raced record(s)` : null,
    ].filter(Boolean),
  };
}

function main() {
  let read;
  try { read = readAdjudications(DIR()); }
  catch (e) { process.stderr.write(`rater-accuracy: ledger unreadable — ${e.message}\n`); process.exit(4); }

  const led = readLedger(read);
  if (led.fatal) { process.stderr.write(`rater-accuracy: ${led.fatal}\n`); process.exit(4); }
  for (const w of led.warnings) process.stderr.write(`rater-accuracy: WARN ${w}\n`);

  const r = score(led.records, { floor: FLOOR() });
  const scored = r.raters.filter((x) => x.anchorable > 0);

  if (JSON_OUT) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); }
  else {
    process.stdout.write(`anchors (truth by construction): ${r.anchors}\n`);
    for (const s of r.raters) {
      const acc = s.accuracy === null ? 'UNKNOWN' : `${(s.accuracy * 100).toFixed(1)}%`;
      process.stdout.write(`  ${s.rater}: ${acc} over ${s.anchorable} anchored of ${s.judged} judged`
        + `${s.falseCleanMisses ? ` · ${s.falseCleanMisses} FALSE-CLEAN missed` : ''}\n`);
      for (const [k, v] of Object.entries(s.confusion)) process.stdout.write(`      ${k}: ${v}\n`);
    }
  }

  if (scored.length === 0) {
    process.stderr.write(`rater-accuracy: GREY — ${r.raters.length} rater(s), ${r.anchors} anchor(s),`
      + ' and ZERO anchorable overlap. Accuracy is undefined, not high. The two writers must share a'
      + ' subject key before this number exists.\n');
    process.exit(3);
  }
  process.exit(scored.some((s) => s.belowFloor) ? 2 : 0);
}

if (isMainModule(import.meta.url)) main();
