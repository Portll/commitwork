// Canonical JSON string with sorted keys (monitor/history-chain.mjs canon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canon } from '../history-chain.mjs';

test('null returns the string null', () => {
  assert.equal(canon(null), "null");
});

test('undefined returns the string null', () => {
  assert.equal(canon(undefined), "null");
});

test('string returns its JSON representation', () => {
  assert.equal(canon('hello'), "\"hello\"");
});

test('boolean true returns its JSON representation', () => {
  assert.equal(canon(true), "true");
});

test('finite number returns its JSON representation', () => {
  assert.equal(canon(42), "42");
});

test('non-finite number throws a TypeError', () => {
  assert.throws(() => canon(Infinity), { name: "TypeError", message: "chain event holds a non-finite number (Infinity) \u2014 it would hash as null" });
});

test('plain object returns sorted keys with canonical values', () => {
  assert.equal(canon({ b: 1, a: 'x' }), "{\"a\":\"x\",\"b\":1}");
});

test('array returns bracketed canonical elements', () => {
  assert.equal(canon([1, 'two', null]), "[1,\"two\",null]");
});

test('non-plain object throws a TypeError', () => {
  assert.throws(() => canon(new Date(0)), { name: "TypeError", message: "chain event holds a Date \u2014 hash it as a string, not as an object whose fields JSON drops" });
});

test('symbol throws a TypeError', () => {
  assert.throws(() => canon(Symbol('x')), { name: "TypeError", message: "chain event holds a symbol \u2014 not representable on a chain line" });
});
