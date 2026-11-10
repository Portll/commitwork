// Removes words and prefixes whose normalized keys appear in the given forms (bin/lib/release-scope.mjs withoutNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withoutNames } from '../lib/release-scope.mjs';

test('drops words and prefixes whose normalized keys match the forms', () => {
  const scope = {
    words: [
      { key: 'foo', source: 's1', exempt: false },
      { key: 'bar', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'foo', source: 's1' },
      { key: 'baz', source: 's3' },
    ],
  };
  const forms = ['foo', 'FOO'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "bar", source: "s2", exempt: false, short: true, re: /bar/gi }], prefixes: [{ key: "baz", source: "s3" }], prefixRe: /(?<![A-Za-z0-9])(?:baz)[-_]/gi, fingerprint: "d96320db98f93998" });
});

test('keeps all words and prefixes when forms are empty', () => {
  const scope = {
    words: [
      { key: 'alpha', source: 's1', exempt: false },
      { key: 'beta', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'alpha', source: 's1' },
    ],
  };
  const forms = [];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "alpha", source: "s1", exempt: false, short: true, re: /alpha/gi }, { key: "beta", source: "s2", exempt: false, short: true, re: /beta/gi }], prefixes: [{ key: "alpha", source: "s1" }], prefixRe: /(?<![A-Za-z0-9])(?:alpha)[-_]/gi, fingerprint: "5d67aa8ec2927541" });
});

test('normalizes forms by lowercasing and stripping non-alphanumeric characters', () => {
  const scope = {
    words: [
      { key: 'my-key', source: 's1', exempt: false },
      { key: 'other', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'my_key', source: 's1' },
    ],
  };
  const forms = ['My-Key', 'MY KEY'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "my-key", source: "s1", exempt: false, short: false, re: /m(?:[^A-Za-z0-9\s]| )?y(?:[^A-Za-z0-9\s]| )?-(?:[^A-Za-z0-9\s]| )?k(?:[^A-Za-z0-9\s]| )?e(?:[^A-Za-z0-9\s]| )?y/gi }, { key: "other", source: "s2", exempt: false, short: true, re: /other/gi }], prefixes: [{ key: "my_key", source: "s1" }], prefixRe: /(?<![A-Za-z0-9])(?:my_key)[-_]/gi, fingerprint: "3928bc7895942148" });
});

test('filters out empty strings from forms after normalization', () => {
  const scope = {
    words: [
      { key: 'abc', source: 's1', exempt: false },
    ],
    prefixes: [
      { key: 'abc', source: 's1' },
    ],
  };
  const forms = ['', '!!!', 'abc'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [], prefixes: [], prefixRe: null, fingerprint: "643d5437104296e2" });
});

test('handles words with keys longer than five characters', () => {
  const scope = {
    words: [
      { key: 'abcdefgh', source: 's1', exempt: false },
      { key: 'short', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'abcdefgh', source: 's1' },
    ],
  };
  const forms = ['abcdefgh'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "short", source: "s2", exempt: false, short: true, re: /short/gi }], prefixes: [], prefixRe: null, fingerprint: "d5cc8649238097c6" });
});

test('handles words with keys exactly five characters long', () => {
  const scope = {
    words: [
      { key: 'abcde', source: 's1', exempt: false },
      { key: 'fghij', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'abcde', source: 's1' },
    ],
  };
  const forms = ['abcde'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "fghij", source: "s2", exempt: false, short: true, re: /fghij/gi }], prefixes: [], prefixRe: null, fingerprint: "18e3b87b5afa806b" });
});

test('handles words with keys shorter than five characters', () => {
  const scope = {
    words: [
      { key: 'ab', source: 's1', exempt: false },
      { key: 'cd', source: 's2', exempt: false },
    ],
    prefixes: [
      { key: 'ab', source: 's1' },
    ],
  };
  const forms = ['ab'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [{ key: "cd", source: "s2", exempt: false, short: true, re: /cd/gi }], prefixes: [], prefixRe: null, fingerprint: "47e18cbe8f751121" });
});

test('returns empty words and prefixes arrays when all are dropped', () => {
  const scope = {
    words: [
      { key: 'x', source: 's1', exempt: false },
    ],
    prefixes: [
      { key: 'x', source: 's1' },
    ],
  };
  const forms = ['x'];
  const r = withoutNames(scope, forms);
  assert.deepEqual(r, { words: [], prefixes: [], prefixRe: null, fingerprint: "643d5437104296e2" });
});
