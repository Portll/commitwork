// Classifies a bind address as loopback, any, or addressed (monitor/port-bind.mjs ifaceClass).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ifaceClass } from '../port-bind.mjs';

test('returns loopback for 127.0.0.1', () => {
  assert.equal(ifaceClass('127.0.0.1'), "loopback");
});

test('returns loopback for ::1', () => {
  assert.equal(ifaceClass('::1'), "loopback");
});

test('returns loopback for 127.0.0.2', () => {
  assert.equal(ifaceClass('127.0.0.2'), "loopback");
});

test('returns any for *', () => {
  assert.equal(ifaceClass('*'), "any");
});

test('returns any for 0.0.0.0', () => {
  assert.equal(ifaceClass('0.0.0.0'), "any");
});

test('returns any for ::', () => {
  assert.equal(ifaceClass('::'), "any");
});

test('returns addressed for 192.168.1.1', () => {
  assert.equal(ifaceClass('192.168.1.1'), "addressed");
});

test('returns loopback for bracketed ::1', () => {
  assert.equal(ifaceClass('[::1]'), "loopback");
});

test('returns addressed for empty string', () => {
  assert.equal(ifaceClass(''), "addressed");
});

test('returns addressed for 127.0.0.10', () => {
  assert.equal(ifaceClass('127.0.0.10'), "loopback");
});
