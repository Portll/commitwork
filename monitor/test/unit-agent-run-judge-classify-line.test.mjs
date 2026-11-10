// Splits one agent transcript line into session meta, tool calls and tool results (monitor/agent-run-judge.mjs classifyLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLine } from '../agent-run-judge.mjs';

test('non-objects and objects of an unknown shape give null', () => {
  assert.equal(classifyLine(null), null);
  assert.equal(classifyLine('assistant'), null);
  assert.equal(classifyLine(42), null);
  assert.equal(classifyLine({}), null);
});

test('assistant or user lines without an array of content give null', () => {
  assert.equal(classifyLine({ type: 'assistant' }), null);
  assert.equal(classifyLine({ type: 'user', message: { content: 'text' } }), null);
  assert.equal(classifyLine({ type: 'system', message: { content: [] } }), null);
});

test('an assistant line lists each tool_use as a call with its path and command', () => {
  const r = classifyLine({
    type: 'assistant', cwd: '/repo', sessionId: 's1', timestamp: '2026-01-01T00:00:00Z',
    message: { content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '', path: '/repo/a.js' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 'tu3', name: 'Grep', input: { pattern: 'TODO', path: 'src' } },
      { type: 'tool_use', id: 'tu4', name: 'Glob', input: { pattern: '**/*.js' } },
      { type: 'tool_use', input: 'echo hi' },
    ] },
  });
  assert.deepEqual(r, {
    meta: { cwd: '/repo', sessionId: 's1', at: '2026-01-01T00:00:00Z', format: 'claude' },
    calls: [
      { id: 'tu1', tool: 'Read', path: '/repo/a.js', command: null },
      { id: null, tool: 'Bash', path: null, command: 'ls' },
      { id: 'tu3', tool: 'Grep', path: 'src', command: null },
      { id: 'tu4', tool: 'Glob', path: '**/*.js', command: null },
      { id: null, tool: '?', path: null, command: 'echo hi' },
    ],
    results: [],
  });
});

test('a user line lists each tool_result with refused taken from is_error', () => {
  const r = classifyLine({
    type: 'user', cwd: '/w', sessionId: 's2', timestamp: 't5',
    message: { content: [
      { type: 'tool_result', tool_use_id: 'tu1', is_error: true },
      { type: 'tool_result', tool_use_id: 'tu2', is_error: false },
      { type: 'tool_result', tool_use_id: 'tu3' },
    ] },
  });
  assert.deepEqual(r, {
    meta: { cwd: '/w', sessionId: 's2', at: 't5', format: 'claude' },
    calls: [],
    results: [{ id: 'tu1', refused: true }, { id: 'tu2', refused: false }, { id: 'tu3', refused: false }],
  });
});

test('a codex session_meta line uses payload id and falls back to session_id', () => {
  assert.deepEqual(
    classifyLine({ type: 'session_meta', timestamp: 't0', payload: { id: 'sess-1', session_id: 'other', cwd: '/w' } }),
    { meta: { cwd: '/w', sessionId: 'sess-1', at: 't0', format: 'codex' }, calls: [], results: [] },
  );
  assert.deepEqual(
    classifyLine({ type: 'session_meta', timestamp: 't0', payload: { session_id: 'sess-2', cwd: '/w' } }),
    { meta: { cwd: '/w', sessionId: 'sess-2', at: 't0', format: 'codex' }, calls: [], results: [] },
  );
  assert.equal(classifyLine({ type: 'session_meta', timestamp: 't0' }), null);
});

test('a function_call parses JSON arguments for its command and path', () => {
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't2', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":"git status","path":"/w/x"}' } }),
    { meta: { at: 't2', format: 'codex' }, calls: [{ id: 'c1', tool: 'shell', path: '/w/x', command: 'git status' }], results: [] },
  );
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't2', payload: { type: 'function_call', name: 'shell', call_id: 'c9', arguments: 'not json' } }),
    { meta: { at: 't2', format: 'codex' }, calls: [{ id: 'c9', tool: 'shell', path: null, command: null }], results: [] },
  );
});

test('a custom_tool_call takes its command from input or args.cmd and its tool from the payload type when unnamed', () => {
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't3', payload: { type: 'custom_tool_call', arguments: { cmd: 'ls -la' } } }),
    { meta: { at: 't3', format: 'codex' }, calls: [{ id: null, tool: 'custom_tool_call', path: null, command: 'ls -la' }], results: [] },
  );
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't3', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch' } }),
    { meta: { at: 't3', format: 'codex' }, calls: [{ id: 'c2', tool: 'apply_patch', path: null, command: '*** Begin Patch' }], results: [] },
  );
});

test('a tool call output is refused only when its output starts with an error word', () => {
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't4', payload: { type: 'function_call_output', call_id: 'c1', output: 'Error: boom' } }),
    { meta: { at: 't4', format: 'codex' }, calls: [], results: [{ id: 'c1', refused: true }] },
  );
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't4', payload: { type: 'custom_tool_call_output', call_id: 'c2', output: 'no error here' } }),
    { meta: { at: 't4', format: 'codex' }, calls: [], results: [{ id: 'c2', refused: false }] },
  );
  assert.deepEqual(
    classifyLine({ type: 'response_item', timestamp: 't4', payload: { type: 'function_call_output', call_id: 'c3', output: 'Permission denied' } }),
    { meta: { at: 't4', format: 'codex' }, calls: [], results: [{ id: 'c3', refused: true }] },
  );
});

test('response_item lines without a known payload and payloads on other line types give null', () => {
  assert.equal(classifyLine({ type: 'response_item', timestamp: 't' }), null);
  assert.equal(classifyLine({ type: 'response_item', timestamp: 't', payload: { type: 'reasoning' } }), null);
  assert.equal(classifyLine({ type: 'event_msg', timestamp: 't', payload: { type: 'function_call', name: 'shell', arguments: '{}' } }), null);
});
