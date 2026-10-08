// monitor/test/lane-capability.test.mjs — behaviour-vs-declaration for the lane roster.
//
// The classifications asserted here are MEASURED states of the current roster. When a stub
// graduates (a real parser lands, as clippy's did 2026-08-26), the classification flips in the
// lens without any lens edit — and the assertion here must then be updated deliberately, which is
// the loud re-base this test exists to force.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { laneCapability, probeCategory, CANARY_CATEGORIES, canaryEvidence, extractorTestEvidence } from '../lane-capability.mjs';
import { SCANNER_SPECS } from '../extractors.mjs';
import { manifestCheck } from '../../bin/lane-fixture.mjs';

const CAP = laneCapability();

// The gate: a lane is added with its golden fixture in the same change, or it waits. A lane is a
// SCANNER_SPECS extractor whose check a bundled manifest declares. Both sides are read at test time
// and compared as sets, never as a pinned count, which a new lane plus an unrelated fixture would pass.
// secretsBetterleaks was added at no-fixture on 2026-10-07 and every test stayed green.
test('every lane the manifests declare counts against a golden fixture', () => {
  const lanes = SCANNER_SPECS.map(([category, check]) => ({ category, check }));
  const undeclared = lanes.filter((l) => !manifestCheck(l.check)).map((l) => `${l.category} (${l.check})`);
  assert.deepEqual(undeclared, [],
    `no bundled manifest declares the check these lanes read, and this gate cannot see them: ${undeclared.join(', ')}`);
  const declared = lanes.map((l) => l.category).sort();
  const counting = Object.entries(CAP.categories).filter(([, v]) => v.witness === 'counting').map(([k]) => k).sort();
  const without = declared.filter((c) => !counting.includes(c)).map((c) => {
    const v = CAP.categories[c];
    return `${c} (${v ? v.witness : 'absent from the lens'}${v?.note ? `: ${v.note}` : ''})`;
  });
  assert.deepEqual(without, [],
    `${without.length} declared lane(s) do not count against a golden fixture: ${without.join('; ')}. `
    + 'Make one with `node bin/lane-fixture.mjs --category <category> --seed <dir> --install`; '
    + '--draft <dir> is accepted only where the manifest says a real run cannot measure the lane.');
  assert.deepEqual(counting, declared);
});

test('NO stubs remain — every lane with a golden fixture can count', () => {
  // The stub era closed 2026-08-27 when hlint, the last of the five, graduated (clippy 2026-08-26;
  // joern/bearer/sobelow earlier on 2026-08-27). _unverifiedShape itself is retired. A shape-only
  // classification reappearing here means a NEW lane arrived with an unread output format — that
  // is the CORRECT state for it (stub it per the ledger comment in extractors.mjs), and this
  // assertion should then name it explicitly rather than being loosened.
  const shapeOnly = Object.entries(CAP.categories).filter(([, v]) => v.witness === 'shape-only').map(([k]) => k);
  assert.deepEqual(shapeOnly, []);
});

test('the graduated stubs classify counting from their real golden artifacts', () => {
  // Each parser written against a real run, each golden fixture the verbatim product of its
  // manifest command on this box.
  for (const cat of ['lintRust', 'sastJoern', 'sastBearer', 'sastElixir', 'lintHaskell']) {
    assert.equal(CAP.categories[cat].witness, 'counting', `${cat} graduated against real output`);
  }
});

test('lanes with real golden artifacts classify counting', () => {
  for (const cat of ['secrets', 'stubs', 'denoLint']) {
    assert.equal(CAP.categories[cat].witness, 'counting', `${cat} has a real fixture and a real parser`);
  }
});

test('no defects remain: every lane declared additive-vulnerability can count', () => {
  // The three published defects (sastJoern, sastBearer, sastElixir — additive-vulnerability lanes
  // whose stubs could never count) cleared 2026-08-27 the only allowed way: real parsers fed by
  // real runs, per the clippy path. A defect reappearing here means a lane was declared into the
  // vulnerability headline whose measured behaviour cannot count — fix the parser or the
  // declaration, never this assertion.
  assert.deepEqual(CAP.defects.map((d) => d.category).sort(), []);
});

test('an unmeasured lane is no-fixture — grey, never a capability claim in either direction', () => {
  const unmeasured = Object.entries(CAP.categories).filter(([, v]) => v.witness === 'no-fixture');
  for (const [, v] of unmeasured) {
    assert.equal(v.fixture, null, 'no fixture name is invented for an absent fixture');
    assert.equal(v.source, undefined, 'an absent fixture has no provenance');
  }
});

test('every counting lane states where its fixture came from', () => {
  for (const [cat, v] of Object.entries(CAP.categories).filter(([, r]) => r.witness === 'counting')) {
    assert.ok(['real', 'synthetic', 'unrecorded'].includes(v.source), `${cat} source ${v.source}`);
  }
  const total = Object.values(CAP.countingBySource).reduce((a, b) => a + b, 0);
  assert.equal(total, CAP.tally.counting || 0);
});

