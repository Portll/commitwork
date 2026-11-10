// Classifies a network binding address as loopback, wildcard, or interface (monitor/listeners.mjs classifyBinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBinding } from '../listeners.mjs';

test('returns wildcard for asterisk', () => {
  assert.equal(classifyBinding('*'), "wildcard");
});

test('returns wildcard for 0.0.0.0', () => {
  assert.equal(classifyBinding('0.0.0.0'), "wildcard");
});

test('returns wildcard for empty string', () => {
  assert.equal(classifyBinding(''), "wildcard");
});

test('returns loopback for ::1', () => {
  assert.equal(classifyBinding('::1'), "loopback");
});

test('returns loopback for localhost', () => {
  assert.equal(classifyBinding('localhost'), "loopback");
});

test('returns loopback for 127.0.0.1', () => {
  assert.equal(classifyBinding('127.0.0.1'), "loopback");
});

test('returns loopback for v4-mapped loopback', () => {
  assert.equal(classifyBinding('::ffff:127.0.0.1'), "loopback");
});

test('returns interface for 192.168.1.1', () => {
  assert.equal(classifyBinding('192.168.1.1'), "interface");
});

test('returns interface for 128.0.0.1', () => {
  assert.equal(classifyBinding('128.0.0.1'), "interface");
});

test('returns interface for ::2', () => {
  assert.equal(classifyBinding('::2'), "interface");
});
