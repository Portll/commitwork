// extracts Keras config blobs and their Lambda layers (bin/model-artefacts.mjs findConfigBlobs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findConfigBlobs } from '../model-artefacts.mjs';

test('returns empty result when no config opener is present', () => {
  const buf = Buffer.from('no configs here');
  const res = findConfigBlobs(buf);
  assert.deepEqual(res, { blobs: [], unreadable: null });
});

test('finds a single config with one Lambda layer and returns its name', () => {
  const json = JSON.stringify({
    class_name: 'Model',
    config: {
      layers: [
        { class_name: 'Lambda', config: { name: 'myLambda' } },
        { class_name: 'Dense', config: {} }
      ]
    }
  });
  const buf = Buffer.concat([Buffer.from('xxx'), Buffer.from(json), Buffer.from('yyy')]);
  const res = findConfigBlobs(buf);
  assert.equal(res.unreadable, null);
  assert.equal(res.blobs.length, 1);
  assert.equal(res.blobs[0].at, 3);
  assert.deepEqual(res.blobs[0].layers, ['myLambda']);
});

test('finds a config without Lambda layers and returns an empty layers array', () => {
  const json = JSON.stringify({ class_name: 'Model', config: { layers: [] } });
  const buf = Buffer.from(json);
  const res = findConfigBlobs(buf);
  assert.equal(res.unreadable, null);
  assert.equal(res.blobs.length, 1);
  assert.deepEqual(res.blobs[0].layers, []);
});

test('deduplicates identical configs appearing at different offsets', () => {
  const json = JSON.stringify({ class_name: 'Model', config: {} });
  const buf = Buffer.concat([
    Buffer.from('a'.repeat(5)),
    Buffer.from(json),
    Buffer.from('b'.repeat(3)),
    Buffer.from(json),
    Buffer.from('c')
  ]);
  const res = findConfigBlobs(buf);
  assert.equal(res.unreadable, null);
  assert.equal(res.blobs.length, 1);
  assert.equal(res.blobs[0].at, 5);
});

test('reports unreadable when a config JSON is unterminated', () => {
  const opener = Buffer.from('{"class_name"', 'latin1');
  const buf = Buffer.concat([opener, Buffer.from(' "Model", "config": {')]);
  const res = findConfigBlobs(buf);
  assert.equal(res.blobs.length, 0);
  assert.equal(res.unreadable, 'a Keras config JSON is unterminated');
});

test('reports unreadable when a config JSON is syntactically invalid', () => {
  const badJson = '{"class_name":"Model","config":{invalid:true}}';
  const buf = Buffer.from(badJson);
  const res = findConfigBlobs(buf);
  assert.equal(res.blobs.length, 0);
  assert.equal(res.unreadable, 'Keras config: config is not JSON');
});

test('returns first unreadable reason when multiple problems exist', () => {
  const good = JSON.stringify({ class_name: 'Model', config: {} });
  const bad = '{"class_name":"Model","config":{invalid:true}}';
  const unterminated = Buffer.from('{"module"', 'latin1');
  const buf = Buffer.concat([
    Buffer.from(good),
    Buffer.from(bad),
    unterminated
  ]);
  const res = findConfigBlobs(buf);
  assert.equal(res.unreadable, 'Keras config: config is not JSON');
  assert.equal(res.blobs.length, 1);
  assert.deepEqual(res.blobs[0].layers, []);
});
