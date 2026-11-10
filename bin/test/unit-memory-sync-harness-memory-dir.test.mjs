// The per-project harness memory directory path for a working directory (bin/memory-sync.mjs harnessMemoryDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harnessMemoryDir } from '../memory-sync.mjs';

test('returns the CW_HARNESS_MEMORY_DIR value verbatim when it is set', () => {
  const r = harnessMemoryDir({ env: { CW_HARNESS_MEMORY_DIR: '/custom/dir', HOME: '/env/home' }, root: '/a/b', home: '/h' });
  assert.equal(r, '/custom/dir');
});

test('an empty CW_HARNESS_MEMORY_DIR falls through to the derived path under env.HOME', () => {
  const r = harnessMemoryDir({ env: { CW_HARNESS_MEMORY_DIR: '', HOME: '/env/home' }, root: '/proj', home: null });
  assert.equal(r, '/env/home/.claude/projects/-proj/memory');
});

test('the home parameter wins over env.HOME when both are set', () => {
  const r = harnessMemoryDir({ env: { HOME: '/env/home' }, root: '/proj', home: '/param/home' });
  assert.equal(r, '/param/home/.claude/projects/-proj/memory');
});

test('the home parameter is used when env.HOME is unset', () => {
  const r = harnessMemoryDir({ env: {}, root: '/proj', home: '/param/home' });
  assert.equal(r, '/param/home/.claude/projects/-proj/memory');
});

test('env.HOME is used when the home parameter is null', () => {
  const r = harnessMemoryDir({ env: { HOME: '/env/home' }, root: '/proj', home: null });
  assert.equal(r, '/env/home/.claude/projects/-proj/memory');
});

test('env.HOME is used when the home parameter is omitted and every slash in root becomes a dash', () => {
  const r = harnessMemoryDir({ env: { HOME: '/env/home' }, root: '/a/b/c' });
  assert.equal(r, '/env/home/.claude/projects/-a-b-c/memory');
});

test('an empty home parameter falls through to env.HOME', () => {
  const r = harnessMemoryDir({ env: { HOME: '/env/home' }, root: '/proj', home: '' });
  assert.equal(r, '/env/home/.claude/projects/-proj/memory');
});

test('a relative root without a leading slash gets no leading dash', () => {
  const r = harnessMemoryDir({ env: { HOME: '/env/home' }, root: 'work/repo', home: '/h' });
  assert.equal(r, '/h/.claude/projects/work-repo/memory');
});
