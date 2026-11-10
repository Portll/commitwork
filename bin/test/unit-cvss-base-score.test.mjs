// Computes the CVSS base score from a vector string (bin/cvss.mjs baseScore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseScore } from '../cvss.mjs';

test('returns null for an unparseable vector', () => {
  assert.equal(baseScore('not-a-vector'), null);
});

test('computes the v2.0 base score for a full vector', () => {
  assert.equal(baseScore('AV:N/AC:L/Au:N/C:P/I:P/A:P'), 7.5);
});

test('returns null for an unsupported version', () => {
  assert.equal(baseScore('CVSS:4.0/AV:N/AC:L/UI:N/PR:N/S:U/C:H/I:H/A:H'), null);
});

test('returns null when the scope is invalid', () => {
  assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/UI:N/PR:N/S:X/C:H/I:H/A:H'), null);
});

test('returns null when a metric value is missing', () => {
  assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/UI:N/PR:N/S:U/C:H/I:H'), null);
});

test('returns zero when the impact is zero', () => {
  assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/UI:N/PR:N/S:U/C:N/I:N/A:N'), 0);
});

test('computes the v3.1 base score with unchanged scope', () => {
  assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/UI:N/PR:N/S:U/C:H/I:H/A:H'), 9.8);
});

test('computes the v3.0 base score with changed scope', () => {
  assert.equal(baseScore('CVSS:3.0/AV:N/AC:L/UI:N/PR:N/S:C/C:H/I:H/A:H'), 10);
});
