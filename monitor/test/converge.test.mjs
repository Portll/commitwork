// converge.test.mjs — lane F: severity only on convergence; the gate scales inverse to oracle
// strength; tier-1 exempt from convergence but NOT from verification; correlated lenses count as one;
// cross-tier beats same-tier inference; a single lens caps at undetermined (the false-negative floor).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { converge, published } from '../converge.mjs';

describe('converge — oracle-strength stratification', () => {
  test('tier-1 with oracle-integrity publishes ALONE — converges with nothing', () => {
    const r = converge({ subject: 's', candidates: [{ tier: 1, lens: 'bola', provenance: 'probe', oracleIntegrity: true }] });
    assert.equal(r.publish, 'severity');
    assert.equal(r.witnesses.length, 1);
  });

  test('tier-1 WITHOUT oracle-integrity is refused, never published (the backstop)', () => {
    const r = converge({ subject: 's', candidates: [{ tier: 1, lens: 'bola', provenance: 'probe' }] });
    assert.notEqual(r.publish, 'severity');
    assert.match(r.publish, /refused|undetermined/);
    assert.equal(published(r), false);
  });

  test('a single tier-2 anomaly caps at undetermined', () => {
    const r = converge({ subject: 's', candidates: [{ tier: 2, lens: 'version-delta', provenance: 'snap' }] });
    assert.equal(r.publish, 'undetermined');
  });

  test('two INDEPENDENT tier-2 anomalies converge to severity', () => {
    const r = converge({ subject: 's', candidates: [
      { tier: 2, lens: 'version-delta', provenance: 'snapshot-delta' },
      { tier: 2, lens: 'lookalike', provenance: 'name-set' },
    ] });
    assert.equal(r.publish, 'severity');
    assert.equal(r.witnesses.length, 2);
  });

  test('a single tier-3 inference lens caps at undetermined (the false-negative floor)', () => {
    const r = converge({ subject: 's', candidates: [{ tier: 3, lens: 'reducer', provenance: 'qwen' }] });
    assert.equal(r.publish, 'undetermined');
    assert.match(r.why, /false-negative|caps at undetermined/);
  });
});

describe('converge — independence is per-subject provenance', () => {
  test('two tier-3 lenses SHARING provenance count as ONE — correlated agreement is not convergence', () => {
    const r = converge({ subject: 's', candidates: [
      { tier: 3, lens: 'reducerA', provenance: 'same-artifact' },
      { tier: 3, lens: 'reducerB', provenance: 'same-artifact' }, // same input ⇒ one witness
    ] });
    assert.equal(r.witnesses.length, 1);
    assert.equal(r.publish, 'undetermined');
  });

  test('two INDEPENDENT tier-3 lenses are DISCOUNTED (shared pretraining) → undetermined', () => {
    const r = converge({ subject: 's', candidates: [
      { tier: 3, lens: 'qwen', provenance: 'qwen-read' },
      { tier: 3, lens: 'opus', provenance: 'opus-read' },
    ] });
    assert.equal(r.witnesses.length, 2);
    assert.equal(r.publish, 'undetermined');
    assert.match(r.why, /shared pretraining|discounted/);
  });

  test('CROSS-TIER (inference + anomaly, independent) converges to severity — the strongest form', () => {
    const r = converge({ subject: 's', candidates: [
      { tier: 3, lens: 'reducer', provenance: 'qwen-read' },
      { tier: 2, lens: 'version-delta', provenance: 'snapshot-delta' },
    ] });
    assert.equal(r.publish, 'severity');
    assert.match(r.why, /cross-tier/);
  });

  test('cross-tier with a valid tier-1 still short-circuits to the oracle publishing alone', () => {
    const r = converge({ subject: 's', candidates: [
      { tier: 1, lens: 'bola', provenance: 'probe', oracleIntegrity: true },
      { tier: 3, lens: 'reducer', provenance: 'qwen-read' },
    ] });
    assert.equal(r.publish, 'severity');
    assert.equal(r.witnesses.length, 1); // the oracle alone
  });

  test('no candidates → undetermined, never clean', () => {
    assert.equal(converge({ subject: 's', candidates: [] }).publish, 'undetermined');
    assert.throws(() => converge({}), /subject is required/);
  });
});
