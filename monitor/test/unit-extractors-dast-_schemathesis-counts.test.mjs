// Schemathesis NDJSON event stream counts (monitor/extractors/dast.mjs _schemathesisCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _schemathesisCounts } from '../extractors/dast.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const result = _schemathesisCounts(dir, 'missing.ndjson');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact for a blank file', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    writeFileSync(join(dir, 'blank.ndjson'), '   \n  \n');
    const result = _schemathesisCounts(dir, 'blank.ndjson');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when only a FatalError is present', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const line = JSON.stringify({ FatalError: 'Failed to load schema HTTP 401 Unauthorized' });
    writeFileSync(join(dir, 'fatal.ndjson'), line + '\n');
    const result = _schemathesisCounts(dir, 'fatal.ndjson');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a failed scenario as high severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const line = JSON.stringify({ ScenarioFinished: { status: 'failure', label: 'GET /users' } });
    writeFileSync(join(dir, 'fail.ndjson'), line + '\n');
    const result = _schemathesisCounts(dir, 'fail.ndjson');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ operation: "GET /users", sev: "high", message: "the operation failed its own declared contract or returned 5xx" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts an errored scenario as med severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const line = JSON.stringify({ ScenarioFinished: { status: 'error', name: 'POST /items' } });
    writeFileSync(join(dir, 'err.ndjson'), line + '\n');
    const result = _schemathesisCounts(dir, 'err.ndjson');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 0, total: 1, ran: true, findings: [{ operation: "POST /items", sev: "med", message: "the scenario errored before it could reach a verdict" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-fatal non-scenario lines and blank lines', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const lines = [
      JSON.stringify({ TestStarted: { label: 'GET /a' } }),
      '',
      'not json at all',
      JSON.stringify({ ScenarioFinished: { status: 'success', label: 'GET /a' } }),
      JSON.stringify({ ScenarioFinished: { status: 'failure', label: 'GET /b' } }),
    ].join('\n');
    writeFileSync(join(dir, 'mixed.ndjson'), lines);
    const result = _schemathesisCounts(dir, 'mixed.ndjson');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ operation: "GET /b", sev: "high", message: "the operation failed its own declared contract or returned 5xx" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses operation field when label and name are absent', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const line = JSON.stringify({ ScenarioFinished: { status: 'failure', operation: 'DELETE /x' } });
    writeFileSync(join(dir, 'op.ndjson'), line + '\n');
    const result = _schemathesisCounts(dir, 'op.ndjson');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, findings: [{ operation: "DELETE /x", sev: "high", message: "the operation failed its own declared contract or returned 5xx" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when FatalError precedes a success-only scenario', () => {
  const dir = mkdtempSync(join(tmpdir(), '_schemathesisCounts-'));
  try {
    const lines = [
      JSON.stringify({ FatalError: 'boom' }),
      JSON.stringify({ ScenarioFinished: { status: 'success', label: 'GET /y' } }),
    ].join('\n');
    writeFileSync(join(dir, 'fatal-success.ndjson'), lines);
    const result = _schemathesisCounts(dir, 'fatal-success.ndjson');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
