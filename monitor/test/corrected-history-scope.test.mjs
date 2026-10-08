// monitor/corrected-history.mjs — which area it may run over, and what it may claim about repos
// it never scanned. OUT resolves through area.mjs (never a literal guess), and an exclusion is
// published with ITS OWN reason and an unknown surface — a wrong reason is worse than no reason.

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
const SCRIPT = path.join(ROOT, 'monitor', 'corrected-history.mjs');

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-corrhist-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const exec = (env, { unset = [] } = {}) => {
  const e = { ...process.env, ...env };
  for (const k of unset) delete e[k];
  return run('node', [SCRIPT], { env: e })
    .then((r) => ({ code: 0, ...r }), (x) => ({ code: x.code, stdout: x.stdout || '', stderr: x.stderr || '' }));
};

// A self-contained fixture: its own registry, its own report dir, its own services tree.
// `slug` is the one area the registry declares; `historyIn` is the report dir the slices are seeded in.
function fixture(name, { exclude, excludeNote, excludeReasons, slug = 'client-a', historyIn = 'fixture-area', extraAreas = [] }) {
  const dir = path.join(tmp, name);
  const reports = path.join(dir, 'reports');
  const out = path.join(reports, historyIn);
  const services = path.join(dir, 'services');
  fs.mkdirSync(path.join(out, 'history'), { recursive: true });
  fs.mkdirSync(path.join(services, 'svc-scanned'), { recursive: true });
  fs.writeFileSync(path.join(services, 'svc-scanned', 'package.json'), '{}');

  const stamp = '20260706152532'; // >= EXCLUDED_FROM, so excluded rows are emitted
  fs.writeFileSync(path.join(out, 'history', 'index.json'),
    JSON.stringify([{ stamp, file: `${stamp}.json`, generated: '2026-07-06T15:25:32Z', total: 0 }]));
  fs.writeFileSync(path.join(out, 'history', `${stamp}.json`), JSON.stringify({
    sliceVersion: 1, sliceId: `sweep-${stamp}`, source: `sweep-${stamp}`,
    generated: '2026-07-06T15:25:32Z', toolRuns: { 'svc-scanned': { osv: 1 } }, findings: [],
  }));

  const registry = path.join(dir, 'projects.json');
  fs.writeFileSync(registry, JSON.stringify({
    reportsRoot: path.relative(ROOT, reports),
    // slug with out 'fixture-area' — slug and out differ on purpose; area.mjs resolves the split
    areas: [{ slug, label: 'Fixture', out: 'fixture-area', primary: true, members: ['svc-scanned'] }, ...extraAreas],
    exclude, ...(excludeNote ? { excludeNote } : {}), ...(excludeReasons ? { excludeReasons } : {}),
    projects: [],
  }, null, 1));

  return { out, services, registry, stamp };
}

const excludedRows = (out, stamp) => {
  const doc = JSON.parse(fs.readFileSync(path.join(out, 'history', 'corrected', 'index.json'), 'utf8'));
  const slice = doc.slices.find((s) => s.stamp === stamp);
  return Object.fromEntries(Object.entries(slice.repos).filter(([, v]) => v.state === 'excluded'));
};

