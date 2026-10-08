// Tranche 1.1 — no fleet-wide default output directory, and no project name to fall back to when
// none resolves: a registry that declares nothing must produce a stated refusal naming no project,
// and the literal must not come back. Registry resolution is read at MODULE LOAD, so tests that
// need a different registry run in a subprocess.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registryPathFor } from '../store-paths.mjs';
import { fileURLToPath } from 'node:url';
import { outNameFor, outDirFor } from '../area.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// The ratchets on the live registry need the private fleet registry, which a clean checkout does
// not have. Only its absence skips them — ENOENT, with no CW_REGISTRY naming it — so an unreadable
// or unparseable registry still fails.
const LIVE_PATH = registryPathFor(ROOT);
const LIVE = (() => {
  try { return JSON.parse(fs.readFileSync(LIVE_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_REGISTRY) return null; throw e; }
})();
const NO_LIVE = LIVE ? undefined
  : `private registry absent: ${LIVE_PATH} does not exist, so the live-registry ratchets have no subject`;

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ambient-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A registry file on disk, for the subprocess tests. `roots: []` + `projects: []` keeps
// discover.mjs from walking the machine.
function registryFile(name, extra) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'projects.json');
  fs.writeFileSync(p, JSON.stringify({
    reportsRoot: path.relative(ROOT, path.join(dir, 'reports')),
    roots: [], projects: [], ...extra,
  }, null, 1));
  return p;
}

const runNode = (args, env) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};

describe('the registry itself', { skip: NO_LIVE }, () => {
  test('monitor/projects.json declares NO top-level monitorOutput', () => {
    assert.equal(LIVE.monitorOutput, undefined,
      'a top-level monitorOutput is a fleet-wide default output dir that outranks areas[].primary — '
      + 'declare `primary: true` on an area instead (see the registry note, and area.mjs rung 3)');
  });

  test('the primary area is what declares the ambient output dir', () => {
    const primary = (LIVE.areas || []).filter((a) => a.primary);
    assert.equal(primary.length, 1, 'exactly one area may be primary — it is now the ONLY ambient declaration');
    assert.equal(outNameFor(null, LIVE), primary[0].out || primary[0].slug);
  });
});

describe('an area that does not resolve is a refusal, never a project name', () => {
  test('outNameFor throws, and its reason names no project', () => {
    const bare = { reportsRoot: 'reports' };
    assert.throws(() => outNameFor(null, bare), (e) => {
      assert.match(e.message, /declares no areas\[\] and no monitorOutput/);
      assert.doesNotMatch(e.message, /clientA|clientA/i,
        'substituting a project name IS the bug — the message must not even suggest one');
      return true;
    });
    assert.throws(() => outDirFor(null, bare), /cannot resolve a report directory/);
  });

  test('an areas[]-only registry resolves the primary area, not a literal', () => {
    const reg = { reportsRoot: 'reports', areas: [{ slug: 'beta', out: 'beta-out' }, { slug: 'alpha', out: 'alpha-out', primary: true }] };
    assert.equal(outNameFor(null, reg), 'alpha-out');
    assert.equal(outNameFor('beta', reg), 'beta-out');
  });

  test('sweep.mjs refuses rather than write into a guessed directory', () => {
    const reg = registryFile('sweep-noareas', {});
    const r = runNode(['monitor/sweep.mjs', 'fast', '--dry'], { CW_REGISTRY: reg, CW_MONITOR_OUT: '' });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /cannot resolve a report directory/);
    assert.doesNotMatch(r.stderr + r.stdout, /clientA-monorepo/,
      'the refusal must not name the directory it used to guess');
  });

  test('backfill-dimensions.mjs refuses, and writes nothing', () => {
    const reg = registryFile('backfill-noareas', {});
    const before = fs.existsSync(path.join(ROOT, 'reports', 'clientA-monorepo'))
      ? fs.readdirSync(path.join(ROOT, 'reports', 'clientA-monorepo')).length : null;
    const r = runNode(['monitor/backfill-dimensions.mjs'], { CW_REGISTRY: reg, CW_MONITOR_OUT: '' });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /cannot resolve a report directory/);
    assert.doesNotMatch(r.stderr, /clientA/);
    const after = fs.existsSync(path.join(ROOT, 'reports', 'clientA-monorepo'))
      ? fs.readdirSync(path.join(ROOT, 'reports', 'clientA-monorepo')).length : null;
    assert.equal(after, before, 'a refusing run must not have created or touched the old default dir');
  });

  test('retro-ledger.mjs refuses — a remediation ledger is the last artifact that may land in a guess', () => {
    const reg = registryFile('retro-noareas', {});
    const r = runNode(['monitor/retro-ledger.mjs'], { CW_REGISTRY: reg, CW_MONITOR_OUT: '' });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /cannot resolve a report directory/);
  });

  test('coverage-manifest.mjs refuses rather than file a coverage claim against another area', () => {
    const reg = registryFile('coverage-noareas', {});
    const r = runNode(['monitor/coverage-manifest.mjs'], { CW_REGISTRY: reg, CW_MONITOR_OUT: '' });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /cannot resolve a report directory/);
  });
});

