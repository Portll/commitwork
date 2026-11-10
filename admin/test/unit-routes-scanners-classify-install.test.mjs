// Classifies a resolved real path into its package manager (admin/routes/scanners.mjs classifyInstall).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInstall } from '../routes/scanners.mjs';

test('returns null manager when real is falsy', () => {
  assert.deepEqual(classifyInstall(null), { manager: null });
  assert.deepEqual(classifyInstall(''), { manager: null });
  assert.deepEqual(classifyInstall(undefined), { manager: null });
});

test('detects brew from Cellar path', () => {
  const real = '/opt/homebrew/Cellar/git/2.40.0/bin/git';
  assert.deepEqual(classifyInstall(real), { manager: 'brew', pkg: 'git', version: '2.40.0' });
});

test('detects brew-cask from Caskroom path', () => {
  const real = '/opt/homebrew/Caskroom/google-chrome/120.0.6099.109/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.deepEqual(classifyInstall(real), { manager: 'brew-cask', pkg: 'google-chrome', version: '120.0.6099.109' });
});

test('detects pipx from venvs path', () => {
  const real = '/home/user/.local/pipx/venvs/black/bin/black';
  assert.deepEqual(classifyInstall(real), { manager: 'pipx', pkg: 'black' });
});

test('detects npm from node_modules path including scoped packages', () => {
  const real = '/usr/lib/node_modules/@babel/core/lib/index.js';
  assert.deepEqual(classifyInstall(real), { manager: 'npm', pkg: '@babel/core' });
  const real2 = '/usr/lib/node_modules/typescript/bin/tsc';
  assert.deepEqual(classifyInstall(real2), { manager: 'npm', pkg: 'typescript' });
});

test('detects gem from gems path with version', () => {
  const real = '/usr/local/lib/ruby/gems/3.2.0/gems/rails-7.1.0/lib/rails.rb';
  assert.deepEqual(classifyInstall(real), { manager: 'gem', pkg: 'rails', version: '7.1.0' });
});

test('detects composer from vendor path', () => {
  const real = '/var/www/html/composer/vendor/laravel/framework/src/Illuminate/Foundation/Application.php';
  assert.deepEqual(classifyInstall(real), { manager: 'composer' });
});

test('detects cargo from home cargo bin path', () => {
  const home = '/home/user';
  const real = '/home/user/.cargo/bin/rustc';
  assert.deepEqual(classifyInstall(real, { home }), { manager: 'cargo' });
});

test('detects go from go bin path', () => {
  const real = '/usr/local/go/bin/go';
  assert.deepEqual(classifyInstall(real), { manager: 'go' });
});

test('detects system from sbin or System paths', () => {
  assert.deepEqual(classifyInstall('/usr/sbin/sshd'), { manager: 'system' });
  assert.deepEqual(classifyInstall('/sbin/init'), { manager: 'system' });
  assert.deepEqual(classifyInstall('/bin/bash'), { manager: 'system' });
  assert.deepEqual(classifyInstall('/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation'), { manager: 'system' });
});

test('detects app from Applications path', () => {
  const real = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
  assert.deepEqual(classifyInstall(real), { manager: 'app', pkg: 'Visual Studio Code' });
});

test('returns manual for unrecognized paths', () => {
  const real = '/opt/custom-tools/mytool/bin/tool';
  assert.deepEqual(classifyInstall(real), { manager: 'manual' });
});
