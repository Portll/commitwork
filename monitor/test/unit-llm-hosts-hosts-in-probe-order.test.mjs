// Orders hosts by probeOrder, appending any hosts not listed (monitor/llm-hosts.mjs hostsInProbeOrder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostsInProbeOrder } from '../llm-hosts.mjs';

test('returns hosts in probeOrder with unlisted hosts appended', () => {
  const decl = {
    hosts: [
      { id: 'a', baseUrl: 'http://x:1', portIsShared: false },
      { id: 'b', baseUrl: 'http://x:2', portIsShared: false },
      { id: 'c', baseUrl: 'http://x:3', portIsShared: false },
    ],
    probeOrder: ['b', 'a'],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "b", baseUrl: "http://x:2", portIsShared: false }, { id: "a", baseUrl: "http://x:1", portIsShared: false }, { id: "c", baseUrl: "http://x:3", portIsShared: false }]);
});

test('returns hosts in original order when probeOrder is empty', () => {
  const decl = {
    hosts: [
      { id: 'a', baseUrl: 'http://x:1', portIsShared: false },
      { id: 'b', baseUrl: 'http://x:2', portIsShared: false },
    ],
    probeOrder: [],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "a", baseUrl: "http://x:1", portIsShared: false }, { id: "b", baseUrl: "http://x:2", portIsShared: false }]);
});

test('returns single host when probeOrder matches it', () => {
  const decl = {
    hosts: [{ id: 'a', baseUrl: 'http://x:1', portIsShared: false }],
    probeOrder: ['a'],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "a", baseUrl: "http://x:1", portIsShared: false }]);
});

test('returns empty array when no hosts declared', () => {
  const decl = { hosts: [], probeOrder: [] };
  assert.deepEqual(hostsInProbeOrder(decl), []);
});

test('returns hosts in probeOrder when all are listed', () => {
  const decl = {
    hosts: [
      { id: 'a', baseUrl: 'http://x:1', portIsShared: false },
      { id: 'b', baseUrl: 'http://x:2', portIsShared: false },
      { id: 'c', baseUrl: 'http://x:3', portIsShared: false },
    ],
    probeOrder: ['c', 'b', 'a'],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "c", baseUrl: "http://x:3", portIsShared: false }, { id: "b", baseUrl: "http://x:2", portIsShared: false }, { id: "a", baseUrl: "http://x:1", portIsShared: false }]);
});

test('returns hosts in probeOrder with unlisted appended in original order', () => {
  const decl = {
    hosts: [
      { id: 'a', baseUrl: 'http://x:1', portIsShared: false },
      { id: 'b', baseUrl: 'http://x:2', portIsShared: false },
      { id: 'c', baseUrl: 'http://x:3', portIsShared: false },
      { id: 'd', baseUrl: 'http://x:4', portIsShared: false },
    ],
    probeOrder: ['c', 'a'],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "c", baseUrl: "http://x:3", portIsShared: false }, { id: "a", baseUrl: "http://x:1", portIsShared: false }, { id: "b", baseUrl: "http://x:2", portIsShared: false }, { id: "d", baseUrl: "http://x:4", portIsShared: false }]);
});

test('returns hosts in probeOrder with unlisted appended for many hosts', () => {
  const n = 10;
  const hosts = Array.from({ length: n }, (_, i) => ({
    id: `h${i}`,
    baseUrl: `http://x:${100 + i}`,
    portIsShared: false,
  }));
  const probeOrder = ['h9', 'h7', 'h5', 'h3', 'h1'];
  const decl = { hosts, probeOrder };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "h9", baseUrl: "http://x:109", portIsShared: false }, { id: "h7", baseUrl: "http://x:107", portIsShared: false }, { id: "h5", baseUrl: "http://x:105", portIsShared: false }, { id: "h3", baseUrl: "http://x:103", portIsShared: false }, { id: "h1", baseUrl: "http://x:101", portIsShared: false }, { id: "h0", baseUrl: "http://x:100", portIsShared: false }, { id: "h2", baseUrl: "http://x:102", portIsShared: false }, { id: "h4", baseUrl: "http://x:104", portIsShared: false }, { id: "h6", baseUrl: "http://x:106", portIsShared: false }, { id: "h8", baseUrl: "http://x:108", portIsShared: false }]);
});

test('returns hosts in probeOrder with unlisted appended when probeOrder is partial', () => {
  const decl = {
    hosts: [
      { id: 'a', baseUrl: 'http://x:1', portIsShared: false },
      { id: 'b', baseUrl: 'http://x:2', portIsShared: false },
      { id: 'c', baseUrl: 'http://x:3', portIsShared: false },
      { id: 'd', baseUrl: 'http://x:4', portIsShared: false },
      { id: 'e', baseUrl: 'http://x:5', portIsShared: false },
    ],
    probeOrder: ['e', 'c', 'a'],
  };
  assert.deepEqual(hostsInProbeOrder(decl), [{ id: "e", baseUrl: "http://x:5", portIsShared: false }, { id: "c", baseUrl: "http://x:3", portIsShared: false }, { id: "a", baseUrl: "http://x:1", portIsShared: false }, { id: "b", baseUrl: "http://x:2", portIsShared: false }, { id: "d", baseUrl: "http://x:4", portIsShared: false }]);
});