describe('CRA evidence resolution', () => {
  // cra/lib.mjs deliberately does NOT import area.mjs (its ROOT is CW_CRA_ROOT-relative), so its
  // copy of the precedence chain needs its own pin. It reads ROOT at module load too.
  const craProbe = (root) => {
    const script = `
      const { resolvePaths } = await import(${JSON.stringify(path.join(ROOT, 'cra', 'lib.mjs'))});
      const p = resolvePaths();
      console.log(JSON.stringify({ areaOut: p.areaOut, areaVoid: p.areaVoid, rollup: p.rollup, historyIndex: p.historyIndex }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      // CW_REGISTRY cleared too. cra/lib.mjs no longer lets an ambient one outrank CW_CRA_ROOT
      // (cra/test/cra-root-registry.test.mjs pins that); clearing it keeps this probe independent of
      // that fix, so the fixture registry written below is the one read either way.
      env: { ...process.env, CW_CRA_ROOT: root, CW_REGISTRY: '', CW_ROLLUP: '', CW_LEDGER: '', CW_HISTORY: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };

  test('a registry with a primary area attributes evidence to THAT area', () => {
    const root = path.join(tmp, 'cra-declared');
    // Written through the same resolver the code under test reads with. Hardcoding
    // <root>/monitor/projects.json here made this fixture silently stop being read when the registry
    // moved to monitor/private/ — cra/lib.mjs defaults a missing registry to {}, so the probe kept
    // answering and the assertion changed meaning rather than failing loudly.
    fs.mkdirSync(path.dirname(registryPathFor(root, { ambient: false })), { recursive: true });
    fs.writeFileSync(registryPathFor(root, { ambient: false }), JSON.stringify({
      reportsRoot: 'reports', areas: [{ slug: 'alpha', out: 'alpha-out', primary: true }],
    }));
    const p = craProbe(root);
    assert.equal(p.areaOut, 'alpha-out');
    assert.equal(p.areaVoid, null);
    assert.match(p.rollup, /alpha-out[/\\]rollup\.json$/);
  });

  test('with nothing declared, evidence paths are NULL with a reason — never another area s files', () => {
    const root = path.join(tmp, 'cra-bare');
    fs.mkdirSync(path.dirname(registryPathFor(root, { ambient: false })), { recursive: true });
    fs.writeFileSync(registryPathFor(root, { ambient: false }), JSON.stringify({ reportsRoot: 'reports' }));
    const p = craProbe(root);
    assert.equal(p.areaOut, null);
    assert.equal(p.rollup, null, 'a null path is readable as "no evidence"; a guessed path is not');
    assert.equal(p.historyIndex, null);
    assert.match(p.areaVoid, /no areas\[\] and no monitorOutput/);
    assert.doesNotMatch(p.areaVoid, /clientA/i);
  });
});

describe('the literal cannot come back', () => {
  // code is what is checked — comments in those files may still explain the history
  const CODE = [
    'monitor/sweep.mjs', 'monitor/coverage-manifest.mjs', 'monitor/backfill-dimensions.mjs',
    'monitor/retro-ledger.mjs', 'monitor/verify-corrected.mjs', 'cra/lib.mjs',
  ];
  const uncommented = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

  for (const rel of CODE) {
    test(`${rel} resolves its output dir without naming a project`, () => {
      const code = uncommented(rel);
      assert.doesNotMatch(code, /monitorOutput\s*\|\|\s*['"]clientA-monorepo['"]/,
        'the OUT chain belongs to area.mjs (or, for cra/lib.mjs, ambientOutName) — both refuse rather than guess');
      assert.doesNotMatch(code, /['"]clientA-monorepo['"]/,
        'no report-directory literal: reports/clientA-monorepo is one customer\'s area, not a default');
      assert.doesNotMatch(code, /join\([^)]*['"]map['"],\s*['"]data['"],\s*['"]clientA['"]/,
        'map/data/ is slug space — resolve the ambient area\'s slug, never pin one project\'s map');
    });
  }

  test('monitor/*.mjs holds no bare join(...,"reports","clientA-monorepo")', () => {
    const dir = path.join(ROOT, 'monitor');
    const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).filter((f) => {
      const code = uncommented(path.join('monitor', f));
      return /['"]reports['"]\s*,\s*['"]clientA-monorepo['"]/.test(code);
    });
    assert.deepEqual(offenders, [], 'a bare join to one area\'s report dir bypasses the registry entirely');
  });
});

describe('what is NOT this defect', () => {
  // area-scoped tools whose subject IS clientA — removing their literal is the same defect with
  // the sign flipped
  test('corrected-history.mjs keeps its AREA_SLUG guard', () => {
    const src = fs.readFileSync(path.join(ROOT, 'monitor', 'corrected-history.mjs'), 'utf8');
    assert.match(src, /AREA_SLUG\s*=\s*'client-a'/,
      'deliberate (2026-08-03): it refuses to run against a foreign area because its reclassifications '
      + 'cite clientA commits and read the clientA service tree');
  });

  test('worklist-reconcile.mjs keeps its clientA modernization map', () => {
    const src = fs.readFileSync(path.join(ROOT, 'monitor', 'worklist-reconcile.mjs'), 'utf8');
    assert.match(src, /map', 'data', 'clientA'/,
      'program-worklist.json IS clientA\'s modernization programme (it also wires clientAGit) — '
      + 'reconciling it against the ambient area\'s map would compare two different projects');
  });
});

// The two ratchet assertions at the top are only worth anything against the real fleet registry.
test('the live registry was the one read (not a fixture)', { skip: NO_LIVE }, () => {
  assert.ok(Array.isArray(LIVE.areas) && LIVE.areas.length > 1,
    'this file asserts about monitor/projects.json itself — if it ever reads a fixture, the ratchet is decorative');
});
