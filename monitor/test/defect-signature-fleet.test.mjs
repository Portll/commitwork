// node --test monitor/test/defect-signature-fleet.test.mjs — the population floor is fleet-wide.
// An area holds one or two repositories, so per-area artifacts never reach it; pooling every
// declared area's artifact is what lets a detector at rate 1 everywhere be judged at all.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { poolSignatures, readAreaSignatures, defectSignatures, FLEET_ARTIFACT } from '../defect-signature.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const AT = '2026-10-18T00:00:00.000Z';

afterEach(() => { delete process.env.CW_DEFECT_SIGNATURE_RATE; delete process.env.CW_DEFECT_SIGNATURE_MIN_REPOS; });

// One area artifact: `n` repos scanned by cspm, `firing` of them positive on the approvals control.
function areaArtifact(n, firing = n) {
  const repos = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const name = `repo-${String(i).padStart(2, '0')}`;
    repos.push({ name, scanners: { cspm: { ran: true } } });
    if (i < firing) rows.push({ repo: name, control: 'approvals', resource: 'repo', sev: 'high' });
  }
  return defectSignatures({ repos, scannerFindings: { cspm: rows } }, {}, { at: AT });
}

const perArea = (counts) => counts.map(([n, firing], i) => ({ area: `area-${i}`, artifact: areaArtifact(n, firing) }));

test('the per-area artifact says it is an area and that the floor is fleet-wide', () => {
  const a = areaArtifact(2);
  assert.equal(a.scope, 'area');
  assert.match(a.note, /floor is applied fleet-wide/);
  assert.deepEqual(a.signatures, [], '2 of 2 is below the floor on its own');
});

test('1/1, 2/2 and 18/18 pool to 21/21 over the floor: a signature the areas alone could not state', () => {
  const art = poolSignatures(perArea([[1], [2], [18]]), {}, { at: AT });
  assert.equal(art.scope, 'fleet');
  assert.deepEqual(art.pooledFrom, ['area-0', 'area-1', 'area-2']);
  assert.deepEqual(art.population, { cspm: 21 });
  assert.deepEqual(art.signatures, [{ detector: 'cspm/approvals', lane: 'cspm', rate: 1, population: 21, positives: 21, signature: true }]);
  assert.deepEqual(art.areas, { declared: 3, read: 3, absent: 0, failed: 0 });
});

test('one area at 1/5 pulls the pooled rate under the threshold: 22/26, no signature, rate still published', () => {
  const art = poolSignatures(perArea([[1], [2], [18], [5, 1]]), {}, { at: AT });
  assert.deepEqual(art.signatures, []);
  const d = art.detectors.find((x) => x.detector === 'cspm/approvals');
  assert.equal(d.population, 26);
  assert.equal(d.positives, 22);
  assert.equal(d.rate, 0.8462);
  assert.equal(d.signature, false);
});

test('an area that ran the lane but where the detector never fired is in the denominator', () => {
  const clean = defectSignatures({ repos: [{ name: 'r', scanners: { cspm: { ran: true } } }], scannerFindings: { cspm: [] } }, {}, { at: AT });
  const art = poolSignatures([...perArea([[20]]), { area: 'quiet', artifact: clean }], {}, { at: AT });
  const d = art.detectors.find((x) => x.detector === 'cspm/approvals');
  assert.equal(d.population, 21);
  assert.equal(d.positives, 20);
  assert.equal(d.signature, true, '20/21 is 0.9524, over 0.95');
});

test('thresholds are read from the environment at CALL time', () => {
  const areas = perArea([[1], [2], [3]]);
  assert.deepEqual(poolSignatures(areas, {}, { at: AT }).signatures, []);
  process.env.CW_DEFECT_SIGNATURE_MIN_REPOS = '6';
  assert.equal(poolSignatures(areas, {}, { at: AT }).signatures.length, 1);
  process.env.CW_DEFECT_SIGNATURE_RATE = '1.5';
  assert.throws(() => poolSignatures(areas, {}, { at: AT }), RangeError);
});

test('a malformed per-area artifact throws naming its area, never pools', () => {
  assert.throws(() => poolSignatures([{ area: 'torn', artifact: { detectors: [] } }]), /area 'torn'.*population/);
  assert.throws(() => poolSignatures([{ area: 'torn', artifact: { population: { cspm: 'many' }, detectors: [] } }]), /area 'torn'.*not a count/);
});

function fleetRoot(areas) {
  const root = mkdtempSync(join(tmpdir(), 'cw-defsig-fleet-'));
  const reg = { reportsRoot: root, areas: [] };
  areas.forEach((content, i) => {
    const slug = `area-${i}`;
    reg.areas.push({ slug });
    if (content === null) return;
    mkdirSync(join(root, slug));
    writeFileSync(join(root, slug, FLEET_ARTIFACT), typeof content === 'string' ? content : JSON.stringify(content));
  });
  return { root, reg };
}

