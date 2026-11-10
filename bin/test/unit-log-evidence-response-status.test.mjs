// Extracts the HTTP response status code from a log line (bin/log-evidence.mjs responseStatus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseStatus } from '../log-evidence.mjs';

test('returns 404 for Apache combined log format', () => {
  const line = '192.168.1.1 - - [10/Oct/2023:13:55:36 +0000] "GET /x HTTP/1.1" 404 1234';
  assert.equal(responseStatus(line), 404);
});

test('returns 200 for Apache combined log format with success', () => {
  const line = '192.168.1.1 - - [10/Oct/2023:13:55:36 +0000] "GET /x HTTP/1.1" 200 1234';
  assert.equal(responseStatus(line), 200);
});

test('returns 403 for arrow-style app logs', () => {
  const line = 'Request to /admin -> 403 Forbidden';
  assert.equal(responseStatus(line), 403);
});

test('returns 500 for arrow-style app logs with server error', () => {
  const line = 'Request to /api -> 500 Internal Server Error';
  assert.equal(responseStatus(line), 500);
});

test('returns 301 for key=value log format', () => {
  const line = 'method=GET path=/old status=301';
  assert.equal(responseStatus(line), 301);
});

test('returns 201 for key=value log format with colon separator', () => {
  const line = 'method=POST path=/items status: 201';
  assert.equal(responseStatus(line), 201);
});

test('returns null when no status code is present', () => {
  const line = 'Database connection established successfully';
  assert.equal(responseStatus(line), null);
});

test('returns null for PHP log without status code', () => {
  const line = 'PHP Fatal error: Uncaught Exception in /var/www/index.php on line 42';
  assert.equal(responseStatus(line), null);
});

test('returns 100 for minimum valid status code', () => {
  const line = 'Request -> 100 Continue';
  assert.equal(responseStatus(line), 100);
});

test('returns 599 for maximum valid status code', () => {
  const line = 'Request -> 599 Custom Error';
  assert.equal(responseStatus(line), 599);
});
