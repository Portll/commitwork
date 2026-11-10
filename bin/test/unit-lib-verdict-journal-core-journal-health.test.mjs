// Per-gate ledger health: absent, stale-baseline-moved, chain-broken, torn, or ok (bin/lib/verdict-journal-core.mjs journalHealth).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalHealth } from '../lib/verdict-journal-core.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mk() { return mkdtempSync(join(tmpdir(), 'journalHealth-')); }

test('returns unreadable with the error code when the journal file is unreadable', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    writeFileSync(file, 'x');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "torn", lastAt: null, lastVerdict: null, entries: 0, torn: 1, chain: { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 1 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns unreadable with baseline detail when the baseline file is unreadable', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    writeFileSync(file, 'x');
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, 'y');
    const r = journalHealth({ roster: [{ gate, baseline }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "unreadable", detail: "baseline: unparseable" }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns stale-baseline-moved when the baseline timestamp is newer than the last record', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    writeFileSync(file, JSON.stringify({ at: '2024-01-01T00:00:00.000Z', verdict: 'pass' }) + '\n');
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, JSON.stringify({ at: '2024-01-02T00:00:00.000Z' }));
    const r = journalHealth({ roster: [{ gate, baseline }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "stale-baseline-moved", baselineAt: "2024-01-02T00:00:00.000Z", lastAt: "2024-01-01T00:00:00.000Z", entries: 1, torn: 0 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok when the baseline timestamp is older than the last record', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    writeFileSync(file, JSON.stringify({ at: '2024-01-02T00:00:00.000Z', verdict: 'pass' }) + '\n');
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, JSON.stringify({ at: '2024-01-01T00:00:00.000Z' }));
    const r = journalHealth({ roster: [{ gate, baseline }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "ok", lastAt: "2024-01-02T00:00:00.000Z", lastVerdict: "pass", entries: 1, torn: 0, chain: { verified: 0, broken: 0, raced: 0, unchained: 1, unlinked: 0, renumbered: 0, examined: 1 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns absent-not-running when the journal file does not exist', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, JSON.stringify({ at: '2024-01-01T00:00:00.000Z' }));
    const r = journalHealth({ roster: [{ gate, baseline }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "absent-not-running", baselineAt: "2024-01-01T00:00:00.000Z", lastAt: null, entries: 0, torn: 0 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns chain-broken when the ledger chain has a broken link', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    const l1 = JSON.stringify({ at: '2024-01-01T00:00:00.000Z', verdict: 'pass', prev: 'genesis' });
    const l2 = JSON.stringify({ at: '2024-01-02T00:00:00.000Z', verdict: 'pass', prev: 'deadbeef' });
    writeFileSync(file, l1 + '\n' + l2 + '\n');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "chain-broken", lastAt: "2024-01-02T00:00:00.000Z", lastVerdict: "pass", entries: 2, torn: 0, chain: { verified: 1, broken: 1, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 2 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns torn when the journal has a torn line but no broken chain', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    const l1 = JSON.stringify({ at: '2024-01-01T00:00:00.000Z', verdict: 'pass', prev: 'genesis' });
    writeFileSync(file, l1 + '\n' + 'not-json' + '\n');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "torn", lastAt: "2024-01-01T00:00:00.000Z", lastVerdict: "pass", entries: 1, torn: 1, chain: { verified: 1, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 2 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok with silenced when the last record has a numeric silenced field', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    const l1 = JSON.stringify({ at: '2024-01-01T00:00:00.000Z', verdict: 'pass', prev: 'genesis', silenced: 3 });
    writeFileSync(file, l1 + '\n');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "ok", lastAt: "2024-01-01T00:00:00.000Z", lastVerdict: "pass", entries: 1, torn: 0, chain: { verified: 1, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 1 }, silenced: 3 }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok with silenced undefined when the last record has no silenced field', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    const l1 = JSON.stringify({ at: '2024-01-01T00:00:00.000Z', verdict: 'pass', prev: 'genesis' });
    writeFileSync(file, l1 + '\n');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "ok", lastAt: "2024-01-01T00:00:00.000Z", lastVerdict: "pass", entries: 1, torn: 0, chain: { verified: 1, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 1 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('returns ok with lastAt null when the journal file is empty', () => {
  const dir = mk();
  try {
    const gate = 'gate-tests';
    const file = join(dir, `${gate}.jsonl`);
    writeFileSync(file, '');
    const r = journalHealth({ roster: [{ gate, baseline: null }], dir });
    assert.deepEqual(r, [{ gate: "gate-tests", state: "ok", lastAt: null, lastVerdict: null, entries: 0, torn: 0, chain: { verified: 0, broken: 0, raced: 0, unchained: 0, unlinked: 0, renumbered: 0, examined: 0 }, silenced: undefined }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
