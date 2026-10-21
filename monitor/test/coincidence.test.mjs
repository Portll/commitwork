// node --test monitor/test/ — coincidence.mjs: cross-KIND wall-clock correlation. Self-pairs are
// never correlated; a sparse pair is unexaminable rather than an outlier factory; the threshold is
// derived from the pair's own population and bounded absolutely; undated events are counted, not
// dropped silently; an empty lead list is distinguishable from an unexamined one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KIND, DEFAULTS, normaliseEvents, crossKindGaps, percentileGap, findCoincidences,
  eventsFromHistoryIndex, eventsFromIssueStore, eventsFromVerdictJournal,
} from '../coincidence.mjs';

const withTmp = (fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-coincide-'));
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
};

const T0 = Date.parse('2026-08-01T00:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();

/** A steady background: `n` A-events on a 600s cadence, each followed by a B-event `lagSec` later. */
function steady(n, lagSec, { kindA = KIND.SLICE, kindB = KIND.VERDICT } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ kind: kindA, at: at(i * 600), label: `a${i}` });
    out.push({ kind: kindB, at: at(i * 600 + lagSec), label: `b${i}` });
  }
  return out;
}

describe('normaliseEvents', () => {
  test('an unparseable timestamp is COUNTED, not silently dropped', () => {
    const { events, undated } = normaliseEvents([
      { kind: KIND.SLICE, at: '2026-08-01T00:00:00Z' },
      { kind: KIND.SLICE, at: 'whenever' },
      { kind: KIND.SLICE },
    ]);
    assert.equal(events.length, 1);
    assert.equal(undated, 2, 'a shrinking denominator must announce itself');
  });

  test('ordering is total — same millisecond does not reorder between runs', () => {
    const mk = () => normaliseEvents([
      { kind: KIND.VERDICT, at: at(0), label: 'z' },
      { kind: KIND.SLICE, at: at(0), label: 'a' },
      { kind: KIND.SLICE, at: at(0), label: 'b' },
    ]).events.map((e) => `${e.kind}:${e.label}`);
    assert.deepEqual(mk(), mk());
    assert.deepEqual(mk(), ['slice:a', 'slice:b', 'verdict:z']);
  });
});

describe('crossKindGaps', () => {
  test('SELF-pairs are never produced — a store\'s cadence with itself is not a coincidence', () => {
    const { events } = normaliseEvents(steady(5, 10));
    const gaps = crossKindGaps(events);
    for (const key of gaps.keys()) {
      const [a, b] = key.split('→');
      assert.notEqual(a, b, `self-pair ${key} must not be correlated`);
    }
  });

  test('the gap is to the NEXT B after A, and never backwards', () => {
    const { events } = normaliseEvents([
      { kind: KIND.VERDICT, at: at(0), label: 'before' },
      { kind: KIND.SLICE, at: at(100), label: 'a' },
      { kind: KIND.VERDICT, at: at(130), label: 'after' },
    ]);
    const rows = crossKindGaps(events).get('slice→verdict');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].gapSec, 30);
    assert.equal(rows[0].to.label, 'after');
  });

  test('a simultaneous B does not count as following A — strictly after', () => {
    const { events } = normaliseEvents([
      { kind: KIND.SLICE, at: at(0), label: 'a' },
      { kind: KIND.VERDICT, at: at(0), label: 'same-instant' },
    ]);
    assert.deepEqual(crossKindGaps(events).get('slice→verdict'), []);
  });
});

describe('percentileGap', () => {
  test('rank-based, no distribution assumed', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentileGap(s, 50), 6);
    assert.equal(percentileGap(s, 0), 1);
    assert.equal(percentileGap(s, 100), 10);
  });
  test('an empty population has no percentile — null, never 0', () => {
    assert.equal(percentileGap([], 50), null);
  });
});

describe('a sparse pair is UNEXAMINABLE, not an outlier factory', () => {
  test('two events an hour apart do not become a 0th-percentile coincidence', () => {
    const r = findCoincidences([
      { kind: KIND.SLICE, at: at(0), label: 'a' },
      { kind: KIND.VERDICT, at: at(3600), label: 'b' },
    ]);
    assert.deepEqual(r.leads, []);
    assert.equal(r.pairsExamined, 0);
    assert.equal(r.pairsUnexaminable, 2, 'both directions are unexaminable');
    assert.equal(r.pairs[0].unknownReason, 'unexaminable');
  });

  test('examinedAnything is what makes an empty lead list readable', () => {
    const sparse = findCoincidences([
      { kind: KIND.SLICE, at: at(0) }, { kind: KIND.VERDICT, at: at(10) },
    ]);
    assert.equal(sparse.leads.length, 0);
    assert.equal(sparse.examinedAnything, false, 'silence');

    const dense = findCoincidences(steady(20, 300));
    assert.equal(dense.leads.length, 0);
    assert.equal(dense.examinedAnything, true, 'a real clean result');
  });
});

