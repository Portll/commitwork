// Parses Schemathesis NDJSON into a pass/fail result with severity (bin/lib/report-parsers/dast.mjs parseSchemathesis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchemathesis } from '../lib/report-parsers/dast.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns no schemathesis data when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const result = parseSchemathesis(join(dir, 'missing.ndjson'));
    assert.deepEqual(result, { ok: false, summary: 'no schemathesis data' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'empty.ndjson');
    writeFileSync(p, '');
    const result = parseSchemathesis(p);
    assert.deepEqual(result, { ok: false, sev: 'noscan', summary: 'schemathesis wrote no events \u2014 the run did not start' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the file contains only whitespace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'ws.ndjson');
    writeFileSync(p, '   \n\t\n  ');
    const result = parseSchemathesis(p);
    assert.deepEqual(result, { ok: false, sev: 'noscan', summary: 'schemathesis wrote no events \u2014 the run did not start' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when a FatalError appears and no scenarios ran', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'fatal.ndjson');
    const line = JSON.stringify({ FatalError: { exception: { message: 'Failed to load schema (HTTP 401 Unauthorized)' } } });
    writeFileSync(p, line + '\n');
    const result = parseSchemathesis(p);
    assert.equal(result.ok, false);
    assert.equal(result.sev, 'noscan');
    assert.equal(result.summary, 'spec never loaded \u2014 Failed to load schema (HTTP 401 Unauthorized)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when a FatalError has no exception message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'fatal2.ndjson');
    const line = JSON.stringify({ FatalError: {} });
    writeFileSync(p, line + '\n');
    const result = parseSchemathesis(p);
    assert.equal(result.ok, false);
    assert.equal(result.sev, 'noscan');
    assert.equal(result.summary, 'spec never loaded \u2014 fatal error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when there are no scenarios and no fatal error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'noscan.ndjson');
    const line = JSON.stringify({ SomeOtherEvent: { foo: 'bar' } });
    writeFileSync(p, line + '\n');
    const result = parseSchemathesis(p);
    assert.deepEqual(result, { ok: false, sev: 'noscan', summary: 'no operations were tested' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok with zero failures when all scenarios pass', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'pass.ndjson');
    const l1 = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    const l2 = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    const l3 = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    writeFileSync(p, l1 + '\n' + l2 + '\n' + l3 + '\n');
    const result = parseSchemathesis(p);
    assert.deepEqual(result, { ok: true, total: 0, sev: 'ok', summary: '0 (3 scenarios)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns high severity when there are contract failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'fail.ndjson');
    const l1 = JSON.stringify({ ScenarioFinished: { status: 'failure' } });
    const l2 = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    const l3 = JSON.stringify({ ScenarioFinished: { status: 'failure' } });
    writeFileSync(p, l1 + '\n' + l2 + '\n' + l3 + '\n');
    const result = parseSchemathesis(p);
    assert.equal(result.ok, true);
    assert.equal(result.total, 2);
    assert.equal(result.sev, 'high');
    assert.equal(result.summary, '2 contract failure(s), 0 error(s) over 3 scenario(s)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns med severity when there are errors but no failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'err.ndjson');
    const l1 = JSON.stringify({ ScenarioFinished: { status: 'error' } });
    const l2 = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    writeFileSync(p, l1 + '\n' + l2 + '\n');
    const result = parseSchemathesis(p);
    assert.equal(result.ok, true);
    assert.equal(result.total, 1);
    assert.equal(result.sev, 'med');
    assert.equal(result.summary, '0 contract failure(s), 1 error(s) over 2 scenario(s)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips malformed JSON lines and non-object lines without error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseSchemathesis-'));
  try {
    const p = join(dir, 'mixed.ndjson');
    const bad1 = 'not valid json';
    const bad2 = '42';
    const good = JSON.stringify({ ScenarioFinished: { status: 'success' } });
    writeFileSync(p, bad1 + '\n' + bad2 + '\n' + good + '\n');
    const result = parseSchemathesis(p);
    assert.deepEqual(result, { ok: true, total: 0, sev: 'ok', summary: '0 (1 scenarios)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
