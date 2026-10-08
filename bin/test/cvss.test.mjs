// Published FIRST values, not this implementation's output — a parser verified against itself
// certifies its own arithmetic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseScore, band, parseVector, versionOf } from '../cvss.mjs';

// vector → published base score
const PUBLISHED = [
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10.0],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],   // reflected XSS — the jQuery advisories
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H', 7.5],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N', 7.5],
  ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 7.8],
  ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N', 5.3],
  ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H', 5.9],
  ['CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 8.8],
  ['CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0.0],
];

describe('base score matches FIRST', () => {
  for (const [vector, want] of PUBLISHED) {
    test(`${vector.slice(9)} = ${want}`, () => assert.equal(baseScore(vector), want));
  }
  test('scope changes the privilege weight, not just the multiplier', () => {
    // identical but for S; one shared PR table would still produce a number, just the wrong one
    assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H'), 7.2);
    assert.equal(baseScore('CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:H'), 9.1);
  });
});

// v2 published values. CVE-2011-4969's 4.3 was read off NVD directly this session, so at least one
// anchor here is measured rather than recalled.
const PUBLISHED_V2 = [
  ['AV:N/AC:M/Au:N/C:N/I:P/A:N', 4.3],   // CVE-2011-4969
  ['AV:N/AC:L/Au:N/C:C/I:C/A:C', 10.0],
  ['AV:N/AC:L/Au:N/C:P/I:P/A:P', 7.5],
  ['AV:N/AC:L/Au:N/C:N/I:N/A:P', 5.0],
  ['AV:L/AC:L/Au:N/C:C/I:C/A:C', 7.2],
  ['AV:L/AC:L/Au:N/C:P/I:P/A:P', 4.6],
  ['AV:N/AC:L/Au:N/C:N/I:N/A:N', 0.0],
];

describe('v2 uses its own formula and its own scale', () => {
  for (const [vector, want] of PUBLISHED_V2) {
    test(`${vector} = ${want}`, () => assert.equal(baseScore(vector), want));
  }
  test('a bare v2 vector is recognised without a version prefix', () => {
    assert.equal(versionOf('AV:N/AC:M/Au:N/C:N/I:P/A:N'), '2.0');
  });
  test('v2 CEILS AT HIGH — it has no critical band', () => {
    assert.equal(band(10, '2.0'), 'high');
    assert.equal(band(9.5, '2.0'), 'high');
    assert.equal(band(10, '3.1'), 'crit', 'the ceiling must not leak into v3');
    assert.equal(band(9.8), 'crit', 'the default version stays v3');
  });
  test('a v2 vector missing Au is refused, not scored on partial weights', () => {
    assert.equal(baseScore('AV:N/AC:L/C:P/I:P/A:P'), null);
  });
});

describe('an unscorable vector is null, never a number', () => {
  // a plausible wrong score is worse than none — a reader can check it
  const UNSCORABLE = [
    ['v4 — lookup table, not this formula', 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N'],
    ['truncated', 'CVSS:3.1/AV:N/AC:L'],
    ['unknown metric value', 'CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'],
    ['missing scope', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/C:H/I:H/A:H'],
    ['not a vector', 'nonsense'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
  ];
  for (const [why, vector] of UNSCORABLE) {
    test(why, () => assert.equal(baseScore(vector), null, `${vector} scored instead of refusing`));
  }
});

test('v3.0 and v3.1 round differently and each uses its own rule', () => {
  const v = '/AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L';
  assert.equal(typeof baseScore(`CVSS:3.0${v}`), 'number');
  assert.equal(typeof baseScore(`CVSS:3.1${v}`), 'number');
});

describe('bands', () => {
  test('FIRST thresholds', () => {
    assert.equal(band(10), 'crit');
    assert.equal(band(9.0), 'crit');
    assert.equal(band(8.9), 'high');
    assert.equal(band(7.0), 'high');
    assert.equal(band(6.9), 'med');
    assert.equal(band(4.0), 'med');
    assert.equal(band(3.9), 'low');
    assert.equal(band(0.1), 'low');
  });
  test('0.0 is `none` — determinate, and deliberately not one of our four', () => {
    assert.equal(band(0), 'none');
  });
  test('an absent score is blank, which is NOT `none`', () => {
    assert.equal(band(null), '');
    assert.equal(band(undefined), '');
    assert.equal(band(NaN), '');
  });
});

test('parseVector keeps the version so an unsupported one can be refused by name', () => {
  assert.deepEqual(parseVector('CVSS:3.1/AV:N/S:U').version, '3.1');
  assert.equal(parseVector('CVSS:4.0/AV:N').version, '4.0');
  assert.equal(parseVector('AV:N/AC:L'), null);
});
