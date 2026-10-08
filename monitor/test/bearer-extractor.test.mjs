// monitor/test/bearer-extractor.test.mjs — the sastBearer lane's first real reader.
//
// Until 2026-08-27 sastBearer was wired to _unverifiedShape, and the placeholder fixture guessed
// the shape as {"critical": [], "high": [], "medium": [], "low": []} — the probe showed a clean
// scan actually emits literally `{}` (bearer 2.1.1), which is exactly why fixtures are generated,
// never guessed: the guessed clean shape and the real one differ, and a parser written to the
// guess would have called the real clean scan unparseable.
//
// The findings-shape input is the GOLDEN FIXTURE (monitor/test/fixtures/lane-capability/
// sastBearer/bearer.json) — verbatim product of the manifest's exact command on a scratch JS
// project with PII-into-logs and string-built SQL planted, run on this box 2026-08-27. Bearer
// asserts its own severities (bucket keys), which the parser maps faithfully — unlike sobelow's
// confidence axis next door.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const spec = SCANNER_SPECS.find((s) => s[0] === 'sastBearer');
assert.ok(spec, 'sastBearer must be in SCANNER_SPECS');

const GOLDEN = readFileSync(join(HERE, 'fixtures', 'lane-capability', 'sastBearer', 'bearer.json'), 'utf8');

function read(json, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-bearer-'));
  if (json !== null) writeFileSync(join(dir, 'bearer.json'), json);
  if (exit !== undefined) writeFileSync(join(dir, 'bearer.json.exit'), `${exit}\n`);
  return spec[2](dir);
}

test('the golden artifact yields severity-mapped counts with detail rows', () => {
  const c = read(GOLDEN, 1);
  assert.equal(c.ran, true);
  assert.equal(c.total, 3);
  assert.equal(c.crit, 1, 'bearer critical maps to crit — the tool asserts severity, the parser carries it');
  assert.equal(c.med, 2);
  assert.equal(c.toolfailed, undefined, 'exit 1 is the findings-exist exit, measured — not a failure');
  const rules = c.findings.map((r) => r.rule);
  assert.ok(rules.includes('javascript_express_https_protocol_missing'), 'the rule id is the row rule');
  assert.ok(c.findings.every((r) => r.file && r.sev), 'rows carry file and severity');
});

test('the real clean shape is literally {} with exit 0 — a genuine zero', () => {
  const c = read('{}', 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 0);
  assert.equal(c.unparseable, undefined,
    'measured 2026-08-27: bearer emits an empty object for a clean scan, not empty buckets');
});

test('an exit outside {0,1} is the tool dying — toolfailed, never clean', () => {
  const c = read('{}', 2);
  assert.equal(c.toolfailed, true);
});

test('a valid-JSON body with no known bucket is a shape nobody verified — unparseable, never zero', () => {
  const c = read('{"results": [{"id": "x"}]}', 0);
  assert.equal(c.unparseable, true);
});

test('a warning bucket is informational — uncounted, the nuclei-info treatment', () => {
  const c = read('{"warning": [{"id": "w", "title": "t", "filename": "a.js", "line_number": 1}]}', 0);
  assert.equal(c.total, 0);
  assert.equal(c.unparseable, undefined, 'the bucket is known; its entries are just not findings');
});

test('absent artifact is null; an array body is unparseable', () => {
  assert.equal(read(null, undefined), null);
  assert.equal(read('[]', 0).unparseable, true);
});

test('a missing sidecar is a vintage artifact — the parse decides alone', () => {
  const c = read(GOLDEN, undefined);
  assert.equal(c.total, 3);
  assert.equal(c.toolfailed, undefined);
});

test('the lane is declared additive vulnerability — graduating the parser is what makes that declaration true', () => {
  assert.equal(LANE_KINDS.sastBearer.additive, true);
});
