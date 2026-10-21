// monitor/timeline-scope.mjs: which rows of the fleet-wide judgment stores one area's timeline shows.
// Before it, timeline2 rendered every programme and every acceptance in every area's timeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaScope, scopeJudgments } from '../timeline-scope.mjs';

const REG = { areas: [
  { slug: 'alpha', label: 'Alpha', out: 'alpha', primary: true },
  { slug: 'beta', label: 'Beta', out: 'beta' },
] };
const projectOf = (repo) => ({ 'alpha-api': 'Alpha', 'beta-web': 'Beta' })[repo] || repo;

const ROWS = [
  { store: 'annotations', repo: 'alpha-api' },
  { store: 'annotations', repo: 'beta-web' },
  { store: 'annotations', repo: '*' },
  { store: 'image-acceptance', repo: 'gateway', project: 'beta' },
  { store: 'image-acceptance', repo: 'tempo' },
  { store: 'scanner-annotations', repo: '' },
];
const PROGRAMS = [{ key: 'p-alpha', project: 'Alpha' }, { key: 'p-beta', project: 'beta' }, { key: 'p-legacy' }];

test('a non-primary area sees its own rows and fleet-wide ones, and counts what it hides', () => {
  const out = scopeJudgments({ rows: ROWS, programs: PROGRAMS }, areaScope('beta', REG), projectOf);
  assert.deepEqual(out.rows.map((r) => r.repo), ['beta-web', '*', 'gateway']);
  assert.deepEqual(out.programs.map((p) => p.key), ['p-beta']);
  assert.deepEqual(out.hidden, { triage: 3, programs: 2 });
});

test('the primary area also keeps records that declare no project, where they always rendered', () => {
  const out = scopeJudgments({ rows: ROWS, programs: PROGRAMS }, areaScope('alpha', REG), projectOf);
  assert.deepEqual(out.rows.map((r) => r.repo), ['alpha-api', '*', 'tempo', '']);
  assert.deepEqual(out.programs.map((p) => p.key), ['p-alpha', 'p-legacy']);
});

test('a project is matched by area slug or label', () => {
  const scope = areaScope('beta', REG);
  assert.ok(scope.inScope('beta'));
  assert.ok(scope.inScope('Beta'));
  assert.ok(!scope.inScope('Alpha'));
});
