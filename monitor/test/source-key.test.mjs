// sourceKey — the batch identity a history row carries. rollup.mjs dedupes a re-roll by it (prior
// row, prevSlice, the index filter), so an old ABSOLUTE row and a new RELATIVE row must key the
// same; if they did not, the first re-roll after the migration would add a second row and mint a
// fresh stamp, and the remediation ledger (upserting on (key, resolvedSlice)) would duplicate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceKey, reportsRootDir } from '../area.mjs';

const reg = { reportsRoot: 'reports' };
const NAME = 'sweep-20260901093048-commitwork-admin';

test('absolute and relative forms of one batch key identically, to the bare batch name', () => {
  const abs = join(reportsRootDir(reg), NAME);
  assert.equal(sourceKey(abs, reg), NAME);
  assert.equal(sourceKey(NAME, reg), NAME);
  assert.equal(sourceKey(abs, reg), sourceKey(NAME, reg));
});

test('the key never contains the reports root — that is the whole point', () => {
  assert.equal(sourceKey(join(reportsRootDir(reg), NAME), reg).includes(reportsRootDir(reg)), false);
});

test('a symlinked reports root does not fork one batch into two keys', () => {
  const t = mkdtempSync(join(tmpdir(), 'cw-sk-'));
  try {
    mkdirSync(join(t, 'real', 'sweep-x'), { recursive: true });
    symlinkSync(join(t, 'real'), join(t, 'link'));
    const r2 = { reportsRoot: join(t, 'link') };
    assert.equal(sourceKey(join(t, 'link', 'sweep-x'), r2), 'sweep-x');
    assert.equal(sourceKey(join(t, 'real', 'sweep-x'), r2), 'sweep-x');
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test('non-strings key as null, and null is not a match (v0 rows carry no source)', () => {
  for (const v of [undefined, null, 42, '', {}]) assert.equal(sourceKey(v, reg), null);
});

test('a batch outside the root keys as a ../ path — deterministic, and honest about where it is', () => {
  const k = sourceKey('/tmp/elsewhere/sweep-y', reg);
  assert.ok(k.startsWith('../'), k);
  assert.equal(k, sourceKey('/tmp/elsewhere/sweep-y', reg));
});
