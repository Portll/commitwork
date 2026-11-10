// Detects numeric values in a guide page that are not covered by measured figures (bin/lib/docsite-figures.mjs unregistered).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unregistered } from '../lib/docsite-figures.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an error with empty covered and unregistered when the page is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    const result = unregistered({ root: dir, page: 'nope.md' });
    assert.deepEqual(result, { error: "nope.md could not be read (ENOENT)", covered: [], unregistered: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a number as covered when it appears in the measured figures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'The count is 42 things.');
    const result = unregistered({ root: dir, page: 'page.md', measured: [{ measured: '42' }] });
    assert.deepEqual(result, { covered: [{ value: "42", context: "The count is 42 things." }], unregistered: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a number as covered when it matches a section-number exemption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), '## 01 \u2014 Intro');
    const result = unregistered({ root: dir, page: 'page.md', measured: [] });
    assert.deepEqual(result, { covered: [{ value: "01", context: "## 01 \u2014 Intro", exempt: "a section number: the \"## 01 \u2014 \u2026\" heading form, matched with the em dash that follows it" }], unregistered: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('marks a number as covered when it matches an IEC standard exemption', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'per IEC 61882 rules');
    const result = unregistered({ root: dir, page: 'page.md', measured: [] });
    assert.deepEqual(result, { covered: [{ value: "61882", context: "per IEC 61882 rules", exempt: "the number of a standard, matched only where IEC precedes it: not a measurement" }], unregistered: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a number as unregistered when it is not covered or exempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'there are 99 items here');
    const result = unregistered({ root: dir, page: 'page.md', measured: [] });
    assert.deepEqual(result, { covered: [], unregistered: [{ value: "99", context: "there are 99 items here" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('splits a slash-delimited measured value into separate covered parts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'we have 3 of 10 done');
    const result = unregistered({ root: dir, page: 'page.md', measured: [{ measured: '3/10' }] });
    assert.deepEqual(result, { covered: [{ value: "3", context: "we have 3 of 10 done" }, { value: "10", context: "we have 3 of 10 done" }], unregistered: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('exempts a section number only when the em dash follows it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'step 01 is first');
    const result = unregistered({ root: dir, page: 'page.md', measured: [] });
    assert.deepEqual(result, { covered: [], unregistered: [{ value: "01", context: "step 01 is first" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not exempt a standard number when IEC does not precede it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unregistered-'));
  try {
    writeFileSync(join(dir, 'page.md'), 'code 61882 applies');
    const result = unregistered({ root: dir, page: 'page.md', measured: [] });
    assert.deepEqual(result, { covered: [], unregistered: [{ value: "61882", context: "code 61882 applies" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
