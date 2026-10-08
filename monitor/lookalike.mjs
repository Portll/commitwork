#!/usr/bin/env node
// monitor/lookalike.mjs — names built to survive a human skim.
//
// THE OBSERVATION. Amnesty's process table is the clearest small example of the technique in the
// Pegasus report: `roleaccountd`, `roleaboutd`, `stagingd`, `gatekeeperd`, `msgacntd`, `fmld`,
// `pcsd` — forty-odd names, each shaped to pass as an iOS system daemon. The report's own
// conclusion is that they "seem to be simply disguised to appear as legitimate iOS system
// processes, perhaps to fool forensic investigators". The defence is not a signature list; it is
// noticing that a name is one edit away from a name that belongs.
//
// The live version of this threat for a repository fleet is the dependency name: typosquats,
// homoglyph substitutions, separator swaps, and scope confusion. Same mechanic, same defence.
//
// DIRECTION COMES FROM THE DECLARED SET, AND IS NEVER INFERRED. Edit distance is symmetric:
// `reqeusts` and `requests` are one apart, and nothing in the arithmetic says which is the
// impostor. Every implementation that guesses gets this wrong eventually, usually by treating
// popularity or first-seen as authority — which is precisely what an attacker manipulates.
//
// fact: the legitimate set is an INPUT declared by a human — near a declared name is a FINDING, and a candidate that IS declared is not one however near it sits to another (`lodash.get`/`lodash.set` are one edit apart and both real) (expiry: never, prev: wrong)
// fact: two names near each other with NEITHER declared is `unknown('no-reference')`, compared against nothing / reporting it as a squat is the unsupported finding defect, and the fleet's lockfiles hold enough near-neighbours to bury a real finding under them (expiry: never, prev: wrong)
//
// DISTANCE SCALES WITH LENGTH. One edit in a four-character name is a different event from one
// edit in a twenty-character name; a fixed threshold either misses short squats or floods on long
// ones.

import { readFileSync } from 'node:fs';
import { unknown } from './unknown.mjs';
import { claim, render as renderClaim } from './denominator.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const isMain = isMainModule(import.meta.url);

/** The closed class vocabulary. Each is a distinct MECHANISM, not a distinct severity. */
export const LOOKALIKE = Object.freeze({
  HOMOGLYPH: 'homoglyph',      // identical once confusable characters are folded
  SEPARATOR: 'separator',      // identical once -, _, . are folded
  SCOPE: 'scope-confusion',    // @scope/name against scope-name, or a bare name against a scoped one
  TYPO: 'typo',                // within the length-scaled edit distance
});

/**
 * Confusable folding. Deliberately small and deliberately explicit: a full Unicode confusables
 * table folds so aggressively that unrelated names collide. These are the substitutions that
 * actually appear in published npm/PyPI squats.
 */
const CONFUSABLES = [
  [/[0]/g, 'o'], [/[1|l]/g, 'i'], [/[5]/g, 's'], [/[3]/g, 'e'], [/[4]/g, 'a'],
  [/rn/g, 'm'], [/vv/g, 'w'], [/cl/g, 'd'],
  // Latin-lookalike Cyrillic and Greek, the classic homograph carriers.
  [/[а]/g, 'a'], [/[е]/g, 'e'], [/[о]/g, 'o'], [/[р]/g, 'p'],
  [/[с]/g, 'c'], [/[х]/g, 'x'], [/[ο]/g, 'o'],
];

export function foldConfusables(name) {
  let s = String(name).toLowerCase();
  for (const [re, to] of CONFUSABLES) s = s.replace(re, to);
  return s;
}

/** Separator folding only — `.`, `-`, `_` and nothing else. */
export const foldSeparators = (name) => String(name).toLowerCase().replace(/[-_.]/g, '');

/** Scope folding: `@scope/name` and `scope-name` and `scope_name` all reduce to `scope/name`. */
export function foldScope(name) {
  const s = String(name).toLowerCase();
  const scoped = s.match(/^@([^/]+)\/(.+)$/);
  if (scoped) return `${scoped[1]}/${scoped[2]}`;
  const dashed = s.match(/^([a-z0-9]+)[-_](.+)$/);
  return dashed ? `${dashed[1]}/${dashed[2]}` : s;
}

/** Damerau-Levenshtein (optimal string alignment) — transposition counts as one edit, because
 *  `reqeusts` is one keyboard slip and two Levenshtein edits. */
