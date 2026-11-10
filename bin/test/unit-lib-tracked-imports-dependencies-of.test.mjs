// Static import specifiers declared by an ES module source text (bin/lib/tracked-imports.mjs dependenciesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependenciesOf } from '../lib/tracked-imports.mjs';

const unavailable = {
  name: 'Error',
  message: 'vm.SourceTextModule unavailable \u2014 run node with --experimental-vm-modules. '
    + 'Refusing to fall back to the regex extractor, which is unsound by measurement.',
};

test('A module with one static import is refused when vm.SourceTextModule is unavailable', async () => {
  await assert.rejects(dependenciesOf("import { x } from './a.mjs';", 't1.mjs'), unavailable);
});

test('A source given without an identifier is refused with the same unavailable error', async () => {
  await assert.rejects(dependenciesOf("import a from './a.mjs';\nimport b from './b.mjs';"), unavailable);
});

test('An empty source is refused before any parsing happens', async () => {
  await assert.rejects(dependenciesOf('', 'empty.mjs'), unavailable);
});

test('Syntactically invalid source is refused with the unavailable error rather than a SyntaxError', async () => {
  await assert.rejects(dependenciesOf('import { from ;;; %%%', 'broken.mjs'), unavailable);
});

test('A source whose toString throws is refused before it is converted to a string', async () => {
  const src = { toString() { throw new Error('boom'); } };
  await assert.rejects(dependenciesOf(src, 'obj.mjs'), unavailable);
});

test('A long source of repeated imports is refused with the unavailable error', async () => {
  const src = Array.from({ length: 50 }, (_, i) => `import './m${i}.mjs';`).join('\n');
  await assert.rejects(dependenciesOf(src, 'many.mjs'), unavailable);
});

test('A numeric source is refused with the unavailable error', async () => {
  await assert.rejects(dependenciesOf(42, 'num.mjs'), unavailable);
});
