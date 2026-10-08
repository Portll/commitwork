// bin/test/adjudication-import-units.test.mjs — case tests for deriveFromCveAnnotations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveFromCveAnnotations } from '../adjudication-import.mjs';

test('empty annotations array returns empty out and skipped', () => {
  const { out, skipped } = deriveFromCveAnnotations({ annotations: [] });
  assert.deepEqual(out, []);
  assert.deepEqual(skipped, []);
});

test('missing annotations property returns empty out and skipped', () => {
  const { out, skipped } = deriveFromCveAnnotations({});
  assert.deepEqual(out, []);
  assert.deepEqual(skipped, []);
});

test('annotation missing repo is skipped with reason', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [{ id: 'CVE-1', package: 'pkg' }]
  });
  assert.equal(out.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /missing repo\/id\/package/);
});

test('annotation missing id is skipped with reason', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [{ repo: 'r', package: 'pkg' }]
  });
  assert.equal(out.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /missing repo\/id\/package/);
});

test('annotation missing package is skipped with reason', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [{ repo: 'r', id: 'CVE-1' }]
  });
  assert.equal(out.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /missing repo\/id\/package/);
});

test('valid annotation with false-positive action produces record with truth false-alarm', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [{ repo: 'r', id: 'CVE-1', package: 'pkg', action: 'false-positive', reason: 'why' }]
  });
  assert.equal(skipped.length, 0);
  assert.equal(out.length, 1);
  const rec = out[0];
  assert.equal(rec.category, 'dependency-cve');
  assert.equal(rec.repo, 'r');
  assert.equal(rec.humanVerdict, 'false-positive');
  assert.equal(rec.truth, 'false-alarm');
  assert.equal(rec.basis, 'why');
  assert.equal(rec.place, 'dependency-cve:CVE-1:pkg');
  assert.equal(rec.artifact, 'monitor/annotations.json#annotations');
  assert.equal(rec.machineVerdict, null);
  assert.equal(rec.evidence, null);
  assert.equal(rec.model, null);
  assert.equal(rec.promptId, null);
  assert.equal(rec.bornSlice, null);
  assert.equal(typeof rec.importKey, 'string');
  assert.equal(rec.importKey.length, 64);
});

test('valid annotation with accept action produces record with truth null', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [{ repo: 'r', id: 'CVE-2', package: 'pkg2', action: 'accept', reason: 'risk ok' }]
  });
  assert.equal(skipped.length, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].humanVerdict, 'accept');
  assert.equal(out[0].truth, null);
  assert.equal(out[0].place, 'dependency-cve:CVE-2:pkg2');
});

test('two valid annotations produce two records with distinct importKeys', () => {
  const { out, skipped } = deriveFromCveAnnotations({
    annotations: [
      { repo: 'r', id: 'CVE-1', package: 'pkg', action: 'false-positive', reason: 'a' },
      { repo: 'r', id: 'CVE-2', package: 'pkg', action: 'accept', reason: 'b' }
    ]
  });
  assert.equal(skipped.length, 0);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].importKey, out[1].importKey);
});
