// Which CW_ environment variables each JS or shell source reads, directly or by quoted name (bin/reference.mjs collectEnv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEnv } from '../reference.mjs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = 'fixture-source.mjs';
const FIXTURE_SRC = [
  'export function read(env, key) {',
  "  return [env.CW_PLAIN_ONE, env['CW_BRACKET_2'], env[key], 'CW_ONLY_QUOTED'];",
  '}',
].join('\n');

const row = (name, how, readers) => ({ name, how, readers, description: null });
const rowsFor = (readers) => [
  row('CW_BRACKET_2', 'direct', readers),
  row('CW_ONLY_QUOTED', 'indirect', readers),
  row('CW_PLAIN_ONE', 'direct', readers),
];

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'collectEnv-'));
  try {
    // The skipped names exist and hold the same reads, so a skip is by name, not by a failed read.
    const stem = FIXTURE.replace(/\.mjs$/, '');
    mkdirSync(join(root, 'test'));
    for (const name of [FIXTURE, `test/${FIXTURE}`, `${stem}.test.mjs`, `${stem}.MJS`, `${stem}.txt`]) writeFileSync(join(root, name), FIXTURE_SRC);
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a JavaScript source under a test directory is skipped without being read', () => {
  withFixture((root) => {
    assert.deepEqual(collectEnv(root, ['test/' + FIXTURE]), []);
  });
});

test('a file named *.test.mjs or with an extension other than js, mjs, cjs, sh or bash is skipped', () => {
  withFixture((root) => {
    const stem = FIXTURE.replace(/\.mjs$/, '');
    assert.deepEqual(collectEnv(root, [stem + '.test.mjs', stem + '.MJS', stem + '.txt']), []);
  });
});

test('a source or script that cannot be read contributes nothing', () => {
  withFixture((root) => {
    assert.deepEqual(collectEnv(root, ['no-such-source.mjs', 'no-such-script.sh']), []);
  });
});

test("a fixture's env.CW_PLAIN_ONE and env['CW_BRACKET_2'] are direct reads, and its quoted 'CW_ONLY_QUOTED' is indirect because env[key] also appears", () => {
  withFixture((root) => {
    assert.deepEqual(collectEnv(root, [FIXTURE]), rowsFor([FIXTURE]));
  });
});

test('a reader listed twice appears once and readers are sorted by path with ./ before letters', () => {
  withFixture((root) => {
    assert.deepEqual(
      collectEnv(root, [FIXTURE, './' + FIXTURE, FIXTURE]),
      rowsFor(['./' + FIXTURE, FIXTURE]),
    );
  });
});

test('skipped and unreadable entries do not change what a readable source reports', () => {
  withFixture((root) => {
    assert.deepEqual(
      collectEnv(root, ['no-such-script.sh', FIXTURE, 'notes.md']),
      rowsFor([FIXTURE]),
    );
  });
});
