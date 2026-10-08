// A human's adjudication of a SCANNER row must reach the issue, not stop at the rollup.
//
// `annotations[]` (dependency waivers) has had a path into the issue store since it existed.
// `scannerAnnotations[]` — the array the panel's Mark-FP writes, and the one an operator actually
// uses on a scanner finding — did not. The row vanished from the rollup and the issue went on
// asserting a problem a person had already answered.
//
// Measured over the live store on 2026-08-26 before the fix: 14 of 600 open scanner issues carried
// an ACTIVE false-positive adjudication, among them the deliberately-planted canary credentials in
// bin/secrets-canary.mjs and bin/test/secrets-sweep.test.mjs — filed `high`, dismissed by a person,
// still counted open.
//
// Every case here is a PAIR differing in one fact, because a test that only fed a matching
// annotation would pass whether or not the matcher discriminated.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ingestArea } from '../issue-ingest.mjs';

const AT = '2026-08-26T00:00:00.000Z';

// `scanners` carries the run provenance ingestArea gates on: a category with no successful run
// files nothing, so a rollup that merely CONTAINS rows is not enough. Feeding it is not a
// workaround — it is the fixture matching what a real sweep emits.
const rollupWith = (rows) => ({
  sliceId: 'sweep-20260826000000',
  generated: AT,
  scanners: { secrets: { ran: 1, skipped: 0, noscan: 0, check: 'secrets' } },
  scannerFindings: { secrets: rows },
});

const ROW = {
  repo: 'app', rule: 'generic-api-key', file: 'evidence/quoted.json', line: 12,
  sev: 'high', message: 'a snippet quoting source',
};

const ANN = {
  category: 'secrets', repo: 'app', rule: 'generic-api-key', file: 'evidence/quoted.json',
  action: 'false-positive', reason: 'evidence snippet, not key material',
  who: 'operator', at: '2026-08-25T00:00:00.000Z', expires: '2027-01-01T00:00:00.000Z',
};

const ingest = (scannerAnnotations, at = AT) => {
  const doc = { version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} };
  ingestArea(doc, {
    areaSlug: 'app', rollup: rollupWith([ROW]), now: at, minSev: 'high',
    scannerAnnotations, staleHours: 24 * 365 * 10,
  });
  const iss = Object.values(doc.issues)[0];
  return { doc, iss };
};

describe('a scanner-row adjudication reaches the issue', () => {
  test('with NO annotation the issue is open and unwaived', () => {
    const { iss } = ingest([]);
    assert.ok(iss, 'the fixture must file an issue, or the pair below proves nothing');
    assert.equal(iss.state, 'open');
    assert.ok(!iss.waiver, 'no annotation must mean no waiver');
  });

  test('with a matching annotation the SAME issue carries a waiver', () => {
    const { iss } = ingest([ANN]);
    assert.ok(iss);
    assert.ok(iss.waiver, 'the adjudication must reach the issue, not stop at the rollup');
    assert.equal(iss.waiver.action, 'false-positive');
    assert.equal(iss.waiver.who, 'operator');
    assert.equal(iss.waiver.expiresAt, '2027-01-01T00:00:00.000Z');
  });

  test('and it is a WAIVER, never a close — a suppression is not evidence of repair', () => {
    const { iss } = ingest([ANN]);
    assert.equal(iss.state, 'open',
      'closing on an annotation would let a dismissal masquerade as a fix; the auto-close table is '
      + 'evidence-gated on purpose');
  });
});

describe('the matcher discriminates', () => {
  test('a different FILE does not waive — identity is (rule, file), not rule alone', () => {
    const { iss } = ingest([{ ...ANN, file: 'somewhere/else.json' }]);
    assert.ok(!iss.waiver, 'no annotation must mean no waiver');
  });

  test('a different RULE does not waive', () => {
    const { iss } = ingest([{ ...ANN, rule: 'aws-access-token' }]);
    assert.ok(!iss.waiver, 'no annotation must mean no waiver');
  });

  test('a different REPO does not waive', () => {
    const { iss } = ingest([{ ...ANN, repo: 'other' }]);
    assert.ok(!iss.waiver, 'no annotation must mean no waiver');
  });

  test('a non-suppressing action (note) does not waive', () => {
    const { iss } = ingest([{ ...ANN, action: 'note' }]);
    assert.ok(!iss.waiver,
      'a note records an observation and drops nothing — only SUPPRESSING_ACTIONS waive');
  });
});

describe('a waiver expires with its annotation', () => {
  test('an annotation already past its expires does not waive', () => {
    const { iss } = ingest([{ ...ANN, expires: '2026-08-01T00:00:00.000Z' }]);
    assert.ok(!iss.waiver,
      'an expiry that does not expire anything is decoration — class E2, suppression outliving its '
      + 'judgement');
  });

  test('an annotation dated in the FUTURE does not waive yet', () => {
    const { iss } = ingest([{ ...ANN, at: '2026-12-01T00:00:00.000Z' }]);
    assert.ok(!iss.waiver, 'an annotation not yet in force waives nothing');
  });

  test('a waiver set on one run is CLEARED when the annotation stops matching', () => {
    // Same doc, two ingests: the second sees no annotation. The waiver must go with it.
    const doc = { version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} };
    const opts = {
      areaSlug: 'app', rollup: rollupWith([ROW]), now: AT, minSev: 'high', staleHours: 24 * 365 * 10,
    };
    ingestArea(doc, { ...opts, scannerAnnotations: [ANN] });
    const id = Object.keys(doc.issues)[0];
    assert.ok(doc.issues[id].waiver, 'precondition: the first ingest set a waiver');

    ingestArea(doc, {
      ...opts,
      rollup: { ...rollupWith([ROW]), sliceId: 'sweep-20260827000000', generated: '2026-08-27T00:00:00.000Z' },
      now: '2026-08-27T00:00:00.000Z',
      scannerAnnotations: [],
    });
    assert.ok(!doc.issues[id].waiver,
      'a revoked adjudication must take its waiver with it, or the first one is permanent');
  });
});

describe('it does not disturb the dependency waiver path', () => {
  test('an issue with no scanner waiver keeps a foreign `waiver` object untouched', () => {
    const doc = { version: 1, nextOrdinal: 0, byKey: {}, events: [], issues: {}, lastIngest: {} };
    const opts = {
      areaSlug: 'app', rollup: rollupWith([ROW]), now: AT, minSev: 'high', staleHours: 24 * 365 * 10,
    };
    ingestArea(doc, { ...opts, scannerAnnotations: [] });
    const id = Object.keys(doc.issues)[0];
    // A dependency-shaped waiver carries no `action` — the clear path must leave it alone.
    doc.issues[id].waiver = { annotationId: 'CVE-2026-1', expiresAt: null };
    ingestArea(doc, {
      ...opts,
      rollup: { ...rollupWith([ROW]), sliceId: 'sweep-20260827000000', generated: '2026-08-27T00:00:00.000Z' },
      now: '2026-08-27T00:00:00.000Z',
      scannerAnnotations: [],
    });
    assert.deepEqual(doc.issues[id].waiver, { annotationId: 'CVE-2026-1', expiresAt: null });
  });
});
