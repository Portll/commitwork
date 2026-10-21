import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleHeadroom, assessRun, describeRun, minFreeMb,
  hostThresholds, assessHostHeadroom, describeHost,
} from '../lib/disk-headroom.mjs';

const fakeStatfs = (availBlocks, bsize = 4096) => () => ({ bavail: availBlocks, bsize, bfree: availBlocks, blocks: 1e9 });
/** A volume of `totalBlocks` with `pct` of it free — the shape the host check reasons about. */
const fakeVolume = (pct, totalBlocks = 1e9, bsize = 4096) => () =>
  ({ bavail: Math.round(totalBlocks * (pct / 100)), bfree: 0, blocks: totalBlocks, bsize });

test('a healthy run is attributable — failures in it mean what they say', () => {
  const s = sampleHeadroom({ statfs: fakeStatfs(5_000_000) });   // ~19 GB
  assert.equal(s.ok, true);
  const a = assessRun(s, s, { minFreeMb: 512 });
  assert.equal(a.attributable, true);
  assert.equal(a.verdict, 'ok');
});

test('explicit uncertainty: an unreadable filesystem is UNDETERMINED, never a healthy run', () => {
  const s = sampleHeadroom({ statfs: () => { const e = new Error('nope'); e.code = 'EACCES'; throw e; } });
  assert.equal(s.ok, false);
  assert.equal(s.unknown, true);
  assert.match(s.reason, /EACCES/);
  const a = assessRun(s, s);
  assert.equal(a.attributable, false, 'an unmeasurable disk must not certify a run as attributable');
  assert.equal(a.verdict, 'unknown');
});

test('the sampler never throws — a sampler that throws takes the run down with it', () => {
  assert.doesNotThrow(() => sampleHeadroom({ statfs: () => { throw new Error('boom'); } }));
  assert.doesNotThrow(() => sampleHeadroom({ path: '/definitely/not/a/path/here' }));
});

test('a non-finite size is unknown, not zero — zero would read as a full disk', () => {
  const s = sampleHeadroom({ statfs: () => ({ bavail: NaN, bsize: 4096 }) });
  assert.equal(s.ok, false);
  assert.equal(s.unknown, true);
});

test('below the floor is not attributable — this is the case that produced four false attributions', () => {
  const s = sampleHeadroom({ statfs: fakeStatfs(1000) });        // ~4 MB
  const a = assessRun(s, s, { minFreeMb: 512 });
  assert.equal(a.verdict, 'low');
  assert.equal(a.attributable, false);
  assert.match(a.reason, /undetermined, not attributable/);
});

test('a run that DIPPED is caught even when it ends healthy — the low-water mark decides', () => {
  const before = sampleHeadroom({ statfs: fakeStatfs(5_000_000) });
  const during = sampleHeadroom({ statfs: fakeStatfs(1000) });
  assert.equal(assessRun(before, during, { minFreeMb: 512 }).attributable, false);
  assert.equal(assessRun(during, before, { minFreeMb: 512 }).attributable, false,
    'the dip counts whichever end of the run it happened at');
});

test('a missing sample fails closed rather than passing the run', () => {
  assert.equal(assessRun(null, null).attributable, false);
  assert.equal(assessRun(undefined, sampleHeadroom({ statfs: fakeStatfs(5_000_000) })).attributable, false);
});

test('the threshold is read at CALL time, so an override set after import still applies', () => {
  const prev = process.env.CW_DISK_MIN_FREE_MB;
  try {
    delete process.env.CW_DISK_MIN_FREE_MB;
    assert.deepEqual(minFreeMb(), { value: 512, source: 'default' });
    process.env.CW_DISK_MIN_FREE_MB = '4096';
    assert.deepEqual(minFreeMb(), { value: 4096, source: 'env' }, 'a module-load const would have frozen 512 here');
    const s = sampleHeadroom({ statfs: fakeStatfs(500_000) });   // ~1.9 GB, under a 4 GB floor
    assert.equal(assessRun(s, s).attributable, false);
  } finally {
    if (prev === undefined) delete process.env.CW_DISK_MIN_FREE_MB; else process.env.CW_DISK_MIN_FREE_MB = prev;
  }
});

test('an explicitly-set 0 is honoured and its source is env — never silently the default', () => {
  const prev = process.env.CW_DISK_MIN_FREE_MB;
  try {
    process.env.CW_DISK_MIN_FREE_MB = '0';
    assert.deepEqual(minFreeMb(), { value: 0, source: 'env' });
    process.env.CW_DISK_MIN_FREE_MB = 'not-a-number';
    assert.equal(minFreeMb().source, 'default', 'an unparseable override falls back, and says so');
  } finally {
    if (prev === undefined) delete process.env.CW_DISK_MIN_FREE_MB; else process.env.CW_DISK_MIN_FREE_MB = prev;
  }
});

