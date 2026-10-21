// Rotation must SHIFT generations, never overwrite one — and every reader must see all of them.
//
// The touch and spine ledgers rotated with `renameSync(f, f + '.1')`. rename(2) replaces an existing
// destination silently, so each rotation destroyed the previous generation with no error and no
// record. It had never been tested because MAX_BYTES was a module-load const with no seam: no test
// could reach the rotation path, and none of the four ledger test files mentioned `.1`.
//
// The reader half is asserted here too, and it is not optional. Writers that produce `.2` while
// readers open a fixed `[f.1, f]` window preserve the rows and hide them — which reads as fixed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveGenerations, generations, rotateIfLarge, shiftArchives } from '../lib/ledger-rotate.mjs';

const fixture = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-rot-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return join(d, 'ledger.jsonl');
};

describe('ledger rotation', () => {
  test('three rotations keep three generations — nothing is overwritten', (t) => {
    const f = fixture(t);
    for (const gen of ['first', 'second', 'third', 'live']) {
      writeFileSync(f, `${gen}\n`);
      if (gen !== 'live') assert.equal(rotateIfLarge(f, 1), true, `${gen} did not rotate`);
    }
    // Oldest content must have migrated outward, not vanished.
    assert.equal(readFileSync(`${f}.1`, 'utf8').trim(), 'third');
    assert.equal(readFileSync(`${f}.2`, 'utf8').trim(), 'second');
    assert.equal(readFileSync(`${f}.3`, 'utf8').trim(), 'first');
    assert.equal(readFileSync(f, 'utf8').trim(), 'live');
  });

  test('the PRE-FIX shape is what this forbids — a bare rename loses a generation', (t) => {
    // Pins the defect verbatim, so the guard is shown failing the thing it exists to catch rather
    // than only passing the thing it exists to allow.
    const f = fixture(t);
    writeFileSync(f, 'first\n');
    writeFileSync(`${f}.1`, 'older\n');
    renameSync(f, `${f}.1`);   // what the old code did
    assert.equal(readFileSync(`${f}.1`, 'utf8').trim(), 'first', 'fixture drift');
    assert.equal(existsSync(`${f}.2`), false, 'the bare rename never produced a .2 — "older" is gone');
  });

  test('readers see EVERY generation, oldest first — not a fixed two-file window', (t) => {
    const f = fixture(t);
    writeFileSync(`${f}.3`, 'g3\n');
    writeFileSync(`${f}.2`, 'g2\n');
    writeFileSync(`${f}.1`, 'g1\n');
    writeFileSync(f, 'live\n');
    assert.deepEqual(generations(f).map((p) => readFileSync(p, 'utf8').trim()),
      ['g3', 'g2', 'g1', 'live'],
      'oldest first: a reader concatenating these must reproduce chronological order');
  });

  test('generations() omits what does not exist and never invents a path', (t) => {
    const f = fixture(t);
    assert.deepEqual(generations(f), [], 'no live file and no archives is empty, not a phantom');
    writeFileSync(f, 'x\n');
    assert.deepEqual(generations(f), [f]);
  });

  test('a file under the threshold does not rotate, and an absent one is not an error', (t) => {
    const f = fixture(t);
    assert.equal(rotateIfLarge(f, 10), false, 'absent must be false, not a throw');
    writeFileSync(f, 'ab\n');
    assert.equal(rotateIfLarge(f, 1_000_000), false);
    assert.equal(existsSync(`${f}.1`), false);
  });

  test('archiveGenerations counts only numeric siblings of THIS file', (t) => {
    const f = fixture(t);
    writeFileSync(f, 'x\n');
    writeFileSync(`${f}.1`, 'x\n');
    writeFileSync(`${f}.2`, 'x\n');
    writeFileSync(`${f}.bak`, 'x\n');           // not a generation
    writeFileSync(join(f, '..', 'other.jsonl.1'), 'x\n');   // another file's generation
    assert.deepEqual(archiveGenerations(f).map((g) => g.n), [1, 2]);
  });

  test('shiftArchives is safe to run with no archives present', (t) => {
    const f = fixture(t);
    writeFileSync(f, 'x\n');
    shiftArchives(f);
    assert.deepEqual(archiveGenerations(f), []);
  });
});
