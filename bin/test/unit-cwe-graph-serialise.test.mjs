// Serialises a CWE graph with sorted keys and a count (bin/cwe-graph.mjs serialise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serialise } from '../cwe-graph.mjs';

test('serialises a graph with unsorted numeric CWE keys into sorted order', () => {
  const graph = {
    cwes: { '10': 'a', '2': 'b', '1': 'c' },
    categories: { '3': 'x', '1': 'y' },
    meta: 'm'
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {\n    \"1\": \"c\",\n    \"2\": \"b\",\n    \"10\": \"a\"\n  },\n  \"categories\": {\n    \"1\": \"y\",\n    \"3\": \"x\"\n  },\n  \"meta\": \"m\",\n  \"count\": 3\n}\n");
});

test('serialises a graph with single CWE and category entries', () => {
  const graph = {
    cwes: { '1': 'only' },
    categories: { '1': 'cat' },
    extra: true
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {\n    \"1\": \"only\"\n  },\n  \"categories\": {\n    \"1\": \"cat\"\n  },\n  \"extra\": true,\n  \"count\": 1\n}\n");
});

test('serialises a graph with empty cwes and categories objects', () => {
  const graph = {
    cwes: {},
    categories: {},
    name: 'test'
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {},\n  \"categories\": {},\n  \"name\": \"test\",\n  \"count\": 0\n}\n");
});

test('serialises a graph with large numeric keys to verify numeric sorting', () => {
  const graph = {
    cwes: { '100': 'h', '9': 'i', '20': 'j' },
    categories: { '10': 'a', '2': 'b' },
    id: 42
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {\n    \"9\": \"i\",\n    \"20\": \"j\",\n    \"100\": \"h\"\n  },\n  \"categories\": {\n    \"2\": \"b\",\n    \"10\": \"a\"\n  },\n  \"id\": 42,\n  \"count\": 3\n}\n");
});

test('serialises a graph with non-numeric string keys', () => {
  const graph = {
    cwes: { 'abc': 'x', 'def': 'y', '1': 'z' },
    categories: { 'foo': 'p', 'bar': 'q' },
    label: 'L'
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {\n    \"1\": \"z\",\n    \"abc\": \"x\",\n    \"def\": \"y\"\n  },\n  \"categories\": {\n    \"foo\": \"p\",\n    \"bar\": \"q\"\n  },\n  \"label\": \"L\",\n  \"count\": 3\n}\n");
});

test('serialises a graph with duplicate-like keys and nested values', () => {
  const graph = {
    cwes: { '5': { name: 'CWE-5', desc: 'd' }, '3': { name: 'CWE-3', desc: 'e' } },
    categories: { '2': { label: 'C' }, '1': { label: 'A' } },
    version: '1.0'
  };
  const r = serialise(graph);
  assert.equal(r, "{\n  \"cwes\": {\n    \"3\": {\n      \"name\": \"CWE-3\",\n      \"desc\": \"e\"\n    },\n    \"5\": {\n      \"name\": \"CWE-5\",\n      \"desc\": \"d\"\n    }\n  },\n  \"categories\": {\n    \"1\": {\n      \"label\": \"A\"\n    },\n    \"2\": {\n      \"label\": \"C\"\n    }\n  },\n  \"version\": \"1.0\",\n  \"count\": 2\n}\n");
});
