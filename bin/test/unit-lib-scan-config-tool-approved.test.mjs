// Checks whether a tool is approved in the scan config (bin/lib/scan-config.mjs toolApproved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolApproved } from '../lib/scan-config.mjs';

test('returns true when the tool entry has approved set to true', () => {
  const cfg = { tools: { git: { approved: true } } };
  assert.equal(toolApproved(cfg, 'git'), true);
});

test('returns false when the tool entry has approved set to false', () => {
  const cfg = { tools: { git: { approved: false } } };
  assert.equal(toolApproved(cfg, 'git'), false);
});

test('returns false when the tool entry has approved set to a truthy non-boolean value', () => {
  const cfg = { tools: { git: { approved: 1 } } };
  assert.equal(toolApproved(cfg, 'git'), false);
});

test('returns false when the tool entry has approved set to a falsy non-boolean value', () => {
  const cfg = { tools: { git: { approved: 0 } } };
  assert.equal(toolApproved(cfg, 'git'), false);
});

test('returns false when the tool entry exists but has no approved property', () => {
  const cfg = { tools: { git: {} } };
  assert.equal(toolApproved(cfg, 'git'), false);
});

test('returns false when the tool key is missing from the tools object', () => {
  const cfg = { tools: { git: { approved: true } } };
  assert.equal(toolApproved(cfg, 'npm'), false);
});

test('returns false when the config has no tools property', () => {
  const cfg = {};
  assert.equal(toolApproved(cfg, 'git'), false);
});

test('returns false when the config is null', () => {
  assert.throws(() => toolApproved(null, 'git'), { name: "TypeError", message: "Cannot read properties of null (reading 'tools')" });
});
