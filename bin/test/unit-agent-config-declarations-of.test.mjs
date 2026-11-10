// Maps a raw agent config document to its normalized declarations, JSON pointers, and structural issues. (bin/agent-config.mjs declarationsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declarationsOf } from '../agent-config.mjs';

test('returns the input unchanged with empty pointers and issues when the document is not an object', () => {
  const out = declarationsOf(null);
  assert.equal(out.decl, null);
  assert.equal(out.pointers.size, 0);
  assert.equal(out.issues.length, 0);
  const out2 = declarationsOf([1, 2]);
  assert.deepEqual(out2.decl, [1, 2]);
  assert.equal(out2.pointers.size, 0);
  assert.equal(out2.issues.length, 0);
});

test('copies include and maps permissions allow and deny to grants and denies with pointers', () => {
  const doc = { include: ['a'], permissions: { allow: ['x'], deny: ['y'] } };
  const { decl, pointers, issues } = declarationsOf(doc);
  assert.deepEqual(decl.include, ['a']);
  assert.deepEqual(decl.grants, ['x']);
  assert.deepEqual(decl.denies, ['y']);
  assert.equal(pointers.get('/grants'), '/permissions/allow');
  assert.equal(pointers.get('/denies'), '/permissions/deny');
  assert.equal(issues.length, 0);
});

test('records a malformed issue when permissions is not an object', () => {
  const { decl, issues } = declarationsOf({ permissions: 'nope' });
  assert.equal('grants' in decl, false);
  assert.equal('denies' in decl, false);
  assert.deepEqual(issues, [{ kind: 'malformed', pointer: '/permissions', reason: 'expected an object of permission lists' }]);
});

test('flattens hooks entries with command into the hooks array with event and pointer', () => {
  const doc = { hooks: { pre: [{ command: 'run', matcher: 'm' }] } };
  const { decl, pointers, issues } = declarationsOf(doc);
  assert.deepEqual(decl.hooks, [{ command: 'run', matcher: 'm', event: 'pre' }]);
  assert.equal(pointers.get('/hooks/0'), '/hooks/pre/0');
  assert.equal(issues.length, 0);
});

test('records a malformed issue when a hook entry declares neither command nor hooks', () => {
  const { issues } = declarationsOf({ hooks: { pre: [{ foo: 1 }] } });
  assert.deepEqual(issues, [{ kind: 'malformed', pointer: '/hooks/pre/0', reason: 'hook entry declares neither command nor hooks' }]);
});

test('records a malformed issue when a hook event value is not an array', () => {
  const { issues } = declarationsOf({ hooks: { pre: 'not-array' } });
  assert.deepEqual(issues, [{ kind: 'malformed', pointer: '/hooks/pre', reason: 'expected an array of hook entries' }]);
});

test('expands nested hooks arrays with event and matcher and records pointers', () => {
  const doc = { hooks: { pre: [{ hooks: [{ command: 'a' }, { command: 'b' }], matcher: 'm' }] } };
  const { decl, pointers, issues } = declarationsOf(doc);
  assert.deepEqual(decl.hooks, [
    { command: 'a', event: 'pre', matcher: 'm' },
    { command: 'b', event: 'pre', matcher: 'm' },
  ]);
  assert.equal(pointers.get('/hooks/0'), '/hooks/pre/0/hooks/0');
  assert.equal(pointers.get('/hooks/1'), '/hooks/pre/0/hooks/1');
  assert.equal(issues.length, 0);
});

test('merges mcpServers and servers into decl.servers and flags duplicate names across blocks', () => {
  const doc = { mcpServers: { a: { url: '1' } }, servers: { a: { url: '2' }, b: { url: '3' } } };
  const { decl, pointers, issues } = declarationsOf(doc);
  assert.equal(Object.getPrototypeOf(decl.servers), null);
  assert.equal(decl.servers.a.url, '1');
  assert.equal(decl.servers.b.url, '3');
  assert.equal(Object.keys(decl.servers).length, 2);
  assert.equal(pointers.get('/servers/a'), '/mcpServers/a');
  assert.equal(pointers.get('/servers/b'), '/servers/b');
  assert.deepEqual(issues, [{ kind: 'malformed', pointer: '/servers/a', reason: 'server name is also declared under mcpServers in this file' }]);
});

test('records a malformed issue when a server block is not an object', () => {
  const { decl, issues } = declarationsOf({ mcpServers: 'bad' });
  assert.equal('servers' in decl, false);
  assert.deepEqual(issues, [{ kind: 'malformed', pointer: '/mcpServers', reason: 'expected an object of named server declarations' }]);
});

test('escapes pointer parts for keys containing tilde and slash', () => {
  const key = 'a~b/c';
  const doc = { hooks: { [key]: [{ command: 'x' }] } };
  const { pointers } = declarationsOf(doc);
  assert.equal(pointers.get('/hooks/0'), `/hooks/a~0b~1c/0`);
});
