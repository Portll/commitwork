import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineFuture, MACHINE_FUTURE_STATES } from '../../lib/security-machine-future.mjs';

const NOW = '2026-01-10T00:00:00Z';
const DEADLINE = '2026-02-01T00:00:00Z';
const task = (id, status, dependsOn = [], over = {}) => ({
  id, title: `title-${id}`, status, dependsOn, owner: `owner-${id}`, dueAt: DEADLINE, ...over,
});
const run = (tasks, schedules = [], scenarios = [], now = NOW) => machineFuture({ tasks, schedules, scenarios, now });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('an empty future is an empty result carrying the schema version', () => {
  assert.deepEqual(run([]), { schemaVersion: 1, plans: [], schedules: [], scenarios: [], unknowns: [] });
});

test('ready work has no blockers and blocked work names each unfinished dependency', () => {
  const r = run([task('a', 'done'), task('b', 'requested', ['a']), task('c', 'requested', ['a', 'b'])]);
  assert.deepEqual(r.plans.map((p) => [p.id, p.state, p.blockers]), [
    ['a', 'done', []],
    ['b', 'ready', []],
    ['c', 'blocked', [{ id: 'b', status: 'requested' }]],
  ]);
});

test('failed, abandoned and unreviewed tasks are preserved with their state', () => {
  const r = run([task('f', 'failed'), task('x', 'abandoned'), task('u', 'unreviewed'), task('n', 'requested', ['f', 'x', 'u'])]);
  assert.deepEqual(r.plans.map((p) => [p.id, p.state]), [
    ['f', 'failed'], ['n', 'blocked'], ['u', 'unreviewed'], ['x', 'abandoned'],
  ]);
  assert.deepEqual(r.plans.find((p) => p.id === 'n').blockers, [
    { id: 'f', status: 'failed' }, { id: 'u', status: 'unreviewed' }, { id: 'x', status: 'abandoned' },
  ]);
});

test('an in-progress task is neither ready nor blocked but still lists its unfinished dependencies', () => {
  const p = run([task('a', 'requested'), task('b', 'in-progress', ['a'])]).plans[1];
  assert.equal(p.state, 'in-progress');
  assert.deepEqual(p.blockers, [{ id: 'a', status: 'requested' }]);
});

test('a schedule is scheduled, due or disabled from declared times and the supplied now', () => {
  const r = run([], [
    { id: 'later', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 86_400_000, enabled: true },
    { id: 'passed', nextAt: '2026-01-09T00:00:00Z', cadenceMs: 3_600_000, enabled: true },
    { id: 'off', nextAt: '2026-01-01T00:00:00Z', cadenceMs: 3_600_000, enabled: false },
  ]);
  assert.deepEqual(r.schedules, [
    { id: 'later', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 86_400_000, enabled: true, state: 'scheduled' },
    { id: 'off', nextAt: '2026-01-01T00:00:00Z', cadenceMs: 3_600_000, enabled: false, state: 'disabled' },
    { id: 'passed', nextAt: '2026-01-09T00:00:00Z', cadenceMs: 3_600_000, enabled: true, state: 'due' },
  ]);
});

test('a scheduled time exactly at now is due', () => {
  const [s] = run([], [{ id: 's', nextAt: NOW, cadenceMs: 1, enabled: true }]).schedules;
  assert.equal(s.state, 'due');
});

test('a passed scheduled time is due work, never an observed execution', () => {
  const [s] = run([], [{ id: 's', nextAt: '2026-01-01T00:00:00Z', cadenceMs: 3_600_000, enabled: true }]).schedules;
  assert.deepEqual(s, { id: 's', nextAt: '2026-01-01T00:00:00Z', cadenceMs: 3_600_000, enabled: true, state: 'due' });
});

test('schedule classification uses the supplied now, not the host clock', () => {
  const schedules = [
    { id: 'future', nextAt: '2001-01-01T00:00:00Z', cadenceMs: 1, enabled: true },
    { id: 'past', nextAt: '1999-01-01T00:00:00Z', cadenceMs: 1, enabled: true },
  ];
  const r = run([], schedules, [], '2000-01-01T00:00:00Z');
  assert.deepEqual(r.schedules.map((s) => [s.id, s.state]), [['future', 'scheduled'], ['past', 'due']]);
});

test('a declared deadline stays a deadline and never becomes a predicted or observed completion', () => {
  const p = run([task('t', 'requested', [], { dueAt: '2026-01-01T00:00:00Z' })]).plans[0];
  assert.equal(p.deadline, '2026-01-01T00:00:00Z');
  assert.equal(p.eta, null);
  assert.equal(p.state, 'ready');
});

