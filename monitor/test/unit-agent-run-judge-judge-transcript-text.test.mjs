// Parses a JSON-lines transcript into call/result events and judges the run (monitor/agent-run-judge.mjs judgeTranscriptText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTranscriptText } from '../agent-run-judge.mjs';

test('returns null events and empty run for empty input', () => {
  assert.deepEqual(judgeTranscriptText(''), { events: null, resultText: null, calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('returns null events when lines are non-JSON', () => {
  assert.deepEqual(judgeTranscriptText('not json\nalso not json'), { events: null, resultText: null, calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('counts result events and captures result text', () => {
  const text = JSON.stringify({ type: 'result', result: 'done' });
  assert.deepEqual(judgeTranscriptText(text), { events: 1, resultText: "done", calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('classifies assistant tool_use and tool_result lines', () => {
  const line1 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Bash', input: { command: 'ls' } }] } });
  const line2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', is_error: false }] } });
  assert.deepEqual(judgeTranscriptText(line1 + '\n' + line2), { events: 2, resultText: null, calls: 1, used: { Bash: 1 }, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('handles session_meta lines as events with no calls', () => {
  const text = JSON.stringify({ type: 'session_meta', payload: { cwd: '/tmp', id: 's1' } });
  assert.deepEqual(judgeTranscriptText(text), { events: 1, resultText: null, calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('handles codex response_item function_call lines', () => {
  const text = JSON.stringify({ type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' } });
  assert.deepEqual(judgeTranscriptText(text), { events: 1, resultText: null, calls: 1, used: { bash: 1 }, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('handles codex response_item function_call_output lines', () => {
  const text = JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'error: denied' } });
  assert.deepEqual(judgeTranscriptText(text), { events: 1, resultText: null, calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});

test('ignores blank lines and non-classifiable lines', () => {
  const text = '\n\n' + JSON.stringify({ type: 'unknown' }) + '\n\n';
  assert.deepEqual(judgeTranscriptText(text), { events: null, resultText: null, calls: 0, used: {}, findings: [], outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: ["tool-outside-allowlist: no tool allowlist declared for this run (--tools)"] });
});
