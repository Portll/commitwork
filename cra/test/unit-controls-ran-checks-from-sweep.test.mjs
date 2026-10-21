// Maps each repo to the set of checks whose status is pass or fail in checks-status.json (cra/controls.mjs ranChecksFromSweep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ranChecksFromSweep } from '../controls.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty map when sweepDir is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const result = ranChecksFromSweep(null, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when sweepDir is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const result = ranChecksFromSweep(undefined, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when repos is null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const result = ranChecksFromSweep(dir, null);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when repos is undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const result = ranChecksFromSweep(dir, undefined);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when checks-status.json does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when checks-status.json is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), '{"not":"array"}');
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when checks-status.json has invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), 'not valid json');
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty map when all checks have skip status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
      { check: 'check1', status: 'skip' },
      { check: 'check2', status: 'skip' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns map with repo and checks that have pass status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
      { check: 'check1', status: 'pass' },
      { check: 'check2', status: 'skip' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 1);
    assert.ok(result.has('repoA'));
    const ran = result.get('repoA');
    assert.ok(ran.has('check1'));
    assert.ok(!ran.has('check2'));
    assert.equal(ran.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns map with repo and checks that have fail status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
      { check: 'check1', status: 'fail' },
      { check: 'check2', status: 'pass' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 1);
    assert.ok(result.has('repoA'));
    const ran = result.get('repoA');
    assert.ok(ran.has('check1'));
    assert.ok(ran.has('check2'));
    assert.equal(ran.size, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores a null check entry and keeps the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
      null,
      { check: 'check1', status: 'pass' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 1);
    assert.ok(result.has('repoA'));
    const ran = result.get('repoA');
    assert.ok(ran.has('check1'));
    assert.equal(ran.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores an entry with no check property and keeps the others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoDir = join(dir, 'repoA');
    mkdirSync(repoDir, { recursive: true });
    writeFileSync(join(repoDir, 'checks-status.json'), JSON.stringify([
      { status: 'pass' },
      { check: 'check1', status: 'pass' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA']);
    assert.equal(result.size, 1);
    assert.ok(result.has('repoA'));
    const ran = result.get('repoA');
    assert.ok(ran.has('check1'));
    assert.equal(ran.size, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns map with multiple repos having ran checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoADir = join(dir, 'repoA');
    const repoBDir = join(dir, 'repoB');
    mkdirSync(repoADir, { recursive: true });
    mkdirSync(repoBDir, { recursive: true });
    writeFileSync(join(repoADir, 'checks-status.json'), JSON.stringify([
      { check: 'check1', status: 'pass' }
    ]));
    writeFileSync(join(repoBDir, 'checks-status.json'), JSON.stringify([
      { check: 'check2', status: 'fail' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA', 'repoB']);
    assert.equal(result.size, 2);
    assert.ok(result.has('repoA'));
    assert.ok(result.has('repoB'));
    assert.ok(result.get('repoA').has('check1'));
    assert.ok(result.get('repoB').has('check2'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns map with only repos that have ran checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ranChecksFromSweep-'));
  try {
    const repoADir = join(dir, 'repoA');
    const repoBDir = join(dir, 'repoB');
    mkdirSync(repoADir, { recursive: true });
    mkdirSync(repoBDir, { recursive: true });
    writeFileSync(join(repoADir, 'checks-status.json'), JSON.stringify([
      { check: 'check1', status: 'pass' }
    ]));
    writeFileSync(join(repoBDir, 'checks-status.json'), JSON.stringify([
      { check: 'check2', status: 'skip' }
    ]));
    const result = ranChecksFromSweep(dir, ['repoA', 'repoB']);
    assert.equal(result.size, 1);
    assert.ok(result.has('repoA'));
    assert.ok(!result.has('repoB'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
