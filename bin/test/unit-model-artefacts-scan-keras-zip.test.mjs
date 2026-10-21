// Extracts Keras config.json from a zip and lists Lambda layer names (bin/model-artefacts.mjs scanKerasZip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanKerasZip } from '../model-artefacts.mjs';

function makeZip(members) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const m of members) {
    const nameBuf = Buffer.from(m.name, 'utf8');
    const data = Buffer.from(m.data, 'utf8');
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, data);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 18);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(0, 34);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test('returns config false when no config.json member exists', () => {
  const buf = makeZip([{ name: 'weights.h5', data: 'abc' }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: false, layers: [], unreadable: null });
});

test('returns config true and empty layers when config.json has no Lambda layers', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [{ class_name: 'Dense', config: {} }] });
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: [], unreadable: null });
});

test('returns config true and layer name when config.json has a Lambda layer', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [{ class_name: 'Lambda', config: { name: 'my_layer' } }] });
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: ['my_layer'], unreadable: null });
});

test('returns config true and unnamed when Lambda layer has no name', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [{ class_name: 'Lambda', config: {} }] });
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: ['(unnamed)'], unreadable: null });
});

test('returns unreadable when config.json is not valid JSON', () => {
  const buf = makeZip([{ name: 'config.json', data: 'not json' }]);
  const r = scanKerasZip(buf);
  assert.equal(r.config, true);
  assert.equal(r.unreadable, 'config is not JSON');
  assert.deepEqual(r.layers, []);
});

test('returns unreadable when zip buffer is not a valid zip', () => {
  const buf = Buffer.from('this is not a zip file at all');
  const r = scanKerasZip(buf);
  assert.equal(r.config, false);
  assert.equal(r.unreadable, 'no end-of-central-directory record');
  assert.deepEqual(r.layers, []);
});

test('returns unreadable when config.json declares size over cap', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [{ class_name: 'Lambda', config: { name: 'x' } }] });
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf, 1);
  assert.equal(r.config, true);
  assert.match(r.unreadable, /declares \d+ inflated bytes, over the 1-byte cap/);
  assert.deepEqual(r.layers, []);
});

test('returns config true and nested Lambda layer name from Functional model', () => {
  const cfg = JSON.stringify({ class_name: 'Functional', config: { layers: [{ class_name: 'Lambda', config: { name: 'nested' } }] } });
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: ['nested'], unreadable: null });
});

test('returns config true and multiple Lambda layer names in order', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [
    { class_name: 'Lambda', config: { name: 'first' } },
    { class_name: 'Dense', config: {} },
    { class_name: 'Lambda', config: { name: 'second' } }
  ]});
  const buf = makeZip([{ name: 'config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: ['first', 'second'], unreadable: null });
});

test('returns config true when config.json is in a subdirectory', () => {
  const cfg = JSON.stringify({ class_name: 'Sequential', config: [] });
  const buf = makeZip([{ name: 'models/config.json', data: cfg }]);
  const r = scanKerasZip(buf);
  assert.deepEqual(r, { config: true, layers: [], unreadable: null });
});
