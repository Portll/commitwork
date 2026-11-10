// Folds a flat step stream into per-turn summaries with token and abort accounting (bin/lib/turn-recorder-core.mjs foldTurns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldTurns } from '../lib/turn-recorder-core.mjs';

test('a user prompt with no following steps yields one turn with zero assistant steps and modelAuthored true', () => {
  const steps = [{ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } }];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 0, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "" }]);
});

test('an assistant step with a tool call and a non-abort tool result yields one turn with one assistant step, one tool call, one tool result, and modelAuthored true', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: [{ type: 'tool_use', name: 'bash' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: 3, message: { content: [{ type: 'tool_result', content: 'ok' }] } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: ["bash"], toolCallCount: 1, toolResults: 1, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 10, output: 5, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "" }]);
});

test('an assistant step with a tool call followed by a transport abort tool result yields one turn with one transport abort and zero calls after abort', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: [{ type: 'tool_use', name: 'bash' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: 3, message: { content: [{ type: 'tool_result', content: 'Tool permission stream closed before response' }] } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: ["bash"], toolCallCount: 1, toolResults: 1, transportAborts: 1, callsAfterAbort: 0, tokens: { input: 10, output: 5, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "" }]);
});

test('an assistant step with a tool call after a transport abort yields one turn with one call after abort', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: [{ type: 'tool_use', name: 'bash' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: 3, message: { content: [{ type: 'tool_result', content: 'Tool permission stream closed before response' }] } },
    { type: 'assistant', uuid: 'a2', sessionId: 's1', timestamp: 4, message: { content: [{ type: 'tool_use', name: 'bash' }], usage: { input_tokens: 10, output_tokens: 5 } } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 2, toolCalls: ["bash", "bash"], toolCallCount: 2, toolResults: 1, transportAborts: 1, callsAfterAbort: 1, tokens: { input: 20, output: 10, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "" }]);
});

test('an assistant step with zero output tokens yields one turn with modelAuthored false', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: 'No response requested.', usage: { input_tokens: 10, output_tokens: 0 } } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 10, output: 0, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: false, text: "No response requested." }]);
});

test('an assistant step with positive output tokens yields one turn with modelAuthored true', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: 'hello', usage: { input_tokens: 10, output_tokens: 5 } } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 10, output: 5, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "hello" }]);
});

test('an assistant step with no usage block yields one turn with modelAuthored true', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: 'hello' } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "hello" }]);
});

test('two user prompts separated by assistant steps yield two turns', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: 'hello', usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: 3, message: { content: 'again' } },
    { type: 'assistant', uuid: 'a2', sessionId: 's1', timestamp: 4, message: { content: 'hello again', usage: { input_tokens: 20, output_tokens: 10 } } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 10, output: 5, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "hello" }, { openedByUuid: "u2", sessionId: "s1", at: 3, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 20, output: 10, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "hello again" }]);
});

test('an assistant step before any user prompt yields one turn with that step and modelAuthored true', () => {
  const steps = [
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 1, message: { content: 'preamble', usage: { input_tokens: 5, output_tokens: 3 } } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "a1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: [], toolCallCount: 0, toolResults: 0, transportAborts: 0, callsAfterAbort: 0, tokens: { input: 5, output: 3, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "preamble" }]);
});

test('a transport abort followed by a non-abort tool result yields one turn with one transport abort and zero calls after abort', () => {
  const steps = [
    { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: 1, message: { content: 'hi' } },
    { type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: 2, message: { content: [{ type: 'tool_use', name: 'bash' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'user', uuid: 'u2', sessionId: 's1', timestamp: 3, message: { content: [{ type: 'tool_result', content: 'Tool permission stream closed before response' }] } },
    { type: 'user', uuid: 'u3', sessionId: 's1', timestamp: 4, message: { content: [{ type: 'tool_result', content: 'ok' }] } },
  ];
  const r = foldTurns(steps);
  assert.deepEqual(r, [{ openedByUuid: "u1", sessionId: "s1", at: 1, assistantSteps: 1, toolCalls: ["bash"], toolCallCount: 1, toolResults: 2, transportAborts: 1, callsAfterAbort: 0, tokens: { input: 10, output: 5, cacheRead: null, cacheCreation: null, thinking: null }, modelAuthored: true, text: "" }]);
});
