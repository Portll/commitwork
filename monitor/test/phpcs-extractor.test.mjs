// monitor/test/phpcs-extractor.test.mjs — sastPhp's first real reader.
//
// Fixture is REAL captured output (2026-09-01): PHP_CodeSniffer 4.0.4 + the pheromone/phpcs-
// security-audit ruleset, run against a scratch PHP file with a dynamic mysqli query, an eval(),
// and an unescaped $_GET echo. Pasted verbatim, not hand-written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const spec = SCANNER_SPECS.find((s) => s[0] === 'sastPhp');
assert.ok(spec, 'sastPhp must be in SCANNER_SPECS');
const run = spec[2];

function readInto(content) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-phpcs-'));
  if (content !== null) writeFileSync(join(dir, 'phpcs.json'), content);
  return dir;
}

// REAL, captured 2026-09-01: phpcs --report=json --standard=phpcs-security-audit/Security against
// /tmp/cw-tools/fixture-php/vuln.php ($id=$_GET['id']; mysqli_query with string concat; eval($_POST
// ['code']); echo $_GET['name']).
// Shared with monitor/lane-capability.mjs, which credits the lane from it as in-test evidence.
const REAL_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extractor-real');
const PHPCS_JSON = readFileSync(join(REAL_OUTPUT, 'sastPhp', 'phpcs.json'), 'utf8');

test('type (ERROR/WARNING) decides severity — the ruleset\'s own numeric severity is not trusted', () => {
  const r = run(readInto(PHPCS_JSON));
  assert.equal(r.ran, true);
  assert.equal(r.total, 3);
  assert.equal(r.high, 2, 'the two ERROR-type findings (NoEvals, EasyXSS)');
  assert.equal(r.med, 1, 'the one WARNING-type finding (dynamic mysqli param)');
});

test('rule is the dotted source id; file/line come from the files map key + message', () => {
  const rows = run(readInto(PHPCS_JSON)).findings;
  const evalRow = rows.find((r) => r.rule === 'Security.BadFunctions.NoEvals.NoEvals');
  assert.ok(evalRow);
  assert.equal(evalRow.file, '/private/tmp/cw-tools/fixture-php/vuln.php');
  assert.equal(evalRow.line, 5);
  assert.match(evalRow.message, /do not use eval/);
});

test('no cwe field — the ruleset ships no CWE mapping and none is invented', () => {
  const row = run(readInto(PHPCS_JSON)).findings[0];
  assert.equal('cwe' in row, false);
});

test('sastPhp is lane(V) — a real vulnerability lane, additive', () => {
  assert.equal(LANE_KINDS.sastPhp.kind, 'vulnerability');
  assert.equal(LANE_KINDS.sastPhp.additive, true);
  assert.equal(LANE_KINDS.sastPhp.actionable, true);
});

test('a file with zero messages contributes zero, not a missing row', () => {
  const clean = '{"totals":{"errors":0,"warnings":0,"fixable":0},"files":{"clean.php":{"errors":0,"warnings":0,"messages":[]}}}';
  const r = run(readInto(clean));
  assert.equal(r.ran, true);
  assert.equal(r.total, 0);
});

test('absent artifact is null, malformed JSON is unparseable — never a clean zero', () => {
  assert.equal(run(readInto(null)), null);
  const bad = run(readInto('{"not":"the right shape"}'));
  assert.equal(bad.unparseable, true);
  assert.equal(bad.total, 0);
});
