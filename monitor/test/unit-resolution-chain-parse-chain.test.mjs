// Extracts reached and refused targets from squid log lines (monitor/resolution-chain.mjs parseChain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChain } from '../resolution-chain.mjs';

test('empty input yields zero lines and empty lists', () => {
  assert.deepEqual(parseChain(''), { reached: [], refused: [], logLines: 0 });
});

test('blank lines are skipped and do not count', () => {
  assert.deepEqual(parseChain('\n   \n\t\n'), { reached: [], refused: [], logLines: 0 });
});

test('a denied line records the target in refused', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 DENIED 1234 GET http://example.com:443/path'), { reached: [], refused: ["http://example.com:443/path"], logLines: 1 });
});

test('a tunnel line records the target in reached', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 TUNNEL 1234 CONNECT example.com:443'), { reached: ["example.com"], refused: [], logLines: 1 });
});

test('a tcp miss line records the target in reached', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 TCP_MISS 1234 GET http://example.com:443/path'), { reached: ["http://example.com:443/path"], refused: [], logLines: 1 });
});

test('a tcp hit line records the target in reached', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 TCP_HIT 1234 GET http://example.com:443/path'), { reached: ["http://example.com:443/path"], refused: [], logLines: 1 });
});

test('a tcp refresh line records the target in reached', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 TCP_REFRESH 1234 GET http://example.com:443/path'), { reached: ["http://example.com:443/path"], refused: [], logLines: 1 });
});

test('duplicate action target pairs are deduplicated', () => {
  const line = '1700000000.000 5 10.0.0.1 DENIED 1234 GET http://example.com:443/path';
  assert.deepEqual(parseChain(line + '\n' + line), { reached: [], refused: ["http://example.com:443/path"], logLines: 2 });
});

test('a line with no target column is skipped', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 DENIED 1234'), { reached: [], refused: [], logLines: 1 });
});

test('a non matching action is neither reached nor refused', () => {
  assert.deepEqual(parseChain('1700000000.000 5 10.0.0.1 OTHER 1234 GET http://example.com:443/path'), { reached: [], refused: [], logLines: 1 });
});
