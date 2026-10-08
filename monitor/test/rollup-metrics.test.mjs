// monitor/test/rollup-metrics.test.mjs — `metrics`: lanes that measure rather than find (D4:
// stubs stay collected, stop being findings). Three-way distinction: ran+rows -> total+byRepo;
// ran+no rows -> counts only and SAYS so; did not run -> {ran:false} with NO total — absent,
// never zero. rollup.mjs is a driver, so the projection is tested against assembled shapes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRIC_CATEGORIES } from '../extractors.mjs';

// The projection exactly as rollup.mjs performs it. Kept in step by asserting the vocabulary it
// iterates (METRIC_CATEGORIES) rather than a hardcoded list.
function projectMetrics(scannerFleet, scannerFindings) {
  const metrics = {};
  for (const cat of METRIC_CATEGORIES) {
    const lane = scannerFleet[cat];
    const ran = !!(lane && lane.ran);
    if (!ran) { metrics[cat] = { ran: false }; continue; }
    const rows = Array.isArray(scannerFindings[cat]) ? scannerFindings[cat] : null;
    if (!rows) { metrics[cat] = { ran: true, total: Number(lane.total) || 0, byRepo: null, detail: 'counts only — no detail rows published' }; continue; }
    const byRepo = {};
    for (const r of rows) { const k = r && r.repo; if (k) byRepo[k] = (byRepo[k] || 0) + 1; }
    metrics[cat] = { ran: true, total: rows.length, byRepo };
  }
  return metrics;
}

test('a lane that ran with rows reports a total and a per-repo count', () => {
  const m = projectMetrics(
    { stubs: { ran: true, total: 3 } },
    { stubs: [{ repo: 'a' }, { repo: 'a' }, { repo: 'b' }] },
  );
  assert.equal(m.stubs.ran, true);
  assert.equal(m.stubs.total, 3);
  assert.deepEqual(m.stubs.byRepo, { a: 2, b: 1 }, 'per-repo is the unit an operator can act on');
});

test('A LANE THAT DID NOT RUN IS ABSENT, NOT ZERO — explicit uncertainty', () => {
  // a dormant lane publishing total:0 would be indistinguishable from a genuinely clean repo
  const m = projectMetrics({}, {});
  for (const cat of METRIC_CATEGORIES) {
    assert.equal(m[cat].ran, false, `${cat} did not run`);
    assert.equal('total' in m[cat], false, `${cat} must publish NO total — 0 would read as "found nothing"`);
  }
});

test('a lane that ran but published no detail rows says so, rather than reporting zero', () => {
  const m = projectMetrics({ stubs: { ran: true, total: 41 } }, {});
  assert.equal(m.stubs.total, 41, 'the count comes from the lane itself');
  assert.equal(m.stubs.byRepo, null, 'and the per-repo breakdown is explicitly absent');
  assert.match(m.stubs.detail, /counts only/);
});

test('a lane that ran and genuinely found nothing DOES report zero', () => {
  const m = projectMetrics({ stubs: { ran: true, total: 0 } }, { stubs: [] });
  assert.equal(m.stubs.ran, true);
  assert.equal(m.stubs.total, 0, 'ran-and-clean is a real state and is reported as one');
  assert.deepEqual(m.stubs.byRepo, {});
});

test('rows with no repo do not invent a bucket', () => {
  const m = projectMetrics({ stubs: { ran: true } }, { stubs: [{ repo: 'a' }, {}, { repo: null }] });
  assert.equal(m.stubs.total, 3, 'they are still counted');
  assert.deepEqual(m.stubs.byRepo, { a: 1 }, 'but attributed to nobody rather than to "undefined"');
});
