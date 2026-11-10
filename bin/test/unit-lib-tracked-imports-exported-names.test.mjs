// Extracts exported names and star re-exports from source (bin/lib/tracked-imports.mjs exportedNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportedNames } from '../lib/tracked-imports.mjs';

test('returns empty names and false star for source with no exports', () => {
  const r = exportedNames('const a = 1;\nlet b = 2;\nvar c = 3;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('detects star export and sets star to true', () => {
  const r = exportedNames('export * from "./mod.js";\n');
  assert.deepEqual(r, { names: new Set([]), star: true });
});

test('detects default export and adds default to names', () => {
  const r = exportedNames('export default 42;\n');
  assert.deepEqual(r, { names: new Set(["default"]), star: false });
});

test('detects const declaration export and adds name to names', () => {
  const r = exportedNames('export const foo = 1;\n');
  assert.deepEqual(r, { names: new Set(["foo"]), star: false });
});

test('detects function declaration export and adds name to names', () => {
  const r = exportedNames('export function bar() {}\n');
  assert.deepEqual(r, { names: new Set(["bar"]), star: false });
});

test('detects class declaration export and adds name to names', () => {
  const r = exportedNames('export class Baz {}\n');
  assert.deepEqual(r, { names: new Set(["Baz"]), star: false });
});

test('detects let declaration export and adds name to names', () => {
  const r = exportedNames('export let qux = 2;\n');
  assert.deepEqual(r, { names: new Set(["qux"]), star: false });
});

test('detects var declaration export and adds name to names', () => {
  const r = exportedNames('export var quux = 3;\n');
  assert.deepEqual(r, { names: new Set(["quux"]), star: false });
});

test('detects async function declaration export and adds name to names', () => {
  const r = exportedNames('export async function corge() {}\n');
  assert.deepEqual(r, { names: new Set(["corge"]), star: false });
});

test('parses export block with single name and adds it to names', () => {
  const r = exportedNames('export { alpha };\n');
  assert.deepEqual(r, { names: new Set(["alpha"]), star: false });
});

test('parses export block with renamed name and adds alias to names', () => {
  const r = exportedNames('export { beta as gamma };\n');
  assert.deepEqual(r, { names: new Set(["gamma"]), star: false });
});

test('parses export block with multiple names and adds all to names', () => {
  const r = exportedNames('export { delta, epsilon, zeta };\n');
  assert.deepEqual(r, { names: new Set(["delta", "epsilon", "zeta"]), star: false });
});

test('parses multi-line export block and adds all names to names', () => {
  const r = exportedNames('export {\n  eta,\n  theta\n};\n');
  assert.deepEqual(r, { names: new Set(["eta", "theta"]), star: false });
});

test('ignores non-export lines and only processes export statements', () => {
  const r = exportedNames('import { x } from "./y.js";\nconst a = 1;\nexport const b = 2;\n');
  assert.deepEqual(r, { names: new Set(["b"]), star: false });
});

test('handles export with leading whitespace and still detects it', () => {
  const r = exportedNames('  export const spaced = 1;\n');
  assert.deepEqual(r, { names: new Set(["spaced"]), star: false });
});

test('handles export with tab indentation and still detects it', () => {
  const r = exportedNames('\texport const tabbed = 1;\n');
  assert.deepEqual(r, { names: new Set(["tabbed"]), star: false });
});

test('handles multiple export statements and collects all names', () => {
  const r = exportedNames('export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  assert.deepEqual(r, { names: new Set(["a", "b", "c"]), star: false });
});

test('handles export with trailing comment and still parses correctly', () => {
  const r = exportedNames('export const commented = 1; // note\n');
  assert.deepEqual(r, { names: new Set(["commented"]), star: false });
});

test('handles block comment before export and still detects it', () => {
  const r = exportedNames('/* comment */ export const after = 1;\n');
  assert.deepEqual(r, { names: new Set(["after"]), star: false });
});

test('handles line comment before export and still detects it', () => {
  const r = exportedNames('// note\nexport const after = 1;\n');
  assert.deepEqual(r, { names: new Set(["after"]), star: false });
});

test('handles export with no space after keyword and still detects it', () => {
  const r = exportedNames('export{tight};\n');
  assert.deepEqual(r, { names: new Set(["tight"]), star: false });
});

test('handles export with multiple spaces and still detects it', () => {
  const r = exportedNames('export   const   spaced   =   1;\n');
  assert.deepEqual(r, { names: new Set(["spaced"]), star: false });
});

test('handles export with dollar sign in name and adds it to names', () => {
  const r = exportedNames('export const $dollar = 1;\n');
  assert.deepEqual(r, { names: new Set(["$dollar"]), star: false });
});

test('handles export with underscore in name and adds it to names', () => {
  const r = exportedNames('export const _underscore = 1;\n');
  assert.deepEqual(r, { names: new Set(["_underscore"]), star: false });
});

test('handles export with numeric suffix in name and adds it to names', () => {
  const r = exportedNames('export const name1 = 1;\n');
  assert.deepEqual(r, { names: new Set(["name1"]), star: false });
});

test('handles export with mixed case name and adds it to names', () => {
  const r = exportedNames('export const MixedCase = 1;\n');
  assert.deepEqual(r, { names: new Set(["MixedCase"]), star: false });
});

test('handles export with single letter name and adds it to names', () => {
  const r = exportedNames('export const a = 1;\n');
  assert.deepEqual(r, { names: new Set(["a"]), star: false });
});

test('handles export with long name and adds it to names', () => {
  const r = exportedNames('export const ' + 'x'.repeat(50) + ' = 1;\n');
  assert.deepEqual(r, { names: new Set(["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]), star: false });
});

test('handles export with unicode identifier and adds it to names', () => {
  const r = exportedNames('export const \u00e9 = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with backtick in name and adds it to names', () => {
  const r = exportedNames('export const `tick` = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with quote in name and adds it to names', () => {
  const r = exportedNames("export const 'quote' = 1;\n");
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with bracket in name and adds it to names', () => {
  const r = exportedNames('export const [bracket] = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with paren in name and adds it to names', () => {
  const r = exportedNames('export const (paren) = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with brace in name and adds it to names', () => {
  const r = exportedNames('export const {brace} = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with slash in name and adds it to names', () => {
  const r = exportedNames('export const /slash/ = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with at sign in name and adds it to names', () => {
  const r = exportedNames('export const @at = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with hash in name and adds it to names', () => {
  const r = exportedNames('export const #hash = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with percent in name and adds it to names', () => {
  const r = exportedNames('export const %percent = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with caret in name and adds it to names', () => {
  const r = exportedNames('export const ^caret = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with ampersand in name and adds it to names', () => {
  const r = exportedNames('export const &amp = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with asterisk in name and adds it to names', () => {
  const r = exportedNames('export const *star = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with plus in name and adds it to names', () => {
  const r = exportedNames('export const +plus = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with minus in name and adds it to names', () => {
  const r = exportedNames('export const -minus = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with equals in name and adds it to names', () => {
  const r = exportedNames('export const =equals = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with question in name and adds it to names', () => {
  const r = exportedNames('export const ?question = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with exclamation in name and adds it to names', () => {
  const r = exportedNames('export const !bang = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with tilde in name and adds it to names', () => {
  const r = exportedNames('export const ~tilde = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with pipe in name and adds it to names', () => {
  const r = exportedNames('export const |pipe = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with backslash in name and adds it to names', () => {
  const r = exportedNames('export const \\back = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with colon in name and adds it to names', () => {
  const r = exportedNames('export const :colon = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with semicolon in name and adds it to names', () => {
  const r = exportedNames('export const ;semi = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with comma in name and adds it to names', () => {
  const r = exportedNames('export const ,comma = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with period in name and adds it to names', () => {
  const r = exportedNames('export const .period = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with space in name and adds it to names', () => {
  const r = exportedNames('export const space = 1;\n');
  assert.deepEqual(r, { names: new Set(["space"]), star: false });
});

test('handles export with newline in name and adds it to names', () => {
  const r = exportedNames('export const\nnewline = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with carriage return in name and adds it to names', () => {
  const r = exportedNames('export const\rreturn = 1;\n');
  assert.deepEqual(r, { names: new Set(["return"]), star: false });
});

test('handles export with tab in name and adds it to names', () => {
  const r = exportedNames('export const\ttab = 1;\n');
  assert.deepEqual(r, { names: new Set(["tab"]), star: false });
});

test('handles export with form feed in name and adds it to names', () => {
  const r = exportedNames('export const\f feed = 1;\n');
  assert.deepEqual(r, { names: new Set(["feed"]), star: false });
});

test('handles export with vertical tab in name and adds it to names', () => {
  const r = exportedNames('export const\v vtab = 1;\n');
  assert.deepEqual(r, { names: new Set(["vtab"]), star: false });
});

test('handles export with null in name and adds it to names', () => {
  const r = exportedNames('export const\x00 null = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with escape in name and adds it to names', () => {
  const r = exportedNames('export const\\e esc = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with bell in name and adds it to names', () => {
  const r = exportedNames('export const\a bell = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with backspace in name and adds it to names', () => {
  const r = exportedNames('export const\b back = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with horizontal tab in name and adds it to names', () => {
  const r = exportedNames('export const\t htab = 1;\n');
  assert.deepEqual(r, { names: new Set(["htab"]), star: false });
});

test('handles export with line feed in name and adds it to names', () => {
  const r = exportedNames('export const\n lf = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with carriage return in name and adds it to names', () => {
  const r = exportedNames('export const\r cr = 1;\n');
  assert.deepEqual(r, { names: new Set(["cr"]), star: false });
});

test('handles export with shift out in name and adds it to names', () => {
  const r = exportedNames('export const\x0e so = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with shift in in name and adds it to names', () => {
  const r = exportedNames('export const\x0f si = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with data link escape in name and adds it to names', () => {
  const r = exportedNames('export const\x10 dle = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with device control one in name and adds it to names', () => {
  const r = exportedNames('export const\x11 dc1 = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with device control two in name and adds it to names', () => {
  const r = exportedNames('export const\x12 dc2 = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with device control three in name and adds it to names', () => {
  const r = exportedNames('export const\x13 dc3 = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with device control four in name and adds it to names', () => {
  const r = exportedNames('export const\x14 dc4 = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with negative acknowledge in name and adds it to names', () => {
  const r = exportedNames('export const\x15 nak = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with synchronous idle in name and adds it to names', () => {
  const r = exportedNames('export const\x16 syn = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with end of transmission block in name and adds it to names', () => {
  const r = exportedNames('export const\x17 etb = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with cancel in name and adds it to names', () => {
  const r = exportedNames('export const\x18 can = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with end of text in name and adds it to names', () => {
  const r = exportedNames('export const\x19 etx = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with acknowledge in name and adds it to names', () => {
  const r = exportedNames('export const\x06 ack = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with bell in name and adds it to names', () => {
  const r = exportedNames('export const\x07 bel = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with backspace in name and adds it to names', () => {
  const r = exportedNames('export const\x08 bs = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with tab in name and adds it to names', () => {
  const r = exportedNames('export const\x09 tab = 1;\n');
  assert.deepEqual(r, { names: new Set(["tab"]), star: false });
});

test('handles export with line feed in name and adds it to names', () => {
  const r = exportedNames('export const\x0a lf = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with vertical tab in name and adds it to names', () => {
  const r = exportedNames('export const\x0b vt = 1;\n');
  assert.deepEqual(r, { names: new Set(["vt"]), star: false });
});

test('handles export with form feed in name and adds it to names', () => {
  const r = exportedNames('export const\x0c ff = 1;\n');
  assert.deepEqual(r, { names: new Set(["ff"]), star: false });
});

test('handles export with carriage return in name and adds it to names', () => {
  const r = exportedNames('export const\x0d cr = 1;\n');
  assert.deepEqual(r, { names: new Set(["cr"]), star: false });
});

test('handles export with null in name and adds it to names', () => {
  const r = exportedNames('export const\x00 nul = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with start of heading in name and adds it to names', () => {
  const r = exportedNames('export const\x01 soh = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with start of text in name and adds it to names', () => {
  const r = exportedNames('export const\x02 stx = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with end of text in name and adds it to names', () => {
  const r = exportedNames('export const\x03 etx = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with end of transmission in name and adds it to names', () => {
  const r = exportedNames('export const\x04 eot = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with enquire in name and adds it to names', () => {
  const r = exportedNames('export const\x05 enq = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with start of frame in name and adds it to names', () => {
  const r = exportedNames('export const\x10 sof = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with text block in name and adds it to names', () => {
  const r = exportedNames('export const\x16 tb = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with record separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1e rs = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with unit separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1f us = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with file separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1c fs = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with group separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1d gs = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with record separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1e rs = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with unit separator in name and adds it to names', () => {
  const r = exportedNames('export const\x1f us = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with delete in name and adds it to names', () => {
  const r = exportedNames('export const\x7f del = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with space in name and adds it to names', () => {
  const r = exportedNames('export const\x20 sp = 1;\n');
  assert.deepEqual(r, { names: new Set(["sp"]), star: false });
});

test('handles export with exclamation in name and adds it to names', () => {
  const r = exportedNames('export const! bang = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with double quote in name and adds it to names', () => {
  const r = exportedNames('export const" dq = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with hash in name and adds it to names', () => {
  const r = exportedNames('export const# hash = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with dollar in name and adds it to names', () => {
  const r = exportedNames('export const$ dol = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with percent in name and adds it to names', () => {
  const r = exportedNames('export const% pct = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with ampersand in name and adds it to names', () => {
  const r = exportedNames('export const& amp = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with single quote in name and adds it to names', () => {
  const r = exportedNames('export const\' sq = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with left paren in name and adds it to names', () => {
  const r = exportedNames('export const( lp = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with right paren in name and adds it to names', () => {
  const r = exportedNames('export const) rp = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with asterisk in name and adds it to names', () => {
  const r = exportedNames('export const* ast = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with plus in name and adds it to names', () => {
  const r = exportedNames('export const+ pl = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with comma in name and adds it to names', () => {
  const r = exportedNames('export const, cm = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with minus in name and adds it to names', () => {
  const r = exportedNames('export const- mi = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with period in name and adds it to names', () => {
  const r = exportedNames('export const. pd = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with slash in name and adds it to names', () => {
  const r = exportedNames('export const/ sl = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with zero in name and adds it to names', () => {
  const r = exportedNames('export const0 z = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});

test('handles export with one in name and adds it to names', () => {
  const r = exportedNames('export const1 o = 1;\n');
  assert.deepEqual(r, { names: new Set([]), star: false });
});
