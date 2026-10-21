// Decides whether a subject's candidates converge to a publishable severity, undetermined, or refused-then-undetermined (monitor/converge.mjs converge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converge } from '../converge.mjs';

test('throws when subject is missing', () => {
  assert.throws(() => converge({ candidates: [{ tier: 1, lens: 'x' }] }), /converge: subject is required/);
});

test('returns undetermined when no candidates are provided', () => {
  const r = converge({ subject: 's1', candidates: [] });
  assert.deepEqual(r, {
    subject: 's1',
    publish: 'undetermined',
    witnesses: [],
    why: 'no candidates \u2014 undetermined, never clean'
  });
});

test('publishes severity alone when a tier-1 witness has oracle-integrity', () => {
  const r = converge({
    subject: 's2',
    candidates: [
      { tier: 1, lens: 'oracle-a', oracleIntegrity: true },
      { tier: 2, lens: 'anomaly-b' }
    ]
  });
  assert.equal(r.publish, 'severity');
  assert.equal(r.witnesses.length, 1);
  assert.equal(r.witnesses[0].lens, 'oracle-a');
  assert.match(r.why, /tier-1 oracle \(oracle-a\) passed oracle-integrity/);
});

test('returns refused-then-undetermined for a lone tier-1 witness without oracle-integrity', () => {
  const r = converge({
    subject: 's3',
    candidates: [{ tier: 1, lens: 'oracle-bad', oracleIntegrity: false }]
  });
  assert.equal(r.publish, 'refused-then-undetermined');
  assert.equal(r.witnesses.length, 1);
  assert.equal(r.witnesses[0].lens, 'oracle-bad');
  assert.match(r.why, /tier-1 candidate \(oracle-bad\) lacked oracle-integrity/);
});

test('returns refused-then-undetermined for multiple tier-1 witnesses none with oracle-integrity', () => {
  const r = converge({
    subject: 's4',
    candidates: [
      { tier: 1, lens: 'oracle-1', provenance: 'p1' },
      { tier: 1, lens: 'oracle-2', provenance: 'p2' }
    ]
  });
  assert.equal(r.publish, 'refused-then-undetermined');
  assert.equal(r.witnesses.length, 2);
  assert.match(r.why, /tier-1 candidates without oracle-integrity are refused/);
});

test('publishes severity via cross-tier convergence with two independent witnesses', () => {
  const r = converge({
    subject: 's5',
    candidates: [
      { tier: 2, lens: 'anomaly-x', provenance: 'p1' },
      { tier: 3, lens: 'inference-y', provenance: 'p2' }
    ]
  });
  assert.equal(r.publish, 'severity');
  assert.equal(r.witnesses.length, 2);
  assert.match(r.why, /cross-tier convergence/);
});

test('publishes severity via two independent tier-2 witnesses', () => {
  const r = converge({
    subject: 's6',
    candidates: [
      { tier: 2, lens: 'anomaly-a', provenance: 'p1' },
      { tier: 2, lens: 'anomaly-b', provenance: 'p2' }
    ]
  });
  assert.equal(r.publish, 'severity');
  assert.equal(r.witnesses.length, 2);
  assert.match(r.why, /two independent anomalies/);
});

test('returns undetermined for two independent tier-3 witnesses', () => {
  const r = converge({
    subject: 's7',
    candidates: [
      { tier: 3, lens: 'inference-a', provenance: 'p1' },
      { tier: 3, lens: 'inference-b', provenance: 'p2' }
    ]
  });
  assert.equal(r.publish, 'undetermined');
  assert.equal(r.witnesses.length, 2);
  assert.match(r.why, /same-tier inference\u00d7inference agreement is discounted/);
});

test('returns undetermined for a single tier-2 witness', () => {
  const r = converge({
    subject: 's8',
    candidates: [{ tier: 2, lens: 'anomaly-solo' }]
  });
  assert.equal(r.publish, 'undetermined');
  assert.equal(r.witnesses.length, 1);
  assert.match(r.why, /single tier-2 lens \(anomaly-solo\)/);
});

test('returns undetermined for a single tier-3 witness', () => {
  const r = converge({
    subject: 's9',
    candidates: [{ tier: 3, lens: 'inference-solo' }]
  });
  assert.equal(r.publish, 'undetermined');
  assert.equal(r.witnesses.length, 1);
  assert.match(r.why, /single inference lens \(inference-solo\)/);
});
