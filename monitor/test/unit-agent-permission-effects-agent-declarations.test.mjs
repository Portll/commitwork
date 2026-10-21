// Maps resolved agent config entries to permission-effect classes (monitor/agent-permission-effects.mjs agentDeclarations).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentDeclarations } from '../agent-permission-effects.mjs';

test('throws TypeError when input is not a record', () => {
  assert.throws(() => agentDeclarations(null), TypeError);
  assert.throws(() => agentDeclarations('string'), TypeError);
  assert.throws(() => agentDeclarations(42), TypeError);
  assert.throws(() => agentDeclarations([]), TypeError);
});

test('returns empty array when all keys are missing', () => {
  const result = agentDeclarations({});
  assert.deepEqual(result, []);
});

test('classifies grant entries with read tools', () => {
  const result = agentDeclarations({
    grants: [
      { value: 'Read(./src)' },
      { value: 'Read()' },
      { value: 'Read(~/secrets)' },
      { value: 'Read(//etc/passwd)' },
      { value: 'Read(../../etc)' },
      { value: 'Read(C:\\Users)' },
      { value: 'Read($HOME/x)' },
      { value: 'Read(*.js)' },
    ],
  });
  assert.deepEqual(result, [
    { kind: 'grant', class: 'repo-read' },
    { kind: 'grant', class: 'any-read' },
    { kind: 'grant', class: 'outside-read' },
    { kind: 'grant', class: 'outside-read' },
    { kind: 'grant', class: 'unresolved' },
    { kind: 'grant', class: 'unresolved' },
    { kind: 'grant', class: 'unresolved' },
    { kind: 'grant', class: 'repo-read' },
  ]);
});

test('classifies grant entries with write tools', () => {
  const result = agentDeclarations({
    grants: [
      { value: 'Write(./out)' },
      { value: 'Write(//tmp/x)' },
      { value: 'Write(~/data)' },
      { value: 'Write()' },
    ],
  });
  assert.deepEqual(result, [
    { kind: 'grant', class: 'repo-write' },
    { kind: 'grant', class: 'tmp-write' },
    { kind: 'grant', class: 'outside-write' },
    { kind: 'grant', class: 'any-write' },
  ]);
});

test('classifies grant entries with net and bash tools', () => {
  const result = agentDeclarations({
    grants: [
      { value: 'WebFetch(url)' },
      { value: 'WebSearch(q)' },
      { value: 'Bash(curl http://x)' },
      { value: 'Bash(cat ~/.ssh/id_rsa)' },
      { value: 'Bash(echo hi)' },
      { value: 'Bash()' },
    ],
  });
  assert.deepEqual(result, [
    { kind: 'grant', class: 'egress' },
    { kind: 'grant', class: 'egress' },
    { kind: 'grant', class: 'egress' },
    { kind: 'grant', class: 'credential-read' },
    { kind: 'grant', class: 'command-exec' },
    { kind: 'grant', class: 'command-exec' },
  ]);
});

test('classifies deny entries with mcp and unknown tools', () => {
  const result = agentDeclarations({
    denies: [
      { value: 'mcp__server__tool' },
      { value: 'CustomTool(arg)' },
      { value: 'Read' },
      { value: 'Bash' },
    ],
  });
  assert.deepEqual(result, [
    { kind: 'deny', class: 'mcp-tool' },
    { kind: 'deny', class: 'tool' },
    { kind: 'deny', class: 'any-read' },
    { kind: 'deny', class: 'command-exec' },
  ]);
});

test('classifies hook entries by type', () => {
  const result = agentDeclarations({
    hooks: [
      { type: 'command', command: 'echo' },
      { type: 'other' },
      'not-a-record',
      null,
    ],
  });
  assert.deepEqual(result, [
    { kind: 'hook', class: 'hook-command' },
    { kind: 'hook', class: 'hook-other' },
    { kind: 'hook', class: 'unrecognised' },
    { kind: 'hook', class: 'unrecognised' },
  ]);
});

test('classifies server entries by transport', () => {
  const result = agentDeclarations({
    servers: [
      { transport: 'remote', url: 'http://x' },
      { transport: 'stdio', command: 'node' },
      { transport: 'other' },
      'not-a-record',
    ],
  });
  assert.deepEqual(result, [
    { kind: 'server', class: 'remote-server' },
    { kind: 'server', class: 'stdio-server' },
    { kind: 'server', class: 'unrecognised' },
    { kind: 'server', class: 'unrecognised' },
  ]);
});

test('handles non-record entries in grants and denies', () => {
  const result = agentDeclarations({
    grants: ['not-a-record', null, 42],
    denies: ['not-a-record', null, 42],
  });
  assert.deepEqual(result, [
    { kind: 'grant', class: 'unrecognised' },
    { kind: 'grant', class: 'unrecognised' },
    { kind: 'grant', class: 'unrecognised' },
    { kind: 'deny', class: 'unrecognised' },
    { kind: 'deny', class: 'unrecognised' },
    { kind: 'deny', class: 'unrecognised' },
  ]);
});

test('combines all four lists in order', () => {
  const result = agentDeclarations({
    grants: [{ value: 'Read(./a)' }],
    denies: [{ value: 'Write(./b)' }],
    hooks: [{ type: 'command' }],
    servers: [{ transport: 'stdio' }],
  });
  assert.deepEqual(result, [
    { kind: 'grant', class: 'repo-read' },
    { kind: 'deny', class: 'repo-write' },
    { kind: 'hook', class: 'hook-command' },
    { kind: 'server', class: 'stdio-server' },
  ]);
});
