// monitor/test/anchor-disposition-units.test.mjs — case tests for appendRuling, currentRuling, emptyDispositionsDoc, evidenceSubject, needlesFrom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRuling, currentRuling, emptyDispositionsDoc, evidenceSubject, needlesFrom } from '../anchor-disposition.mjs';

test('appends a valid ruling and returns it', () => {
  const doc = { rulings: [] };
  const r = appendRuling(doc, { anchor: 'a1', disposition: 'remediated', reason: 'fixed', at: '2026-01-01' });
  assert.equal(doc.rulings.length, 1);
  assert.equal(r.anchor, 'a1');
  assert.equal(r.disposition, 'remediated');
  assert.equal(r.reason, 'fixed');
  assert.equal(r.at, '2026-01-01');
  assert.equal(r.prevHash, null);
  assert.equal(typeof r.hash, 'string');
  assert.ok(r.hash.length > 0);
});

test('throws on invalid disposition', () => {
  const doc = { rulings: [] };
  assert.throws(() => appendRuling(doc, { anchor: 'a', disposition: 'bogus', reason: 'x' }), /disposition must be one of/);
});

test('throws on missing anchor', () => {
  const doc = { rulings: [] };
  assert.throws(() => appendRuling(doc, { anchor: '', disposition: 'moot', reason: 'x' }), /anchor is required/);
});

test('throws on empty reason', () => {
  const doc = { rulings: [] };
  assert.throws(() => appendRuling(doc, { anchor: 'a', disposition: 'moot', reason: '   ' }), /reason is required/);
});

test('chains prevHash from previous ruling', () => {
  const doc = { rulings: [] };
  const r1 = appendRuling(doc, { anchor: 'a', disposition: 'remediated', reason: 'fix1', at: 't1' });
  const r2 = appendRuling(doc, { anchor: 'a', disposition: 'still-present', reason: 'fix2', at: 't2' });
  assert.equal(r2.prevHash, r1.hash);
  assert.equal(doc.rulings.length, 2);
});

test('trims reason whitespace', () => {
  const doc = { rulings: [] };
  const r = appendRuling(doc, { anchor: 'a', disposition: 'moot', reason: '  padded  ' });
  assert.equal(r.reason, 'padded');
});

test('defaults evidenceDigest and by to null', () => {
  const doc = { rulings: [] };
  const r = appendRuling(doc, { anchor: 'a', disposition: 'unreviewed', reason: 'r' });
  assert.equal(r.evidenceDigest, null);
  assert.equal(r.by, null);
});

test('returns unreviewed when no rulings exist for anchor', () => {
  const doc = { rulings: [] };
  const result = currentRuling(doc, 'anchor1', 'sha256:abc');
  assert.deepEqual(result, { disposition: 'unreviewed', stale: false, ruling: null });
});

test('returns unreviewed when rulings exist but none match anchor', () => {
  const doc = { rulings: [{ anchor: 'other', disposition: 'remediated', evidenceDigest: 'sha256:x' }] };
  const result = currentRuling(doc, 'anchor1', 'sha256:abc');
  assert.deepEqual(result, { disposition: 'unreviewed', stale: false, ruling: null });
});

test('returns matching ruling when digest matches', () => {
  const ruling = { anchor: 'a1', disposition: 'remediated', evidenceDigest: 'sha256:match' };
  const doc = { rulings: [ruling] };
  const result = currentRuling(doc, 'a1', 'sha256:match');
  assert.equal(result.disposition, 'remediated');
  assert.equal(result.stale, false);
  assert.equal(result.ruling, ruling);
});

test('returns stale unreviewed when digest differs', () => {
  const ruling = { anchor: 'a1', disposition: 'remediated', evidenceDigest: 'sha256:old' };
  const doc = { rulings: [ruling] };
  const result = currentRuling(doc, 'a1', 'sha256:new');
  assert.equal(result.disposition, 'unreviewed');
  assert.equal(result.stale, true);
  assert.equal(result.ruling, ruling);
  assert.equal(result.staleReason, 'the code changed again after this ruling');
});

test('returns matching ruling when digest is null and ruling has no evidenceDigest', () => {
  const ruling = { anchor: 'a1', disposition: 'still-present', evidenceDigest: null };
  const doc = { rulings: [ruling] };
  const result = currentRuling(doc, 'a1', null);
  assert.equal(result.disposition, 'still-present');
  assert.equal(result.stale, false);
  assert.equal(result.ruling, ruling);
});

test('returns matching ruling when digest is provided but ruling has no evidenceDigest', () => {
  const ruling = { anchor: 'a1', disposition: 'moot', evidenceDigest: null };
  const doc = { rulings: [ruling] };
  const result = currentRuling(doc, 'a1', 'sha256:anything');
  assert.equal(result.disposition, 'moot');
  assert.equal(result.stale, false);
  assert.equal(result.ruling, ruling);
});

test('uses last matching ruling when multiple exist for same anchor', () => {
  const r1 = { anchor: 'a1', disposition: 'remediated', evidenceDigest: 'sha256:d1' };
  const r2 = { anchor: 'a1', disposition: 'still-present', evidenceDigest: 'sha256:d2' };
  const doc = { rulings: [r1, r2] };
  const result = currentRuling(doc, 'a1', 'sha256:d2');
  assert.equal(result.disposition, 'still-present');
  assert.equal(result.ruling, r2);
});

