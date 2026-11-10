// Which CW_ environment variables each JS or shell source reads, directly or by quoted name (bin/reference.mjs collectEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEnv } from '../reference.mjs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const real = basename(fileURLToPath(import.meta.url));
const selfOtherCase = real.replace('.test.', '.Test.');
const selfDotted = './' + selfOtherCase;
const row = (name, how, readers) => ({ name, how, readers, description: null });
const rowsFor = (readers) => [
  row('CW_BRACKET_2', 'direct', readers),
  row('CW_ONLY_QUOTED', 'indirect', readers),
  row('CW_PLAIN_ONE', 'direct', readers),
];

test('a JavaScript source under a test directory is skipped without being read', () => {
  assert.deepEqual(collectEnv(dirname(here), ['test/' + real]), []);
});

test('a file named *.test.mjs or with an extension other than js, mjs, cjs, sh or bash is skipped', () => {
  const stem = selfOtherCase.slice(0, -3);
  assert.deepEqual(collectEnv(here, [real, stem + 'MJS', stem + 'txt']), []);
});

test('a source or script that cannot be read contributes nothing', () => {
  assert.deepEqual(collectEnv(here, ['no-such-source.mjs', 'no-such-script.sh']), []);
});

test("this file's env.CW_PLAIN_ONE and env['CW_BRACKET_2'] are direct reads, and its quoted 'CW_ONLY_QUOTED' is indirect because env[key] also appears", () => {
  assert.deepEqual(collectEnv(here, [selfOtherCase]), rowsFor([selfOtherCase]));
});

test('a reader listed twice appears once and readers are sorted by path with ./ before letters', () => {
  assert.deepEqual(
    collectEnv(here, [selfOtherCase, selfDotted, selfOtherCase]),
    rowsFor([selfDotted, selfOtherCase]),
  );
});

test('skipped and unreadable entries do not change what a readable source reports', () => {
  assert.deepEqual(
    collectEnv(here, ['no-such-script.sh', real, selfOtherCase, 'notes.md']),
    rowsFor([selfOtherCase]),
  );
});
