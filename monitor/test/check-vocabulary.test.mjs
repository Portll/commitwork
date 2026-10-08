// monitor/test/check-vocabulary.test.mjs — the canon has importers, and the axes stay apart.
//
// T2 asked for a canonical check-status vocabulary; T3 asked for it to be wired. They ship together
// on purpose. This repo already has the counter-example: monitor/schema/status-enum.json declares a
// vocabulary and NOTHING imports it, so it holds nothing to anything — a canon with no importers is
// a comment with a filename. Landing T2 without T3 would have produced a second one.
//
// So the load-bearing assertion here is not "the enum lists four strings". It is that the module is
// IMPORTED, that the two axes are not collapsed into one, and that the two places where a value
// becomes durable — the checks-status wire and classifyReport's return — are held to it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_STATUS, SEVERITY, VOID_STATUS, isCheckStatus, isSeverity, toWireStatus } from '../check-vocabulary.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CW_SRC = readFileSync(join(REPO, 'bin', 'commitwork.mjs'), 'utf8');
const SLICE_SCHEMA = readFileSync(join(REPO, 'schema', 'slice.schema.json'), 'utf8');

describe('the two axes are declared, and declared apart', () => {
  test('check status is the runner axis', () => {
    assert.deepEqual([...CHECK_STATUS], ['pass', 'fail', 'skip', 'noscan']);
  });

  test('severity is the findings axis and keeps its gradation', () => {
    assert.ok(SEVERITY.includes('med') && SEVERITY.includes('high'),
      'collapsing med/high into `fail` would flatten a three-level gradation into a boolean');
    assert.ok(!SEVERITY.includes('fail'),
      '`fail` is a run outcome, not a severity — putting it here is the collapse this module exists to prevent');
    assert.ok(!CHECK_STATUS.includes('ok') && !CHECK_STATUS.includes('high'),
      'severities are not run outcomes');
  });

  test('skip and noscan appear on BOTH axes deliberately', () => {
    for (const s of ['skip', 'noscan']) {
      assert.ok(CHECK_STATUS.includes(s) && SEVERITY.includes(s),
        `${s} is simultaneously a run outcome and an absence of findings — that is why it is on both`);
    }
  });

  test('a skip is not a void — only noscan is', () => {
    assert.deepEqual([...VOID_STATUS], ['noscan'],
      'a check that correctly did not apply is a correct exclusion, not a coverage gap');
    assert.ok(!VOID_STATUS.includes('skip'));
  });

  test('the sets are frozen, so a consumer cannot quietly widen the vocabulary', () => {
    assert.ok(Object.isFrozen(CHECK_STATUS) && Object.isFrozen(SEVERITY) && Object.isFrozen(VOID_STATUS));
  });

  test('coverage is deliberately NOT here', () => {
    for (const v of ['full', 'reduced', 'unknown']) {
      assert.ok(!CHECK_STATUS.includes(v) && !SEVERITY.includes(v),
        `${v} is lane coverage, a third axis — putting it on either of these is the collapse the coverage work spent T5 avoiding`);
    }
  });
});

describe('predicates and the wire spelling', () => {
  test('membership is exact', () => {
    assert.ok(isCheckStatus('noscan') && !isCheckStatus('skipped') && !isCheckStatus('ok'));
    assert.ok(isSeverity('high') && !isSeverity('fail') && !isSeverity(undefined));
  });

  test('the runner says `skipped`, the wire says `skip`, and the conversion is named', () => {
    assert.equal(toWireStatus('skipped'), 'skip');
    assert.equal(toWireStatus('pass'), 'pass');
    assert.ok(!CHECK_STATUS.includes('skipped'),
      'the wire spelling is the canon; `skipped` is an in-memory detail that must not reach a consumer');
  });
});

describe('THE CANON HAS IMPORTERS — the assertion that makes it a canon', () => {
  test('bin/commitwork.mjs imports it', () => {
    assert.match(CW_SRC, /from '\.\.\/monitor\/check-vocabulary\.mjs'/,
      'status-enum.json is this repo\'s case study in a canon nothing imports; this must not become the second');
  });

  test('the checks-status wire is held to CHECK_STATUS', () => {
    assert.match(CW_SRC, /const wire = toWireStatus\(r\.status\);/);
    assert.match(CW_SRC, /if \(!isCheckStatus\(wire\)\)/,
      'this is the one place a status becomes durable and readable by thirteen consumers');
  });

  test('classifyReport is held to SEVERITY at its exit', () => {
    assert.match(CW_SRC, /if \(!isSeverity\(sev\)\)/,
      'a severity nobody declared is a word three surfaces must each guess the meaning of');
  });

  test('the enforcement is LOUD but never destroys provenance', () => {
    // Losing a row is worse than carrying an odd status: a missing checks-status entry reads as
    // "never ran", which is the false-clean this whole subsystem exists to refuse.
    const w = CW_SRC.slice(CW_SRC.indexOf('const wire = toWireStatus'), CW_SRC.indexOf('const wire = toWireStatus') + 600);
    assert.match(w, /console\.error/, 'drift must be reported');
    assert.doesNotMatch(w, /throw |process\.exit|return;/,
      'and must not drop the row — losing provenance would turn a vocabulary bug into a false clean');
  });

  test('the schema description points at the module rather than restating it as authority', () => {
    assert.match(SLICE_SCHEMA, /THE AUTHORITY FOR THIS ENUM IS monitor\/check-vocabulary\.mjs/,
      'slice.schema.json spells the enum out in prose no validator enforces — the third home, now subordinated');
  });
});
