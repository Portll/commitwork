// Applies a plan of todo creates, completions, and comments to a client (monitor/daily-todos.mjs applyTodos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTodos } from '../daily-todos.mjs';

test('reuses existing todo when external id matches', async () => {
  const plan = {
    create: [{ externalId: 'ext1', body: { title: 't' }, findingIds: ['f1'] }],
    complete: [],
    comment: [],
    ledger: { findings: { f1: {} } }
  };
  const client = { add: async () => { throw new Error('should not add'); } };
  const todos = [{ id: 'todo1', external_id: 'ext1' }];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: ["todo1"], completed: [], commented: [], errors: [] });
});

test('creates new todo when external id not in todos', async () => {
  const plan = {
    create: [{ externalId: 'ext2', body: { title: 't' }, findingIds: ['f1'] }],
    complete: [],
    comment: [],
    ledger: { findings: { f1: {} } }
  };
  const client = { add: async (args) => ({ todo: { id: 'new1' } }) };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: ["new1"], reused: [], completed: [], commented: [], errors: [] });
});

test('completes todo with comment', async () => {
  const plan = {
    create: [],
    complete: [{ todoId: 't1', comment: 'done' }],
    comment: [],
    ledger: { findings: {} }
  };
  const client = { comment: async () => {}, complete: async () => {} };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: [], completed: ["t1"], commented: [], errors: [] });
});

test('adds comment to todo', async () => {
  const plan = {
    create: [],
    complete: [],
    comment: [{ todoId: 't2', text: 'note' }],
    ledger: { findings: {} }
  };
  const client = { comment: async () => {} };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: [], completed: [], commented: ["t2"], errors: [] });
});

test('records error when create fails', async () => {
  const plan = {
    create: [{ externalId: 'ext3', body: {}, findingIds: [] }],
    complete: [],
    comment: [],
    ledger: { findings: {} }
  };
  const client = { add: async () => { throw new Error('boom'); } };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: [], completed: [], commented: [], errors: ["create ext3: boom"] });
});

test('records error when complete fails', async () => {
  const plan = {
    create: [],
    complete: [{ todoId: 't3', comment: 'x' }],
    comment: [],
    ledger: { findings: {} }
  };
  const client = { comment: async () => { throw new Error('fail'); }, complete: async () => {} };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: [], completed: [], commented: [], errors: ["complete t3: fail"] });
});

test('records error when comment fails', async () => {
  const plan = {
    create: [],
    complete: [],
    comment: [{ todoId: 't4', text: 'y' }],
    ledger: { findings: {} }
  };
  const client = { comment: async () => { throw new Error('err'); } };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: [], reused: [], completed: [], commented: [], errors: ["comment t4: err"] });
});

test('handles multiple findings in one create', async () => {
  const plan = {
    create: [{ externalId: 'ext5', body: { title: 'multi' }, findingIds: ['fa', 'fb'] }],
    complete: [],
    comment: [],
    ledger: { findings: { fa: {}, fb: {} } }
  };
  const client = { add: async () => ({ todo: { id: 'new5' } }) };
  const todos = [];
  const r = await applyTodos(plan, client, todos);
  assert.deepEqual(r, { created: ["new5"], reused: [], completed: [], commented: [], errors: [] });
});