test('a missing due date leaves the deadline null and records an unknown', () => {
  const r = run([task('t', 'requested', [], { dueAt: undefined })]);
  assert.equal(r.plans[0].deadline, null);
  assert.equal(r.plans[0].eta, null);
  assert.deepEqual(r.unknowns, [{ scope: 'plan', id: 't', field: 'dueAt', reason: 'missing' }]);
  assert.equal(run([task('t', 'requested', [], { dueAt: null })]).plans[0].deadline, null);
});

test('a scenario stays hypothetical and keeps its assumptions and outcomes', () => {
  const r = run([], [], [
    { id: 's2', label: 'If B', assumptions: ['b'], outcomes: ['x', 'y'] },
    { id: 's1', label: 'If A', assumptions: [], outcomes: ['z'] },
  ]);
  assert.deepEqual(r.scenarios, [
    { id: 's1', label: 'If A', assumptions: [], outcomes: ['z'], state: 'hypothetical' },
    { id: 's2', label: 'If B', assumptions: ['b'], outcomes: ['x', 'y'], state: 'hypothetical' },
  ]);
});

test('the same input gives byte-identical output whatever order it arrives in', () => {
  const tasks = [task('a', 'done'), task('b', 'requested', ['a', 'c']), task('c', 'requested', ['a'])];
  const schedules = [
    { id: 'z', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 1, enabled: true },
    { id: 'y', nextAt: '2026-01-09T00:00:00Z', cadenceMs: 2, enabled: true },
  ];
  const scenarios = [
    { id: 's2', label: 'B', assumptions: ['b'], outcomes: ['y'] },
    { id: 's1', label: 'A', assumptions: ['a'], outcomes: ['x'] },
  ];
  const a = run(tasks, schedules, scenarios);
  const scrambled = tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn].reverse() })).reverse();
  const b = run(scrambled, [...schedules].reverse(), [...scenarios].reverse());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a, b);
});

test('a deep-frozen input is accepted without mutation', () => {
  const input = deepFreeze({
    tasks: [task('a', 'done'), task('b', 'requested', ['a'])],
    schedules: [{ id: 's', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 1, enabled: true }],
    scenarios: [{ id: 'x', label: 'X', assumptions: ['a'], outcomes: ['b'] }],
    now: NOW,
  });
  const r = machineFuture(input);
  assert.deepEqual(r.plans.map((p) => p.state), ['done', 'ready']);
  assert.equal(r.schedules[0].state, 'scheduled');
});

test('every exported state is reachable and no other state is returned', () => {
  const r = run(
    [
      task('a', 'requested'), task('b', 'requested', ['f']), task('c', 'in-progress'),
      task('d', 'done'), task('e', 'failed'), task('f', 'abandoned'), task('g', 'unreviewed'),
    ],
    [
      { id: 'scheduled', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 1, enabled: true },
      { id: 'due', nextAt: '2026-01-09T00:00:00Z', cadenceMs: 1, enabled: true },
      { id: 'disabled', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 1, enabled: false },
    ],
    [{ id: 'scenario', label: 'L', assumptions: ['a'], outcomes: ['b'] }],
  );
  const states = [...r.plans, ...r.schedules, ...r.scenarios].map((item) => item.state);
  assert.deepEqual([...new Set(states)].sort(), [...MACHINE_FUTURE_STATES].sort());
  assert.ok(Object.isFrozen(MACHINE_FUTURE_STATES));
});

test('malformed top-level input is refused with the field named', () => {
  assert.throws(() => machineFuture(), /tasks must be an array/);
  assert.throws(() => machineFuture('x'), /input must be an object/);
  assert.throws(() => machineFuture({ tasks: [], schedules: [], scenarios: [], now: 'yesterday' }), /now must be an ISO-8601 instant/);
  assert.throws(() => machineFuture({ tasks: [], schedules: 'x', scenarios: [], now: NOW }), /schedules must be an array/);
  assert.throws(() => machineFuture({ tasks: [], schedules: [], scenarios: 'x', now: NOW }), /scenarios must be an array/);
});

test('malformed tasks are refused with the offending field named', () => {
  const base = { schedules: [], scenarios: [], now: NOW };
  assert.throws(() => machineFuture({ ...base, tasks: [null] }), /tasks\[0\] must be an object/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), id: '' }] }), /tasks\[0\]\.id must be a non-empty string/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), title: '' }] }), /tasks\[0\]\.title/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), owner: '' }] }), /tasks\[0\]\.owner/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), status: 'blocked' }] }), /tasks\[0\]\.status must be one of/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), dependsOn: 'a' }] }), /tasks\[0\]\.dependsOn must be an array/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), dependsOn: [''] }] }), /tasks\[0\]\.dependsOn\[0\] must be a non-empty string/);
  assert.throws(() => machineFuture({ ...base, tasks: [{ ...task('a', 'requested'), dueAt: '2026-02-30T00:00:00Z' }] }), /tasks\[0\]\.dueAt must be an ISO-8601 instant/);
});

