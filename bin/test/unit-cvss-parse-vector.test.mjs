// Parses a CVSS vector string into version and metrics (bin/cvss.mjs parseVector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVector } from '../cvss.mjs';

test('returns null for empty string', () => {
  const r = parseVector('');
  assert.deepEqual(r, null);
});

test('returns null for null input', () => {
  const r = parseVector(null);
  assert.deepEqual(r, null);
});

test('returns null for undefined input', () => {
  const r = parseVector(undefined);
  assert.deepEqual(r, null);
});

test('parses CVSS 3.1 vector with version and metrics', () => {
  const r = parseVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
  assert.deepEqual(r, { version: "3.1", metrics: { AV: "N", AC: "L", PR: "N", UI: "N", S: "U", C: "H", I: "H", A: "H" } });
});

test('parses CVSS 3.0 vector with version and metrics', () => {
  const r = parseVector('CVSS:3.0/AV:L/AC:H/PR:L/UI:R/S:C/C:L/I:L/A:N');
  assert.deepEqual(r, { version: "3.0", metrics: { AV: "L", AC: "H", PR: "L", UI: "R", S: "C", C: "L", I: "L", A: "N" } });
});

test('parses CVSS 2.0 vector without version prefix', () => {
  const r = parseVector('AV:N/AC:M/Au:S/C:P/I:P/A:P');
  assert.deepEqual(r, { version: "2.0", metrics: { AV: "N", AC: "M", Au: "S", C: "P", I: "P", A: "P" } });
});

test('parses CVSS 2.0 vector with Au:M', () => {
  const r = parseVector('AV:A/AC:L/Au:M/C:N/I:N/A:N');
  assert.deepEqual(r, { version: "2.0", metrics: { AV: "A", AC: "L", Au: "M", C: "N", I: "N", A: "N" } });
});

test('returns null for malformed vector without version or v2 shape', () => {
  const r = parseVector('AV:N/AC:L/PR:N');
  assert.deepEqual(r, null);
});

test('parses CVSS 3.1 vector with single metric', () => {
  const r = parseVector('CVSS:3.1/AV:N');
  assert.deepEqual(r, { version: "3.1", metrics: { AV: "N" } });
});

test('parses CVSS 2.0 vector with Au:S and all metrics', () => {
  const r = parseVector('AV:L/AC:H/Au:S/C:C/I:C/A:C');
  assert.deepEqual(r, { version: "2.0", metrics: { AV: "L", AC: "H", Au: "S", C: "C", I: "C", A: "C" } });
});
