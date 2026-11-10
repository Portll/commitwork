// Parses the EPSS JSON document from the configured path, returning the object or null (monitor/app-vuln.mjs loadEpss).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEpss } from '../app-vuln.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed object when the EPSS file contains a valid JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    const data = { scores: [1, 2, 3] };
    writeFileSync(join(dir, 'epss.json'), JSON.stringify(data));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.deepEqual(r, { scores: [1, 2, 3] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), JSON.stringify([1, 2, 3]));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.deepStrictEqual(r, [1, 2, 3]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains a JSON string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), JSON.stringify('hello'));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains a JSON number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), JSON.stringify(42));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains JSON null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), JSON.stringify(null));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), 'not valid json');
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    process.env.CW_APPVULN_EPSS = join(dir, 'missing.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});

test('returns null when the EPSS file contains a JSON boolean', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpss-'));
  try {
    writeFileSync(join(dir, 'epss.json'), JSON.stringify(true));
    process.env.CW_APPVULN_EPSS = join(dir, 'epss.json');
    const r = loadEpss();
    assert.equal(r, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.CW_APPVULN_EPSS;
  }
});