test('duplicate task ids and duplicate dependencies are refused', () => {
  const base = { schedules: [], scenarios: [], now: NOW };
  assert.throws(() => machineFuture({ ...base, tasks: [task('a', 'requested'), task('a', 'done')] }), /tasks\[1\]\.id duplicates task: a/);
  assert.throws(() => machineFuture({ ...base, tasks: [task('a', 'requested'), task('b', 'requested', ['a', 'a'])] }), /tasks\[1\]\.dependsOn\[1\] duplicates dependency: a/);
});

test('unknown references and dependency cycles are refused', () => {
  const base = { schedules: [], scenarios: [], now: NOW };
  assert.throws(() => machineFuture({ ...base, tasks: [task('a', 'requested', ['z'])] }), /tasks\[0\]\.dependsOn\[0\] references unknown task: z/);
  assert.throws(() => machineFuture({ ...base, tasks: [task('a', 'requested', ['b']), task('b', 'requested', ['a'])] }), /tasks\[0\]\.dependsOn forms a dependency cycle/);
  assert.throws(() => machineFuture({ ...base, tasks: [task('a', 'requested', ['a'])] }), /tasks\[0\]\.dependsOn forms a dependency cycle/);
});

test('malformed schedules are refused with the offending field named', () => {
  const base = { tasks: [], scenarios: [], now: NOW };
  const s = { id: 's', nextAt: '2026-01-11T00:00:00Z', cadenceMs: 1000, enabled: true };
  assert.throws(() => machineFuture({ ...base, schedules: [null] }), /schedules\[0\] must be an object/);
  assert.throws(() => machineFuture({ ...base, schedules: [{ ...s, id: '' }] }), /schedules\[0\]\.id/);
  assert.throws(() => machineFuture({ ...base, schedules: [s, { ...s }] }), /schedules\[1\]\.id duplicates schedule: s/);
  assert.throws(() => machineFuture({ ...base, schedules: [{ ...s, nextAt: undefined }] }), /schedules\[0\]\.nextAt must be an ISO-8601 instant/);
  assert.throws(() => machineFuture({ ...base, schedules: [{ ...s, cadenceMs: 0 }] }), /schedules\[0\]\.cadenceMs must be a positive integer/);
  assert.throws(() => machineFuture({ ...base, schedules: [{ ...s, cadenceMs: 1.5 }] }), /cadenceMs must be a positive integer/);
  assert.throws(() => machineFuture({ ...base, schedules: [{ ...s, enabled: 'yes' }] }), /schedules\[0\]\.enabled must be a boolean/);
});

test('malformed scenarios are refused with the offending field named', () => {
  const base = { tasks: [], schedules: [], now: NOW };
  const s = { id: 's', label: 'S', assumptions: ['a'], outcomes: ['o'] };
  assert.throws(() => machineFuture({ ...base, scenarios: [null] }), /scenarios\[0\] must be an object/);
  assert.throws(() => machineFuture({ ...base, scenarios: [{ ...s, label: '' }] }), /scenarios\[0\]\.label/);
  assert.throws(() => machineFuture({ ...base, scenarios: [s, { ...s }] }), /scenarios\[1\]\.id duplicates scenario: s/);
  assert.throws(() => machineFuture({ ...base, scenarios: [{ ...s, assumptions: 'a' }] }), /scenarios\[0\]\.assumptions must be an array/);
  assert.throws(() => machineFuture({ ...base, scenarios: [{ ...s, assumptions: [''] }] }), /scenarios\[0\]\.assumptions\[0\]/);
  assert.throws(() => machineFuture({ ...base, scenarios: [{ ...s, outcomes: 'o' }] }), /scenarios\[0\]\.outcomes must be an array/);
  assert.throws(() => machineFuture({ ...base, scenarios: [{ ...s, outcomes: [''] }] }), /scenarios\[0\]\.outcomes\[0\]/);
});

test('unknowns are ordered by task id', () => {
  const r = run([task('c', 'requested', [], { dueAt: null }), task('a', 'requested', [], { dueAt: null }), task('b', 'done', [], { dueAt: null })]);
  assert.deepEqual(r.unknowns.map((u) => u.id), ['a', 'b', 'c']);
});

test('a dependency cycle is reported the same way whatever order the tasks arrive in', () => {
  const tasks = [task('c', 'requested', ['a']), task('a', 'requested', ['b']), task('b', 'requested', ['c'])];
  const message = (list) => { try { run(list); } catch (e) { return e.message.replace(/^tasks\[\d+\]/, 'tasks[n]'); } return null; };
  assert.equal(message(tasks), 'tasks[n].dependsOn forms a dependency cycle: a -> b -> c -> a');
  assert.equal(message([...tasks].reverse()), message(tasks));
});
