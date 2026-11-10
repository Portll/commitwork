// Summary of agent run files judged from a file list or a scanned root (monitor/agent-run-judge.mjs runLens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLens } from '../agent-run-judge.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const T = 1600000000;
const SINCE = '2020-09-13T12:26:40.000Z';
const TS = '2026-01-01T00:00:00.000Z';
const NOT_RUN = 'not-a-run (no agent events)';

async function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'runLens-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const put = (p, text, sec) => { writeFileSync(p, text); if (sec !== undefined) utimesSync(p, sec, sec); return p; };
const use = (id, name) => ({ type: 'tool_use', id, name, input: {} });
const turn = (content, extra = {}) => `${JSON.stringify({ type: 'assistant', cwd: '/repo', timestamp: TS, message: { content }, ...extra })}\n`;
const strip = ({ generated, ...rest }) => rest;
const summary = (candidates, judged, unreadable, findings, byRule, runsWithFindings) => ({ candidates, judged, unreadable, findings, byRule, runsWithFindings });
const allow = (tool, count) => ({ rule: 'tool-outside-allowlist', tool, subject: tool, count, refused: 0, detail: { refused: false, why: 'not in the declared tool list' } });
const run = (file, o) => ({ file, format: 'claude', cwd: '/repo', sessionId: null, first: TS, last: TS, lines: 1, unparsable: 0, outsideReads: { reached: 0, refused: 0, roots: [] }, notApplicable: [], ...o });

test('an empty files array scans the root and keeps jsonl files modified at or after since', async () => {
  await inDir(async (dir) => {
    mkdirSync(join(dir, 'sub'));
    const a = put(join(dir, 'a.jsonl'), '', T);
    put(join(dir, 'b.jsonl'), 'x\n', T - 1);
    put(join(dir, 'notes.txt'), '', T);
    const c = put(join(dir, 'sub', 'c.jsonl'), '', T + 1);
    const r = await runLens({ files: [], root: dir, since: SINCE, env: { CW_AGENT_RUNS_ROOT: join(dir, 'none') } });
    assert.deepEqual(strip(r), {
      root: dir, since: SINCE, tools: null, summary: summary(2, 0, 2, 0, {}, 0), runs: [],
      unreadable: [{ file: a, why: NOT_RUN }, { file: c, why: NOT_RUN }],
    });
  });
});

test('without files or root it scans CW_AGENT_RUNS_ROOT from CW_AGENT_RUNS_SINCE', async () => {
  await inDir(async (dir) => {
    const x = put(join(dir, 'x.jsonl'), 'garbage\n', T);
    put(join(dir, 'old.jsonl'), '', T - 1);
    const r = await runLens({ env: { CW_AGENT_RUNS_ROOT: dir, CW_AGENT_RUNS_SINCE: SINCE } });
    assert.deepEqual(strip(r), {
      root: dir, since: SINCE, tools: null, summary: summary(1, 0, 1, 0, {}, 0), runs: [],
      unreadable: [{ file: x, why: 'not JSON lines' }],
    });
  });
});

test('an explicit root and since win over CW_AGENT_RUNS_ROOT and CW_AGENT_RUNS_SINCE', async () => {
  await inDir(async (dir) => {
    const main = join(dir, 'main');
    const other = join(dir, 'other');
    mkdirSync(main);
    mkdirSync(other);
    const m = put(join(main, 'm.jsonl'), '', T);
    put(join(other, 'o.jsonl'), '', T);
    const env = { CW_AGENT_RUNS_ROOT: other, CW_AGENT_RUNS_SINCE: '2000-01-01T00:00:00.000Z' };
    const r = await runLens({ root: main, since: SINCE, env });
    assert.deepEqual(strip(r), {
      root: main, since: SINCE, tools: null, summary: summary(1, 0, 1, 0, {}, 0), runs: [],
      unreadable: [{ file: m, why: NOT_RUN }],
    });
  });
});

test('explicit files are judged with a null root and allowlist findings are summed by rule across runs', async () => {
  await inDir(async (dir) => {
    const ts2 = '2026-01-02T00:00:00.000Z';
    const f1 = put(join(dir, 'r1.jsonl'), `not json\n${turn([use('a', 'badtool'), use('b', 'badtool')], { sessionId: 's1' })}`);
    const f2 = put(join(dir, 'r2.jsonl'), turn([use('c', 'othertool')], { timestamp: ts2 }));
    const f3 = put(join(dir, 'r3.jsonl'), turn([use('d', 'goodtool')]));
    const r = await runLens({ files: [f1, f2, f3], tools: ['goodtool'], since: SINCE, env: {} });
    assert.deepEqual(strip(r), {
      root: null, since: SINCE, tools: ['goodtool'],
      summary: summary(3, 3, 0, 3, { 'tool-outside-allowlist': 3 }, 2), unreadable: [],
      runs: [
        run(f1, { sessionId: 's1', lines: 2, unparsable: 1, calls: 2, used: { badtool: 2 }, findings: [allow('badtool', 2)] }),
        run(f2, { first: ts2, last: ts2, calls: 1, used: { othertool: 1 }, findings: [allow('othertool', 1)] }),
        run(f3, { calls: 1, used: { goodtool: 1 }, findings: [] }),
      ],
    });
  });
});

test('a null tools option reads CW_AGENT_RUNS_TOOLS, trimming entries and dropping empty ones', async () => {
  await inDir(async (dir) => {
    const f = put(join(dir, 'r.jsonl'), turn([use('a', 'badtool'), use('b', 'zed'), use('c', 'goodtool')]));
    const r = await runLens({ files: [f], since: SINCE, env: { CW_AGENT_RUNS_TOOLS: ' goodtool, ,badtool,' } });
    assert.deepEqual(strip(r), {
      root: null, since: SINCE, tools: ['goodtool', 'badtool'],
      summary: summary(1, 1, 0, 1, { 'tool-outside-allowlist': 1 }, 1), unreadable: [],
      runs: [run(f, { calls: 3, used: { badtool: 1, zed: 1, goodtool: 1 }, findings: [allow('zed', 1)] })],
    });
  });
});

test('missing, oversized and non-JSON files are reported as unreadable with their reasons', async () => {
  await inDir(async (dir) => {
    const missing = join(dir, 'missing.jsonl');
    const four = put(join(dir, 'four.jsonl'), 'abc\n');
    const five = put(join(dir, 'five.jsonl'), 'abcd\n');
    const r = await runLens({ files: [missing, four, five], since: SINCE, env: { CW_AGENT_RUNS_MAX_BYTES: '4' } });
    assert.deepEqual(strip(r), {
      root: null, since: SINCE, tools: null, summary: summary(3, 0, 3, 0, {}, 0), runs: [],
      unreadable: [
        { file: missing, why: 'vanished' },
        { file: four, why: 'not JSON lines' },
        { file: five, why: 'too large (5 bytes over 4)' },
      ],
    });
  });
});
