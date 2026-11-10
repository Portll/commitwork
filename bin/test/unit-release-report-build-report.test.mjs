// Computes a release report with second-opinion verdicts, exposure, and exit code (bin/release-report.mjs buildReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../release-report.mjs';

const baseCtx = {
  now: '2024-01-01T00:00:00.000Z',
  fresh: { state: 'fresh', ageDays: 0, maxDays: 7 },
  index: { advisories: {} },
  byCve: new Map(),
  kev: new Set(),
  kevAdded: new Map(),
  epssDoc: null,
};

const baseDoc = {
  product: 'test',
  generated_at: '2023-12-31T00:00:00.000Z',
  source: 'test',
  policy: { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5, verdict_max_age_hours: 24 },
  releases: [],
  events: [],
  serving: null,
};

const emptyVerdict = {
  status: 'clean',
  checked_at: '2023-12-30T00:00:00.000Z',
  blocking: [],
  findings: [],
  unchecked: { jsr: null, remote_hosts: null },
};

test('stale is false when age is exactly at the limit', () => {
  const doc = { ...baseDoc, generated_at: '2023-12-30T22:00:00.000Z' };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result, {
    schema: 'commitwork.release-report/1',
    product: 'test',
    evidence_generated_at: '2023-12-30T22:00:00.000Z',
    evaluated_at: '2024-01-01T00:00:00.000Z',
    source: 'test',
    policy: { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5, verdict_max_age_hours: 24 },
    evidence: { age_hours: 26, stale: false, limit_hours: 26 },
    kev: { state: 'fresh', ageDays: 0, maxDays: 7 },
    serving: null,
    rollback_eligible: [],
    history: [],
    timeline: [],
    exposure: { releases: [], totals: { blocked_exposure_seconds: 0, kev_exposure_seconds: 0 } },
    second_opinion: {
      performed: true,
      reason: null,
      findings_judged: 0,
      epss_sources: { commitwork: 0, box: 0, none: 0 },
      disagreements: [],
      kev_flag_differences: [],
    },
    not_covered: [],
    warnings: ['nothing is serving'],
    exit: { code: 0, reasons: [] },
  });
});

test('stale is true when age exceeds the limit', () => {
  const doc = { ...baseDoc, generated_at: '2023-12-30T21:59:00.000Z' };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result, {
    schema: 'commitwork.release-report/1',
    product: 'test',
    evidence_generated_at: '2023-12-30T21:59:00.000Z',
    evaluated_at: '2024-01-01T00:00:00.000Z',
    source: 'test',
    policy: { runtime_only: false, kev: false, critical: false, high_epss_min: 0.5, verdict_max_age_hours: 24 },
    evidence: { age_hours: 26.02, stale: true, limit_hours: 26 },
    kev: { state: 'fresh', ageDays: 0, maxDays: 7 },
    serving: null,
    rollback_eligible: [],
    history: [],
    timeline: [],
    exposure: { releases: [], totals: { blocked_exposure_seconds: 0, kev_exposure_seconds: 0 } },
    second_opinion: {
      performed: true,
      reason: null,
      findings_judged: 0,
      epss_sources: { commitwork: 0, box: 0, none: 0 },
      disagreements: [],
      kev_flag_differences: [],
    },
    not_covered: [],
    warnings: ['nothing is serving'],
    exit: { code: 4, reasons: ['evidence is 26.02 h old (limit 26 h)'] },
  });
});

test('epss source counts start at zero for none', () => {
  const doc = { ...baseDoc, generated_at: '2023-12-31T00:00:00.000Z' };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result.second_opinion.epss_sources, { commitwork: 0, box: 0, none: 0 });
});

test('exposure skips releases with no blocked evidence or kev hits', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [{ sha: 'abc123', state: 'kept', built_at: '2023-12-30T00:00:00.000Z', verdict: null }],
    events: [],
  };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result.exposure.releases, []);
});

test('exposure includes release with blocked event', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [{ sha: 'abc123', state: 'kept', built_at: '2023-12-30T00:00:00.000Z', verdict: null }],
    events: [
      { event: 'serving', sha: 'abc123', at: '2023-12-30T00:00:00.000Z' },
      { event: 'blocked', sha: 'abc123', at: '2023-12-30T01:00:00.000Z' },
    ],
    serving: 'abc123',
  };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result.exposure.releases.length, 1);
  assert.equal(result.exposure.releases[0].sha, 'abc123');
  assert.equal(result.exposure.releases[0].blocked_exposure_seconds, 82800);
});

test('eligible includes kept clean verdicts within age limit', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [{
      sha: 'abc123', state: 'kept', built_at: '2023-12-30T00:00:00.000Z',
      verdict: { ...emptyVerdict, status: 'clean' },
      verdict_at: '2023-12-30T12:00:00.000Z',
    }],
    events: [],
    serving: 'abc123',
  };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result.rollback_eligible, []);
});

test('serving release blocked by verdict status', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [{
      sha: 'abc123', state: 'kept', built_at: '2023-12-30T00:00:00.000Z',
      verdict: { ...emptyVerdict, status: 'blocked' },
      verdict_at: '2023-12-30T12:00:00.000Z',
    }],
    events: [{ event: 'serving', sha: 'abc123', at: '2023-12-30T00:00:00.000Z' }],
    serving: 'abc123',
  };
  const result = buildReport(doc, baseCtx);
  assert.equal(result.serving.blocked, true);
  assert.equal(result.exit.code, 1);
  assert.deepEqual(result.exit.reasons, ['the serving release is blocked']);
});

test('exit code is 0 when all is well', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [{
      sha: 'abc123', state: 'kept', built_at: '2023-12-30T00:00:00.000Z',
      verdict: { ...emptyVerdict, status: 'clean' },
      verdict_at: '2023-12-30T12:00:00.000Z',
    }],
    events: [{ event: 'serving', sha: 'abc123', at: '2023-12-30T00:00:00.000Z' }],
    serving: 'abc123',
  };
  const result = buildReport(doc, baseCtx);
  assert.equal(result.exit.code, 0);
  assert.deepEqual(result.exit.reasons, []);
});

test('warning added when last serving sha differs from doc.serving', () => {
  const doc = {
    ...baseDoc,
    generated_at: '2023-12-31T00:00:00.000Z',
    releases: [
      { sha: 'aaa111', state: 'kept', built_at: '2023-12-30T00:00:00.000Z', verdict: null },
      { sha: 'bbb222', state: 'kept', built_at: '2023-12-30T00:00:00.000Z', verdict: null },
    ],
    events: [
      { event: 'serving', sha: 'aaa111', at: '2023-12-30T00:00:00.000Z' },
      { event: 'serving', sha: 'bbb222', at: '2023-12-30T01:00:00.000Z' },
    ],
    serving: 'aaa111',
  };
  const result = buildReport(doc, baseCtx);
  assert.deepEqual(result.warnings, [
    'events say bbb222 served last but the document names aaa111',
    'the serving release has no verdict: nothing about it was checked',
  ]);
});
