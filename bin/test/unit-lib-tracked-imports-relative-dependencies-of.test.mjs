// The deduplicated relative static and dynamic import specifiers of a module source (bin/lib/tracked-imports.mjs relativeDependenciesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeDependenciesOf } from '../lib/tracked-imports.mjs';

const UNAVAILABLE = {
  name: 'Error',
  message: 'vm.SourceTextModule unavailable \u2014 run node with --experimental-vm-modules. '
    + 'Refusing to fall back to the regex extractor, which is unsound by measurement.',
};

test('rejects with the missing vm modules error for a module with no imports', async () => {
  const src = 'const x = 1;\nexport default x;\n';
  await assert.rejects(relativeDependenciesOf(src, 'a.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error for a relative static import with a query string', async () => {
  const src = "import { a } from './dep.mjs?v=1';\nexport { a };\n";
  await assert.rejects(relativeDependenciesOf(src, 'a.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error for a relative dynamic import', async () => {
  const src = "const m = await import('./dyn.mjs');\nexport default m;\n";
  await assert.rejects(relativeDependenciesOf(src, 'a.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error before parsing invalid syntax', async () => {
  const src = 'import { from ;;; export';
  await assert.rejects(relativeDependenciesOf(src, 'broken.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error for a non-string source and no identifier', async () => {
  await assert.rejects(relativeDependenciesOf(null), UNAVAILABLE);
});

test('rejects with the missing vm modules error for an empty source', async () => {
  await assert.rejects(relativeDependenciesOf('', 'empty.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error for many CRLF separated relative imports', async () => {
  const src = Array.from({ length: 50 }, (_, i) => `import './m${i}.mjs';`).join('\r\n');
  await assert.rejects(relativeDependenciesOf(src, 'many.mjs'), UNAVAILABLE);
});

test('rejects with the missing vm modules error for a buffer source mixing static and dynamic imports', async () => {
  const src = Buffer.from("import a from '../up.mjs';\nimport b from 'pkg';\nconst c = await import('./dup.mjs');\n");
  await assert.rejects(relativeDependenciesOf(src, 'buf.mjs'), UNAVAILABLE);
});
