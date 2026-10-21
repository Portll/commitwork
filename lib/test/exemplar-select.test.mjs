// node --test lib/test/exemplar-select.test.mjs — selectExemplars is the only place a past
// adjudication travels into a future prompt: determinism, human-tier filter, refuted-record
// exclusion, and the token cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkForIssue, selectExemplars, formatExemplarBlock, EXEMPLAR_CHAR_BUDGET,
} from '../exemplar-select.mjs';

const rec = (over) => ({
  v: 1, kind: 'finding-adjudication', category: 'sastSemgrep', repo: 'commitwork',
  findingKey: 'sastSemgrep|commitwork|js/code-injection|admin/serve.mjs',
  machineVerdict: 'real-vulnerability', humanVerdict: 'false-positive', truth: 'false-alarm',
  model: null, promptId: null, bornSlice: null,
  at: '2026-08-01T00:00:00.000Z',
  ...over,
});

// ── checkForIssue ──────────────────────────────────────────────────────────────────────────────
test('checkForIssue reads the category out of a scanner-row source key', () => {
  assert.equal(checkForIssue({ source: { key: 'sc:commitwork|sastSemgrep|js/code-injection|admin/serve.mjs|12' } }), 'sastSemgrep');
});
test('checkForIssue reads the category out of a scanner GROUP source key', () => {
  assert.equal(checkForIssue({ source: { key: 'gs:commitwork|secrets|generic-api-key' } }), 'secrets');
});
test('checkForIssue maps both dependency source-key shapes to dependency-cve', () => {
  assert.equal(checkForIssue({ source: { key: 'f:CVE-2026-1|left-pad|commitwork' } }), 'dependency-cve');
  assert.equal(checkForIssue({ source: { key: 'g:commitwork|left-pad' } }), 'dependency-cve');
});
test('checkForIssue is honestly null for a manual issue or a malformed key', () => {
  assert.equal(checkForIssue({ source: { key: null } }), null);
  assert.equal(checkForIssue({ source: { key: 'not-a-recognised-shape' } }), null);
  assert.equal(checkForIssue({}), null);
  assert.equal(checkForIssue(null), null);
});

// ── empty ledger ───────────────────────────────────────────────────────────────────────────────
test('empty ledger -> empty exemplars, never a throw', () => {
  assert.deepEqual(selectExemplars([], { check: 'sastSemgrep' }), []);
  assert.deepEqual(selectExemplars(null, { check: 'sastSemgrep' }), []);
  assert.deepEqual(selectExemplars([rec()], { check: null }), []);
});

// ── determinism ────────────────────────────────────────────────────────────────────────────────
test('byte-identical output regardless of input array order', () => {
  const records = [
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'true-alarm', at: '2026-08-01T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|b|f2', truth: 'false-alarm', at: '2026-08-02T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|c|f3', truth: 'true-alarm', at: '2026-08-03T00:00:00.000Z' }),
  ];
  const forward = selectExemplars(records, { check: 'sastSemgrep' });
  const shuffled = selectExemplars([records[2], records[0], records[1]], { check: 'sastSemgrep' });
  const reversed = selectExemplars([...records].reverse(), { check: 'sastSemgrep' });
  assert.deepEqual(forward, shuffled);
  assert.deepEqual(forward, reversed);
  // and running it twice on the identical input is trivially identical too
  assert.deepEqual(selectExemplars(records, { check: 'sastSemgrep' }), forward);
});

// ── human-tier filter ─────────────────────────────────────────────────────────────────────────
test('machine-authored records (model set) never qualify as exemplars', () => {
  const records = [
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'true-alarm', model: 'qwen3.6-27b', at: '2026-08-05T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|b|f2', truth: 'false-alarm', model: null, at: '2026-08-01T00:00:00.000Z' }),
  ];
  const out = selectExemplars(records, { check: 'sastSemgrep' });
  assert.equal(out.length, 1);
  assert.equal(out[0].identity, 'sastSemgrep|commitwork|b|f2');
});

// ── refuted-outcome exclusion ─────────────────────────────────────────────────────────────────
test('an earlier adjudication for the SAME findingKey is refuted by a later one and excluded', () => {
  const records = [
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'true-alarm', at: '2026-08-01T00:00:00.000Z' }),
    // same finding, re-adjudicated later, opposite truth — the earlier record no longer stands
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'false-alarm', at: '2026-08-10T00:00:00.000Z' }),
  ];
  const out = selectExemplars(records, { check: 'sastSemgrep' });
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'false-alarm', 'only the CURRENT (latest) call on the finding survives');
});