test('provenance: absent is unrecorded, present is read, unreadable fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-cap-prov-'));
  mkdirSync(join(root, 'secrets'));
  writeFileSync(join(root, 'secrets', 'gitleaks.json'), JSON.stringify([{ RuleID: 'generic-api-key', File: 'a.py', StartLine: 1 }]));
  const bare = laneCapability({ fixtures: root });
  assert.equal(bare.categories.secrets.witness, 'counting');
  assert.equal(bare.categories.secrets.source, 'unrecorded');
  writeFileSync(join(root, 'PROVENANCE.json'), JSON.stringify({ lanes: { secrets: { source: 'synthetic' } } }));
  assert.equal(laneCapability({ fixtures: root }).categories.secrets.source, 'synthetic');
  assert.deepEqual(laneCapability({ fixtures: root }).countingBySource, { synthetic: 1 });
  writeFileSync(join(root, 'PROVENANCE.json'), '{not json');
  assert.throws(() => laneCapability({ fixtures: root }), SyntaxError);
});

test('every SCANNER_SPECS category appears exactly once', () => {
  assert.equal(Object.keys(CAP.categories).length, new Set(Object.keys(CAP.categories)).size);
});

test('probeCategory: an empty fixture dir is no-fixture; a wrong-filename dir says so', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cap-'));
  const extract = (dir) => null;
  assert.equal(probeCategory('x', extract, join(d, 'missing')).witness, 'no-fixture');
  mkdirSync(join(d, 'present'));
  writeFileSync(join(d, 'present', 'other.json'), '{}');
  const p = probeCategory('x', extract, join(d, 'present'));
  assert.equal(p.witness, 'no-fixture');
  assert.match(p.note, /no artifact under the filename/);
});

test('probeCategory: a non-empty golden artifact yielding a clean zero is zero-on-golden, never a pass', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cap-'));
  mkdirSync(join(d, 'z'));
  writeFileSync(join(d, 'z', 'a.json'), '{"results":[{"real":"content"}]}');
  const extract = () => ({ crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true });
  assert.equal(probeCategory('z', extract, join(d, 'z')).witness, 'zero-on-golden');
});

test('probeCategory: a throwing extractor is its own classification, not a crash of the lens', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cap-'));
  mkdirSync(join(d, 't'));
  writeFileSync(join(d, 't', 'a.json'), '{}');
  const p = probeCategory('t', () => { throw new Error('boom'); }, join(d, 't'));
  assert.equal(p.witness, 'extractor-threw');
});

// ── evidence beyond the golden fixture ──────────────────────────────────────────────────────────

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL_DIR = join(CW, 'monitor', 'test', 'fixtures', 'extractor-real');
const INDEX = JSON.parse(readFileSync(join(REAL_DIR, 'INDEX.json'), 'utf8'));
const emptyRoot = () => mkdtempSync(join(tmpdir(), 'cw-cap-none-'));

test('every lane names the evidence that credited it; tally stays golden-only', () => {
  for (const [cat, v] of Object.entries(CAP.categories)) {
    assert.equal(v.capability, v.creditedBy.length ? 'measured' : 'undetermined', cat);
    assert.equal(v.creditedBy.includes('golden'), v.witness === 'counting', `${cat}: golden credit is the probe's counting`);
  }
  const m = CAP.measured;
  assert.equal(m.measured + m.undetermined, m.lanes);
  assert.equal(m.byEvidence.golden, CAP.tally.counting || 0);
  assert.deepEqual(m.undeterminedLanes, Object.entries(CAP.categories).filter(([, v]) => !v.creditedBy.length).map(([k]) => k).sort());
});

test('canary: every measured canary lane is mapped, and every mapping names a real category', () => {
  const cats = new Set(SCANNER_SPECS.map(([c]) => c));
  for (const [lane, targets] of Object.entries(CANARY_CATEGORIES)) {
    for (const c of targets) assert.ok(cats.has(c), `${lane} maps to ${c}, which is not a SCANNER_SPECS category`);
  }
  assert.equal(CAP.evidenceSources.canary.read, true);
  assert.deepEqual(CAP.evidenceSources.canary.unmapped, [], 'a new canary lane needs a deliberate mapping, never a guess');
  assert.deepEqual(Object.keys(CAP.evidenceSources.canary.uncredited), ['dependency-cve']);
  const credited = Object.entries(CAP.categories).filter(([, v]) => v.creditedBy.includes('canary')).map(([k]) => k).sort();
  assert.deepEqual(credited, Object.values(CANARY_CATEGORIES).flat().sort());
});

test('extractor-test: every declared real-output fixture exists, is read by its test, and counts', () => {
  for (const f of INDEX.fixtures) {
    const file = resolve(REAL_DIR, f.file);
    assert.ok(existsSync(file), `${f.file} is declared but missing`);
    const src = readFileSync(join(CW, f.test), 'utf8');
    for (const needle of [`'${basename(dirname(file))}'`, `'${basename(file)}'`]) {
      assert.ok(src.includes(needle), `${f.test} never names ${needle} — the fixture is not one its test reads`);
    }
    const ev = CAP.categories[f.category].extractorTests.find((e) => e.fixture === f.file);
    assert.equal(ev.witness, 'counting', `${f.category} from ${f.file}: real output read as ${ev.witness}`);
  }
  assert.deepEqual(CAP.evidenceSources.extractorTests.unknownCategories, []);
});

