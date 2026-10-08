// Maps packet hops, sink, related, guard, and declarations to line anchors with roles and statement extents (lib/cobolwork-remediation.mjs anchorsFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorsFrom } from '../cobolwork-remediation.mjs';

test('returns an empty map when the packet has no sections', () => {
  const anchors = anchorsFrom({});
  assert.equal(anchors.size, 0);
});

test('adds a hop anchor with its role and quoted code', () => {
  const anchors = anchorsFrom({ hops: [{ n: 1, path: 'a.cbl', line: 10, code: 'MOVE A TO B', elided: false }] });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('a.cbl:10');
  assert.deepEqual(entry, { path: 'a.cbl', line: 10, code: 'MOVE A TO B', quoted: true, withheld: false, role: 'hop 1' });
});

test('skips elided hops', () => {
  const anchors = anchorsFrom({ hops: [{ n: 1, path: 'a.cbl', line: 10, elided: true }] });
  assert.equal(anchors.size, 0);
});

test('adds a sink anchor with role sink', () => {
  const anchors = anchorsFrom({ sink: { path: 's.cbl', line: 5, code: 'WRITE REC' } });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('s.cbl:5');
  assert.equal(entry.role, 'sink');
  assert.equal(entry.code, 'WRITE REC');
  assert.equal(entry.quoted, true);
});

test('adds related anchors with role source', () => {
  const anchors = anchorsFrom({ related: [{ path: 'r.cbl', line: 3, code: 'READ REC' }] });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('r.cbl:3');
  assert.equal(entry.role, 'source');
  assert.equal(entry.code, 'READ REC');
});

test('adds a guard anchor with role check when path is present', () => {
  const anchors = anchorsFrom({ guard: { path: 'g.cbl', line: 7, code: 'IF X > 0' } });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('g.cbl:7');
  assert.equal(entry.role, 'check');
  assert.equal(entry.code, 'IF X > 0');
});

test('does not add a guard anchor when path is missing', () => {
  const anchors = anchorsFrom({ guard: { line: 7, code: 'IF X > 0' } });
  assert.equal(anchors.size, 0);
});

test('adds declaration anchors with null code and descriptive role', () => {
  const anchors = anchorsFrom({ declarations: [{ path: 'd.cbl', line: 2, item: 'X', level: 1, picture: '9(3)', section: 'DATA' }] });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('d.cbl:2');
  assert.equal(entry.code, null);
  assert.equal(entry.quoted, false);
  assert.equal(entry.role, 'declaration of X, level 1 PIC 9(3) in DATA');
});

test('adds declaration anchor with unnamed section when section is missing', () => {
  const anchors = anchorsFrom({ declarations: [{ path: 'd.cbl', line: 4, item: 'Y', level: 5 }] });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('d.cbl:4');
  assert.equal(entry.role, 'declaration of Y, level 5 in an unnamed section');
});

test('expands a multi-line statement into anchors for each line with stmt extent', () => {
  const anchors = anchorsFrom({
    hops: [{
      n: 1, path: 'm.cbl', line: 10, endLine: 12,
      rest: [{ line: 11, code: 'CONT1' }, { line: 12, code: 'CONT2' }],
      code: 'START', elided: false
    }]
  });
  assert.equal(anchors.size, 3);
  const a10 = anchors.get('m.cbl:10');
  assert.deepEqual(a10.stmt, [10, 12]);
  assert.equal(a10.code, 'START');
  const a11 = anchors.get('m.cbl:11');
  assert.deepEqual(a11.stmt, [10, 12]);
  assert.equal(a11.code, 'CONT1');
  assert.equal(a11.role, 'hop 1, continued from line 10');
  const a12 = anchors.get('m.cbl:12');
  assert.deepEqual(a12.stmt, [10, 12]);
  assert.equal(a12.code, 'CONT2');
  assert.equal(a12.role, 'hop 1, continued from line 10');
});

test('does not create stmt when rest length does not match endLine minus line', () => {
  const anchors = anchorsFrom({
    hops: [{
      n: 1, path: 'm.cbl', line: 10, endLine: 12,
      rest: [{ line: 11, code: 'CONT1' }],
      code: 'START', elided: false
    }]
  });
  assert.equal(anchors.size, 1);
  const a10 = anchors.get('m.cbl:10');
  assert.equal(a10.stmt, undefined);
  assert.equal(a10.code, 'START');
});

test('does not create stmt when endLine equals line', () => {
  const anchors = anchorsFrom({
    hops: [{
      n: 1, path: 'm.cbl', line: 10, endLine: 10,
      rest: [],
      code: 'START', elided: false
    }]
  });
  assert.equal(anchors.size, 1);
  const a10 = anchors.get('m.cbl:10');
  assert.equal(a10.stmt, undefined);
});

test('filters rest entries whose line is not strictly greater than start or greater than end', () => {
  const anchors = anchorsFrom({
    hops: [{
      n: 1, path: 'm.cbl', line: 10, endLine: 12,
      rest: [{ line: 10, code: 'BAD1' }, { line: 11, code: 'OK' }, { line: 13, code: 'BAD2' }],
      code: 'START', elided: false
    }]
  });
  assert.equal(anchors.size, 1);
  const a10 = anchors.get('m.cbl:10');
  assert.equal(a10.stmt, undefined);
});

test('keeps the first anchor when a later anchor targets the same path and line with code', () => {
  const anchors = anchorsFrom({
    hops: [{ n: 1, path: 'a.cbl', line: 10, code: 'FIRST', elided: false }],
    related: [{ path: 'a.cbl', line: 10, code: 'SECOND' }]
  });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('a.cbl:10');
  assert.equal(entry.code, 'FIRST');
  assert.equal(entry.role, 'hop 1');
});

test('overwrites an anchor with null code when a later anchor has code', () => {
  const anchors = anchorsFrom({
    declarations: [{ path: 'a.cbl', line: 10, item: 'X', level: 1 }],
    hops: [{ n: 1, path: 'a.cbl', line: 10, code: 'REAL', elided: false }]
  });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('a.cbl:10');
  assert.equal(entry.code, 'REAL');
  assert.equal(entry.role, 'hop 1');
});

test('skips anchors with non-positive line numbers', () => {
  const anchors = anchorsFrom({
    hops: [{ n: 1, path: 'a.cbl', line: 0, elided: false }, { n: 2, path: 'b.cbl', line: -5, elided: false }]
  });
  assert.equal(anchors.size, 0);
});

test('skips anchors with non-string path', () => {
  const anchors = anchorsFrom({
    hops: [{ n: 1, path: 123, line: 10, elided: false }]
  });
  assert.equal(anchors.size, 0);
});

test('marks withheld anchors with withheld true and code null', () => {
  const anchors = anchorsFrom({
    hops: [{ n: 1, path: 'a.cbl', line: 10, withheld: true, elided: false }]
  });
  assert.equal(anchors.size, 1);
  const entry = anchors.get('a.cbl:10');
  assert.equal(entry.withheld, true);
  assert.equal(entry.code, null);
  assert.equal(entry.quoted, false);
});

test('includes via in hop role when present', () => {
  const anchors = anchorsFrom({
    hops: [{ n: 1, path: 'a.cbl', line: 10, via: 'PERFORM', elided: false }]
  });
  const entry = anchors.get('a.cbl:10');
  assert.equal(entry.role, 'hop 1 (PERFORM)');
});
