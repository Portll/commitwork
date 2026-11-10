// Builds a veld API client with auth, timeout, and todo filtering (monitor/daily-todos.mjs veldClient).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { veldClient } from '../daily-todos.mjs';

test('dailyTodos filters items by tag and returns matching todos', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: true, todos: [
      { id: 'a', tags: ['commitwork-daily'] },
      { id: 'b', tags: ['other'] },
      { id: 'c' }
    ] })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  const r = await client.dailyTodos();
  assert.deepEqual(r, [{ id: "a", tags: ["commitwork-daily"] }]);
});

test('dailyTodos returns empty array when todos is null', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: true, todos: null })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  const r = await client.dailyTodos();
  assert.deepEqual(r, []);
});

test('call throws when response is not ok with status and body', async () => {
  const fetchImpl = async (u, o) => ({
    ok: false, status: 500,
    text: async () => 'boom'
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  await assert.rejects(client.add({ title: 't' }), {
    name: 'Error',
    message: 'veld /api/todos/add answered 500: boom'
  });
});

test('call throws when success is false with formatted message', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: false, formatted: 'nope' })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  await assert.rejects(client.add({ title: 't' }), {
    name: 'Error',
    message: 'veld /api/todos/add refused: nope'
  });
});

test('call returns parsed json when success is true', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: true, id: 'new1' })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  const r = await client.add({ title: 't' });
  assert.deepEqual(r, { success: true, id: "new1" });
});

test('complete encodes id in path and returns json', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: true, done: true })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  const r = await client.complete('a/b');
  assert.deepEqual(r, { success: true, done: true });
});

test('comment posts content and author to comments endpoint', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: true, comment_id: 'c1' })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  const r = await client.comment('id1', 'hello');
  assert.deepEqual(r, { success: true, comment_id: "c1" });
});

test('call throws when success is false and formatted is undefined', async () => {
  const fetchImpl = async (u, o) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ success: false })
  });
  const client = veldClient({ url: 'http://x', key: 'k', user: 'u', fetchImpl });
  await assert.rejects(client.add({ title: 't' }), {
    name: 'Error',
    message: 'veld /api/todos/add refused: '
  });
});
