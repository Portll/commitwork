// sitemap/build-fixture.mjs — the S0 fixture wrapper. Run the REAL, unmodified script from a
// scratch tree so its hardcoded output path (<script dir>/data/fixture.sitemap.json) lands in a temp
// dir, never in the checkout. Registry and fleet are synthetic and in temp dirs (CW_REGISTRY).
//
// Known property NOT asserted, because it is false: byte-identical reruns. manifest() stamps
// `generated: new Date()` with no CW_NOW hook, so two runs differ in that one field. The test below
// asserts everything else is identical and that `generated` is the only difference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'cw-fixture-'));
  mkdirSync(join(root, 'sitemap'));
  for (const f of ['build-fixture.mjs', 'harvest.mjs']) copyFileSync(join(REPO, 'sitemap', f), join(root, 'sitemap', f));
  for (const d of ['monitor', 'lib', 'schema']) symlinkSync(join(REPO, d), join(root, d));
  const fleet = join(root, 'fleet');
  const svc = join(fleet, 'svc-a');
  mkdirSync(join(svc, 'src'), { recursive: true });
  writeFileSync(join(svc, 'package.json'), '{"name":"svc-a"}\n');
  writeFileSync(join(svc, 'src', 'index.js'), "export function hello(){ return fetch('https://example.invalid/api'); }\n");
  const registry = (projects) => { const p = join(root, 'projects.json'); writeFileSync(p, JSON.stringify({ projects })); return p; };
  const run = (args, reg) => spawnSync(process.execPath, [join(root, 'sitemap', 'build-fixture.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, CW_REGISTRY: reg, CW_SITEMAP_FLEET: 'teamA', CW_SELF_SWEEP: '0' }, timeout: 60000 });
  const out = join(root, 'sitemap', 'data', 'fixture.sitemap.json');
  return { root, fleet, registry, run, out, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const goodRegistry = (s) => s.registry([{ name: 'teamA', path: s.fleet }, { name: 'teamA-buildout', path: s.fleet }]);

test('refuses with usage (exit 2) when no service is named, and writes nothing', () => {
  const s = scratch();
  try {
    const r = s.run([], goodRegistry(s));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage: node sitemap\/build-fixture\.mjs <service-dir>/);
    assert.ok(!existsSync(s.out), 'a refusal must not leave a fixture behind');
  } finally { s.cleanup(); }
});

test('refuses (exit 1, stated reason) when the fleet is not in the registry or not on disk — never an empty fixture', () => {
  const s = scratch();
  try {
    let r = s.run(['svc-a'], s.registry([{ name: 'other', path: s.fleet }]));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CW_SITEMAP_FLEET \(teamA\) names no project path/);
    assert.ok(!existsSync(s.out));
    r = s.run(['svc-a'], s.registry([{ name: 'teamA', path: join(s.root, 'no-such-dir') }]));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CW_SITEMAP_FLEET \(teamA\) names no project path/);
    assert.ok(!existsSync(s.out));
  } finally { s.cleanup(); }
});

test('fails closed on an unreadable registry: missing or corrupt is a nonzero exit, not an empty fleet', () => {
  const s = scratch();
  try {
    const bad = join(s.root, 'bad.json');
    writeFileSync(bad, '{not json');
    for (const reg of [bad, join(s.root, 'absent.json')]) {
      const r = s.run(['svc-a'], reg);
      assert.notEqual(r.status, 0, `exit ${r.status} for ${reg}`);
      assert.ok(!existsSync(s.out), 'no fixture may be written from an unreadable registry');
    }
  } finally { s.cleanup(); }
});

test('builds the fixture shape its consumer reads, from a real harvest of the named service', () => {
  const s = scratch();
  try {
    const r = s.run(['svc-a', 'not-in-fleet'], goodRegistry(s));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /fixture: skip not-in-fleet \(not in fleet\)/, 'a missing service is skipped aloud');
    const m = JSON.parse(readFileSync(s.out, 'utf8'));
    assert.equal(m.schemaVersion, 2);
    assert.equal(m.project, 'teamA');
    assert.equal(m.generator.tool, 'sitemap/build-fixture.mjs');
    assert.equal(m.generator.fixture, true);
    assert.deepEqual(m.services.map((x) => x.name), ['svc-a'], 'only the present service is harvested');
    assert.ok(Array.isArray(m.externalLinks));
    assert.ok(m.provenance.files.scanned >= 2, `provenance.files.scanned = ${m.provenance.files.scanned}`);
    assert.match(r.stdout, /fixture: 1 services · \d+ files/);
    assert.ok(readFileSync(s.out, 'utf8').endsWith('\n'));
  } finally { s.cleanup(); }
});

test('rerun overwrites in place and is identical except for the generated timestamp', () => {
  const s = scratch();
  try {
    const reg = goodRegistry(s);
    assert.equal(s.run(['svc-a'], reg).status, 0);
    const a = JSON.parse(readFileSync(s.out, 'utf8'));
    assert.equal(s.run(['svc-a'], reg).status, 0);
    const b = JSON.parse(readFileSync(s.out, 'utf8'));
    assert.ok(!Number.isNaN(Date.parse(a.generated)) && !Number.isNaN(Date.parse(b.generated)));
    delete a.generated; delete b.generated;
    assert.deepEqual(a, b);
  } finally { s.cleanup(); }
});
