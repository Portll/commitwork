// partialRetry: computes retry ledger from SARIF invocations (monitor/sarif-read.mjs partialRetry)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partialRetry } from '../sarif-read.mjs';

test('returns null retry when no invocations', () => {
  const input = [];
  const result = partialRetry(input);
  assert.equal(result, null);
});

test('returns null retry when no retries present', () => {
  const input = [{ properties: {} }];
  const result = partialRetry(input);
  assert.equal(result, null);
});

test('returns retry with no recovered when retry targets all timeout files', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['a.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    },
    {
      properties: {},
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ['a.txt'], timeoutSec: 5, recovered: [], stillTimedOut: [] });
});

test('returns retry with recovered file when retry does not target the timed out file', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['b.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    },
    {
      properties: {},
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ["b.txt"], timeoutSec: 5, recovered: [], stillTimedOut: [] });
});

test('returns retry with stillTimedOut when retry targets a different file', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['b.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    },
    {
      properties: { commitworkRetry: { files: ['a.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ["a.txt", "b.txt"], timeoutSec: 5, recovered: [], stillTimedOut: [] });
});

test('returns retry with multiple reasons and mixed targeting', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['c.txt'], timeoutSec: 3 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] },
        { descriptor: { id: 'parse' }, message: { text: 'parse error' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    },
    {
      properties: {},
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] },
        { descriptor: { id: 'parse' }, message: { text: 'parse error' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ["c.txt"], timeoutSec: 3, recovered: [], stillTimedOut: [] });
});

test('returns retry with no recovered when all timed out files are retargeted', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['a.txt', 'b.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] },
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.txt' } } }] }
      ]
    },
    {
      properties: { commitworkRetry: { files: ['a.txt', 'b.txt'], timeoutSec: 5 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.txt' } } }] },
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ['a.txt', 'b.txt'], timeoutSec: 5, recovered: [], stillTimedOut: [] });
});

test('returns retry with timeoutSec from last retry invocation', () => {
  const input = [
    {
      properties: { commitworkRetry: { files: ['x.txt'], timeoutSec: 10 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'x.txt' } } }] }
      ]
    },
    {
      properties: { commitworkRetry: { files: ['x.txt'], timeoutSec: 7 } },
      toolExecutionNotifications: [
        { descriptor: { id: 'timeout' }, message: { text: 'timeout' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'x.txt' } } }] }
      ]
    }
  ];
  const result = partialRetry(input);
  assert.deepEqual(result, { files: ['x.txt'], timeoutSec: 7, recovered: [], stillTimedOut: [] });
});
