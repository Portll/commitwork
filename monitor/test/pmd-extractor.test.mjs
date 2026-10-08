// monitor/test/pmd-extractor.test.mjs — lintJava's first real reader.
//
// Fixture is REAL captured output (2026-09-01): PMD 7.27.0 (Homebrew), rulesets bestpractices +
// errorprone + multithreading + performance, run against a scratch Java file with an empty catch
// block, a catch(Exception), an always-true if, and a System.out.println. Pasted verbatim, not
// hand-written. The "no files to analyze" log fixture is likewise a real captured stderr, from
// running the same command against an empty directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const spec = SCANNER_SPECS.find((s) => s[0] === 'lintJava');
assert.ok(spec, 'lintJava must be in SCANNER_SPECS');
const run = spec[2];

function readInto(content, logContent) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pmd-'));
  if (content !== null) writeFileSync(join(dir, 'pmd.json'), content);
  if (logContent !== undefined) writeFileSync(join(dir, 'pmd.log'), logContent);
  return dir;
}

// REAL, captured 2026-09-01: pmd check -d . -R category/java/bestpractices.xml,category/java/
// errorprone.xml,category/java/multithreading.xml,category/java/performance.xml -f json against a
// fixture repo (pom.xml + src/main/java/com/example/Bad.java: empty catch, catch(Exception), an
// unconditional if(true), and System.out.println in the branch).
// Shared with monitor/lane-capability.mjs, which credits the lane from it as in-test evidence.
const REAL_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extractor-real');
const PMD_JSON = readFileSync(join(REAL_OUTPUT, 'lintJava', 'pmd.json'), 'utf8');

// REAL, captured 2026-09-01: the same command against an empty directory (no .java files at all).
const NOSRC_LOG = '[WARN] No files to analyze. Check input paths and exclude parameters, use --debug to see file collection traces.\n[WARN] This analysis could be faster, please consider using Incremental Analysis: https://docs.pmd-code.org/pmd-doc-7.27.0/pmd_userdocs_incremental_analysis.html\n[INFO] Found no violations.\n';
const EMPTY_FILES_JSON = '{"formatVersion":0,"pmdVersion":"7.27.0","timestamp":"2026-09-01T22:13:22.741+09:30","files":[],"suppressedViolations":[],"processingErrors":[],"configurationErrors":[]}';

test('priority folds to sev: 1-2 high, 3 med, 4-5 low', () => {
  const r = run(readInto(PMD_JSON));
  assert.equal(r.ran, true);
  assert.equal(r.total, 4);
  assert.equal(r.high, 1, 'SystemPrintln at priority 2');
  assert.equal(r.med, 3, 'the three priority-3 Error Prone findings');
  assert.equal(r.low, 0);
});

test('rule/file/line/message come from the real fields; file strips the leading ./', () => {
  const rows = run(readInto(PMD_JSON)).findings;
  const row = rows.find((r) => r.rule === 'EmptyCatchBlock');
  assert.ok(row);
  assert.equal(row.file, 'src/main/java/com/example/Bad.java');
  assert.equal(row.line, 8);
  assert.match(row.message, /empty catch/);
});

test('no cwe field — PMD\'s JSON renderer ships no CWE mapping and none is invented', () => {
  const row = run(readInto(PMD_JSON)).findings[0];
  assert.equal('cwe' in row, false);
});

test('lintJava is lane(H, not-a-vulnerability) — hygiene, non-additive, non-actionable', () => {
  assert.equal(LANE_KINDS.lintJava.kind, 'hygiene');
  assert.equal(LANE_KINDS.lintJava.additive, false);
  assert.equal(LANE_KINDS.lintJava.actionable, false);
  assert.equal(LANE_KINDS.lintJava.why, 'not-a-vulnerability');
});

test('a real zero (files scanned, none flagged) is clean, not nosrc', () => {
  const r = run(readInto(EMPTY_FILES_JSON, 'some other log with no marker\n'));
  assert.equal(r.ran, true);
  assert.equal(r.total, 0);
  assert.equal(r.nosrc, undefined);
});

test('empty files[] PLUS the "No files to analyze" marker reads nosrc, never a clean zero', () => {
  const r = run(readInto(EMPTY_FILES_JSON, NOSRC_LOG));
  assert.equal(r.ran, true);
  assert.equal(r.nosrc, true);
  assert.equal(r.total, 0);
});

test('absent artifact is null, malformed JSON is unparseable — never a clean zero', () => {
  assert.equal(run(readInto(null)), null);
  const bad = run(readInto('{"not":"the right shape"}'));
  assert.equal(bad.unparseable, true);
  assert.equal(bad.total, 0);
});
