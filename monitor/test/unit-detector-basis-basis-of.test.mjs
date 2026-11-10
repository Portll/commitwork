// Maps a detector name to its declared class or the unclassified sentinel (monitor/detector-basis.mjs basisOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basisOf } from '../detector-basis.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'basisOf-'));
try {
  const p = join(dir, 'detector-basis.json');
  writeFileSync(p, JSON.stringify({
    classes: { security: {}, style: {} },
    detectors: { 'secret-scan': 'security', 'lint': 'style' }
  }));
  const map = { classes: { security: {}, style: {} }, detectors: { 'secret-scan': 'security', 'lint': 'style' } };

  test('returns the declared class for a detector present in the map', () => {
    assert.equal(basisOf('secret-scan', map), "security");
  });

  test('returns the unclassified sentinel for a detector absent from the map', () => {
    assert.equal(basisOf('missing', map), "unclassified");
  });

  test('returns the unclassified sentinel when the map has no detectors object', () => {
    assert.equal(basisOf('secret-scan', { classes: {} }), "unclassified");
  });

  test('returns the unclassified sentinel when the map is null', () => {
    assert.equal(basisOf('secret-scan', null), "unclassified");
  });

  test('returns the unclassified sentinel when the map is undefined', () => {
    assert.equal(basisOf('secret-scan', undefined), "unclassified");
  });

  test('returns the unclassified sentinel when the detector value is not a string in the map', () => {
    const m = { detectors: { 'weird': 42 } };
    assert.equal(basisOf('weird', m), "unclassified");
  });

  test('returns the unclassified sentinel when the detector value is null in the map', () => {
    const m = { detectors: { 'weird': null } };
    assert.equal(basisOf('weird', m), "unclassified");
  });

  test('returns the declared class for a detector with a non-string key in the map', () => {
    const m = { detectors: { 1: 'security' } };
    assert.equal(basisOf(1, m), "security");
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
