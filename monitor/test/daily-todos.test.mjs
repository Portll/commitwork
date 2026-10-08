// /daily todos: what is filed, what is not filed again, what is completed, and that a re-run files nothing twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTodos, emptyLedger, externalIdFor, planTodos } from '../daily-todos.mjs';
import { itemId } from '../daily.mjs';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';
const digest = ({ items = [A, B], fixed = [], carried = [] } = {}) => ({
  config: { sha256: 'f'.repeat(64) },
  repos: [{ name: 'r', items: items.map((id) => ({ id })), omittedIds: [], fixed: fixed.map((id) => ({ id, rule: 'x', file: 'f' })), carried }],
});
const suggestion = (id, findingIds, priority = 'p1') => ({
  id, repo: 'r', findingIds, priority, title: `do ${id}`, why: 'w', where: [{ file: 'f', line: 1 }], change: 'c', verify: { lane: 'sast', expect: 'e' }, effort: 'S', confidence: 'high',
});
const report = (suggestions) => ({ area: 'ar', batch: 'sweep-20261002000000', suggestions });
const plan = (over) => planTodos({ report: report([suggestion('S1', [A, B])]), digest: digest(), ledger: emptyLedger(), todos: [], reportPath: '/r.json', today: '2026-10-02', ...over });
const todo = (id, ids, status = 'todo', extra = {}) => ({ id, status, tags: ['commitwork-daily', ...ids.map((i) => `finding:${i}`)], ...extra });

test('a new suggestion becomes one todo with its findings, priority, provenance and an external id', () => {
  const p = plan();
  assert.equal(p.create.length, 1);
  const c = p.create[0];
  assert.deepEqual(c.findingIds, [A, B]);
  assert.equal(c.externalId, externalIdFor('ar', [B, A]));
  assert.equal(c.body.priority, 'high');
  assert.equal(c.body.project, 'r');
  assert.ok(c.body.tags.includes(`finding:${A}`));
  assert.match(c.body.notes, /verify before acting/);
  assert.equal(c.body.due_date, undefined);
  assert.equal(plan({ report: report([suggestion('S1', [A], 'p0')]) }).create[0].body.due_date, '2026-10-02');
});

test('findings an open todo covers are not filed again', () => {
  const first = plan();
  first.ledger.findings[A].todoId = 't1';
  first.ledger.findings[B].todoId = 't1';
  const again = plan({ ledger: first.ledger, todos: [todo('t1', [A, B])] });
  assert.deepEqual(again.create, []);
});

test('a todo the operator closed or deleted is not filed again while its finding persists', () => {
  const first = plan();
  first.ledger.findings[A].todoId = 't1';
  first.ledger.findings[B].todoId = 't1';
  assert.deepEqual(plan({ ledger: first.ledger, todos: [todo('t1', [A, B], 'cancelled')] }).create, []);
  const deleted = plan({ ledger: structuredClone(first.ledger), todos: [] });
  assert.deepEqual(deleted.create, []);
  assert.equal(deleted.ledger.findings[A].closedByUser, true);
});

test('a todo whose findings are all fixed is completed, and a finding that returns is filed again', () => {
  const first = plan();
  for (const id of [A, B]) first.ledger.findings[id].todoId = 't1';
  const fixed = plan({ report: report([]), digest: digest({ items: [], fixed: [A, B] }), ledger: first.ledger, todos: [todo('t1', [A, B])] });
  assert.deepEqual(fixed.complete.map((c) => c.todoId), ['t1']);
  assert.equal(fixed.ledger.findings[A].state, 'fixed');
  const back = plan({ report: report([suggestion('S1', [A])]), digest: digest({ items: [A] }), ledger: fixed.ledger, todos: [todo('t1', [A, B], 'done')] });
  assert.deepEqual(back.create.map((c) => c.findingIds), [[A]]);
});

