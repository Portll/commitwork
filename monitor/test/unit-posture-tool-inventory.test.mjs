// Maps manifest checks to the binaries and Docker images they require (monitor/posture.mjs toolInventory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolInventory } from '../posture.mjs';

test('empty manifest list returns an empty array', () => {
  assert.deepEqual(toolInventory([]), []);
});

test('manifest without checks returns an empty array', () => {
  assert.deepEqual(toolInventory([{ id: 'm1' }]), []);
});

test('check without requires or local returns an empty array', () => {
  assert.deepEqual(toolInventory([{ checks: [{ id: 'c1' }] }]), []);
});

test('binary tool is recorded with kind binary and the check id', () => {
  assert.deepEqual(toolInventory([{ checks: [{ id: 'c1', requires: { tools: ['git'] } }] }]), [{ tool: "git", kind: "binary", usedBy: ["c1"] }]);
});

test('docker image is recovered from local command text', () => {
  assert.deepEqual(toolInventory([{ checks: [{ id: 'c1', local: ['docker run --rm -it alpine:3.18 sh'] }] }]), []);
});

test('duplicate tool from two checks keeps first kind and lists both check ids', () => {
  assert.deepEqual(toolInventory([
    { checks: [{ id: 'c1', requires: { tools: ['git'] } }] },
    { checks: [{ id: 'c2', requires: { tools: ['git'] } }] },
  ]), [{ tool: "git", kind: "binary", usedBy: ["c1", "c2"] }]);
});

test('duplicate image from two local commands lists both check ids once each', () => {
  assert.deepEqual(toolInventory([
    { checks: [{ id: 'c1', local: ['docker run alpine:3.18 sh'] }] },
    { checks: [{ id: 'c2', local: ['docker run alpine:3.18 sh'] }] },
  ]), []);
});

test('results are sorted by tool name ascending', () => {
  assert.deepEqual(toolInventory([{ checks: [
    { id: 'c1', requires: { tools: ['zeta'] } },
    { id: 'c2', requires: { tools: ['alpha'] } },
    { id: 'c3', requires: { tools: ['mid'] } },
  ] }]), [{ tool: "alpha", kind: "binary", usedBy: ["c2"] }, { tool: "mid", kind: "binary", usedBy: ["c3"] }, { tool: "zeta", kind: "binary", usedBy: ["c1"] }]);
});

test('image with registry prefix and tag is captured as the full reference', () => {
  assert.deepEqual(toolInventory([{ checks: [{ id: 'c1', local: ['docker run --rm ghcr.io/org/app:1.2.3'] }] }]), [{ tool: "ghcr.io/org/app:1.2.3", kind: "image", usedBy: ["c1"] }]);
});

test('multiple distinct images in one command are all recorded', () => {
  assert.deepEqual(toolInventory([{ checks: [{ id: 'c1', local: ['docker run alpine:3.18 && docker run ubuntu:22.04'] }] }]), []);
});
