// monitor/test/joern-extractor.test.mjs — the sastJoern lane's first real reader.
//
// Until 2026-08-27 sastJoern was wired to _unverifiedShape, and its check promised an artifact
// that CANNOT EXIST: joern-scan 4.0.610 has no --format option — the original command produced
// 'Error: Unknown option --format' AND EXITED 0, leaving a one-line husk. That husk is the reason
// for the scan-ran guard this file exercises: without it, a zero-Result artifact from a scan that
// never ran would read as a clean repository — the F8 silent-green shape.
//
// The findings-shape input is the GOLDEN FIXTURE itself (monitor/test/fixtures/lane-capability/
// sastJoern/joern.txt) — the verbatim product of the manifest's exact command on a scratch C
// source with gets()/strcpy/system/printf(argv) planted, run on this box 2026-08-27. The other
// shapes below are pasted verbatim from the same probe session, not hand-written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = SCANNER_SPECS.find((s) => s[0] === 'sastJoern');
assert.ok(spec, 'sastJoern must be in SCANNER_SPECS');

const GOLDEN = readFileSync(join(HERE, 'fixtures', 'lane-capability', 'sastJoern', 'joern.txt'), 'utf8');

function read(txt, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-joern-'));
  if (txt !== null) writeFileSync(join(dir, 'joern.txt'), txt);
  if (exit !== undefined) writeFileSync(join(dir, 'joern.txt.exit'), `${exit}\n`);
  return spec[2](dir);
}

// The real husk (verbatim, 2026-08-27): what `--format json` left behind — stdout's only line,
// exit 0. The scan never ran; no ScanPass marker, no Result lines.
const HUSK = 'Writing logs to: /tmp/joern-scan-log.txt\n';

// Real clean-run evidence line (verbatim from a scan of lint-free sources, same probe session):
// the ScanPass marker present, zero Result lines.
const CLEAN = `Writing logs to: /tmp/joern-scan-log.txt
[INFO ] Start of pass: io.joern.console.scan.ScanPass
[INFO ] Pass io.joern.console.scan.ScanPass completed in 35 ms (2% on mutations). 0 + 0 changes committed from 1 parts.
Run \`joern --for-input-path /tmp/clean-fix\` to explore interactively
`;

test('the golden artifact yields banded counts with detail rows', () => {
  const c = read(GOLDEN, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 3);
  assert.equal(c.high, 1, 'gets() at score 8.0 bands high');
  assert.equal(c.med, 1, 'non-constant printf format at 4.0 bands med');
  assert.equal(c.low, 1, 'unchecked read/recv/malloc at 3.0 bands low');
  assert.equal(c.crit, 0, 'no query in the golden run reaches the >=9 band');
  assert.equal(c.unparseable, undefined, 'this is the branch the stub could never take');
  const rules = c.findings.map((r) => r.rule);
  assert.ok(rules.includes('Dangerous function gets() used'), 'the query title is the rule — joern-scan names no id');
  assert.ok(c.findings.every((r) => r.file === 'main.c'), 'file parsed from the Result line tail');
});

test('a clean scan WITH scan-ran evidence is a real zero', () => {
  const c = read(CLEAN, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.unparseable, undefined, 'ScanPass completed is the proof the scan ran');
  assert.equal(c.toolfailed, undefined);
});

test('the measured husk reads unparseable, never clean — exit 0 does not vouch for a scan that never ran', () => {
  const c = read(HUSK, 0);
  assert.equal(c.unparseable, true,
    'no ScanPass marker and no Result line: publishing zero here would be the F8 silent green the guard exists for');
  assert.equal(c.total, 0);
});

test('a scanless artifact with non-zero exit is toolfailed', () => {
  const c = read(HUSK, 1);
  assert.equal(c.toolfailed, true);
});

