// Which registry repos a health run covers and whether the filter names an area (monitor/health-scope.mjs healthScope).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthScope } from '../health-scope.mjs';

const areas = [{ slug: 'tools' }, { slug: 'other' }];

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'healthScope-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    return fn(repo, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an area filter drops a repo that belongs to a different area', () => {
  withRepo((repo) => {
    const reg = { areas, projects: [{ name: 'alpha', path: repo, area: 'other' }] };
    assert.deepEqual(healthScope(reg, 'tools'), { onlyIsArea: true, repos: [] });
  });
});

test('a filter naming a project is not an area and a missing path is dropped', () => {
  withRepo((repo, dir) => {
    const reg = { areas, projects: [{ name: 'alpha', path: join(dir, 'missing'), area: 'tools' }] };
    assert.deepEqual(healthScope(reg, 'alpha'), { onlyIsArea: false, repos: [] });
  });
});

test('a null filter is not an area and a skipped repo is dropped even though it exists', () => {
  withRepo((repo) => {
    const reg = { areas, projects: [{ name: 'alpha', path: repo, area: 'tools' }] };
    const r = healthScope(reg, null, { skip: () => true });
    assert.deepEqual(r, { onlyIsArea: false, repos: [] });
  });
});

test('an empty filter is not an area even when an area has an empty slug', () => {
  withRepo((repo) => {
    const reg = { areas: [{ slug: '' }], projects: [{ name: 'alpha', path: repo, area: '' }] };
    const r = healthScope(reg, '', { skip: () => true });
    assert.deepEqual(r, { onlyIsArea: false, repos: [] });
  });
});

test('a project sharing its name with an area wins over the area', () => {
  withRepo((repo) => {
    const reg = { areas, projects: [{ name: 'tools', path: repo, area: 'other' }] };
    const r = healthScope(reg, 'tools', { skip: () => true });
    assert.deepEqual(r, { onlyIsArea: false, repos: [] });
  });
});

test('skip matches on the repo name', () => {
  withRepo((repo) => {
    const reg = { areas, projects: [{ name: 'alpha', path: repo, area: 'tools' }] };
    const r = healthScope(reg, 'alpha', { skip: (name) => name === 'alpha' });
    assert.deepEqual(r, { onlyIsArea: false, repos: [] });
  });
});

test('leaving out the options keeps the same repos as a skip that rejects nothing', () => {
  withRepo((repo) => {
    const reg = { areas, projects: [{ name: 'alpha', path: repo, area: 'tools' }] };
    assert.deepEqual(healthScope(reg, 'alpha'), healthScope(reg, 'alpha', { skip: () => false }));
  });
});

test('the area of a project does not change a selection by project name', () => {
  withRepo((repo) => {
    const make = (area) => ({
      areas: [...areas, { slug: 'beta' }],
      projects: [{ name: 'beta', path: repo, area }],
    });
    assert.deepEqual(healthScope(make('other'), 'beta'), healthScope(make('beta'), 'beta'));
  });
});
