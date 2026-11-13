// rebuildLearning computes a learning document from issue store events (monitor/learning.mjs rebuildLearning).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rebuildLearning } from '../learning.mjs';

const baseEvent = (type, overrides = {}) => {
  const { data: overrideData = {}, ...restOverrides } = overrides;
  return {
    type,
    hash: 'h1',
    at: '2024-01-01T00:00:00.000Z',
    data: {
      pattern: { rule: 'R1', pathPrefix: 'src/', package: 'pkg1' },
      ...overrideData
    },
    ...restOverrides
  };
};

const policySnapshot = {
  contradictionPenalty: 0.25,
  jaccardThreshold: 0.45,
  learningDecayRate: 0.007701635339554948,
  minSupport: 3,
  rampObservations: 8,
  reinforceBonus: 0.15,
  strongWeightFloor: 0.2,
  tierMediumMinConfidence: 0.5,
  tierStrongMinConfidence: 0.75,
  tierStrongMinObservations: 4,
  tierWeakMaxObservations: 2,
  weightFloor: 0.05
};

const baseDoc = {
  note: 'commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify',
  version: 1,
  generatedAt: '2024-01-01T00:00:00.000Z',
  policySnapshot,
  patterns: {}
};

test('throws when issuesDoc is null', () => {
  assert.throws(() => rebuildLearning({ issuesDoc: null }), {
    name: 'Error',
    message: 'learning rebuild requires an issue store with events[]'
  });
});

test('throws when issuesDoc.events is not an array', () => {
  assert.throws(() => rebuildLearning({ issuesDoc: { events: 'not-array' } }), {
    name: 'Error',
    message: 'learning rebuild requires an issue store with events[]'
  });
});

test('returns empty patterns for empty events array', () => {
  const result = rebuildLearning({ issuesDoc: { events: [] }, now: '2024-01-01T00:00:00.000Z' });
  assert.deepEqual(result, {
    ...baseDoc,
    sourceEventCount: 0,
    sourceChainHead: null
  });
});

test('ignores non-learning events', () => {
  const result = rebuildLearning({
    issuesDoc: { events: [{ type: 'other', hash: 'h1', at: '2024-01-01T00:00:00.000Z', data: {} }] },
    now: '2024-01-01T00:00:00.000Z'
  });
  assert.deepEqual(result, {
    ...baseDoc,
    sourceEventCount: 1,
    sourceChainHead: 'h1'
  });
});

