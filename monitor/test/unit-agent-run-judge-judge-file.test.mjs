// Summarises an agent transcript file into run metadata and judged findings (monitor/agent-run-judge.mjs judgeFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeFile } from '../agent-run-judge.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'judgeFile-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeRun(dir) {
  const f = join(dir, 'run.jsonl');
  const l1 = JSON.stringify({ type: 'session_meta', timestamp: '2026-01-01T00:00:00Z', payload: { cwd: '/work/a', id: 'sess-1' } });
  const l3 = JSON.stringify({ type: 'assistant', cwd: '/work/b', sessionId: 'sess-2', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }, { type: 'tool_use', name: 'Glob', input: {} }] } });
  const l5 = JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true }, { type: 'tool_result', tool_use_id: 'nope', is_error: false }] } });
  writeFileSync(f, [l1, 'garbage', l3, '', l5].join('\n') + '\n');
  return f;
}

test('a missing file is reported as vanished', async () => {
  await withDir(async (dir) => {
    const f = join(dir, 'missing.jsonl');
    assert.deepEqual(await judgeFile(f), { file: f, why: 'vanished' });
  });
});

test('a path under a regular file is reported as unreadable with its error code', async () => {
  await withDir(async (dir) => {
    const plain = join(dir, 'plain.txt');
    writeFileSync(plain, 'x');
    const f = join(plain, 'child.jsonl');
    assert.deepEqual(await judgeFile(f), { file: f, why: 'unreadable (ENOTDIR)' });
  });
});

test('a file one byte over the configured limit is reported as too large', async () => {
  await withDir(async (dir) => {
    const f = join(dir, 'big.jsonl');
    writeFileSync(f, 'x'.repeat(11));
    assert.deepEqual(await judgeFile(f, { env: { CW_AGENT_RUNS_MAX_BYTES: '10' } }), { file: f, why: 'too large (11 bytes over 10)' });
  });
});

test('a file exactly at the limit is read and a single unparsable line is not JSON lines', async () => {
  await withDir(async (dir) => {
    const f = join(dir, 'exact.jsonl');
    writeFileSync(f, 'x'.repeat(10));
    assert.deepEqual(await judgeFile(f, { env: { CW_AGENT_RUNS_MAX_BYTES: '10' } }), { file: f, why: 'not JSON lines' });
  });
});

test('an empty file is not a run rather than not JSON lines', async () => {
  await withDir(async (dir) => {
    const f = join(dir, 'empty.jsonl');
    writeFileSync(f, '');
    assert.deepEqual(await judgeFile(f), { file: f, why: 'not-a-run (no agent events)' });
  });
});

test('JSON lines with no agent events and blank lines between them are not a run', async () => {
  await withDir(async (dir) => {
    const f = join(dir, 'other.jsonl');
    writeFileSync(f, '{"type":"other"}\n\n  \n{"a":1}\n');
    assert.deepEqual(await judgeFile(f), { file: f, why: 'not-a-run (no agent events)' });
  });
});

test('a mixed transcript keeps the first cwd format and session and ignores unmatched results', async () => {
  await withDir(async (dir) => {
    const f = writeRun(dir);
    assert.deepEqual(await judgeFile(f), {
      file: f,
      format: 'codex',
      cwd: '/work/a',
      sessionId: 'sess-1',
      first: '2026-01-01T00:00:00Z',
      last: '2026-01-01T00:00:02Z',
      lines: 4,
      unparsable: 1,
      calls: 2,
      used: { Read: 1, Glob: 1 },
      findings: [],
      outsideReads: { reached: 0, refused: 0, roots: [] },
      notApplicable: ['tool-outside-allowlist: no tool allowlist declared for this run (--tools)'],
    });
  });
});

test('a refused call outside the declared tool list is a refused allowlist finding', async () => {
  await withDir(async (dir) => {
    const f = writeRun(dir);
    assert.deepEqual(await judgeFile(f, { tools: ['Glob'] }), {
      file: f,
      format: 'codex',
      cwd: '/work/a',
      sessionId: 'sess-1',
      first: '2026-01-01T00:00:00Z',
      last: '2026-01-01T00:00:02Z',
      lines: 4,
      unparsable: 1,
      calls: 2,
      used: { Read: 1, Glob: 1 },
      findings: [{ rule: 'tool-outside-allowlist', tool: 'Read', subject: 'Read', count: 1, refused: 1, detail: { refused: true, why: 'not in the declared tool list' } }],
      outsideReads: { reached: 0, refused: 0, roots: [] },
      notApplicable: [],
    });
  });
});
