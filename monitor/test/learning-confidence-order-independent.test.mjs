import test from 'node:test';
import assert from 'node:assert/strict';

import { confidenceFromEvents } from '../learning.mjs';

const event = (type, n, outcome = undefined) => ({
  type,
  issueId: `ISS-TEST-S-${String(n).padStart(6, '0')}`,
  at: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
  data: { rule: 'js/xss', pathPrefix: 'admin/', package: null, ...(outcome ? { outcome } : {}) },
  prevHash: null,
  hash: `hash-${n}`,
});

test('Bayesian confidence is commutative across outcome-event order', () => {
  const events = [
    event('fix-authored', 1),
    event('fix-verified', 2),
    event('fix-disputed', 3),
    event('fp-reinvestigated', 4, 'confirmed'),
    event('fp-reinvestigated', 5, 'contradicted'),
  ];
  assert.deepEqual(confidenceFromEvents(events), confidenceFromEvents([...events].reverse()));
  assert.deepEqual(confidenceFromEvents(events), {
    confidenceAlpha: 4,
    confidenceBeta: 3,
    observations: 5,
    calibratedConfidence: 0.5446428571428571,
    tier: 'medium',
  });
});

test('low-volume confidence remains weak despite a positive prior', () => {
  assert.equal(confidenceFromEvents([event('fix-verified', 1)]).tier, 'weak');
});
