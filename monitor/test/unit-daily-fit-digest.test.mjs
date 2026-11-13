// Fits a daily digest document into a byte budget by dropping context, advice, and items. (monitor/daily.mjs fitDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDigest } from '../daily.mjs';
import { Buffer } from 'node:buffer';

const docSize = (doc) => Buffer.byteLength(JSON.stringify(doc));

function makeRepo(overrides = {}) {
  return {
    items: [],
    advice: null,
    omittedIds: [],
    ...overrides
  };
}

function makeItem(overrides = {}) {
  return {
    id: 'item',
    state: 'new',
    severity: 'low',
    kind: 'code',
    pathClass: 'code',
    context: null,
    ...overrides
  };
}

test('returns the document unchanged when it already fits the budget', () => {
  const repo = makeRepo({ items: [makeItem({ id: 'a', context: 'x' })] });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) + 100;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [{ id: 'a', state: 'new', severity: 'low', kind: 'code', pathClass: 'code', context: 'x' }], advice: null, omittedIds: [] }] });
});

test('nulls context of lowest-ranked item when document exceeds budget', () => {
  const repo = makeRepo({ items: [makeItem({ id: 'a', context: 'x' })] });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) - 10;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: null, omittedIds: ["a"] }] });
});

test('pops advice ordered entries and increments omitted when advice state is read', () => {
  const repo = makeRepo({
    items: [],
    advice: { state: 'read', ordered: ['a', 'b'], omitted: 0 }
  });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) - 10;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: { state: "read", ordered: [], omitted: 2 }, omittedIds: [] }] });
});

test('does not pop advice when state is not read', () => {
  const repo = makeRepo({
    items: [],
    advice: { state: 'unread', ordered: ['a', 'b'], omitted: 0 }
  });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) - 10;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: { state: 'unread', ordered: ['a', 'b'], omitted: 0 }, omittedIds: [] }] });
});

test('stops nulling context when size equals maxBytes exactly', () => {
  const item1 = makeItem({ id: 'a', context: 'xx' });
  const item2 = makeItem({ id: 'b', context: 'yy' });
  const repo = makeRepo({ items: [item1, item2] });
  const input = { repos: [repo] };
  const sizeWithBothContexts = docSize(input);
  const sizeWithOneContext = docSize({ repos: [{ items: [{ ...item1, context: null }, { ...item2, context: 'yy' }], advice: null, omittedIds: [] }] });
  const maxBytes = sizeWithOneContext;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [{ id: "a", state: "new", severity: "low", kind: "code", pathClass: "code", context: "xx" }, { id: "b", state: "new", severity: "low", kind: "code", pathClass: "code", context: "yy" }], advice: null, omittedIds: [] }] });
});

test('selects only read advice for popping', () => {
  const repoRead = makeRepo({ advice: { state: 'read', ordered: ['x'], omitted: 0 } });
  const repoUnread = makeRepo({ advice: { state: 'unread', ordered: ['y'], omitted: 0 } });
  const input = { repos: [repoRead, repoUnread] };
  const maxBytes = docSize(input) - 10;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [
    { items: [], advice: { state: 'read', ordered: [], omitted: 1 }, omittedIds: [] },
    { items: [], advice: { state: 'unread', ordered: ['y'], omitted: 0 }, omittedIds: [] }
  ] });
});

test('does not enter while loop when size equals maxBytes and advice exists', () => {
  const repo = makeRepo({ advice: { state: 'read', ordered: ['x'], omitted: 0 } });
  const input = { repos: [repo] };
  const maxBytes = docSize(input);
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: { state: 'read', ordered: ['x'], omitted: 0 }, omittedIds: [] }] });
});

test('stops popping advice when size equals maxBytes exactly inside while loop', () => {
  const repo = makeRepo({ advice: { state: 'read', ordered: ['x', 'y'], omitted: 0 } });
  const input = { repos: [repo] };
  const sizeWithTwo = docSize(input);
  const sizeWithOne = docSize({ repos: [{ items: [], advice: { state: 'read', ordered: ['x'], omitted: 0 }, omittedIds: [] }] });
  const maxBytes = sizeWithOne;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: { state: 'read', ordered: ['x'], omitted: 1 }, omittedIds: [] }] });
});

test('increments omitted by 1 per popped advice entry', () => {
  const repo = makeRepo({ advice: { state: 'read', ordered: ['x', 'y'], omitted: 0 } });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) - 10;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: { state: "read", ordered: [], omitted: 2 }, omittedIds: [] }] });
});

test('removes lowest-ranked items and records ids when context and advice insufficient', () => {
  const item1 = makeItem({ id: 'a', context: null });
  const item2 = makeItem({ id: 'b', context: null });
  const repo = makeRepo({ items: [item1, item2] });
  const input = { repos: [repo] };
  const maxBytes = docSize(input) - 100;
  const result = fitDigest(input, maxBytes);
  assert.deepEqual(result, { repos: [{ items: [], advice: null, omittedIds: ['b', 'a'] }] });
});
