// monitor/test/sobelow-extractor.test.mjs — the sastElixir lane's first real reader.
//
// Until 2026-08-27 sastElixir was wired to _unverifiedShape. The probe that graduated it exposed
// a fleet-shaped trap the documentation never named: `mix sobelow --format json` calls
// Jason.encode!, and Jason comes from the SCANNED PROJECT's built deps — which this fleet never
// builds (deps.get executes package code). Without a jason archive on the scanning box, sobelow
// COMPLETES ITS SCAN and then crashes encoding: empty artifact, exit 1, the findings visible only
// as inspect-format wreckage in the log. That is the toolfailed branch below. Box prep:
// `mix archive.install hex jason` (done here 2026-08-27; the check's notes carry it).
//
// The findings-shape input is the GOLDEN FIXTURE (monitor/test/fixtures/lane-capability/
// sastElixir/sobelow.json) — verbatim product of the manifest's exact command on a scratch
// Phoenix skeleton with a hardcoded secret, string-built SQL, String.to_atom, send_file traversal
// and raw XSS planted, run on this box 2026-08-27 (sobelow 0.15.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = SCANNER_SPECS.find((s) => s[0] === 'sastElixir');
assert.ok(spec, 'sastElixir must be in SCANNER_SPECS');

const GOLDEN = readFileSync(join(HERE, 'fixtures', 'lane-capability', 'sastElixir', 'sobelow.json'), 'utf8');

// Real clean shape (verbatim, same probe session, vuln-free skeleton): the wrapper survives with
// empty buckets and total_findings 0 — unlike bearer, whose clean shape collapses to {}.
const CLEAN = `{
  "findings": {
    "high_confidence": [],
    "low_confidence": [],
    "medium_confidence": []
  },
  "sobelow_version": "0.15.0",
  "total_findings": 0
}`;

function read(json, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sobelow-'));
  if (json !== null) writeFileSync(join(dir, 'sobelow.json'), json);
  if (exit !== undefined) writeFileSync(join(dir, 'sobelow.json.exit'), `${exit}\n`);
  return spec[2](dir);
}

test('the golden artifact yields confidence-capped counts with detail rows', () => {
  const c = read(GOLDEN, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 6);
  assert.equal(c.med, 1, 'high_confidence caps at med — sobelow asserts confidence, not impact');
  assert.equal(c.low, 5);
  assert.equal(c.high, 0, 'a confidence axis must never mint high/crit — likelihood dressed as impact is the GuardDog defect');
  assert.equal(c.crit, 0);
  const rules = c.findings.map((r) => r.rule);
  assert.ok(rules.includes('Config.Secrets: Hardcoded Secret'), 'the class string is the rule');
});

test('a clean scan keeps its wrapper — a real zero, not an empty artifact', () => {
  const c = read(CLEAN, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.unparseable, undefined);
});

test('the measured Jason-crash shape: empty artifact + non-zero exit is toolfailed, never clean', () => {
  const c = read('', 1);
  assert.equal(c.toolfailed, true,
    'the scan finished and the encode died — nothing was written, and a zero here would be silent green');
});

test('an empty artifact with exit 0 is a shape no probe has produced — unparseable', () => {
  assert.equal(read('', 0).unparseable, true);
});

test('a wrapperless body is unparseable — {findings, total_findings} is the proof sobelow finished', () => {
  assert.equal(read('{"high_confidence": []}', 0).unparseable, true);
  assert.equal(read('{"findings": {}}', 0).unparseable, true, 'findings without total_findings is not the measured wrapper');
});

test('a non-zero exit WITH a valid wrapper still counts — the scan finished; something after it failed', () => {
  const c = read(GOLDEN, 1);
  assert.equal(c.toolfailed, undefined);
  assert.equal(c.total, 6);
});

test('absent artifact is null — the lane did not produce, and the category reads as a void', () => {
  assert.equal(read(null, undefined), null);
});

test('the lane is declared additive vulnerability — graduating the parser is what makes that declaration true', () => {
  assert.equal(LANE_KINDS.sastElixir.additive, true);
});
