// Counts Gradle wrapper verification findings from a JSON artifact (monitor/extractors/supply-chain.mjs _gradleWrapperCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _gradleWrapperCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the artifact file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    const result = _gradleWrapperCounts(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty artifact when the file is blank', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    writeFileSync(join(dir, 'blank.json'), '   \n  ');
    const result = _gradleWrapperCounts(dir, 'blank.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    const result = _gradleWrapperCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the JSON is a primitive', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    writeFileSync(join(dir, 'prim.json'), '42');
    const result = _gradleWrapperCounts(dir, 'prim.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with reason when ran is not true', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    writeFileSync(join(dir, 'nosrc.json'), JSON.stringify({ ran: false, reason: 'skipped' }));
    const result = _gradleWrapperCounts(dir, 'nosrc.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, reason: "skipped" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc with default reason when applicable is false', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    writeFileSync(join(dir, 'inapp.json'), JSON.stringify({ ran: true, applicable: false }));
    const result = _gradleWrapperCounts(dir, 'inapp.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, reason: "no Gradle wrapper in this repo" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings and propagates metadata when applicable', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    const payload = {
      ran: true,
      applicable: true,
      findings: [
        { rule: 'R1', sev: 'high', message: 'm1' },
        { rule: 'R2', sev: 'low', message: 'm2' },
        { rule: 'R3', sev: 'critical', message: 'm3' }
      ],
      scope: 'fetch-path',
      doesNotCover: ['runtime'],
      declaredVersion: '8.5',
      jarSha256: 'abc',
      gradlewSha256: 'def',
      checksumCheck: 'ok'
    };
    writeFileSync(join(dir, 'full.json'), JSON.stringify(payload));
    const result = _gradleWrapperCounts(dir, 'full.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 1, total: 3, ran: true, scope: "fetch-path", doesNotCover: ["runtime"], declaredVersion: "8.5", jarSha256: "abc", gradlewSha256: "def", checksumCheck: "ok", findings: [{ rule: "R1", sev: "high", message: "m1" }, { rule: "R2", sev: "low", message: "m2" }, { rule: "R3", sev: "", message: "m3" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles findings with missing or non-string sev fields', () => {
  const dir = mkdtempSync(join(tmpdir(), '_gradleWrapperCounts-'));
  try {
    const payload = {
      ran: true,
      applicable: true,
      findings: [
        { rule: 'A', sev: 'HIGH', message: 'x' },
        { rule: 'B', message: 'no sev' },
        { rule: 'C', sev: 42, message: 'num' }
      ]
    };
    writeFileSync(join(dir, 'sev.json'), JSON.stringify(payload));
    const result = _gradleWrapperCounts(dir, 'sev.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 3, ran: true, findings: [{ rule: "A", sev: "high", message: "x" }, { rule: "B", sev: "", message: "no sev" }, { rule: "C", sev: "", message: "num" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