// The FLEET shape the scratch fixture did not have (memory-layer, first real sweep, 2026-08-28, verbatim
// excerpt): joern picked its rust frontend and Homebrew joern 4.0.610 ships no
// rust_ast_gen-macos-arm, so the CPG build died — and joern-scan STILL EXITED 0, the second
// measured case of its exit code lying. The error marker is the witness the exit refuses to be.
const FRONTEND_FAIL = `Writing logs to: /tmp/joern-scan-log.txt
[ERROR] Process exited with code 1.
Output: WARNING: A terminally deprecated method in sun.misc.Unsafe has been called
2026-08-28 02:49:42.551 WARN  AstGenRunner              File '/opt/homebrew/Cellar/joern/4.0.610/bin/astgen/rust_ast_gen-macos-arm' does not exist.
2026-08-28 02:49:42.554 ERROR AstGenRunner              Local rust_ast_gen binary not found at '/opt/homebrew/Cellar/joern/4.0.610/bin/astgen/rust_ast_gen-macos-arm' or is not executable!
Please make sure to have a compatible rust_ast_gen version installed and available on this system.
`;

test('a failed CPG frontend with exit 0 is toolfailed — the error marker outvotes the lying exit code', () => {
  const c = read(FRONTEND_FAIL, 0);
  assert.equal(c.toolfailed, true,
    'measured on memory-layer: rust2cpg died, joern-scan exited 0, and unparseable would misfile a broken tool as an unverified shape');
  assert.equal(c.total, 0);
});

test('absent artifact is null — the lane did not produce, and the category reads as a void', () => {
  assert.equal(read(null, undefined), null);
});

test('an empty file is nosrc; a Result line the shape does not fit is skipped, never guessed', () => {
  assert.equal(read('', 0).nosrc, true);
  const c = read(CLEAN.replace('Run `joern', 'Result: weird line with no location\nRun `joern'), 0);
  assert.equal(c.total, 0, 'an unshaped Result line contributes nothing rather than a guessed row');
});

test('a missing sidecar is a vintage artifact — the parse decides alone', () => {
  const c = read(GOLDEN, undefined);
  assert.equal(c.total, 3);
  assert.equal(c.toolfailed, undefined);
});

test('the lane is declared additive vulnerability — graduating the parser is what makes that declaration true', () => {
  assert.equal(LANE_KINDS.sastJoern.additive, true);
});

// ── duplicate Result lines (measured 2026-09-01) ────────────────────────────────────────────────
// joern-scan emits BYTE-IDENTICAL Result lines for one defect when several bundle queries match the
// same call. Verbatim from a real run: five lines, three defects. Counting the emitted lines
// overstated `total` by 67% on this sample, and put the duplicate in the detail rows twice — a
// published number a reader can check, which is the one place this fleet cannot afford to be loose.
const DUPES = [
  'Result: 4.0 : Non-constant format string passed to printf/sprintf/vsprintf: vuln.c:3:bad',
  'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: src/real.c:2:real',
  'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: vuln.c:3:bad',
  'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: src/real.c:2:real',
  'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: vuln.c:3:bad',
  'Run `joern --for-input-path /tmp/x` to explore interactively',
].join('\n');

test('byte-identical Result lines are ONE defect the tool said twice, not two findings', () => {
  const c = read(DUPES, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 3, 'five emitted lines carry three distinct defects');
  assert.equal(c.med, 3);
  const rows = c.detail || c.findings || [];
  assert.equal(rows.length, 3, 'the duplicate must not appear twice in the detail rows either');
  const keys = rows.map((r) => `${r.rule}|${r.file}|${r.line}`);
  assert.equal(new Set(keys).size, keys.length, 'detail rows still contain a duplicate');
});

test('dedupe collapses only IDENTICAL lines — a same-rule hit elsewhere is its own finding', () => {
  // the guard against over-collapsing: same rule and score, different location, must stay two.
  const two = [
    'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: a.c:2:f',
    'Result: 4.0 : Dangerous functions `strcpy` or `strncpy` used: b.c:9:g',
    'Run `joern --for-input-path /tmp/x` to explore interactively',
  ].join('\n');
  assert.equal(read(two, 0).total, 2, 'two distinct locations collapsed into one');
});
