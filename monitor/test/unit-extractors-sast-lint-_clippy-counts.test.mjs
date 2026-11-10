// Counts clippy lint diagnostics from a fold artifact and its exit sidecar (monitor/extractors/sast-lint.mjs _clippyCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _clippyCounts } from '../extractors/sast-lint.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the artifact file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable with ran true for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), 'not json');
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable with ran true when tool is not clippy', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), JSON.stringify({ tool: 'eslint', diagnostics: [] }));
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns toolfailed when exit is nonzero and no clippy lints ran', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), JSON.stringify({ tool: 'clippy', diagnostics: [{ code: 'unused_variables', level: 'error', message: 'unused', file: 'a.rs', line: 1 }] }));
    writeFileSync(join(dir, 'clippy.json.exit'), '101');
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, toolfailed: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts clippy and rustc diagnostics with correct severity mapping', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), JSON.stringify({ tool: 'clippy', diagnostics: [
      { code: 'clippy::print_stdout', level: 'warning', message: 'print', file: 'main.rs', line: 10 },
      { code: 'unused_variables', level: 'error', message: 'unused', file: 'main.rs', line: 20 },
      { code: 'clippy::todo', level: 'failure-note', message: 'note', file: 'main.rs', line: 30 }
    ] }));
    writeFileSync(join(dir, 'clippy.json.exit'), '1');
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 1, low: 1, total: 2, ran: true, findings: [{ rule: "clippy::print_stdout", file: "main.rs", line: 10, sev: "low", message: "print" }, { rule: "unused_variables", file: "main.rs", line: 20, sev: "med", message: "unused" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts when diagnostics are empty and exit is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), JSON.stringify({ tool: 'clippy', diagnostics: [] }));
    writeFileSync(join(dir, 'clippy.json.exit'), '0');
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, findings: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty artifact for blank file content', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), '   ');
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing exit sidecar as vintage artifact with zero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), '_clippyCounts-'));
  try {
    writeFileSync(join(dir, 'clippy.json'), JSON.stringify({ tool: 'clippy', diagnostics: [
      { code: 'clippy::dbg_macro', level: 'warning', message: 'dbg', file: 'x.rs', line: 5 }
    ] }));
    const result = _clippyCounts(dir, 'clippy.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, findings: [{ rule: "clippy::dbg_macro", file: "x.rs", line: 5, sev: "low", message: "dbg" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
