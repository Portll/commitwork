// Which finished sweep batches to archive and why the others are skipped (monitor/archive-batches.mjs selectBatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBatches } from '../archive-batches.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TZ = 'UTC';

const H = 3600000;
const D = 86400000;
const NEWEST = 'newest of its area \u2014 may be mid-write';
const ms = (day, sec = 0) => Date.UTC(2020, 0, day, 0, 0, sec);
const item = (name, stamp, area, manifest) => ({ name, stamp, area, manifest });

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'selectBatches-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function batch(dir, name, manifest) {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'batch-manifest.json'), JSON.stringify(manifest));
}

test('old batches are picked by area then stamp while the newest of each area is skipped', () => {
  withDir((dir) => {
    batch(dir, 'sweep-20200101000000', { area: 'beta' });
    batch(dir, 'sweep-20200102000000', { area: 'alpha' });
    batch(dir, 'sweep-20200103000000', { area: 'beta' });
    batch(dir, 'sweep-20200104000000', { area: 'alpha' });
    batch(dir, 'sweep-20200105000000', {});
    batch(dir, 'sweep-20200106000000', { area: '' });
    assert.deepEqual(selectBatches(dir, { now: ms(10) }), {
      picked: [
        item('sweep-20200105000000', ms(5), '(unscoped)', {}),
        item('sweep-20200102000000', ms(2), 'alpha', { area: 'alpha' }),
        item('sweep-20200101000000', ms(1), 'beta', { area: 'beta' }),
      ],
      skipped: [
        { name: 'sweep-20200106000000', why: NEWEST },
        { name: 'sweep-20200104000000', why: NEWEST },
        { name: 'sweep-20200103000000', why: NEWEST },
      ],
    });
  });
});

test('files, unfinished batches and names without fourteen digits are ignored', () => {
  withDir((dir) => {
    batch(dir, 'sweep-20200101000000', { area: 'alpha' });
    batch(dir, 'sweep-20200102000000', { area: 'alpha' });
    writeFileSync(join(dir, 'sweep-20200107000000'), 'x'.repeat(8));
    mkdirSync(join(dir, 'sweep-20200108000000'));
    batch(dir, 'sweep-2020010900000', { area: 'alpha' });
    batch(dir, 'other', { area: 'alpha' });
    assert.deepEqual(selectBatches(dir, { now: ms(10) }), {
      picked: [item('sweep-20200101000000', ms(1), 'alpha', { area: 'alpha' })],
      skipped: [{ name: 'sweep-20200102000000', why: NEWEST }],
    });
  });
});

test('a manifest that is not valid JSON makes it throw the parse error', () => {
  withDir((dir) => {
    mkdirSync(join(dir, 'sweep-20200101000000'));
    writeFileSync(join(dir, 'sweep-20200101000000', 'batch-manifest.json'), '{');
    let message = '';
    try { JSON.parse('{'); } catch (err) { message = err.message; }
    assert.throws(() => selectBatches(dir, { now: ms(10) }), { name: 'SyntaxError', message });
  });
});

test('the area option leaves batches of other areas out of both lists', () => {
  withDir((dir) => {
    batch(dir, 'sweep-20200101000000', { area: 'alpha' });
    batch(dir, 'sweep-20200102000000', { area: 'alpha' });
    batch(dir, 'sweep-20200103000000', { area: 'beta' });
    batch(dir, 'sweep-20200104000000', { area: 'beta' });
    assert.deepEqual(selectBatches(dir, { now: ms(10), area: 'beta' }), {
      picked: [item('sweep-20200103000000', ms(3), 'beta', { area: 'beta' })],
      skipped: [{ name: 'sweep-20200104000000', why: NEWEST }],
    });
  });
});

test('a batch exactly six hours old is picked and one a moment younger is skipped', () => {
  withDir((dir) => {
    for (const s of ['00', '01', '02']) batch(dir, `sweep-202001010000${s}`, { area: 'alpha' });
    assert.deepEqual(selectBatches(dir, { now: ms(1) + 6 * H }), {
      picked: [item('sweep-20200101000000', ms(1), 'alpha', { area: 'alpha' })],
      skipped: [
        { name: 'sweep-20200101000001', why: 'younger than 6h' },
        { name: 'sweep-20200101000002', why: NEWEST },
      ],
    });
    assert.deepEqual(selectBatches(dir, { now: ms(1) + 6 * H - 1 }), {
      picked: [],
      skipped: [
        { name: 'sweep-20200101000000', why: 'younger than 6h' },
        { name: 'sweep-20200101000001', why: 'younger than 6h' },
        { name: 'sweep-20200101000002', why: NEWEST },
      ],
    });
  });
});

test('a custom minAgeMs is the boundary and its hours are rounded in the reason', () => {
  withDir((dir) => {
    for (const s of ['00', '01', '02']) batch(dir, `sweep-202001010000${s}`, { area: 'alpha' });
    assert.deepEqual(selectBatches(dir, { now: ms(1) + 1.5 * H, minAgeMs: 1.5 * H }), {
      picked: [item('sweep-20200101000000', ms(1), 'alpha', { area: 'alpha' })],
      skipped: [
        { name: 'sweep-20200101000001', why: 'younger than 2h' },
        { name: 'sweep-20200101000002', why: NEWEST },
      ],
    });
  });
});

test('olderThanDays picks a batch exactly that many days old and skips a newer one', () => {
  withDir((dir) => {
    batch(dir, 'sweep-20200101000000', { area: 'alpha' });
    batch(dir, 'sweep-20200101000001', { area: 'alpha' });
    batch(dir, 'sweep-20200110000000', { area: 'alpha' });
    const why = 'newer than --older-than 2d';
    assert.deepEqual(selectBatches(dir, { now: ms(1) + 2 * D, olderThanDays: 2 }), {
      picked: [item('sweep-20200101000000', ms(1), 'alpha', { area: 'alpha' })],
      skipped: [{ name: 'sweep-20200101000001', why }, { name: 'sweep-20200110000000', why: NEWEST }],
    });
    assert.deepEqual(selectBatches(dir, { now: ms(1) + 2 * D - 1, olderThanDays: 2 }), {
      picked: [],
      skipped: [
        { name: 'sweep-20200101000000', why },
        { name: 'sweep-20200101000001', why },
        { name: 'sweep-20200110000000', why: NEWEST },
      ],
    });
  });
});

test('an empty directory yields empty picked and skipped lists', () => {
  withDir((dir) => {
    assert.deepEqual(selectBatches(dir, { now: ms(10) }), { picked: [], skipped: [] });
  });
});
