#!/usr/bin/env node
// CLI for the verdict journal (bin/lib/verdict-journal-core.mjs).
// usage: node bin/verdict-journal.mjs --tally [--json]
//        node bin/verdict-journal.mjs --retire-data-anchor <path> --reason "<why>"
import { nowISO } from '../lib/clock.mjs';
import { join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { REPO, appendRecord, readJournalFile, readJournal, GATE_ROSTER, journalHealth, anchorJournals, verifyAnchors, anchorDataStore, retireDataAnchor, verifyDataAnchors, TRUTHS, adjudicationsPath, readAdjudications, raterReliability, computeMetrics, computeFindingCalibration, bankedRatesFrom, compareCalibrationToBaseline, readCalibrateBaseline, writeCalibrateBaseline, fatigueReport } from './lib/verdict-journal-core.mjs';

// ── --tally: the minimum subscriber ─────────────────────────────────────────────────────────────
function tally({ json = false } = {}) {
  const out = { gates: [], areas: [], fleet: null, generatedAt: nowISO() };
  for (const h of journalHealth()) {
    let last = null;
    if (h.state === 'ok' || h.state === 'torn') {
      const j = readJournal(h.gate);
      last = j.records.length ? j.records[j.records.length - 1] : null;
    }
    out.gates.push({ ...h, lastVerdict: last ? last.verdict : h.lastVerdict ?? null });
  }
  // Unreadable is its own state, never "nothing suppressed".
  try {
    out.fatigue = { state: 'ok', ...fatigueReport(readAdjudications().records) };
  } catch (e) {
    out.fatigue = { state: 'unreadable', detail: e.code || 'error', targets: [], empty: true };
  }
  return out;
}

async function tallySweeps(out) {
  // Sweep journals resolve via the registry chain, never joined by hand. Registry failure is stated.
  try {
    const { loadRegistry, areaOut } = await import('../monitor/registry.mjs');
    const { reportsRootDir } = await import('../monitor/area.mjs');
    const reg = loadRegistry({ quiet: true });
    const root = reportsRootDir(reg);
    for (const a of reg.areas || []) {
      const p = join(root, areaOut(a.slug, reg), 'sweep-journal.jsonl');
      let j;
      try { j = readJournalFile(p); } catch (e) { out.areas.push({ area: a.slug, state: 'unreadable', detail: e.code }); continue; }
      const last = j.records.length ? j.records[j.records.length - 1] : null;
      out.areas.push(j.absent
        ? { area: a.slug, state: 'absent' }
        : { area: a.slug, state: j.torn ? 'torn' : 'ok', torn: j.torn, entries: j.records.length, lastAt: last?.at ?? null, sliceId: last?.sliceId ?? null, rollup: last?.rollup ?? null });
    }
    let f;
    try { f = readJournalFile(join(root, 'sweep-fleet-journal.jsonl')); } catch (e) { f = null; out.fleet = { state: 'unreadable', detail: e.code }; }
    if (f) {
      const last = f.records.length ? f.records[f.records.length - 1] : null;
      out.fleet = f.absent ? { state: 'absent' } : { state: f.torn ? 'torn' : 'ok', entries: f.records.length, lastAt: last?.at ?? null, clean: last?.clean ?? null };
    }
  } catch (e) {
    out.sweepError = `registry unavailable: ${e.message}`;
  }
  return out;
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i > -1 ? (args[i + 1] ?? null) : null; };

  if (args.includes('--adjudicate')) {
    const rec = {
      v: 1, kind: 'adjudication', at: nowISO(),
      gate: flag('--gate'), recordAt: flag('--record-at'), truth: flag('--truth'),
      basis: flag('--basis'), adjudicatedBy: flag('--by'),
    };
    const ac = flag('--attribution-correct');
    if (ac !== null) rec.attributionCorrect = ac === 'true';
    const canary = flag('--canary');
    if (canary) rec.canary = canary;
    if (!rec.gate || !rec.recordAt || !TRUTHS.includes(rec.truth) || !rec.basis || !rec.adjudicatedBy) {
      console.error(`usage: --adjudicate --gate <g> --record-at <iso> --truth <${TRUTHS.join('|')}> --basis "<evidence>" --by <who> [--attribution-correct true|false] [--canary <id>]`);
      process.exit(2);
    }
    const w = appendRecord(adjudicationsPath(), rec);
    if (!w.ok) { console.error(`adjudication write FAILED (${w.error})`); process.exit(1); }
    console.log(`adjudicated: ${rec.gate} @ ${rec.recordAt} → ${rec.truth} (by ${rec.adjudicatedBy})`);
    process.exit(0);
  }

  if (args.includes('--metrics')) {
    let adj;
    try { adj = readAdjudications(); }
    catch (e) { console.error(`adjudications UNREADABLE (${e.code || 'error'}) — metrics cannot be computed, and unreadable is never zero`); process.exit(1); }
    // Index every roster gate AND every gate an adjudication mentions. ENOENT → empty set
    // (honest); a throw → no entry, which reads "not checked" — unreadable is never empty.
    const counts = {};
    const recordAtIndex = {};
    const ambiguousRecordAts = new Set();
    const gates = new Set([...GATE_ROSTER.map((r) => r.gate), ...adj.records.map((r) => r?.gate).filter(Boolean)]);
    for (const gate of gates) {
      try {
        const j = readJournal(gate);
        counts[gate] = j.records.length;
        recordAtIndex[gate] = new Set(j.records.map((r) => r?.at).filter(Boolean));
        // Two records at one instant: `at` has no tie breaker.
        const seenAt = new Map();
        for (const r of j.records) if (r?.at) seenAt.set(r.at, (seenAt.get(r.at) || 0) + 1);
        for (const [at, n] of seenAt) if (n > 1) ambiguousRecordAts.add(`${gate}@${at}`);
      } catch { counts[gate] = null; }
    }
    const m = computeMetrics(adj.records, counts, { recordAtIndex, ambiguousRecordAts });
    if (args.includes('--json')) {
      console.log(JSON.stringify({ metrics: m, adjudications: adj.records.length, torn: adj.torn, chain: adj.chain }, null, 2));
      process.exit(adj.chain?.broken ? 1 : 0);
    }
    if (!Object.keys(m).length) {
      console.log(`no adjudications recorded${adj.absent ? '' : ` (file present: ${adj.records.length} records, 0 valid)`} — every rate is UNKNOWN, not zero`);
      process.exit(0);
    }
    const pct = (x) => (x == null ? 'n/a (no denominator)' : `${(x * 100).toFixed(1)}%`);
    // Each false-rate prints its observable-stratum count — "0.0%" and "0.0% (0/8)" differ.
    const withN = (x, n) => (x == null ? pct(x) : `${pct(x)} (${n})`);
    for (const [gate, g] of Object.entries(m)) {
      console.log(`${gate}: catch ${pct(g.catchRate)} · false-clean ${withN(g.falseCleanRate, g.falseCleanN)} · false-alarm ${withN(g.falseAlarmRate, g.falseAlarmN)}`
        + ` · attribution ${pct(g.attributionAccuracy)} (${g.attributionScored} scored)`
        + ` · ${g.adjudicated} adjudicated${g.unadjudicated != null ? `, ${g.unadjudicated} NOT adjudicated` : ''}`);
      // A catch rate with no clean-stratum adjudications is 100% by construction — no information.
      if (!g.catchObservable && g.catchRate != null) {
        console.log(`${' '.repeat(gate.length)}  catch is STRUCTURALLY ${pct(g.catchRate)}: a false-clean is observable only where the gate said clean, `
          + 'and 0 such decisions have been adjudicated — this figure cannot distinguish a working gate from a dead one');
      }
      // Constructed truth is shown only when it exists, never merged.
      if (g.canary.adjudicated) {
        console.log(`${' '.repeat(gate.length)}  canary (truth by construction, NOT in the rates above): `
          + `catch ${pct(g.canary.catchRate)} · false-clean ${pct(g.canary.falseCleanRate)}`
          + ` · attribution ${pct(g.canary.attributionAccuracy)} (${g.canary.attributionScored} scored) · ${g.canary.adjudicated} planted`);
      }
      // Zero post-epoch scores = UNMEASURED, never 0%.
      if (g.attributionPreEpoch) {
        console.log(`${' '.repeat(gate.length)}  attribution: ${g.attributionScored} score(s) judge the CURRENT claim logic (epoch ${g.attributionEpoch})`
          + `; ${g.attributionPreEpoch} judge the instrument it replaced and are excluded from the figure above`
          + `${g.attributionScored === 0 ? ' — so attribution is UNMEASURED since the fix, not 0%' : ''}`);
      }
      // The headline's own composition, so nobody has to guess what it is computed over.
      if (g.retrospective.adjudicated) {
        console.log(`${' '.repeat(gate.length)}  of which ${g.live.adjudicated} judge a journalled decision and ${g.retrospective.adjudicated} are retrospective pre-journal incidents (no record to point at — the journal did not exist yet)`);
      }
      // Not-checked (null) and none-found (0) are different states.
      if (g.ambiguous) {
        console.log(`${' '.repeat(gate.length)}  ${g.ambiguous} adjudication(s) name an instant at which TWO records were journalled — they judge an unidentified decision and move no rate above`);
      }
      if (g.dangling) {
        console.log(`${' '.repeat(gate.length)}  ${g.dangling} adjudication(s) name a recordAt at/after this journal's start that matches NO record — excluded from every rate above`);
      } else if (g.dangling == null && g.adjudicated) {
        console.log(`${' '.repeat(gate.length)}  resolvability UNCHECKED (journal unreadable) — the rates above may judge records that do not exist`);
      }
    }
    // Rater reliability prints beside the rates: a rate is a claim about the gate AND its rater.
    const rr = raterReliability(adj.records);
    const raters = Object.keys(rr).sort((a, b) => rr[b].judged - rr[a].judged);
    if (raters.length) {
      console.log('\nraters:');
      for (const name of raters) {
        const x = rr[name];
        // Agreement never prints alone: every branch carries coverage or an explicit unknown.
        const coverage = x.abstentionsRecorded === 'yes'
          ? `declined ${x.declinedOverlap} of ${x.overlapDecisions + x.declinedOverlap} it saw`
            + (x.coverage != null ? ` — coverage ${(x.coverage * 100).toFixed(0)}%` : '')
          : 'coverage UNKNOWN — this rater has recorded no declines, which is not the same as having made none';
        // declinedAll before unmeasured: a rater that refused everything has no verdict overlap.
        const verdict = x.declinedAll
          ? `DECLINED every one of the ${x.declinedOverlap} decision(s) it was cross-checked on — no agreement exists to report`
          : x.unmeasured
            ? 'agreement UNMEASURED — no decision of theirs was judged by anyone else'
            : `agreement ${(x.reliability * 100).toFixed(1)}% over ${x.overlapDecisions} shared decision(s)`
              + (x.overlap !== x.overlapDecisions ? ` (${x.overlap} pairwise comparisons)` : '')
              + ` · ${coverage}`;
        console.log(`  ${String(x.judged).padStart(5)}  ${name.slice(0, 46).padEnd(46)}  ${verdict}${x.isGold ? '  [GOLD — truth by construction]' : ''}`);
        // The cross-cohort warning prints with the figure it qualifies.
        const cross = x.pairs.filter((p) => p.crossCohort);
        if (cross.length) {
          console.log(`         WARNING: the comparison with ${cross.map((c) => c.other.slice(0, 40)).join(', ')} pools records from DIFFERENT asked-sets`);
          console.log('         (cohorts differ) — the shared decisions are an intersection neither rater chose.');
        }
      }
      const measured = raters.filter((r) => !rr[r].unmeasured).length;
      if (!measured) {
        console.log('  NO rater has been checked against another. Interrater reliability is undefined,');
        console.log('  not high: route a share of decisions to a second rater and it becomes computable.');
      }
    }
    if (adj.chain?.broken) { console.error(`adjudications chain BROKEN (${adj.chain.broken}) — the truth record itself was edited`); process.exit(1); }
    process.exit(0);
  }

  if (args.includes('--anchor')) {
    const r = anchorJournals();
    for (const a of r.anchored) console.log(`anchored ${a.file}: ${a.records} records${a.ok ? '' : ` (WRITE FAILED: ${a.error})`}`);
    if (!r.anchored.length) console.log(r.note || 'nothing to anchor');
    process.exit(r.anchored.some((a) => !a.ok) ? 1 : 0);
  }

  if (args.includes('--verify-anchors')) {
    const v = verifyAnchors();
    if (v.state === 'no-anchors') { console.log('no anchors recorded — nothing to verify (an absence, not a pass)'); process.exit(0); }
    if (v.state === 'anchors-unreadable') { console.error(`anchor store UNREADABLE (${v.detail}) — failing closed`); process.exit(1); }
    for (const r of v.results) console.log(`${r.file}: ${r.state} (anchored ${r.anchoredRecords}, now ${r.records ?? '?'})`);
    if (v.anchorChain?.broken) console.error(`anchor store chain BROKEN ×${v.anchorChain.broken} — the anchor record itself was edited`);
    if (v.state === 'ALARM') console.error('ANCHOR VERIFICATION FAILED — a journal lost or rewrote anchored history');
    process.exit(v.state === 'ALARM' || v.anchorChain?.broken ? 1 : 0);
  }

  if (args.includes('--anchor-data')) {
    // store-paths.mjs is a LEAF (importing monitor/issue-store.mjs here would close a cycle — it
    // references this module). This site previously hardcoded the path with no override at all, so
    // --anchor-data anchored the production store even under CW_ISSUES.
    const { issuesPathFor, annotationsPathFor } = await import('../monitor/store-paths.mjs');
    const stores = [
      { file: issuesPathFor(REPO), storeClass: 'rewritten' },
      { file: annotationsPathFor(REPO), storeClass: 'rewritten' },
    ];
    try {
      const { loadRegistry, areaOut } = await import('../monitor/registry.mjs');
      const { reportsRootDir } = await import('../monitor/area.mjs');
      const reg = loadRegistry({ quiet: true });
      const root = reportsRootDir(reg);
      for (const a of reg.areas || []) {
        const d = join(root, areaOut(a.slug, reg));
        stores.push({ file: join(d, 'rollup.json'), storeClass: 'rewritten' });
        stores.push({ file: join(d, 'history', 'index.json'), storeClass: 'index' });
      }
    } catch (e) {
      console.log(`(registry unavailable: ${e.message} — anchoring the two fixed top-level stores only)`);
    }
    let anyFail = false;
    for (const { file, storeClass } of stores) {
      const r = anchorDataStore(file, storeClass);
      if (r.ok) console.log(`anchored ${file} [${storeClass}]: ${r.bytes} bytes${r.rows != null ? `, ${r.rows} rows` : ''}`);
      else if (r.error === 'ENOENT') console.log(`skip ${file} [${storeClass}]: absent (nothing to anchor yet)`);
      else { anyFail = true; console.log(`FAILED ${file} [${storeClass}]: ${r.error}`); }
    }
    process.exit(anyFail ? 1 : 0);
  }

  if (args.includes('--retire-data-anchor')) {
    const file = args[args.indexOf('--retire-data-anchor') + 1];
    const at = args.indexOf('--reason');
    const r = retireDataAnchor(file ? resolve(file) : '', at >= 0 ? args[at + 1] : '');
    if (r.ok) console.log(`retired ${r.file} [${r.storeClass}]`);
    else console.error(`refused: ${r.file || '(no path)'}: ${r.error}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (args.includes('--verify-data-anchors')) {
    const v = verifyDataAnchors();
    if (v.state === 'no-anchors') { console.log('no data anchors recorded — nothing to verify (an absence, not a pass)'); process.exit(0); }
    if (v.state === 'anchors-unreadable') { console.error(`data anchor store UNREADABLE (${v.detail}) — failing closed`); process.exit(1); }
    for (const r of v.results) console.log(`${r.file} [${r.storeClass}]: ${r.state}${r.reason ? ` — ${r.reason}` : ''}`);
    if (v.state === 'ALARM') console.error('DATA ANCHOR VERIFICATION FAILED — an append-only or index store lost or rewrote anchored history');
    process.exit(v.state === 'ALARM' ? 1 : 0);
  }

  if (args.includes('--calibrate')) {
    let adj;
    try { adj = readAdjudications(); }
    catch (e) { console.error(`adjudications UNREADABLE (${e.code || 'error'}) — calibration cannot be computed`); process.exit(1); }
    const baseline = readCalibrateBaseline();
    if (baseline && baseline._error) {
      console.error(`calibrate baseline is corrupt or unreadable (${baseline.message}). It remains untouched — fix it and re-run.`);
      process.exit(1);
    }
    const windowStart = baseline ? baseline.at : null;
    const calib = computeFindingCalibration(adj.records, { windowStart });
    const { deltaRegressions, standingRegressions } = compareCalibrationToBaseline(calib, baseline);
    const alarm = deltaRegressions.length > 0;

    if (args.includes('--json')) {
      console.log(JSON.stringify(calib, null, 2));
    } else if (!Object.keys(calib.checks).length) {
      console.log('no finding-adjudication records — calibration is UNKNOWN, not zero');
    } else {
      const pct = (x) => (x == null ? 'n/a (no denominator)' : `${(x * 100).toFixed(1)}%`);
      console.log(`calibration @ ${calib.generated} (window since ${windowStart ?? 'bootstrap — no prior bake'}):`);
      for (const [check, models] of Object.entries(calib.checks)) {
        for (const [model, m] of Object.entries(models)) {
          console.log(`  ${check} / ${model}: false-alarm ${pct(m.falseAlarmRate)} · false-clean ${pct(m.falseCleanRate)}`
            + ` · standing ${m.cohorts.standing.adjudicated} adj / delta ${m.cohorts.delta.adjudicated} adj`
            + ` · ${m.cohortUnknown} cohort-unknown (counted standing) · ${m.unadjudicated} unadjudicated`);
        }
      }
      for (const r of standingRegressions) console.log(`  REPORT (standing, not alarmed): ${r.check}/${r.model} ${r.rateKey} ${(r.from * 100).toFixed(1)}% -> ${(r.to * 100).toFixed(1)}%`);
      for (const r of deltaRegressions) console.error(`  ALARM (delta cohort regressed): ${r.check}/${r.model} ${r.rateKey} ${(r.from * 100).toFixed(1)}% -> ${(r.to * 100).toFixed(1)}%`);
    }
    // Floor moves only on a clean bake — never baseline a regression.
    if (!alarm) writeCalibrateBaseline({ at: nowISO(), checks: bankedRatesFrom(calib) });
    process.exit(alarm ? 1 : 0);
  }

  if (!args.includes('--tally')) {
    console.error('usage: node bin/verdict-journal.mjs --tally [--json] | --metrics [--json] | --calibrate [--json] | --anchor | --verify-anchors | --anchor-data | --verify-data-anchors | --adjudicate --gate <g> --record-at <iso> --truth <t> --basis "…" --by <who>');
    process.exit(2);
  }
  const out = await tallySweeps(tally());
  if (args.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('gates:');
    for (const g of out.gates) {
      const detail = g.state === 'ok' || g.state === 'torn' || g.state === 'chain-broken'
        ? `last=${g.lastVerdict ?? '?'} at ${g.lastAt ?? '?'} · ${g.entries} entries${g.torn ? ` · ${g.torn} TORN` : ''}${g.chain?.broken ? ` · CHAIN BROKEN ×${g.chain.broken} (records were edited or removed)` : ''}${g.chain?.raced ? ` · ${g.chain.raced} raced` : ''}${g.silenced ? ` · ${g.silenced} silenced` : ''}`
        : g.state === 'stale-baseline-moved'
          ? `BASELINE MOVED WITHOUT RECORD — baseline ${g.baselineAt}, journal ${g.lastAt ?? 'never'}`
          : g.state === 'absent-not-running'
            ? 'no journal (gate not running — an absence, not a clean state)'
            : `UNREADABLE (${g.detail})`;
      console.log(`  ${g.gate.padEnd(14)} ${g.state.padEnd(22)} ${detail}`);
    }
    console.log('sweep areas:');
    if (out.sweepError) console.log(`  (${out.sweepError})`);
    for (const a of out.areas) {
      console.log(`  ${a.area.padEnd(22)} ${a.state.padEnd(10)} ${a.state === 'ok' || a.state === 'torn' ? `slice=${a.sliceId ?? '?'} rollup=${a.rollup ?? '?'} at ${a.lastAt ?? '?'}${a.torn ? ` · ${a.torn} TORN` : ''}` : ''}`);
    }
    if (out.fleet) console.log(`fleet: ${out.fleet.state}${out.fleet.lastAt ? ` · last ${out.fleet.lastAt} · ${out.fleet.clean ?? ''}` : ''}`);
    console.log('fatigue (suppressed, never adjudicated — proposals only, nothing here mutates anything):');
    if (out.fatigue?.state === 'unreadable') {
      console.log(`  (adjudications UNREADABLE: ${out.fatigue.detail})`);
    } else if (!out.fatigue || out.fatigue.empty) {
      console.log('  none — either nothing suppressed yet, or W3 has not started emitting suppression-label records');
    } else {
      for (const t of out.fatigue.targets) console.log(`  ${t.sentence}`);
    }
    // exit non-zero when evidence is being lost RIGHT NOW — the alarm states, not the absences
    const alarm = out.gates.some((g) => g.state === 'stale-baseline-moved' || g.state === 'unreadable' || g.state === 'chain-broken');
    process.exit(alarm ? 1 : 0);
  }
}

