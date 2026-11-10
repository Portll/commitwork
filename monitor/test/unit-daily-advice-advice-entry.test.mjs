// Formats a remediation advice entry with capped fields (monitor/daily-advice.mjs adviceEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceEntry } from '../daily-advice.mjs';

test('caps id and ref and handles null verdict', () => {
  const item = { id: 'x'.repeat(250), kind: 'k', ref: 'y'.repeat(150), sev: 1, verdict: null };
  assert.deepEqual(adviceEntry(item), { id: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", kind: "k", ref: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", sev: "1", verdict: null, where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('caps where path and program and handles null line', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 2, verdict: 'v', where: { path: 'p'.repeat(350), line: null, program: 'pr'.repeat(80), item: null } };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "2", verdict: "v", where: { path: "pppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp", line: null, program: "prprprprprprprprprprprprprprprprprprprprprprprprprprprprprpr", item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('includes fingerprint only when it is a string', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 3, verdict: 'v', fingerprint: 'fp-123' };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "3", verdict: "v", where: { path: null, line: null, program: null, item: null }, fingerprint: "fp-123", detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('excludes fingerprint when it is not a string', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 3, verdict: 'v', fingerprint: 42 };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "3", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('caps remediation text and slices steps to eight', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 4, verdict: 'v', remediation: { text: 't'.repeat(700), steps: Array.from({ length: 10 }, (_, i) => 's' + i) } };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "4", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: "tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt", steps: ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"], fixAt: null, compliance: [], findingIds: [] });
});

test('returns empty steps when remediation is missing', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 5, verdict: 'v' };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "5", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('formats fixAt object with capped fields', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 6, verdict: 'v', remediation: { fixAt: { path: 'fp'.repeat(200), line: 10, item: 'it'.repeat(50), test: 'te'.repeat(400), why: 'w'.repeat(350) } } };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "6", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: { path: "fpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfpfp", line: 10, item: "itititititititititititititititititititititititititititititit", test: "tetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetetete", why: "wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww" }, compliance: [], findingIds: [] });
});

test('returns null fixAt when remediation is absent', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 7, verdict: 'v' };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "7", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [], findingIds: [] });
});

test('caps compliance entries and slices to twelve', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 8, verdict: 'v', compliance: Array.from({ length: 15 }, (_, i) => ({ framework: 'fw' + i, clause: 'cl' + i, title: 'ti' + i })) };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "8", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [{ framework: "fw0", clause: "cl0", title: "ti0" }, { framework: "fw1", clause: "cl1", title: "ti1" }, { framework: "fw2", clause: "cl2", title: "ti2" }, { framework: "fw3", clause: "cl3", title: "ti3" }, { framework: "fw4", clause: "cl4", title: "ti4" }, { framework: "fw5", clause: "cl5", title: "ti5" }, { framework: "fw6", clause: "cl6", title: "ti6" }, { framework: "fw7", clause: "cl7", title: "ti7" }, { framework: "fw8", clause: "cl8", title: "ti8" }, { framework: "fw9", clause: "cl9", title: "ti9" }, { framework: "fw10", clause: "cl10", title: "ti10" }, { framework: "fw11", clause: "cl11", title: "ti11" }], findingIds: [] });
});

test('handles compliance entry with missing title', () => {
  const item = { id: 'i', kind: 'k', ref: 'r', sev: 9, verdict: 'v', compliance: [{ framework: 'fw1', clause: 'cl1' }] };
  assert.deepEqual(adviceEntry(item), { id: "i", kind: "k", ref: "r", sev: "9", verdict: "v", where: { path: null, line: null, program: null, item: null }, detail: "", text: null, steps: [], fixAt: null, compliance: [{ framework: "fw1", clause: "cl1" }], findingIds: [] });
});
