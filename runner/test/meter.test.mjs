import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeter, createRing } from '../meter.mjs';
import { defaultRead, parseCpuMax, parseIoStat, parseProcStat, readContainer, readStackIds } from '../meter-read.mjs';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const ROOT = join(FIX, 'cgroup');
const PROC = join(FIX, 'proc');
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const IDS = { slot1: A, oldkernel: B, stopped: C };

/** The fixture tree, with some files replaced or made to fail. */
const overlay = (over) => (p) => {
  const v = over[p.slice(FIX.length)];
  if (v instanceof Error) throw v;
  return v === undefined ? defaultRead(p) : v;
};
const errno = (code) => Object.assign(new Error(code), { code });
const clock = (values) => { const v = [...values]; return () => v.shift(); };

function twoReadings(over2) {
  const m = createMeter({ root: ROOT, proc: PROC, ids: IDS, mono: clock([0, 2000]), wall: clock([1e12, 1e12 + 2000]) });
  const first = m.sample();
  return { first, second: m.sample({ read: overlay(over2) }), m };
}

test('a running container reads every counter, and the first reading has no CPU figure', () => {
  const { first } = twoReadings({});
  assert.deepEqual(first.containers.slot1, {
    layer: 'container', id: 'aaaaaaaaaaaa', state: 'running', cpuPct: null, cpuWhy: 'first reading', cpuSec: 5,
    memCurrent: 209715200, memPeak: 220200960, memMax: 6442450944, cpuQuota: 4, pids: 12,
    io: { rbytes: 1052672, wbytes: 2097152 },
  });
  assert.equal(first.ids.status, 'live');
});

test('CPU is the usage delta over wall time; 100 is one CPU', () => {
  const { second } = twoReadings({
    [`cgroup/docker/${A}/cpu.stat`]: 'usage_usec 6970000\n',
    'proc/stat': 'cpu  1400 0 600 9500 500 0 0 0 0 0\ncpu0 1 0 0 0 0 0 0 0\ncpu1 1 0 0 0 0 0 0 0\n',
  });
  assert.equal(second.containers.slot1.cpuPct, 98.5);
  assert.equal(second.vm.cpuPct, 25);
  assert.equal(second.vm.cpus, 2);
});

test('a kernel without memory.peak gives null, and unlimited limits read as max', () => {
  const c = twoReadings({}).first.containers.oldkernel;
  assert.equal(c.state, 'running');
  assert.equal(c.memPeak, null);
  assert.equal(c.memMax, 'max');
  assert.equal(c.cpuQuota, 'max');
  assert.deepEqual(c.io, { rbytes: 0, wbytes: 0 });
});

test('a missing container directory is unmeasured, never zero', () => {
  const c = twoReadings({}).first.containers.stopped;
  assert.deepEqual(c, { layer: 'container', id: 'cccccccccccc', state: 'unmeasured', reason: 'no cgroup: the container is stopped or not started' });
});

test('a restart resets the counters, so the delta is withheld', () => {
  const { second } = twoReadings({ [`cgroup/docker/${A}/cpu.stat`]: 'usage_usec 10\n' });
  assert.equal(second.containers.slot1.cpuPct, null);
  assert.equal(second.containers.slot1.cpuWhy, 'restarted: counters reset');
});

test('a permission error or a garbled file is unmeasured with the reason', () => {
  const read = overlay({ [`cgroup/docker/${A}/memory.current`]: errno('EACCES'), [`cgroup/docker/${B}/memory.current`]: 'lots\n' });
  assert.deepEqual(readContainer(ROOT, A, read), { state: 'unmeasured', reason: 'cgroup unreadable: EACCES' });
  assert.match(readContainer(ROOT, B, read).reason, /memory\.current unparseable/);
  assert.match(readContainer(ROOT, '../../etc', read).reason, /not 64 hex/);
});

test('the VM layer is labelled, and an unreadable /proc is unmeasured', () => {
  const { first } = twoReadings({});
  assert.deepEqual(first.vm, {
    layer: 'vm', state: 'measured', cpuPct: null, cpuWhy: 'first reading', cpus: 2,
    memTotal: 26624000000, memAvailable: 20480000000, swapTotal: 1073737728, swapFree: 1073737728,
    load1: 1.5, load5: 0.75, load15: 0.25,
  });
  const m = createMeter({ root: ROOT, proc: join(FIX, 'absent'), ids: {} });
  assert.equal(m.sample().vm.state, 'unmeasured');
});

test('the id map is read from CW_STACK_IDS at call time and validated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-meter-'));
  const path = join(dir, 'ids.json');
  writeFileSync(path, JSON.stringify({ slot1: A, 'Bad Name': B, __proto__x: C }));
  const before = process.env.CW_STACK_IDS;
  try {
    process.env.CW_STACK_IDS = path;
    const s = createMeter({ root: ROOT, proc: PROC }).sample();
    assert.deepEqual(Object.keys(s.containers), ['slot1']);
    assert.deepEqual(s.ids.rejected, ['Bad Name', '__proto__x']);
    process.env.CW_STACK_IDS = join(dir, 'none.json');
    assert.equal(createMeter({ root: ROOT, proc: PROC }).sample().ids.status, 'unavailable');
  } finally {
    if (before === undefined) delete process.env.CW_STACK_IDS; else process.env.CW_STACK_IDS = before;
  }
  writeFileSync(path, '{not json');
  assert.equal(readStackIds(path).status, 'unreadable');
  writeFileSync(path, '[]');
  assert.equal(readStackIds(path).status, 'unreadable');
  assert.equal(readStackIds(undefined).status, 'unavailable');
});

test('series keeps the last N samples inside the window', () => {
  let t = 0;
  const m = createMeter({ root: ROOT, proc: PROC, ids: {}, keep: 3, wall: () => (t += 2000) });
  assert.equal(m.status().status, 'unavailable');
  for (let i = 0; i < 5; i++) m.sample();
  assert.equal(m.series(3600).length, 3);
  assert.equal(m.series(2).length, 2);
  assert.equal(m.latest().at, new Date(10000).toISOString());
  assert.equal(m.status().status, 'live');
  const r = createRing(2);
  [1, 2, 3].forEach((x) => r.push(x));
  assert.deepEqual(r.items(), [2, 3]);
});

test('parsers', () => {
  assert.equal(parseCpuMax('150000 100000\n'), 1.5);
  assert.equal(parseCpuMax(null), null);
  assert.equal(parseIoStat(null), null);
  assert.throws(() => parseProcStat('intr 0\n'), /cpu line unparseable/);
});
