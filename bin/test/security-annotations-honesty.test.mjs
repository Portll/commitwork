// bin/build-security-data.mjs + monitor/security-annotations*.json — editorial prose sits in the
// same table row as live counts, so it is read as a verdict ON those counts: contradicted prose
// must fail the run, one project's history must not caption another's table, and the generator's
// fallback rows carry no editorial verdict.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GEN = path.join(ROOT, 'bin', 'build-security-data.mjs');

let tmp;
// Per-area sidecars are private records; every run looks in a directory this suite owns, so the
// operator's real ones never enter a result. CW_SECURITY_ANNOTATIONS_DIR is where the generator looks.
let areaDir;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-secdata-'));
  areaDir = path.join(tmp, 'area-annotations');
  fs.mkdirSync(areaDir);
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
// `dir` names the report directory, which is how the generator picks a per-area sidecar.
function rollup(dir, findings) {
  const d = path.join(tmp, `case${n++}`, dir);
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, 'rollup.json');
  fs.writeFileSync(p, JSON.stringify({
    generated: '2026-08-03T00:00:00.000Z',
    totals: { repos: 1, crit: 0, high: findings.length, med: 0, low: 0, kev: 0, cves: findings.length },
    repos: [{ name: 'a-repo', findings }],
  }));
  return p;
}

