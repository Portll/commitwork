// Detects permission entries that grant broad or unbounded access (bin/agent-config.mjs broadPermission).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broadPermission } from '../agent-config.mjs';

test('returns empty string for null or undefined input', () => {
  assert.equal(broadPermission(null), '');
  assert.equal(broadPermission(undefined), '');
  assert.equal(broadPermission(''), '');
});

test('returns empty string for non-matching tool names', () => {
  assert.equal(broadPermission('123'), '');
  assert.equal(broadPermission('-tool'), '');
  assert.equal(broadPermission('tool with spaces'), '');
  assert.equal(broadPermission('Read'), '');
  assert.equal(broadPermission('Read(file.txt)'), '');
});

test('returns bare grant message for broad bare tools', () => {
  assert.equal(broadPermission('Bash'), 'bare Bash grants every invocation');
  assert.equal(broadPermission('Write'), 'bare Write grants every invocation');
  assert.equal(broadPermission('Edit'), 'bare Edit grants every invocation');
  assert.equal(broadPermission('MultiEdit'), 'bare MultiEdit grants every invocation');
  assert.equal(broadPermission('NotebookEdit'), 'bare NotebookEdit grants every invocation');
  assert.equal(broadPermission('WebFetch'), 'bare WebFetch grants every invocation');
  assert.equal(broadPermission('WebSearch'), 'bare WebSearch grants every invocation');
  assert.equal(broadPermission('Agent'), 'bare Agent grants every invocation');
  assert.equal(broadPermission('Task'), 'bare Task grants every invocation');
});

test('returns bare grant message for mcp tools with exactly two parts', () => {
  assert.equal(broadPermission('mcp__server'), 'bare mcp__server grants every tool of that server');
  assert.equal(broadPermission('mcp__my-server'), 'bare mcp__my-server grants every tool of that server');
});

test('returns empty string for mcp tools with wrong part count', () => {
  assert.equal(broadPermission('mcp__'), "bare mcp__ grants every tool of that server");
  assert.equal(broadPermission('mcp'), '');
  assert.equal(broadPermission('mcp__a__b'), '');
});

test('returns unbounded message for wildcard patterns', () => {
  assert.equal(broadPermission('Bash(*)'), 'Bash(*) is unbounded');
  assert.equal(broadPermission('Bash(:*)'), 'Bash(:*) is unbounded');
  assert.equal(broadPermission('Bash(**)'), 'Bash(**) is unbounded');
  assert.equal(broadPermission('Bash(*:*)'), 'Bash(*:*) is unbounded');
  assert.equal(broadPermission('Read(*)'), 'Read(*) is unbounded');
});

test('returns network fetch warning for curl or wget in Bash', () => {
  assert.equal(broadPermission('Bash(curl http://example.com)'), 'network fetch is allowed without review');
  assert.equal(broadPermission('Bash(wget http://example.com)'), 'network fetch is allowed without review');
  assert.equal(broadPermission('Bash(curl)'), 'network fetch is allowed without review');
  assert.equal(broadPermission('Bash(wget)'), 'network fetch is allowed without review');
});

test('returns empty string for non-network commands in Bash', () => {
  assert.equal(broadPermission('Bash(ls)'), '');
  assert.equal(broadPermission('Bash(echo hello)'), '');
  assert.equal(broadPermission('Bash(curlie)'), '');
  assert.equal(broadPermission('Bash(wgetx)'), '');
});

test('returns disk access warning for root paths in Write Edit MultiEdit', () => {
  assert.equal(broadPermission('Write(/)'), 'Write anywhere on disk');
  assert.equal(broadPermission('Write(~/)'), 'Write anywhere on disk');
  assert.equal(broadPermission('Write(/*)'), 'Write anywhere on disk');
  assert.equal(broadPermission('Write(~/**)'), 'Write anywhere on disk');
  assert.equal(broadPermission('Edit(/)'), 'Edit anywhere on disk');
  assert.equal(broadPermission('Edit(~/)'), 'Edit anywhere on disk');
  assert.equal(broadPermission('MultiEdit(/)'), 'MultiEdit anywhere on disk');
  assert.equal(broadPermission('MultiEdit(~/**)'), 'MultiEdit anywhere on disk');
});

test('returns empty string for non-root paths in Write Edit MultiEdit', () => {
  assert.equal(broadPermission('Write(src/)'), '');
  assert.equal(broadPermission('Write(./)'), '');
  assert.equal(broadPermission('Write(file.txt)'), '');
  assert.equal(broadPermission('Edit(src/)'), '');
  assert.equal(broadPermission('Edit(./)'), '');
  assert.equal(broadPermission('MultiEdit(src/)'), '');
  assert.equal(broadPermission('MultiEdit(./)'), '');
});

test('returns empty string for non-broad tools with arguments', () => {
  assert.equal(broadPermission('Read(src/file.txt)'), '');
  assert.equal(broadPermission('Read(/)'), '');
  assert.equal(broadPermission('Grep(pattern)'), '');
  assert.equal(broadPermission('Grep(*)'), 'Grep(*) is unbounded');
});
