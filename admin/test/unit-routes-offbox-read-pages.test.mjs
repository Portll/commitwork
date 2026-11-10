// Reads the offbox page store, returning parsed pages, torn-line count, and absence flag (admin/routes/offbox.mjs readPages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPages } from '../routes/offbox.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'readPages-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('returns empty pages and absent true when file does not exist', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'missing.jsonl');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.deepEqual(res, { pages: [], torn: 0, absent: true });
  } finally { cleanup(); }
});

test('returns empty pages and absent false when file is empty', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.deepEqual(res, { pages: [], torn: 0, absent: false, records: 0 });
  } finally { cleanup(); }
});

test('parses valid JSON lines into pages array in reverse order', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'pages.jsonl');
    const lines = ['{"id":1}', '{"id":2}', '{"id":3}'];
    writeFileSync(p, lines.join('\n') + '\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.equal(res.absent, false);
    assert.equal(res.records, 3);
    assert.equal(res.torn, 0);
    assert.deepEqual(res.pages, [{ id: 3 }, { id: 2 }, { id: 1 }]);
  } finally { cleanup(); }
});

test('counts unparseable lines as torn and excludes them from pages', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'torn.jsonl');
    const lines = ['{"id":1}', 'not-json', '{"id":2}', 'also-bad'];
    writeFileSync(p, lines.join('\n') + '\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.equal(res.torn, 2);
    assert.equal(res.records, 4);
    assert.deepEqual(res.pages, [{ id: 2 }, { id: 1 }]);
  } finally { cleanup(); }
});

test('applies limit by taking last N lines before parsing', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'limited.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) => `{"id":${i}}`);
    writeFileSync(p, lines.join('\n') + '\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 2);
    assert.equal(res.records, 5);
    assert.equal(res.torn, 0);
    assert.deepEqual(res.pages, [{ id: 4 }, { id: 3 }]);
  } finally { cleanup(); }
});

test('handles trailing newline without creating empty line', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'trail.jsonl');
    writeFileSync(p, '{"a":1}\n{"b":2}\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.equal(res.records, 2);
    assert.deepEqual(res.pages, [{ b: 2 }, { a: 1 }]);
  } finally { cleanup(); }
});

test('filters out blank lines between records', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'blanks.jsonl');
    writeFileSync(p, '{"x":1}\n\n{"y":2}\n\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 200);
    assert.equal(res.records, 2);
    assert.deepEqual(res.pages, [{ y: 2 }, { x: 1 }]);
  } finally { cleanup(); }
});

test('returns all lines when limit exceeds line count', () => {
  const { dir, cleanup } = setup();
  try {
    const p = join(dir, 'small.jsonl');
    const lines = ['{"n":1}', '{"n":2}'];
    writeFileSync(p, lines.join('\n') + '\n');
    const res = readPages({ CW_OFFBOX_PAGE_STORE: p }, 100);
    assert.equal(res.records, 2);
    assert.deepEqual(res.pages, [{ n: 2 }, { n: 1 }]);
  } finally { cleanup(); }
});
