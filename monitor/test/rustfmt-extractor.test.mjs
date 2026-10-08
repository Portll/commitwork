// monitor/test/rustfmt-extractor.test.mjs — formatRust's reader and the scan that feeds it.
//
// Fixtures are REAL bin/rustfmt-lane-scan.mjs output, captured 2026-09-18 (rustfmt 1.9.0-stable)
// from scratch crates: an unformatted main.rs with no declaration; an unformatted lib.rs beside a
// main.rs with an unclosed delimiter; a formatted crate whose CI runs cargo fmt --check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const spec = SCANNER_SPECS.find((s) => s[0] === 'formatRust');
assert.ok(spec, 'formatRust must be in SCANNER_SPECS');
const run = spec[2];

function readInto(content, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-rustfmt-'));
  if (content !== null) writeFileSync(join(dir, 'rustfmt.json'), content);
  if (exit !== undefined) writeFileSync(join(dir, 'rustfmt.json.exit'), `${exit}\n`);
  return dir;
}

const VERSION = 'rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14)';
const UNDECLARED = JSON.stringify({ tool: 'rustfmt', version: VERSION, declared: null, roots: [{ root: '.', exit: 1, diffs: 1, counted: true }], partial: false, outsideRepo: 0, files: [{ file: 'src/main.rs', hunks: 1, firstLine: 1 }], parseErrors: [] });
const PARSE_ERROR = JSON.stringify({ tool: 'rustfmt', version: VERSION, declared: null, roots: [{ root: '.', exit: 1, diffs: 1, counted: true }], partial: true, outsideRepo: 0, files: [{ file: 'src/lib.rs', hunks: 1, firstLine: 1 }], parseErrors: [{ file: 'src/main.rs', message: 'error: this file contains an unclosed delimiter' }] });
const DECLARED_CLEAN = JSON.stringify({ tool: 'rustfmt', version: VERSION, declared: 'ci .github/workflows/ci.yml', roots: [{ root: '.', exit: 0, diffs: 0, counted: true }], partial: false, outsideRepo: 0, files: [], parseErrors: [] });

test('an undeclared repo reports deviations at low, one row per file', () => {
  const r = run(readInto(UNDECLARED));
  assert.equal(r.ran, true);
  assert.equal(r.total, 1);
  assert.equal(r.low, 1);
  assert.equal(r.findings[0].rule, 'rustfmt');
  assert.equal(r.findings[0].file, 'src/main.rs');
  assert.match(r.findings[0].message, /does not declare rustfmt/);
});

test('a declared repo reports at med, because its own CI fails on the same files', () => {
  const declared = JSON.parse(UNDECLARED);
  declared.declared = 'ci .github/workflows/ci.yml';
  const r = run(readInto(JSON.stringify(declared)));
  assert.equal(r.med, 1);
  assert.equal(r.low, 0);
  assert.match(r.findings[0].message, /gates on it \(ci \.github\/workflows\/ci\.yml\)/);
});

test('a parse error is its own row and marks the result partial', () => {
  const r = run(readInto(PARSE_ERROR));
  assert.equal(r.partial, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.findings.map((f) => f.rule).sort(), ['rustfmt', 'rustfmt/parse-error']);
});

test('a declared, formatted repo is a real zero', () => {
  const r = run(readInto(DECLARED_CLEAN));
  assert.equal(r.ran, true);
  assert.equal(r.total, 0);
  assert.equal(r.unparseable, undefined);
  assert.equal(r.partial, undefined);
});

test('absent is null; wrong shape is unparseable; empty with a tool-failure exit is toolfailed', () => {
  assert.equal(run(readInto(null)), null);
  assert.equal(run(readInto('{"tool":"clippy","diagnostics":[]}')).unparseable, true);
  assert.equal(run(readInto('', 127)).toolfailed, true);
});

test('formatRust is lane(H, not-a-vulnerability)', () => {
  assert.equal(LANE_KINDS.formatRust.kind, 'hygiene');
  assert.equal(LANE_KINDS.formatRust.additive, false);
  assert.equal(LANE_KINDS.formatRust.why, 'not-a-vulnerability');
});

const SCAN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'rustfmt-lane-scan.mjs');
const haveCargoFmt = spawnSync('cargo', ['fmt', '--version'], { encoding: 'utf8' }).status === 0;

// A symlinked root reproduces /tmp -> /private/tmp: before the scan canonicalised paths, every hunk
// resolved outside the root and veld at 90eaf22 reported zero files over 1,600 hunks.
test('the scan maps canonical diff paths back under a symlinked root', { skip: haveCargoFmt ? false : 'cargo fmt not installed' }, () => {
  const base = mkdtempSync(join(tmpdir(), 'cw-rustfmt-scan-'));
  const real = join(base, 'real');
  mkdirSync(join(real, 'src'), { recursive: true });
  writeFileSync(join(real, 'Cargo.toml'), '[package]\nname = "planted"\nversion = "0.1.0"\nedition = "2021"\n');
  writeFileSync(join(real, 'src', 'main.rs'), 'fn main(){let x=1;}\n');
  const link = join(base, 'link');
  symlinkSync(real, link);
  const out = join(base, 'rustfmt.json');
  const r = spawnSync(process.execPath, [SCAN, '--root', link, '--out', out, '--log', join(base, 'rustfmt.log')], { encoding: 'utf8' });
  assert.equal(r.status, 0, readFileSync(join(base, 'rustfmt.log'), 'utf8'));
  const j = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(j.outsideRepo, 0);
  assert.deepEqual(j.files.map((f) => f.file), ['src/main.rs']);
});

test('the scan refuses to write a report when no Cargo.toml exists', () => {
  const base = mkdtempSync(join(tmpdir(), 'cw-rustfmt-scan-'));
  const out = join(base, 'rustfmt.json');
  writeFileSync(out, '{"stale":true}');
  const r = spawnSync(process.execPath, [SCAN, '--root', base, '--out', out, '--log', join(base, 'rustfmt.log')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(existsSync(out), false);
});
