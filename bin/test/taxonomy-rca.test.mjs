// fact: the rca axis had ZERO tests for its first six hours, and its author measured it green with a
//   throwaway mutation script that was deleted the moment it printed / a probe you run once tells you
//   the code was right at 17:40; a test tells you somebody will find out when it stops being. The
//   difference is a floor, and CLAUDE.md already names it: "It had no floor — no reason it HAD to be
//   right, and therefore no way to notice when it stopped being." (expiry: never, prev: not built)
//
// fact: a FourEyes mirror probe of 12 set-level properties against the first validateRca caught ONE /
//   every rule it had was per-entry ("is this value legal here"), because a per-value `test:` sentence
//   has nowhere to hang transitivity, acyclicity, uniqueness or mutual exclusion — so nobody wrote
//   them (expiry: never, prev: 11 of 12 missed)
//
// fact: the vocabulary was its own enforcement switch / validateRca reads `symmetry`, `crossesFamily`
//   and `terminal` OUT of the vocabulary as conditionals, so `crossesFamilies` or `symetric` silently
//   turned a rule off and --check still printed OK. The tests below pin the DECLARATIONS, because a
//   witness the vocabulary can edit is not a second witness (expiry: never, prev: both MISSED)
//
// fact: basis cites a verbatim QUOTE and this file resolves it against the tree / the first cut cited
//   `FAILURE-TAXONOMY.md L615-617` and two of four citations rotted within hours when a peer's edit
//   added five lines above them. validate() stays pure and checks shape; the I/O witness lives here,
//   so the two cannot share a failure mode (expiry: never, prev: line-keyed, drifted)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate } from '../taxonomy-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const REGISTRY = join(REPO, 'monitor', 'failure-taxonomy.json');

const registry = () => JSON.parse(readFileSync(REGISTRY, 'utf8'));
const rcaErrors = (doc) => validate(doc).filter((e) => /rca|unassessed|terminal|closed|family|cycle|listed twice|alternatives|~/i.test(e));

// A fixture that actually EXERCISES the vocabulary. The stpa suite's fixture declares only the
// terminal relation, so symmetry, transitivity, acyclicity and family-crossing were never reached by
// any test in the repo — the axis was covered by a fixture shaped to avoid it.
const SYMMETRIES = {
  symmetric: { test: 'both ends carry it' },
  asymmetric: { test: 'one way only' },
  none: { test: 'names no target' },
};
const RELATIONS = () => ({
  'same-defect-as': { symmetry: 'symmetric', transitive: true, test: 'one mechanism, two altitudes' },
  'mechanism-of': { symmetry: 'asymmetric', crossesFamily: true, test: 'consequence here, mechanism there' },
  enables: { symmetry: 'asymmetric', test: 'target reachable only because subject holds' },
  awaits: { symmetry: 'asymmetric', cycleIsFinding: true, test: 'neither is broken; each waits' },
  'assessed-none': { symmetry: 'none', terminal: true, test: 'review completed and found no supported outgoing edge' },
  unassessed: { symmetry: 'none', terminal: true, test: 'no outgoing edge judged yet' },
});
const U = () => [{ relation: 'unassessed' }];
const cls = (id, machine, rca = U()) => ({
  id, name: `Class ${id}`, machine, layer: 'CTRL', description: `d ${id}`, example: `e ${id}`,
  closure: 2, gain: 2, scoreBasis: 'fixture',
  stpa: [{ loop: 'monitor', uca: 'none', cause: 'feedback-missing' }],
  rca,
});
const B = { doc: 'monitor/failure-taxonomy.json', quote: 'fixture evidence quote' };

