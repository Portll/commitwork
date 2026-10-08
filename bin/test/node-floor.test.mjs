// One Node.js floor: package.json engines.node is the declaration, and the CLI's refusal, the CI
// matrix and every prose statement of the requirement must agree with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declaredFloor, nodeFloorCheck } from '../../lib/node-floor.mjs';
import { parseYaml } from '../actions-gaps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'bin', 'commitwork.mjs');
const floor = declaredFloor();

function withPackage(engines, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-node-floor-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify(engines === undefined ? { name: 'x' } : { name: 'x', engines: { node: engines } }));
    return fn(p);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the declared floor is read from package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(floor.range, pkg.engines.node.trim());
  assert.match(floor.range, /^>=\d+\.\d+\.\d+$/, 'declare a full version so the refusal and the docs agree on one number');
});

test('the check compares against the file, not a constant', () => {
  withPackage('>=99.0.0', (p) => assert.equal(nodeFloorCheck(process.versions.node, p).ok, false));
  withPackage('>=1.0.0', (p) => assert.equal(nodeFloorCheck(process.versions.node, p).ok, true));
});

test('below, at and above the floor', () => {
  const [a, b, c] = floor.version;
  const below = b > 0 ? `${a}.${b - 1}.99` : `${a - 1}.99.99`;
  const r = nodeFloorCheck(below);
  assert.equal(r.ok, false);
  assert.match(r.message, new RegExp(`below the supported floor ${floor.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(nodeFloorCheck(`v${a}.${b}.${c}`).ok, true);
  assert.equal(nodeFloorCheck(`${a}.${b}.${c + 1}`).ok, true);
  assert.equal(nodeFloorCheck(`${a + 1}.0.0`).ok, true);
});

test('an unreadable or unparseable declaration throws rather than passing', () => {
  withPackage(undefined, (p) => assert.throws(() => declaredFloor(p), /only ">=X\.Y\.Z" is understood/));
  withPackage('^22 || ^24', (p) => assert.throws(() => declaredFloor(p), /only ">=X\.Y\.Z" is understood/));
  assert.throws(() => declaredFloor(join(tmpdir(), 'cw-node-floor-absent', 'package.json')), /ENOENT/);
  assert.throws(() => nodeFloorCheck('not-a-version'), /cannot parse/);
});

// Fakes the runtime's version in a child, so this asserts the CLI's behaviour rather than its source.
const fakeVersion = (v) => `data:text/javascript,Object.defineProperty(process,"versions",{value:{...process.versions,node:${JSON.stringify(v)}}})`;
function cli(version, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-node-floor-cli-'));
  try {
    return spawnSync(process.execPath, ['--import', fakeVersion(version), CLI, ...args],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: join(dir, 'reports'), CW_SELF_SWEEP: '0' }, timeout: 60_000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the CLI refuses below the floor with exit 2 and says which floor', () => {
  const r = cli('20.19.0', 'list');
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, new RegExp(`Node\\.js 20\\.19\\.0 is below the supported floor ${floor.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('help still answers below the floor', () => {
  const r = cli('20.19.0', 'help');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /below the supported floor/);
});

// ── CI ──────────────────────────────────────────────────────────────────────────────────────────
const get = (n, k) => (n && n.type === 'map' ? n.entries.get(k) : undefined);
const values = (n) => (!n ? [] : n.type === 'seq' ? n.items.map((i) => i.value) : [n.value]);

function ciRuns() {
  const doc = parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'));
  const runs = [];
  for (const [name, job] of get(doc, 'jobs').entries) {
    const matrix = get(get(job, 'strategy'), 'matrix');
    const resolveExpr = (v) => {
      const m = /^\$\{\{\s*matrix\.(\w+)\s*\}\}$/.exec(String(v).trim());
      if (!m) return [String(v)];
      const vs = values(get(matrix, m[1]));
      assert.ok(vs.length, `job ${name} reads matrix.${m[1]}, which its matrix does not declare`);
      return vs;
    };
    const setup = (get(job, 'steps')?.items || []).find((s) => /^actions\/setup-node@/.test(get(s, 'uses')?.value || ''));
    if (!setup) continue;
    const declared = get(get(setup, 'with'), 'node-version');
    assert.ok(declared, `job ${name} sets up Node without naming a version`);
    for (const os of resolveExpr(get(job, 'runs-on').value)) {
      for (const node of resolveExpr(declared.value)) runs.push({ job: name, os, major: Number(/^(\d+)/.exec(node)?.[1]) });
    }
  }
  return runs;
}

test('CI tests the declared floor, on every platform', () => {
  const runs = ciRuns();
  assert.ok(runs.length, 'no setup-node job was found in ci.yml');
  for (const r of runs) assert.ok(Number.isInteger(r.major), `job ${r.job} names a Node version that is not a major`);
  const lowest = Math.min(...runs.map((r) => r.major));
  assert.equal(lowest, floor.version[0], `the lowest Node in CI (${lowest}) must be the engines floor's major (${floor.version[0]})`);
  for (const family of ['ubuntu', 'macos', 'windows']) {
    const majors = new Set(runs.filter((r) => r.os.startsWith(`${family}-`)).map((r) => r.major));
    assert.ok(majors.has(floor.version[0]), `no ${family} job runs Node ${floor.version[0]}`);
    assert.ok(majors.size >= 2, `${family} runs only Node ${[...majors].join(', ')}; the floor and a newer LTS are both supported`);
  }
});

// ── prose ───────────────────────────────────────────────────────────────────────────────────────
// Each exemption is a true statement about something other than commitwork's own floor.
const EXEMPT = {
  'bin/probe-public.mjs': 'runs on hosts outside this checkout; states its own need for global fetch',
  'lib/win-spawn.mjs': 'describes a behaviour change in Node 18.20.2, not a requirement',
};
const OPERATOR_EDITED = 'CLAUDE.md';

function staleClaims() {
  const files = spawnSync('git', ['ls-files', '-z', '--', '*.md', '*.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(files.status, 0, files.stderr);
  const hits = new Map();
  for (const f of files.stdout.split('\0').filter(Boolean)) {
    if (/(^|\/)(test|fixtures)\//.test(f)) continue;
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const m of text.matchAll(/\bNode(?:\.js)? ?(?:≥|>=) ?v?(\d+)/g)) {
      if (Number(m[1]) < floor.version[0]) hits.set(f, [...(hits.get(f) || []), m[0]]);
    }
  }
  return hits;
}

test('no tracked doc or module states a Node floor below the declared one', () => {
  const hits = staleClaims();
  for (const f of Object.keys(EXEMPT)) assert.ok(hits.has(f), `exemption for ${f} no longer matches anything; remove it`);
  const stale = [...hits].filter(([f]) => !(f in EXEMPT) && f !== OPERATOR_EDITED);
  assert.deepEqual(stale, [], `restate these against package.json engines.node (${floor.range})`);
});

test(`${OPERATOR_EDITED} states the declared floor`, (t) => {
  if (staleClaims().has(OPERATOR_EDITED)) {
    t.skip(`${OPERATOR_EDITED} still states an older floor; agent instruction files are edited by the operator`);
  }
});
