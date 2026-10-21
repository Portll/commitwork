// The canary fixtures are only worth anything if they are still what they claim to be.
//
// A dirty fixture that gets tidied into a clean one is the dangerous failure: every lane would
// then "pass" by finding nothing in a file with nothing to find, and the fleet would report a
// green it did not earn. So this test never asks a scanner anything. It asserts the GROUND TRUTH
// — that each planted defect is physically present, that the clean tree carries none of them, and
// that the manifest and the trees agree in both directions.
//
// Scanner behaviour against these fixtures belongs in the sweep, not here: this file establishes
// the premise those results depend on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CW_CANARY_DIR
  || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'scan-canary');
const EXPECTED = JSON.parse(readFileSync(join(ROOT, 'EXPECTED.json'), 'utf8'));

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

describe('scan canaries — the fixtures are what they claim', () => {
  test('NOT VACUOUS: the manifest actually enumerates plants', () => {
    assert.ok(EXPECTED.dirty.plants.length >= 8,
      `a canary manifest with ${EXPECTED.dirty.plants.length} plants is not covering the lanes`);
    const lanes = new Set(EXPECTED.dirty.plants.map((p) => p.lane));
    for (const lane of ['secrets', 'dependency-cve', 'sast', 'container', 'ci-hygiene']) {
      assert.ok(lanes.has(lane), `no plant for the ${lane} lane — that lane's zero would prove nothing`);
    }
  });

  test('every planted defect is STILL PRESENT — a tidied fixture is a silent false negative', () => {
    for (const p of EXPECTED.dirty.plants) {
      const src = readFileSync(join(ROOT, p.file), 'utf8');
      for (const needle of p.mustMatch) {
        assert.ok(src.includes(needle),
          `plant ${p.id} has gone missing from ${p.file}: expected ${JSON.stringify(needle)}.\n` +
          `If this was deliberate, remove it from EXPECTED.json too — a plant that exists only in ` +
          `the manifest makes the ${p.lane} lane look tested when it is not.`);
      }
    }
  });

  test('every plant names a file that exists, and every dirty file is accounted for', () => {
    for (const p of EXPECTED.dirty.plants) {
      assert.ok(statSync(join(ROOT, p.file)).isFile(), `${p.id} names a missing file: ${p.file}`);
    }
    // the reverse direction: a source file carrying no declared plant is either dead weight or an
    // undeclared defect, and both are worth failing on
    const declared = new Set(EXPECTED.dirty.plants.map((p) => p.file));
    // a plant's furniture (a SavedModel's variables/ and fingerprint.pb) is declared as support:
    // present by requirement, needle-free by nature, and never also a plant
    const support = new Set(EXPECTED.dirty.support || []);
    for (const s of support) {
      assert.ok(statSync(join(ROOT, s)).isFile(), `support file ${s} is declared but missing`);
      assert.ok(!declared.has(s), `${s} is listed as both a plant and a support file — pick one`);
    }
    const exempt = /(README\.md)$/;
    for (const abs of walk(join(ROOT, 'dirty'))) {
      const rel = relative(ROOT, abs);
      if (exempt.test(rel) || support.has(rel)) continue;
      assert.ok(declared.has(rel), `${rel} is in the dirty tree but declares no plant in EXPECTED.json`);
    }
  });

  test('the CLEAN tree carries none of the dirty markers', () => {
    const needles = EXPECTED.dirty.plants.flatMap((p) => p.mustMatch);
    for (const abs of walk(join(ROOT, 'clean'))) {
      const src = readFileSync(abs, 'utf8');
      for (const n of needles) {
        assert.ok(!src.includes(n),
          `${relative(ROOT, abs)} contains ${JSON.stringify(n)} — the clean canary is not clean, so ` +
          `any zero it produces is meaningless`);
      }
    }
  });

  test('the clean tree is a real repository, not an empty directory', () => {
    // A canary that is merely absent scans clean for the wrong reason. It has to be plausible
    // input: a manifest, a lockfile, source, a container definition and a workflow — the same
    // surfaces the dirty tree offends on, so a lane's silence is about the CONTENT.
    for (const f of ['package.json', 'package-lock.json', 'src/index.mjs', 'Dockerfile', '.github/workflows/ci.yml', 'LICENSE']) {
      const p = join(ROOT, 'clean', f);
      assert.ok(statSync(p).isFile(), `clean canary is missing ${f}`);
      assert.ok(readFileSync(p, 'utf8').trim().length > 0, `clean canary's ${f} is empty`);
    }
    const surfaces = new Set(EXPECTED.dirty.plants.map((p) => p.file.split('/')[1]));
    for (const s of surfaces) {
      assert.ok(readdirSync(join(ROOT, 'clean')).includes(s) || s === 'src',
        `the dirty tree offends on "${s}" but the clean tree has no equivalent surface, so that lane ` +
        `has no negative control`);
    }
  });

  test('the self-scan exclusion is declared, and says what is still missing', () => {
    const ex = EXPECTED.selfScanExclusions;
    assert.ok(ex.paths.length > 0, 'no self-scan exclusion declared — these plants would poison commitwork\'s own posture');
    assert.ok(Array.isArray(ex.outstanding),
      'the exclusion block must state which lanes are NOT yet excluded; an exclusion list that ' +
      'implies completeness it does not have is the same defect class as a false clean');
  });
});
