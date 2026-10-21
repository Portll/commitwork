// Serializes records sorted by platform, node, and job (bin/platform-support.mjs serialize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from '../platform-support.mjs';

test('serializes empty records array', () => {
  const result = serialize([]);
  assert.equal(result, '{\n  "generatedBy": "bin/platform-support.mjs",\n  "records": []\n}\n');
});

test('serializes single record', () => {
  const records = [{ platform: 'linux', node: '18', job: 'build' }];
  const result = serialize(records);
  assert.equal(result, '{\n  "generatedBy": "bin/platform-support.mjs",\n  "records": [\n    {\n      "platform": "linux",\n      "node": "18",\n      "job": "build"\n    }\n  ]\n}\n');
});

test('sorts by platform alphabetically', () => {
  const records = [
    { platform: 'windows', node: '18', job: 'a' },
    { platform: 'linux', node: '18', job: 'b' },
    { platform: 'macos', node: '18', job: 'c' }
  ];
  const result = serialize(records);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.records.map(r => r.platform), ['linux', 'macos', 'windows']);
});

test('sorts by node numerically when platforms equal', () => {
  const records = [
    { platform: 'linux', node: '20', job: 'a' },
    { platform: 'linux', node: '9', job: 'b' },
    { platform: 'linux', node: '18', job: 'c' }
  ];
  const result = serialize(records);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.records.map(r => r.node), ['9', '18', '20']);
});

test('sorts by job alphabetically when platform and node equal', () => {
  const records = [
    { platform: 'linux', node: '18', job: 'zeta' },
    { platform: 'linux', node: '18', job: 'alpha' },
    { platform: 'linux', node: '18', job: 'mid' }
  ];
  const result = serialize(records);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.records.map(r => r.job), ['alpha', 'mid', 'zeta']);
});

test('handles numeric node comparison with different digit lengths', () => {
  const records = [
    { platform: 'linux', node: '100', job: 'a' },
    { platform: 'linux', node: '9', job: 'b' },
    { platform: 'linux', node: '10', job: 'c' }
  ];
  const result = serialize(records);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.records.map(r => r.node), ['9', '10', '100']);
});

test('does not mutate input array', () => {
  const records = [
    { platform: 'b', node: '2', job: 'x' },
    { platform: 'a', node: '1', job: 'y' }
  ];
  const original = [...records];
  serialize(records);
  assert.deepEqual(records, original);
});

test('handles non-string job values by converting to string', () => {
  const records = [
    { platform: 'linux', node: '18', job: 2 },
    { platform: 'linux', node: '18', job: 1 }
  ];
  const result = serialize(records);
  const parsed = JSON.parse(result);
  assert.deepEqual(parsed.records.map(r => r.job), [1, 2]);
});
