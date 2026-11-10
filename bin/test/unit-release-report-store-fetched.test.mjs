// Writes fetched release text to a timestamped JSON file under the releases directory (bin/release-report.mjs storeFetched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeFetched } from '../release-report.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('stores fetched text in a file named from the timestamp with dashes and colons stripped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('openssl', 'hello', '2024-01-15T10:30:00.123Z');
    const expected = join(dir, 'openssl', '20240115T103000Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stores fetched text in a file named from a timestamp without fractional seconds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('curl', 'world', '2024-02-20T08:00:00Z');
    const expected = join(dir, 'curl', '20240220T080000Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates the product subdirectory when it does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('newproduct', 'data', '2024-03-01T00:00:00.000Z');
    const expected = join(dir, 'newproduct', '20240301T000000Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the exact text content to the returned file path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('openssl', 'exact-content', '2024-04-05T12:00:00.456Z');
    assert.equal(readFileSync(result, 'utf8'), 'exact-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a path that exists after writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('git', 'gitdata', '2024-05-10T09:15:30.789Z');
    const expected = join(dir, 'git', '20240510T091530Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a product name with special characters in the directory path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('my-product', 'special', '2024-06-15T23:59:59.999Z');
    const expected = join(dir, 'my-product', '20240615T235959Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stores empty text content without error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('empty', '', '2024-07-01T00:00:00.001Z');
    const expected = join(dir, 'empty', '20240701T000000Z.json');
    assert.equal(result, expected);
    assert.equal(readFileSync(result, 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('strips all dashes and colons from the timestamp in the filename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('p', 't', '2024-12-31T23:59:59.123Z');
    const expected = join(dir, 'p', '20241231T235959Z.json');
    assert.equal(result, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('creates nested product directories when recursive mkdir is used', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storeFetched-'));
  process.env.CW_RELEASES_DIR = dir;
  try {
    const result = storeFetched('a/b', 'nested', '2024-01-01T00:00:00.000Z');
    const expected = join(dir, 'a', 'b', '20240101T000000Z.json');
    assert.equal(result, expected);
    assert.equal(readFileSync(result, 'utf8'), 'nested');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
