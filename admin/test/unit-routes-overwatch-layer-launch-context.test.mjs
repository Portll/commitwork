// Builds a human-readable context string for a launch preset (admin/routes/overwatch-layer.mjs launchContext).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchContext } from '../routes/overwatch-layer.mjs';

test('explain with no project lists all plans across the fleet', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha', tasks: [{ id: 't1', status: 'pending', goal: 'g1' }] },
    { id: 'p2', status: 'done', name: 'Beta', tasks: [] }
  ];
  const out = launchContext('explain', { plans });
  assert.equal(out, '2 plan(s) across the fleet:\np1 [active] Alpha (1 tasks, 1 open)\np2 [done] Beta (0 tasks, 0 open)');
});

test('explain with project filters plans to that project', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha', project: 'projA', tasks: [] },
    { id: 'p2', status: 'done', name: 'Beta', project: 'projB', tasks: [] },
    { id: 'p3', status: 'active', name: 'Gamma', project: 'projA', tasks: [] }
  ];
  const out = launchContext('explain', { plans, project: 'projA' });
  assert.equal(out, '2 plan(s) in projA:\np1 [active] Alpha (0 tasks, 0 open)\np3 [active] Gamma (0 tasks, 0 open)');
});

test('status preset behaves identically to explain', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha', tasks: [{ id: 't1', status: 'active', goal: 'g1' }] }
  ];
  const out = launchContext('status', { plans });
  assert.equal(out, '1 plan(s) across the fleet:\np1 [active] Alpha (1 tasks, 1 open)');
});

test('audit preset lists plans declared for the project', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha', project: 'projA', tasks: [] },
    { id: 'p2', status: 'done', name: 'Beta', project: 'projB', tasks: [] }
  ];
  const out = launchContext('audit', { plans, project: 'projA' });
  assert.equal(out, 'Plans declared for projA:\np1 [active] Alpha (0 tasks, 0 open)');
});

test('remediate preset lists open tasks with plan and task ids', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha', tasks: [
      { id: 't1', status: 'pending', goal: 'fix bug' },
      { id: 't2', status: 'done', goal: 'old task' },
      { id: 't3', status: 'active', goal: 'in progress' }
    ]}
  ];
  const out = launchContext('remediate', { plans });
  assert.equal(out, 'p1/t1: fix bug\np1/t3: in progress');
});

test('remediate returns fallback message when no open tasks exist', () => {
  const plans = [
    { id: 'p1', status: 'done', name: 'Alpha', tasks: [
      { id: 't1', status: 'done', goal: 'finished' }
    ]}
  ];
  const out = launchContext('remediate', { plans });
  assert.equal(out, 'no open task was found for this scope');
});

test('explain caps output at 40 plans', () => {
  const plans = Array.from({ length: 45 }, (_, i) => ({
    id: `p${i}`, status: 'active', name: `Plan ${i}`, tasks: []
  }));
  const out = launchContext('explain', { plans });
  const lines = out.split('\n');
  assert.equal(lines.length, 41);
  assert.equal(lines[0], '45 plan(s) across the fleet:');
  assert.equal(lines[1], 'p0 [active] Plan 0 (0 tasks, 0 open)');
  assert.equal(lines[40], 'p39 [active] Plan 39 (0 tasks, 0 open)');
});

test('remediate caps output at 20 open tasks', () => {
  const plans = Array.from({ length: 5 }, (_, i) => ({
    id: `p${i}`, status: 'active', name: `Plan ${i}`,
    tasks: Array.from({ length: 5 }, (_, j) => ({
      id: `t${j}`, status: 'pending', goal: `goal ${i}-${j}`
    }))
  }));
  const out = launchContext('remediate', { plans });
  const lines = out.split('\n');
  assert.equal(lines.length, 20);
  assert.equal(lines[0], 'p0/t0: goal 0-0');
  assert.equal(lines[19], 'p3/t4: goal 3-4');
});

test('tasks missing or non-array are treated as empty', () => {
  const plans = [
    { id: 'p1', status: 'active', name: 'Alpha' },
    { id: 'p2', status: 'done', name: 'Beta', tasks: 'not-an-array' }
  ];
  const out = launchContext('explain', { plans });
  assert.equal(out, '2 plan(s) across the fleet:\np1 [active] Alpha (0 tasks, 0 open)\np2 [done] Beta (0 tasks, 0 open)');
});