describe('the area it may run over', () => {
  test('a declared area that is NOT client-a is refused, not silently reclassified', async () => {
    // The second area is synthetic: the refusal is the tool's behaviour over any registry, so it
    // must not depend on the private fleet registry existing.
    const f = fixture('foreign', { exclude: [], extraAreas: [{ slug: 'fixture-other', label: 'Other', out: 'fixture-other-out' }] });
    const reg = JSON.parse(fs.readFileSync(f.registry, 'utf8'));
    const other = (reg.areas || []).find((a) => a.slug !== 'client-a');
    assert.ok(other, 'the registry declares a second area to test against');
    const dir = path.join(ROOT, reg.reportsRoot || 'reports', other.out || other.slug);

    // CW_FLEET_SERVICES_DIR unset, so a refusal that came after the services lookup would fail on it
    const r = await exec({ CW_MONITOR_OUT: dir, CW_REGISTRY: f.registry }, { unset: ['CW_FLEET_SERVICES_DIR'] });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stderr || r.stdout}`);
    assert.match(r.stderr, new RegExp(`'${other.slug}'`), 'names the area it refused');
    assert.match(r.stderr, /client-a\/services/, 'says WHY — the surface map it would have misapplied');
    // the refusal must not depend on having a client-a checkout
    assert.doesNotMatch(r.stderr, /client-a\/services not found/);
  });

  test('a scratch dir is still a legitimate override — this is not a lockout', async () => {
    const f = fixture('scratch', { exclude: [] });
    const r = await exec({ CW_MONITOR_OUT: f.out, CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(f.out, 'history', 'corrected', 'index.json')));
  });

  test('an undeclared client-a with no CW_MONITOR_OUT is refused, not derived into <reportsRoot>/client-a', async () => {
    // Slices seeded exactly where the old fallback would have looked, so the pre-fix code had
    // something to derive and wrote history/corrected/ there with exit 0.
    const f = fixture('undeclared', { exclude: [], slug: 'other-area', historyIn: 'client-a' });
    const r = await exec({ CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services }, { unset: ['CW_MONITOR_OUT'] });
    assert.equal(r.code, 2, `expected a refusal, got ${r.code}: ${r.stderr || r.stdout}`);
    assert.match(r.stderr, /declares no 'client-a' area/);
    assert.match(r.stderr, /CW_MONITOR_OUT/, 'names the explicit override that would be accepted');
    assert.ok(!fs.existsSync(path.join(f.out, 'history', 'corrected')), 'nothing may be written to the guessed dir');
  });

  test('an undeclared client-a with an explicit CW_MONITOR_OUT still runs — the override is the declaration', async () => {
    const f = fixture('undeclared-override', { exclude: [], slug: 'other-area', historyIn: 'client-a' });
    const r = await exec({ CW_MONITOR_OUT: f.out, CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(f.out, 'history', 'corrected', 'index.json')));
  });

  test('no residual output-dir literal — the guess area.mjs refuses to make', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const code = src.split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .filter((l) => !/citations:|note: '/.test(l))   // RECLASS entries cite historic paths as prose
      .join('\n');
    assert.doesNotMatch(code, /monitorOutput\s*\|\|\s*['"]client-a-monorepo['"]/,
      'OUT must resolve through area.mjs, which throws rather than guess a report directory');
    assert.match(src, /from '\.\/area\.mjs'/, 'must import the resolver rather than re-derive it');
  });
});

describe('what it may claim about an excluded repo', () => {
  test('a non-Eureka exclusion is not published with the Eureka justification', async () => {
    const f = fixture('mixed', {
      exclude: ['svc-config', 'psiTurk'],
      excludeNote: 'psiTurk: upstream third-party fork, last commit 2012. svc-config: client-a infra.',
      excludeReasons: { 'svc-config': 'retired Eureka pair — jackson-databind MEDs still present in tree, out of scan scope' },
    });
    const r = await exec({ CW_MONITOR_OUT: f.out, CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services });
    assert.equal(r.code, 0, r.stderr);
    const rows = excludedRows(f.out, f.stamp);

    assert.match(rows['svc-config'].note, /Eureka pair/, 'the registry\'s per-repo reason is the one published for that repo');
    assert.doesNotMatch(rows.psiTurk.note, /Eureka|jackson-databind/,
      'psiTurk is a 2012 Python fork — a jackson-databind justification is fabricated');
    assert.match(rows.psiTurk.note, /excludeNote/, 'it must point at where the real reason lives');
  });

  test('an unmeasured build surface is "unknown", never asserted as gradle', async () => {
    const f = fixture('surface', { exclude: ['psiTurk'], excludeNote: 'x' });
    const r = await exec({ CW_MONITOR_OUT: f.out, CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(excludedRows(f.out, f.stamp).psiTurk.surface, 'unknown',
      'the old default claimed a JVM build surface for repos whose tree was never read');
  });

  test('with NO reason recorded anywhere, it says so rather than inventing one', async () => {
    const f = fixture('noreason', { exclude: ['layingpipe'] });   // exclude, but no excludeNote
    const r = await exec({ CW_MONITOR_OUT: f.out, CW_REGISTRY: f.registry, CW_FLEET_SERVICES_DIR: f.services });
    assert.equal(r.code, 0, r.stderr);
    const note = excludedRows(f.out, f.stamp).layingpipe.note;
    assert.match(note, /NO reason/, 'an exclusion with no reason is indistinguishable from an oversight');
    assert.doesNotMatch(note, /Eureka/);
  });
});
