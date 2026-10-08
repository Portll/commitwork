#!/usr/bin/env node
// monitor/lane-capability.mjs — which lanes can actually SPEAK, measured rather than declared.
//
// THE GAP THIS CLOSES. LANE_KINDS declares what each category's severity is a severity OF, and
// posture/coverage narratives credit every declared lane — but five of them (joern, bearer,
// sobelow, hlint, and until 2026-08-26 clippy) are wired to `_unverifiedShape` and can never emit
// a count, whatever the tool produced. A lane that can only attest an artifact's presence
// satisfies PRESENCE claims, never COVERAGE claims, and nothing distinguished the two. This is
// the repo's recurring defect class — "built, fed by nothing" — applied to the lane roster
// itself.
//
// THE MECHANISM. Every SCANNER_SPECS extractor is EXECUTED against a golden fixture
// (monitor/test/fixtures/lane-capability/<category>/ — real tool output wherever the tool exists
// on a fleet box; a minimal plausible body for lanes whose real shape nobody has seen, which is
// exactly the case their stub classifies). The classification is BEHAVIOUR, not declaration:
//   counting        the extractor derived structured content — counts, undetermined, or rows
//   shape-only      a present artifact read as `unparseable`: the lane can attest presence, never
//                   coverage (the _unverifiedShape contract, correctly)
//   zero-on-golden  the extractor returned a clean zero from a NON-EMPTY golden artifact — the
//                   F8 silent-green shape; a defect in the fixture or the parser, never a pass
//   no-fixture      no golden artifact exists for this category — the lens's own grey; this lane's
//                   capability is UNMEASURED, which is not the same as incapable
//
// THE SECOND WITNESS. LANE_KINDS is a static table; the fixture probe executes the parser. They
// cannot share a failure mode. Disagreement is the finding: a category declared additive
// vulnerability (kind V) whose behaviour is shape-only is a lane wearing a verdict's clothes with
// no voice — a defect in COMMITWORK, never a finding about a scanned repo.
//
// When a stub graduates (a real parser lands, as clippy's did), its classification flips here
// without editing this lens — that is the point of probing behaviour.
//
// ALL ITS EVIDENCE, KEPT APART. The golden fixture is one witness; two more already existed and were
// not counted. Each lane's `creditedBy` names every kind that credited it, and `measured` tallies
// them separately, so a credit is always traceable to its evidence:
//   golden          the probe above returned counting
//   canary          fixtures/scan-canary/EXPECTED.json `measured` records the lane's tool firing on
//                   the dirty tree and staying quiet on the clean one. That is a dated record of a TOOL
//                   run, not an extractor execution, which is why it is its own kind
//   extractor-test  a real-output fixture an extractor test reads (extractor-real/INDEX.json),
//                   executed here through the same probe as a golden fixture
// A lane no kind credits is `undetermined` — never a pass, and never folded into `tally`, which
// stays the golden-only figure it always was.
//
// usage: node monitor/lane-capability.mjs [--json]
// writes: <reportsRoot>/lane-capability.json (fleet-once, atomic). CW_NOW pins `generated`;
// CW_LANE_FIXTURES overrides the fixture root, CW_CANARY_DIR the canary, CW_LANE_TEST_FIXTURES the
// in-test fixture index (all read at call time, for tests).

