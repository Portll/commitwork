// Computes the file URL for the perf tuning module, honoring CW_PERF_TUNING (admin/routes/perf.mjs tuningModuleUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuningModuleUrl } from '../routes/perf.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isAbsolute, resolve, dirname } from 'node:path';

test('returns default monitor perf-tuning URL when CW_PERF_TUNING is unset', () => {
  const saved = process.env.CW_PERF_TUNING;
  delete process.env.CW_PERF_TUNING;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const expected = pathToFileURL(resolve(here, '..', '..', 'monitor', 'perf-tuning.mjs')).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
  }
});

test('returns file URL for absolute CW_PERF_TUNING path', () => {
  const saved = process.env.CW_PERF_TUNING;
  const absPath = '/tmp/custom-tuning.mjs';
  process.env.CW_PERF_TUNING = absPath;
  try {
    const expected = pathToFileURL(absPath).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('resolves relative CW_PERF_TUNING against process.cwd()', () => {
  const saved = process.env.CW_PERF_TUNING;
  const relPath = 'custom/tuning.mjs';
  process.env.CW_PERF_TUNING = relPath;
  try {
    const expected = pathToFileURL(resolve(process.cwd(), relPath)).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('returns file URL for CW_PERF_TUNING with dot segments', () => {
  const saved = process.env.CW_PERF_TUNING;
  const relPath = './sub/../tuning.mjs';
  process.env.CW_PERF_TUNING = relPath;
  try {
    const expected = pathToFileURL(resolve(process.cwd(), relPath)).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('handles CW_PERF_TUNING as empty string by using default', () => {
  const saved = process.env.CW_PERF_TUNING;
  process.env.CW_PERF_TUNING = '';
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const expected = pathToFileURL(resolve(here, '..', '..', 'monitor', 'perf-tuning.mjs')).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('returns file URL for absolute path with trailing slash', () => {
  const saved = process.env.CW_PERF_TUNING;
  const absPath = '/tmp/tuning/';
  process.env.CW_PERF_TUNING = absPath;
  try {
    const expected = pathToFileURL(absPath).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('resolves relative path with parent directory traversal', () => {
  const saved = process.env.CW_PERF_TUNING;
  const relPath = '../other/tuning.mjs';
  process.env.CW_PERF_TUNING = relPath;
  try {
    const expected = pathToFileURL(resolve(process.cwd(), relPath)).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});

test('handles CW_PERF_TUNING with spaces in path', () => {
  const saved = process.env.CW_PERF_TUNING;
  const relPath = 'my tuning module.mjs';
  process.env.CW_PERF_TUNING = relPath;
  try {
    const expected = pathToFileURL(resolve(process.cwd(), relPath)).href;
    assert.equal(tuningModuleUrl(), expected);
  } finally {
    if (saved !== undefined) process.env.CW_PERF_TUNING = saved;
    else delete process.env.CW_PERF_TUNING;
  }
});
