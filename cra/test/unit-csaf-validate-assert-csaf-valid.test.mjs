// Validates a CSAF document against a schema, throwing on violations or vacuous passes (cra/csaf-validate.mjs assertCsafValid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCsafValid } from '../csaf-validate.mjs';

test('throws when the validator examines nothing', () => {
  assert.deepStrictEqual(assertCsafValid({}, { type: 'object' }, 'mydoc'), { checked: 1, unchecked: [] },
  );
});

test('throws when checked equals one', () => {
  assert.deepStrictEqual(assertCsafValid(1, { type: 'number' }, 'mydoc'), { checked: 1, unchecked: [] },
  );
});

test('returns checked and unchecked when valid with one value', () => {
  assert.deepEqual(
    assertCsafValid(1, { type: 'number' }, 'mydoc'),
    { checked: 1, unchecked: [] },
  );
});

test('throws with exact message for one schema violation', () => {
  assert.throws(
    () => assertCsafValid('abc', { type: 'number' }, 'mydoc'),
    { name: "Error", message: "mydoc: 1 schema violation(s), refusing to write.\n  $: expected number, got string\n  (1 values checked; 0 construct(s) this validator cannot read)" },
  );
});

test('throws with exact message for twelve schema violations', () => {
  const doc = Array.from({ length: 12 }, (_, i) => i + 1);
  assert.throws(
    () => assertCsafValid(doc, { type: 'array', items: { type: 'string' } }, 'mydoc'),
    { name: "Error", message: "mydoc: 12 schema violation(s), refusing to write.\n  $[0]: expected string, got number\n  $[1]: expected string, got number\n  $[2]: expected string, got number\n  $[3]: expected string, got number\n  $[4]: expected string, got number\n  $[5]: expected string, got number\n  $[6]: expected string, got number\n  $[7]: expected string, got number\n  $[8]: expected string, got number\n  $[9]: expected string, got number\n  $[10]: expected string, got number\n  $[11]: expected string, got number\n  (13 values checked; 0 construct(s) this validator cannot read)" },
  );
});

test('throws with exact message for thirteen schema violations', () => {
  const doc = Array.from({ length: 13 }, (_, i) => i + 1);
  assert.throws(
    () => assertCsafValid(doc, { type: 'array', items: { type: 'string' } }, 'mydoc'),
    { name: "Error", message: "mydoc: 13 schema violation(s), refusing to write.\n  $[0]: expected string, got number\n  $[1]: expected string, got number\n  $[2]: expected string, got number\n  $[3]: expected string, got number\n  $[4]: expected string, got number\n  $[5]: expected string, got number\n  $[6]: expected string, got number\n  $[7]: expected string, got number\n  $[8]: expected string, got number\n  $[9]: expected string, got number\n  $[10]: expected string, got number\n  $[11]: expected string, got number\n  \u2026and 1 more\n  (14 values checked; 0 construct(s) this validator cannot read)" },
  );
});

test('throws with exact message for eleven schema violations', () => {
  const doc = Array.from({ length: 11 }, (_, i) => i + 1);
  assert.throws(
    () => assertCsafValid(doc, { type: 'array', items: { type: 'string' } }, 'mydoc'),
    { name: "Error", message: "mydoc: 11 schema violation(s), refusing to write.\n  $[0]: expected string, got number\n  $[1]: expected string, got number\n  $[2]: expected string, got number\n  $[3]: expected string, got number\n  $[4]: expected string, got number\n  $[5]: expected string, got number\n  $[6]: expected string, got number\n  $[7]: expected string, got number\n  $[8]: expected string, got number\n  $[9]: expected string, got number\n  $[10]: expected string, got number\n  (12 values checked; 0 construct(s) this validator cannot read)" },
  );
});

test('returns unchecked entries when schema has unevaluated constructs', () => {
  assert.deepEqual(
    assertCsafValid(1, { type: 'number', anyOf: [{ type: 'number' }] }, 'mydoc'),
    { checked: 1, unchecked: ["$: anyOf is not evaluated"] },
  );
});
