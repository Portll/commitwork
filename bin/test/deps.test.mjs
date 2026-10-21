// bin/test/deps.test.mjs — `commitwork deps` end to end through the CLI, with a stand-in npm,
// and the picker's model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDepsArgs } from '../deps.mjs';
import { pickerModel, pickerReduce, initialPicker, pickerKeys, pickerScreen } from '../lib/checkbox-tui.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const NOW = '2026-10-10T00:00:00.000Z';
const ago = (d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const skip = process.platform === 'win32' ? 'the stand-in npm is a POSIX shell wrapper' : false;

function setup(registry) {
  const d = mkdtempSync(join(tmpdir(), 'cw-depscli-'));
  writeFileSync(join(d, 'registry.json'), JSON.stringify(registry));
  writeFileSync(join(d, 'npm'), `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'fixtures', 'npm-stub.mjs')}" "$@"\n`);
  chmodSync(join(d, 'npm'), 0o755);
  const repo = join(d, 'repo');
  spawnSync('mkdir', ['-p', repo]);
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'T'); git('config', 'user.email', 't@example.invalid');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx', devDependencies: { hb: '^4.7.6' }, dependencies: { alpha: '^1.0.0' } }));
  writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/alpha': { version: '1.0.0' }, 'node_modules/hb': { version: '4.7.6', dev: true } } }));
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  const env = { ...process.env, CW_NOW: NOW, CW_NPM: join(d, 'npm'), CW_NPM_STUB_REGISTRY: join(d, 'registry.json'), CW_DEPS_LEDGER: join(d, 'ledger.jsonl'),
    CW_SETTINGS: join(d, 'settings.json'), NO_COLOR: '1' };
  const run = (...args) => spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'deps', ...args], { cwd: d, env, encoding: 'utf8' });
  return { d, repo, run, git };
}

const REG = {
  packages: { alpha: { versions: { '1.0.0': ago(400), '1.0.4': ago(30) } }, hb: { versions: { '4.7.6': ago(400), '4.7.10': ago(20) } } },
  advisories: [{ name: 'alpha', range: '<1.0.4', severity: 'high', title: 'shipped flaw', fixedIn: '1.0.4' }],
};

