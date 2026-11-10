// Summarizes a SARIF file into counts and notification lanes (bin/lib/github-action.mjs readSarifSummary).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSarifSummary } from '../lib/github-action.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const r = readSarifSummary(join(dir, 'missing.json'));
    assert.deepEqual(r, { state: "absent", why: "ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "unreadable", why: "Unexpected token 'o', \"not json\" is not valid JSON" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when runs is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'noruns.json');
    writeFileSync(p, JSON.stringify({}));
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "unreadable", why: "Cannot read properties of undefined (reading '0')" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when results is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'badresults.json');
    writeFileSync(p, JSON.stringify({ runs: [{ results: 'nope' }] }));
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "unreadable", why: "runs[0].results is not an array" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts levels and splits notifications for a valid SARIF run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'ok.json');
    const sarif = {
      runs: [{
        results: [
          { level: 'error' },
          { level: 'error' },
          { level: 'warning' },
          { level: 'note' },
          { level: 'note' },
          { level: 'note' },
          { level: 'info' }
        ],
        invocations: [{
          toolExecutionNotifications: [
            { descriptor: { id: 'lane-a' }, level: 'warning', message: { text: 'warn text' } },
            { descriptor: { id: 'lane-b' }, level: 'error', message: { text: 'err text' } },
            { descriptor: { id: 'lane-c' }, level: 'note', message: { text: 'note text' } }
          ]
        }],
        properties: { commitwork: { undetermined: ['x', 'y'] } }
      }]
    };
    writeFileSync(p, JSON.stringify(sarif));
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "ok", results: 7, levels: { error: 2, warning: 1, note: 3 }, unmeasured: [{ lane: "lane-a", level: "warning", text: "warn text" }], reduced: [{ lane: "lane-b", level: "error", text: "err text" }, { lane: "lane-c", level: "note", text: "note text" }], undetermined: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing invocations and properties gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'minimal.json');
    const sarif = { runs: [{ results: [{ level: 'error' }] }] };
    writeFileSync(p, JSON.stringify(sarif));
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "ok", results: 1, levels: { error: 1, warning: 0, note: 0 }, unmeasured: [], reduced: [], undetermined: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when runs is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readSarifSummary-'));
  try {
    const p = join(dir, 'emptyruns.json');
    writeFileSync(p, JSON.stringify({ runs: [] }));
    const r = readSarifSummary(p);
    assert.deepEqual(r, { state: "unreadable", why: "runs[0].results is not an array" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
