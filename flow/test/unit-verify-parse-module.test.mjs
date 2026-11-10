// Parse outcome (ok flag, error text, static import specifiers) of ES module source (flow/verify.mjs parseModule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModule } from '../verify.mjs';

const twoDeps = "import 'a';\nexport { b } from 'c';";
const generated = Array.from({ length: 5 }, (_, i) => `import 'm${i}';`).join('\n');
const generatedSpecifiers = Array.from({ length: 5 }, (_, i) => `m${i}`);

const valid = new Map([
  [twoDeps, ['a', 'c']],
  ['', []],
  ['42', []],
  ['undefined', []],
  [generated, generatedSpecifiers],
]);

const invalid = new Map([
  ['let x = ;', "Unexpected token ';'"],
  ['(', 'Unexpected end of input'],
  ['return 1;', 'Illegal return statement'],
]);

const vmExports = process.getBuiltinModule('node:vm');
if (typeof vmExports.SourceTextModule !== 'function') {
  vmExports.SourceTextModule = class SourceTextModule {
    constructor(source, options) {
      if (invalid.has(source)) throw new SyntaxError(invalid.get(source));
      if (!valid.has(source)) throw new RangeError(`no fixture for ${source}`);
      this.identifier = options.identifier;
      this.dependencySpecifiers = Object.freeze(valid.get(source).slice());
    }
  };
}

test('a module with an import and a re-export parses with both specifiers in source order', async () => {
  assert.deepEqual(await parseModule(twoDeps), { ok: true, error: null, specifiers: ['a', 'c'] });
});

test('an empty source parses with no specifiers', async () => {
  assert.deepEqual(await parseModule(''), { ok: true, error: null, specifiers: [] });
});

test('a missing source is parsed as the text undefined', async () => {
  assert.deepEqual(await parseModule(), { ok: true, error: null, specifiers: [] });
});

test('a number source is converted to its string form before parsing', async () => {
  assert.deepEqual(await parseModule(42), { ok: true, error: null, specifiers: [] });
});

test('many generated imports are all listed in order', async () => {
  assert.deepEqual(await parseModule(generated), { ok: true, error: null, specifiers: generatedSpecifiers });
});

test('the returned specifier list is a mutable copy', async () => {
  const r = await parseModule(twoDeps);
  r.specifiers.push('z');
  assert.deepEqual(r.specifiers, ['a', 'c', 'z']);
});

test('a dangling initializer reports the syntax error name and message', async () => {
  assert.deepEqual(await parseModule('let x = ;'), {
    ok: false,
    error: "SyntaxError: Unexpected token ';'",
    specifiers: null,
  });
});

test('an unclosed parenthesis with a custom identifier reports unexpected end of input', async () => {
  assert.deepEqual(await parseModule('(', 'custom.mjs'), {
    ok: false,
    error: 'SyntaxError: Unexpected end of input',
    specifiers: null,
  });
});

test('a top-level return statement is reported as illegal', async () => {
  assert.deepEqual(await parseModule('return 1;'), {
    ok: false,
    error: 'SyntaxError: Illegal return statement',
    specifiers: null,
  });
});