describe('the threshold comes from the pair\'s own rhythm', () => {
  test('a gap far tighter than the pair\'s norm surfaces as a lead', () => {
    const events = steady(30, 300); // slice→verdict normally 300s
    events.push({ kind: KIND.SLICE, at: at(100000), label: 'trigger' });
    events.push({ kind: KIND.VERDICT, at: at(100003), label: 'consequence' });

    const r = findCoincidences(events, { minSamples: 5 });
    const lead = r.leads.find((l) => l.pair === 'slice→verdict');
    assert.ok(lead, 'the 3-second gap in a 300-second population must surface');
    assert.equal(lead.gapSec, 3);
    assert.equal(lead.from.label, 'trigger');
    assert.equal(lead.to.label, 'consequence');
  });

  test('the pair median rides along — a 3-second gap means nothing without it', () => {
    const events = steady(30, 300);
    events.push({ kind: KIND.SLICE, at: at(100000) }, { kind: KIND.VERDICT, at: at(100003) });
    const lead = findCoincidences(events, { minSamples: 5 }).leads.find((l) => l.pair === 'slice→verdict');
    assert.equal(lead.pairMedianSec, 300);
  });

  test('a uniformly tight pair produces no lead — tightness is relative, not absolute', () => {
    // Everything happens 2 seconds apart. Nothing is unusual, so nothing is reported.
    // Without the strict `< median` gate this pair flags 100% of itself: p2 of forty 2s is 2, and
    // `gap <= 2` matches every row. That is the defect signature CLAUDE.md names, self-inflicted.
    const r = findCoincidences(steady(40, 2), { minSamples: 5 });
    assert.deepEqual(r.leads.filter((l) => l.pair === 'slice→verdict'), []);
  });

  test('a gap EQUAL to the pair median is typical by definition, never a lead', () => {
    const events = steady(30, 300);
    events.push({ kind: KIND.SLICE, at: at(100000) }, { kind: KIND.VERDICT, at: at(100300) });
    const r = findCoincidences(events, { minSamples: 5 });
    assert.deepEqual(r.leads.filter((l) => l.pair === 'slice→verdict'), []);
  });

  test('a BIMODAL pair reports its shape and emits nothing — the mode is not a lead', () => {
    // Half the gaps 1s, half 1000s. Statistically the 1s are an extreme tail; structurally they
    // are one of two modes, and twenty "leads" would bury any real one.
    const events = [];
    for (let i = 0; i < 40; i += 1) {
      events.push({ kind: KIND.SLICE, at: at(i * 10000) });
      events.push({ kind: KIND.VERDICT, at: at(i * 10000 + (i % 2 === 0 ? 1 : 1000)) });
    }
    const r = findCoincidences(events, { minSamples: 5 });
    const pair = r.pairs.find((p) => p.pair === 'slice→verdict');
    assert.equal(pair.degenerate, true);
    assert.ok(pair.candidateFraction > 0.1, 'and the fraction that triggered the suppression is published');
    assert.deepEqual(r.leads.filter((l) => l.pair === 'slice→verdict'), []);
  });

  test('the fraction ceiling does NOT suppress a genuine lone outlier', () => {
    const events = steady(40, 300);
    events.push({ kind: KIND.SLICE, at: at(100000) }, { kind: KIND.VERDICT, at: at(100003) });
    const r = findCoincidences(events, { minSamples: 5 });
    const pair = r.pairs.find((p) => p.pair === 'slice→verdict');
    assert.notEqual(pair.degenerate, true);
    assert.equal(r.leads.filter((l) => l.pair === 'slice→verdict').length, 1);
  });

  test('maxGapSec bounds the tail absolutely — a p2 of four hours is no coincidence', () => {
    // A pair whose gaps are all hours long: its 2nd percentile is still hours.
    const events = [];
    for (let i = 0; i < 40; i += 1) {
      events.push({ kind: KIND.SLICE, at: at(i * 86400) });
      events.push({ kind: KIND.VERDICT, at: at(i * 86400 + 14400 + i * 60) });
    }
    const r = findCoincidences(events, { minSamples: 5 });
    assert.deepEqual(r.leads, [], 'the absolute bound must veto a statistically extreme but temporally meaningless gap');
    const pair = r.pairs.find((p) => p.pair === 'slice→verdict');
    assert.equal(pair.cutSec, DEFAULTS.maxGapSec);
    assert.ok(pair.thresholdSec > DEFAULTS.maxGapSec, 'and the un-bounded threshold is still published');
  });
});

