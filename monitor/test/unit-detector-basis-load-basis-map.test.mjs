// Reads a detector-basis JSON file and validates its classes and detectors maps (monitor/detector-basis.mjs loadBasisMap).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBasisMap } from '../detector-basis.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withMap(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadBasisMap-'));
  try {
    const p = join(dir, 'detector-basis.json');
    if (content !== undefined) writeFileSync(p, content);
    fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shapeMsg = (p) => `${p}: a detector-basis map needs \`classes\` and \`detectors\` objects`;
const classMsg = (p, det, cls) => `${p}: detector '${det}' names class '${cls}', which \`classes\` does not declare`;
const emptyParseMsg = (() => { try { JSON.parse(''); } catch (e) { return e.message; } return ''; })();

test('A missing file yields empty classes and detectors maps', () => {
  withMap(undefined, (p) => {
    assert.deepEqual(loadBasisMap(p), { classes: {}, detectors: {} });
  });
});

test('An empty file rethrows the JSON parse error instead of returning an empty map', () => {
  withMap('', (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'SyntaxError', message: emptyParseMsg });
  });
});

test('A valid map returns its classes and detectors unchanged', () => {
  const doc = { classes: { a: { label: 'A' }, b: { label: 'B' } }, detectors: { d1: 'a', d2: 'b' } };
  withMap(JSON.stringify(doc), (p) => {
    assert.deepEqual(loadBasisMap(p), { classes: { a: { label: 'A' }, b: { label: 'B' } }, detectors: { d1: 'a', d2: 'b' } });
  });
});

test('A map with classes but no detector entries returns an empty detectors object', () => {
  withMap(JSON.stringify({ classes: { a: 1 }, detectors: {} }), (p) => {
    assert.deepEqual(loadBasisMap(p), { classes: { a: 1 }, detectors: {} });
  });
});

test('A string classes value is rejected with the shape error', () => {
  withMap(JSON.stringify({ classes: 'x', detectors: { d: 'a' } }), (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'Error', message: shapeMsg(p) });
  });
});

test('A string detectors value is rejected with the shape error', () => {
  withMap(JSON.stringify({ classes: { a: 1 }, detectors: 'x' }), (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'Error', message: shapeMsg(p) });
  });
});

test('A JSON null document is rejected with the shape error', () => {
  withMap('null', (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'Error', message: shapeMsg(p) });
  });
});

test('Declaring the reserved unclassified class is rejected', () => {
  withMap(JSON.stringify({ classes: { a: 1, unclassified: 1 }, detectors: {} }), (p) => {
    assert.throws(() => loadBasisMap(p), {
      name: 'Error',
      message: `${p}: 'unclassified' is reserved and may not be declared as a class`,
    });
  });
});

test('A detector naming an undeclared class is rejected', () => {
  withMap(JSON.stringify({ classes: { a: 1 }, detectors: { d1: 'a', d2: 'b' } }), (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'Error', message: classMsg(p, 'd2', 'b') });
  });
});

test('A numeric detector value is rejected even when a class key matches it as a string', () => {
  withMap(JSON.stringify({ classes: { 1: { label: 'one' } }, detectors: { d: 1 } }), (p) => {
    assert.throws(() => loadBasisMap(p), { name: 'Error', message: classMsg(p, 'd', '1') });
  });
});
