// Extracts auto_prepend_file and auto_append_file directives from text (bin/webshell-detect.mjs autoPrepends).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPrepends } from '../webshell-detect.mjs';

test('returns empty array when no directives are present', () => {
  const input = 'some random text\nno directives here';
  assert.deepEqual(autoPrepends(input), []);
});

test('extracts auto_prepend_file with equals sign and single quotes', () => {
  const input = 'auto_prepend_file = "/etc/php/prepend.php"';
  assert.deepEqual(autoPrepends(input), [{ kind: 'prepend', target: '/etc/php/prepend.php' }]);
});

test('extracts auto_append_file with space separator and double quotes', () => {
  const input = 'auto_append_file "/var/www/append.php"';
  assert.deepEqual(autoPrepends(input), [{ kind: 'append', target: '/var/www/append.php' }]);
});

test('extracts php_value auto_prepend_file with equals sign', () => {
  const input = 'php_value auto_prepend_file = /tmp/evil.php';
  assert.deepEqual(autoPrepends(input), [{ kind: 'prepend', target: '/tmp/evil.php' }]);
});

test('extracts multiple directives in a single text block', () => {
  const input = 'auto_prepend_file "/a.php"\nauto_append_file "/b.php"';
  assert.deepEqual(autoPrepends(input), [
    { kind: 'prepend', target: '/a.php' },
    { kind: 'append', target: '/b.php' }
  ]);
});

test('handles leading whitespace before directive', () => {
  const input = '   auto_prepend_file "/indented.php"';
  assert.deepEqual(autoPrepends(input), [{ kind: 'prepend', target: '/indented.php' }]);
});

test('lowercases the kind field regardless of input case', () => {
  const input = 'AUTO_PREPEND_FILE "/upper.php"';
  assert.deepEqual(autoPrepends(input), [{ kind: 'prepend', target: '/upper.php' }]);
});

test('extracts target without quotes when no quote characters follow', () => {
  const input = 'auto_prepend_file /unquoted/path.php';
  assert.deepEqual(autoPrepends(input), [{ kind: 'prepend', target: '/unquoted/path.php' }]);
});