export function editDistance(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/**
 * The length-scaled threshold. A four-character name admits one edit; a long one admits two, and
 * never more — beyond two edits the pair stops being a lookalike and starts being two names.
 */
export function maxDistanceFor(name) {
  const len = String(name).replace(/^@[^/]+\//, '').length;
  if (len <= 4) return 1;
  if (len <= 10) return 1;
  return 2;
}

/**
 * Compare one candidate against the declared-legitimate set.
 *
 * Returns an array of findings (usually empty), or an `unknown` when the candidate cannot be
 * judged. `legit` must be a Set of declared names — passing the observed corpus as its own
 * legitimate set is the mistake this signature is shaped to make awkward.
 */
export function classify(candidate, legit) {
  if (!(legit instanceof Set)) throw new Error('lookalike: `legit` must be a Set of DECLARED names, not an inferred one');
  if (!legit.size) return unknown('no-reference', 'no declared-legitimate set to compare against');

  const c = String(candidate);
  // A declared name is not an impostor, however close it sits to another declared name.
  if (legit.has(c)) return [];

  const out = [];
  const cFoldSep = foldSeparators(c);
  const cFoldCon = foldConfusables(c);
  const cFoldScope = foldScope(c);

  for (const l of legit) {
    if (l === c) continue;
    let cls = null;
    if (foldConfusables(l) === cFoldCon) cls = LOOKALIKE.HOMOGLYPH;
    else if (foldSeparators(l) === cFoldSep) cls = LOOKALIKE.SEPARATOR;
    else if (foldScope(l) === cFoldScope) cls = LOOKALIKE.SCOPE;
    else {
      const d = editDistance(c.toLowerCase(), l.toLowerCase());
      if (d > 0 && d <= Math.min(maxDistanceFor(c), maxDistanceFor(l))) cls = LOOKALIKE.TYPO;
    }
    if (cls) out.push({ candidate: c, legitimate: l, class: cls, distance: editDistance(c.toLowerCase(), l.toLowerCase()) });
  }
  // Nearest first, and a stable tie-break so the report does not reshuffle between runs.
  return out.sort((a, b) => a.distance - b.distance || (a.legitimate < b.legitimate ? -1 : 1));
}

/**
 * Sweep a corpus. `observed` is `[{name, where}]`; `legit` is the declared Set.
 *
 * THE COVERAGE STATEMENT, AND WHY IT IS THE SHAPE IT IS. The tempting field here is "names this
 * module could not rule on", and it is a field that can never be non-zero: with a non-empty
 * declared set every name is compared, so every name is ruled on. Writing it anyway would be a
 * number wired to nothing, which is the defect class this repository names most often.
 *
 * fact: a name neither declared nor near anything declared was compared against a set that may simply not contain its legitimate counterpart, so for that name "no finding" carries NO information (expiry: never, prev: unknown)
 * fact: the honest denominator is therefore `declaredLegitimate` over `observed`, returned as a monitor/denominator.mjs claim / that is what stops a caller rendering the finding count without it (expiry: never, prev: missing)
 */
export function sweepLookalikes(observed, legit, { cap = 200 } = {}) {
  const findings = [];
  const seen = new Set();
  let declared = 0;
  let noDeclaredNeighbour = 0;

  for (const o of observed) {
    const name = typeof o === 'string' ? o : o.name;
    if (legit.has(name)) { declared += 1; continue; }
    const r = classify(name, legit);
    if (r.unknown || !r.length) { noDeclaredNeighbour += 1; continue; }
    for (const f of r) {
      // Identity is (candidate, legitimate, class) — never the place it was seen, per the house
      // rule. The same squat in a second lockfile is the same finding having spread.
      const key = `${f.candidate}|${f.legitimate}|${f.class}`;
      if (seen.has(key)) {
        const prev = findings.find((x) => `${x.candidate}|${x.legitimate}|${x.class}` === key);
        prev.occurrences += 1;
        if (prev.where.length < 20 && o.where != null) prev.where.push(o.where);
        continue;
      }
      seen.add(key);
      findings.push({ ...f, occurrences: 1, where: o.where != null ? [o.where] : [] });
    }
  }

  findings.sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1));

  return {
    observed: observed.length,
    declaredLegitimate: declared,
    // Names compared against a set that may not contain their counterpart. Not a finding count,
    // and not a clean count either — it is the size of the region this declared set cannot speak
    // about. See the header.
    noDeclaredNeighbour,
    coverage: claim({
      count: findings.length, observed: declared, population: observed.length,
      unit: 'name', of: 'lookalike',
    }),
    findings: findings.slice(0, cap),
    findingCount: findings.length,
    truncated: Math.max(0, findings.length - cap),
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const [legitPath, observedPath] = argv.filter((a) => !a.startsWith('--'));
  if (!legitPath || !observedPath) {
    console.error('usage: node monitor/lookalike.mjs <declared-legit.json> <observed.json> [--json]');
    console.error('  declared-legit.json  ["name", ...]           — DECLARED by a human, never derived from the corpus');
    console.error('  observed.json        [{"name":..,"where":..}] or ["name", ...]');
    process.exitCode = 2;
    return;
  }
  const legit = new Set(JSON.parse(readFileSync(legitPath, 'utf8')));
  const observedRaw = JSON.parse(readFileSync(observedPath, 'utf8'));
  const observed = observedRaw.map((o) => (typeof o === 'string' ? { name: o, where: null } : o));

  const r = sweepLookalikes(observed, legit);
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return; }

  console.log(`lookalike: ${r.findingCount} finding(s) over ${r.observed} observed name(s) against ${legit.size} declared`);
  for (const f of r.findings.slice(0, 30)) {
    console.log(`  ${f.class.toUpperCase().padEnd(16)} ${f.candidate}  ~  ${f.legitimate}  (distance ${f.distance}, ×${f.occurrences})`
      + `${f.where.length ? `  ${f.where.slice(0, 3).join(', ')}` : ''}`);
  }
  if (r.truncated) console.log(`  … ${r.truncated} more in --json`);
  console.log(`lookalike: ${renderClaim(r.coverage)}`);
  console.log(`lookalike: ${r.noDeclaredNeighbour} observed name(s) had no declared neighbour — for those, a null result `
    + 'says only that this declared set does not contain their counterpart');
  if (r.findingCount) process.exitCode = 1;
}

if (isMain) main();
