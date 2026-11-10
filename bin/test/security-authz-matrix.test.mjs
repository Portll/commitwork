import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandAuthzMatrix } from '../../lib/security-authz-matrix.mjs';

const actors = [
  { id: 'alice', tenant: 't1', role: 'admin' },
  { id: 'bob', tenant: 't2', role: 'member' },
];
const resources = [
  { id: 'doc1', tenant: 't1', owner: 'alice' },
  { id: 'doc2', tenant: 't2', owner: 'bob' },
];
const operations = [
  { id: 'read', method: 'GET', path: '/docs/:id' },
  { id: 'write', method: 'PUT', path: '/docs/:id' },
];

test('an allowlisted triple is allow and every other combination is deny', () => {
  const cases = expandAuthzMatrix({ actors, resources, operations, permissions: [{ actor: 'alice', resource: 'doc1', operation: 'read' }] });
  assert.equal(cases.length, 8);
  assert.deepEqual(cases.filter((c) => c.expected === 'allow').map((c) => [c.actor, c.resource, c.operation]), [['alice', 'doc1', 'read']]);
  assert.equal(cases.filter((c) => c.expected === 'deny').length, 7);
});

test('an empty allowlist denies everything', () => {
  const cases = expandAuthzMatrix({ actors, resources, operations, permissions: [] });
  assert.ok(cases.every((c) => c.expected === 'deny'));
});

test('each case states the tenant and ownership boundary it crosses', () => {
  const cases = expandAuthzMatrix({ actors, resources, operations, permissions: [] });
  const cross = cases.find((c) => c.actor === 'bob' && c.resource === 'doc1' && c.operation === 'write');
  assert.equal(cross.sameTenant, false);
  assert.equal(cross.owner, false);
  assert.equal(cross.role, 'member');
  assert.equal(cross.method, 'PUT');
  const own = cases.find((c) => c.actor === 'alice' && c.resource === 'doc1' && c.operation === 'read');
  assert.equal(own.sameTenant, true);
  assert.equal(own.owner, true);
});

test('ids containing the old separator cannot borrow another triple\'s allow', () => {
  const tricky = {
    actors: [{ id: 'a|b', tenant: 't', role: 'r' }, { id: 'a', tenant: 't', role: 'r' }],
    resources: [{ id: 'c', tenant: 't', owner: 'a' }, { id: 'b|c', tenant: 't', owner: 'a' }],
    operations: [{ id: 'op', method: 'GET', path: '/' }],
    permissions: [{ actor: 'a|b', resource: 'c', operation: 'op' }],
  };
  const cases = expandAuthzMatrix(tricky);
  assert.deepEqual(cases.filter((c) => c.expected === 'allow').map((c) => [c.actor, c.resource]), [['a|b', 'c']]);
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
});

test('output is identical whatever order the inputs arrive in', () => {
  const permissions = [{ actor: 'bob', resource: 'doc2', operation: 'write' }, { actor: 'alice', resource: 'doc1', operation: 'read' }];
  const a = expandAuthzMatrix({ actors, resources, operations, permissions });
  const b = expandAuthzMatrix({ actors: [...actors].reverse(), resources: [...resources].reverse(), operations: [...operations].reverse(), permissions: [...permissions].reverse() });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((c) => c.id), a.map((c) => c.id).sort());
});

test('an empty dimension yields no cases', () => {
  assert.deepEqual(expandAuthzMatrix({ actors: [], resources, operations, permissions: [] }), []);
  assert.deepEqual(expandAuthzMatrix({ actors, resources: [], operations, permissions: [] }), []);
  assert.deepEqual(expandAuthzMatrix({ actors, resources, operations: [], permissions: [] }), []);
});

test('unknown references are refused', () => {
  const base = { actors, resources, operations };
  assert.throws(() => expandAuthzMatrix({ ...base, permissions: [{ actor: 'eve', resource: 'doc1', operation: 'read' }] }), /unknown actor/);
  assert.throws(() => expandAuthzMatrix({ ...base, permissions: [{ actor: 'alice', resource: 'doc9', operation: 'read' }] }), /unknown resource/);
  assert.throws(() => expandAuthzMatrix({ ...base, permissions: [{ actor: 'alice', resource: 'doc1', operation: 'delete' }] }), /unknown operation/);
});

test('duplicate ids and duplicate permissions are refused', () => {
  assert.throws(() => expandAuthzMatrix({ actors: [actors[0], { ...actors[0], role: 'x' }], resources, operations, permissions: [] }), /duplicate actors id/);
  assert.throws(() => expandAuthzMatrix({ actors, resources: [resources[0], resources[0]], operations, permissions: [] }), /duplicate resources id/);
  assert.throws(() => expandAuthzMatrix({ actors, resources, operations: [operations[0], operations[0]], permissions: [] }), /duplicate operations id/);
  const p = { actor: 'alice', resource: 'doc1', operation: 'read' };
  assert.throws(() => expandAuthzMatrix({ actors, resources, operations, permissions: [p, { ...p }] }), /duplicate permission/);
});

test('missing or empty fields are refused rather than defaulted', () => {
  assert.throws(() => expandAuthzMatrix({ actors: [{ id: 'a', tenant: 't' }], resources, operations, permissions: [] }), /actors\[0\]\.role/);
  assert.throws(() => expandAuthzMatrix({ actors: [{ id: '', tenant: 't', role: 'r' }], resources, operations, permissions: [] }), /actors\[0\]\.id/);
  assert.throws(() => expandAuthzMatrix({ actors, resources: [{ id: 'r', tenant: 't', owner: '' }], operations, permissions: [] }), /resources\[0\]\.owner/);
  assert.throws(() => expandAuthzMatrix({ actors, resources, operations: [{ id: 'o', method: 'GET' }], permissions: [] }), /operations\[0\]\.path/);
  assert.throws(() => expandAuthzMatrix({ actors, resources, operations }), /permissions must be an array/);
  assert.throws(() => expandAuthzMatrix(), /actors must be an array/);
  assert.throws(() => expandAuthzMatrix({ actors, resources, operations, permissions: [null] }), /permissions\[0\] must be an object/);
});
