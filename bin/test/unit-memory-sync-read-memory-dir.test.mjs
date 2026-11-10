// Reads a directory of memory markdown files, parses their frontmatter, and groups them by MEMORY.md headings. (bin/memory-sync.mjs readMemoryDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMemoryDir } from '../memory-sync.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty arrays and zero indexed when the directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: [], parsed: [], unreadable: [], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('excludes MEMORY.md from the files list and counts its headings as indexed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'MEMORY.md'), '## Group A\n- [a](a.md)\n## Group B\n- [b](b.md)\n');
    writeFileSync(join(dir, 'a.md'), '---\nname: a\ndescription: da\ntype: ref\n---\nbody a\n');
    writeFileSync(join(dir, 'b.md'), '---\nname: b\ndescription: db\ntype: ref\n---\nbody b\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md", "b.md"], parsed: [{ file: "a.md", group: "Group A", name: "a", description: "da", type: "ref", body: "body a" }, { file: "b.md", group: "Group B", name: "b", description: "db", type: "ref", body: "body b" }], unreadable: [], indexed: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes non-markdown files in the files list when the filter uses OR instead of AND', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'notes.txt'), 'not markdown');
    writeFileSync(join(dir, 'a.md'), '---\nname: a\ndescription: da\ntype: ref\n---\nbody a\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md"], parsed: [{ file: "a.md", group: null, name: "a", description: "da", type: "ref", body: "body a" }], unreadable: [], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets group to null when the slug is not present in the index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'MEMORY.md'), '## Group A\n- [a](a.md)\n');
    writeFileSync(join(dir, 'a.md'), '---\nname: a\ndescription: da\ntype: ref\n---\nbody a\n');
    writeFileSync(join(dir, 'c.md'), '---\nname: c\ndescription: dc\ntype: ref\n---\nbody c\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md", "c.md"], parsed: [{ file: "a.md", group: "Group A", name: "a", description: "da", type: "ref", body: "body a" }, { file: "c.md", group: null, name: "c", description: "dc", type: "ref", body: "body c" }], unreadable: [], indexed: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('moves a file with missing description into unreadable with the parse error reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'a.md'), '---\nname: a\ntype: ref\n---\nbody a\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md"], parsed: [], unreadable: [{ file: "a.md", reason: "frontmatter has no description" }], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('moves a file with no frontmatter block into unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'a.md'), 'just a plain body without frontmatter\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md"], parsed: [], unreadable: [{ file: "a.md", reason: "no frontmatter block" }], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('moves a file with an empty body into unreadable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'a.md'), '---\nname: a\ndescription: da\ntype: ref\n---\n   \n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["a.md"], parsed: [], unreadable: [{ file: "a.md", reason: "body is empty" }], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts the files list alphabetically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readMemoryDir-'));
  try {
    writeFileSync(join(dir, 'zeta.md'), '---\nname: zeta\ndescription: dz\ntype: ref\n---\nbody z\n');
    writeFileSync(join(dir, 'alpha.md'), '---\nname: alpha\ndescription: da\ntype: ref\n---\nbody a\n');
    writeFileSync(join(dir, 'mid.md'), '---\nname: mid\ndescription: dm\ntype: ref\n---\nbody m\n');
    const r = readMemoryDir(dir);
    assert.deepEqual(r, { files: ["alpha.md", "mid.md", "zeta.md"], parsed: [{ file: "alpha.md", group: null, name: "alpha", description: "da", type: "ref", body: "body a" }, { file: "mid.md", group: null, name: "mid", description: "dm", type: "ref", body: "body m" }, { file: "zeta.md", group: null, name: "zeta", description: "dz", type: "ref", body: "body z" }], unreadable: [], indexed: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
