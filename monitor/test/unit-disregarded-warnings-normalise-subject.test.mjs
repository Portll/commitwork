// Strips trailing line and column numbers from file paths (monitor/disregarded-warnings.mjs normaliseSubject).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseSubject } from '../disregarded-warnings.mjs';

test('returns null for non-string input', () => {
  assert.equal(normaliseSubject(123), null);
  assert.equal(normaliseSubject(null), null);
  assert.equal(normaliseSubject(undefined), null);
  assert.equal(normaliseSubject({}), null);
});

test('returns null for empty or whitespace-only strings', () => {
  assert.equal(normaliseSubject(''), null);
  assert.equal(normaliseSubject('   '), null);
  assert.equal(normaliseSubject('\t\n'), null);
});

test('returns trimmed path when no line or column suffix is present', () => {
  assert.equal(normaliseSubject('  src/index.js  '), 'src/index.js');
  assert.equal(normaliseSubject('./src/index.js'), 'src/index.js');
  assert.equal(normaliseSubject('file.txt'), 'file.txt');
});

test('strips trailing line number after a letter-led extension', () => {
  assert.equal(normaliseSubject('src/index.js:123'), 'src/index.js');
  assert.equal(normaliseSubject('file.txt:1'), 'file.txt');
  assert.equal(normaliseSubject('file.mjs:9999'), 'file.mjs');
});

test('strips trailing line and column numbers after a letter-led extension', () => {
  assert.equal(normaliseSubject('src/index.js:123:7'), 'src/index.js');
  assert.equal(normaliseSubject('file.txt:1:1'), 'file.txt');
  assert.equal(normaliseSubject('file.mjs:10:20'), 'file.mjs');
});

test('does not strip port numbers from IP addresses', () => {
  assert.equal(normaliseSubject('127.0.0.1:7878'), '127.0.0.1:7878');
  assert.equal(normaliseSubject('192.168.1.1:8080'), '192.168.1.1:8080');
});

test('normalises backslashes to forward slashes before processing', () => {
  assert.equal(normaliseSubject('src\\index.js:123'), 'src/index.js');
  assert.equal(normaliseSubject('src\\index.js'), 'src/index.js');
});

test('removes leading ./ prefix before processing', () => {
  assert.equal(normaliseSubject('./src/index.js:123'), 'src/index.js');
  assert.equal(normaliseSubject('./file.txt'), 'file.txt');
});

test('handles combined backslash and ./ normalization with line suffix', () => {
  assert.equal(normaliseSubject('.\\src\\index.js:42'), 'src/index.js');
  assert.equal(normaliseSubject('./src\\index.js:42:5'), 'src/index.js');
});

test('returns the string when stripping leaves a non-empty prefix', () => {
  assert.equal(normaliseSubject(':123'), ':123');
  assert.equal(normaliseSubject('.js:123'), '.js');
});
