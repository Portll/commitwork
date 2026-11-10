// Builds the attribution-basis footnote string from file and session counts (bin/gate-tests-core.mjs basisNote).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisNote } from '../gate-tests-core.mjs';

const S = ' \u00b7 ';

test('returns an empty string when called with no argument', () => {
  assert.equal(basisNote(), '');
});

test('returns an empty string for an empty basis object', () => {
  assert.equal(basisNote({}), '');
});

test('returns an empty string when files is zero even with other counts set', () => {
  const r = basisNote({ files: 0, evidenced: 5, unevidenced: 2, sessionsConsidered: 3 });
  assert.equal(r, '');
});

test('fills every missing count with zero when only files is given', () => {
  const r = basisNote({ files: 1 });
  assert.equal(r, '\n\nBasis: 0 of 1 attributed on WRITE evidence' + S + '0 session(s) considered.');
});

test('omits the bare touch part when unevidenced is zero', () => {
  const r = basisNote({ files: 10, evidenced: 8, unevidenced: 0, sessionsConsidered: 2 });
  assert.equal(r, '\n\nBasis: 8 of 10 attributed on WRITE evidence' + S + '2 session(s) considered.');
});

test('includes the bare touch part when unevidenced is one', () => {
  const r = basisNote({ files: 2, evidenced: 1, unevidenced: 1, sessionsConsidered: 4 });
  assert.equal(
    r,
    '\n\nBasis: 1 of 2 attributed on WRITE evidence' + S + '1 on a bare touch' + S + '4 session(s) considered.',
  );
});

test('reports zero evidenced when evidenced is omitted', () => {
  const r = basisNote({ files: 3, unevidenced: 0, sessionsConsidered: 2 });
  assert.equal(r, '\n\nBasis: 0 of 3 attributed on WRITE evidence' + S + '2 session(s) considered.');
});

test('omits the bare touch part when unevidenced is omitted', () => {
  const r = basisNote({ files: 4, evidenced: 4, sessionsConsidered: 1 });
  assert.equal(r, '\n\nBasis: 4 of 4 attributed on WRITE evidence' + S + '1 session(s) considered.');
});

test('reports zero sessions when sessionsConsidered is omitted', () => {
  const r = basisNote({ files: 2, evidenced: 1, unevidenced: 1 });
  assert.equal(
    r,
    '\n\nBasis: 1 of 2 attributed on WRITE evidence' + S + '1 on a bare touch' + S + '0 session(s) considered.',
  );
});