import { readFileSync, readdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { SCANNER_SPECS, LANE_KINDS } from './extractors.mjs';
import { loadRegistry } from './registry.mjs';
import { reportsRootDir } from './area.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

const fixtureRoot = () => process.env.CW_LANE_FIXTURES || join(HERE, 'test', 'fixtures', 'lane-capability');
const canaryRoot = () => process.env.CW_CANARY_DIR || join(CW, 'fixtures', 'scan-canary');
const testFixtureIndex = () => process.env.CW_LANE_TEST_FIXTURES
  || join(HERE, 'test', 'fixtures', 'extractor-real', 'INDEX.json');

const BOTH_DIRECTIONS = 'BOTH DIRECTIONS DEMONSTRATED';

/** Canary lane → the SCANNER_SPECS categories whose check runs the tool that lane measured. A canary
 *  lane absent here is reported `unmapped` rather than guessed at. */
export const CANARY_CATEGORIES = {
  secrets: ['secrets'],                        // gitleaks
  container: ['dockerfile', 'iac'],            // hadolint, trivy config
  sast: ['sastSemgrep'],                       // semgrep, production sast config
  'ci-hygiene': ['actionsPosture'],            // zizmor
  'deps-content': ['depsContent'],
  'commit-provenance': ['commitProvenance'],
  'agent-instructions': ['agentInstructions'],
  'agent-config': ['agentConfig'],
  'model-artefacts': ['modelArtefacts'],
  'actions-gaps': ['actionsGaps'],
  'dependency-cve': [],
};
export const CANARY_NO_CATEGORY = {
  'dependency-cve': 'osv-scanner CVE rows reach no SCANNER_SPECS category; maliciousPackages reads MAL- records only',
};

/** One category's probe. Pure given a fixture dir; never throws — a throwing extractor is itself
 *  a classification (`extractor-threw`), because the golden fixture is supposed to be its happy
 *  path. */
export function probeCategory(category, extract, dir) {
  let entries = [];
  try { entries = readdirSync(dir).filter((n) => !n.startsWith('.')); } catch (e) {
    if (e && e.code === 'ENOENT') return { witness: 'no-fixture', fixture: null };
    return { witness: 'no-fixture', fixture: null, note: `fixture dir unreadable: ${e.code || e.message}` };
  }
  if (!entries.length) return { witness: 'no-fixture', fixture: null };
  const fixture = entries.sort().join(',');

  let r;
  try { r = extract(dir); } catch (e) {
    return { witness: 'extractor-threw', fixture, note: String(e && e.message || e).slice(0, 200) };
  }
  if (r === null || r === undefined) {
    // The artifact the extractor looks for is not among the fixture files — same grey as absent.
    return { witness: 'no-fixture', fixture, note: 'fixture dir holds no artifact under the filename this extractor reads' };
  }
  if (r.unparseable) return { witness: 'shape-only', fixture };
  const derived = (r.total || 0) > 0 || (r.undetermined || 0) > 0
    || (Array.isArray(r.findings) && r.findings.length > 0);
  if (derived) return { witness: 'counting', fixture };
  return { witness: 'zero-on-golden', fixture, note: 'a clean zero from a non-empty golden artifact — the F8 silent-green shape; fix the fixture or the parser before trusting this lane\'s zeros' };
}

/** PROVENANCE.json at the fixture root, written by bin/lane-fixture.mjs: whether each fixture is the
 *  lane's own tool output over a seed (`real`) or a drafted artifact read by the extractor alone
 *  (`synthetic`). Absent is legitimate for older fixtures; unreadable is an error, never empty. */
function readProvenance(fixtures) {
  try { return JSON.parse(readFileSync(join(fixtures, 'PROVENANCE.json'), 'utf8')).lanes || {}; } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw e;
  }
}

/** The canary's measured record, per SCANNER_SPECS category. Absent is legitimate (no canary
 *  evidence); unreadable throws. Credits only an explicit both-directions verdict. */
