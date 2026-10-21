// Collects residual and backlog entries from dimensions and followOnBridge (bin/eval-delta.mjs collectResiduals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectResiduals } from '../eval-delta.mjs';

test('returns empty array when dimensions is empty and followOnBridge is missing', () => {
  const doc = { dimensions: {} };
  assert.deepEqual(collectResiduals(doc), []);
});

test('returns empty array when dimensions is empty and followOnBridge is empty array', () => {
  const doc = { dimensions: {}, followOnBridge: [] };
  assert.deepEqual(collectResiduals(doc), []);
});

test('includes dimension entry when residual is non-empty string and not em-dash', () => {
  const doc = {
    dimensions: {
      perf: { residual: '  fix latency  ', backlog: 'B1' }
    }
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'dimension:perf', text: 'fix latency', ref: 'B1', nonActionable: false }
  ]);
});

test('excludes dimension entry when residual is em-dash', () => {
  const doc = {
    dimensions: {
      perf: { residual: '\u2014' }
    }
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('excludes dimension entry when residual is empty string', () => {
  const doc = {
    dimensions: {
      perf: { residual: '' }
    }
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('excludes dimension entry when residual is whitespace only', () => {
  const doc = {
    dimensions: {
      perf: { residual: '   ' }
    }
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('excludes dimension entry when residual is not a string', () => {
  const doc = {
    dimensions: {
      perf: { residual: 42 }
    }
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('excludes dimension entry when value is null', () => {
  const doc = {
    dimensions: {
      perf: null
    }
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('sets nonActionable to true when dimension has nonActionable true', () => {
  const doc = {
    dimensions: {
      perf: { residual: 'known issue', nonActionable: true }
    }
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'dimension:perf', text: 'known issue', ref: null, nonActionable: true }
  ]);
});

test('uses backlogRef when backlog is missing', () => {
  const doc = {
    dimensions: {
      perf: { residual: 'fix it', backlogRef: 'B2' }
    }
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'dimension:perf', text: 'fix it', ref: 'B2', nonActionable: false }
  ]);
});

test('includes followOnBridge entry when item is a string with BACKLOG reference', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'BACKLOG A', rank: 1 }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:1', text: 'BACKLOG A', ref: 'A' }
  ]);
});

test('includes followOnBridge entry when item is a string with parenthesized reference', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'some task (B)', rank: 2 }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:2', text: 'some task (B)', ref: 'B' }
  ]);
});

test('uses explicit backlog field over regex match in followOnBridge', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'BACKLOG A', rank: 1, backlog: 'C' }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:1', text: 'BACKLOG A', ref: 'C' }
  ]);
});

test('uses explicit backlogRef over regex match in followOnBridge', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'BACKLOG A', rank: 1, backlogRef: 'D' }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:1', text: 'BACKLOG A', ref: 'D' }
  ]);
});

test('sets ref to null when no backlog, backlogRef, or regex match in followOnBridge', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'just a task', rank: 3 }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:3', text: 'just a task', ref: null }
  ]);
});

test('uses question mark for rank when rank is missing in followOnBridge', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 'BACKLOG E' }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'followOn:?', text: 'BACKLOG E', ref: 'E' }
  ]);
});

test('excludes followOnBridge entry when item is not a string', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      { item: 123, rank: 1 }
    ]
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('excludes followOnBridge entry when entry is null', () => {
  const doc = {
    dimensions: {},
    followOnBridge: [
      null
    ]
  };
  assert.deepEqual(collectResiduals(doc), []);
});

test('handles multiple dimensions and followOnBridge entries together', () => {
  const doc = {
    dimensions: {
      perf: { residual: 'fix latency', backlog: 'B1' },
      quality: { residual: '\u2014' },
      security: { residual: 'patch vuln', nonActionable: true }
    },
    followOnBridge: [
      { item: 'BACKLOG A', rank: 1 },
      { item: 'task (C)', rank: 2 },
      { item: 'no ref', rank: 3 }
    ]
  };
  assert.deepEqual(collectResiduals(doc), [
    { source: 'dimension:perf', text: 'fix latency', ref: 'B1', nonActionable: false },
    { source: 'dimension:security', text: 'patch vuln', ref: null, nonActionable: true },
    { source: 'followOn:1', text: 'BACKLOG A', ref: 'A' },
    { source: 'followOn:2', text: 'task (C)', ref: 'C' },
    { source: 'followOn:3', text: 'no ref', ref: null }
  ]);
});
