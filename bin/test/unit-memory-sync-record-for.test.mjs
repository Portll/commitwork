// Builds the memory record object for a parsed memory entry (bin/memory-sync.mjs recordFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordFor } from '../memory-sync.mjs';

test('returns the record with default project and no group tag', () => {
  const parsed = { name: 'alpha', type: 'fact', description: 'd1', body: 'b1' };
  const r = recordFor(parsed);
  assert.deepEqual(r, { external_id: "claude-memory/commitwork/alpha", content: "d1\n\nb1", tags: ["memory:alpha", "harness-memory", "memory-type:fact"], memory_type: "Context" });
});

test('returns the record with a custom project and a group tag', () => {
  const parsed = { name: 'beta', type: 'note', description: 'd2', body: 'b2' };
  const r = recordFor(parsed, { project: 'myproj', group: 'My Group' });
  assert.deepEqual(r, { external_id: "claude-memory/myproj/beta", content: "d2\n\nb2", tags: ["memory:beta", "harness-memory", "memory-type:note", "memory-group:my-group"], memory_type: "Context" });
});

test('returns the record when group is explicitly null', () => {
  const parsed = { name: 'gamma', type: 'context', description: 'd3', body: 'b3' };
  const r = recordFor(parsed, { group: null });
  assert.deepEqual(r, { external_id: "claude-memory/commitwork/gamma", content: "d3\n\nb3", tags: ["memory:gamma", "harness-memory", "memory-type:context"], memory_type: "Context" });
});

test('returns the record with a group containing special characters', () => {
  const parsed = { name: 'delta', type: 'insight', description: 'd4', body: 'b4' };
  const r = recordFor(parsed, { project: 'p', group: '  Hello, World!  ' });
  assert.deepEqual(r, { external_id: "claude-memory/p/delta", content: "d4\n\nb4", tags: ["memory:delta", "harness-memory", "memory-type:insight", "memory-group:hello-world"], memory_type: "Context" });
});

test('returns the record with a single character name and type', () => {
  const parsed = { name: 'x', type: 'y', description: 'desc', body: 'body' };
  const r = recordFor(parsed, { project: 'proj', group: 'g' });
  assert.deepEqual(r, { external_id: "claude-memory/proj/x", content: "desc\n\nbody", tags: ["memory:x", "harness-memory", "memory-type:y", "memory-group:g"], memory_type: "Context" });
});

test('returns the record with a long repeated name', () => {
  const parsed = { name: 'a'.repeat(50), type: 't'.repeat(10), description: 'dd', body: 'bb' };
  const r = recordFor(parsed, { project: 'pp', group: 'gg' });
  assert.deepEqual(r, { external_id: "claude-memory/pp/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", content: "dd\n\nbb", tags: ["memory:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "harness-memory", "memory-type:tttttttttt", "memory-group:gg"], memory_type: "Context" });
});
