// bin/test/deps-introduced.test.mjs — `commitwork deps --introduced` through runDeps, over two git
// refs and over two files, with the advisory lookup injected. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runDeps, parseDepsArgs } from '../deps.mjs';

const NOW = '2026-10-29T00:00:00.000Z';
const lock = (pk) => JSON.stringify({ name: 'member-repo', lockfileVersion: 3, packages: { '': { name: 'member-repo', dependencies: { 'widget-x': '^1.0.0' } }, ...pk } }, null, 2);
const BEFORE = lock({ 'node_modules/widget-x': { version: '1.0.0', dependencies: { 'child-y': '^1.0.0' } }, 'node_modules/child-y': { version: '1.0.0' } });
const AFTER = lock({ 'node_modules/widget-x': { version: '1.1.0', dependencies: { 'child-y': '^1.2.0' } }, 'node_modules/child-y': { version: '1.2.0' } });
const lookup = (t) => async (pairs) => new Map(pairs.map((p) => [`${p.name}@${p.version}`, { advisories: t[`${p.name}@${p.version}`] || [] }]));
const HIGH = { 'child-y@1.2.0': [{ id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', severitySource: 'label' }] };

function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'cw-introduced-'));
  process.env.CW_SETTINGS = join(d, 'settings.json');
  return d;
}

async function run(argv, t, cwd) {
  let out = '';
  let err = '';
  const prev = process.cwd();
  if (cwd) process.chdir(cwd);
  try {
    const code = await runDeps(argv, { out: (s) => { out += s; }, err: (s) => { err += s; }, env: { ...process.env, CW_NOW: NOW }, lookup: lookup(t) });
    return { code, out, err };
  } finally { process.chdir(prev); }
}

test('two lockfiles: exit 21 on an introduced high, 0 when it was already there, JSON on request', async () => {
  const d = scratch();
  writeFileSync(join(d, 'before.json'), BEFORE);
  writeFileSync(join(d, 'after.json'), AFTER);
  const files = ['--introduced', '--before', join(d, 'before.json'), '--after', join(d, 'after.json')];
  const hit = await run([...files, '--json'], HIGH);
  assert.equal(hit.code, 21, hit.err);
  const v = JSON.parse(hit.out);
  assert.deepEqual([v.state, v.introduced[0].package, v.introduced[0].paths[0]], ['introduces', 'child-y', ['widget-x@1.1.0', 'child-y@1.2.0']]);
  assert.equal(v.generatedAt, NOW);
  const had = await run(files, { ...HIGH, 'child-y@1.0.0': HIGH['child-y@1.2.0'] });
  assert.equal(had.code, 0, had.out);
  assert.match(had.out, /verdict: clear/);
});

test('a missing after file and an unreadable one exit 22 and say it is not a pass', async () => {
  const d = scratch();
  writeFileSync(join(d, 'before.json'), BEFORE);
  writeFileSync(join(d, 'after.json'), '{ torn');
  for (const after of [join(d, 'absent.json'), join(d, 'after.json')]) {
    const r = await run(['--introduced', '--before', join(d, 'before.json'), '--after', after], HIGH);
    assert.equal(r.code, 22, r.out);
    assert.match(r.out, /not measured — this is not a pass/);
  }
});

test('a ref range reads both lockfiles out of git; --exclude-dev narrows this run', async () => {
  const d = scratch();
  const git = (...a) => { const r = spawnSync('git', a, { cwd: d, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  writeFileSync(join(d, 'package-lock.json'), BEFORE); git('add', '-A'); git('commit', '-q', '-m', 'before');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(d, 'package-lock.json'), AFTER.replace('"version": "1.2.0"', '"version": "1.2.0",\n      "dev": true')); git('commit', '-qam', 'after');
  const all = await run(['--introduced', `${base}..HEAD`, '--json'], HIGH, d);
  assert.equal(all.code, 21, all.out + all.err);
  assert.deepEqual(JSON.parse(all.out).subject.before, { ref: base });
  const shipped = await run(['--introduced', `${base}..HEAD`, '--exclude-dev'], HIGH, d);
  assert.equal(shipped.code, 0, shipped.out);
});

test('--introduced usage is checked before anything runs', () => {
  assert.throws(() => parseDepsArgs(['--introduced']), /takes <base>\.\.<head>, or --before/);
  assert.throws(() => parseDepsArgs(['--introduced', 'a..b', '--before', 'x']), /not both/);
  assert.throws(() => parseDepsArgs(['--before', 'x']), /--before applies to --introduced/);
  assert.throws(() => parseDepsArgs(['--introduced', 'a..b', '--update']), /its own run/);
  assert.equal(parseDepsArgs(['.', '--introduced', 'HEAD^1..HEAD']).range, 'HEAD^1..HEAD');
});

test.after(() => { delete process.env.CW_SETTINGS; });