// ── host posture ────────────────────────────────────────────────────────────────────────────
// Asserted in BOTH directions on purpose: a threshold check that only ever proves it fires on a
// full disk has not shown it stays quiet on a healthy one, and the direction that lies to you here
// is the false OK — that is the one this box actually shipped for months.

test('the 2026-09-24 state is caught: 3% free reads as fail, where the 512 MB floor said ok', () => {
  const s = sampleHeadroom({ statfs: fakeVolume(3) });
  assert.equal(assessRun(s, s, { minFreeMb: 512 }).attributable, true,
    'the byte floor genuinely passes here — which is why a second scale is needed, not a replacement');
  const h = assessHostHeadroom(s);
  assert.equal(h.verdict, 'fail');
  assert.equal(h.healthy, false);
});

test('a healthy volume stays quiet — the false-OK direction is not the only one measured', () => {
  const h = assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(59) }));
  assert.equal(h.verdict, 'ok');
  assert.equal(h.healthy, true);
});

test('the band between warn and fail is its own verdict, not rounded to either neighbour', () => {
  assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(12) })).verdict, 'warn');
  assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(7) })).verdict, 'fail');
  assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(20) })).verdict, 'ok');
});

test('boundaries are exclusive — exactly at the line is not yet over it', () => {
  assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(15) })).verdict, 'ok');
  assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(8) })).verdict, 'warn');
});

test('percentage is independent of volume size — the reason an absolute floor could not do this', () => {
  const small = assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(5, 1e6) }));
  const huge = assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(5, 1e10) }));
  assert.equal(small.verdict, 'fail');
  assert.equal(huge.verdict, 'fail', 'a 926 GiB volume at 5% is as dead as a 4 GiB one at 5%');
});

test('an unreadable total is UNKNOWN, never healthy — and the byte reading survives it', () => {
  const s = sampleHeadroom({ statfs: () => ({ bavail: 5_000_000, bsize: 4096, blocks: 0 }) });
  assert.equal(s.ok, true, 'bytes are still answerable');
  assert.equal(s.freePct, null);
  const h = assessHostHeadroom(s);
  assert.equal(h.verdict, 'unknown');
  assert.equal(h.healthy, false);
});

test('a missing sample fails closed rather than reporting a healthy host', () => {
  for (const bad of [null, undefined, { ok: false, reason: 'EACCES' }]) {
    assert.equal(assessHostHeadroom(bad).healthy, false);
    assert.equal(assessHostHeadroom(bad).verdict, 'unknown');
  }
});

test('inverted thresholds refuse to rank instead of making fail unreachable', () => {
  const h = assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(3) }), { warnPct: 5, failPct: 20 });
  assert.equal(h.verdict, 'unknown');
  assert.equal(h.healthy, false);
  assert.match(h.reason, /inverted/);
});

test('host thresholds are read at CALL time, so a test override still applies', () => {
  const prevW = process.env.CW_DISK_WARN_PCT, prevF = process.env.CW_DISK_FAIL_PCT;
  try {
    delete process.env.CW_DISK_WARN_PCT; delete process.env.CW_DISK_FAIL_PCT;
    assert.deepEqual(hostThresholds().warnPct, { value: 15, source: 'default' });
    assert.deepEqual(hostThresholds().failPct, { value: 8, source: 'default' });
    process.env.CW_DISK_WARN_PCT = '40';
    assert.deepEqual(hostThresholds().warnPct, { value: 40, source: 'env' },
      'a module-load const would have frozen 15 here');
    assert.equal(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(30) })).verdict, 'warn');
  } finally {
    if (prevW === undefined) delete process.env.CW_DISK_WARN_PCT; else process.env.CW_DISK_WARN_PCT = prevW;
    if (prevF === undefined) delete process.env.CW_DISK_FAIL_PCT; else process.env.CW_DISK_FAIL_PCT = prevF;
  }
});

test('describeHost names the volume and never reports unknown as healthy', () => {
  assert.match(describeHost(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(59) }))), /headroom ok/);
  assert.match(describeHost(assessHostHeadroom(sampleHeadroom({ statfs: fakeVolume(3) }))), /HEADROOM FAIL/);
  assert.match(describeHost(assessHostHeadroom(null)), /UNKNOWN/);
  assert.match(describeHost(assessHostHeadroom(null)), /unmeasured, not healthy/);
});

test('describeRun tells an operator which way to read the run', () => {
  const good = sampleHeadroom({ statfs: fakeStatfs(5_000_000) });
  assert.match(describeRun(assessRun(good, good, { minFreeMb: 512 })), /disk ok/);
  const bad = sampleHeadroom({ statfs: fakeStatfs(10) });
  assert.match(describeRun(assessRun(bad, bad, { minFreeMb: 512 })), /UNDETERMINED/);
});
