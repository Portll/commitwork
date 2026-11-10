// Computes liveness of stores and artifacts in a dependency graph (flow/liveness.mjs liveness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveness } from '../liveness.mjs';

test('returns empty stores when no nodes have consumers', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false },
      { id: 'node:artifact:build', kind: 'artifact', path: 'build.bin', composed: false }
    ],
    edges: []
  };
  const result = liveness(input, { root: '/repo' });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, []);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 0,
    present: 0,
    absent: 0,
    unknown: 0,
    withConsumerAssumingNothing: 0,
    consumersAssumingNothing: 0,
    absentButRead: []
  });
});

test('marks store as absent when mtime is null and has consumer with freshness', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache', freshness: { marker: 'mtime' }, fallback: { marker: 'rebuild' } }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [{
      module: 'app',
      assumes: { kind: 'checked', marker: 'mtime' },
      fallback: 'rebuild'
    }],
    findings: {
      consumersAssumingNothing: [],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 0,
    consumersAssumingNothing: 0,
    absentButRead: ['cache.json']
  });
});

test('marks store as absent when mtime is null and consumer assumes nothing', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'missing.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'missing.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [{
      module: 'app',
      assumes: null,
      fallback: null
    }],
    findings: {
      consumersAssumingNothing: ['app'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 1,
    absentButRead: ['missing.json']
  });
});

test('skips composed stores from state detection', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:virtual', kind: 'store', path: 'virtual.json', composed: true }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:virtual' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'virtual.json',
    kind: 'store',
    composed: true,
    state: 'unknown',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [{
      module: 'app',
      assumes: null,
      fallback: null
    }],
    findings: {
      consumersAssumingNothing: ['app'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 0,
    unknown: 1,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 1,
    absentButRead: []
  });
});

test('reports noProducerInSet when no writes edge exists', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [{
      module: 'app',
      assumes: null,
      fallback: null
    }],
    findings: {
      consumersAssumingNothing: ['app'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 1,
    absentButRead: ['cache.json']
  });
});

test('reports noProducerInSet false when writes edge exists', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' },
      { kind: 'writes', from: 'node:module:writer', to: 'node:store:cache' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: ['writer'],
    consumers: [{
      module: 'app',
      assumes: null,
      fallback: null
    }],
    findings: {
      consumersAssumingNothing: ['app'],
      noProducerInSet: false
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 1,
    absentButRead: ['cache.json']
  });
});

test('reports consumersAssumingNothing when no freshness marker', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' },
      { kind: 'reads', from: 'node:module:other', to: 'node:store:cache', freshness: { marker: 'mtime' } }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [
      { module: 'app', assumes: null, fallback: null },
      { module: 'other', assumes: { kind: 'checked', marker: 'mtime' }, fallback: null }
    ],
    findings: {
      consumersAssumingNothing: ['app'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 1,
    absentButRead: ['cache.json']
  });
});

test('handles multiple consumers with mixed freshness', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' },
      { kind: 'reads', from: 'node:module:other', to: 'node:store:cache', freshness: { marker: 'mtime' }, fallback: { marker: 'rebuild' } },
      { kind: 'reads', from: 'node:module:third', to: 'node:store:cache' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [
      { module: 'app', assumes: null, fallback: null },
      { module: 'other', assumes: { kind: 'checked', marker: 'mtime' }, fallback: 'rebuild' },
      { module: 'third', assumes: null, fallback: null }
    ],
    findings: {
      consumersAssumingNothing: ['app', 'third'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 2,
    absentButRead: ['cache.json']
  });
});

test('filters out non-store and non-artifact nodes', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:module:app', kind: 'module', path: 'app.js' },
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false },
      { id: 'node:artifact:build', kind: 'artifact', path: 'build.bin', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' },
      { kind: 'reads', from: 'node:module:app', to: 'node:artifact:build' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [
    {
      path: 'build.bin',
      kind: 'artifact',
      composed: false,
      state: 'absent',
      lastWriteAt: null,
      ageMs: null,
      writers: [],
      consumers: [{ module: 'app', assumes: null, fallback: null }],
      findings: { consumersAssumingNothing: ['app'], noProducerInSet: true }
    },
    {
      path: 'cache.json',
      kind: 'store',
      composed: false,
      state: 'absent',
      lastWriteAt: null,
      ageMs: null,
      writers: [],
      consumers: [{ module: 'app', assumes: null, fallback: null }],
      findings: { consumersAssumingNothing: ['app'], noProducerInSet: true }
    }
  ]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 2,
    present: 0,
    absent: 2,
    unknown: 0,
    withConsumerAssumingNothing: 2,
    consumersAssumingNothing: 2,
    absentButRead: ['build.bin', 'cache.json']
  });
});

test('handles store with multiple read edges for same consumer', () => {
  const input = {
    root: '/repo',
    nodes: [
      { id: 'node:store:cache', kind: 'store', path: 'cache.json', composed: false }
    ],
    edges: [
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' },
      { kind: 'reads', from: 'node:module:app', to: 'node:store:cache' }
    ]
  };
  const result = liveness(input, { root: '/repo', env: { NOW: '2024-01-01T00:00:00Z' } });
  assert.equal(result.v, 1);
  assert.deepEqual(result.stores, [{
    path: 'cache.json',
    kind: 'store',
    composed: false,
    state: 'absent',
    lastWriteAt: null,
    ageMs: null,
    writers: [],
    consumers: [
      { module: 'app', assumes: null, fallback: null },
      { module: 'app', assumes: null, fallback: null }
    ],
    findings: {
      consumersAssumingNothing: ['app', 'app'],
      noProducerInSet: true
    }
  }]);
  assert.deepEqual(result.summary, {
    storesWithConsumers: 1,
    present: 0,
    absent: 1,
    unknown: 0,
    withConsumerAssumingNothing: 1,
    consumersAssumingNothing: 2,
    absentButRead: ['cache.json']
  });
});
