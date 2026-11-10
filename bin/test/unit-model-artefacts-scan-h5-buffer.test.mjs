// scans a buffer for HDF5 signature, model_config attribute and Keras JSON configs (bin/model-artefacts.mjs scanH5Buffer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanH5Buffer } from '../model-artefacts.mjs';

const HDF5_SIG = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const MODEL_CONFIG_ATTR = Buffer.from('model_config\0', 'latin1');
const CONFIG_OPEN = Buffer.from('{"class_name"', 'latin1');

test('returns unreadable when buffer lacks HDF5 signature', () => {
  const buf = Buffer.alloc(100, 0);
  const out = scanH5Buffer(buf);
  assert.deepEqual(out, {
    hdf5: false,
    declared: false,
    configs: 0,
    layers: [],
    unreadable: 'no HDF5 signature at 0 or at a user-block boundary',
  });
});

test('detects HDF5 at start, no declaration, no configs', () => {
  const buf = Buffer.concat([HDF5_SIG, Buffer.alloc(200, 0)]);
  const out = scanH5Buffer(buf);
  assert.deepEqual(out, {
    hdf5: true,
    declared: false,
    configs: 0,
    layers: [],
    unreadable: null,
  });
});

test('detects HDF5 at 512, declared attribute present, reports unreadable due to missing config', () => {
  const pad = Buffer.alloc(512 - HDF5_SIG.length, 0);
  const buf = Buffer.concat([HDF5_SIG, pad, Buffer.alloc(10, 0), MODEL_CONFIG_ATTR, Buffer.alloc(50, 0)]);
  const out = scanH5Buffer(buf);
  assert.deepEqual(out, {
    hdf5: true,
    declared: true,
    configs: 0,
    layers: [],
    unreadable: 'model_config attribute declared but no JSON config located',
  });
});

test('detects unreadable when a Keras config JSON is unterminated', () => {
  const malformed = Buffer.concat([CONFIG_OPEN, Buffer.from('{"foo":1', 'utf8')]);
  const buf = Buffer.concat([HDF5_SIG, Buffer.alloc(20, 0), malformed]);
  const out = scanH5Buffer(buf);
  assert.deepEqual(out, {
    hdf5: true,
    declared: false,
    configs: 0,
    layers: [],
    unreadable: 'a Keras config JSON is unterminated',
  });
});

test('counts a well\u2011formed config blob when attribute not declared', () => {
  const json = Buffer.from('{"class_name":"Sequential","config":{}}', 'utf8');
  const buf = Buffer.concat([HDF5_SIG, Buffer.alloc(5, 0), json]);
  const out = scanH5Buffer(buf);
  assert.equal(out.hdf5, true);
  assert.equal(out.declared, false);
  assert.equal(out.configs, 1);
  assert.deepEqual(out.layers, []);
  assert.equal(out.unreadable, null);
});
