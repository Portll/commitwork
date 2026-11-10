// Inbox read and snooze marks saved per operator (monitor/inbox.mjs markInbox).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markInbox } from '../inbox.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA = 'commitwork.inbox-state/1';
const OLDEST = '2024-01-01T00:00:00.000Z';
const OLD = '2025-01-01T00:00:00.000Z';
const NOW = '2025-03-10T12:00:00.000Z';
const LATER = '2025-06-01T00:00:00.000Z';
const key = (id, who = 'op') => `${who}\u0000${id}`;
const save = (p, entries) => writeFileSync(p, JSON.stringify({ schema: SCHEMA, entries }));
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fill = (n, at) => Object.fromEntries(Array.from({ length: n }, (_, i) => [key(`k${String(i).padStart(4, '0')}`), { readAt: at, at }]));
const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'markInbox-'));
  try { fn(join(dir, 'inbox-state.json')); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('An unknown action is rejected with a 400 and nothing is written', () => withDir((p) => {
  const r = markInbox({ ids: ['a'], action: 'archive', who: 'op', nowIso: NOW, path: p });
  assert.deepEqual(r, { ok: false, code: 400, error: 'action must be one of read, unread, snooze, unsnooze' });
  assert.equal(existsSync(p), false);
}));

test('Ids must be 1 to 500 strings of 1 to 1000 characters', () => withDir((p) => {
  const error = 'ids must be 1\u2013500 non-empty strings';
  const tooMany = Array.from({ length: 501 }, (_, i) => `id${i}`);
  for (const ids of ['a', undefined, [], tooMany, [''], [7], ['ok', 'x'.repeat(1001)]]) {
    assert.deepEqual(markInbox({ ids, action: 'read', who: 'op', nowIso: NOW, path: p }), { ok: false, code: 400, error });
  }
  assert.equal(existsSync(p), false);
  const ids = Array.from({ length: 500 }, (_, i) => String(i).padStart(1000, 'x'));
  assert.deepEqual(markInbox({ ids, action: 'read', who: 'op', nowIso: NOW, path: p }), { ok: true, applied: 500 });
  const doc = load(p);
  assert.deepEqual(Object.keys(doc.entries), ids.map((id) => key(id)).sort());
  assert.deepEqual(doc.entries[key(ids[0])], { readAt: NOW, at: NOW });
}));

test('A missing operator identity is rejected with a 401', () => withDir((p) => {
  for (const who of ['', undefined, null]) {
    const r = markInbox({ ids: ['a'], action: 'read', who, nowIso: NOW, path: p });
    assert.deepEqual(r, { ok: false, code: 401, error: 'no operator identity to record the state against' });
  }
  assert.equal(existsSync(p), false);
}));

test('Snooze takes 1 to 365 whole days, defaults to 7 and rejects anything else', () => withDir((p) => {
  for (const days of [0, -1, 366, 1.5, 'soon', null]) {
    const r = markInbox({ ids: ['a'], action: 'snooze', who: 'op', nowIso: NOW, days, path: p });
    assert.deepEqual(r, { ok: false, code: 400, error: 'days must be an integer from 1 to 365' });
  }
  assert.equal(existsSync(p), false);
  for (const [id, days] of [['min', 1], ['max', 365], ['text', '2'], ['default', undefined]]) {
    const r = markInbox({ ids: [id], action: 'snooze', who: 'op', nowIso: NOW, days, path: p });
    assert.deepEqual(r, { ok: true, applied: 1 });
  }
  assert.deepEqual(load(p), {
    schema: SCHEMA,
    entries: {
      [key('min')]: { snoozedUntil: '2025-03-11T12:00:00.000Z', at: NOW },
      [key('max')]: { snoozedUntil: '2026-03-10T12:00:00.000Z', at: NOW },
      [key('text')]: { snoozedUntil: '2025-03-12T12:00:00.000Z', at: NOW },
      [key('default')]: { snoozedUntil: '2025-03-17T12:00:00.000Z', at: NOW },
    },
  });
}));

test('Read records readAt and at under the operator, ignores days and sorts the keys', () => withDir((p) => {
  const prior = { readAt: OLD, at: OLD };
  save(p, { [key('z')]: prior, [key('a', 'other')]: prior });
  const r = markInbox({ ids: ['b'], action: 'read', who: 'op', nowIso: NOW, days: 0, path: p });
  assert.deepEqual(r, { ok: true, applied: 1 });
  const entries = { [key('b')]: { readAt: NOW, at: NOW }, [key('z')]: prior, [key('a', 'other')]: prior };
  assert.equal(readFileSync(p, 'utf8'), JSON.stringify({ schema: SCHEMA, entries }, null, 1) + '\n');
}));

test('Each action changes only its own field and entries left with neither field are dropped', () => withDir((p) => {
  const both = { readAt: OLD, snoozedUntil: LATER, at: OLD };
  const snoozed = { snoozedUntil: LATER, at: OLD };
  save(p, { [key('u1')]: both, [key('u2')]: { readAt: OLD, at: OLD }, [key('s1')]: both, [key('s2')]: snoozed, [key('r1')]: snoozed });
  assert.deepEqual(markInbox({ ids: ['u1', 'u2', 'never'], action: 'unread', who: 'op', nowIso: NOW, path: p }), { ok: true, applied: 3 });
  assert.deepEqual(markInbox({ ids: ['s1', 's2'], action: 'unsnooze', who: 'op', nowIso: NOW, path: p }), { ok: true, applied: 2 });
  assert.deepEqual(markInbox({ ids: ['r1'], action: 'read', who: 'op', nowIso: NOW, path: p }), { ok: true, applied: 1 });
  assert.deepEqual(load(p).entries, {
    [key('u1')]: { snoozedUntil: LATER, at: NOW },
    [key('s1')]: { readAt: OLD, at: NOW },
    [key('r1')]: { snoozedUntil: LATER, readAt: NOW, at: NOW },
  });
}));

test('A state file that fails the schema check is refused with a 503 and left untouched', () => withDir((p) => {
  for (const doc of [{ schema: 'commitwork.inbox-state/0', entries: {} }, { schema: SCHEMA, entries: [] }]) {
    const raw = JSON.stringify(doc);
    writeFileSync(p, raw);
    const r = markInbox({ ids: ['a'], action: 'read', who: 'op', nowIso: NOW, path: p });
    assert.deepEqual(r, { ok: false, code: 503, error: `refusing to write: inbox state at ${p} is not ${SCHEMA}` });
    assert.equal(readFileSync(p, 'utf8'), raw);
  }
}));

test('Past the cap the entry with the oldest at is evicted even when its key sorts last', () => withDir((p) => {
  const entries = fill(5000, OLD);
  entries[key('k4999')] = { readAt: OLDEST, at: OLDEST };
  save(p, entries);
  const r = markInbox({ ids: ['new'], action: 'read', who: 'op', nowIso: NOW, path: p });
  assert.deepEqual(r, { ok: true, applied: 1 });
  delete entries[key('k4999')];
  entries[key('new')] = { readAt: NOW, at: NOW };
  assert.deepEqual(load(p).entries, entries);
}));

test('Reaching exactly 5000 entries evicts nothing', () => withDir((p) => {
  const entries = fill(4999, OLD);
  save(p, entries);
  const r = markInbox({ ids: ['new'], action: 'read', who: 'op', nowIso: NOW, path: p });
  assert.deepEqual(r, { ok: true, applied: 1 });
  entries[key('new')] = { readAt: NOW, at: NOW };
  assert.deepEqual(load(p).entries, entries);
}));

test('Among equal timestamps the smallest keys are evicted rather than the first written', () => withDir((p) => {
  const entries = fill(5001, OLD);
  save(p, Object.fromEntries(Object.entries(entries).reverse()));
  const r = markInbox({ ids: ['new'], action: 'read', who: 'op', nowIso: NOW, path: p });
  assert.deepEqual(r, { ok: true, applied: 1 });
  delete entries[key('k0000')];
  delete entries[key('k0001')];
  entries[key('new')] = { readAt: NOW, at: NOW };
  assert.deepEqual(load(p).entries, entries);
}));
