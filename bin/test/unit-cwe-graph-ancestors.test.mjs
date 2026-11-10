// Computes the chain of parent CWEs up to a maximum depth (bin/cwe-graph.mjs ancestors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestors } from '../cwe-graph.mjs';

test('returns empty array when the id has no entry in the graph', () => {
  const g = { cwes: {} };
  assert.deepEqual(ancestors(g, 'CWE-1'), []);
});

test('returns the single parent when the node has a ChildOf entry', () => {
  const g = { cwes: { '1': { ChildOf: ['2'] } } };
  assert.deepEqual(ancestors(g, 'CWE-1'), ["2"]);
});

test('returns the full ancestor chain up to the root', () => {
  const g = {
    cwes: {
      '1': { ChildOf: ['2'] },
      '2': { ChildOf: ['3'] },
      '3': { ChildOf: ['4'] },
      '4': { ChildOf: ['5'] },
      '5': { ChildOf: ['6'] },
      '6': { ChildOf: ['7'] },
      '7': { ChildOf: ['8'] },
      '8': { ChildOf: ['9'] },
      '9': { ChildOf: ['10'] },
      '10': { ChildOf: ['11'] },
      '11': { ChildOf: ['12'] },
      '12': { ChildOf: ['13'] },
      '13': { ChildOf: ['14'] },
      '14': { ChildOf: ['15'] },
      '15': { ChildOf: ['16'] },
      '16': { ChildOf: ['17'] },
      '17': { ChildOf: ['18'] },
      '18': { ChildOf: ['19'] },
      '19': { ChildOf: ['20'] },
      '20': { ChildOf: ['21'] },
      '21': { ChildOf: ['22'] },
      '22': { ChildOf: ['23'] },
      '23': { ChildOf: ['24'] },
      '24': { ChildOf: ['25'] },
      '25': { ChildOf: ['26'] },
    },
  };
  assert.deepEqual(ancestors(g, 'CWE-1'), ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"]);
});

test('stops at the default maximum depth of 24 ancestors', () => {
  const cwes = {};
  for (let i = 1; i <= 30; i += 1) {
    cwes[String(i)] = { ChildOf: [String(i + 1)] };
  }
  const g = { cwes };
  assert.deepEqual(ancestors(g, 'CWE-1'), ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25"]);
});

test('stops when the next ancestor is already in the seen set', () => {
  const g = {
    cwes: {
      '1': { ChildOf: ['2'] },
      '2': { ChildOf: ['3'] },
      '3': { ChildOf: ['1'] },
    },
  };
  assert.deepEqual(ancestors(g, 'CWE-1'), ["2", "3", "1"]);
});

test('returns empty array when the node has no ChildOf property', () => {
  const g = { cwes: { '1': {} } };
  assert.deepEqual(ancestors(g, 'CWE-1'), []);
});

test('returns empty array when ChildOf is an empty array', () => {
  const g = { cwes: { '1': { ChildOf: [] } } };
  assert.deepEqual(ancestors(g, 'CWE-1'), []);
});

test('uses the first element of ChildOf as the next ancestor', () => {
  const g = { cwes: { '1': { ChildOf: ['2', '3'] } } };
  assert.deepEqual(ancestors(g, 'CWE-1'), ["2"]);
});

test('honors a custom max smaller than the chain length', () => {
  const g = {
    cwes: {
      '1': { ChildOf: ['2'] },
      '2': { ChildOf: ['3'] },
      '3': { ChildOf: ['4'] },
    },
  };
  assert.deepEqual(ancestors(g, 'CWE-1', 2), ["2", "3"]);
});

test('handles an id without the CWE prefix', () => {
  const g = { cwes: { '1': { ChildOf: ['2'] } } };
  assert.deepEqual(ancestors(g, '1'), ["2"]);
});
