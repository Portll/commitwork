// Computes a canonical key string for a re-export record (codegraph/build.mjs reexportKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reexportKey } from '../build.mjs';

test('returns star prefix for kind star', () => {
  const r = { kind: 'star', spec: './mod' };
  assert.equal(reexportKey(r), "* <- ./mod");
});

test('returns named export format for kind named', () => {
  const r = { kind: 'named', exported: 'foo', spec: './mod', imported: 'bar' };
  assert.equal(reexportKey(r), "foo <- ./mod#bar");
});

test('returns star prefix for kind star with different spec', () => {
  const r = { kind: 'star', spec: '../other' };
  assert.equal(reexportKey(r), "* <- ../other");
});

test('returns named export format for kind default', () => {
  const r = { kind: 'default', exported: 'x', spec: './y', imported: 'z' };
  assert.equal(reexportKey(r), "x <- ./y#z");
});

test('returns star prefix when kind is exactly star', () => {
  const r = { kind: 'star', spec: 's' };
  assert.equal(reexportKey(r), "* <- s");
});

test('returns named format when kind is not star', () => {
  const r = { kind: 'other', exported: 'a', spec: 'b', imported: 'c' };
  assert.equal(reexportKey(r), "a <- b#c");
});
