// Normalizes trailing whitespace and ensures a final newline (bin/format-phase.mjs formatBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../format-phase.mjs';

test('strips trailing spaces and tabs before newlines when markdown is false', () => {
  const buf = Buffer.from('a  \nb\t\nc\n');
  const r = formatBytes(buf);
  assert.deepEqual(r, { out: Buffer.from("610a620a630a", 'hex'), changed: true });
});

test('preserves trailing spaces and tabs when markdown is true', () => {
  const buf = Buffer.from('a  \nb\t\nc\n');
  const r = formatBytes(buf, { markdown: true });
  assert.deepEqual(r, { out: Buffer.from("6120200a62090a630a", 'hex'), changed: false });
});

test('collapses multiple trailing newlines into one when markdown is false', () => {
  const buf = Buffer.from('a\n\n\n');
  const r = formatBytes(buf);
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: true });
});

test('collapses multiple trailing newlines into one when markdown is true', () => {
  const buf = Buffer.from('a\n\n\n');
  const r = formatBytes(buf, { markdown: true });
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: true });
});

test('adds a newline when text does not end with one and markdown is false', () => {
  const buf = Buffer.from('a');
  const r = formatBytes(buf);
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: true });
});

test('adds a newline when text does not end with one and markdown is true', () => {
  const buf = Buffer.from('a');
  const r = formatBytes(buf, { markdown: true });
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: true });
});

test('returns unchanged flag false when input is already normalized', () => {
  const buf = Buffer.from('a\n');
  const r = formatBytes(buf);
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: false });
});

test('returns unchanged flag false when input is already normalized with markdown true', () => {
  const buf = Buffer.from('a\n');
  const r = formatBytes(buf, { markdown: true });
  assert.deepEqual(r, { out: Buffer.from("610a", 'hex'), changed: false });
});
