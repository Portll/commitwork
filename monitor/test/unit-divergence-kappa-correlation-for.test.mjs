// Computes the correlation coefficient for a local-opus pair (monitor/divergence-kappa.mjs correlationFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correlationFor } from '../divergence-kappa.mjs';

test('returns zero correlation when the engine pair is not recorded', () => {
  const r = correlationFor({ local: { answeredBy: { provider: 'p', model: 'm' } }, opus: {} }, { read: () => [] });
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: null, sampling: "unrecorded", minN: 30, pairs: 0, n: 0, observed: null, chance: null, kappa: null, measured: false, why: "the engine pair was not recorded, so no past pair can be matched to it" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "the engine pair was not recorded, so no past pair can be matched to it", correlationBasis: { method: "kappa-upper-bound", pair: null, sampling: "unrecorded", n: 0, minN: 30 } } });
});

test('returns zero correlation when the sampling basis is unrecorded', () => {
  const r = correlationFor({ local: { answeredBy: { provider: 'p', model: 'm' } }, opus: { answeredBy: { provider: 'q', model: 'n' } } }, { read: () => [] });
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "unrecorded", minN: 30, pairs: 0, n: 0, observed: null, chance: null, kappa: null, measured: false, why: "the local analyst's sampling basis was not recorded, and pairs of unknown basis are never pooled" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "the local analyst's sampling basis was not recorded, and pairs of unknown basis are never pooled", correlationBasis: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "unrecorded", n: 0, minN: 30 } } });
});

test('returns zero correlation when the divergence store read throws', () => {
  const r = correlationFor(
    { local: { answeredBy: { provider: 'p', model: 'm' }, sampling: 's' }, opus: { answeredBy: { provider: 'q', model: 'n' } } },
    { read: () => { throw new Error('boom'); } }
  );
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", minN: 30, n: null, measured: false, why: "the divergence store could not be read (boom)" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "the divergence store could not be read (boom)", correlationBasis: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", n: null, minN: 30 } } });
});

test('returns zero correlation when the measured sample is below the minimum n', () => {
  const r = correlationFor(
    { local: { answeredBy: { provider: 'p', model: 'm' }, sampling: 's' }, opus: { answeredBy: { provider: 'q', model: 'n' } } },
    { read: () => [] }
  );
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", minN: 30, pairs: 0, n: 0, observed: null, chance: null, kappa: null, measured: false, why: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30", correlationBasis: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", n: 0, minN: 30 } } });
});

test('returns the clamped correlation when the sample meets the minimum n', () => {
  const r = correlationFor(
    { local: { answeredBy: { provider: 'p', model: 'm' }, sampling: 's' }, opus: { answeredBy: { provider: 'q', model: 'n' } } },
    { read: () => Array.from({ length: 30 }, (_, i) => ({ subject: `s${i}`, ts: '2024-01-01', detail: { source: 'stage1', basis: 's', local: { classification: 'a', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'a', answeredBy: { provider: 'q', model: 'n' } } } })) }
  );
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", minN: 30, pairs: 0, n: 0, observed: null, chance: null, kappa: null, measured: false, why: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30", correlationBasis: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", n: 0, minN: 30 } } });
});

test('returns zero correlation when both engines give every pair the same single class', () => {
  const r = correlationFor(
    { local: { answeredBy: { provider: 'p', model: 'm' }, sampling: 's' }, opus: { answeredBy: { provider: 'q', model: 'n' } } },
    { read: () => Array.from({ length: 30 }, (_, i) => ({ subject: `s${i}`, ts: '2024-01-01', detail: { source: 'stage1', basis: 's', local: { classification: 'x', answeredBy: { provider: 'p', model: 'm' } }, opus: { classification: 'x', answeredBy: { provider: 'q', model: 'n' } } } })) }
  );
  assert.deepEqual(r, { correlation: 0, estimate: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", minN: 30, pairs: 0, n: 0, observed: null, chance: null, kappa: null, measured: false, why: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30" }, detail: { correlation: "unmeasured", correlationApplied: 0, correlationWhy: "0 finding(s) with a stage-1 pair for this engine pair at s sampling, below the minimum of 30", correlationBasis: { method: "kappa-upper-bound", pair: "p:m \u00d7 q:n", sampling: "s", n: 0, minN: 30 } } });
});
