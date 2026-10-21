#!/usr/bin/env node
// Concept lattice over failure-taxonomy classes.
//
// The registry has no field for subsumption: 199 classes, and every "Distinct
// from K5, where ..." lives in free prose inside a description. That order is
// real but unqueryable, uncheckable for cycles, and it rots silently on every
// edit. This encodes each class into a controlled attribute vocabulary and
// closes the incidence relation, so "is C34 a specialisation of C13" is decided
// by extent containment rather than by argument.
//
// Reads only. The registry belongs to the remediation-audit stream; nothing here
// writes monitor/failure-taxonomy.json.
//
// usage:
//   node bin/taxonomy-lattice.mjs --check          validate + run the prose control
//   node bin/taxonomy-lattice.mjs --json           concepts and cover edges
//   node bin/taxonomy-lattice.mjs --html <path>    self-contained artefact

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeAtomic } from '../monitor/lockfile.mjs';
import { concepts, hasse, indistinguishable } from './lib/fca.mjs';
import { renderLatticeHtml } from './lib/lattice-html.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Env read at call time, never at module load, so a test can point this at a fixture.
const attrsPath = () =>
  process.env.CW_LATTICE_ATTRS || join(REPO, 'evaluations/lattice/attributes.json');

export function loadAttributes(path = attrsPath()) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`lattice: no encoding file at ${path}`);
    throw new Error(`lattice: cannot read ${path}: ${err.message}`); // not an empty store
  }
  return JSON.parse(raw);
}

/**
 * Refuse an encoding that leaves the vocabulary.
 *
 * An off-vocabulary value would silently become its own attribute, separating
 * two classes for a reason nobody chose — the lattice would look sharper
 * precisely where the encoding was sloppiest.
 */
export const UNCONSTRAINED = '*';

export function validate({ schema, encodings }) {
  const problems = [];
  const dims = Object.keys(schema);

  for (const [id, enc] of Object.entries(encodings)) {
    // Every dimension must be PRESENT. Generality is stated with '*', never by
    // omitting the key — otherwise "this class is general in this dimension" and
    // "nobody has encoded this dimension yet" are the same absence, and the
    // lattice would report an unrated gap as a subsumption.
    for (const dim of dims) {
      if (!enc[dim] || enc[dim].length === 0) problems.push(`${id}: missing dimension '${dim}'`);
    }
    for (const [dim, values] of Object.entries(enc)) {
      if (!schema[dim]) {
        problems.push(`${id}: unknown dimension '${dim}'`);
        continue;
      }
      if (values.includes(UNCONSTRAINED) && values.length > 1) {
        problems.push(`${id}: '${dim}' mixes '${UNCONSTRAINED}' with concrete values`);
      }
      for (const v of values) {
        if (v === UNCONSTRAINED) continue;
        if (!schema[dim].values.includes(v)) {
          problems.push(`${id}: '${v}' is not in the '${dim}' vocabulary`);
        }
      }
    }
  }
  return problems;
}

/** Flatten an encoding to prefixed attributes: actor:guard, artefact:store, ... */
export function toObjects(encodings) {
  const objects = {};
  for (const [id, enc] of Object.entries(encodings)) {
    const attrs = [];
    for (const [dim, values] of Object.entries(enc)) {
      // '*' contributes no attribute, so a class general in a dimension gets a
      // SMALLER intent — which is what makes it sit above its specialisations
      // under extent containment.
      for (const v of values) if (v !== UNCONSTRAINED) attrs.push(`${dim}:${v}`);
    }
    objects[id] = attrs.sort();
  }
  return objects;
}

/**
 * Distinctness pairs the registry already asserts, in prose.
 *
 * These are the control: the operator wrote them, so an encoding that collapses
 * one is too coarse. It is a second witness that cannot share the encoding's
 * failure mode, because it was produced by a human reading the mechanisms.
 */