const gen = async (rollupPath, annot) => {
  const out = { data: `${rollupPath}.data.json`, md: `${rollupPath}.md` };
  const args = [GEN, '--rollup', rollupPath, '--out-data', out.data, '--out-md', out.md];
  if (annot) args.push('--annot', annot);
  const r = await run('node', args, { env: { ...process.env, CW_SECURITY_ANNOTATIONS_DIR: areaDir } }).then((x) => ({ code: 0, ...x }), (e) => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  return { ...r, md: fs.readFileSync(out.md, 'utf8'), data: JSON.parse(fs.readFileSync(out.data, 'utf8')) };
};

const npmHighs = (k) => Array.from({ length: k }, (_, i) => ({ tool: 'npm-audit', severity: 'high', id: `CVE-x-${i}` }));

describe('prose that contradicts the scan does not get published', () => {
  test('the exact row from the audit is now a correction, not a verdict', async () => {
    const annot = path.join(tmp, 'stale.json');
    fs.writeFileSync(annot, JSON.stringify({
      surfaceOrder: ['npm'],
      rows: [{ surface: 'npm', label: 'npm / JavaScript', state: 'fully fixed (524 → 0)', asserts: { high: 0 } }],
      toolSurfaces: { 'npm-audit': 'npm' },
    }));
    const r = await gen(rollup('anywhere', npmHighs(13)), annot);

    assert.equal(r.code, 3, 'a contradicted claim must fail the run, not merely print');
    assert.match(r.md, /STALE PROSE/, 'the published table carries the correction');
    assert.doesNotMatch(r.md, /\| fully fixed \(524 → 0\) \|/, 'the false verdict must not survive into the artifact');
    assert.match(r.md, /\| 13 \|/, 'and the live count is still there beside it');
    assert.match(r.stderr, /prose asserts high=0, scan of record shows high=13/);
  });

  test('the artifacts are still written — silence would leave the stale version published', async () => {
    const annot = path.join(tmp, 'stale2.json');
    fs.writeFileSync(annot, JSON.stringify({
      surfaceOrder: ['npm'],
      rows: [{ surface: 'npm', label: 'npm', state: 'clean', asserts: { high: 0 } }],
      toolSurfaces: { 'npm-audit': 'npm' },
    }));
    const r = await gen(rollup('anywhere', npmHighs(2)), annot);
    assert.equal(r.code, 3);
    assert.ok(r.data.surfaces.npm.high === 2, 'security-data.json still emitted with the true numbers');
  });

  test('a claim the scan agrees with renders as written', async () => {
    const annot = path.join(tmp, 'true.json');
    fs.writeFileSync(annot, JSON.stringify({
      surfaceOrder: ['npm'],
      rows: [{ surface: 'npm', label: 'npm / JavaScript', state: 'fully fixed (524 → 0)', asserts: { high: 0 } }],
      toolSurfaces: { 'npm-audit': 'npm' },
    }));
    const r = await gen(rollup('anywhere', []), annot);
    assert.equal(r.code, 0);
    assert.match(r.md, /fully fixed \(524 → 0\)/);
    assert.doesNotMatch(r.md, /STALE PROSE/);
  });

  test('token-only prose needs no asserts and cannot contradict anything', async () => {
    const annot = path.join(tmp, 'tokens.json');
    fs.writeFileSync(annot, JSON.stringify({
      surfaceOrder: ['npm'],
      rows: [{ surface: 'npm', label: 'npm', state: '{high}H / {med}M' }],
      toolSurfaces: { 'npm-audit': 'npm' },
    }));
    const r = await gen(rollup('anywhere', npmHighs(4)), annot);
    assert.equal(r.code, 0);
    assert.match(r.md, /4H \/ 0M/);
  });
});

describe('editorial prose belongs to one project', () => {
  const shared = JSON.parse(fs.readFileSync(path.join(ROOT, 'monitor', 'security-annotations.json'), 'utf8'));
  assert.ok(Array.isArray(shared.rows) && shared.rows.length > 0, 'the shared sidecar carries no rows — the state-claim check below would pass having read none');

  test('the shared sidecar names no project and asserts no history', () => {
    const live = JSON.stringify({ ...shared, _comment: undefined, _history: undefined, _toolSurfacesNote: undefined, _notWired: undefined });
    assert.doesNotMatch(live, /524|jackson-databind|CVE-\d{4}-\d+/,
      'the fallback sidecar for every project must not carry one project\'s remediation history');
    for (const r of shared.rows) {
      assert.doesNotMatch(r.state.replace(/\{\w+\}/g, ''), /[a-z]{4,}/i,
        `shared row '${r.surface}' state "${r.state}" makes a claim; only token restatements belong here`);
    }
  });

  test('a per-area sidecar is picked up from the report directory name', async () => {
    fs.writeFileSync(path.join(areaDir, 'security-annotations.example-area.json'), JSON.stringify({
      _comment: 'synthetic per-area sidecar',
      surfaceOrder: ['npm'],
      rows: [{ surface: 'npm', label: 'npm / JavaScript', state: '{high}H / {med}M' }],
    }));
    const r = await gen(rollup('example-area', []));
    assert.match(r.stdout, /per-area \(security-annotations\.example-area\.json\)/);
  });

  test('an unknown report dir falls back to the shared defaults', async () => {
    const r = await gen(rollup('some-other-project', npmHighs(3)));
    assert.match(r.stdout, /annotations: shared defaults/);
    assert.equal(r.code, 0, 'neutral defaults make no claim, so they cannot be contradicted');
    assert.doesNotMatch(r.md, /fully fixed/, "another project's table must not say this project's fleet was fixed");
  });

  test('the generator\'s own fallback rows carry no editorial verdict', () => {
    const src = fs.readFileSync(GEN, 'utf8');
    const fallback = src.slice(src.indexOf('const rows = annot.rows ||'), src.indexOf('const totalLabel'));
    assert.doesNotMatch(fallback, /fully fixed/,
      'the hardcoded default asserted a remediation verdict for any fleet passed in');
  });
});

describe('a declared surface with no findings is unmeasured, not zero', () => {
  test('unseen tool mappings are reported rather than implied covered', async () => {
    const r = await gen(rollup('another-area', npmHighs(1)));
    const cov = r.data.toolSurfaceCoverage;
    assert.ok(cov, 'security-data.json must publish which mappings were reachable');
    assert.ok(cov.matched.includes('npm-audit'));
    assert.ok(cov.declaredButUnseen.includes('gitleaks'), 'a declared-but-absent tool is named');
    assert.match(r.stdout, /UNMEASURED here, not zero/);
  });

  test('deltas is gone rather than emitted as a permanent null', async () => {
    const r = await gen(rollup('another-area', []));
    assert.ok(!('deltas' in r.data),
      'no sidecar ever declared deltas, so the field was null forever — a capability made of its own docs');
  });
});
