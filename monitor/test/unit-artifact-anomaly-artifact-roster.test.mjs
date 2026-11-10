// Category-sorted artifact filenames read from each extractor closure's source (monitor/artifact-anomaly.mjs artifactRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artifactRoster } from '../artifact-anomaly.mjs';
import { join } from 'node:path';

test('a null spec list yields an empty roster', () => {
  assert.deepEqual(artifactRoster(null), []);
});

test('a spec whose extractor is not a function is skipped even if its text looks like one', () => {
  const specs = [
    ['alpha', 'a1', (d) => join(d, 'alpha.json')],
    ['beta', 'b1', "(d, 'leak.json')"],
  ];
  assert.deepEqual(artifactRoster(specs), [
    { category: 'alpha', checkId: 'a1', filename: 'alpha.json' },
  ]);
});

test('extractors without a single-quoted literal right after a d argument are skipped', () => {
  const specs = [
    ['a', 'a1', (d) => join(d)],
    ['b', 'b1', (d) => join(d, "b.json")],
    ['c', 'c1', (dir) => join(dir, 'c.json')],
  ];
  assert.deepEqual(artifactRoster(specs), []);
});

test('an extractor closure contributes its category, check id and filename literal', () => {
  const specs = [['secrets', 'secret-scan', (d) => join(d, 'secrets.json')]];
  assert.deepEqual(artifactRoster(specs), [
    { category: 'secrets', checkId: 'secret-scan', filename: 'secrets.json' },
  ]);
});

test('only the first literal is taken and spaces around d and the comma are allowed', () => {
  const specs = [['cfg', 'c1', (d) => join( d , 'first.json') || join(d, 'second.json')]];
  assert.deepEqual(artifactRoster(specs), [
    { category: 'cfg', checkId: 'c1', filename: 'first.json' },
  ]);
});

test('entries are sorted by category in code unit order and invalid specs drop out', () => {
  const specs = [
    ['zeta', 'z1', (d) => join(d, 'z.json')],
    ['alpha', 'a1', (d) => join(d, 'a.json')],
    ['mid', 'm0', 'not-a-function'],
    ['beta', 'b1', (d) => join(d)],
    ['Zeta', 'Z1', (d) => join(d, 'upper.json')],
  ];
  assert.deepEqual(artifactRoster(specs), [
    { category: 'Zeta', checkId: 'Z1', filename: 'upper.json' },
    { category: 'alpha', checkId: 'a1', filename: 'a.json' },
    { category: 'zeta', checkId: 'z1', filename: 'z.json' },
  ]);
});

test('entries sharing a category keep their spec order', () => {
  const specs = [
    ['same', 's1', (d) => join(d, 'one.json')],
    ['same', 's2', (d) => join(d, 'two.json')],
  ];
  assert.deepEqual(artifactRoster(specs), [
    { category: 'same', checkId: 's1', filename: 'one.json' },
    { category: 'same', checkId: 's2', filename: 'two.json' },
  ]);
});

test('the sort comparator returns -1, 1 and 0 for a lower, higher and equal category', () => {
  const realSort = Array.prototype.sort;
  let captured = null;
  Array.prototype.sort = function (compare) {
    captured = compare;
    return realSort.call(this, compare);
  };
  let result;
  try {
    result = artifactRoster([]);
  } finally {
    Array.prototype.sort = realSort;
  }
  assert.deepEqual(result, []);
  const lower = { category: 'a' };
  const higher = { category: 'b' };
  const equal = { category: 'a' };
  assert.deepEqual(
    [captured(lower, higher), captured(higher, lower), captured(lower, equal)],
    [-1, 1, 0],
  );
});
