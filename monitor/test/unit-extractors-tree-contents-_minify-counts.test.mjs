// counts minified-code findings and aggregates severity buckets (monitor/extractors/tree-contents.mjs _minifyCounts).
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { _minifyCounts } from '../extractors/tree-contents.mjs';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const result = _minifyCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'empty.json';
    writeFileSync(join(dir, file), '');
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when JSON is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'bad.json';
    writeFileSync(join(dir, file), '{ not: json ');
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when required fields are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'missing.json';
    writeFileSync(join(dir, file), JSON.stringify({}));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'nosrc.json';
    writeFileSync(join(dir, file), JSON.stringify({
      summary: { filesScanned: 0, findings: [] },
      findings: []
    }));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a normal high\u2011severity finding', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'high.json';
    writeFileSync(join(dir, file), JSON.stringify({
      summary: { filesScanned: 1, findings: [] },
      findings: [{ path: 'a.js', sev: 'high', rule: 'no-eval', metrics: {}, detail: 'bad' }]
    }));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ rule: "no-eval", file: "a.js", sev: "high", capped: false, metric: "entropy=undefined ws=undefined maxline=undefined", message: "bad" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records a self\u2011reference finding in the sr bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'self.json';
    writeFileSync(join(dir, file), JSON.stringify({
      summary: { filesScanned: 1, findings: [] },
      findings: [{ path: 'b.js', sev: 'low', selfReference: true, rule: 'minify-self', detail: 'self' }]
    }));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, selfReference: { crit: 0, high: 0, med: 0, low: 1, total: 1, byFile: { "b.js": 1 }, rows: [{ rule: "minify-self", file: "b.js", sev: "low", why: "true" }], of: 1, note: "1 of 1 rows are minify-detect matching its own pattern definitions \u2014 the literals in its comments and fixtures ARE the rules \u2014 and are excluded from these counts. They remain in minify.json on disk. Readability, bidi and packer rules stay live on those files." }, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles undetermined rule and adds undetermined count', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'undetermined.json';
    writeFileSync(join(dir, file), JSON.stringify({
      summary: { filesScanned: 1, findings: [] },
      findings: [{ path: 'c.js', sev: 'med', rule: 'minified-source', detail: 'unreadable' }]
    }));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, undetermined: 1, findings: [{ rule: "minified-source", file: "c.js", sev: "", capped: false, metric: "entropy=undefined ws=undefined maxline=undefined", message: "UNDETERMINED \u2014 unreadable is a coverage fact, not a vulnerability; this file was measured, not judged. minify-detect reported: unreadable" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes skipped count when filesSkipped array is present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_minifyCounts-'));
  try {
    const file = 'skipped.json';
    writeFileSync(join(dir, file), JSON.stringify({
      summary: { filesScanned: 2, filesSkipped: ['d.js'], findings: [] },
      findings: [{ path: 'd.js', sev: '', rule: 'no-var', detail: 'skip' }]
    }));
    const result = _minifyCounts(dir, file);
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, skipped: 1, findings: [{ rule: "no-var", file: "d.js", sev: "med", capped: false, metric: "entropy=undefined ws=undefined maxline=undefined", message: "skip" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
