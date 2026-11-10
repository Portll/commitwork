// Folds a lint run's outcome into a status record with exit code, finding count and a findings sample (bin/lib/build-health-parse.mjs foldLint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldLint } from '../lib/build-health-parse.mjs';

const input = { lang: 'js', tool: 'eslint', declaredBy: 'repo', command: 'eslint .' };
const head = (enforced) => ({ lang: 'js', ran: true, tool: 'eslint', declaredBy: 'repo', command: 'eslint .', enforced });
const nums = (n) => Array.from({ length: n }, (_, i) => i);
const dash = '\u2014';

test('A null findings list is unreadable with exit zero when the run was ok', () => {
  const r = foldLint({ ...input, enforced: true, ok: true, code: 3, findings: null });
  assert.deepEqual(r, {
    ...head('deny'), status: 'unreadable', exit: 0, findingCount: null,
    note: `no parser is registered for eslint ${dash} its output was not read, which is not a clean lint`,
  });
});

test('A null findings list from a failed run with no code reports a null exit', () => {
  const r = foldLint({ ...input, enforced: false, ok: false, findings: null });
  assert.deepEqual(r, {
    ...head('warn'), status: 'unreadable', exit: null, findingCount: null,
    note: `no parser is registered for eslint ${dash} its output was not read, which is not a clean lint`,
  });
});

test('A failed run with no parsed findings is unreadable and names the exit code', () => {
  const r = foldLint({ ...input, enforced: true, ok: false, code: 2, findings: [] });
  assert.deepEqual(r, {
    ...head('deny'), status: 'unreadable', exit: 2, findingCount: null,
    note: `eslint exited 2 with nothing parseable ${dash} it failed to run, or emits a format this parser does not match`,
  });
  const q = foldLint({ ...input, enforced: true, ok: false, findings: [] });
  assert.deepEqual(q, {
    ...head('deny'), status: 'unreadable', exit: null, findingCount: null,
    note: `eslint exited ? with nothing parseable ${dash} it failed to run, or emits a format this parser does not match`,
  });
});

test('A failed enforced run that parsed findings reports them as a findings status with its exit code', () => {
  const r = foldLint({ ...input, enforced: true, ok: false, code: 1, findings: nums(3) });
  assert.deepEqual(r, { ...head('deny'), status: 'findings:3', exit: 1, findingCount: 3, findings: [0, 1, 2] });
});

test('An incomplete run is unreadable and keeps its findings as a floor', () => {
  const r = foldLint({ ...input, enforced: false, ok: true, code: 5, findings: nums(5), completeness: { complete: false, reason: 'crashed' } });
  assert.deepEqual(r, {
    ...head('warn'), status: 'unreadable', exit: 0, findingCount: null, findingsFloor: 5, findings: [0, 1, 2, 3, 4], complete: false,
    note: `eslint did not analyse the whole tree ${dash} crashed. 5 diagnostic(s) were parsed and are real, but they are a FLOOR over the targets it reached, not a count of the tree. Absence from this list is not evidence of absence.`,
  });
});

test('An incomplete failed run caps its findings sample at 200 but floors at the full count', () => {
  const r = foldLint({ ...input, enforced: true, ok: false, code: 9, findings: nums(201), completeness: { complete: false, reason: 'timeout' } });
  assert.deepEqual(r, {
    ...head('deny'), status: 'unreadable', exit: 9, findingCount: null, findingsFloor: 201, findings: nums(200), complete: false,
    note: `eslint did not analyse the whole tree ${dash} timeout. 201 diagnostic(s) were parsed and are real, but they are a FLOOR over the targets it reached, not a count of the tree. Absence from this list is not evidence of absence.`,
  });
});

test('A warn-level run with findings is advisory and reports a count', () => {
  const r = foldLint({ ...input, enforced: false, ok: true, code: 4, findings: nums(3) });
  assert.deepEqual(r, {
    ...head('warn'), status: 'advisory', exit: 0, findingCount: 3, findings: [0, 1, 2],
    note: '3 diagnostic(s); this repo declares eslint at WARN level, so this is a count and not a failed gate',
  });
  const q = foldLint({ ...input, enforced: false, ok: false, code: 7, findings: nums(1) });
  assert.deepEqual(q, {
    ...head('warn'), status: 'advisory', exit: 7, findingCount: 1, findings: [0],
    note: '1 diagnostic(s); this repo declares eslint at WARN level, so this is a count and not a failed gate',
  });
});

test('A warn-level ok run with no findings is clean with an undefined note', () => {
  const r = foldLint({ ...input, enforced: false, ok: true, code: 0, findings: [] });
  assert.deepEqual(r, { ...head('warn'), status: 'clean', exit: 0, findingCount: 0, findings: [], note: undefined });
});

test('An enforced ok run with no findings is clean', () => {
  const r = foldLint({ ...input, enforced: true, ok: true, code: 0, findings: [] });
  assert.deepEqual(r, { ...head('deny'), status: 'clean', exit: 0, findingCount: 0, findings: [] });
});

test('An enforced run keeps all 200 findings at the cap and truncates 201 to 200', () => {
  const r = foldLint({ ...input, enforced: true, ok: true, code: 0, findings: nums(200) });
  assert.deepEqual(r, { ...head('deny'), status: 'findings:200', exit: 0, findingCount: 200, findings: nums(200) });
  const q = foldLint({ ...input, enforced: true, ok: true, code: 0, findings: nums(201) });
  assert.deepEqual(q, { ...head('deny'), status: 'findings:201', exit: 0, findingCount: 201, findings: nums(200) });
});