describe('collapse on the consequence', () => {
  test('a burst of antecedents pairing with ONE consequence is one lead, and the burst is counted', () => {
    const events = steady(40, 300);
    // Nine slice events at the same instant, all followed by the same verdict 0.011s later.
    for (let i = 0; i < 9; i += 1) events.push({ kind: KIND.SLICE, at: at(100000), label: `burst${i}` });
    events.push({ kind: KIND.VERDICT, at: at(100000.011), label: 'consequence' });

    const r = findCoincidences(events, { minSamples: 5 });
    const leads = r.leads.filter((l) => l.pair === 'slice→verdict');
    assert.equal(leads.length, 1, 'nine identical rows are one coincidence');
    assert.equal(leads[0].antecedents, 9, 'and the burst size is published, not discarded');
    const pair = r.pairs.find((p) => p.pair === 'slice→verdict');
    assert.equal(pair.hits, 9, 'the raw row count stays visible');
    assert.equal(pair.coincidences, 1, 'beside the collapsed count');
  });

  test('the TIGHTEST gap in the burst is the one kept', () => {
    const events = steady(40, 300);
    events.push({ kind: KIND.SLICE, at: at(100000), label: 'far' });
    events.push({ kind: KIND.SLICE, at: at(100000.5), label: 'near' });
    events.push({ kind: KIND.VERDICT, at: at(100001), label: 'consequence' });
    // percentile 10 so BOTH antecedents clear the cut and there is a burst to collapse at all —
    // at p2 over 42 rows the cut is the minimum gap and only the tighter one is ever a candidate.
    const leads = findCoincidences(events, { minSamples: 5, percentile: 10 }).leads.filter((l) => l.pair === 'slice→verdict');
    assert.equal(leads.length, 1);
    assert.equal(leads[0].from.label, 'near');
    assert.equal(leads[0].antecedents, 2);
    assert.equal(leads[0].gapSec, 0.5, 'the tightest gap, not the first or last seen');
  });

  test('distinct consequences stay distinct — the collapse is not a cap', () => {
    const events = steady(40, 300);
    events.push({ kind: KIND.SLICE, at: at(100000) }, { kind: KIND.VERDICT, at: at(100001), label: 'c1' });
    events.push({ kind: KIND.SLICE, at: at(200000) }, { kind: KIND.VERDICT, at: at(200001), label: 'c2' });
    const leads = findCoincidences(events, { minSamples: 5 }).leads.filter((l) => l.pair === 'slice→verdict');
    assert.equal(leads.length, 2);
  });
});

describe('determinism', () => {
  test('identical input, byte-identical output under CW_NOW', () => {
    const events = steady(30, 300);
    events.push({ kind: KIND.SLICE, at: at(100000) }, { kind: KIND.VERDICT, at: at(100003) });
    process.env.CW_NOW = '2026-08-26T00:00:00.000Z';
    try {
      const a = JSON.stringify(findCoincidences(events, { minSamples: 5 }));
      const b = JSON.stringify(findCoincidences(events.slice().reverse(), { minSamples: 5 }));
      assert.equal(a, b, 'input order must not change the report');
    } finally { delete process.env.CW_NOW; }
  });
});

describe('collectors report what they could not read', () => {
  test('an absent history index yields no events AND says why', () => {
    const r = eventsFromHistoryIndex(join(tmpdir(), 'cw-coincide-nope'));
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.missing, [{ source: join(tmpdir(), 'cw-coincide-nope', 'index.json'), reason: 'absent' }]);
  });

  test('a corrupt issue store is unparseable, not empty', () => withTmp((d) => {
    const p = join(d, 'issues.json');
    writeFileSync(p, '{oops');
    const r = eventsFromIssueStore(p);
    assert.deepEqual(r.events, []);
    assert.equal(r.missing[0].reason, 'unparseable');
  }));

  test('a store with no events[] is not-recorded, distinct from absent', () => withTmp((d) => {
    const p = join(d, 'issues.json');
    writeFileSync(p, JSON.stringify({ issues: {} }));
    assert.equal(eventsFromIssueStore(p).missing[0].reason, 'not-recorded');
  }));

  test('history rows become slice events keyed on `generated`', () => withTmp((d) => {
    mkdirSync(join(d, 'history'), { recursive: true });
    writeFileSync(join(d, 'history', 'index.json'), JSON.stringify([
      { file: 'a.json', sliceId: 'sweep-a', generated: at(0) },
      { file: 'b.json', sliceId: 'sweep-b' }, // no timestamp — excluded here, not later
    ]));
    const r = eventsFromHistoryIndex(join(d, 'history'));
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].kind, KIND.SLICE);
    assert.equal(r.events[0].label, 'sweep-a');
  }));

  test('one corrupt journal line does not discard the journal', () => withTmp((d) => {
    writeFileSync(join(d, 'v.jsonl'), `${JSON.stringify({ at: at(0), gate: 'g1' })}\nnot json\n${JSON.stringify({ at: at(5), gate: 'g2' })}\n`);
    const r = eventsFromVerdictJournal(d);
    assert.equal(r.events.length, 2);
  }));

  test('an absent journal dir is absent, and a rotated generation is still read', () => withTmp((d) => {
    assert.equal(eventsFromVerdictJournal(join(d, 'nope')).missing[0].reason, 'absent');
    writeFileSync(join(d, 'v.jsonl'), `${JSON.stringify({ at: at(0), gate: 'now' })}\n`);
    writeFileSync(join(d, 'v.jsonl.1'), `${JSON.stringify({ at: at(-10), gate: 'older' })}\n`);
    assert.equal(eventsFromVerdictJournal(d).events.length, 2, 'a missed rotation under a denominator flatters every rate');
  }));
});