test('returns an object with the expected top-level keys', () => {
  const doc = emptyDispositionsDoc();
  assert.deepEqual(Object.keys(doc).sort(), ['note', 'rulings', 'version']);
});

test('version is 1', () => {
  const doc = emptyDispositionsDoc();
  assert.equal(doc.version, 1);
});

test('rulings is an empty array', () => {
  const doc = emptyDispositionsDoc();
  assert.ok(Array.isArray(doc.rulings));
  assert.equal(doc.rulings.length, 0);
});

test('note is a non-empty string', () => {
  const doc = emptyDispositionsDoc();
  assert.equal(typeof doc.note, 'string');
  assert.ok(doc.note.length > 0);
});


test('two calls return independent objects', () => {
  const a = emptyDispositionsDoc();
  const b = emptyDispositionsDoc();
  a.rulings.push('x');
  assert.equal(b.rulings.length, 0);
});

test('returns all fields as null for empty object', () => {
  const result = evidenceSubject({});
  assert.deepEqual(result, {
    anchor: null,
    state: null,
    baselineHash: null,
    currentHash: null,
    removedBy: null,
  });
});

test('returns provided values for fully populated entry', () => {
  const entry = {
    anchor: 'src/foo.js:10',
    state: 'drifted',
    baselineHash: 'abc123',
    currentHash: 'def456',
    removedBy: 'user@example.com',
  };
  const result = evidenceSubject(entry);
  assert.equal(result.anchor, 'src/foo.js:10');
  assert.equal(result.state, 'drifted');
  assert.equal(result.baselineHash, 'abc123');
  assert.equal(result.currentHash, 'def456');
  assert.equal(result.removedBy, 'user@example.com');
});

test('uses anchorHash as fallback for baselineHash when baselineHash is missing', () => {
  const entry = {
    anchor: 'src/bar.js:5',
    anchorHash: 'fallback-hash',
    currentHash: 'cur-hash',
  };
  const result = evidenceSubject(entry);
  assert.equal(result.baselineHash, 'fallback-hash');
  assert.equal(result.currentHash, 'cur-hash');
});

test('prefers baselineHash over anchorHash when both are present', () => {
  const entry = {
    anchor: 'src/baz.js:1',
    baselineHash: 'primary-hash',
    anchorHash: 'secondary-hash',
  };
  const result = evidenceSubject(entry);
  assert.equal(result.baselineHash, 'primary-hash');
});

test('returns null for missing optional fields while preserving provided ones', () => {
  const entry = {
    anchor: 'src/qux.js:42',
    state: 'fixed',
  };
  const result = evidenceSubject(entry);
  assert.equal(result.anchor, 'src/qux.js:42');
  assert.equal(result.state, 'fixed');
  assert.equal(result.baselineHash, null);
  assert.equal(result.currentHash, null);
  assert.equal(result.removedBy, null);
});

test('handles entry with only anchorHash and no other fields', () => {
  const entry = { anchorHash: 'only-hash' };
  const result = evidenceSubject(entry);
  assert.equal(result.anchor, null);
  assert.equal(result.state, null);
  assert.equal(result.baselineHash, 'only-hash');
  assert.equal(result.currentHash, null);
  assert.equal(result.removedBy, null);
});

test('extracts backtick-quoted spans from evidence', () => {
  const finding = { evidence: 'found `fooBarBaz` in config', summary: '' };
  assert.deepEqual(needlesFrom(finding), ['fooBarBaz']);
});

test('extracts double-quoted spans from summary', () => {
  const finding = { evidence: '', summary: 'uses "helloWorld" here' };
  assert.deepEqual(needlesFrom(finding), ['helloWorld']);
});

test('extracts single-quoted spans from evidence', () => {
  const finding = { evidence: "calls 'myFuncName' twice", summary: '' };
  assert.deepEqual(needlesFrom(finding), ['myFuncName']);
});

test('returns empty array when no quoted spans exist', () => {
  const finding = { evidence: 'no quotes here', summary: 'nothing specific' };
  assert.deepEqual(needlesFrom(finding), []);
});

test('returns empty array for missing evidence and summary', () => {
  const finding = {};
  assert.deepEqual(needlesFrom(finding), []);
});

test('sorts by length descending and caps at 5', () => {
  const finding = {
    evidence: '`a` `abcd` `abcdef` `abcdefgh` `abcdefghij` `abcdefghijk` `abcdefghijkl`',
    summary: '',
  };
  const result = needlesFrom(finding);
  assert.equal(result.length, 5);
  assert.equal(result[0], 'abcdefghijkl');
  assert.equal(result[1], 'abcdefghijk');
  assert.equal(result[2], 'abcdefghij');
  assert.equal(result[3], 'abcdefgh');
  assert.equal(result[4], 'abcdef');
});

test('filters out spans with double spaces', () => {
  const finding = { evidence: '`foo  bar` `validSpan`', summary: '' };
  assert.deepEqual(needlesFrom(finding), ['validSpan']);
});

test('filters out spans shorter than 4 chars', () => {
  const finding = { evidence: '`ab` `abcd`', summary: '' };
  assert.deepEqual(needlesFrom(finding), ['abcd']);
});
