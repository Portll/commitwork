// Converts plan and task results into SQL INSERT statements (bin/spine-replay-core.mjs toSql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSql } from '../spine-replay-core.mjs';

test('skips plans marked preexisting and includes others', () => {
  const input = {
    plans: [
      { preexisting: true, record: { id: 1, name: 'a', cwd: '/x', project: 'p', status: 's', created_at: 'c', updated_at: 'u' } },
      { preexisting: false, record: { id: 2, name: 'b', cwd: '/y', project: 'q', status: 't', created_at: 'd', updated_at: 'v' } }
    ],
    tasks: []
  };
  assert.deepEqual(toSql(input), ["INSERT OR IGNORE INTO plans (id,name,cwd,project,status,created_at,updated_at) VALUES ('2','b','/y','q','t','d','v');"]);
});

test('includes plans when preexisting is undefined', () => {
  const input = {
    plans: [
      { record: { id: 3, name: 'c', cwd: '/z', project: 'r', status: 'u', created_at: 'e', updated_at: 'w' } }
    ],
    tasks: []
  };
  assert.deepEqual(toSql(input), ["INSERT OR IGNORE INTO plans (id,name,cwd,project,status,created_at,updated_at) VALUES ('3','c','/z','r','u','e','w');"]);
});

test('skips tasks marked preexisting and includes others', () => {
  const input = {
    plans: [],
    tasks: [
      { preexisting: true, record: { id: 10, plan_id: 1, parent_id: null, goal: 'g', status: 's', state: 'st', depends_on: null, created_at: 'c', updated_at: 'u' } },
      { preexisting: false, record: { id: 11, plan_id: 2, parent_id: 1, goal: 'h', status: 't', state: 'su', depends_on: 10, created_at: 'd', updated_at: 'v' } }
    ]
  };
  assert.deepEqual(toSql(input), ["INSERT OR IGNORE INTO tasks (id,plan_id,parent_id,goal,status,state,depends_on,created_at,updated_at) VALUES ('11','2','1','h','t','su','10','d','v');"]);
});

test('includes tasks when preexisting is undefined', () => {
  const input = {
    plans: [],
    tasks: [
      { record: { id: 12, plan_id: 3, parent_id: null, goal: 'i', status: 'u', state: 'sv', depends_on: null, created_at: 'e', updated_at: 'w' } }
    ]
  };
  assert.deepEqual(toSql(input), ["INSERT OR IGNORE INTO tasks (id,plan_id,parent_id,goal,status,state,depends_on,created_at,updated_at) VALUES ('12','3',NULL,'i','u','sv',NULL,'e','w');"]);
});

test('returns empty array when all entries are preexisting', () => {
  const input = {
    plans: [
      { preexisting: true, record: { id: 1, name: 'a', cwd: '/x', project: 'p', status: 's', created_at: 'c', updated_at: 'u' } }
    ],
    tasks: [
      { preexisting: true, record: { id: 10, plan_id: 1, parent_id: null, goal: 'g', status: 's', state: 'st', depends_on: null, created_at: 'c', updated_at: 'u' } }
    ]
  };
  assert.deepEqual(toSql(input), []);
});

test('returns empty array for empty plans and tasks', () => {
  const input = { plans: [], tasks: [] };
  assert.deepEqual(toSql(input), []);
});