test('extractor-test: every file under extractor-real/ is declared in INDEX.json', () => {
  const declared = new Set(INDEX.fixtures.map((f) => resolve(REAL_DIR, f.file)));
  for (const d of readdirSync(REAL_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const n of readdirSync(join(REAL_DIR, d.name))) {
      assert.ok(declared.has(join(REAL_DIR, d.name, n)), `${d.name}/${n} is undeclared`);
    }
  }
});

test('no evidence of any kind is undetermined — never a pass', () => {
  const none = laneCapability({ fixtures: emptyRoot(), canaryDir: emptyRoot(), testFixtures: join(emptyRoot(), 'INDEX.json') });
  assert.equal(none.measured.measured, 0);
  assert.equal(none.measured.undetermined, none.measured.lanes);
  assert.deepEqual(none.measured.byEvidence, { canary: 0, 'extractor-test': 0, golden: 0 });
  assert.equal(none.evidenceSources.canary.read, false);
  assert.equal(none.evidenceSources.extractorTests.read, false);
  for (const v of Object.values(none.categories)) assert.deepEqual(v.creditedBy, []);
});

test('canary: only an explicit both-directions verdict credits; the claim is kept either way', () => {
  const dir = emptyRoot();
  writeFileSync(join(dir, 'EXPECTED.json'), JSON.stringify({ measured: { date: '2026-01-01', lanes: {
    secrets: { clean: 'exit 0, 0 findings', dirty: 'exit 1, 2 findings', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
    sast: { clean: 'exit 0, 1 finding', dirty: 'exit 0, 3 findings', verdict: 'CLEAN TREE FIRED' },
    container: { dirty: 'exit 1, 5 findings', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
    'deps-content': { clean: 'exit 0, 0 findings', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
    'new-lane': { clean: 'x', dirty: 'y', verdict: 'BOTH DIRECTIONS DEMONSTRATED' },
  } } }));
  const cap = laneCapability({ fixtures: emptyRoot(), canaryDir: dir, testFixtures: join(emptyRoot(), 'x.json') });
  assert.deepEqual(cap.categories.secrets.creditedBy, ['canary']);
  assert.equal(cap.categories.secrets.canary[0].date, '2026-01-01', 'a lane without its own date takes the record\'s');
  assert.deepEqual(cap.categories.sastSemgrep.creditedBy, []);
  assert.equal(cap.categories.sastSemgrep.capability, 'undetermined');
  assert.deepEqual(cap.categories.sastSemgrep.canary, [{ lane: 'sast', date: '2026-01-01', verdict: 'CLEAN TREE FIRED', credits: false }]);
  assert.deepEqual(cap.categories.dockerfile.creditedBy, [], 'a verdict without both recorded directions is a claim, not evidence');
  assert.deepEqual(cap.categories.depsContent.creditedBy, []);
  assert.deepEqual(cap.evidenceSources.canary.unmapped, ['new-lane']);
  writeFileSync(join(dir, 'EXPECTED.json'), '{not json');
  assert.throws(() => canaryEvidence(dir), SyntaxError);
});

test('extractor-test: executed, not declared — a missing file or a clean zero does not credit', () => {
  const dir = emptyRoot();
  writeFileSync(join(dir, 'real.json'), JSON.stringify([{ RuleID: 'generic-api-key', File: 'a.py', StartLine: 1 }]));
  writeFileSync(join(dir, 'zero.json'), '[]');
  writeFileSync(join(dir, 'INDEX.json'), JSON.stringify({ fixtures: [
    { category: 'secrets', file: 'real.json', artifact: 'gitleaks.json', test: 't' },
    { category: 'mainframeSecrets', file: 'zero.json', artifact: 'gitleaks-mainframe.json', test: 't' },
    { category: 'stubs', file: 'gone.json', artifact: 'stub.json', test: 't' },
    { category: 'noSuchLane', file: 'real.json', artifact: 'x.json', test: 't' },
  ] }));
  const cap = laneCapability({ fixtures: emptyRoot(), canaryDir: emptyRoot(), testFixtures: join(dir, 'INDEX.json') });
  assert.deepEqual(cap.categories.secrets.creditedBy, ['extractor-test']);
  assert.equal(cap.categories.mainframeSecrets.capability, 'undetermined');
  assert.equal(cap.categories.stubs.extractorTests[0].witness, 'no-fixture');
  assert.equal(cap.categories.stubs.capability, 'undetermined');
  assert.deepEqual(cap.evidenceSources.extractorTests.unknownCategories, ['noSuchLane']);
  assert.deepEqual(cap.measured.byEvidence, { canary: 0, 'extractor-test': 1, golden: 0 });
  writeFileSync(join(dir, 'INDEX.json'), '{not json');
  assert.throws(() => extractorTestEvidence(join(dir, 'INDEX.json')), SyntaxError);
});

test('the lens is deterministic over the same inputs', () => {
  assert.deepEqual(laneCapability(), CAP);
});
