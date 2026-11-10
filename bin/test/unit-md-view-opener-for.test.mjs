// Maps a file path and platform to the command and args used to open it (bin/md-view.mjs openerFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openerFor } from '../md-view.mjs';

test('returns open command for darwin platform', () => {
  assert.deepEqual(openerFor('/Users/test/file.md', 'darwin'), ["open", ["/Users/test/file.md"]]);
});

test('returns explorer command for win32 platform', () => {
  assert.deepEqual(openerFor('C:\\Users\\test\\file.md', 'win32'), ["explorer.exe", ["C:\\Users\\test\\file.md"]]);
});

test('returns xdg-open command for linux platform', () => {
  assert.deepEqual(openerFor('/home/test/file.md', 'linux'), ["xdg-open", ["/home/test/file.md"]]);
});

test('returns xdg-open command for freebsd platform', () => {
  assert.deepEqual(openerFor('/home/test/file.md', 'freebsd'), ["xdg-open", ["/home/test/file.md"]]);
});

test('returns xdg-open command for sunos platform', () => {
  assert.deepEqual(openerFor('/home/test/file.md', 'sunos'), ["xdg-open", ["/home/test/file.md"]]);
});

test('returns xdg-open command for aix platform', () => {
  assert.deepEqual(openerFor('/home/test/file.md', 'aix'), ["xdg-open", ["/home/test/file.md"]]);
});

test('returns xdg-open command for empty string platform', () => {
  assert.deepEqual(openerFor('/home/test/file.md', ''), ["xdg-open", ["/home/test/file.md"]]);
});

test('returns xdg-open command for unknown platform string', () => {
  assert.deepEqual(openerFor('/home/test/file.md', 'unknown'), ["xdg-open", ["/home/test/file.md"]]);
});
