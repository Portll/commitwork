// The kind of a tree entry: control, code, executable or other (bin/tree-integrity.mjs kindOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf } from '../tree-integrity.mjs';

test('a file named .htaccess is a control file', () => {
  const r = kindOf('site/.htaccess', { mode: 0o644 }, null);
  assert.equal(r, 'control');
});

test('a file ending in .php is code', () => {
  const r = kindOf('web/index.php', { mode: 0o644 }, null);
  assert.equal(r, 'code');
});

test('a plain file with no head bytes is other', () => {
  const r = kindOf('docs/readme.txt', { mode: 0o755 }, null);
  assert.equal(r, 'other');
});

test('a file whose head starts with ELF magic is executable', () => {
  const head = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  const r = kindOf('out/binary.bin', { mode: 0o644 }, head);
  assert.equal(r, 'executable');
});

test('a file whose head starts with MZ is executable', () => {
  const head = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
  const r = kindOf('out/tool.dat', { mode: 0o644 }, head);
  assert.equal(r, 'executable');
});

test('an executable-mode file starting with a shebang is executable', () => {
  const head = Buffer.from('#!/bin/sh\n', 'ascii');
  const r = kindOf('scripts/run', { mode: 0o755 }, head);
  assert.equal(r, 'executable');
});

test('a shebang file with only the other-execute bit set is executable', () => {
  const head = Buffer.from('#!/bin/sh\n', 'ascii');
  const r = kindOf('scripts/run', { mode: 0o001 }, head);
  assert.equal(r, 'executable');
});

test('an executable-mode file starting with a hash but no bang is other', () => {
  const head = Buffer.from('#abc', 'ascii');
  const r = kindOf('scripts/run', { mode: 0o755 }, head);
  assert.equal(r, 'other');
});

test('a shebang file without any execute bit is other', () => {
  const head = Buffer.from('#!/bin/sh\n', 'ascii');
  const r = kindOf('scripts/run', { mode: 0o644 }, head);
  assert.equal(r, 'other');
});

test('a file with no stat and non-magic head bytes is other', () => {
  const head = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  const r = kindOf('data/blob', null, head);
  assert.equal(r, 'other');
});
