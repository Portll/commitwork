// Loads and validates the bare-catch baseline document (bin/bare-catch-ratchet.mjs loadBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaseline } from '../bare-catch-ratchet.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns absent state when the baseline file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const result = loadBaseline(join(dir, 'missing.json'));
    assert.deepEqual(result, { state: "absent", doc: null, reason: "ENOENT" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state with the error code when the file cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'x');
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "unparseable JSON (Unexpected token 'x', \"x\" is not valid JSON)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when the file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "unparseable JSON (Expected property name or '}' in JSON at position 1 (line 1 column 2))" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when keys is an array instead of an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ keys: [1, 2] }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "not a baseline document (missing object `keys`)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when keys is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ keys: null }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "not a baseline document (missing object `keys`)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when a key value is a negative integer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ keys: { 'a::b': -1 } }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "key a::b has a non-count value" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when a key value is a non-integer number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ keys: { 'a::b': 1.5 } }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "key a::b has a non-count value" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with merged document when the baseline is valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'good.json');
    writeFileSync(p, JSON.stringify({ version: 2, keys: { 'a::b': 0, 'c::d': 3 }, critical: ['x.mjs'], journal: ['j1'] }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "ok", doc: { _comment: "Baseline for bin/bare-catch-ratchet.mjs. Keys are <file>::<named-scope-chain> \u2014 LINE-FREE by house rule. Never hand-edit; use --seed / --tighten / --accept.", version: 2, keys: { "a::b": 0, "c::d": 3 }, critical: ["x.mjs"], journal: ["j1"] } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns ok state with zero count values in keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'zero.json');
    writeFileSync(p, JSON.stringify({ keys: { 'a::b': 0 } }));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "ok", doc: { _comment: "Baseline for bin/bare-catch-ratchet.mjs. Keys are <file>::<named-scope-chain> \u2014 LINE-FREE by house rule. Never hand-edit; use --seed / --tighten / --accept.", version: 1, keys: { "a::b": 0 }, critical: ["monitor/extractors.mjs", "monitor/extractors/socket.mjs", "monitor/extractors/secrets.mjs", "monitor/extractors/supply-chain.mjs", "monitor/extractors/posture.mjs", "monitor/extractors/dast.mjs", "monitor/extractors/tree-contents.mjs", "monitor/extractors/sast-lint.mjs", "monitor/extractors/agent-surface.mjs", "monitor/extractors/history.mjs", "bin/canary-harness.mjs", "monitor/rollup.mjs", "monitor/issue-store.mjs", "admin/auth.mjs"], journal: [] } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unreadable state when the parsed JSON is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const p = join(dir, 'str.json');
    writeFileSync(p, JSON.stringify('hello'));
    const result = loadBaseline(p);
    assert.deepEqual(result, { state: "unreadable", doc: null, reason: "not a baseline document (missing object `keys`)" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
