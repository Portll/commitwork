// Maps yarn.lock text to a Map of package names to Sets of versions (bin/yarn-audit.mjs parseYarnLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYarnLock } from '../yarn-audit.mjs';

test('parses a single package with one version', () => {
  const text = '"lodash@^4.17.21":\n  version "4.17.21"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["lodash", new Set(["4.17.21"])]]));
});

test('parses a scoped package with one version', () => {
  const text = '"@babel/core@^7.0.0":\n  version "7.20.0"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["@babel/core", new Set(["7.20.0"])]]));
});

test('parses multiple ranges for the same package into one entry', () => {
  const text = '"react@^18.0.0", "react@^18.2.0":\n  version "18.2.0"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["react", new Set(["18.2.0"])]]));
});

test('parses multiple packages with distinct versions', () => {
  const text = '"a@^1.0.0":\n  version "1.0.0"\n"b@^2.0.0":\n  version "2.0.0"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["a", new Set(["1.0.0"])], ["b", new Set(["2.0.0"])]]));
});

test('collects multiple versions for the same package name', () => {
  const text = '"a@^1.0.0":\n  version "1.0.0"\n"a@^2.0.0":\n  version "2.0.0"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["a", new Set(["1.0.0", "2.0.0"])]]));
});

test('ignores comment lines and blank lines', () => {
  const text = '# comment\n\n"pkg@^1.0.0":\n  version "1.0.0"\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([["pkg", new Set(["1.0.0"])]]));
});

test('returns an empty map for empty input', () => {
  const r = parseYarnLock('');
  assert.deepEqual(r, new Map([]));
});

test('handles a package name with no version line', () => {
  const text = '"orphan@^1.0.0":\n';
  const r = parseYarnLock(text);
  assert.deepEqual(r, new Map([]));
});
