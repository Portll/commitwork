// Counts matching rows and torn lines across ledger generations (mcp/emission-ledger.mjs rowsForJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsForJob } from '../emission-ledger.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state with zero rows and zero torn when no generation files exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "absent", rows: 0, torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with one matching row and zero torn for a single valid line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, JSON.stringify({ jobId: 'job-1' }) + '\n');
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 1, torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with zero rows and zero torn when file exists but no lines match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, JSON.stringify({ jobId: 'other' }) + '\n');
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 0, torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with zero rows and one torn for a single unparseable line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, 'not-json\n');
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 0, torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with two matching rows and one torn for mixed valid and invalid lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    const lines = [
      JSON.stringify({ jobId: 'job-1' }),
      'garbage',
      JSON.stringify({ jobId: 'job-1' }),
      JSON.stringify({ jobId: 'other' })
    ].join('\n') + '\n';
    writeFileSync(p, lines);
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 2, torn: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with zero rows and zero torn when file contains only empty lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, '\n\n\n');
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 0, torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns present state with one matching row and zero torn when file has no trailing newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rowsForJob-'));
  try {
    const p = join(dir, 'ledger.jsonl');
    writeFileSync(p, JSON.stringify({ jobId: 'job-1' }));
    const r = rowsForJob('job-1', p);
    assert.deepEqual(r, { state: "present", rows: 1, torn: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
