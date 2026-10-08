// WP1 (b) + (c): every attributed path says which basis produced the claim, declared outranks
// inferred, a stale claim does not, and the git union names commits the ledger never saw.
// (bin/test/attribution-basis.test.mjs covers attributionBasis(); this file covers basisFor().)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisFor, basisLine } from '../gate-tests-core.mjs';
import { declaredIndex, readDeclaredClaims } from '../lib/declared-claims.mjs';

const row = (o) => JSON.stringify(o);
const NOW = Date.parse('2026-09-09T12:00:00Z');

test('basis precedence: declared > write > commit > touch > unknown', () => {
  const declared = declaredIndex([{ path: 'a.mjs', planId: 'p', taskId: '1', claimedAt: '2026-09-09T11:00:00Z' }], { now: NOW });
  const ledger = [
    row({ f: 'a.mjs', s: 'aaaa', t: 'edit', h: 'x', n: 'y', access: 'write' }),
    row({ f: 'b.mjs', s: 'bbbb', t: 'edit', h: 'x', n: 'y', access: 'write' }),
    row({ f: 'c.mjs', s: 'cccc', via: 'commit', access: 'write', sha: 'abc1234' }),
    row({ f: 'd.mjs', s: 'dddd' }),
  ];
  const b = basisFor(['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'e.mjs'], { ledgerLines: ledger, declared });
  assert.deepEqual(b.perFile.map((p) => [p.file, p.basis]), [['a.mjs', 'declared'], ['b.mjs', 'write'], ['c.mjs', 'commit'], ['d.mjs', 'touch'], ['e.mjs', 'unknown']]);
  assert.deepEqual(b.perFile[0].declaredBy, ['p/1']);
  assert.deepEqual(b.counts, { declared: 1, write: 1, commit: 1, touch: 1, unknown: 1 });
  assert.equal(b.declaredMeasured, true);
});

test('a STALE declared claim is reported and does not take the top basis', () => {
  const declared = declaredIndex([{ path: 'a.mjs', planId: 'p', taskId: '1', claimedAt: '2026-08-27T10:31:56Z' }], { now: NOW });
  const b = basisFor(['a.mjs'], { ledgerLines: [row({ f: 'a.mjs', s: 'aaaa', t: 'edit', h: 'x', n: 'y', access: 'write' })], declared });
  assert.equal(b.perFile[0].basis, 'write');
  assert.equal(b.perFile[0].staleClaims, 1);
  assert.deepEqual(b.perFile[0].declaredBy, []);
});

test('the git union: a commit that changed the file with no via:commit row is named as unrecorded', () => {
  const ledger = [row({ f: 'a.mjs', s: 'aaaa', via: 'commit', access: 'write', sha: 'abc1234def' })];
  const b = basisFor(['a.mjs', 'b.mjs'], {
    ledgerLines: ledger,
    commitsFor: (f) => (f === 'a.mjs' ? ['abc1234def0000', '9999999aaaa'] : ['1111111bbbb']),
  });
  assert.deepEqual(b.perFile[0].unrecordedCommits, ['9999999aaaa']);
  assert.deepEqual(b.perFile[1].unrecordedCommits, ['1111111bbbb']);
  assert.deepEqual(b.unrecordedCommitFiles, ['a.mjs', 'b.mjs']);
  assert.match(basisLine(b), /2 file\(s\) changed by a commit no ledger row records \(P13\)/);
});

test('an unread claims store is UNMEASURED, and the line says so rather than printing "no declared claims"', () => {
  const b = basisFor(['a.mjs'], { ledgerLines: [], declared: declaredIndex(null) });
  assert.equal(b.declaredMeasured, false);
  assert.match(basisLine(b), /declared claims NOT READ/);
  assert.equal(basisLine(null), 'basis: not computed');
});

test('exec rows and foreign-tree rows never contribute to a basis', () => {
  const ledger = [row({ f: 'a.mjs', s: 'aaaa', via: 'exec' }), row({ f: 'a.mjs', s: 'bbbb', r: 'othertree', t: 'edit', h: 'x', n: 'y' })];
  const b = basisFor(['a.mjs'], { ledgerLines: ledger, myTree: 'mytree' });
  assert.equal(b.perFile[0].basis, 'unknown');
});

test('readDeclaredClaims: an absent store is null (could not look), never an empty list', () => {
  assert.equal(readDeclaredClaims({ db: '/nonexistent/tasks.db' }), null);
  assert.equal(readDeclaredClaims({ db: process.execPath, sqlite: '/nonexistent/sqlite3' }), null);
});