test('readAreaSignatures: ENOENT is absent and pooling continues; a torn artifact throws and names the area', () => {
  const ok = fleetRoot([areaArtifact(1), null, areaArtifact(2)]);
  const r = readAreaSignatures(ok.reg, { root: ok.root });
  assert.deepEqual(r.areas, { declared: 3, read: 2, absent: 1, failed: 0 });
  assert.deepEqual(r.perArea.map((p) => p.area), ['area-0', 'area-2']);
  const torn = fleetRoot([areaArtifact(1), '{not json', areaArtifact(2)]);
  assert.throws(() => readAreaSignatures(torn.reg, { root: torn.root }), /area-1.*defect-signatures\.json/s);
});

test('pooled output is byte-identical whatever order the areas arrive in', () => {
  const a = perArea([[1], [2], [18]]);
  assert.equal(JSON.stringify(poolSignatures(a, {}, { at: AT })), JSON.stringify(poolSignatures([...a].reverse(), {}, { at: AT })));
});

test('CLI --fleet: reads each declared area through the registry, writes atomically where CW_DEFECT_SIGNATURES_OUT says, byte-identical under CW_NOW', () => {
  const { root, reg } = fleetRoot([areaArtifact(1), null, areaArtifact(2), areaArtifact(18)]);
  const regPath = join(root, 'projects.json');
  writeFileSync(regPath, JSON.stringify({ ...reg, areas: reg.areas.map((a, i) => ({ ...a, ...(i === 0 ? { primary: true } : {}) })) }));
  const out = join(root, 'fleet-out', FLEET_ARTIFACT);
  mkdirSync(dirname(out));
  const env = { ...process.env, CW_NOW: AT, CW_REGISTRY: regPath, CW_DEFECT_SIGNATURES_OUT: out, CW_SELF_SWEEP: '0' };
  delete env.CW_REGISTRY_REQUIRE_REAL;
  const run = (...args) => spawnSync(process.execPath, [join(CW, 'monitor', 'defect-signature.mjs'), '--fleet', ...args], { env, encoding: 'utf8' });
  const j = run('--json');
  assert.equal(j.status, 0, j.stderr);
  const printed = JSON.parse(j.stdout);
  assert.equal(printed.scope, 'fleet');
  assert.equal(printed.at, AT);
  assert.deepEqual(printed.areas, { declared: 4, read: 3, absent: 1, failed: 0 });
  assert.deepEqual(printed.signatures.map((s) => `${s.detector} ${s.positives}/${s.population}`), ['cspm/approvals 21/21']);
  assert.ok(!existsSync(out), '--json writes nothing');
  const w1 = run();
  assert.equal(w1.status, 0, w1.stderr);
  assert.match(w1.stdout, /SIGNATURE cspm\/approvals  21\/21/);
  const first = readFileSync(out, 'utf8');
  assert.equal(first, j.stdout);
  assert.equal(run().status, 0);
  assert.equal(readFileSync(out, 'utf8'), first);
  writeFileSync(join(root, 'area-2', FLEET_ARTIFACT), '{torn');
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /area-2/);
  assert.equal(readFileSync(out, 'utf8'), first, 'a failed run leaves the last good artifact in place');
  const usage = run('--whatever');
  assert.equal(usage.status, 2);
});

test('an older artifact whose positives exceed its population pools to undetermined, with both numbers kept and no rate', () => {
  const stale = { at: AT, scope: 'area', thresholds: { rate: 0.95, minRepos: 20 }, population: { depsRustAudit: 0 },
    detectors: [{ detector: 'depsRustAudit/RUSTSEC-1', lane: 'depsRustAudit', id: 'RUSTSEC-1', population: 0, positives: 1, rate: null, signature: false }], signatures: [], unkeyed: {} };
  const fresh = { ...stale, population: { depsRustAudit: 2 }, detectors: [{ ...stale.detectors[0], population: 2, positives: 2, rate: 1 }] };
  const art = poolSignatures([{ area: 'old', artifact: stale }, { area: 'new', artifact: fresh }], {}, { at: AT });
  const d = art.detectors[0];
  assert.equal(d.positives, 3);
  assert.equal(d.population, 2);
  assert.equal(d.rate, null);
  assert.equal(d.signature, false);
  assert.match(d.undetermined, /positives exceed/);
  assert.deepEqual(art.undetermined, ['depsRustAudit/RUSTSEC-1']);
  assert.deepEqual(art.signatures, []);
  assert.deepEqual(poolSignatures(perArea([[21]]), {}, { at: AT }).undetermined, [], 'a consistent pool has nothing undetermined');
});
