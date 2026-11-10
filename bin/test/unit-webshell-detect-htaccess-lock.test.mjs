// Counts PHP FilesMatch deny blocks in .htaccess text (bin/webshell-detect.mjs htaccessLock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htaccessLock } from '../webshell-detect.mjs';

test('returns 0 for empty text', () => {
  assert.equal(htaccessLock(''), 0);
});

test('returns 0 when FilesMatch has no deny directive', () => {
  const text = '<FilesMatch "\\.php$">\n  Allow from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 0);
});

test('returns 0 when deny directive is present but fewer than 6 php variants', () => {
  const text = '<FilesMatch "\\.php$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 0);
});

test('returns 0 when require all denied is present but fewer than 6 php variants', () => {
  const text = '<FilesMatch "\\.php$">\n  Require all denied\n</FilesMatch>';
  assert.equal(htaccessLock(text), 0);
});

test('returns 6 when deny directive matches 6 php variants', () => {
  const text = '<FilesMatch "\\.php|\\.php3|\\.php4|\\.php5|\\.php7|\\.php8$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 6);
});

test('returns 6 when require all denied matches 6 php variants', () => {
  const text = '<FilesMatch "\\.php|\\.php3|\\.php4|\\.php5|\\.php7|\\.php8$">\n  Require all denied\n</FilesMatch>';
  assert.equal(htaccessLock(text), 6);
});

test('returns 7 when deny directive matches 7 php variants', () => {
  const text = '<FilesMatch "\\.php|\\.php3|\\.php4|\\.php5|\\.php7|\\.php8|\\.php9$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 7);
});

test('returns 0 when deny directive is present but 5 php variants only', () => {
  const text = '<FilesMatch "\\.php|\\.php3|\\.php4|\\.php5|\\.php7$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 0);
});

test('returns 0 when multiple FilesMatch blocks but none reach 6 variants with deny', () => {
  const text = '<FilesMatch "\\.php$">\n  Deny from all\n</FilesMatch>\n<FilesMatch "\\.php3$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 0);
});

test('returns 6 when second FilesMatch block reaches 6 variants with deny', () => {
  const text = '<FilesMatch "\\.php$">\n  Deny from all\n</FilesMatch>\n<FilesMatch "\\.php|\\.php3|\\.php4|\\.php5|\\.php7|\\.php8$">\n  Deny from all\n</FilesMatch>';
  assert.equal(htaccessLock(text), 6);
});
