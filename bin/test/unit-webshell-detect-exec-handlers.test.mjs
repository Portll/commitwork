// Extracts risky file extensions from Apache AddHandler/AddType directives (bin/webshell-detect.mjs execHandlers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execHandlers } from '../webshell-detect.mjs';

test('returns empty array for text with no handler directives', () => {
  const text = 'ServerName example.com\nDocumentRoot /var/www/html';
  assert.deepEqual(execHandlers(text), []);
});

test('returns empty array when handler maps only safe extensions', () => {
  const text = 'AddHandler cgi-script .py .rb .pl';
  assert.deepEqual(execHandlers(text), []);
});

test('returns empty array when handler maps php extensions which are not in the risky list', () => {
  const text = 'AddHandler cgi-script .php .phtml';
  assert.deepEqual(execHandlers(text), []);
});

test('returns risky extensions when handler maps media extensions', () => {
  const text = 'AddHandler application/x-httpd-php .jpg .png';
  assert.deepEqual(execHandlers(text), [['jpg', 'png']]);
});

test('returns empty array when handler maps text extensions that are not in the risky list', () => {
  const text = 'AddHandler text/plain .txt .log';
  assert.deepEqual(execHandlers(text), []);
});

test('returns empty array when handler maps html extensions that are not in the risky list', () => {
  const text = 'AddHandler text/html .html .htm';
  assert.deepEqual(execHandlers(text), []);
});

test('returns empty array when handler maps only safe non-media extensions', () => {
  const text = 'AddHandler cgi-script .py .rb .pl .sh';
  assert.deepEqual(execHandlers(text), []);
});

test('returns only the risky extensions from a mixed list', () => {
  const text = 'AddHandler cgi-script .py .php .rb .jpg';
  assert.deepEqual(execHandlers(text), [['jpg']]);
});

test('returns empty array for AddType directive with safe extensions', () => {
  const text = 'AddType application/x-python .py .rb';
  assert.deepEqual(execHandlers(text), []);
});

test('returns risky extensions for AddType directive with risky extensions', () => {
  const text = 'AddType application/x-php .txt .html';
  assert.deepEqual(execHandlers(text), [['txt', 'html']]);
});
