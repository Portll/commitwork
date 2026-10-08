// R-B · every row carries an explicit access kind, and an ABSENT field is `undetermined` — never
// `read`.
//
// THE DEFECT THIS CLOSES. Today a consumer sees no `t:"write"` and concludes "this was a read".
// That is an unsupported pass one layer beneath every attribution the fleet publishes, and it is not
// hypothetical: measured on the live store 2026-08-30, `attributeFiles` filters on `if (!r.f)
// continue` and consults NO write evidence at all, so ownership is asserted from all 18,762 file
// rows — including the 12,166 (65%) that carry none. A session gets named as having "touched" a file
// whose path merely appeared in a command string.
//
// AND THERE IS NO `read` PATH, deliberately. The hook matches Edit|Write|NotebookEdit|Bash; not one
// of those is a read tool. The store has never held read evidence, so a consumer rendering a bare
// touch as "read" is inventing a category the instrument never recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessOf, isWriteEvidence, ACCESS_KINDS } from '../lib/touch-ledger-core.mjs';

test('THE CONTRACT: a legacy row with no access field is `undetermined`, never `read`', () => {
  assert.equal(accessOf({ f: 'a.mjs' }), 'undetermined');
  assert.equal(accessOf({ f: 'a.mjs', via: 'fs-delta' }), 'undetermined');
  assert.notEqual(accessOf({ f: 'a.mjs' }), 'read',
    'absence of write evidence is "we could not tell", not "somebody read it"');
});

test('NO input produces `read` — the store has never held read evidence', () => {
  const shapes = [
    {}, { f: 'a' }, { x: 'a' }, { f: 'a', t: 'edit' }, { f: 'a', t: 'write' },
    { f: 'a', via: 'commit' }, { f: 'a', via: 'shell' }, { f: 'a', via: 'fs-delta' },
    { f: 'a', via: 'exec' }, { f: 'a', t: 'nonsense' }, { f: 'a', access: 'bogus' },
  ];
  for (const s of shapes) {
    assert.notEqual(accessOf(s), 'read', `${JSON.stringify(s)} must not read as a read`);
    assert.ok(ACCESS_KINDS.has(accessOf(s)), 'and must land in the declared vocabulary');
  }
});

test('an explicit access field wins over inference', () => {
  assert.equal(accessOf({ f: 'a', t: 'edit', access: 'undetermined' }), 'undetermined',
    'a recorder that said "I could not tell" is not overruled by a guess about its other fields');
  assert.equal(accessOf({ f: 'a', access: 'write' }), 'write');
});

test('payload fingerprints are write evidence — both Edit and Write shapes', () => {
  assert.equal(accessOf({ f: 'a', t: 'edit' }), 'write');
  assert.equal(accessOf({ f: 'a', t: 'write' }), 'write');
  assert.ok(isWriteEvidence({ f: 'a', t: 'edit' }),
    't:"edit" IS a write; counting only t:"write" is what made the store look 16x worse than it is');
});

test('commit- and shell-derived rows are write evidence; exec rows are not', () => {
  assert.equal(accessOf({ f: 'a', via: 'commit' }), 'write');
  assert.equal(accessOf({ f: 'a', via: 'shell' }), 'write');
  assert.equal(accessOf({ x: 'a', via: 'exec' }), 'exec');
  assert.equal(isWriteEvidence({ x: 'a', via: 'exec' }), false,
    'running a script is not authoring it — this exact confusion is called out in the hook header');
});

test('a delta-derived row is NOT write evidence — it cannot name an owner on a shared tree', () => {
  assert.equal(isWriteEvidence({ f: 'a', via: 'fs-delta', access: 'undetermined' }), false,
    'eleven sessions write this checkout; a filesystem delta cannot tell mine from theirs');
});

test('an unrecognised access value is not honoured — the vocabulary is closed', () => {
  assert.equal(accessOf({ f: 'a', access: 'sort-of' }), 'undetermined',
    'an open vocabulary lets a typo become a fifth state nobody handles');
});
