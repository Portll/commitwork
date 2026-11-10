// Strips commit SHAs from verified-against stamps in markdown files (bin/lib/release-candidate-core.mjs dateOnlyStamps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateOnlyStamps } from '../lib/release-candidate-core.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('skips non-markdown files and returns empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'file.txt'), 'content');
    const r = dateOnlyStamps(dir, ['file.txt']);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when no stamp is found in markdown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'file.md'), 'no stamp here');
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips SHA from stamp on first line and writes file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'file.md'), '<!-- verified-against: 2024-01-15 abc1234 -->\nrest');
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, ["file.md"]);
    assert.equal(readFileSync(join(dir, 'file.md'), 'utf8'), "<!-- verified-against: 2024-01-15 -->\nrest");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips SHA from stamp on tenth line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    const lines = Array.from({ length: 9 }, () => 'filler');
    lines.push('<!-- verified-against: 2024-02-20 def5678 -->');
    writeFileSync(join(dir, 'file.md'), lines.join('\n'));
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, ["file.md"]);
    assert.equal(readFileSync(join(dir, 'file.md'), 'utf8'), "filler\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\n<!-- verified-against: 2024-02-20 -->");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not modify stamp on eleventh line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    const lines = Array.from({ length: 10 }, () => 'filler');
    lines.push('<!-- verified-against: 2024-03-25 ghi9012 -->');
    writeFileSync(join(dir, 'file.md'), lines.join('\n'));
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, []);
    assert.equal(readFileSync(join(dir, 'file.md'), 'utf8'), "filler\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\nfiller\n<!-- verified-against: 2024-03-25 ghi9012 -->");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips SHA from stamp on second line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'file.md'), 'first line\n<!-- verified-against: 2024-04-30 jkl3456 -->');
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, []);
    assert.equal(readFileSync(join(dir, 'file.md'), 'utf8'), "first line\n<!-- verified-against: 2024-04-30 jkl3456 -->");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves date and closing comment when stripping SHA', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'file.md'), '<!-- verified-against: 2024-05-10 mno7890 -->');
    const r = dateOnlyStamps(dir, ['file.md']);
    assert.deepEqual(r, []);
    assert.equal(readFileSync(join(dir, 'file.md'), 'utf8'), "<!-- verified-against: 2024-05-10 mno7890 -->");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple files with mixed results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dateOnlyStamps-'));
  try {
    writeFileSync(join(dir, 'a.md'), '<!-- verified-against: 2024-06-15 pqr1234 -->');
    writeFileSync(join(dir, 'b.md'), 'no stamp');
    writeFileSync(join(dir, 'c.txt'), '<!-- verified-against: 2024-06-15 stu5678 -->');
    const r = dateOnlyStamps(dir, ['a.md', 'b.md', 'c.txt']);
    assert.deepEqual(r, []);
    assert.equal(readFileSync(join(dir, 'a.md'), 'utf8'), "<!-- verified-against: 2024-06-15 pqr1234 -->");
    assert.equal(readFileSync(join(dir, 'b.md'), 'utf8'), "no stamp");
    assert.equal(readFileSync(join(dir, 'c.txt'), 'utf8'), "<!-- verified-against: 2024-06-15 stu5678 -->");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
