// A declared cadence re-derives the whole threshold. The rollup stamps the DAILY default
// (expireMs 50h); kept beside a weekly cadence it expired an area after two days and the stale band
// between fresh and expired never occurred.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOne } from '../liveness.mjs';
import { appendRecord } from '../../bin/lib/verdict-journal-core.mjs';

const H = 3600_000, DAY = 24 * H, WEEK = 7 * DAY;
let root, prevReg;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'cw-liveness-cadence-'));
  prevReg = process.env.CW_REGISTRY;
  const reg = join(root, 'projects.json');
  writeFileSync(reg, JSON.stringify({
    reportsRoot: join(root, 'reports'),
    projects: [],
    areas: [{ slug: 'weekly-area', label: 'weekly', cadenceMs: WEEK }],
  }));
  process.env.CW_REGISTRY = reg;
});
after(() => {
  if (prevReg === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = prevReg;
  rmSync(root, { recursive: true, force: true });
});

function rollupAged(ms) {
  const dir = join(root, 'reports', 'weekly-area');
  mkdirSync(join(dir, 'history'), { recursive: true });
  const generated = new Date(Date.now() - ms).toISOString();
  const sliceId = `sweep-${generated.replace(/[-:T]/g, '').slice(0, 14)}`;
  const threshold = { cadenceMs: DAY, graceMs: 2 * H, expireMs: 50 * H };
  writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ sliceId, generated, freshness: { generated, threshold } }));
  appendRecord(join(dir, 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-verdict', at: generated, sliceId, area: 'weekly-area' });
  return join(dir, 'rollup.json');
}

test('a weekly area four days old is fresh, not expired by the daily stamp', () => {
  assert.equal(checkOne(rollupAged(4 * DAY), 'weekly-area').state, 'fresh');
});

test('a weekly area eight days old is stale: the band between fresh and expired exists again', () => {
  assert.equal(checkOne(rollupAged(8 * DAY), 'weekly-area').state, 'stale');
});

test('a weekly area past two cadences is expired', () => {
  assert.equal(checkOne(rollupAged(15 * DAY), 'weekly-area').state, 'expired');
});
