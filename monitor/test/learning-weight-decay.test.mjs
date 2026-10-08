import test from 'node:test';
import assert from 'node:assert/strict';

import { decayWeight, rebuildLearning } from '../learning.mjs';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const learned = (type, at, hash) => ({
  type,
  issueId: 'ISS-TEST-S-000001',
  at,
  data: { rule: 'js/xss', pathPrefix: 'admin/', package: null },
  prevHash: null,
  hash,
});

test('exponential weight has a 90-day half-life and an explicit floor', () => {
  close(decayWeight(1, 0, 0.05), 1);
  close(decayWeight(1, 30, 0.05), 2 ** (-1 / 3));
  close(decayWeight(1, 90, 0.05), 0.5);
  close(decayWeight(1, 180, 0.05), 0.25);
  close(decayWeight(1, 900, 0.05), 0.05);
});

test('rebuild decays an idle pattern through generatedAt even without a new event', () => {
  const issuesDoc = { events: [learned('fix-verified', '2026-01-01T00:00:00.000Z', 'h1')] };
  const atEvent = rebuildLearning({ issuesDoc, now: '2026-01-01T00:00:00.000Z' });
  const afterQuarter = rebuildLearning({ issuesDoc, now: '2026-04-01T00:00:00.000Z' });
  close(atEvent.patterns['js/xss|admin/|'].weight, 1);
  close(afterQuarter.patterns['js/xss|admin/|'].weight, 0.5);
});

test('contradiction penalty is applied after inter-event decay', () => {
  const issuesDoc = { events: [
    learned('fix-verified', '2026-01-01T00:00:00.000Z', 'h1'),
    learned('fix-disputed', '2026-04-01T00:00:00.000Z', 'h2'),
  ] };
  const doc = rebuildLearning({ issuesDoc, now: '2026-04-01T00:00:00.000Z' });
  close(doc.patterns['js/xss|admin/|'].weight, 0.25);
});

test('out-of-order weight events fail closed', () => {
  const issuesDoc = { events: [
    learned('fix-disputed', '2026-02-01T00:00:00.000Z', 'h2'),
    learned('fix-verified', '2026-01-01T00:00:00.000Z', 'h1'),
  ] };
  assert.throws(() => rebuildLearning({ issuesDoc, now: '2026-03-01T00:00:00.000Z' }), /out of chronological order/);
});
