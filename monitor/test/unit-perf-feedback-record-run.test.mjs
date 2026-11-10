// Appends one normalised perf sample row to the feedback file (monitor/perf-feedback.mjs recordRun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordRun } from '../perf-feedback.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NOW = '2025-06-15T12:00:00.000Z';

const row = (fields) => ({
  v: 1, at: NOW, scanner: 's', repo: '', ms: 5, exit: null, profileId: null, depth: null,
  intensity: null, jobs: null, cores: null, ramGB: null, loadAtStart: null, bytesOut: null,
  ...fields,
});

const inDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'recordRun-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const withEnv = (vars, fn) => {
  const saved = Object.keys(vars).map((k) => [k, process.env[k]]);
  const apply = ([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  Object.entries(vars).forEach(apply);
  try {
    return fn();
  } finally {
    saved.forEach(apply);
  }
};

test('records every field of a complete sample and prefers its own time over CW_NOW', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const sample = { at: '2025-01-01T00:00:00.000Z', scanner: 's1', repo: 'r1', ms: 100, exit: 0, profileId: 'p1', depth: 2, intensity: 1, jobs: 4, cores: 8, ramGB: 16, loadAtStart: 1.5, bytesOut: 1024 };
  const r = withEnv({ CW_NOW: NOW }, () => recordRun(sample, { path: p }));
  const expected = { v: 1, at: '2025-01-01T00:00:00.000Z', scanner: 's1', repo: 'r1', ms: 100, exit: 0, profileId: 'p1', depth: 2, intensity: 1, jobs: 4, cores: 8, ramGB: 16, loadAtStart: 1.5, bytesOut: 1024 };
  assert.deepEqual(r, { ok: true, row: expected });
  assert.equal(readFileSync(p, 'utf8'), JSON.stringify(expected) + '\n');
}));

test('takes the time from CW_NOW when the sample has none', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const r = withEnv({ CW_NOW: NOW }, () => recordRun({ at: '', scanner: 's2', ms: 200, exit: 1 }, { path: p }));
  const expected = row({ scanner: 's2', ms: 200, exit: 1 });
  assert.deepEqual(r, { ok: true, row: expected });
  assert.equal(readFileSync(p, 'utf8'), JSON.stringify(expected) + '\n');
}));

test('falls back to the clock when neither the sample nor CW_NOW gives a time', (t) => inDir((dir) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2025, 0, 1, 8) });
  const p = join(dir, 'f.jsonl');
  const r = withEnv({ CW_NOW: undefined }, () => recordRun({ scanner: 's3', ms: 7 }, { path: p }));
  assert.deepEqual(r, { ok: true, row: row({ at: '2025-01-01T08:00:00.000Z', scanner: 's3', ms: 7 }) });
}));

test('keeps an exit of undefined, null or empty string as unknown', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const expected = row({ scanner: 's4', ms: 80 });
  for (const exit of [undefined, null, '']) {
    const r = recordRun({ at: NOW, scanner: 's4', ms: 80, exit }, { path: p });
    assert.deepEqual(r, { ok: true, row: expected });
  }
  assert.equal(readFileSync(p, 'utf8'), (JSON.stringify(expected) + '\n').repeat(3));
}));

test('stores a known exit as a number and writes an unparseable one as null', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const exitOf = (exit) => recordRun({ at: NOW, scanner: 's5', ms: 9, exit }, { path: p }).row.exit;
  assert.equal(exitOf(0), 0);
  assert.equal(exitOf(2), 2);
  assert.equal(exitOf('3'), 3);
  assert.equal(exitOf('x'), NaN);
  const written = readFileSync(p, 'utf8').trim().split('\n').map((line) => JSON.parse(line).exit);
  assert.deepEqual(written, [0, 2, 3, null]);
}));

test('coerces scanner, repo and duration, drops an empty profile id and keeps zero metrics', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const zeros = { depth: 0, intensity: 0, jobs: 0, cores: 0, ramGB: 0, loadAtStart: 0, bytesOut: 0 };
  const r = recordRun({ at: NOW, scanner: 42, repo: 7, ms: '12', profileId: '', ...zeros }, { path: p });
  assert.deepEqual(r, { ok: true, row: row({ scanner: '42', repo: '7', ms: 12, ...zeros }) });
  const zeroMs = recordRun({ at: NOW, scanner: 's6', repo: 0, ms: 0, profileId: 0 }, { path: p });
  assert.deepEqual(zeroMs, { ok: true, row: row({ scanner: 's6', ms: 0 }) });
  const nullMs = recordRun({ at: NOW, scanner: 's6', ms: null }, { path: p });
  assert.deepEqual(nullMs, { ok: true, row: row({ scanner: 's6', ms: 0 }) });
}));

test('refuses a sample without a scanner or a finite duration and writes nothing', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  const refused = { ok: false, error: 'a sample needs at least a scanner id and a finite duration' };
  const samples = [
    { ms: 100 },
    { scanner: '', ms: 100 },
    { scanner: 0, ms: 100 },
    { scanner: 's7' },
    { scanner: 's7', ms: NaN },
    { scanner: 's7', ms: Infinity },
    { scanner: 's7', ms: 'slow' },
  ];
  for (const sample of samples) {
    assert.deepEqual(recordRun(sample, { path: p }), refused);
  }
  assert.equal(existsSync(p), false);
}));

test('appends a line per run under new directories and defaults to the CW_PERF_FEEDBACK path', () => inDir((dir) => {
  const p = join(dir, 'a', 'b', 'f.jsonl');
  const one = row({ scanner: 's1', ms: 1 });
  const two = row({ scanner: 's2', ms: 2 });
  withEnv({ CW_NOW: NOW, CW_PERF_FEEDBACK: p }, () => {
    assert.deepEqual(recordRun({ scanner: 's1', ms: 1 }, { path: p }), { ok: true, row: one });
    assert.deepEqual(recordRun({ scanner: 's2', ms: 2 }), { ok: true, row: two });
  });
  assert.equal(readFileSync(p, 'utf8'), JSON.stringify(one) + '\n' + JSON.stringify(two) + '\n');
}));

test('reports a write failure by its code, or by its message when it has no code', () => inDir((dir) => {
  const sample = { at: NOW, scanner: 's9', ms: 1 };
  assert.deepEqual(recordRun(sample, { path: dir }), { ok: false, error: 'perf feedback not recorded: EISDIR' });
  const p = join(dir, 'f.jsonl');
  const bad = { ...sample, depth: { toJSON() { throw new Error('boom'); } } };
  assert.deepEqual(recordRun(bad, { path: p }), { ok: false, error: 'perf feedback not recorded: boom' });
  assert.equal(existsSync(p), false);
}));

test('throws a TypeError for a null sample and writes nothing', () => inDir((dir) => {
  const p = join(dir, 'f.jsonl');
  assert.throws(() => recordRun(null, { path: p }), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'at')",
  });
  assert.equal(existsSync(p), false);
}));
