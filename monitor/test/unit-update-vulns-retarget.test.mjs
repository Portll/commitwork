// Replaces version in purl and CPEs (monitor/update-vulns.mjs retarget).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retarget } from '../update-vulns.mjs';

test('replaces version in purl when it ends with the old version', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: [] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: [], version: "2.0.0" });
});

test('keeps purl unchanged when it does not end with the old version', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: [] }, '9.9.9', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@1.0.0", cpes: [], version: "2.0.0" });
});

test('keeps purl unchanged when it is not a string', () => {
  const r = retarget({ purl: 123, cpes: [] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: 123, cpes: [], version: "2.0.0" });
});

test('replaces version in string CPE when version field matches', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: ['cpe:2.3:a:vendor:product:1.0.0:*:*:*:*:*:*'] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: ["cpe:2.3:a:vendor:product:2.0.0:*:*:*:*:*:*"], version: "2.0.0" });
});

test('keeps string CPE unchanged when version field does not match', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: ['cpe:2.3:a:vendor:product:9.9.9:*:*:*:*:*:*'] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: ["cpe:2.3:a:vendor:product:9.9.9:*:*:*:*:*:*"], version: "2.0.0" });
});

test('replaces version in object CPE when version field matches', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: [{ cpe: 'cpe:2.3:a:vendor:product:1.0.0:*:*:*:*:*:*', other: 'x' }] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: [{ cpe: "cpe:2.3:a:vendor:product:2.0.0:*:*:*:*:*:*", other: "x" }], version: "2.0.0" });
});

test('keeps object CPE unchanged when version field does not match', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: [{ cpe: 'cpe:2.3:a:vendor:product:9.9.9:*:*:*:*:*:*', other: 'x' }] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: [{ cpe: "cpe:2.3:a:vendor:product:9.9.9:*:*:*:*:*:*", other: "x" }], version: "2.0.0" });
});

test('handles CPE with exactly 5 parts without modification', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: ['cpe:2.3:a:vendor:product:1.0.0'] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: ["cpe:2.3:a:vendor:product:2.0.0"], version: "2.0.0" });
});

test('handles CPE with 6 parts where version matches', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: ['cpe:2.3:a:vendor:product:1.0.0:1.0.0'] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: ["cpe:2.3:a:vendor:product:2.0.0:1.0.0"], version: "2.0.0" });
});

test('handles CPE with 6 parts where version does not match', () => {
  const r = retarget({ purl: 'pkg:npm/left-pad@1.0.0', cpes: ['cpe:2.3:a:vendor:product:9.9.9:1.0.0'] }, '1.0.0', '2.0.0');
  assert.deepEqual(r, { purl: "pkg:npm/left-pad@2.0.0", cpes: ["cpe:2.3:a:vendor:product:9.9.9:1.0.0"], version: "2.0.0" });
});
