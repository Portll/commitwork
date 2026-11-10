// Maps each CW_ variable named in an env header line to a one-sentence description (bin/reference.mjs envDescriptions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envDescriptions } from '../reference.mjs';

test('each variable takes its description from the parenthetical, dash or wide gap after it', () => {
  const src = '// env: CW_A (alpha), CW_B - bravo; CW_C  charlie';
  assert.deepEqual(
    envDescriptions(src),
    new Map([['CW_A', 'alpha'], ['CW_B', 'bravo'], ['CW_C', 'charlie']]),
  );
});

test('indented continuation lines are joined onto the env line before descriptions are read', () => {
  const src = ['// env:', '//   CW_A - first part', '//   continues here. More text.'].join('\n');
  assert.deepEqual(envDescriptions(src), new Map([['CW_A', 'first part continues here.']]));
});

test('names inside nested parentheses are not treated as variables', () => {
  const src = '// env: ((x) CW_B (beta)) CW_A (alpha)';
  assert.deepEqual(envDescriptions(src), new Map([['CW_A', 'alpha']]));
});

test('a name glued to a word character or a dollar sign is not a variable', () => {
  const src = '// env: xCW_A (one), $CW_B (two), CW_C (three)';
  assert.deepEqual(envDescriptions(src), new Map([['CW_C', 'three']]));
});

test('names inside the env label itself are not described', () => {
  const src = '// env CW_X - ex: CW_Y (why)';
  assert.deepEqual(envDescriptions(src), new Map([['CW_Y', 'why']]));
});

test('an assigned value and a call-time note are skipped and an unclosed parenthesis gives nothing', () => {
  const src = '// env: CW_A=1 (read at call time) (the alpha), CW_B (unclosed';
  assert.deepEqual(envDescriptions(src), new Map([['CW_A', 'the alpha']]));
});

test('a bare call-time note or plain words give nothing and the first description of a repeated name wins', () => {
  const src = '// env: CW_C (read per call), CW_D plain words, CW_E: set it; CW_E - again.';
  assert.deepEqual(envDescriptions(src), new Map([['CW_E', 'set it']]));
});

test('descriptions stop at the first sentence unless it ends on an abbreviation', () => {
  const src = '// env: CW_A \u2014 pick one, e.g. this. Then more. CW_B - Stop here. Not here.';
  assert.deepEqual(
    envDescriptions(src),
    new Map([['CW_A', 'pick one, e.g. this. Then more.'], ['CW_B', 'Stop here.']]),
  );
});

test('descriptions longer than 220 characters are cut to 219 plus an ellipsis', () => {
  assert.deepEqual(
    envDescriptions(`// env: CW_A - ${'a'.repeat(220)}`),
    new Map([['CW_A', 'a'.repeat(220)]]),
  );
  assert.deepEqual(
    envDescriptions(`// env: CW_A - ${'a'.repeat(221)}`),
    new Map([['CW_A', `${'a'.repeat(219)}\u2026`]]),
  );
});

test('the env label matches case-insensitively with at most 40 characters before its colon', () => {
  assert.deepEqual(
    envDescriptions(`// Env ${'x'.repeat(39)}: CW_A (alpha)`),
    new Map([['CW_A', 'alpha']]),
  );
  assert.deepEqual(envDescriptions(`// Env ${'x'.repeat(40)}: CW_A (alpha)`), new Map());
});
