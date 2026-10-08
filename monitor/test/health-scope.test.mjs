// healthScope resolves the healthcheck's repos through sweep.mjs's resolver. Pinned because a
// private copy of that enumeration resolved ZERO repos for commitwork-admin: it read `~/` paths
// unexpanded and never saw members found by walking a root.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthScope } from '../health-scope.mjs';

let HOME, prevHome;
const repo = (...p) => { const d = join(HOME, ...p); mkdirSync(join(d, '.git'), { recursive: true }); return d; };

before(() => {
  HOME = mkdtempSync(join(tmpdir(), 'cw-health-scope-'));
  prevHome = process.env.HOME;
  process.env.HOME = HOME;
  repo('work', 'anchor');
  repo('roots', 'anchor-web');
  repo('roots', 'anchor-docs');
  repo('roots', 'elsewhere');
});
after(() => { process.env.HOME = prevHome; rmSync(HOME, { recursive: true, force: true }); });

const registry = () => ({
  reportsRoot: 'reports',
  projects: [{ name: 'anchor', path: '~/work/anchor', area: 'anchor-area' }],
  roots: [{ path: '~/roots' }],
  areas: [
    { slug: 'anchor-area', members: ['anchor', 'anchor-web', 'anchor-docs'] },
    { slug: 'other-area', members: ['elsewhere'] },
  ],
});
const names = (s) => s.repos.map((r) => r.name).sort();

test('an area slug resolves its ~/-relative project AND its root-discovered members', () => {
  const s = healthScope(registry(), 'anchor-area');
  assert.equal(s.onlyIsArea, true);
  assert.deepEqual(names(s), ['anchor', 'anchor-docs', 'anchor-web']);
  assert.ok(s.repos.every((r) => r.path.startsWith(HOME)), 'every path must be expanded, never a literal ~/');
});

test('a project name narrows to that repo alone', () => {
  const s = healthScope(registry(), 'anchor-web');
  assert.equal(s.onlyIsArea, false);
  assert.deepEqual(names(s), ['anchor-web']);
});

test('another area\'s repo never leaks into the scope', () => {
  assert.ok(!names(healthScope(registry(), 'anchor-area')).includes('elsewhere'));
  assert.deepEqual(names(healthScope(registry(), 'other-area')), ['elsewhere']);
});

test('skip() drops repos, and an unknown scope resolves empty for the caller to refuse', () => {
  assert.deepEqual(names(healthScope(registry(), 'anchor-area', { skip: (n) => n === 'anchor-docs' })), ['anchor', 'anchor-web']);
  assert.deepEqual(names(healthScope(registry(), 'no-such-area')), []);
});
