// Computes the fraction of expected source files successfully extracted by CodeQL (monitor/codeql-coverage.mjs codeqlCoverage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeqlCoverage } from '../codeql-coverage.mjs';

test('returns unmeasurable when no source extensions are declared', () => {
  const r = codeqlCoverage({ runs: [] }, []);
  assert.deepEqual(r, { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "the lane declares no appliesIfSourceExt, so there is no language-scoped denominator to measure against" });
});

test('returns unmeasurable when the SARIF has no expected baseline', () => {
  const r = codeqlCoverage({ runs: [] }, ['.js']);
  assert.deepEqual(r, { state: "unmeasurable", ratio: null, extracted: 0, expected: 0, reason: "this SARIF carries no expected-extracted-files baseline \u2014 coverage cannot be computed, which is not the same as complete" });
});

test('returns unmeasurable when successes exist but the baseline enumerates none of that language', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.py' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "unmeasurable", ratio: null, extracted: 1, expected: 0, reason: "the extractor reports 1 success(es) for this language but the archive baseline enumerates none of it \u2014 the denominator is absent, so coverage is unknowable, which is not the same as complete" });
});

test('returns no-language when the archive contains no files with the lane extensions', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.py' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "no-language", ratio: null, extracted: 0, expected: 0, reason: "the source archive contains no files with this lane's extensions, so an empty result is the correct answer rather than a void" });
});

test('returns covered when the extraction ratio meets the floor', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "covered", ratio: 1, extracted: 2, expected: 2, reason: "extracted 2 of 2 files carrying this lane's extensions" });
});

test('returns partial when the extraction ratio is below the floor', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "partial", ratio: 0.5, extracted: 1, expected: 2, reason: "extracted only 1 of 2 files carrying this lane's extensions (50%). Findings reported are real; the ABSENCE of findings in the unread remainder is not evidence of absence, so a zero or a low count under this state is undetermined rather than clean." });
});

test('returns covered with a ceiling note when a failed path is ambiguous', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/failed-to-extract-file' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'x' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "partial", ratio: 0.5, extracted: 1, expected: 2, reason: "extracted only 1 of 2 files carrying this lane's extensions (50%). Findings reported are real; the ABSENCE of findings in the unread remainder is not evidence of absence, so a zero or a low count under this state is undetermined rather than clean." });
});

test('returns partial with a failed-to-parse list when files fail extraction', () => {
  const sarif = { runs: [{ invocations: [{ toolExecutionNotifications: [
    { descriptor: { id: 'codeql/javascript-extraction/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] },
    { descriptor: { id: 'codeql/javascript-extraction/failed-to-extract-file' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'b.js' } } }] }
  ] }] }] };
  const r = codeqlCoverage(sarif, ['.js']);
  assert.deepEqual(r, { state: "partial", ratio: 0.5, extracted: 1, expected: 2, reason: "extracted only 1 of 2 files carrying this lane's extensions (50%). Findings reported are real; the ABSENCE of findings in the unread remainder is not evidence of absence, so a zero or a low count under this state is undetermined rather than clean." });
});
