// Depth applied by the runner (bin/commitwork.mjs depthGate), and every declared ladder consumed by
// the command it claims to grade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { depthGate } from '../commitwork.mjs';
import { loadProfiles } from '../../monitor/perf-tuning.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOC = {
  costClasses: { light: { minDepth: 1 }, 'very-heavy': { minDepth: 4 } },
  depthLevels: [1, 2, 3, 4, 5].map((level) => ({ level, label: `D${level}` })),
  scanners: { cheap: { cost: 'light' }, costly: { cost: 'very-heavy' }, graded: { cost: 'light', depthLadder: ['a', 'b'] } },
};
const at = (depth) => ({ depth: { value: depth, source: 'test' }, intensity: { value: 3, source: 'test' } });
const checks = [{ id: 'cheap' }, { id: 'costly' }, { id: 'graded' }, { id: 'undeclared' }];

test('below a lane\'s depth it is a noscan void naming the depth, never an omission', () => {
  const g = depthGate(checks, { levels: at(3), overrides: {}, doc: DOC });
  assert.deepEqual(g.runnable.map((c) => c.id), ['cheap', 'graded', 'undeclared']);
  assert.equal(g.voids.length, 1);
  assert.equal(g.voids[0].id, 'costly');
  assert.equal(g.voids[0].status, 'noscan');
  assert.equal(g.voids[0].coverageBasis, 'depth');
  assert.match(g.voids[0].reason, /depth 4/);
});

test('depth 5 runs every lane, which is what the runner did before depth was applied', () => {
  const g = depthGate(checks, { levels: at(5), overrides: {}, doc: DOC });
  assert.equal(g.voids.length, 0);
  assert.equal(g.runnable.length, checks.length);
});

test('overrides force a lane on below its depth and off above it', () => {
  const g = depthGate(checks, { levels: at(1), overrides: { costly: 'on', cheap: 'off' }, doc: DOC });
  assert.deepEqual(g.runnable.map((c) => c.id), ['costly', 'graded', 'undeclared']);
  assert.equal(g.voids[0].coverageBasis, 'override');
});

test('a check named explicitly runs whatever depth says', () => {
  const g = depthGate([{ id: 'costly' }], { levels: at(1), overrides: {}, doc: DOC, explicit: true });
  assert.equal(g.runnable.length, 1);
});

test('a graded lane gets its level in the environment', () => {
  const g = depthGate(checks, { levels: at(1), overrides: {}, doc: DOC });
  assert.deepEqual(g.plans.get('graded').env, { CW_DEPTH_LEVEL: 'a', CW_DEPTH_RANK: '1' });
});

test('an unreadable model runs every lane and says depth was not applied', () => {
  const prev = process.env.CW_PERF_PROFILES;
  process.env.CW_PERF_PROFILES = join(tmpdir(), 'no-such-profiles.json');
  try {
    const g = depthGate(checks, { levels: at(1), overrides: {} });
    assert.equal(g.runnable.length, checks.length);
    assert.match(g.warning, /depth NOT applied/);
  } finally {
    if (prev === undefined) delete process.env.CW_PERF_PROFILES; else process.env.CW_PERF_PROFILES = prev;
  }
});

// A ladder the command ignores would put "ran at level owasp" on a row that ran everything. So each
// graded lane's REAL command is run through sh with its tool replaced by a function that records its
// argv, once per level and once with no level at all.
function renderedArgs(check, rank) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ladder-'));
  const out = join(dir, 'argv');
  const stubs = (check.requires?.tools || []).map((t) => `${t}() { printf '%s\\n' "$@" >> "${out}"; printf -- '--\\n' >> "${out}"; }`).join('; ');
  try {
    for (const cmd of check.local) {
      const env = { PATH: process.env.PATH, CW_REPORT_DIR: dir, CW_ROOT: ROOT, ...(rank ? { CW_DEPTH_RANK: String(rank) } : {}) };
      const r = spawnSync('sh', ['-c', `${stubs}; ${cmd}`], { env, cwd: dir, encoding: 'utf8' });
      assert.equal(r.error, undefined);
    }
    return existsSync(out) ? readFileSync(out, 'utf8').split(dir).join('<report-dir>') : '';
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('every declared depth ladder changes what its command runs, and its top is the unladdered run', () => {
  const doc = loadProfiles();
  const sb = JSON.parse(readFileSync(join(ROOT, 'manifests/security-baseline.json'), 'utf8'));
  const graded = Object.entries(doc.scanners).filter(([, s]) => Array.isArray(s.depthLadder));
  assert.ok(graded.length >= 2, 'the shipped model declares the sast and secrets ladders');
  for (const [id, s] of graded) {
    const check = sb.checks.find((c) => c.id === id);
    assert.ok(check, `${id} declares a ladder but no check runs it`);
    assert.match(check.local.join('\n'), /CW_DEPTH_(RANK|LEVEL)/, `${id} declares a ladder its command never reads`);
    const byRank = s.depthLadder.map((_, i) => renderedArgs(check, i + 1));
    assert.equal(new Set(byRank).size, byRank.length, `${id}: two levels render the same invocation`);
    assert.equal(renderedArgs(check, null), byRank[byRank.length - 1], `${id}: with no level set, the command must run its top level`);
  }
});

test('the top levels are the invocations these lanes had before ladders', () => {
  const sb = JSON.parse(readFileSync(join(ROOT, 'manifests/security-baseline.json'), 'utf8'));
  const sast = renderedArgs(sb.checks.find((c) => c.id === 'sast'), 3).split('\n');
  for (const pack of ['p/default', 'p/owasp-top-ten', 'p/security-audit', join(ROOT, 'manifests/semgrep-taint')]) assert.ok(sast.includes(pack), `sast full level lost ${pack}`);
  assert.ok(!renderedArgs(sb.checks.find((c) => c.id === 'sast'), 1).split('\n').includes('p/security-audit'));
  assert.ok(!renderedArgs(sb.checks.find((c) => c.id === 'secrets'), 2).includes('--max-depth'), 'secrets full level walks the whole history');
  assert.ok(renderedArgs(sb.checks.find((c) => c.id === 'secrets'), 1).includes('--max-depth=1000'));
});
