// Counts actionlint findings with severity derived from untrusted-input messages (monitor/extractors/sast-lint.mjs _actionlintCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _actionlintCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    const result = _actionlintCounts(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact for a blank file', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    writeFileSync(join(dir, 'blank.json'), '   \n  ');
    const result = _actionlintCounts(dir, 'blank.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable true for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    const result = _actionlintCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable true when ran is false', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    writeFileSync(join(dir, 'notran.json'), JSON.stringify({ tool: 'actionlint', ran: false, findings: [] }));
    const result = _actionlintCounts(dir, 'notran.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable true when findings is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    writeFileSync(join(dir, 'nofindings.json'), JSON.stringify({ tool: 'actionlint', ran: true, findings: 'nope' }));
    const result = _actionlintCounts(dir, 'nofindings.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a high finding for untrusted input and a med finding otherwise', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    const findings = [
      { kind: 'SC2086', filepath: 'a.sh', line: 1, message: 'potentially untrusted input' },
      { kind: 'SC1090', filepath: 'b.sh', line: 2, message: 'some other issue' }
    ];
    writeFileSync(join(dir, 'ok.json'), JSON.stringify({ tool: 'actionlint', ran: true, findings }));
    const result = _actionlintCounts(dir, 'ok.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 1, low: 0, total: 2, ran: true, findings: [{ rule: "SC2086", file: "a.sh", line: 1, sev: "high", message: "potentially untrusted input" }, { rule: "SC1090", file: "b.sh", line: 2, sev: "med", message: "some other issue" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts for an empty findings array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_actionlintCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), JSON.stringify({ tool: 'actionlint', ran: true, findings: [] }));
    const result = _actionlintCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
