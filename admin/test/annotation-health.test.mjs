// aggregateAnnotationHealth — BOUND = applied ∪ carried: a per-area noMatch is not orphaned, only
// a record bound in NO area is. Counting only `applied` would report every suppression orphaned.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAnnotationHealth } from '../lib/annotation-health.mjs';

describe('aggregateAnnotationHealth', () => {
  test('CARRIED in its home area but noMatch elsewhere is NOT orphaned (the real-fleet case)', () => {
    const h = aggregateAnnotationHealth([
      { slug: 'clientD', status: { carried: [{ record: 'secrets:x|f@clientD' }] } },
      { slug: 'commitwork', status: { noMatch: [{ record: 'secrets:x|f@clientD' }] } },
    ]);
    assert.deepEqual(h.orphaned, []);
    assert.equal(h.boundCount, 1);
  });

  test('noMatch everywhere and bound nowhere IS orphaned, with the areas it appeared in', () => {
    const h = aggregateAnnotationHealth([
      { slug: 'a', status: { noMatch: [{ record: 'secrets:gone|f@a' }] } },
      { slug: 'b', status: { noMatch: [{ record: 'secrets:gone|f@a' }] } },
    ]);
    assert.equal(h.orphaned.length, 1);
    assert.deepEqual(h.orphaned[0], { record: 'secrets:gone|f@a', areas: ['a', 'b'] });
  });

  test('applied ALSO counts as bound — for the day the per-run matcher starts populating it', () => {
    const h = aggregateAnnotationHealth([
      { slug: 'a', status: { applied: [{ record: 'r' }] } },
      { slug: 'b', status: { noMatch: [{ record: 'r' }] } },
    ]);
    assert.deepEqual(h.orphaned, []);
  });

  test('expired and invalid pass through with their area — always, area-independent alarms', () => {
    const h = aggregateAnnotationHealth([
      { slug: 'a', status: { expired: [{ record: 'r', expires: '2020-01-01' }], invalid: [{ record: 'q', errors: ['bad'] }] } },
    ]);
    assert.equal(h.expired.length, 1);
    assert.equal(h.expired[0].area, 'a');
    assert.equal(h.invalid[0].errors[0], 'bad');
  });

  test('empty / null status is safe, never a throw', () => {
    assert.deepEqual(aggregateAnnotationHealth([]), { orphaned: [], expired: [], invalid: [], boundCount: 0 });
    assert.deepEqual(aggregateAnnotationHealth([{ slug: 'a', status: null }]).orphaned, []);
    assert.deepEqual(aggregateAnnotationHealth(undefined).orphaned, []);
  });
});