// ── k respected ────────────────────────────────────────────────────────────────────────────────
test('k=1 returns exactly one, the most recent true-alarm when one exists', () => {
  const records = [
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'true-alarm', at: '2026-08-01T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|b|f2', truth: 'false-alarm', at: '2026-08-09T00:00:00.000Z' }),
  ];
  const out = selectExemplars(records, { check: 'sastSemgrep', k: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'true-alarm');
});

test('k=1 falls back to the false-alarm pool when there is no true-alarm', () => {
  const records = [rec({ findingKey: 'sastSemgrep|commitwork|b|f2', truth: 'false-alarm' })];
  const out = selectExemplars(records, { check: 'sastSemgrep', k: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].verdict, 'false-alarm');
});

test('k=4 pulls up to two of each pool when enough exist', () => {
  const records = [
    rec({ findingKey: 'sastSemgrep|commitwork|a|f1', truth: 'true-alarm', at: '2026-08-01T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|b|f2', truth: 'true-alarm', at: '2026-08-02T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|c|f3', truth: 'false-alarm', at: '2026-08-03T00:00:00.000Z' }),
    rec({ findingKey: 'sastSemgrep|commitwork|d|f4', truth: 'false-alarm', at: '2026-08-04T00:00:00.000Z' }),
  ];
  const out = selectExemplars(records, { check: 'sastSemgrep', k: 4 });
  assert.equal(out.length, 4);
  assert.equal(out.filter((e) => e.verdict === 'true-alarm').length, 2);
  assert.equal(out.filter((e) => e.verdict === 'false-alarm').length, 2);
});

// ── the check filter itself ───────────────────────────────────────────────────────────────────
test('a record for a DIFFERENT check never leaks into this check\'s exemplars', () => {
  const records = [
    rec({ category: 'secrets', findingKey: 'secrets|commitwork|x|f1', truth: 'true-alarm' }),
  ];
  assert.deepEqual(selectExemplars(records, { check: 'sastSemgrep' }), []);
});

// ── allowlist projection ──────────────────────────────────────────────────────────────────────
test('the returned shape is the allowlist ONLY — no evidence/basis field ever present', () => {
  const out = selectExemplars([rec()], { check: 'sastSemgrep' });
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ['identity', 'reason', 'rule', 'verdict']);
  assert.equal(out[0].rule, 'js/code-injection');
});

test('a raw evidence/basis string on the record, even if present, cannot reach the exemplar', () => {
  const dirty = rec({
    basis: 'the real secret is sk_live_THIS_SHOULD_NEVER_APPEAR',
    evidence: 'sk_live_THIS_SHOULD_NEVER_APPEAR too',
  });
  const out = selectExemplars([dirty], { check: 'sastSemgrep' });
  const rendered = JSON.stringify(out);
  assert.ok(!rendered.includes('sk_live'), 'no raw evidence/basis text may reach the projection');
});

// ── token cap ──────────────────────────────────────────────────────────────────────────────────
test('the output is trimmed until it fits EXEMPLAR_CHAR_BUDGET', () => {
  // the rule segment (parsed straight out of findingKey, never capped by safeReason) is the lever:
  // two 400-char rule names blow the 600-char budget together but not alone.
  const longRule = 'x'.repeat(400);
  const records = [
    rec({ findingKey: `sastSemgrep|commitwork|${longRule}|f1`, truth: 'true-alarm', at: '2026-08-01T00:00:00.000Z' }),
    rec({ findingKey: `sastSemgrep|commitwork|${longRule}|f2`, truth: 'false-alarm', at: '2026-08-02T00:00:00.000Z' }),
  ];
  const out = selectExemplars(records, { check: 'sastSemgrep', k: 2 });
  assert.ok(out.length < 2, 'a second exemplar that would blow the budget is dropped, not truncated in place');
  assert.ok(out.length >= 1, 'the highest-priority exemplar alone still fits and is kept');
  const block = formatExemplarBlock(out);
  assert.ok(block.length <= EXEMPLAR_CHAR_BUDGET + 100, 'rendered block stays within the named budget (+label overhead)');
});

// ── prompt formatting ─────────────────────────────────────────────────────────────────────────
test('formatExemplarBlock is null for no exemplars, a labelled block otherwise', () => {
  assert.equal(formatExemplarBlock([]), null);
  assert.equal(formatExemplarBlock(null), null);
  const block = formatExemplarBlock(selectExemplars([rec()], { check: 'sastSemgrep' }));
  assert.match(block, /^Recent adjudications for this same check/);
  assert.match(block, /false-alarm/);
});
