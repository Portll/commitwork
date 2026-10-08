// monitor/test/hlint-extractor.test.mjs — the lintHaskell lane's first real reader, and the last
// stub graduation. Fixtures are REAL hlint --json output generated on this box (2026-08-27), not
// shapes imagined from documentation — including the crash shape the probe exposed: hlint on a
// tree with no Haskell sources does not print [], it throws, and the exception prose lands in
// hlint.json via the redirect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS, TOTALS_EXCLUDE } from '../extractors.mjs';

const spec = SCANNER_SPECS.find((s) => s[0] === 'lintHaskell');
assert.ok(spec, 'lintHaskell must be in SCANNER_SPECS');

function read(body, exit) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-hlint-'));
  if (body !== null) writeFileSync(join(dir, 'hlint.json'), body);
  if (exit !== undefined) writeFileSync(join(dir, 'hlint.json.exit'), `${exit}\n`);
  return spec[2](dir);
}

// Real output: one Warning (concatMap) + one Suggestion (null) from a scratch Main.hs.
// Shared with monitor/lane-capability.mjs, which credits the lane from it as in-test evidence.
const REAL_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extractor-real');
const REAL = readFileSync(join(REAL_OUTPUT, 'lintHaskell', 'hlint.json'), 'utf8');

test('real hints count, at lint severities, with detail rows keyed on hint+file', () => {
  const c = read(REAL, 0);
  assert.equal(c.ran, true);
  assert.equal(c.total, 2);
  assert.equal(c.low, 2, 'Warning and Suggestion both map low');
  assert.equal(c.med, 0);
  assert.equal(c.findings.length, 2);
  assert.equal(c.findings[0].file, 'Main.hs', 'the ./ prefix is stripped');
  assert.match(c.findings.find((r) => r.rule === 'Use null').message, /length xs == 0 ⇒ null xs/);
});

test('an hlint Error maps med — and no higher; the lane stays out of the headline regardless', () => {
  const c = read(REAL.replace('"severity":"Warning"', '"severity":"Error"'), 0);
  assert.equal(c.med, 1);
  assert.equal(c.low, 1);
  assert.equal(LANE_KINDS.lintHaskell.kind, 'hygiene');
  assert.ok(TOTALS_EXCLUDE.includes('lintHaskell'));
});

test('THE CRASH SHAPE the probe exposed: exception prose + exit 1 is toolfailed, never clean', () => {
  const c = read('hlint: Uncaught exception ghc-internal:GHC.Internal.Exception.ErrorCall:\n', 1);
  assert.equal(c.toolfailed, true);
  assert.equal(c.total, 0);
});

test('prose with a ZERO exit is still not a result — unparseable, undetermined', () => {
  const c = read('not json at all', 0);
  assert.equal(c.unparseable, true);
});

test('a clean run over real sources is a real zero; a non-zero exit with no hints is not', () => {
  assert.equal(read('[]', 0).total, 0);
  assert.equal(read('[]', 0).toolfailed, undefined);
  assert.equal(read('[]', 1).toolfailed, true, 'the sidecar is the second witness and cannot be outvoted by an empty array');
});

test('absent is null; empty body is nosrc; a non-array JSON body is unparseable', () => {
  assert.equal(read(null, undefined), null);
  assert.equal(read('', 0).nosrc, true);
  assert.equal(read('{"hints":[]}', 0).unparseable, true, 'hlint --json emits an ARRAY; any other shape is not its output');
});
