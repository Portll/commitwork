// Computes the daily advice section from a scan result (monitor/daily-advice.mjs adviceSection).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceSection } from '../daily-advice.mjs';

test('returns unavailable with default reason when result is null', () => {
  const r = adviceSection(null, { repo: 'r', items: [], dataPaths: [], maxEntries: 40 });
  assert.deepEqual(r, { state: "unavailable", reason: "no advice was asked for" });
});

test('returns unavailable with reason from result when ok is false', () => {
  const r = adviceSection({ ok: false, reason: 'scan failed' }, { repo: 'r', items: [], dataPaths: [], maxEntries: 40 });
  assert.deepEqual(r, { state: "unavailable", reason: "scan failed" });
});

test('returns unavailable with unavailable field when ok is false and no reason', () => {
  const r = adviceSection({ ok: false, unavailable: 'no data' }, { repo: 'r', items: [], dataPaths: [], maxEntries: 40 });
  assert.deepEqual(r, { state: "unavailable", reason: "no data" });
});

test('returns read state with empty ordered when no items in summary', () => {
  const r = adviceSection({ ok: true, doc: { items: [], summary: { ordered: [] }, unmeasured: [], generatedBy: { toolVersion: '1.0' } } }, { repo: 'r', items: [], dataPaths: [], maxEntries: 40 });
  assert.deepEqual(r, { state: "read", toolVersion: "1.0", unmeasured: [], ordered: [], omitted: 0, dataPathItems: 0 });
});

test('counts data path items and excludes them from ordered', () => {
  const r = adviceSection({ ok: true, doc: { items: [{ id: 'a1', kind: 'finding', ref: 'R1', where: { path: './data/x.csv' } }], summary: { ordered: ['a1'] }, unmeasured: [], generatedBy: {} } }, { repo: 'r', items: [], dataPaths: ['data'], maxEntries: 40 });
  assert.deepEqual(r, { state: "read", toolVersion: "", unmeasured: [], ordered: [], omitted: 0, dataPathItems: 1 });
});

test('includes non-data items in ordered with empty findingIds', () => {
  const r = adviceSection({ ok: true, doc: { items: [{ id: 'a1', kind: 'finding', ref: 'R1', where: { path: 'src/x.cob' } }], summary: { ordered: ['a1'] }, unmeasured: [], generatedBy: {} } }, { repo: 'r', items: [], dataPaths: ['data'], maxEntries: 40 });
  assert.deepEqual(r, { state: "read", toolVersion: "", unmeasured: [], ordered: [{ id: "a1", kind: "finding", ref: "R1", sev: "undefined", verdict: null, where: { path: "src/x.cob", line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] }], omitted: 0, dataPathItems: 0 });
});

test('omits entries beyond maxEntries and reports omitted count', () => {
  const ids = Array.from({ length: 5 }, (_, i) => 'id' + i);
  const items = ids.map((id) => ({ id, kind: 'finding', ref: 'R', where: { path: 'src/p.cob' } }));
  const r = adviceSection({ ok: true, doc: { items, summary: { ordered: ids }, unmeasured: [], generatedBy: {} } }, { repo: 'r', items: [], dataPaths: [], maxEntries: 3 });
  assert.deepEqual(r, { state: "read", toolVersion: "", unmeasured: [], ordered: [{ id: "id0", kind: "finding", ref: "R", sev: "undefined", verdict: null, where: { path: "src/p.cob", line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] }, { id: "id1", kind: "finding", ref: "R", sev: "undefined", verdict: null, where: { path: "src/p.cob", line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] }, { id: "id2", kind: "finding", ref: "R", sev: "undefined", verdict: null, where: { path: "src/p.cob", line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] }], omitted: 2, dataPathItems: 0 });
});

test('truncates unmeasured to 20 entries', () => {
  const unmeasured = Array.from({ length: 25 }, (_, i) => 'u' + i);
  const r = adviceSection({ ok: true, doc: { items: [], summary: { ordered: [] }, unmeasured, generatedBy: {} } }, { repo: 'r', items: [], dataPaths: [], maxEntries: 40 });
  assert.deepEqual(r, { state: "read", toolVersion: "", unmeasured: ["u0", "u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9", "u10", "u11", "u12", "u13", "u14", "u15", "u16", "u17", "u18", "u19"], ordered: [], omitted: 0, dataPathItems: 0 });
});
