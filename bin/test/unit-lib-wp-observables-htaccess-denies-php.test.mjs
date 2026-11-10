// <what htaccessDeniesPhp computes, in a few words> (bin/lib/wp-observables.mjs htaccessDeniesPhp)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htaccessDeniesPhp } from '../lib/wp-observables.mjs';

const phpFlagLine = 'php_flag engine off';
const phpAdminFlagLine = 'php_admin_flag engine off';
const removeHandlerLine = 'RemoveHandler application/x-httpd-php.php';
const removeTypeLine = 'RemoveType application/x-httpd-php.php';
const filesMatchLine = '<FilesMatch *.php>\n  deny from all\n</FilesMatch>';
const filesLine = '<Files *.php>\n  deny from all\n</Files>';
const standAloneDeny = 'deny from all';
const standAloneRequire = 'Require all denied';
const setHandlerLine = 'SetHandler default-handler';
const forceTypeLine = 'ForceType text/plain';

test('returns true for php_flag engine off', () => {
  const input = phpFlagLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for php_admin_flag engine off', () => {
  const input = phpAdminFlagLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for RemoveHandler .php', () => {
  const input = removeHandlerLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for RemoveType .php', () => {
  const input = removeTypeLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for <FilesMatch with deny from all', () => {
  const input = filesMatchLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for <Files with deny from all', () => {
  const input = filesLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for stand-alone deny from all', () => {
  const input = standAloneDeny;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for stand-alone Require all denied', () => {
  const input = standAloneRequire;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for SetHandler default-handler', () => {
  const input = setHandlerLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns true for ForceType text/plain', () => {
  const input = forceTypeLine;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, true);
});

test('returns false for unrelated content', () => {
  const input = 'Some other Apache config line';
  const result = htaccessDeniesPhp(input);
  assert.equal(result, false);
});

test('returns false for empty string', () => {
  const input = '';
  const result = htaccessDeniesPhp(input);
  assert.equal(result, false);
});

test('returns false for null input', () => {
  const input = null;
  const result = htaccessDeniesPhp(input);
  assert.equal(result, false);
});