test('a fixed finding older than the retention cutoff leaves the ledger', () => {
  const first = plan();
  const fixed = plan({ report: report([]), digest: digest({ items: [], fixed: [A, B] }), ledger: first.ledger });
  assert.ok(fixed.ledger.findings[A]);
  const later = plan({ report: report([]), digest: digest({ items: [] }), ledger: fixed.ledger, forgetFixedBefore: 'sweep-20261101000000' });
  assert.equal(later.ledger.findings[A], undefined);
  const kept = plan({ report: report([]), digest: digest({ items: [] }), ledger: fixed.ledger, forgetFixedBefore: 'sweep-20260901000000' });
  assert.ok(kept.ledger.findings[A]);
});

test('a renamed finding keeps its todo: not filed again, and completed when the renamed finding is fixed', () => {
  const oldId = itemId('r', 'sastSemgrep', 'js.weak', 'src/old.js');
  const newId = itemId('r', 'sastSemgrep', 'js.weak', 'src/new.js');
  const d1 = { config: { sha256: 'f'.repeat(64) }, repos: [{ name: 'r', items: [{ id: oldId }], omittedIds: [], fixed: [], carried: [] }] };
  const first = planTodos({ report: report([suggestion('S1', [oldId])]), digest: d1, ledger: emptyLedger(), todos: [], reportPath: '/r', today: 't' });
  first.ledger.findings[oldId].todoId = 't1';
  const d2 = { config: d1.config, repos: [{ name: 'r', items: [{ id: newId, category: 'sastSemgrep', rule: 'js.weak', renamedFrom: 'src/old.js' }], omittedIds: [], fixed: [], carried: [] }] };
  const second = planTodos({ report: report([suggestion('S1', [newId])]), digest: d2, ledger: first.ledger, todos: [todo('t1', [oldId])], reportPath: '/r', today: 't' });
  assert.deepEqual(second.create, []);
  assert.equal(second.ledger.findings[newId].todoId, 't1');
  assert.equal(second.ledger.findings[oldId].state, 'renamed');
  const d3 = { config: d1.config, repos: [{ name: 'r', items: [], omittedIds: [], fixed: [{ id: newId, rule: 'js.weak', file: 'src/new.js' }], carried: [] }] };
  const third = planTodos({ report: report([]), digest: d3, ledger: second.ledger, todos: [todo('t1', [oldId])], reportPath: '/r', today: 't' });
  assert.deepEqual(third.complete.map((c) => c.todoId), ['t1']);
});

test('a todo with a finding that went unmeasured is commented, not completed', () => {
  const first = plan();
  for (const id of [A, B]) first.ledger.findings[id].todoId = 't1';
  const p = plan({ report: report([]), digest: digest({ items: [B], carried: [A] }), ledger: first.ledger, todos: [todo('t1', [A, B])] });
  assert.deepEqual(p.complete, []);
  assert.deepEqual(p.comment.map((c) => c.todoId), ['t1']);
});

test('p2 filing stops at the daily cap and p3 is not filed', () => {
  const p = plan({
    report: report([suggestion('S1', [A], 'p2'), suggestion('S2', [B], 'p2'), suggestion('S3', [C], 'p3')]),
    digest: digest({ items: [A, B, C] }), fileTodos: { p2PerDay: 1, p3: false },
  });
  assert.deepEqual(p.create.map((c) => c.findingIds), [[A]]);
});

test('applying a plan reuses a todo that already holds its external id, so a re-run files nothing twice', async () => {
  const p = plan();
  const calls = [];
  const client = { add: async (body) => { calls.push(['add', body.external_id]); return { todo: { id: 'new' } }; }, complete: async () => {}, comment: async () => {} };
  const existing = [{ id: 'old', status: 'todo', tags: [], external_id: p.create[0].externalId }];
  const result = await applyTodos(p, client, existing);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.reused, ['old']);
  assert.equal(p.ledger.findings[A].todoId, 'old');
  const fresh = plan();
  const r2 = await applyTodos(fresh, client, []);
  assert.deepEqual(r2.created, ['new']);
  assert.deepEqual(calls, [['add', fresh.create[0].externalId]]);
});

test('a veld failure is recorded, not thrown, and leaves the ledger without a todo id', async () => {
  const p = plan();
  const client = { add: async () => { throw new Error('veld down'); }, complete: async () => {}, comment: async () => {} };
  const r = await applyTodos(p, client, []);
  assert.match(r.errors[0], /veld down/);
  assert.equal(p.ledger.findings[A].todoId, null);
});
