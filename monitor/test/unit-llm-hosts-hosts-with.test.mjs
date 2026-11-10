// Filters declared hosts to those whose capabilities include the given capability (monitor/llm-hosts.mjs hostsWith).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostsWith } from '../llm-hosts.mjs';

test('returns hosts that include the requested capability', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['chat', 'embed'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['embed'], baseUrl: 'http://b:2', portIsShared: false },
    { id: 'c', capabilities: ['chat'], baseUrl: 'http://c:3', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b', 'c'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "a", capabilities: ["chat", "embed"], baseUrl: "http://a:1", portIsShared: false }, { id: "b", capabilities: ["embed"], baseUrl: "http://b:2", portIsShared: false }]);
});

test('returns an empty array when no host has the capability', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['chat'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['rerank'], baseUrl: 'http://b:2', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, []);
});

test('returns all hosts when every host has the capability', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['chat', 'embed'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['embed', 'chat'], baseUrl: 'http://b:2', portIsShared: false },
    { id: 'c', capabilities: ['embed'], baseUrl: 'http://c:3', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b', 'c'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "a", capabilities: ["chat", "embed"], baseUrl: "http://a:1", portIsShared: false }, { id: "b", capabilities: ["embed", "chat"], baseUrl: "http://b:2", portIsShared: false }, { id: "c", capabilities: ["embed"], baseUrl: "http://c:3", portIsShared: false }]);
});

test('returns hosts matching a capability that appears mid-list', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['chat', 'embed', 'rerank'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['rerank', 'chat'], baseUrl: 'http://b:2', portIsShared: false },
    { id: 'c', capabilities: ['chat'], baseUrl: 'http://c:3', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b', 'c'] };
  const r = hostsWith('rerank', decl);
  assert.deepEqual(r, [{ id: "a", capabilities: ["chat", "embed", "rerank"], baseUrl: "http://a:1", portIsShared: false }, { id: "b", capabilities: ["rerank", "chat"], baseUrl: "http://b:2", portIsShared: false }]);
});

test('returns a single host when only one has the capability', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['chat'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['embed'], baseUrl: 'http://b:2', portIsShared: false },
    { id: 'c', capabilities: ['chat'], baseUrl: 'http://c:3', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b', 'c'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "b", capabilities: ["embed"], baseUrl: "http://b:2", portIsShared: false }]);
});

test('returns hosts with the capability from a two-host declaration', () => {
  const decl = { hosts: [
    { id: 'x', capabilities: ['embed', 'chat'], baseUrl: 'http://x:1', portIsShared: false },
    { id: 'y', capabilities: ['chat'], baseUrl: 'http://y:2', portIsShared: false },
  ], default: 'x', probeOrder: ['x', 'y'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "x", capabilities: ["embed", "chat"], baseUrl: "http://x:1", portIsShared: false }]);
});

test('returns hosts with the capability from a three-host declaration with mixed order', () => {
  const decl = { hosts: [
    { id: 'p', capabilities: ['chat'], baseUrl: 'http://p:1', portIsShared: false },
    { id: 'q', capabilities: ['embed'], baseUrl: 'http://q:2', portIsShared: false },
    { id: 'r', capabilities: ['embed', 'chat'], baseUrl: 'http://r:3', portIsShared: false },
  ], default: 'p', probeOrder: ['p', 'q', 'r'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "q", capabilities: ["embed"], baseUrl: "http://q:2", portIsShared: false }, { id: "r", capabilities: ["embed", "chat"], baseUrl: "http://r:3", portIsShared: false }]);
});

test('returns hosts with the capability when the capability is the only one listed', () => {
  const decl = { hosts: [
    { id: 'a', capabilities: ['embed'], baseUrl: 'http://a:1', portIsShared: false },
    { id: 'b', capabilities: ['chat', 'embed'], baseUrl: 'http://b:2', portIsShared: false },
    { id: 'c', capabilities: ['rerank'], baseUrl: 'http://c:3', portIsShared: false },
  ], default: 'a', probeOrder: ['a', 'b', 'c'] };
  const r = hostsWith('embed', decl);
  assert.deepEqual(r, [{ id: "a", capabilities: ["embed"], baseUrl: "http://a:1", portIsShared: false }, { id: "b", capabilities: ["chat", "embed"], baseUrl: "http://b:2", portIsShared: false }]);
});
