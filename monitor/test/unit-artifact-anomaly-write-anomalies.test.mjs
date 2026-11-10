// The anomalies as 2-space-indented JSON, written atomically (monitor/artifact-anomaly.mjs writeAnomalies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeAnomalies } from '../artifact-anomaly.mjs';

const fs = process.getBuiltinModule('node:fs');
const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
const OUT = join('/nonexistent-commitwork-dir', 'anoms.json');
const TMP = join('/nonexistent-commitwork-dir', `.anoms.json.tmp-${process.pid}`);

function withFakeFs(fn) {
  const calls = [];
  const orig = { writeFileSync: fs.writeFileSync, renameSync: fs.renameSync };
  fs.writeFileSync = (p, d) => { calls.push(['write', p, d]); };
  fs.renameSync = (a, b) => { calls.push(['rename', a, b]); };
  syncBuiltinESMExports();
  try {
    return { result: fn(), calls };
  } finally {
    Object.assign(fs, orig);
    syncBuiltinESMExports();
  }
}

function capture(anomalies) {
  return withFakeFs(() => writeAnomalies(OUT, anomalies));
}

function written(anomalies) {
  return capture(anomalies).calls[0][2];
}

test('an empty anomaly list is written as a bare pair of brackets', () => {
  assert.equal(written([]), '[]');
});

test('a single anomaly object is written with two-space indentation', () => {
  assert.equal(written([{ id: 1 }]), '[\n  {\n    "id": 1\n  }\n]');
});

test('each nesting level adds two more spaces of indentation', () => {
  assert.equal(
    written([{ a: { b: 'x' } }]),
    '[\n  {\n    "a": {\n      "b": "x"\n    }\n  }\n]',
  );
});

test('a list of numbers puts each number on its own two-space indented line', () => {
  const list = Array.from({ length: 3 }, (_, i) => i);
  assert.equal(written(list), '[\n  0,\n  1,\n  2\n]');
});

test('a plain string is written as a quoted JSON string', () => {
  assert.equal(written('x'.repeat(3)), '"xxx"');
});

test('the text goes to a temp file beside the output, which is then renamed onto it', () => {
  const { result, calls } = capture([{ k: true }]);
  assert.equal(result, undefined);
  assert.deepEqual(calls, [
    ['write', TMP, '[\n  {\n    "k": true\n  }\n]'],
    ['rename', TMP, OUT],
  ]);
});

test('an anomaly holding a BigInt throws before anything is written', () => {
  const { calls } = withFakeFs(() => assert.throws(() => writeAnomalies(OUT, [{ n: 1n }]), {
    name: 'TypeError',
    message: 'Do not know how to serialize a BigInt',
  }));
  assert.deepEqual(calls, []);
});
