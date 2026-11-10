// Maps a gate result to a ledger record with subject, outcome, reason, vetoedBy, rules, policy, and tokens. (bin/turn-gate.mjs ledgerRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerRecord } from '../turn-gate.mjs';

test('maps a full result with verdicts and tokens to the ledger record', () => {
  const r = {
    file: '/repo/path/to/file.mjs',
    outcome: 'pass',
    reason: 'ok',
    vetoedBy: 'alice',
    verdicts: [
      { rule: 'no-secrets', verdict: 'fail', evidence: { count: 3, turns: [{ openedByUuid: 'u1' }, { openedByUuid: 'u2' }] } },
      { rule: 'style', verdict: 'pass', evidence: { modelTurns: 5 } },
    ],
    policy: 'strict',
    tokens: { turns: 10, totals: { output: 100 }, ruminationShare: 0.2 },
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "pass", reason: "ok", vetoedBy: "alice", rules: [{ rule: "no-secrets", verdict: "fail", count: 3, turns: ["u1", "u2"] }, { rule: "style", verdict: "pass", count: 5, turns: null }], policy: "strict", tokens: { turns: 10, output: 100, ruminationShare: 0.2 } });
});

test('returns null for vetoedBy and policy when they are absent', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'fail',
    reason: 'bad',
    verdicts: [],
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "fail", reason: "bad", vetoedBy: null, rules: [], policy: null, tokens: null });
});

test('returns null for rules when verdicts is undefined', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'pass',
    reason: 'ok',
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "pass", reason: "ok", vetoedBy: null, rules: [], policy: null, tokens: null });
});

test('returns null for count and turns when evidence is missing', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'fail',
    reason: 'bad',
    vetoedBy: null,
    verdicts: [{ rule: 'r1', verdict: 'fail' }],
    policy: null,
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "fail", reason: "bad", vetoedBy: null, rules: [{ rule: "r1", verdict: "fail", count: null, turns: null }], policy: null, tokens: null });
});

test('returns null for turns when evidence turns is not an array', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'fail',
    reason: 'bad',
    vetoedBy: null,
    verdicts: [{ rule: 'r1', verdict: 'fail', evidence: { count: 1, turns: 'not-array' } }],
    policy: null,
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "fail", reason: "bad", vetoedBy: null, rules: [{ rule: "r1", verdict: "fail", count: 1, turns: null }], policy: null, tokens: null });
});

test('returns null for output when tokens totals is missing', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'pass',
    reason: 'ok',
    vetoedBy: null,
    verdicts: [],
    policy: null,
    tokens: { turns: 5, ruminationShare: 0.1 },
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "pass", reason: "ok", vetoedBy: null, rules: [], policy: null, tokens: { turns: 5, output: null, ruminationShare: 0.1 } });
});

test('returns null for count when evidence has neither count nor modelTurns', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'fail',
    reason: 'bad',
    vetoedBy: null,
    verdicts: [{ rule: 'r1', verdict: 'fail', evidence: { turns: [] } }],
    policy: null,
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "fail", reason: "bad", vetoedBy: null, rules: [{ rule: "r1", verdict: "fail", count: null, turns: [] }], policy: null, tokens: null });
});

test('returns null for turns when evidence turns is an empty array', () => {
  const r = {
    file: 'file.mjs',
    outcome: 'fail',
    reason: 'bad',
    vetoedBy: null,
    verdicts: [{ rule: 'r1', verdict: 'fail', evidence: { count: 0, turns: [] } }],
    policy: null,
    tokens: null,
  };
  assert.deepEqual(ledgerRecord(r), { subject: "file.mjs", outcome: "fail", reason: "bad", vetoedBy: null, rules: [{ rule: "r1", verdict: "fail", count: 0, turns: [] }], policy: null, tokens: null });
});
