// Panel rows for open issues, sorted by severity then id (monitor/issue-store.mjs panelRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { panelRows } from '../issue-store.mjs';

test('closed issues are skipped', () => {
  const doc = { issues: { a: { id: 'a', state: 'closed', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), []);
});

test('open issues are included', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "" }]);
});

test('scanner-row source builds title from rule and tool', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', source: { kind: 'scanner-row', rule: 'R1', ruleTitle: 'T1', tool: 'S1' }, repo: 'r', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "T1 (R1) [S1] (r)" }]);
});

test('scanner-row with missing rule falls back to rule label', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', source: { kind: 'scanner-row', ruleTitle: 'T1', tool: 'S1' }, repo: 'r', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "T1 (rule) [S1] (r)" }]);
});

test('scanner-row with missing tool falls back to question mark', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', source: { kind: 'scanner-row', rule: 'R1', ruleTitle: 'T1' }, repo: 'r', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "T1 (R1) [?] (r)" }]);
});

test('scanner-row with missing repo falls back to question mark', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', source: { kind: 'scanner-row', rule: 'R1', ruleTitle: 'T1', tool: 'S1' }, createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "T1 (R1) [S1] (?)" }]);
});

test('non-scanner source uses issue title', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', source: { kind: 'manual' }, title: 'My Title', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "My Title" }]);
});

test('missing source object uses issue title', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', title: 'My Title', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "My Title" }]);
});

test('sla breached when now is after due date', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-01-10T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: true, title: "" }]);
});

test('sla not breached when now equals due date', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-01-15T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "" }]);
});

test('rows sorted by severity descending then id ascending', () => {
  const doc = { issues: { b: { id: 'b', state: 'open', severity: 'low', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' }, a: { id: 'a', state: 'open', severity: 'crit', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' }, c: { id: 'c', state: 'open', severity: 'crit', createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: "crit", state: "open", ageDays: 14, slaBreached: false, title: "" }, { id: "c", area: undefined, kind: undefined, severity: "crit", state: "open", ageDays: 14, slaBreached: false, title: "" }, { id: "b", area: undefined, kind: undefined, severity: "low", state: "open", ageDays: 14, slaBreached: false, title: "" }]);
});

test('title longer than 120 chars is truncated', () => {
  const doc = { issues: { a: { id: 'a', state: 'open', title: 'x'.repeat(150), createdAt: '2024-01-01T00:00:00Z', slaDueAt: '2024-02-01T00:00:00Z' } } };
  assert.deepEqual(panelRows(doc, { now: '2024-01-15T00:00:00Z' }), [{ id: "a", area: undefined, kind: undefined, severity: undefined, state: "open", ageDays: 14, slaBreached: false, title: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }]);
});
