// Shifts existing archive generations up by one (bin/lib/ledger-rotate.mjs shiftArchives).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftArchives } from '../lib/ledger-rotate.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('shifts a single archive generation from 1 to 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    writeFileSync(`${fp}.1`, 'gen1');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.2`), true);
    assert.equal(existsSync(`${fp}.1`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shifts multiple archive generations in reverse order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    writeFileSync(`${fp}.1`, 'gen1');
    writeFileSync(`${fp}.2`, 'gen2');
    writeFileSync(`${fp}.3`, 'gen3');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.4`), true);
    assert.equal(existsSync(`${fp}.3`), true);
    assert.equal(existsSync(`${fp}.2`), true);
    assert.equal(existsSync(`${fp}.1`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores missing archive files during shift', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    writeFileSync(`${fp}.1`, 'gen1');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.2`), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does nothing when no archive generations exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    writeFileSync(fp, 'current');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.1`), false);
    assert.equal(existsSync(`${fp}.2`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shifts non-consecutive archive generations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    writeFileSync(`${fp}.1`, 'gen1');
    writeFileSync(`${fp}.5`, 'gen5');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.2`), true);
    assert.equal(existsSync(`${fp}.6`), true);
    assert.equal(existsSync(`${fp}.5`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shifts archive generation with large number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shiftArchives-'));
  try {
    const fp = join(dir, 'ledger.json');
    const n = 1000;
    writeFileSync(`${fp}.${n}`, 'gen1000');
    shiftArchives(fp);
    assert.equal(existsSync(`${fp}.${n + 1}`), true);
    assert.equal(existsSync(`${fp}.${n}`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
