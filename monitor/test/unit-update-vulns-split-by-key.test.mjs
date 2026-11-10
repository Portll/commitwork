// Groups matches by the prefix of artifactId before the first '#' (monitor/update-vulns.mjs splitByKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitByKey } from '../update-vulns.mjs';

test('groups matches with the same artifactId prefix into one key', () => {
  const matches = [
    { artifactId: 'pkg#1', name: 'a' },
    { artifactId: 'pkg#2', name: 'b' },
    { artifactId: 'other#1', name: 'c' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["pkg", [{ artifactId: "pkg#1", name: "a" }, { artifactId: "pkg#2", name: "b" }]], ["other", [{ artifactId: "other#1", name: "c" }]]]));
});

test('handles artifactId without a separator by using the whole string as key', () => {
  const matches = [
    { artifactId: 'plain', name: 'x' },
    { artifactId: 'plain', name: 'y' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["plain", [{ artifactId: "plain", name: "x" }, { artifactId: "plain", name: "y" }]]]));
});

test('returns an empty map when given an empty array', () => {
  const r = splitByKey([]);
  assert.deepEqual(r, new Map([]));
});

test('treats missing artifactId as an empty string key', () => {
  const matches = [
    { name: 'no-id' },
    { artifactId: '', name: 'empty-id' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["", [{ name: "no-id" }, { artifactId: "", name: "empty-id" }]]]));
});

test('treats null artifactId as an empty string key', () => {
  const matches = [
    { artifactId: null, name: 'null-id' },
    { artifactId: undefined, name: 'undef-id' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["", [{ artifactId: null, name: "null-id" }, { artifactId: undefined, name: "undef-id" }]]]));
});

test('preserves order of matches within each key group', () => {
  const matches = [
    { artifactId: 'k#a', name: 'first' },
    { artifactId: 'k#b', name: 'second' },
    { artifactId: 'k#c', name: 'third' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["k", [{ artifactId: "k#a", name: "first" }, { artifactId: "k#b", name: "second" }, { artifactId: "k#c", name: "third" }]]]));
});

test('separates keys that differ only after the separator', () => {
  const matches = [
    { artifactId: 'base#suffix1', name: 's1' },
    { artifactId: 'base#suffix2', name: 's2' },
    { artifactId: 'base2#suffix1', name: 's3' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["base", [{ artifactId: "base#suffix1", name: "s1" }, { artifactId: "base#suffix2", name: "s2" }]], ["base2", [{ artifactId: "base2#suffix1", name: "s3" }]]]));
});

test('handles multiple separators by taking only the first segment', () => {
  const matches = [
    { artifactId: 'a#b#c', name: 'multi' },
    { artifactId: 'a#d', name: 'other' }
  ];
  const r = splitByKey(matches);
  assert.deepEqual(r, new Map([["a", [{ artifactId: "a#b#c", name: "multi" }, { artifactId: "a#d", name: "other" }]]]));
});
