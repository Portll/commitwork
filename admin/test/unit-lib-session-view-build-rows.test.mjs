// Per-session view rows with tokens and output (admin/lib/session-view.mjs buildRows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows } from '../lib/session-view.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('buildRows defaults transcripts to true and reads tokens and output when transcript file exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildRows-'));
  try {
    const cwd = '/home/user/proj';
    const uuid = 'abcdef1234567890';
    const transcriptDir = join(dir, cwd.replace(/[/.]/g, '-'));
    mkdirSync(transcriptDir, { recursive: true });
    const tPath = join(transcriptDir, `${uuid}.jsonl`);
    writeFileSync(tPath, JSON.stringify({ type: 'assistant', text: 'hello', timestamp: '2024-01-01T00:00:00Z' }) + '\n');
    process.env.CW_TRANSCRIPT_ROOT = dir;
    const sessions = [{ id: 's1', ids: { transcript: uuid, cwd } }];
    const result = buildRows(sessions, { runs: [], touches: { ok: true, byRef: new Map(), rows: [] }, roster: { byId: new Map() }, now: 1700000000000 });
    delete process.env.CW_TRANSCRIPT_ROOT;
    assert.deepEqual(result, [{ id: "s1", name: null, label: null, project: "proj", cwd: "/home/user/proj", workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "none", count: 0, paths: [], recent: null }, tokens: { state: "live", turns: 1, syntheticTurns: 0, turnsWithoutTools: 0, turnsWithoutUsage: 1, totals: { input: null, output: null, cacheRead: null, cacheCreation: null, thinking: null }, ruminationShare: null, cacheHitRatio: null, outputPerTurn: null, unparseableLines: 0 }, output: { state: "none", why: "no assistant turn in the tail read" } }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildRows matches run by sessionId when run has no id property', () => {
  const sessions = [{ id: 's2', ids: {} }];
  const runs = [{ sessionId: 's2', backend: 'anthropic', model: 'claude-3' }];
  const result = buildRows(sessions, { runs, transcripts: false });
  assert.deepEqual(result, [{ id: "s2", name: null, label: null, project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: "anthropic", model: "claude-3", files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows extracts ref as first 8 chars of transcript id and uses it for touches.byRef lookup', () => {
  const uuid = 'abcdef1234567890';
  const sessions = [{ id: 's3', ids: { transcript: uuid }, pid: 123 }];
  const touches = { ok: true, byRef: new Map([['abcdef12', [{ x: '/path/a', at: '2024-01-01T00:00:00Z', access: 'write' }]]]), rows: [] };
  const result = buildRows(sessions, { touches, transcripts: false, now: 1700000000000 });
  assert.deepEqual(result, [{ id: "s3", name: null, label: null, project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: 123, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "live", count: 1, touches: 1, paths: ["/path/a"], more: 0, recent: { path: "/path/a", access: "write", at: "2024-01-01T00:00:00Z" }, viaPid: false }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows falls back to s.agent for name when rosterRow exists but name is empty string', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const sessions = [{ id: 's4', ids: { transcript: uuid }, agent: 'my-agent' }];
  const roster = { byId: new Map([[uuid, { name: '', cwd: '/roster/cwd' }]]) };
  const result = buildRows(sessions, { roster, transcripts: false });
  assert.deepEqual(result, [{ id: "s4", name: "my-agent", label: null, project: "cwd", cwd: "/roster/cwd", workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows prefers ids.cwd over roster cwd when roster cwd is null', () => {
  const uuid = '22222222-3333-4444-5555-666666666666';
  const sessions = [{ id: 's5', ids: { transcript: uuid, cwd: '/ids/cwd' } }];
  const roster = { byId: new Map([[uuid, { cwd: null }]]) };
  const result = buildRows(sessions, { roster, transcripts: false });
  assert.deepEqual(result, [{ id: "s5", name: null, label: null, project: "cwd", cwd: "/ids/cwd", workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows uses s.label when rosterRow.label is null', () => {
  const uuid = '33333333-4444-5555-6666-777777777777';
  const sessions = [{ id: 's6', ids: { transcript: uuid }, label: 'my-label' }];
  const roster = { byId: new Map([[uuid, { label: null }]]) };
  const result = buildRows(sessions, { roster, transcripts: false });
  assert.deepEqual(result, [{ id: "s6", name: null, label: "my-label", project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows returns ids.workspace value when present', () => {
  const sessions = [{ id: 's7', ids: { workspace: 'my-workspace' } }];
  const result = buildRows(sessions, { transcripts: false });
  assert.deepEqual(result, [{ id: "s7", name: null, label: null, project: null, cwd: null, workspace: "my-workspace", idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows returns s.startedAt value when present', () => {
  const sessions = [{ id: 's8', ids: {}, startedAt: '2024-01-01T00:00:00Z' }];
  const result = buildRows(sessions, { transcripts: false });
  assert.deepEqual(result, [{ id: "s8", name: null, label: null, project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: "2024-01-01T00:00:00Z", lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows falls back to null for kind when rosterRow exists but kind is null', () => {
  const uuid = '44444444-5555-6666-7777-888888888888';
  const sessions = [{ id: 's9', ids: { transcript: uuid } }];
  const roster = { byId: new Map([[uuid, { kind: null }]]) };
  const result = buildRows(sessions, { roster, transcripts: false });
  assert.deepEqual(result, [{ id: "s9", name: null, label: null, project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});

test('buildRows falls back to null for entrypoint when rosterRow exists but entrypoint is null', () => {
  const uuid = '55555555-6666-7777-8888-999999999999';
  const sessions = [{ id: 's10', ids: { transcript: uuid } }];
  const roster = { byId: new Map([[uuid, { entrypoint: null }]]) };
  const result = buildRows(sessions, { roster, transcripts: false });
  assert.deepEqual(result, [{ id: "s10", name: null, label: null, project: null, cwd: null, workspace: null, idePort: null, status: null, planId: null, pid: null, startedAt: null, lastSeen: null, kind: null, entrypoint: null, backend: null, model: null, files: { state: "unknown", why: "touch ledger not read" }, tokens: { state: "unknown", why: "transcripts not read" }, output: { state: "unknown", why: "transcripts not read" } }]);
});
