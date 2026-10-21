// Formats a nuclei-solve adjudication result as a human-readable table (monitor/nuclei-solve.mjs formatTable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable } from '../nuclei-solve.mjs';

test('returns NOT ADJUDICATED message when result is null', () => {
  const expected = 'nuclei-solve: NOT ADJUDICATED \u2014 no result\n  (this is NOT "no findings". Nothing was judged, so nothing is claimed.)';
  assert.equal(formatTable(null), expected);
});

test('returns NOT ADJUDICATED message when ok is false with reason', () => {
  const r = { ok: false, reason: 'scan failed' };
  const expected = 'nuclei-solve: NOT ADJUDICATED \u2014 scan failed\n  (this is NOT "no findings". Nothing was judged, so nothing is claimed.)';
  assert.equal(formatTable(r), expected);
});

test('returns NOT ADJUDICATED message when ok is false without reason', () => {
  const r = { ok: false };
  const expected = 'nuclei-solve: NOT ADJUDICATED \u2014 no result\n  (this is NOT "no findings". Nothing was judged, so nothing is claimed.)';
  assert.equal(formatTable(r), expected);
});

test('formats a single confirmed record with one signal', () => {
  const r = {
    ok: true,
    records: [{ templateId: 'tpl1', port: 80, proto: 'tcp', confirmation: 'confirmed', signals: ['sig1'] }],
    total: 1,
    counts: { confirmed: 1, refuted: 0, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: []
  };
  const expected = '   1  tpl1  :80/tcp  CONFIRMED     sig1\n\n1 record(s): 1 confirmed \u00b7 0 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated';
  assert.equal(formatTable(r), expected);
});

test('aggregates duplicate templateId port proto into one row with incremented count', () => {
  const r = {
    ok: true,
    records: [
      { templateId: 'tpl1', port: 80, proto: 'tcp', confirmation: 'confirmed', signals: ['sig1'] },
      { templateId: 'tpl1', port: 80, proto: 'tcp', confirmation: 'confirmed', signals: ['sig2'] }
    ],
    total: 2,
    counts: { confirmed: 2, refuted: 0, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: []
  };
  const expected = '   2  tpl1  :80/tcp  CONFIRMED     sig1\n\n2 record(s): 2 confirmed \u00b7 0 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated';
  assert.equal(formatTable(r), expected);
});

test('sorts rows lexicographically by key when multiple distinct keys exist', () => {
  const r = {
    ok: true,
    records: [
      { templateId: 'zzz', port: 80, proto: 'tcp', confirmation: 'refuted', signals: [] },
      { templateId: 'aaa', port: 80, proto: 'tcp', confirmation: 'confirmed', signals: ['s1'] }
    ],
    total: 2,
    counts: { confirmed: 1, refuted: 1, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: []
  };
  const expected = '   1  aaa  :80/tcp  CONFIRMED     s1\n   1  zzz  :80/tcp  REFUTED       \u2014\n\n2 record(s): 1 confirmed \u00b7 1 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated';
  assert.equal(formatTable(r), expected);
});

test('appends CONSERVATION FAILED warning when conserved is false', () => {
  const r = {
    ok: true,
    records: [{ templateId: 't', port: 1, proto: 'udp', confirmation: 'undetermined', signals: [] }],
    total: 1,
    counts: { confirmed: 0, refuted: 0, undetermined: 1, unparseable: 0 },
    coverage: 0.5,
    conserved: false,
    uncited: []
  };
  const expected = '   1  t  :1/udp  UNDETERMINED  \u2014\n\n1 record(s): 0 confirmed \u00b7 0 refuted \u00b7 1 undetermined \u00b7 0 unparseable\ncoverage 50.0% adjudicated  ** CONSERVATION FAILED \u2014 records were lost **';
  assert.equal(formatTable(r), expected);
});

test('appends uncited refutation warning when uncited array is non-empty', () => {
  const r = {
    ok: true,
    records: [{ templateId: 't', port: 1, proto: 'tcp', confirmation: 'refuted', signals: [] }],
    total: 1,
    counts: { confirmed: 0, refuted: 1, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: ['ref1', 'ref2']
  };
  const expected = '   1  t  :1/tcp  REFUTED       \u2014\n\n1 record(s): 0 confirmed \u00b7 1 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated  ** 2 refutation(s) with no rule citation **';
  assert.equal(formatTable(r), expected);
});

test('joins multiple signals with plus separator', () => {
  const r = {
    ok: true,
    records: [{ templateId: 't', port: 443, proto: 'tcp', confirmation: 'confirmed', signals: ['a', 'b', 'c'] }],
    total: 1,
    counts: { confirmed: 1, refuted: 0, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: []
  };
  const expected = '   1  t  :443/tcp  CONFIRMED     a + b + c\n\n1 record(s): 1 confirmed \u00b7 0 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated';
  assert.equal(formatTable(r), expected);
});

test('uses em dash placeholder when signals array is empty', () => {
  const r = {
    ok: true,
    records: [{ templateId: 't', port: 22, proto: 'tcp', confirmation: 'refuted', signals: [] }],
    total: 1,
    counts: { confirmed: 0, refuted: 1, undetermined: 0, unparseable: 0 },
    coverage: 1.0,
    conserved: true,
    uncited: []
  };
  const expected = '   1  t  :22/tcp  REFUTED       \u2014\n\n1 record(s): 0 confirmed \u00b7 1 refuted \u00b7 0 undetermined \u00b7 0 unparseable\ncoverage 100.0% adjudicated';
  assert.equal(formatTable(r), expected);
});
