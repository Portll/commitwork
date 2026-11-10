// Absolute write roots for a lane, each paired with its real path (bin/lib/isolation.mjs laneWriteRoots).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneWriteRoots } from '../lib/isolation.mjs';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fakeFs = (links = {}) => ({
  realpathSync: (p) => {
    if (Object.hasOwn(links, p)) return links[p];
    throw new Error(`ENOENT: ${p}`);
  },
});

test('returns an empty array for a spec that is not a plain object', () => {
  for (const spec of [null, undefined, 'spec', 42, ['/work/report'], new Date(0)]) {
    assert.deepEqual(laneWriteRoots(spec, { fs: fakeFs() }), []);
  }
});

test('lists report and tmp dirs before the fixed temp roots, each followed by its real path', () => {
  const r = laneWriteRoots(
    { reportDir: '/work/report', tmpDir: '/work/tmp' },
    { fs: fakeFs({ '/tmp': '/private/tmp', '/work/report': '/real/report' }) },
  );
  assert.deepEqual(r, [
    '/work/report', '/real/report',
    '/work/tmp', '/work/tmp',
    '/tmp', '/private/tmp',
    '/private/tmp', '/private/tmp',
  ]);
});

test('drops a relative report dir and an empty tmp dir', () => {
  const r = laneWriteRoots(
    { reportDir: 'work/report', tmpDir: '' },
    { fs: fakeFs({ '/tmp': '/private/tmp' }) },
  );
  assert.deepEqual(r, ['/tmp', '/private/tmp', '/private/tmp', '/private/tmp']);
});

test('keeps a dir that starts with a slash and drops the same dir without one', () => {
  const r = laneWriteRoots({ reportDir: '/work/report', tmpDir: 'work/tmp' }, { fs: fakeFs() });
  assert.deepEqual(r, [
    '/work/report', '/work/report',
    '/tmp', '/tmp',
    '/private/tmp', '/private/tmp',
  ]);
});

test('drops report and tmp dirs that are missing or not strings', () => {
  const expected = ['/tmp', '/tmp', '/private/tmp', '/private/tmp'];
  assert.deepEqual(laneWriteRoots({}, { fs: fakeFs() }), expected);
  assert.deepEqual(laneWriteRoots({ reportDir: 7, tmpDir: ['/work/tmp'] }, { fs: fakeFs() }), expected);
});

test('strips trailing slashes before resolving and turns a run of slashes into the root', () => {
  const r = laneWriteRoots(
    { reportDir: '/work/report///', tmpDir: '///' },
    { fs: fakeFs({ '/work/report': '/real/report' }) },
  );
  assert.deepEqual(r, [
    '/work/report', '/real/report',
    '/', '/',
    '/tmp', '/tmp',
    '/private/tmp', '/private/tmp',
  ]);
});

test('adds nothing for extraWrites that is not an array or is empty', () => {
  const expected = [
    '/work/report', '/work/report',
    '/tmp', '/tmp',
    '/private/tmp', '/private/tmp',
  ];
  assert.deepEqual(laneWriteRoots({ reportDir: '/work/report', extraWrites: '/extra' }, { fs: fakeFs() }), expected);
  assert.deepEqual(laneWriteRoots({ reportDir: '/work/report', extraWrites: [] }, { fs: fakeFs() }), expected);
});

test('resolves real paths on disk and keeps a missing dir as given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'laneWriteRoots-'));
  try {
    mkdirSync(join(dir, 'report'));
    const r = laneWriteRoots({ reportDir: `${join(dir, 'report')}/`, tmpDir: join(dir, 'missing') });
    assert.deepEqual(r, [
      join(dir, 'report'), join(realpathSync(dir), 'report'),
      join(dir, 'missing'), join(dir, 'missing'),
      '/tmp', realpathSync('/tmp'),
      '/private/tmp', '/private/tmp',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
