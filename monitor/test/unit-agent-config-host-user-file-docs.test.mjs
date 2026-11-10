// Extracts mcpServers docs from a user config file (monitor/agent-config-host.mjs userFileDocs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userFileDocs } from '../agent-config-host.mjs';

test('returns error when parsed value is not an object', () => {
  const r = userFileDocs('"hello"');
  assert.deepEqual(r, { error: "not an object", docs: [] });
});

test('returns error when parsed value is null', () => {
  const r = userFileDocs('null');
  assert.deepEqual(r, { error: "not an object", docs: [] });
});

test('returns empty docs when no mcpServers or projects', () => {
  const r = userFileDocs('{}');
  assert.deepEqual(r, { docs: [], projects: 0 });
});

test('includes top-level mcpServers in docs', () => {
  const r = userFileDocs('{"mcpServers":{"a":{}}}');
  assert.deepEqual(r, { docs: [{ rel: ".claude.json", doc: { mcpServers: { a: {} } } }], projects: 0 });
});

test('includes project mcpServers with non-empty keys', () => {
  const r = userFileDocs('{"projects":{"p1":{"mcpServers":{"x":{}}}}}');
  assert.deepEqual(r, { docs: [{ rel: ".claude.json#projects/p1", doc: { mcpServers: { x: {} } } }], projects: 1 });
});

test('excludes project with empty mcpServers object', () => {
  const r = userFileDocs('{"projects":{"p1":{"mcpServers":{}}}}');
  assert.deepEqual(r, { docs: [], projects: 1 });
});

test('excludes project entry that is not an object', () => {
  const r = userFileDocs('{"projects":{"p1":"str"}}');
  assert.deepEqual(r, { docs: [], projects: 1 });
});

test('counts projects in result', () => {
  const r = userFileDocs('{"projects":{"a":{},"b":{}}}');
  assert.deepEqual(r, { docs: [], projects: 2 });
});

test('handles multiple projects sorted by key', () => {
  const r = userFileDocs('{"projects":{"b":{"mcpServers":{"y":{}}},"a":{"mcpServers":{"z":{}}}}}');
  assert.deepEqual(r, { docs: [{ rel: ".claude.json#projects/a", doc: { mcpServers: { z: {} } } }, { rel: ".claude.json#projects/b", doc: { mcpServers: { y: {} } } }], projects: 2 });
});

test('returns zero projects when projects is not an object', () => {
  const r = userFileDocs('{"projects":"str"}');
  assert.deepEqual(r, { docs: [], projects: 0 });
});
