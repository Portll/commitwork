// Formats a one-line summary of the basis counts, declared-claims status, and unrecorded commit files (bin/gate-tests-core.mjs basisLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisLine } from '../gate-tests-core.mjs';

test('returns the not computed sentinel when the input is falsy', () => {
  assert.equal(basisLine(null), "basis: not computed");
});

test('returns the not computed sentinel when the input is undefined', () => {
  assert.equal(basisLine(undefined), "basis: not computed");
});

test('returns no files when counts is empty and declared is measured with no unrecorded files', () => {
  assert.equal(basisLine({ counts: {}, declaredMeasured: true, unrecordedCommitFiles: [] }), "basis: no files");
});

test('joins sorted count entries with the separator when counts is non-empty', () => {
  assert.equal(basisLine({ counts: { b: 2, a: 1 }, declaredMeasured: true, unrecordedCommitFiles: [] }), "basis: a 1 \u00b7 b 2");
});

test('appends the declared-not-read note when declaredMeasured is false', () => {
  assert.equal(basisLine({ counts: { a: 1 }, declaredMeasured: false, unrecordedCommitFiles: [] }), "basis: a 1 \u00b7 declared claims NOT READ (spine store unavailable), so \"declared\" is unmeasured, not absent");
});

test('lists up to five unrecorded commit files without the ellipsis when there are exactly five', () => {
  const files = Array.from({ length: 5 }, (_, i) => `f${i}.js`);
  assert.equal(basisLine({ counts: {}, declaredMeasured: true, unrecordedCommitFiles: files }), "basis: no files \u00b7 5 file(s) changed by a commit no ledger row records (P13): f0.js, f1.js, f2.js, f3.js, f4.js");
});

test('lists the first five unrecorded commit files with the ellipsis when there are more than five', () => {
  const files = Array.from({ length: 7 }, (_, i) => `f${i}.js`);
  assert.equal(basisLine({ counts: {}, declaredMeasured: true, unrecordedCommitFiles: files }), "basis: no files \u00b7 7 file(s) changed by a commit no ledger row records (P13): f0.js, f1.js, f2.js, f3.js, f4.js, \u2026");
});

test('lists a single unrecorded commit file without the ellipsis', () => {
  assert.equal(basisLine({ counts: {}, declaredMeasured: true, unrecordedCommitFiles: ['only.js'] }), "basis: no files \u00b7 1 file(s) changed by a commit no ledger row records (P13): only.js");
});
