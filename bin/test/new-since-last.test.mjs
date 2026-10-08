import test from 'node:test';
import assert from 'node:assert/strict';
import { newSinceLast, newSinceLastBlock } from '../lib/new-since-last.mjs';

test('a name that joined the failing set since last run is APPEARED', () => {
  const d = newSinceLast(['old one'], ['old one', 'brand new']);
  assert.equal(d.status, 'compared');
  assert.deepEqual(d.appeared, ['brand new']);
  assert.deepEqual(d.persisting, ['old one']);
});

test('a name that left the set is CLEARED', () => {
  const d = newSinceLast(['gone', 'stays'], ['stays']);
  assert.deepEqual(d.cleared, ['gone']);
  assert.deepEqual(d.appeared, []);
});

test('NO previous record is UNKNOWN, never "everything is new"', () => {
  const d = newSinceLast(null, ['a', 'b', 'c']);
  assert.equal(d.status, 'no-baseline');
  assert.deepEqual(d.appeared, [], 'a first run must not report the standing set as fresh breakage');
  assert.equal(d.persisting.length, 3);
});

// POPULATION IS ASYMMETRIC. The first cut required prevTests === tests before comparing anything,
// which on this fleet is almost never true (7325, 7494, 7541, 7636, 7644, 7673 all seen on
// 2026-09-06) — the feature would have said "unknown" forever while looking implemented.
test('a GROWN population still reports appeared, because a new failure is still worth reading', () => {
  const d = newSinceLast(['a'], ['a', 'b'], { prevTests: 100, tests: 120 });
  assert.deepEqual(d.appeared, ['b']);
  assert.equal(d.grew, true);
  assert.equal(d.delta, 20);
});

test('a SHRUNK population withholds CLEARED — absent is not fixed when fewer cases ran', () => {
  const d = newSinceLast(['a', 'b'], ['a'], { prevTests: 120, tests: 100 });
  assert.deepEqual(d.cleared, [], 'a false "cleared" tells someone a break is fixed when nobody looked');
  assert.deepEqual(d.clearedUnknown, ['b']);
  assert.equal(d.shrank, true);
});

test('equal populations report both directions plainly', () => {
  const d = newSinceLast(['a', 'b'], ['a', 'c'], { prevTests: 100, tests: 100 });
  assert.deepEqual(d.appeared, ['c']);
  assert.deepEqual(d.cleared, ['b']);
  assert.equal(d.grew, false);
  assert.equal(d.shrank, false);
});

test('unknown case counts fall back to reporting both, since neither risk can be established', () => {
  const d = newSinceLast(['a', 'b'], ['a', 'c']);
  assert.deepEqual(d.appeared, ['c']);
  assert.deepEqual(d.cleared, ['b']);
  assert.equal(d.delta, null);
});

test('duplicates and blanks are normalised out before comparing', () => {
  const d = newSinceLast(['a'], ['a', 'a', '', '   ', 'b']);
  assert.deepEqual(d.appeared, ['b']);
});

test('the block names every new failure so it cannot be read past', () => {
  const block = newSinceLastBlock(newSinceLast(['old'], ['old', 'fresh break']));
  assert.match(block, /NEW SINCE LAST RUN \(1\)/);
  assert.match(block, /✖ fresh break/);
  assert.match(block, /1 failure\(s\) were already failing last run/);
});

test('a turn with no change prints NOTHING — an unconditional block becomes wallpaper', () => {
  assert.equal(newSinceLastBlock(newSinceLast(['same'], ['same'])), '');
  assert.equal(newSinceLastBlock(newSinceLast([], [])), '');
});

test('no previous run says unknown rather than staying silent when failures exist', () => {
  assert.match(newSinceLastBlock(newSinceLast(null, ['x'])), /unknown — no previous run/);
});

test('a grown population CAVEATS the new list instead of withholding it', () => {
  const block = newSinceLastBlock(newSinceLast(['a'], ['a', 'b'], { prevTests: 100, tests: 130 }));
  assert.match(block, /NEW SINCE LAST RUN \(1\)/);
  assert.match(block, /30 more case\(s\).*newly RUN rather than newly broken/);
});

test('a shrunk population says absent-is-not-fixed, and names the shortfall', () => {
  const block = newSinceLastBlock(newSinceLast(['a', 'b'], ['a'], { prevTests: 130, tests: 100 }));
  assert.match(block, /absent is not fixed/);
  assert.match(block, /30 FEWER case\(s\)/);
  assert.doesNotMatch(block, /CLEARED SINCE LAST RUN/);
});

test('an unknown state with NO failures stays quiet', () => {
  assert.equal(newSinceLastBlock(newSinceLast(null, [])), '');
});

test('the printed list is capped and says how many it withheld', () => {
  const many = Array.from({ length: 25 }, (_, i) => `t${i}`);
  const block = newSinceLastBlock(newSinceLast([], many), { limit: 3 });
  assert.match(block, /NEW SINCE LAST RUN \(25\)/);
  assert.match(block, /…and 22 more/);
});