test('creates pattern for a helpful learning event', () => {
  const result = rebuildLearning({
    issuesDoc: { events: [baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' } })] },
    now: '2024-01-01T00:00:00.000Z'
  });
  assert.deepEqual(result, { note: "commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify", version: 1, generatedAt: "2024-01-01T00:00:00.000Z", sourceEventCount: 1, sourceChainHead: "h1", policySnapshot: { rampObservations: 8, weightFloor: 0.05, strongWeightFloor: 0.2, learningDecayRate: 0.007701635339554948, reinforceBonus: 0.15, contradictionPenalty: 0.25, jaccardThreshold: 0.45, minSupport: 3, tierStrongMinObservations: 4, tierStrongMinConfidence: 0.75, tierMediumMinConfidence: 0.5, tierWeakMaxObservations: 2 }, patterns: { "R1|src/|pkg1": { rule: "R1", pathPrefix: "src/", package: "pkg1", confidenceAlpha: 2, confidenceBeta: 1, observations: 1, calibratedConfidence: 0.5208333333333334, tier: "weak", weight: 1, weightAsOf: "2024-01-01T00:00:00.000Z", lastEventAt: "2024-01-01T00:00:00.000Z", lastEventType: "fp-reinvestigated", distinctAnnotators: 0, consolidated: null, citedEvents: ["h1"] } } });
});

test('creates pattern for a contradicted learning event', () => {
  const result = rebuildLearning({
    issuesDoc: { events: [baseEvent('fix-disputed')] },
    now: '2024-01-01T00:00:00.000Z'
  });
  assert.deepEqual(result, {
    ...baseDoc,
    sourceEventCount: 1,
    sourceChainHead: 'h1',
    patterns: {
      'R1|src/|pkg1': {
        rule: 'R1',
        pathPrefix: 'src/',
        package: 'pkg1',
        confidenceAlpha: 1,
        confidenceBeta: 2,
        observations: 1,
        calibratedConfidence: 0.4791666666666667,
        tier: 'weak',
        weight: 0.75,
        weightAsOf: '2024-01-01T00:00:00.000Z',
        lastEventAt: '2024-01-01T00:00:00.000Z',
        lastEventType: 'fix-disputed',
        distinctAnnotators: 0,
        consolidated: null,
        citedEvents: ['h1']
      }
    }
  });
});

test('computes weight and confidence for multiple events in order', () => {
  const events = [
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' }, hash: 'h1', at: '2024-01-01T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' }, hash: 'h2', at: '2024-01-02T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' }, hash: 'h3', at: '2024-01-03T00:00:00.000Z' })
  ];
  const result = rebuildLearning({ issuesDoc: { events }, now: '2024-01-04T00:00:00.000Z' });
  assert.deepEqual(result, { note: "commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify", version: 1, generatedAt: "2024-01-04T00:00:00.000Z", sourceEventCount: 3, sourceChainHead: "h3", policySnapshot: { rampObservations: 8, weightFloor: 0.05, strongWeightFloor: 0.2, learningDecayRate: 0.007701635339554948, reinforceBonus: 0.15, contradictionPenalty: 0.25, jaccardThreshold: 0.45, minSupport: 3, tierStrongMinObservations: 4, tierStrongMinConfidence: 0.75, tierMediumMinConfidence: 0.5, tierWeakMaxObservations: 2 }, patterns: { "R1|src/|pkg1": { rule: "R1", pathPrefix: "src/", package: "pkg1", confidenceAlpha: 4, confidenceBeta: 1, observations: 3, calibratedConfidence: 0.6125, tier: "medium", weight: 0.9923279462629435, weightAsOf: "2024-01-04T00:00:00.000Z", lastEventAt: "2024-01-03T00:00:00.000Z", lastEventType: "fp-reinvestigated", distinctAnnotators: 0, consolidated: null, citedEvents: ["h1", "h2", "h3"] } } });
});

test('throws when events are out of chronological order', () => {
  const events = [
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' }, hash: 'h2', at: '2024-01-02T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed' }, hash: 'h1', at: '2024-01-01T00:00:00.000Z' })
  ];
  assert.throws(() => rebuildLearning({ issuesDoc: { events }, now: '2024-01-03T00:00:00.000Z' }), {
    name: 'Error',
    message: 'learning events for R1|src/|pkg1 are out of chronological order'
  });
});

test('consolidates notes when minSupport met', () => {
  const events = [
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed', evidence: { note: 'similar note one' } }, hash: 'h1', at: '2024-01-01T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed', evidence: { note: 'similar note two' } }, hash: 'h2', at: '2024-01-02T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed', evidence: { note: 'similar note three' } }, hash: 'h3', at: '2024-01-03T00:00:00.000Z' })
  ];
  const result = rebuildLearning({ issuesDoc: { events }, now: '2024-01-04T00:00:00.000Z' });
  assert.deepEqual(result, { note: "commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify", version: 1, generatedAt: "2024-01-04T00:00:00.000Z", sourceEventCount: 3, sourceChainHead: "h3", policySnapshot: { rampObservations: 8, weightFloor: 0.05, strongWeightFloor: 0.2, learningDecayRate: 0.007701635339554948, reinforceBonus: 0.15, contradictionPenalty: 0.25, jaccardThreshold: 0.45, minSupport: 3, tierStrongMinObservations: 4, tierStrongMinConfidence: 0.75, tierMediumMinConfidence: 0.5, tierWeakMaxObservations: 2 }, patterns: { "R1|src/|pkg1": { rule: "R1", pathPrefix: "src/", package: "pkg1", confidenceAlpha: 4, confidenceBeta: 1, observations: 3, calibratedConfidence: 0.6125, tier: "medium", weight: 0.9923279462629435, weightAsOf: "2024-01-04T00:00:00.000Z", lastEventAt: "2024-01-03T00:00:00.000Z", lastEventType: "fp-reinvestigated", distinctAnnotators: 0, consolidated: { text: "similar note three", supportCount: 3, sourceAnnotations: ["h1", "h2", "h3"] }, citedEvents: ["h1", "h2", "h3"] } } });
});

test('does not consolidate when minSupport not met', () => {
  const events = [
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed', evidence: { note: 'note one' } }, hash: 'h1', at: '2024-01-01T00:00:00.000Z' }),
    baseEvent('fp-reinvestigated', { data: { outcome: 'confirmed', evidence: { note: 'note two' } }, hash: 'h2', at: '2024-01-02T00:00:00.000Z' })
  ];
  const result = rebuildLearning({ issuesDoc: { events }, now: '2024-01-03T00:00:00.000Z' });
  assert.deepEqual(result, { note: "commitwork learning view \u2014 regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify", version: 1, generatedAt: "2024-01-03T00:00:00.000Z", sourceEventCount: 2, sourceChainHead: "h2", policySnapshot: { rampObservations: 8, weightFloor: 0.05, strongWeightFloor: 0.2, learningDecayRate: 0.007701635339554948, reinforceBonus: 0.15, contradictionPenalty: 0.25, jaccardThreshold: 0.45, minSupport: 3, tierStrongMinObservations: 4, tierStrongMinConfidence: 0.75, tierMediumMinConfidence: 0.5, tierWeakMaxObservations: 2 }, patterns: { "R1|src/|pkg1": { rule: "R1", pathPrefix: "src/", package: "pkg1", confidenceAlpha: 3, confidenceBeta: 1, observations: 2, calibratedConfidence: 0.5625, tier: "medium", weight: 0.9923279462629435, weightAsOf: "2024-01-03T00:00:00.000Z", lastEventAt: "2024-01-02T00:00:00.000Z", lastEventType: "fp-reinvestigated", distinctAnnotators: 0, consolidated: null, citedEvents: ["h1", "h2"] } } });
});

test('uses CW_NOW environment variable when now not provided', () => {
  process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
  const result = rebuildLearning({ issuesDoc: { events: [] } });
  delete process.env.CW_NOW;
  assert.deepEqual(result, {
    ...baseDoc,
    sourceEventCount: 0,
    sourceChainHead: null
  });
});
