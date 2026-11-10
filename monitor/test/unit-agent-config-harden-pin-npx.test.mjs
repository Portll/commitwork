// Pins npx package specs to resolved versions in agent config JSON (monitor/agent-config-harden.mjs pinNpx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinNpx } from '../agent-config-harden.mjs';

test('returns unparseable skip for invalid json', () => {
  const r = pinNpx('not json', () => '1.0.0');
  assert.deepEqual(r, { text: "not json", pinned: [], skipped: [{ server: "", package: "", reason: "unparseable" }] });
});

test('returns unparseable skip for non-object json', () => {
  const r = pinNpx('42', () => '1.0.0');
  assert.deepEqual(r, { text: "42", pinned: [], skipped: [{ server: "", package: "", reason: "unparseable" }] });
});

test('skips non-npx commands', () => {
  const text = '{"mcpServers":{"s":{"command":"node","args":["x"]}}}';
  const r = pinNpx(text, () => '1.0.0');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"node\",\"args\":[\"x\"]}}}", pinned: [], skipped: [] });
});

test('pins npx package with valid version', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","pkg"]}}}';
  const r = pinNpx(text, () => '1.2.3');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"pkg@1.2.3\"]}}}", pinned: [{ server: "s", package: "pkg", version: "1.2.3" }], skipped: [] });
});

test('skips when version is not a string', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","pkg"]}}}';
  const r = pinNpx(text, () => 123);
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"pkg\"]}}}", pinned: [], skipped: [{ server: "s", package: "pkg", reason: "unresolved" }] });
});

test('skips when version fails regex', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","pkg"]}}}';
  const r = pinNpx(text, () => 'not-a-version');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"pkg\"]}}}", pinned: [], skipped: [{ server: "s", package: "pkg", reason: "unresolved" }] });
});

test('skips when literal not found in text', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","other"]}}}';
  const r = pinNpx(text, () => '1.0.0');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"other@1.0.0\"]}}}", pinned: [{ server: "s", package: "other", version: "1.0.0" }], skipped: [] });
});

test('skips already pinned specs', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","pkg@1.0.0"]}}}';
  const r = pinNpx(text, () => '2.0.0');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"pkg@1.0.0\"]}}}", pinned: [], skipped: [] });
});

test('skips local specs', () => {
  const text = '{"mcpServers":{"s":{"command":"npx","args":["-y","./local"]}}}';
  const r = pinNpx(text, () => '1.0.0');
  assert.deepEqual(r, { text: "{\"mcpServers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"./local\"]}}}", pinned: [], skipped: [] });
});

test('handles servers block', () => {
  const text = '{"servers":{"s":{"command":"npx","args":["-y","pkg"]}}}';
  const r = pinNpx(text, () => '1.2.3');
  assert.deepEqual(r, { text: "{\"servers\":{\"s\":{\"command\":\"npx\",\"args\":[\"-y\",\"pkg@1.2.3\"]}}}", pinned: [{ server: "s", package: "pkg", version: "1.2.3" }], skipped: [] });
});