test('the audit gate exits 21 on a fixable shipped advisory, 0 once it is fixed, 22 when nothing can be measured', { skip }, () => {
  const { repo, run, d } = setup(REG);
  const a = run(repo, '--audit-gate');
  assert.equal(a.status, 21, a.stdout + a.stderr);
  assert.match(a.stdout, /gate: 1 shipped advisories at high or above can be fixed now: alpha/);
  assert.doesNotMatch(a.stderr, /CW_REPORT_DIR/, 'deps runs no lane and needs no report directory');
  const fixed = setup({ ...REG, advisories: [{ ...REG.advisories[0], name: 'hb', range: '<4.7.10' }] });
  assert.equal(fixed.run(fixed.repo, '--audit-gate').status, 0, 'a dev-only advisory does not gate shipped');
  assert.equal(fixed.run(fixed.repo, '--audit-gate', '--include-dev').status, 21);
  writeFileSync(join(d, 'empty.json'), '{}');
  assert.equal(run(d, '--no-record').status, 22, 'a directory with no package.json is not measured');
  const lines = readFileSync(join(d, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
  assert.deepEqual(lines, ['audit'], 'one audit recorded; --no-record wrote nothing');
});

test('--update proposes, --dry-run does not, and --history draws what the ledger recorded', { skip }, () => {
  const { repo, run, d, git } = setup(REG);
  const dry = run(repo, '--update', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would propose · commitwork\/deps-[0-9a-f]{12}/);
  assert.equal(git('for-each-ref', 'refs/heads/commitwork').stdout, '');
  assert.equal(existsSync(join(d, 'ledger.jsonl')), false, 'a dry run records nothing');
  const up = run(repo, '--update', '--patch', '--advisories');
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /proposed · commitwork\/deps-/);
  assert.match(up.stdout, /shipped critical\/high advisories: 1 → 0/);
  const again = run(repo, '--update', '--patch', '--advisories', '--merge', '--automerge', 'patch,advisories');
  assert.equal(again.status, 0, 'the same selection on the same commit is already proposed');
  assert.match(again.stdout, /already proposed/);
  const other = run(repo, '--update', '--patch', '--merge', '--automerge', 'patch');
  assert.equal(other.status, 24, 'a new selection is proposed, and its merge is refused without trust');
  assert.match(other.stdout, /superseded: commitwork\/deps-/);
  assert.match(other.stdout, /not merged: .*--trust-repo-manifest/);
  const evs = readFileSync(join(d, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
  assert.ok(evs.includes('superseded') && evs.includes('refused'), evs.join(','));
  const h = run('--history', '--out', join(d, 'h.html'));
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /deps history · 1 project\(s\)/);
  assert.match(readFileSync(join(d, 'h.html'), 'utf8'), /<title>Dependency updates/);
});

test('usage errors exit 2 and name the problem', () => {
  assert.throws(() => parseDepsArgs(['--merge']), /--merge applies to --update/);
  assert.throws(() => parseDepsArgs(['--update', '--prod', 'patch,huge']), /unknown update kind/);
  assert.throws(() => parseDepsArgs(['--cooldown', 'soon']), /--cooldown takes/);
  assert.deepEqual(parseDepsArgs(['--update', '--minor', '--cooldown', 'patch=0,major=30']).cooldown, { patch: 0, major: 30 });
  assert.deepEqual(parseDepsArgs(['--update', '--minor', '--lockfile']).dev, ['minor', 'lockfile']);
  const r = spawnSync(process.execPath, [join(CW, 'bin', 'commitwork.mjs'), 'deps', '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

const report = { name: 'fx', dir: '/x', deps: [
  { name: 'a', kind: 'dependencies', locked: '1.0.0', skipped: null, updates: [{ type: 'patch', version: '1.0.1' }, { type: 'minor', version: '1.2.0' }], held: [] },
  { name: 'b', kind: 'devDependencies', locked: '2.0.0', skipped: null, updates: [{ type: 'major', version: '3.0.0' }], held: [{ version: '3.1.0' }] },
  { name: 'c', kind: 'dependencies', locked: '1.0.0', skipped: 'linked', updates: [], held: [] },
] };
const operator = { prod: ['patch', 'minor', 'lockfile'], dev: ['patch', 'minor', 'advisories'], automerge: [], cooldown: 7 };

test('the picker recomputes each target as types toggle, and the repository policy still caps it', () => {
  let s = initialPicker({ types: ['patch'] });
  let m = pickerModel(report, operator, null, s);
  assert.deepEqual(m.rows.filter((r) => r.id.startsWith('dep:')).map((r) => `${r.name} ${r.pick?.version ?? '-'}`), ['a 1.0.1', 'b -']);
  s = pickerReduce(s, 'type:minor', m);
  s = pickerReduce(s, 'type:major', pickerModel(report, operator, null, s));
  m = pickerModel(report, operator, null, s);
  assert.deepEqual(m.rows.filter((r) => r.id.startsWith('dep:')).map((r) => `${r.name} ${r.pick?.version ?? '-'}`), ['a 1.2.0', 'b 3.0.0']);
  const capped = pickerModel(report, operator, { version: 1, zeroRuntimeDependencies: true }, s);
  assert.equal(capped.rows.find((r) => r.name === 'a').pick, null, 'zeroRuntimeDependencies: no production update, whatever is toggled');
  assert.equal(m.rows.find((r) => r.id === 'merge').available, false, 'merge is not offered without trust');
});

test('the picker returns exactly what was checked, and q cancels', () => {
  let s = initialPicker({ types: ['patch', 'minor'], trustRepo: true });
  let m = pickerModel(report, operator, null, s);
  s = pickerReduce(s, 'toggle', m); // uncheck a
  m = pickerModel(report, operator, null, s);
  for (let i = 0; i < m.rows.length; i++) if (m.rows[i].id === 'merge') { s = { ...s, cursor: i }; break; }
  s = pickerReduce(s, 'toggle', m);
  const done = pickerReduce(s, 'enter', pickerModel(report, operator, null, s)).done;
  assert.deepEqual(done.direct, []);
  assert.equal(done.merge, true);
  assert.equal(done.lockfile, true);
  assert.equal(pickerReduce(s, 'quit', m).cancel, true);
  assert.deepEqual(pickerKeys('\x1b[B \r1q'), ['down', 'toggle', 'enter', 'type:patch', 'quit']);
  const screen = pickerScreen(s, pickerModel(report, operator, null, s), report, { cols: 60, rows: 12 });
  assert.equal(screen.length, 12);
  for (const l of screen) assert.equal([...l].length, 60);
});