export function canaryEvidence(dir = canaryRoot()) {
  let expected;
  try { expected = JSON.parse(readFileSync(join(dir, 'EXPECTED.json'), 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return { read: false, byCategory: {}, unmapped: [], uncredited: {} };
    throw e;
  }
  const lanes = expected?.measured?.lanes || {};
  const byCategory = {};
  const unmapped = [];
  const uncredited = {};
  for (const lane of Object.keys(lanes).sort()) {
    const m = lanes[lane] || {};
    const cats = CANARY_CATEGORIES[lane];
    if (!cats) { unmapped.push(lane); continue; }
    if (!cats.length) { uncredited[lane] = CANARY_NO_CATEGORY[lane] || 'no category declared'; continue; }
    const credits = m.verdict === BOTH_DIRECTIONS && typeof m.clean === 'string' && typeof m.dirty === 'string';
    const ev = { lane, date: m.date || expected.measured.date || null, verdict: m.verdict ?? null, credits };
    for (const c of cats) (byCategory[c] ||= []).push(ev);
  }
  return { read: true, date: expected?.measured?.date || null, byCategory, unmapped, uncredited };
}

/** Real-output fixtures that extractor tests read, each executed through probeCategory from a
 *  scratch copy under the artifact name its extractor reads. `file` resolves against the index's
 *  own directory. Absent index = no such evidence; unreadable throws. */
export function extractorTestEvidence(index = testFixtureIndex(), specs = SCANNER_SPECS) {
  let decl;
  try { decl = JSON.parse(readFileSync(index, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return { read: false, byCategory: {}, unknown: [] };
    throw e;
  }
  const extractors = new Map(specs.map(([c, , x]) => [c, x]));
  const byCategory = {};
  const unknown = [];
  for (const f of decl.fixtures || []) {
    const extract = extractors.get(f.category);
    if (!extract) { unknown.push(f.category); continue; }
    const scratch = mkdtempSync(join(tmpdir(), 'cw-lane-intest-'));
    let probe;
    try {
      try {
        copyFileSync(resolve(dirname(index), f.file), join(scratch, f.artifact || basename(f.file)));
        if (f.exit !== undefined) writeFileSync(join(scratch, `${f.artifact || basename(f.file)}.exit`), `${f.exit}\n`);
        probe = probeCategory(f.category, extract, scratch);
      } catch (e) {
        if (!(e && e.code === 'ENOENT')) throw e;
        probe = { witness: 'no-fixture', note: 'declared fixture file is missing' };
      }
    } finally { rmSync(scratch, { recursive: true, force: true }); }
    (byCategory[f.category] ||= []).push({
      test: f.test, fixture: f.file, witness: probe.witness,
      ...(probe.note ? { note: probe.note } : {}),
      credits: probe.witness === 'counting',
    });
  }
  return { read: true, byCategory, unknown: [...new Set(unknown)].sort() };
}

/** The full roster probe + the declaration cross-check. */
export function laneCapability({ fixtures = fixtureRoot(), canaryDir = canaryRoot(), testFixtures = testFixtureIndex() } = {}) {
  const categories = {};
  const defects = [];
  const provenance = readProvenance(fixtures);
  const canary = canaryEvidence(canaryDir);
  const inTest = extractorTestEvidence(testFixtures);
  for (const [category, checkId, extract] of SCANNER_SPECS) {
    const probe = probeCategory(category, extract, join(fixtures, category));
    const kind = LANE_KINDS[category] || null;
    const row = {
      witness: probe.witness,
      fixture: probe.fixture,
      ...(probe.note ? { note: probe.note } : {}),
      ...(probe.fixture ? { source: provenance[category]?.source || 'unrecorded' } : {}),
      check: checkId,
      kind: kind ? kind.kind : 'unclassified',
      additive: kind ? !!kind.additive : false,
    };
    const fromCanary = canary.byCategory[category] || [];
    const fromTests = inTest.byCategory[category] || [];
    if (fromCanary.length) row.canary = fromCanary;
    if (fromTests.length) row.extractorTests = fromTests;
    row.creditedBy = [
      ...(fromCanary.some((e) => e.credits) ? ['canary'] : []),
      ...(fromTests.some((e) => e.credits) ? ['extractor-test'] : []),
      ...(probe.witness === 'counting' ? ['golden'] : []),
    ];
    row.capability = row.creditedBy.length ? 'measured' : 'undetermined';
    categories[category] = row;
    // The red branch — self-audit only: a lane folded into the vulnerability headline whose
    // measured behaviour cannot produce a number.
    if (row.additive && kind && kind.kind === 'vulnerability'
      && (probe.witness === 'shape-only' || probe.witness === 'zero-on-golden')) {
      defects.push({ category, witness: probe.witness,
        why: 'declared additive vulnerability, measured unable to count — a verdict\'s clothes with no voice' });
    }
  }
  const tally = {};
  const countingBySource = {};
  for (const r of Object.values(categories)) {
    tally[r.witness] = (tally[r.witness] || 0) + 1;
    if (r.witness === 'counting') countingBySource[r.source] = (countingBySource[r.source] || 0) + 1;
  }
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  const rows = Object.entries(categories);
  const byEvidence = { canary: 0, 'extractor-test': 0, golden: 0 };
  for (const [, r] of rows) for (const k of r.creditedBy) byEvidence[k] += 1;
  const undeterminedLanes = rows.filter(([, r]) => r.capability === 'undetermined').map(([c]) => c).sort();
  return {
    categories: sorted(categories),
    tally: sorted(tally),
    countingBySource: sorted(countingBySource),
    measured: {
      lanes: rows.length,
      measured: rows.length - undeterminedLanes.length,
      undetermined: undeterminedLanes.length,
      byEvidence,
      undeterminedLanes,
    },
    evidenceSources: {
      canary: { read: canary.read, date: canary.date ?? null, unmapped: canary.unmapped, uncredited: canary.uncredited },
      extractorTests: { read: inTest.read, unknownCategories: inTest.unknown },
    },
    defects,
  };
}

function main() {
  const out = {
    generated: process.env.CW_NOW || new Date().toISOString(),
    note: 'Which lanes can actually SPEAK — each SCANNER_SPECS extractor executed against a golden fixture. counting = derived structured content; shape-only = attests presence, never coverage; zero-on-golden = the F8 silent-green shape, a defect; no-fixture = capability UNMEASURED, not incapable. source (per fixture, from PROVENANCE.json): real = the lane\'s own tool ran over a seed; synthetic = a drafted artifact read by the extractor alone, which proves the parser and not the tool\'s output shape; unrecorded = predates provenance. measured counts a lane once if ANY evidence kind credits it — golden (the probe counted), canary (the scan canary recorded its tool firing on the dirty tree and silent on the clean one; a tool run, not an extractor run), extractor-test (a real-output fixture an extractor test reads, executed here) — and each lane\'s creditedBy names which; a lane none credits is undetermined. tally stays golden-only. defects[] lists lanes declared additive-vulnerability whose measured behaviour cannot count.',
    ...laneCapability(),
  };
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  const root = reportsRootDir(loadRegistry());
  writeAtomic(join(root, 'lane-capability.json'), JSON.stringify(out, null, 1) + '\n');
  const t = out.tally;
  const bySource = Object.entries(out.countingBySource).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`lane-capability: ${t.counting || 0} counting${bySource ? ` (${bySource})` : ''} · ${t['shape-only'] || 0} shape-only · ${t['zero-on-golden'] || 0} zero-on-golden · ${t['no-fixture'] || 0} unmeasured${out.defects.length ? ` · ${out.defects.length} DEFECT(S)` : ''}`);
  const m = out.measured;
  console.log(`lane-capability: ${m.measured} of ${m.lanes} measured (golden ${m.byEvidence.golden}, canary ${m.byEvidence.canary}, extractor-test ${m.byEvidence['extractor-test']}) · ${m.undetermined} undetermined`);
  for (const d of out.defects) console.error(`  DEFECT ${d.category}: ${d.why}`);
}

if (isMain) main();
