// monitor/test/clippy-extractor.test.mjs — the lintRust lane's first real reader.
//
// Until 2026-08-26 lintRust was wired to _unverifiedShape: any present clippy.json read as
// `unparseable`, which was correct while no parser had seen real output. The fixtures below are
// REAL fold products, generated on this box (cargo clippy --all-targets --message-format=json
// --offline -- -A clippy::all -W clippy::correctness -W clippy::suspicious, folded by the
// manifest's second command) from three scratch crates: one with lints, one that fails to
// compile, one clean. They are pasted verbatim, not hand-written — a fixture invented from
// documentation would re-create the defect the stub existed to prevent.
//
// The exit sidecar (clippy.json.exit) is the SECOND WITNESS and cannot share the parser's failure
// mode: severity comes only from parsing, tool health only from the sidecar. The one branch that
// composes them: non-zero exit with no clippy:: diagnostic = the compile died before the lint
// pass finished — toolfailed, never clean, whatever partial rustc errors it emitted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS, TOTALS_EXCLUDE } from '../extractors.mjs';

const spec = SCANNER_SPECS.find((s) => s[0] === 'lintRust');
assert.ok(spec, 'lintRust must be in SCANNER_SPECS');

function read(json, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-clippy-'));
  if (json !== null) writeFileSync(join(dir, 'clippy.json'), json);
  if (exit !== undefined) writeFileSync(join(dir, 'clippy.json.exit'), `${exit}\n`);
  return spec[2](dir);
}

// Real fold output: crate with 2 clippy lints (correctness+suspicious, both arrive at level
// `warning` because the command -W's them) and 2 rustc lints sharing the stream. Exit 0.
// Shared with monitor/lane-capability.mjs, which credits the lane from it as in-test evidence.
const REAL_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extractor-real');
const GOOD = readFileSync(join(REAL_OUTPUT, 'lintRust', 'clippy.json'), 'utf8');

// Real fold output: crate that does not compile. Exit was 101; E-code error plus a null-coded
// failure-note explanation line.
const BAD = `{
 "tool": "clippy",
 "diagnostics": [
  { "code": "E0425", "level": "error", "message": "cannot find type \`NoSuchType\` in this scope", "file": "src/main.rs", "line": 2 },
  { "code": null, "level": "failure-note", "message": "For more information about this error, try \`rustc --explain E0425\`.", "file": null, "line": null }
 ]
}`;

const CLEAN = `{
 "tool": "clippy",
 "diagnostics": []
}`;

test('a linted crate yields counted diagnostics with detail rows', () => {
  const c = read(GOOD, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 4);
  assert.equal(c.low, 4, 'warning maps to low');
  assert.equal(c.med, 0);
  assert.equal(c.unparseable, undefined, 'this is the branch the stub could never take');
  assert.equal(c.findings.length, 4);
  const rules = c.findings.map((r) => r.rule).sort();
  assert.ok(rules.includes('clippy::approx_constant') && rules.includes('unused_variables'),
    'clippy:: and rustc lints both keep their own codes');
});

test('a clean crate with exit 0 is a REAL zero — ran, no flags, no rows', () => {
  const c = read(CLEAN, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.nosrc, undefined, 'an empty diagnostics array from a completed run is a genuine clean lint, not an empty artifact');
  assert.equal(c.toolfailed, undefined);
});

test('compile failure reads toolfailed, never clean — partial rustc errors do not count', () => {
  const c = read(BAD, 101);
  assert.equal(c.toolfailed, true, 'non-zero exit with no clippy:: diagnostic = the lint pass never finished');
  assert.equal(c.total, 0, 'a run that died mid-compile publishes no counts');
});

test('the deny(warnings) shape: non-zero exit WITH clippy:: diagnostics still counts', () => {
  const deny = GOOD.replace('"level": "warning", "message": "this looks like', '"level": "error", "message": "this looks like');
  const c = read(deny, 101);
  assert.equal(c.toolfailed, undefined, 'the lint ran — repo-authored deny escalated its exit, not its health');
  assert.equal(c.total, 4);
  assert.equal(c.med, 1, 'error level maps to med');
  assert.equal(c.low, 3);
});

test('failure-note lines are explanations, not findings', () => {
  const c = read(BAD.replace('"level": "error"', '"level": "warning"'), 0);
  assert.equal(c.total, 1, 'the E-line counts; the null-coded failure-note does not');
});

test('absent artifact is null — the lane did not produce, and the category reads as a void', () => {
  assert.equal(read(null, undefined), null);
});

test('an empty file is nosrc; a truncated body is unparseable; a wrapperless body is unparseable', () => {
  assert.equal(read('', 0).nosrc, true);
  assert.equal(read('{ "tool": "clippy", "diagnos', 0).unparseable, true);
  assert.equal(read('[{"code":"clippy::x"}]', 0).unparseable, true,
    'the {tool,diagnostics} wrapper is the proof the fold ran — a bare stream must not read as counts');
});

test('a missing sidecar is a vintage artifact — the parse decides alone', () => {
  const c = read(GOOD, undefined);
  assert.equal(c.total, 4);
  assert.equal(c.toolfailed, undefined);
});

test('the lane stays hygiene and headline-excluded — a lint count must not wear a vulnerability verdict', () => {
  assert.equal(LANE_KINDS.lintRust.kind, 'hygiene');
  assert.equal(LANE_KINDS.lintRust.additive, false);
  assert.ok(TOTALS_EXCLUDE.includes('lintRust'), 'graduating the extractor must not move the headline arithmetic');
});