const fixture = () => ({
  version: 1,
  families: [
    { roman: 'I', key: 'false_clean', prefix: 'C', name: 'False clean', proposition: 'nothing is wrong' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
    { roman: 'V', key: 'false_measurement', prefix: 'M', name: 'False measurement', proposition: 'the number means what it says' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
  ],
  classes: [cls('C1', 'false_clean.one'), cls('C2', 'false_clean.two'), cls('C3', 'false_clean.three'), cls('M1', 'false_measurement.one')],
  scales: { closure: '0..4', gain: '0..4' },
  scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
  stpaVocabulary: {
    loops: { monitor: { controller: 'the monitor', controls: 'runs', test: 'x' } },
    uca: { none: { test: 'x' } },
    cause: { 'feedback-missing': { test: 'x' } },
  },
  stpaProvenance: { rater: 'r', date: '2026-08-30', method: 'm', caveat: 'c' },
  rcaVocabulary: { symmetries: structuredClone(SYMMETRIES), relations: RELATIONS() },
  rcaProvenance: { rater: 'r', date: '2026-08-30', method: 'm', caveat: 'c' },
});

const at = (doc, id) => doc.classes.find((c) => c.id === id);
const edge = (relation, to) => ({ relation, to, basis: { ...B } });

test('the fixture is clean, so every refusal below is attributable to its own mutation', () => {
  assert.deepEqual(rcaErrors(fixture()), []);
});

// ── per-entry rules ────────────────────────────────────────────────────────────────────────────
for (const [name, mutate, want] of [
  ['an unknown relation', (d) => { at(d, 'C1').rca = [edge('causes', 'C2')]; }, /not in rcaVocabulary\.relations/],
  ['a target that is not a class', (d) => { at(d, 'C1').rca = [edge('enables', 'Z99')]; }, /is not a class id/],
  ['an empty rca array', (d) => { at(d, 'C1').rca = []; }, /"unassessed" is a value, not an omission/],
  ['unassessed beside a real edge', (d) => { at(d, 'C1').rca = [{ relation: 'unassessed' }, edge('enables', 'C2')]; }, /terminal relation stands alone/],
  ['unassessed carrying a target', (d) => { at(d, 'C1').rca = [{ relation: 'unassessed', to: 'C2' }]; }, /carries a target/],
  ['unassessed carrying a basis', (d) => { at(d, 'C1').rca = [{ relation: 'unassessed', basis: { ...B } }]; }, /carries a basis — a terminal state names no edge/],
  ['a self-edge', (d) => { at(d, 'C1').rca = [edge('enables', 'C1')]; }, /points at itself/],
  ['an unknown entry key', (d) => { at(d, 'C1').rca = [{ ...edge('enables', 'C2'), note: 'x' }]; }, /unknown key "note"/],
  ['a real edge with no basis', (d) => { at(d, 'C1').rca = [{ relation: 'enables', to: 'C2' }]; }, /needs a basis \{doc, quote\}/],
  ['a basis missing its quote', (d) => { at(d, 'C1').rca = [{ relation: 'enables', to: 'C2', basis: { doc: 'x' } }]; }, /needs a basis \{doc, quote\}/],
  ['mechanism-of inside one family', (d) => { at(d, 'C1').rca = [edge('mechanism-of', 'C2')]; }, /stays inside family "C"/],
]) {
  test(`REFUSED: ${name}`, () => {
    const d = fixture(); mutate(d);
    assert.match(rcaErrors(d).join('\n'), want, `not refused: ${name}`);
  });
}

// ── SET rules: the algebra a per-value test cannot express ─────────────────────────────────────
test('REFUSED: a symmetric edge asserted from one end only', () => {
  const d = fixture(); at(d, 'C1').rca = [edge('same-defect-as', 'C2')];
  assert.match(rcaErrors(d).join('\n'), /is not closed/);
});

test('REFUSED: a broken transitive closure — the partition may not have a missing side', () => {
  const d = fixture();
  at(d, 'C1').rca = [edge('same-defect-as', 'C2'), edge('same-defect-as', 'C3')];
  at(d, 'C2').rca = [edge('same-defect-as', 'C1')];              // C2 ~ C1 ~ C3, C2 !~ C3
  at(d, 'C3').rca = [edge('same-defect-as', 'C1')];
  assert.match(rcaErrors(d).join('\n'), /but not C2 ~ C3|but not C3 ~ C2/);
});

test('REFUSED: a duplicate identical edge', () => {
  const d = fixture(); at(d, 'C1').rca = [edge('enables', 'C2'), edge('enables', 'C2')];
  assert.match(rcaErrors(d).join('\n'), /is listed twice/);
});

test('REFUSED: two different relations on one ordered pair', () => {
  const d = fixture(); at(d, 'C1').rca = [edge('enables', 'M1'), edge('mechanism-of', 'M1')];
  assert.match(rcaErrors(d).join('\n'), /the relations' own tests make them alternatives/);
});

test('REFUSED: a 2-cycle in an asymmetric relation', () => {
  const d = fixture();
  at(d, 'C1').rca = [edge('enables', 'C2')];
  at(d, 'C2').rca = [edge('enables', 'C1')];
  assert.match(rcaErrors(d).join('\n'), /cycle in "enables"/);
});

test('REFUSED: a 3-cycle in an asymmetric relation', () => {
  const d = fixture();
  at(d, 'C1').rca = [edge('enables', 'C2')];
  at(d, 'C2').rca = [edge('enables', 'C3')];
  at(d, 'C3').rca = [edge('enables', 'C1')];
  assert.match(rcaErrors(d).join('\n'), /cycle in "enables"/);
});

test('ALLOWED: a cycle in awaits is a deadlock, which is the finding and not an error', () => {
  const d = fixture();
  at(d, 'C1').rca = [edge('awaits', 'C2')];
  at(d, 'C2').rca = [edge('awaits', 'C1')];
  assert.deepEqual(rcaErrors(d), [],
    'awaits declares cycleIsFinding; a cycle check applied here would delete the only shape it exists to record');
});

test('ALLOWED: assessed-none records a completed negative review without inventing an edge', () => {
  const d = fixture(); at(d, 'C1').rca = [{ relation: 'assessed-none' }];
  assert.deepEqual(rcaErrors(d), []);
});

// ── the vocabulary is validated too, because the checks are READ from it ───────────────────────
for (const [name, mutate, want] of [
  ['a typo in a modifier key silently disabling its rule', (d) => { const r = d.rcaVocabulary.relations['mechanism-of']; delete r.crossesFamily; r.crossesFamilies = true; }, /unknown key "crossesFamilies"/],
  ['a typo in a symmetry value', (d) => { d.rcaVocabulary.relations['same-defect-as'].symmetry = 'symetric'; }, /is not in rcaVocabulary\.symmetries/],
  ['a modifier set to false, which reads as set and acts as unset', (d) => { d.rcaVocabulary.relations['mechanism-of'].crossesFamily = false; }, /must be true when present/],
  ['a relation with no test', (d) => { delete d.rcaVocabulary.relations.masks?.test; delete d.rcaVocabulary.relations.enables.test; }, /no test — a relation a second rater cannot apply/],
  ['a terminal relation whose symmetry is not none', (d) => { d.rcaVocabulary.relations.unassessed.symmetry = 'asymmetric'; }, /its symmetry must be "none"/],
  ['a missing symmetries block', (d) => { delete d.rcaVocabulary.symmetries; }, /rcaVocabulary\.symmetries is missing or empty/],
  ['a missing relations block', (d) => { delete d.rcaVocabulary.relations; }, /rcaVocabulary\.relations is missing or empty/],
  ['an incomplete provenance', (d) => { delete d.rcaProvenance.caveat; }, /rcaProvenance is missing or incomplete/],
  ['a malformed provenance date', (d) => { d.rcaProvenance.date = 'yesterday'; }, /is not YYYY-MM-DD/],
]) {
  test(`REFUSED: ${name}`, () => {
    const d = fixture(); mutate(d);
    assert.match(rcaErrors(d).join('\n'), want, `not refused: ${name}`);
  });
}

// ── the real registry, asserted on its own and not behind another axis's branch ────────────────
test('the shipped registry validates, unconditionally', () => {
  // This assertion previously existed only inside `if (!raw.stpaVocabulary) { ... return; }` in the
  // stpa suite, so deleting an unrelated field took every rca guarantee with it and left the suite
  // green. The rca witness must not be a child of the stpa branch.
  assert.deepEqual(validate(registry()), []);
});

test('every cited doc is TRACKED — an anchor may not name a private or untracked file', () => {
  // Two defects in one rule. (1) basis.quote copies verbatim text OUT of the cited document and INTO
  // a registry that renders to a published page, so an unrestricted doc path is an exfiltration
  // route: evaluations/ is a gitignored symlink into a private sidecar, and a quote taken from it
  // would validate here and publish the moment a renderer surfaces the axis. (2) an untracked target
  // is D16 — the reference exists on this disk and in no clone.
  const tracked = new Set(
    execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').filter(Boolean),
  );
  const offenders = [];
  for (const c of registry().classes) {
    for (const e of c.rca) {
      if (e.basis && !tracked.has(e.basis.doc)) offenders.push(`${c.id} -> ${e.to}: cites "${e.basis.doc}", which git does not track`);
    }
  }
  assert.deepEqual(offenders, [],
    'evidence for a published claim must come from a document every reader of that claim can also open');
});

test('every basis quote resolves verbatim against the tree it cites', () => {
  const doc = registry();
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) cache.set(rel, readFileSync(join(REPO, rel), 'utf8'));
    return cache.get(rel);
  };
  const dangling = [];
  const seen = [];
  for (const c of doc.classes) {
    for (const e of c.rca) {
      if (!e.basis) continue;
      seen.push(`${c.id} ${e.relation}`);
      if (!read(e.basis.doc).includes(e.basis.quote)) dangling.push(`${c.id} -> ${e.to}: ${e.basis.doc} no longer contains ${JSON.stringify(e.basis.quote)}`);
    }
  }
  assert.ok(seen.length > 0, 'no basis citations found — this test would pass vacuously');
  assert.deepEqual(dangling, [],
    'a basis names the evidence for a causal claim; when it stops resolving the claim is unsourced, which is why it cites a quote and not a line');
});

test('a quote whose cited doc is CLEAN must resolve in HEAD, not merely on this disk', (t) => {
  // The working-tree check above answers "does this anchor exist here". Every consumer asks "does it
  // exist in the repository", and the two questions come apart exactly when it matters — measured on
  // this very change: the anchor "are one defect at several altitudes" resolved in the tree and was
  // ABSENT from HEAD, because the doc edit that created it had not landed. That is D16, reproduced by
  // the witness built to prevent the neighbouring defect.
  //
  // Scoped to CLEAN cited docs on purpose. While a doc and the anchor citing it are in flight
  // together, the tree is the correct subject and HEAD legitimately lacks the quote; failing there
  // would punish the atomic change this repo requires. But once the cited doc is unmodified, HEAD is
  // the only honest subject, and a quote missing from it will dangle for everyone but its author.
  const dirty = new Set(
    execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
      .split('\n').filter(Boolean).map((l) => l.slice(3).trim()),
  );
  const cache = new Map();
  const head = (rel) => {
    if (!cache.has(rel)) {
      try { cache.set(rel, execFileSync('git', ['-C', REPO, 'show', `HEAD:${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })); }
      catch { cache.set(rel, null); }
    }
    return cache.get(rel);
  };
  const dangling = [];
  for (const c of registry().classes) {
    for (const e of c.rca) {
      if (!e.basis || dirty.has(e.basis.doc)) continue;
      const src = head(e.basis.doc);
      if (src === null) { dangling.push(`${c.id}: "${e.basis.doc}" has no HEAD blob`); continue; }
      if (!src.includes(e.basis.quote)) dangling.push(`${c.id} -> ${e.to}: ${e.basis.doc} is clean, yet HEAD does not contain ${JSON.stringify(e.basis.quote)}`);
    }
  }
  assert.deepEqual(dangling, [], 'an anchor into a clean document must be in the repository, not only on this disk');

  // VACUITY IS REPORTED, NEVER SILENT. Every cited doc can legitimately be dirty at once — that is
  // what an atomic change looks like here — and this check then examines nothing and passes. A pass
  // that examined nothing must not read the same as a pass that examined everything, so the scope is
  // printed either way. Measured at the moment this guard was written: 0 of 2, fully vacuous.
  const cited = new Set();
  for (const c of registry().classes) for (const e of c.rca) if (e.basis) cited.add(e.basis.doc);
  const skipped = [...cited].filter((d) => dirty.has(d));
  t.diagnostic(`HEAD-resolved ${cited.size - skipped.length} of ${cited.size} cited docs${skipped.length ? `; SKIPPED as in-flight: ${skipped.join(', ')}` : ''}`);
  for (const d of skipped) {
    assert.ok(dirty.has(d), `${d} was skipped for a reason other than being in flight — the only licence to skip is a dirty cited doc`);
  }
});

test('the vocabulary declares what the validator relies on — pinned, so the vocabulary cannot disable its own checks', () => {
  const v = registry().rcaVocabulary;
  assert.deepEqual(Object.keys(v.symmetries).sort(), ['asymmetric', 'none', 'symmetric']);
  assert.equal(v.relations['same-defect-as'].symmetry, 'symmetric');
  assert.equal(v.relations['same-defect-as'].transitive, true);
  assert.equal(v.relations['mechanism-of'].crossesFamily, true);
  assert.equal(v.relations['mechanism-of'].symmetry, 'asymmetric');
  assert.equal(v.relations.awaits.cycleIsFinding, true);
  assert.equal(v.relations['assessed-none'].terminal, true);
  assert.equal(v.relations['assessed-none'].symmetry, 'none');
  assert.equal(v.relations.unassessed.terminal, true);
  for (const [k, def] of Object.entries(v.relations)) {
    assert.ok(def.test && def.test.length > 40, `${k}: a relation's test must be a sentence a second rater can apply`);
  }
});

test('the R1/R6 deadlock is present in the data and is not an error', () => {
  const doc = registry();
  const r1 = doc.classes.find((c) => c.id === 'R1').rca;
  const r6 = doc.classes.find((c) => c.id === 'R6').rca;
  assert.ok(r1.some((e) => e.relation === 'awaits' && e.to === 'R6'));
  assert.ok(r6.some((e) => e.relation === 'awaits' && e.to === 'R1'));
  assert.deepEqual(validate(doc), [], 'the deadlock must survive validation — it is the finding');
});

test('unassessed is a ratchet: it may fall as classes are judged, never rise', () => {
  // 164 of 173 at the axis's first landing. Grey is the honest state and must be VISIBLE, so it is
  // counted here rather than left as prose in rcaProvenance.caveat, which nothing reads. Without a
  // ceiling a new class arrives carrying `unassessed` and the unjudged population grows silently.
  // 163 from 2026-09-07: G7 was judged and declared same-defect-as R6, quoting G7's own predicate,
  // which names R6 and says the two share a mechanism. R6 was already judged, so the symmetric
  // closure cost nothing. Banked here the same hour, because this assertion's whole point is that
  // progress the ratchet does not record is progress that can silently reverse.
  const CEILING = 163;
  const doc = registry();
  const n = doc.classes.filter((c) => c.rca.some((e) => e.relation === 'unassessed')).length;
  assert.ok(n <= CEILING,
    `${n} classes are unassessed, above the ceiling of ${CEILING}. Judge the new classes' outgoing edges, or lower nothing and raise this deliberately.`);
  if (n < CEILING) {
    assert.fail(`${n} unassessed, below the ceiling of ${CEILING} — lower CEILING to ${n} to bank the progress, so it cannot silently regress`);
  }
});
