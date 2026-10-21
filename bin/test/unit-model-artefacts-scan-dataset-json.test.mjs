// Detects template markers and remote URLs in dataset JSON (bin/model-artefacts.mjs scanDatasetJson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanDatasetJson } from '../model-artefacts.mjs';

test('returns unreadable when input is not valid JSON', () => {
  const result = scanDatasetJson('not json');
  assert.deepEqual(result, { unreadable: 'not JSON' });
});

test('returns empty hits for valid JSON with no template or remote patterns', () => {
  const result = scanDatasetJson('{"name": "test"}');
  assert.deepEqual(result, { hits: { template: [], remote: [], templateInProse: 0 } });
});

test('counts template markers in prose when not in loader keys', () => {
  const result = scanDatasetJson('{"description": "use {{var}} here"}');
  assert.deepEqual(result, { hits: { template: [], remote: [], templateInProse: 1 } });
});

test('records template path when marker is in loader key', () => {
  const result = scanDatasetJson('{"data_files": {"path": "{{split}}/data.json"}}');
  assert.deepEqual(result, { hits: { template: ['data_files.path'], remote: [], templateInProse: 0 } });
});

test('records remote URL when in data path key', () => {
  const result = scanDatasetJson('{"data_files": {"path": "s3://bucket/key"}}');
  assert.deepEqual(result, { hits: { template: [], remote: ['s3:// at data_files.path'], templateInProse: 0 } });
});

test('ignores remote URL when not in data path key', () => {
  const result = scanDatasetJson('{"description": "see s3://bucket/key"}');
  assert.deepEqual(result, { hits: { template: [], remote: [], templateInProse: 0 } });
});

test('records template and remote in same path', () => {
  const result = scanDatasetJson('{"data_files": {"path": "s3://{{bucket}}/key"}}');
  assert.deepEqual(result, { hits: { template: ['data_files.path'], remote: ['s3:// at data_files.path'], templateInProse: 0 } });
});

test('counts a prose string with several template markers once', () => {
  const result = scanDatasetJson('{"description": "use {{a}} and {{b}}"}');
  assert.deepEqual(result, { hits: { template: [], remote: [], templateInProse: 1 } });
});

test('records template in nested loader key', () => {
  const result = scanDatasetJson('{"configs": [{"path": "{{split}}"}]}');
  assert.deepEqual(result, { hits: { template: ['configs.0.path'], remote: [], templateInProse: 0 } });
});

test('handles root level template marker', () => {
  const result = scanDatasetJson('"{{root}}"');
  assert.deepEqual(result, { hits: { template: [], remote: [], templateInProse: 1 } });
});
