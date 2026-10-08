// Which commitwork produced a batch's rows. A sweep spawns the runner fresh per repo while other
// sessions commit; before toolchain.json nothing recorded which sha ran which repo, so a 100-row
// batch produced by a dozen runners read as one measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codeVintage, readToolchain } from '../vintage.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const tc = (sha, hash = null, dirty = []) => ({ sha, sourceDirtyHash: hash, sourceDirty: dirty });

test('one runner, clean tree → distinct 1, not mixed', () => {
  const v = codeVintage([{ name: 'x', toolchain: tc(A) }, { name: 'y', toolchain: tc(A) }]);
  assert.equal(v.distinct, 1); assert.equal(v.mixed, false); assert.equal(v.unrecorded, 0);
  assert.match(v.note, /one runner .*clean tree/);
});

test('same sha, different dirty-source hash → TWO runners (the count never proved sameness; the content hash does)', () => {
  const v = codeVintage([{ name: 'x', toolchain: tc(A, 'h1', ['bin/a.mjs']) }, { name: 'y', toolchain: tc(A, 'h2', ['bin/a.mjs']) }]);
  assert.equal(v.distinct, 2); assert.equal(v.mixed, true);
  assert.match(v.note, /MIXED CODE VINTAGE/);
});

test('different shas → mixed, ordered by how many repos each produced', () => {
  const v = codeVintage([{ name: 'x', toolchain: tc(A) }, { name: 'y', toolchain: tc(B) }, { name: 'z', toolchain: tc(B) }]);
  assert.equal(v.distinct, 2);
  assert.equal(v.shas[0].sha, B); assert.deepEqual(v.shas[0].repos, ['y', 'z']);
});

test('receipts that predate the field are unrecorded — never a vintage, never agreement', () => {
  const v = codeVintage([{ name: 'old', toolchain: null }, { name: 'new', toolchain: tc(A) }]);
  assert.equal(v.distinct, 1); assert.equal(v.unrecorded, 1); assert.equal(v.recorded, 1);
  assert.equal(v.mixed, false, 'an absent receipt is not a second vintage');
  assert.match(v.note, /1 repo\(s\) predate the receipt/);
});

test('a receipt with no sha (not a git checkout / unreadable) is unrecorded, not a vintage named null', () => {
  const v = codeVintage([{ name: 'x', toolchain: { sha: null, reason: 'not a checkout' } }]);
  assert.equal(v.distinct, 0); assert.equal(v.unrecorded, 1);
  assert.match(v.note, /unrecorded for this whole batch/);
  assert.match(v.note, /not the same as one vintage/);
});

test('readToolchain: ENOENT is null; a present-but-unreadable file is NOT null (fail closed)', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vintage-'));
  assert.equal(readToolchain(d), null, 'absent is legitimately absent');
  const bad = join(d, 'bad'); mkdirSync(bad);
  writeFileSync(join(bad, 'toolchain.json'), '{ not json');
  const r = readToolchain(bad);
  assert.ok(r && r.sha === null && /unreadable/.test(r.reason), 'a parse failure is reported, not treated as absent');
  assert.equal(codeVintage([{ name: 'bad', toolchain: r }]).unrecorded, 1);
});
