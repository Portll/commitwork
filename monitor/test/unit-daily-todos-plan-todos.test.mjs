// Computes a plan of todo creates, completes, comments, and ledger updates (monitor/daily-todos.mjs planTodos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTodos } from '../daily-todos.mjs';

const mkReport = (area, batch, suggestions = []) => ({ area, batch, suggestions });
const mkDigest = (repos, configSha = 'abc') => ({ repos, config: { sha256: configSha } });
const mkTodo = (id, status, tags = []) => ({ id, status, tags });

test('renames a finding and keeps its todo association', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { old1: { repo: 'r', state: 'open', todoId: 't1', closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [{ id: 'new1', renamedFrom: 'old1' }], fixed: [], carried: [], omittedIds: [] }]);
  const r = planTodos({ report: mkReport('a', 2), digest, ledger, todos: [mkTodo('t1', 'todo')], fileTodos: {}, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { old1: { repo: "r", state: "open", todoId: "t1", closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 }, new1: { repo: "r", state: "open", todoId: null, closedByUser: false, firstSeenBatch: 2, lastSeenBatch: 2 } } } });
});

test('marks a todo complete when all its findings are fixed', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'open', todoId: 't1', closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [], fixed: [{ id: 'f1' }], carried: [], omittedIds: [] }]);
  const r = planTodos({ report: mkReport('a', 2), digest, ledger, todos: [mkTodo('t1', 'todo', ['finding:f1'])], fileTodos: {}, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [], complete: [{ todoId: "t1", comment: "Fixed: every finding of this todo is gone in 2, and its lane ran in both sweeps." }], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "fixed", todoId: "t1", closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1, fixedBatch: 2 } } } });
});

test('comments on a todo when its findings are carried', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'open', todoId: 't1', closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [], fixed: [], carried: ['f1'], omittedIds: [] }]);
  const r = planTodos({ report: mkReport('a', 2), digest, ledger, todos: [mkTodo('t1', 'todo', ['finding:f1'])], fileTodos: {}, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [], complete: [], comment: [{ todoId: "t1", text: "Not measured in 2: the lane did not run or its tool changed, so 1 finding(s) here are neither fixed nor confirmed." }], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "open", todoId: "t1", closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } } });
});

test('creates a todo for an uncovered p0 suggestion', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'open', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [{ id: 'f1' }], fixed: [], carried: [], omittedIds: [] }]);
  const suggestions = [{ repo: 'r', title: 'T', priority: 'p0', findingIds: ['f1'], where: [{ file: 'a.js', line: 1 }], verify: { lane: 'l', command: 'c', expect: 'e' }, why: 'w', change: 'ch', effort: 1, confidence: 0.9, id: 's1' }];
  const r = planTodos({ report: mkReport('a', 2, suggestions), digest, ledger, todos: [], fileTodos: {}, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [{ externalId: "commitwork-daily:a:3f524cdc07a11d7c", findingIds: ["f1"], body: { content: "[r] T", priority: "urgent", project: "r", tags: ["commitwork-daily", "area:a", "priority:p0", "finding:f1"], notes: "w\n\nChange: ch\nWhere: a.js:1\nVerify: re-run lane l; c. Expect: e\nEffort 1, confidence 0.9.\n\nMachine-written by commitwork /daily from scan data: verify before acting.\nReport p, s1 of 2 (area a).", due_date: "2024-01-01" } }], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "open", todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 2 } } } });
});

test('skips p3 suggestions when fileTodos.p3 is false', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'open', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [{ id: 'f1' }], fixed: [], carried: [], omittedIds: [] }]);
  const suggestions = [{ repo: 'r', title: 'T', priority: 'p3', findingIds: ['f1'], where: [{ file: 'a.js', line: 1 }], verify: { lane: 'l', command: 'c', expect: 'e' }, why: 'w', change: 'ch', effort: 1, confidence: 0.9, id: 's1' }];
  const r = planTodos({ report: mkReport('a', 2, suggestions), digest, ledger, todos: [], fileTodos: { p3: false }, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "open", todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 2 } } } });
});

test('limits p2 suggestions to p2PerDay', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'open', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 }, f2: { repo: 'r', state: 'open', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [{ id: 'f1' }, { id: 'f2' }], fixed: [], carried: [], omittedIds: [] }]);
  const mkS = (id, fid) => ({ repo: 'r', title: 'T', priority: 'p2', findingIds: [fid], where: [{ file: 'a.js', line: 1 }], verify: { lane: 'l', command: 'c', expect: 'e' }, why: 'w', change: 'ch', effort: 1, confidence: 0.9, id });
  const r = planTodos({ report: mkReport('a', 2, [mkS('s1', 'f1'), mkS('s2', 'f2')]), digest, ledger, todos: [], fileTodos: { p2PerDay: 1 }, reportPath: 'p', today: '2024-01-01' });
  assert.deepEqual(r, { create: [{ externalId: "commitwork-daily:a:3f524cdc07a11d7c", findingIds: ["f1"], body: { content: "[r] T", priority: "medium", project: "r", tags: ["commitwork-daily", "area:a", "priority:p2", "finding:f1"], notes: "w\n\nChange: ch\nWhere: a.js:1\nVerify: re-run lane l; c. Expect: e\nEffort 1, confidence 0.9.\n\nMachine-written by commitwork /daily from scan data: verify before acting.\nReport p, s1 of 2 (area a)." } }], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "open", todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 2 }, f2: { repo: "r", state: "open", todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 2 } } } });
});

test('deletes fixed findings older than forgetFixedBefore', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'fixed', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1, fixedBatch: 1 } } };
  const digest = mkDigest([{ name: 'r', items: [], fixed: [], carried: [], omittedIds: [] }]);
  const r = planTodos({ report: mkReport('a', 2), digest, ledger, todos: [], fileTodos: {}, reportPath: 'p', today: '2024-01-01', forgetFixedBefore: 2 });
  assert.deepEqual(r, { create: [], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: {} } });
});

test('keeps fixed findings at exactly forgetFixedBefore', () => {
  const ledger = { schema: 'x', configSha256: null, findings: { f1: { repo: 'r', state: 'fixed', todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1, fixedBatch: 2 } } };
  const digest = mkDigest([{ name: 'r', items: [], fixed: [], carried: [], omittedIds: [] }]);
  const r = planTodos({ report: mkReport('a', 3), digest, ledger, todos: [], fileTodos: {}, reportPath: 'p', today: '2024-01-01', forgetFixedBefore: 2 });
  assert.deepEqual(r, { create: [], complete: [], comment: [], ledger: { schema: "commitwork.daily-ledger/1", configSha256: "abc", findings: { f1: { repo: "r", state: "fixed", todoId: null, closedByUser: false, firstSeenBatch: 1, lastSeenBatch: 1, fixedBatch: 2 } } } });
});
