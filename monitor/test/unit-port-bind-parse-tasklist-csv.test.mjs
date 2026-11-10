// Maps tasklist CSV lines to a Map of PID to image name (monitor/port-bind.mjs parseTasklistCsv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasklistCsv } from '../port-bind.mjs';

test('returns an empty map when the input is null', () => {
  const r = parseTasklistCsv(null);
  assert.deepEqual(r, new Map([]));
});

test('returns an empty map when the input is an empty string', () => {
  const r = parseTasklistCsv('');
  assert.deepEqual(r, new Map([]));
});

test('maps a single valid line to its pid and name', () => {
  const r = parseTasklistCsv('"Image Name","PID","Session Name","Session#","Mem Usage"\r\n"System","4","Services","0","10 K"');
  assert.deepEqual(r, new Map([[4, "System"]]));
});

test('unescapes doubled quotes inside the image name', () => {
  const r = parseTasklistCsv('"C:""Program Files""\\app.exe","123","Console","1","5 M"');
  assert.deepEqual(r, new Map([[123, "C:\"Program Files\"\\app.exe"]]));
});

test('keeps the last occurrence when the same pid appears twice', () => {
  const r = parseTasklistCsv('"first","7","S","0","1"\r\n"second","7","S","0","2"');
  assert.deepEqual(r, new Map([[7, "second"]]));
});

test('ignores lines that do not match the quoted name and pid shape', () => {
  const r = parseTasklistCsv('garbage\r\n"no-pid","abc","S","0","1"\r\n"ok","9","S","0","1"');
  assert.deepEqual(r, new Map([[9, "ok"]]));
});

test('handles a name containing a comma inside the quotes', () => {
  const r = parseTasklistCsv('"a,b","55","S","0","1"');
  assert.deepEqual(r, new Map([[55, "a,b"]]));
});

test('parses multiple distinct pids into the map', () => {
  const r = parseTasklistCsv('"a","1","S","0","1"\r\n"b","2","S","0","2"\r\n"c","3","S","0","3"');
  assert.deepEqual(r, new Map([[1, "a"], [2, "b"], [3, "c"]]));
});
