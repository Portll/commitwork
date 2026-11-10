// Replaces an unbounded Bash allow grant in settings text with the explicit observed Bash grants (monitor/agent-config-harden.mjs narrowBashAllow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrowBashAllow } from '../agent-config-harden.mjs';

const cfg = (allow) => JSON.stringify({ permissions: { allow } }, null, 2);

test('a top-level array is reported as unparseable and left unchanged', () => {
  const r = narrowBashAllow('[]', ['Bash(npm test)']);
  assert.deepEqual(r, { text: '[]', narrowed: false, reason: 'unparseable' });
});

test('a permissions object without an allow array is left unchanged', () => {
  const txt = '{"permissions":{}}';
  const r = narrowBashAllow(txt, ['Bash(npm test)']);
  assert.deepEqual(r, { text: txt, narrowed: false, reason: 'no permissions.allow' });
});

test('an allow list with only bounded Bash grants is left unchanged', () => {
  const txt = '{"permissions":{"allow":["Bash(npm test)"]}}';
  const r = narrowBashAllow(txt, ['Bash(git status)']);
  assert.deepEqual(r, { text: txt, narrowed: false, reason: 'no unbounded Bash grant' });
});

test('observed entries that are not specific Bash grants give nothing to narrow to', () => {
  const txt = '{"permissions":{"allow":["Bash(*)"]}}';
  const r = narrowBashAllow(txt, ['Read', 'Bash()']);
  assert.deepEqual(r, { text: txt, narrowed: false, reason: 'no observed Bash usage to derive an explicit list from' });
});

test('a broad grant on the first line of single-line JSON is replaced inline by the sorted unique observed grants', () => {
  const txt = '{"permissions":{"allow":["Bash(*)"]}}';
  const r = narrowBashAllow(txt, ['Bash(npm test)', 'Bash(git status)', 'Bash(npm test)']);
  assert.deepEqual(r, {
    text: '{"permissions":{"allow":["Bash(git status)", "Bash(npm test)"]}}',
    narrowed: true,
    removed: 'Bash(*)',
    added: ['Bash(git status)', 'Bash(npm test)'],
  });
});

test('a broad grant alone on the last line becomes one line per grant with commas between but not after the last', () => {
  const txt = cfg(['Read', 'Bash(*)']);
  const r = narrowBashAllow(txt, ['Bash(npm test)', 'Bash(git status)']);
  assert.deepEqual(r, {
    text: cfg(['Read', 'Bash(git status)', 'Bash(npm test)']),
    narrowed: true,
    removed: 'Bash(*)',
    added: ['Bash(git status)', 'Bash(npm test)'],
  });
});

test('a broad grant alone on a line with a trailing comma keeps the comma after the single replacement', () => {
  const txt = cfg(['Bash(*)', 'Read']);
  const r = narrowBashAllow(txt, ['Bash(npm test)']);
  assert.deepEqual(r, {
    text: cfg(['Bash(npm test)', 'Read']),
    narrowed: true,
    removed: 'Bash(*)',
    added: ['Bash(npm test)'],
  });
});

test('a broad grant with a trailing comma is deleted without touching the comma on the line before', () => {
  const txt = cfg(['Bash(npm test)', 'Bash(*)', 'Read']);
  const r = narrowBashAllow(txt, ['Bash(npm test)']);
  assert.deepEqual(r, {
    text: cfg(['Bash(npm test)', 'Read']),
    narrowed: true,
    removed: 'Bash(*)',
    added: [],
  });
});

test('a last-position broad grant is deleted and the comma on the line before is removed', () => {
  const txt = cfg(['Bash(npm test)', 'Bash(*)']);
  const r = narrowBashAllow(txt, ['Bash(npm test)']);
  assert.deepEqual(r, {
    text: cfg(['Bash(npm test)']),
    narrowed: true,
    removed: 'Bash(*)',
    added: [],
  });
});

test('an inline broad grant already covered by existing grants is cut out together with its leading comma', () => {
  const txt = '{"permissions":{"allow":["Bash(npm test)","Bash(*)"]}}';
  const r = narrowBashAllow(txt, ['Bash(npm test)']);
  assert.deepEqual(r, {
    text: '{"permissions":{"allow":["Bash(npm test)"]}}',
    narrowed: true,
    removed: 'Bash(*)',
    added: [],
  });
});