export function proseDistinctions(repo = REPO) {
  const out = execFileSync(
    process.execPath,
    [
      join(repo, 'bin/taxonomy-db.mjs'),
      '--sql',
      "SELECT id, description FROM taxonomy_class WHERE description LIKE '%istinct from%' OR description LIKE '%eparable from%' OR description LIKE '%Unlike %'",
    ],
    { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const pairs = [];
  for (const row of JSON.parse(out)) {
    const re = /(?:istinct from|eparable from|Unlike)\s+([A-Z]\d+)((?:\s*(?:,|and)\s*(?:from\s*)?[A-Z]\d+)*)/g;
    for (const m of row.description.matchAll(re)) {
      const ids = new Set([m[1]]);
      for (const y of (m[2] || '').matchAll(/[A-Z]\d+/g)) ids.add(y[0]);
      for (const other of ids) pairs.push([row.id, other]);
    }
  }
  return pairs;
}

/**
 * Class-to-class subsumption: [special, general] where the special class carries
 * every attribute of the general one and at least one more.
 *
 * This is the question the lattice exists to answer — "is C34 a specialisation
 * of C13" — decided by containment rather than by argument. It is EMPTY whenever
 * every class fixes every dimension, because equal-size intents cannot contain
 * one another; generality has to be encoded as '*' for any of this to appear.
 */
export function subsumptions(objects) {
  const ids = Object.keys(objects).sort();
  const sets = new Map(ids.map((id) => [id, new Set(objects[id])]));
  const out = [];
  for (const a of ids) {
    for (const b of ids) {
      if (a === b) continue;
      const A = sets.get(a);
      const B = sets.get(b);
      if (A.size <= B.size) continue;
      let contains = true;
      for (const x of B) {
        if (!A.has(x)) {
          contains = false;
          break;
        }
      }
      if (contains) out.push([a, b]);
    }
  }
  return out;
}

/**
 * Attribute values carried by exactly one class.
 *
 * The counter-metric to "everything separated". A vocabulary grown until each
 * class gets its own value separates perfectly and says nothing — a singleton
 * is a label, not a discriminator. Read it against the collision count: zero
 * collisions bought by many singletons is a tautology, not a result.
 */
export function singletonValues(objects) {
  const count = new Map();
  for (const attrs of Object.values(objects)) {
    for (const a of attrs) count.set(a, (count.get(a) || 0) + 1);
  }
  return [...count.entries()]
    .filter(([, n]) => n === 1)
    .map(([a]) => a)
    .sort();
}

/** Control pairs that the encoding failed to separate. */
export function collisions(pairs, objects) {
  const groups = indistinguishable(objects);
  const groupOf = new Map();
  groups.forEach((g, i) => g.forEach((id) => groupOf.set(id, i)));

  const missed = [];
  for (const [a, b] of pairs) {
    if (!objects[a] || !objects[b]) continue; // outside the encoded slice
    if (groupOf.has(a) && groupOf.get(a) === groupOf.get(b)) missed.push([a, b]);
  }
  return missed;
}

const taxonomyPath = () =>
  process.env.CW_TAXONOMY_JSON || join(REPO, 'monitor/failure-taxonomy.json');

const JUDGED = new Set(['same-defect-as', 'mechanism-of', 'enables', 'masks', 'awaits']);

export function rcaEdges(path = taxonomyPath()) {
  const t = JSON.parse(readFileSync(path, 'utf8'));
  const out = [];
  for (const c of t.classes) {
    for (const e of c.rca || []) if (JUDGED.has(e.relation)) out.push({ from: c.id, relation: e.relation, to: e.to });
  }
  return out;
}

const containsAll = (a, b) => b.every((x) => a.includes(x));

// Positive control: a mechanism-of subject must specialise its target.
// Contested edges are reported but not gated: raters rejected them, so reproducing one would encode a disputed claim.
export function mechanismControl(edges, objects, contested = []) {
  const key = (e) => `${e.from}>${e.to}`;
  const disputed = new Map(contested.map((c) => [key(c), c]));
  const inSlice = edges.filter((e) => e.relation === 'mechanism-of' && objects[e.from] && objects[e.to]);
  const all = inSlice.filter((e) => !disputed.has(key(e)));
  const contestedInSlice = inSlice.filter((e) => disputed.has(key(e))).map((e) => ({ ...e, basis: disputed.get(key(e)).basis }));
  const specialised = [];
  const missed = [];
  for (const e of all) {
    const s = objects[e.from];
    const t = objects[e.to];
    if (s.length > t.length && containsAll(s, t)) specialised.push(e);
    else if (s.length === t.length && containsAll(s, t)) missed.push({ ...e, outcome: 'identical' });
    else if (t.length > s.length && containsAll(t, s)) missed.push({ ...e, outcome: 'inverted' });
    else missed.push({ ...e, outcome: `unrelated, target needs ${t.filter((x) => !s.includes(x)).join(' ')}` });
  }
  return { all, specialised, missed, contested: contestedInSlice };
}

// Same mechanism at another altitude: expect shared observation and remedy.
export function sameDefectShare(edges, objects) {
  const seen = new Set();
  const all = [];
  for (const e of edges) {
    if (e.relation !== 'same-defect-as' || !objects[e.from] || !objects[e.to]) continue;
    const key = [e.from, e.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    all.push([e.from, e.to].sort());
  }
  const dimShared = (a, b, dim) => objects[a].some((x) => x.startsWith(`${dim}:`) && objects[b].includes(x));
  const sharing = all.filter(([a, b]) => dimShared(a, b, 'observation') && dimShared(a, b, 'remedy'));
  const apart = all.filter((p) => !sharing.includes(p));
  return { all, sharing, apart };
}

export function orderedDistinct(pairs, subs) {
  const ordered = new Set(subs.map(([s, g]) => `${s}>${g}`));
  const out = [];
  for (const [a, b] of pairs) {
    if (ordered.has(`${a}>${b}`)) out.push([a, b]);
    if (ordered.has(`${b}>${a}`)) out.push([b, a]);
  }
  return out;
}

export function unbackedSubsumptions(subs, edges) {
  const backed = new Set(edges.filter((e) => e.relation === 'mechanism-of').map((e) => `${e.from}>${e.to}`));
  return subs.filter(([s, g]) => !backed.has(`${s}>${g}`));
}

export function fanOut(subs) {
  const n = new Map();
  for (const [, g] of subs) n.set(g, (n.get(g) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function main() {
  const args = process.argv.slice(2);
  const data = loadAttributes();

  const problems = validate(data);
  if (problems.length) {
    console.error(`lattice: REFUSED — ${problems.length} encoding problem(s):`);
    for (const p of problems.slice(0, 20)) console.error(`  ${p}`);
    process.exit(2);
  }

  const objects = toObjects(data.encodings);
  const ids = Object.keys(objects).sort();
  const cs = concepts(objects);
  const edges = hasse(cs);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ concepts: cs, edges }, null, 2));
    return;
  }

  const htmlAt = args.indexOf('--html');
  if (htmlAt >= 0) {
    const out = args[htmlAt + 1];
    if (!out || out.startsWith('--')) {
      console.error('lattice: --html needs an output path');
      process.exit(2);
    }
    const taxonomy = JSON.parse(readFileSync(taxonomyPath(), 'utf8'));
    const html = renderLatticeHtml({
      objects,
      subs: subsumptions(objects),
      groups: indistinguishable(objects),
      contested: data.contestedRca || [],
      names: new Map(taxonomy.classes.map((c) => [c.id, c.name])),
      registryVersion: taxonomy.version,
      backed: rcaEdges().filter((e) => e.relation === 'mechanism-of').map((e) => [e.from, e.to]),
      now: process.env.CW_NOW || null,
    });
    writeAtomic(out, html);
    console.log(`lattice: wrote ${out} (${html.length} bytes)`);
    return;
  }

  const pairs = proseDistinctions();
  const inSlice = pairs.filter(([a, b]) => objects[a] && objects[b]);
  const missed = collisions(pairs, objects);
  const collapsed = indistinguishable(objects);
  const rca = rcaEdges();
  const mech = mechanismControl(rca, objects, data.contestedRca || []);
  const sda = sameDefectShare(rca, objects);

  console.log(`encoded classes:      ${ids.length}`);
  console.log(`attributes:           ${new Set(Object.values(objects).flat()).size}`);
  console.log(`formal concepts:      ${cs.length}`);
  console.log(`cover edges:          ${edges.length}`);
  const singles = singletonValues(objects);
  const attrCount = new Set(Object.values(objects).flat()).size;
  console.log(
    `singleton values:     ${singles.length} of ${attrCount} (${((singles.length / attrCount) * 100).toFixed(0)}% discriminate nothing)`,
  );
  console.log(`raters:               ${(data.raters || []).join(', ') || 'NONE RECORDED'}`);

  const subs = subsumptions(objects);
  console.log(`\nclass subsumptions:   ${subs.length} (order = X carries Y's mechanism and is more specific)`);
  if (subs.length === 0) {
    console.log(
      "  NONE — every class fixes every dimension, so all intents are the same\n" +
        "  size and containment is impossible. The order this tool exists to find\n" +
        "  is precluded by the encoding, not absent from the taxonomy. Encode\n" +
        `  generality as '${UNCONSTRAINED}' in the dimensions a class does not constrain.`,
    );
  } else {
    for (const [s, g] of subs.slice(0, 15)) console.log(`  ${s} specialises ${g}`);
    if (subs.length > 15) console.log(`  ... and ${subs.length - 15} more`);
  }
  console.log('');
  console.log(`prose control pairs:  ${inSlice.length} of ${pairs.length} in the encoded slice`);
  console.log(`separated:            ${inSlice.length - missed.length}`);
  console.log(`COLLAPSED:            ${missed.length}`);

  console.log(`\nrca mechanism-of:     ${mech.all.length} in the encoded slice`);
  console.log(`specialised:          ${mech.specialised.length}`);
  console.log(`NOT REPRODUCED:       ${mech.missed.length}`);
  console.log(`contested, not gated: ${mech.contested.length}`);
  for (const c of mech.contested) console.log(`  ${c.from} mechanism-of ${c.to}: ${c.basis}`);
  for (const r of mech.missed) console.log(`  ${r.from} mechanism-of ${r.to}: ${r.outcome}`);

  console.log(`\nrca same-defect-as:   ${sda.all.length} in the encoded slice`);
  console.log(`share observation and remedy: ${sda.sharing.length}`);
  for (const [a, b] of sda.apart) console.log(`  apart: ${a} ~ ${b}`);

  const review = orderedDistinct(pairs, subs);
  if (review.length) {
    console.log('\nregistry says distinct, lattice orders them (review, not a failure):');
    for (const [s, g] of review) console.log(`  ${s} specialises ${g}`);
  }

  const unbacked = unbackedSubsumptions(subs, rca);
  console.log(`\nsubsumptions with no rca edge behind them: ${unbacked.length} (proposals)`);
  for (const [s, g] of unbacked.slice(0, 20)) console.log(`  ${s} specialises ${g}`);

  const fan = fanOut(subs).filter(([, n]) => n > 1);
  if (fan.length) {
    console.log('\ngeneral classes by descendant count:');
    for (const [g, n] of fan) console.log(`  ${g}: ${n}`);
  }

  if (collapsed.length) {
    console.log('\nclasses no attribute separates:');
    for (const g of collapsed) console.log(`  ${g.join(' = ')}`);
  }
  if (missed.length) {
    console.log('\nthe registry calls these distinct, the encoding does not:');
    for (const [a, b] of missed) console.log(`  ${a} vs ${b}`);
  }
  if (missed.length || mech.missed.length) process.exit(1);
}

if (isMainModule(import.meta.url)) main();
