// Derives vocabulary maps from upstream schema files (bin/vex-vocabulary-sync.mjs derive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../vex-vocabulary-sync.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('derive returns a frozen object with note, sources, total, formats, outOfScope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    assert.equal(typeof result.note, 'string');
    assert.ok(result.note.includes('DERIVED by bin/vex-vocabulary-sync.mjs'));
    assert.ok(result.note.includes('Never hand-edit'));
    assert.ok(result.note.includes('--fetch'));
    assert.equal(typeof result.sources, 'object');
    assert.equal(typeof result.total, 'number');
    assert.equal(typeof result.formats, 'object');
    assert.equal(typeof result.outOfScope, 'object');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive sources contain the three upstream URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    assert.equal(result.sources.csaf, 'https://raw.githubusercontent.com/oasis-tcs/csaf/master/csaf_2.0/json_schema/csaf_json_schema.json');
    assert.equal(result.sources.cyclonedx, 'https://raw.githubusercontent.com/CycloneDX/specification/master/schema/bom-1.5.schema.json');
    assert.equal(result.sources.openvex, 'https://raw.githubusercontent.com/openvex/spec/main/openvex_json_schema.json');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive formats has keys csaf, cyclonedx, openvex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    assert.deepEqual(Object.keys(result.formats).sort(), ['csaf', 'cyclonedx', 'openvex']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive outOfScope csaf has four version-range entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    assert.equal(Object.keys(result.outOfScope.csaf).length, 4);
    assert.ok(result.outOfScope.csaf.first_affected.includes('version-range'));
    assert.ok(result.outOfScope.csaf.last_affected.includes('version-range'));
    assert.ok(result.outOfScope.csaf.first_fixed.includes('version-range'));
    assert.ok(result.outOfScope.csaf.recommended.includes('vendor recommendation'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive total is a non-negative integer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    assert.equal(Number.isInteger(result.total), true);
    assert.ok(result.total >= 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive formats csaf has status, justification, threat, response keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    const csaf = result.formats.csaf;
    assert.ok('status' in csaf);
    assert.ok('justification' in csaf);
    assert.ok('threat' in csaf);
    assert.ok('response' in csaf);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive formats cyclonedx has status, justification, response keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    const cd = result.formats.cyclonedx;
    assert.ok('status' in cd);
    assert.ok('justification' in cd);
    assert.ok('response' in cd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive formats openvex has status and justification keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    const ov = result.formats.openvex;
    assert.ok('status' in ov);
    assert.ok('justification' in ov);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive total equals sum of all array lengths in formats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    const expected = Object.values(result.formats).reduce(
      (a, axes) => a + Object.values(axes).reduce((b, v) => b + (v ? v.length : 0), 0), 0);
    assert.equal(result.total, expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('derive total is zero when all format values are null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'derive-'));
  try {
    const result = derive();
    const allNull = Object.values(result.formats).every(
      (axes) => Object.values(axes).every((v) => v === null));
    if (allNull) {
      assert.equal(result.total, 0);
    } else {
      const expected = Object.values(result.formats).reduce(
        (a, axes) => a + Object.values(axes).reduce((b, v) => b + (v ? v.length : 0), 0), 0);
      assert.equal(result.total, expected);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
