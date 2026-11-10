// Age-based fresh, stale or unknown verdict for the KEV catalogue (cra/lib.mjs kevFreshness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kevFreshness } from '../lib.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RELEASED = '2026-01-01T00:00:00.000Z';

function run(body, at) {
  const dir = mkdtempSync(join(tmpdir(), 'kevFreshness-'));
  try {
    const kev = join(dir, 'kev.json');
    writeFileSync(kev, typeof body === 'string' ? body : JSON.stringify(body));
    return kevFreshness({ kev }, at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('A catalogue exactly seven days old is still fresh', () => {
  const r = run({ dateReleased: RELEASED, catalogVersion: '2026.01.01' }, '2026-01-08T00:00:00.000Z');
  assert.deepEqual(r, { state: 'fresh', ageDays: 7, maxDays: 7, catalogVersion: '2026.01.01', dateReleased: RELEASED });
});

test('A catalogue one millisecond past seven days old is stale', () => {
  const r = run({ dateReleased: RELEASED, catalogVersion: '2026.01.01' }, '2026-01-08T00:00:00.001Z');
  assert.deepEqual(r, { state: 'stale', ageDays: 7, maxDays: 7, catalogVersion: '2026.01.01', dateReleased: RELEASED });
});

test('A catalogue one millisecond short of seven days old is fresh and its age rounds to seven', () => {
  const r = run({ dateReleased: RELEASED, catalogVersion: 'v3' }, '2026-01-07T23:59:59.999Z');
  assert.deepEqual(r, { state: 'fresh', ageDays: 7, maxDays: 7, catalogVersion: 'v3', dateReleased: RELEASED });
});

test('A ten day old catalogue is stale with an age of ten days', () => {
  const r = run({ dateReleased: RELEASED, catalogVersion: 'v2' }, '2026-01-11T00:00:00.000Z');
  assert.deepEqual(r, { state: 'stale', ageDays: 10, maxDays: 7, catalogVersion: 'v2', dateReleased: RELEASED });
});

test('A two and a half day old catalogue is fresh and its age rounds up to three', () => {
  const r = run({ dateReleased: RELEASED, catalogVersion: 'v1' }, '2026-01-03T12:00:00.000Z');
  assert.deepEqual(r, { state: 'fresh', ageDays: 3, maxDays: 7, catalogVersion: 'v1', dateReleased: RELEASED });
});

test('A catalogue without a release date has unknown freshness', () => {
  const r = run({ catalogVersion: 'v4' }, '2026-01-08T00:00:00.000Z');
  assert.deepEqual(r, { state: 'unknown', ageDays: null, maxDays: 7, catalogVersion: 'v4', dateReleased: null });
});

test('An unparseable release date gives unknown freshness and is reported as given', () => {
  const r = run({ dateReleased: 'invalid-date', catalogVersion: 'v5' }, '2026-01-08T00:00:00.000Z');
  assert.deepEqual(r, { state: 'unknown', ageDays: null, maxDays: 7, catalogVersion: 'v5', dateReleased: 'invalid-date' });
});

test('A catalogue file that is not JSON gives unknown freshness with null version and date', () => {
  const r = run('not-json', '2026-01-08T00:00:00.000Z');
  assert.deepEqual(r, { state: 'unknown', ageDays: null, maxDays: 7, catalogVersion: null, dateReleased: null });
});

test('Empty release date and version strings are reported as null', () => {
  const r = run({ dateReleased: '', catalogVersion: '' }, '2026-01-08T00:00:00.000Z');
  assert.deepEqual(r, { state: 'unknown', ageDays: null, maxDays: 7, catalogVersion: null, dateReleased: null });
});
