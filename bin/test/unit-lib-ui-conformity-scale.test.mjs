// Computes the type and spacing scale from docs/THEME.md (bin/lib/ui-conformity.mjs scale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale } from '../lib/ui-conformity.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeTypeRows(count, start = 1) {
  return Array.from({ length: count }, (_, i) => `| \`.t-${String.fromCharCode(97 + i)}\` | ${start + i} |`).join('\n');
}

function makeSpaceLine(count) {
  return '`' + Array.from({ length: count }, (_, i) => `${i + 1}`).join(' \u00b7 ') + '` rem';
}

const validTypeRows8 = makeTypeRows(8);
const validSpaceLine10 = makeSpaceLine(10);
const validMd = validTypeRows8 + '\n' + validSpaceLine10 + '\n';

test('returns an error when docs/THEME.md is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    const result = scale({ root: dir });
    assert.deepEqual(result, { error: 'docs/THEME.md could not be read (ENOENT)' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the type table has seven steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const shortType = makeTypeRows(7);
    writeFileSync(join(dir, 'docs/THEME.md'), shortType + '\n' + validSpaceLine10 + '\n');
    const result = scale({ root: dir });
    assert.deepEqual(result, { error: 'docs/THEME.md \u00a74.3 yielded only 7 type steps \u2014 the table shape has changed' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an error when the spacing list has nine steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const shortSpace = makeSpaceLine(9);
    writeFileSync(join(dir, 'docs/THEME.md'), validTypeRows8 + '\n' + shortSpace + '\n');
    const result = scale({ root: dir });
    assert.deepEqual(result, { error: 'docs/THEME.md \u00a75.1 yielded only 9 spacing steps \u2014 the list shape has changed' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the parsed scale for a valid theme with eight type steps and ten spacing steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), validMd);
    const result = scale({ root: dir });
    assert.deepEqual(result.type, ['1', '2', '3', '4', '5', '6', '7', '8']);
    assert.deepEqual(result.space, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    assert.deepEqual(result.all, new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']));
    assert.equal(typeof result.norm, 'function');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts exactly eight type steps at the boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), validTypeRows8 + '\n' + validSpaceLine10 + '\n');
    const result = scale({ root: dir });
    assert.deepEqual(result.type.length, 8);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts exactly ten spacing steps at the boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), validTypeRows8 + '\n' + validSpaceLine10 + '\n');
    const result = scale({ root: dir });
    assert.deepEqual(result.space.length, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('error message for type steps references section 4.3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), makeTypeRows(7) + '\n' + validSpaceLine10 + '\n');
    const result = scale({ root: dir });
    assert.ok(result.error.includes('\u00a74.3'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('error message for spacing steps references section 5.1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scale-'));
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/THEME.md'), validTypeRows8 + '\n' + makeSpaceLine(9) + '\n');
    const result = scale({ root: dir });
    assert.ok(result.error.includes('\u00a75.1'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
