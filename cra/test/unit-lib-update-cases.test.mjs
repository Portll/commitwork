// Locked read-mutate-validate-save of the CRA case log with deferral banking (cra/lib.mjs updateCases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCases } from '../lib.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'updateCases-'));
  try { return fn(join(dir, 'cases.json')); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const capture = (fn) => {
  const calls = [];
  const orig = console.error;
  console.error = (...a) => { calls.push(a.join(' ')); };
  try { return { value: fn(), calls }; } finally { console.error = orig; }
};

test('a mutator returning true is saved to disk and true is passed back as the result', () => withDir((p) => {
  const r = updateCases({ cases: p }, (doc) => { doc.extra = 'x'; return true; });
  const { waitedMs, doc, ...rest } = r;
  assert.deepEqual(rest, { ok: true, saved: true, result: true, deferred: [] });
  assert.equal(doc.extra, 'x');
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), doc);
}));

test('a mutator returning false leaves no file behind and reports saved false', () => withDir((p) => {
  const r = updateCases({ cases: p }, (doc) => { doc.extra = 'x'; return false; });
  const { waitedMs, doc, ...rest } = r;
  assert.deepEqual(rest, { ok: true, saved: false, result: false, deferred: [] });
  assert.deepEqual([doc.extra, doc.events, doc.cases], ['x', [], {}]);
  assert.equal(existsSync(p), false);
}));

test('an object outcome without a save key is saved because it is truthy and its result is unwrapped', () => withDir((p) => {
  const r = updateCases({ cases: p }, (doc) => { doc.extra = 'y'; return { result: 'r' }; });
  const { waitedMs, doc, ...rest } = r;
  assert.deepEqual(rest, { ok: true, saved: true, result: 'r', deferred: [] });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).extra, 'y');
}));

test('an existing document is loaded and left untouched when the outcome says save false', () => withDir((p) => {
  const existing = { note: 'n', events: [], cases: {} };
  const text = JSON.stringify(existing);
  writeFileSync(p, text);
  const r = updateCases({ cases: p }, () => ({ save: false, result: 'skipped' }));
  const { waitedMs, ...rest } = r;
  assert.deepEqual(rest, { ok: true, doc: existing, saved: false, result: 'skipped', deferred: [] });
  assert.equal(readFileSync(p, 'utf8'), text);
}));

test('a newly written case that fails validation is refused and nothing is written', () => withDir((p) => {
  const kase = { caseId: 'c1', kind: 'vulnerability', productId: 'p1', trigger: 't1', status: 'open', epss: 0.5,
    clocks: { track: 'article14', basisAt: '2024-01-01T00:00:00Z', earlyWarningDue: '2024-01-02T00:00:00Z', notificationDue: '2024-01-03T00:00:00Z', finalDue: '2024-01-04T00:00:00Z' } };
  const { value: r, calls } = capture(() => updateCases({ cases: p }, (doc) => { doc.cases.c1 = kase; return { save: true, result: 'done' }; }));
  const { waitedMs, ...rest } = r;
  assert.deepEqual(rest, { ok: false, reason: 'case-invalid', errors: ["c1: trigger 't1' is not a declared trigger"], doc: null, saved: false, deferred: [] });
  assert.equal(calls.length, 2);
  assert.equal(existsSync(p), false);
}));

test('earlier deferrals are drained into one write-deferred event and saved even when the mutator declines', () => withDir((p) => {
  const entries = [
    { at: '2024-01-01T00:00:00Z', label: 'w1', reason: 'lock-contention' },
    { at: '2024-01-02T00:00:00Z', label: 'w2', reason: 'lock-contention' },
  ];
  writeFileSync(`${p}.deferred.jsonl`, entries.map((e) => JSON.stringify(e) + '\n').join(''));
  const { value: r, calls } = capture(() => updateCases({ cases: p }, () => false));
  assert.deepEqual([r.ok, r.saved, r.result, r.deferred], [true, true, false, entries]);
  const ev = r.doc.events[0];
  const { note, ...data } = ev.data;
  assert.deepEqual([r.doc.events.length, ev.type, ev.caseId, ev.prevHash], [1, 'write-deferred', null, null]);
  assert.deepEqual(data, { skipped: 2, from: '2024-01-01T00:00:00Z', to: '2024-01-02T00:00:00Z', writers: ['w1', 'w2'] });
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), r.doc);
  assert.equal(existsSync(`${p}.deferred.jsonl`), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].replace('\u2026', '...'),
    'cra: 2 earlier case-log write(s) were deferred by contention (2024-01-01T00:00:00Z ... 2024-01-02T00:00:00Z); banked as a write-deferred event');
}));

test('pre-existing invalid cases are reported with at most five detail lines and still saved', () => withDir((p) => {
  writeFileSync(p, JSON.stringify({ note: 'n', events: [], cases: { a: {}, b: {} } }));
  const { value: r, calls } = capture(() => updateCases({ cases: p }, () => true));
  assert.deepEqual([r.ok, r.saved, r.result, r.deferred, calls.length], [true, true, true, [], 6]);
  assert.equal(calls[0].startsWith('cra: 12 PRE-EXISTING case record(s)'), true);
  assert.equal(calls[1].endsWith('(no caseId): caseId is required'), true);
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')).cases, { a: {}, b: {} });
}));

test('a case log path that is a directory is refused as unreadable', () => withDir((p) => {
  mkdirSync(p);
  assert.throws(() => updateCases({ cases: p }, () => false),
    { name: 'Error', message: `CRA case log at ${p} is unreadable (EISDIR); refusing to treat it as empty` });
}));

test('an empty case log file is refused as invalid JSON', () => withDir((p) => {
  writeFileSync(p, '');
  assert.throws(() => updateCases({ cases: p }, () => true),
    { name: 'Error', message: `CRA case log at ${p} is not valid JSON (Unexpected end of JSON input); refusing to treat it as empty` });
}));

test('JSON that is not an object with events and cases is refused as not a case document', () => withDir((p) => {
  for (const body of ['null', '[]', '{"events":[]}', '{"cases":{}}']) {
    writeFileSync(p, body);
    assert.throws(() => updateCases({ cases: p }, () => true),
      { name: 'Error', message: `CRA case log at ${p} is not a case document (events[] + cases{}); refusing to overwrite it` });
    assert.equal(readFileSync(p, 'utf8'), body);
  }
}));
