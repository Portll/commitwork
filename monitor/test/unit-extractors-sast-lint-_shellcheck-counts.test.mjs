// Counts shellcheck json1 findings by severity (monitor/extractors/sast-lint.mjs _shellcheckCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _shellcheckCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  try {
    assert.strictEqual(_shellcheckCounts(dir, 'missing.json'), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'blank.json';
  writeFileSync(join(dir, file), '   \n  ');
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 0,
      total: 0,
      ran: true,
      nosrc: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the content is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'bad.json';
  writeFileSync(join(dir, file), '{ not json');
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 0,
      total: 0,
      ran: true,
      unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the parsed value has no comments array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'no-comments.json';
  writeFileSync(join(dir, file), JSON.stringify({ foo: 1 }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 0,
      total: 0,
      ran: true,
      unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when comments is present but not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'comments-object.json';
  writeFileSync(join(dir, file), JSON.stringify({ comments: { a: 1 } }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 0,
      total: 0,
      ran: true,
      unparseable: true
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with ran true when comments is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'empty-comments.json';
  writeFileSync(join(dir, file), JSON.stringify({ comments: [] }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 0,
      total: 0,
      ran: true,
      findings: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps error level to high and increments total', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'error.json';
  writeFileSync(join(dir, file), JSON.stringify({
    comments: [{ file: 'a.sh', line: 1, level: 'error', code: 2086, message: 'Double quote' }]
  }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 1,
      med: 0,
      low: 0,
      total: 1,
      ran: true,
      findings: [{ rule: 'SC2086', file: 'a.sh', line: 1, sev: 'high', message: 'Double quote' }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps warning level to med', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'warning.json';
  writeFileSync(join(dir, file), JSON.stringify({
    comments: [{ file: 'b.sh', line: 2, level: 'warning', code: 1090, message: 'Can not use' }]
  }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 1,
      low: 0,
      total: 1,
      ran: true,
      findings: [{ rule: 'SC1090', file: 'b.sh', line: 2, sev: 'med', message: 'Can not use' }]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps info and style levels to low', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'info-style.json';
  writeFileSync(join(dir, file), JSON.stringify({
    comments: [
      { file: 'c.sh', line: 3, level: 'info', code: 2001, message: 'Tip' },
      { file: 'd.sh', line: 4, level: 'style', code: 2002, message: 'Style' }
    ]
  }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 2,
      total: 2,
      ran: true,
      findings: [
        { rule: 'SC2001', file: 'c.sh', line: 3, sev: 'low', message: 'Tip' },
        { rule: 'SC2002', file: 'd.sh', line: 4, sev: 'low', message: 'Style' }
      ]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to low when level is missing or unrecognized', () => {
  const dir = mkdtempSync(join(tmpdir(), '_shellcheckCounts-'));
  const file = 'unknown-level.json';
  writeFileSync(join(dir, file), JSON.stringify({
    comments: [
      { file: 'e.sh', line: 5, code: 3001, message: 'No level' },
      { file: 'f.sh', line: 6, level: 'note', code: 3002, message: 'Unknown level' }
    ]
  }));
  try {
    const r = _shellcheckCounts(dir, file);
    assert.deepStrictEqual(r, {
      crit: 0,
      high: 0,
      med: 0,
      low: 2,
      total: 2,
      ran: true,
      findings: [
        { rule: 'SC3001', file: 'e.sh', line: 5, sev: 'low', message: 'No level' },
        { rule: 'SC3002', file: 'f.sh', line: 6, sev: 'low', message: 'Unknown level' }
      ]
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
