// Computes the published port view of a package inventory (monitor/package-inventory.mjs publishedView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedView } from '../package-inventory.mjs';

test('returns published true and maps managers with withheld null when no outdated or tools', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: [], tools: [] }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: null }] });
});

test('returns published true and withheld message when outdated is non-empty', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: ['pkg'], tools: [] }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: "package names, versions and paths are withheld on the published port \u2014 they are a machine fingerprint; open the panel on the operator port for the detail" }] });
});

test('returns published true and withheld message when tools is non-empty', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: [], tools: ['tool'] }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: "package names, versions and paths are withheld on the published port \u2014 they are a machine fingerprint; open the panel on the operator port for the detail" }] });
});

test('returns published true and withheld null when outdated and tools are both empty arrays', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: [], tools: [] }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: null }] });
});

test('returns published true and managers empty array when inv.managers is undefined', () => {
  const inv = { at: '2025-01-01T00:00:00Z' };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [] });
});

test('returns published true and withheld null when outdated is null and tools is null', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: null, tools: null }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: null }] });
});

test('returns published true and withheld message when outdated has one element and tools is null', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: ['a'], tools: null }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: "package names, versions and paths are withheld on the published port \u2014 they are a machine fingerprint; open the panel on the operator port for the detail" }] });
});

test('returns published true and withheld null when outdated is empty and tools is null', () => {
  const inv = { at: '2025-01-01T00:00:00Z', managers: [{ manager: 'npm', state: 'ok', reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, outdated: [], tools: null }] };
  const r = publishedView(inv);
  assert.deepEqual(r, { at: "2025-01-01T00:00:00Z", published: true, managers: [{ manager: "npm", state: "ok", reason: null, counts: null, tapAgeDays: null, eolDeclaredAt: null, applyable: null, withheld: null }] });
});
