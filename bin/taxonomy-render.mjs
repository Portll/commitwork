#!/usr/bin/env node
/**
 * taxonomy-render.mjs — render monitor/failure-taxonomy.json as a self-contained reference page.
 *
 * v4 of the failure taxonomy is a REGISTRY, not an essay: the narrative, warrants, mitigations and
 * incident accounts stay in v1-v3, and this renders the one thing those cannot give a reader or a
 * program — every class, in family and number order, with a stable machine name. It is also v1's
 * mitigation #11: with the classes as data, "how many are there" and "which family holds this id"
 * are computed rather than asserted, which is the defect (M7) the prose editions kept committing.
 *
 * Self-contained by house rule: no CDN, no external font, file:// safe. Print CSS included so the
 * same file is the PDF source.
 *
 * Usage: taxonomy-render.mjs [--json <path>] [--out <path>] [--check] [--dark]
 *   --check  validate the registry (id/prefix agreement, machine-name uniqueness, gaps, stpa) and exit
 * Env: CW_TAXONOMY_JSON (read at call time; --json wins over it).
 */
import { isMainModule } from '../lib/is-main.mjs';
import { esc } from '../lib/html-escape.mjs';
import { readFileSync } from 'node:fs';
import { redactForPublish } from '../lib/publish-redactions.mjs';
import { redactScannersForPublish } from '../lib/publish-scanner-redactions.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../monitor/registry.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { LIGHT as PAPER_LIGHT, DARK as PAPER_DARK } from '../lib/brand-tokens.mjs';
import { snapshotBeforeWrite } from '../lib/docsite-versions.mjs';
import { renderShellPage, sha256Hex } from '../lib/docsite-page.mjs';
import { loadManifest, docsiteNav } from '../lib/docsite-manifest.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = resolve(REPO, 'schema', 'failure-taxonomy.schema.json');
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};

const STPA_MAPS = ['loops', 'uca', 'cause'];
const STPA_ENTRY_KEYS = ['loop', 'uca', 'cause'];
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * The stpa axis: vocabulary first, then every class against it. THE VOCABULARY IS READ, NEVER
 * RESTATED — the same rule as scaleBounds, for the same reason. Each value must carry a `test` (the
 * sentence a second rater applies), because a value nobody can re-judge is a label, and the 1.27
 * ruling bars labels with no check. `uca: "none"` is a value; an absent or empty `stpa` is the
 * unclassified state and fails.
 */
function validateStpa({ classes, stpaVocabulary: V, stpaProvenance: P }, errors) {
  if (!isPlainObject(V)) {
    errors.push('stpaVocabulary is missing — loop/uca/cause are read from it, never restated, and without it no stpa entry can be judged');
    return;
  }
  const known = {};
  for (const m of STPA_MAPS) {
    if (!isPlainObject(V[m]) || Object.keys(V[m]).length === 0) { errors.push(`stpaVocabulary.${m} is missing or empty`); continue; }
    for (const [k, def] of Object.entries(V[m])) {
      if (!isPlainObject(def) || !nonEmpty(def.test)) errors.push(`stpaVocabulary.${m}.${k}: no test — a value a second rater cannot apply is a label, not a classification`);
      if (m === 'loops') for (const f of ['controller', 'controls']) if (!isPlainObject(def) || !nonEmpty(def[f])) errors.push(`stpaVocabulary.loops.${k}: missing ${f}`);
    }
    known[m] = new Set(Object.keys(V[m]));
  }
  if (!isPlainObject(P) || ['rater', 'date', 'method', 'caveat'].some((f) => !nonEmpty(P[f]))) {
    errors.push('stpaProvenance is missing or incomplete — rater, date, method and caveat are required; a score with no witness cannot be re-rated');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(P.date)) {
    errors.push(`stpaProvenance.date "${P.date}" is not YYYY-MM-DD`);
  }
  if (STPA_MAPS.some((m) => !known[m])) return;   // no vocabulary to judge against; the errors above say so

  for (const c of classes) {
    if (!Array.isArray(c.stpa) || c.stpa.length === 0) { errors.push(`${c.id}: no stpa entries — uca "none" is a value, not an omission`); continue; }
    const loops = new Set();
    c.stpa.forEach((e, i) => {
      if (!isPlainObject(e)) { errors.push(`${c.id}: stpa[${i}] is not an object`); return; }
      for (const k of Object.keys(e)) if (!STPA_ENTRY_KEYS.includes(k)) errors.push(`${c.id}: stpa[${i}] carries unknown key "${k}"`);
      if (!known.loops.has(e.loop)) errors.push(`${c.id}: stpa[${i}].loop "${e.loop}" is not in stpaVocabulary.loops`);
      if (!known.uca.has(e.uca)) errors.push(`${c.id}: stpa[${i}].uca "${e.uca}" is not in stpaVocabulary.uca`);
      if (!known.cause.has(e.cause)) errors.push(`${c.id}: stpa[${i}].cause "${e.cause}" is not in stpaVocabulary.cause`);
      if (loops.has(e.loop)) errors.push(`${c.id}: loop "${e.loop}" appears twice — one judgement per loop per class`);
      loops.add(e.loop);
    });
  }
}

/**
 * The rca axis: causal edges between classes, over the closed relation set in rcaVocabulary. Same
 * rule as stpa — THE VOCABULARY IS READ, NEVER RESTATED — and the same treatment of absence: an
 * empty rca fails, because `unassessed` is a value.
 *
 * THE VOCABULARY IS ALSO VALIDATED, which the first cut of this function did not do, and that was
 * its worst defect. Because the checks below read `symmetry`, `crossesFamily` and `terminal` OUT of
 * the vocabulary as conditionals, a typo in a modifier key silently switched its rule OFF and the
 * registry still reported OK — `crossesFamilies` disabled the family check, `symetric` disabled
 * every closure check. "Read, never restate" removes copy-drift and installs a single point of
 * undetectable disablement in its place; the cure is to close the vocabulary's OWN key and value
 * sets, not to go back to restating.
 *
 * The checks come in two kinds and the second kind was entirely missing. Per-entry rules ask "is
 * this value legal here". Set rules ask what a relation's algebra requires — closure, transitivity,
 * acyclicity, uniqueness, mutual exclusion — and a per-value `test:` sentence has nowhere to hang
 * those, which is exactly why they were not written. A mirror probe of 12 such properties caught 1.
 *
 * `awaits` is the one relation exempt from acyclicity, and it now declares that exemption in DATA
 * (`cycleIsFinding: true`) rather than in a comment. The comment that stood here claimed a cycle
 * check existed for `enables` and cited its own exemption from it. No such check existed. A rule
 * documented as real, used to justify an exception to itself, is R13 in the file that catalogues R13.
 */
function validateRca({ classes, rcaVocabulary: V, rcaProvenance: P }, errors) {
  if (!isPlainObject(V) || !isPlainObject(V.relations) || Object.keys(V.relations).length === 0) {
    errors.push('rcaVocabulary.relations is missing or empty — the relation set is read from it, never restated, and without it no edge can be judged');
    return;
  }
  if (!isPlainObject(V.symmetries) || Object.keys(V.symmetries).length === 0) {
    errors.push('rcaVocabulary.symmetries is missing or empty — symmetry decides how each relation is validated, so an open string there is an ungoverned control value');
    return;
  }
  for (const [k, def] of Object.entries(V.symmetries)) {
    if (!isPlainObject(def) || !nonEmpty(def.test)) errors.push(`rcaVocabulary.symmetries.${k}: no test`);
  }
  const SYM = new Set(Object.keys(V.symmetries));
  const RELKEYS = ['symmetry', 'test', 'crossesFamily', 'terminal', 'cycleIsFinding', 'transitive'];
  for (const [k, def] of Object.entries(V.relations)) {
    if (!isPlainObject(def)) { errors.push(`rcaVocabulary.relations.${k} is not an object`); continue; }
    for (const key of Object.keys(def)) {
      if (!RELKEYS.includes(key)) errors.push(`rcaVocabulary.relations.${k}: unknown key "${key}" — a modifier the validator does not read is a rule nobody enforces, and a typo here silently disables the rule it meant to set`);
    }
    if (!nonEmpty(def.test)) errors.push(`rcaVocabulary.relations.${k}: no test — a relation a second rater cannot apply is a label, not a classification`);
    if (!SYM.has(def.symmetry)) errors.push(`rcaVocabulary.relations.${k}: symmetry "${def.symmetry}" is not in rcaVocabulary.symmetries`);
    for (const flag of ['crossesFamily', 'terminal', 'cycleIsFinding', 'transitive']) {
      if (flag in def && def[flag] !== true) errors.push(`rcaVocabulary.relations.${k}.${flag} must be true when present, not ${JSON.stringify(def[flag])} — a falsy modifier reads as set and acts as unset`);
    }
    if (def.terminal && def.symmetry !== 'none') errors.push(`rcaVocabulary.relations.${k}: a terminal relation names no target, so its symmetry must be "none"`);
  }
  if (!isPlainObject(P) || ['rater', 'date', 'method', 'caveat'].some((f) => !nonEmpty(P[f]))) {
    errors.push('rcaProvenance is missing or incomplete — rater, date, method and caveat are required; an edge with no witness cannot be re-rated');
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(P.date)) {
    errors.push(`rcaProvenance.date "${P.date}" is not YYYY-MM-DD`);
  }

  const ids = new Set(classes.map((c) => c.id));
  const famOf = (id) => (/^[A-Z]+/.exec(id) || [''])[0];
  const edges = new Set();
  const pairs = new Map();

  for (const c of classes) {
    if (!Array.isArray(c.rca) || c.rca.length === 0) { errors.push(`${c.id}: no rca entries — "unassessed" is a value, not an omission`); continue; }
    if (c.rca.some((e) => isPlainObject(e) && V.relations[e.relation]?.terminal) && c.rca.length > 1) {
      errors.push(`${c.id}: a terminal relation stands alone — a terminal state beside a real edge makes the outgoing review contradict itself`);
    }
    c.rca.forEach((e, i) => {
      if (!isPlainObject(e)) { errors.push(`${c.id}: rca[${i}] is not an object`); return; }
      for (const k of Object.keys(e)) if (!['relation', 'to', 'basis'].includes(k)) errors.push(`${c.id}: rca[${i}] carries unknown key "${k}"`);
      const def = V.relations[e.relation];
      if (!def) { errors.push(`${c.id}: rca[${i}].relation "${e.relation}" is not in rcaVocabulary.relations`); return; }
      if (def.terminal) {
        if (e.to) errors.push(`${c.id}: rca[${i}] "${e.relation}" carries a target — a terminal relation names no other class`);
        if (e.basis) errors.push(`${c.id}: rca[${i}] "${e.relation}" carries a basis — a terminal state names no edge for that evidence to support`);
        return;
      }
      if (!nonEmpty(e.to)) { errors.push(`${c.id}: rca[${i}] "${e.relation}" has no target`); return; }
      if (!ids.has(e.to)) { errors.push(`${c.id}: rca[${i}] "${e.relation}" -> "${e.to}" is not a class id`); return; }
      if (e.to === c.id) { errors.push(`${c.id}: rca[${i}] "${e.relation}" points at itself`); return; }
      if (!isPlainObject(e.basis) || !nonEmpty(e.basis.doc) || !nonEmpty(e.basis.quote)) {
        errors.push(`${c.id}: rca[${i}] "${e.relation}" -> "${e.to}" needs a basis {doc, quote} — an edge with no cited evidence is the invented relation rcaProvenance promises this field does not carry`);
      }
      const key = `${c.id}|${e.relation}|${e.to}`;
      if (edges.has(key)) errors.push(`${c.id}: rca[${i}] "${e.relation}" -> "${e.to}" is listed twice`);
      edges.add(key);
      const pk = `${c.id}|${e.to}`;
      if (pairs.has(pk) && pairs.get(pk) !== e.relation) {
        errors.push(`${c.id} -> ${e.to}: both "${pairs.get(pk)}" and "${e.relation}" — the relations' own tests make them alternatives, so one ordered pair carries at most one`);
      }
      pairs.set(pk, e.relation);
      if (def.crossesFamily && famOf(c.id) === famOf(e.to)) {
        errors.push(`${c.id}: rca[${i}] "${e.relation}" -> "${e.to}" stays inside family "${famOf(c.id)}" — inside one family this relation is same-defect-as or nothing`);
      }
    });
  }

  // SET RULES. Everything above judges one entry; these judge what a relation's algebra requires.
  const out = (rel) => { const m = new Map(); for (const k of edges) { const [f, r, t] = k.split('|'); if (r === rel) (m.get(f) || m.set(f, []).get(f)).push(t); } return m; };
  for (const [rel, def] of Object.entries(V.relations)) {
    if (def.terminal) continue;
    const adj = out(rel);
    if (def.symmetry === 'symmetric') {
      for (const [f, ts] of adj) for (const t of ts) {
        if (!edges.has(`${t}|${rel}|${f}`)) errors.push(`${f}: "${rel}" -> "${t}" is not closed — a symmetric relation asserted from one end only is a claim its other end has never seen`);
      }
      if (def.transitive) {
        for (const [f, ts] of adj) for (const t of ts) for (const u of (adj.get(t) || [])) {
          if (u !== f && !edges.has(`${f}|${rel}|${u}`)) errors.push(`${f} ~ ${t} ~ ${u} but not ${f} ~ ${u} — "${rel}" declares transitive, and a partition with a missing side splits one defect into two that no single repair closes`);
        }
      }
    }
    if (def.symmetry === 'asymmetric' && !def.cycleIsFinding) {
      const WHITE = 0, GREY = 1, BLACK = 2; const col = new Map();
      const walk = (n, path) => {
        col.set(n, GREY);
        for (const m of (adj.get(n) || [])) {
          if (col.get(m) === GREY) { errors.push(`cycle in "${rel}": ${[...path, n, m].join(' -> ')} — an asymmetric relation that closes a loop asserts each end is prior to the other`); continue; }
          if ((col.get(m) || WHITE) === WHITE) walk(m, [...path, n]);
        }
        col.set(n, BLACK);
      };
      for (const n of adj.keys()) if ((col.get(n) || WHITE) === WHITE) walk(n, []);
    }
  }
}

/**
 * The mitigation axis: what each product does against a class, and what is proposed. Same rule as
 * stpa and rca — THE VOCABULARY IS READ, NEVER RESTATED — with one difference in the treatment of
 * absence: a class with no entries is legal and renders as NO RECORD, because the axis was seeded
 * on 2026-09-06 from the remediation register (19 classes) and from what each scoreBasis states a
 * product does, and everything else is genuinely unrecorded rather than judged. Grey is the honest
 * state for 180 rows; an error would have forced 180 fabrications. A proposal, by contrast, is
 * refused where nothing is left to propose against — closure at the ceiling or gain at the floor —
 * because a proposal on a closed class is the register scoring itself open.
 */
const MIT_KEYS = ['product', 'status', 'what', 'evidence', 'date'];
const PROP_KEYS = ['what', 'effort', 'date', 'by', 'closesTo'];
const EFFORTS = ['Low', 'Med', 'High'];
const MIT_LAYERS = ['remediation', 'help'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
function validateMitigations({ classes, mitigationVocabulary: V, mitigationProvenance: P, scaleBounds: B }, errors) {
  const carrying = classes.filter((c) => (c.mitigations || []).length || (c.proposals || []).length);
  if (!isPlainObject(V)) {
    if (carrying.length) errors.push(`mitigationVocabulary is missing while ${carrying.length} class(es) carry mitigations or proposals — product and status are read from it, never restated, and without it no entry can be judged`);
    return;
  }
  const known = {};
  for (const m of ['products', 'statuses']) {
    if (!isPlainObject(V[m]) || Object.keys(V[m]).length === 0) { errors.push(`mitigationVocabulary.${m} is missing or empty`); continue; }
    for (const [k, def] of Object.entries(V[m])) {
      if (!isPlainObject(def) || !nonEmpty(def.test)) errors.push(`mitigationVocabulary.${m}.${k}: no test — a value a second rater cannot apply is a label, not a classification`);
      if (m === 'products' && !MIT_LAYERS.includes(def && def.layer)) errors.push(`mitigationVocabulary.products.${k}: layer must be one of ${MIT_LAYERS.join('|')} — the page groups products by it, and a product on an unknown layer renders nowhere`);
    }
    known[m] = new Set(Object.keys(V[m]));
  }
  if (!isPlainObject(P) || ['rater', 'date', 'method', 'caveat'].some((f) => !nonEmpty(P[f]))) {
    errors.push('mitigationProvenance is missing or incomplete — rater, date, method and caveat are required; a record with no witness cannot be re-audited');
  } else if (!isDate(P.date)) {
    errors.push(`mitigationProvenance.date "${P.date}" is not YYYY-MM-DD`);
  }
  if (!known.products || !known.statuses) return;
  for (const c of classes) {
    (c.mitigations || []).forEach((e, i) => {
      if (!isPlainObject(e)) { errors.push(`${c.id}: mitigations[${i}] is not an object`); return; }
      for (const k of Object.keys(e)) if (!MIT_KEYS.includes(k)) errors.push(`${c.id}: mitigations[${i}] carries unknown key "${k}"`);
      if (!known.products.has(e.product)) errors.push(`${c.id}: mitigations[${i}].product "${e.product}" is not in mitigationVocabulary.products`);
      if (!known.statuses.has(e.status)) errors.push(`${c.id}: mitigations[${i}].status "${e.status}" is not in mitigationVocabulary.statuses`);
      for (const f of ['what', 'evidence']) if (!nonEmpty(e[f])) errors.push(`${c.id}: mitigations[${i}] has no ${f} — a record with no evidence is the unverified claim this axis exists to replace`);
      if (!isDate(e.date)) errors.push(`${c.id}: mitigations[${i}].date "${e.date}" is not YYYY-MM-DD`);
    });
    (c.proposals || []).forEach((e, i) => {
      if (!isPlainObject(e)) { errors.push(`${c.id}: proposals[${i}] is not an object`); return; }
      for (const k of Object.keys(e)) if (!PROP_KEYS.includes(k)) errors.push(`${c.id}: proposals[${i}] carries unknown key "${k}"`);
      if (!EFFORTS.includes(e.effort)) errors.push(`${c.id}: proposals[${i}].effort "${e.effort}" is not ${EFFORTS.join('|')}`);
      for (const f of ['what', 'by']) if (!nonEmpty(e[f])) errors.push(`${c.id}: proposals[${i}] has no ${f}`);
      if (!isDate(e.date)) errors.push(`${c.id}: proposals[${i}].date "${e.date}" is not YYYY-MM-DD`);
      if ('closesTo' in e && (!Number.isInteger(e.closesTo) || e.closesTo < 0 || (B && e.closesTo > B.closureMax))) errors.push(`${c.id}: proposals[${i}].closesTo ${JSON.stringify(e.closesTo)} is not a closure level`);
      if (B && (c.closure >= B.fullyClosed || c.gain <= B.gainMin)) errors.push(`${c.id}: proposals[${i}] on a class at closure ${c.closure} and gain ${c.gain} — a proposal belongs only where closure is possible and gain remains`);
    });
  }
}

/**
 * Validate before rendering. A registry that renders a malformed row as a pretty table is the same
 * false clean as everything it catalogues, so this runs on every render, not only under --check.
 */
export function validate(doc) {
  const { families, classes, scaleBounds } = doc;
  // Shape first, and UNCONDITIONALLY: the checks below bail out early on a missing scaleBounds, and
  // a shape check that a malformed registry can skip past is the false clean this file catalogues.
  // The schema is the only thing here that sees an unknown key, a mistyped field or a malformed id
  // in a section nothing renders (cycleLog, attributionPlan); it deliberately does NOT restate the
  // closure/gain range, which is read from scaleBounds below.
  const errors = validateAgainstSchema(doc, { path: SCHEMA }).errors;
  // THE BOUND IS READ, NEVER RESTATED. It was hardcoded here as 0-4 while the registry declared it
  // in scaleBounds and the sqlite CHECK restated it a third time — one bound, three copies, which
  // is how a consumer came to gate on `closure >= 5` against a 0-4 scale and pass vacuously for
  // every run. A validator that carries its own copy of the rule cannot detect the rule changing.
  const B = scaleBounds;
  if (!B || ['closureMin', 'closureMax', 'gainMin', 'gainMax', 'fullyClosed'].some((k) => typeof B[k] !== 'number')) {
    errors.push('scaleBounds is missing or incomplete — consumers read this to size their thresholds, and a guessed bound is how a guard stops guarding');
    return errors;
  }
  if (B.fullyClosed !== B.closureMax) {
    errors.push(`scaleBounds.fullyClosed (${B.fullyClosed}) must equal closureMax (${B.closureMax}) — a ceiling nothing can reach makes every closure assertion vacuous`);
  }
  if (!classes.some((c) => c.closure >= B.fullyClosed)) {
    errors.push(`no class reaches closure ${B.fullyClosed}; a consumer asserting on full closure would pass proving nothing`);
  }
  const byPrefix = new Map(families.map((f) => [f.prefix, f]));
  const seenMachine = new Set();
  const numbers = new Map();
  for (const c of classes) {
    const m = /^([A-Z])(\d+)$/.exec(c.id);
    if (!m) { errors.push(`${c.id}: id is not <PREFIX><number>`); continue; }
    const [, prefix, num] = m;
    const fam = byPrefix.get(prefix);
    if (!fam) { errors.push(`${c.id}: no family declares prefix ${prefix}`); continue; }
    if (!c.machine.startsWith(`${fam.key}.`)) errors.push(`${c.id}: machine name "${c.machine}" does not start with "${fam.key}."`);
    if (seenMachine.has(c.machine)) errors.push(`${c.id}: duplicate machine name "${c.machine}"`);
    seenMachine.add(c.machine);
    for (const f of ['name', 'description', 'example', 'layer', 'analogy'])
       if (!c[f]) errors.push(`${c.id}: missing ${f}`);
    for (const f of ['closure', 'gain']) {
      const lo = f === 'closure' ? B.closureMin : B.gainMin;
      const hi = f === 'closure' ? B.closureMax : B.gainMax;
      if (!Number.isInteger(c[f]) || c[f] < lo || c[f] > hi) errors.push(`${c.id}: ${f} is not an integer ${lo}-${hi}`);
    }
    if (!numbers.has(prefix)) numbers.set(prefix, []);
    numbers.get(prefix).push(Number(num));
  }
  for (const [prefix, nums] of numbers) {
    nums.sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) { errors.push(`${prefix}: numbering is not 1..n (gap or duplicate at ${prefix}${nums[i]})`); break; }
  }
  // The remediation dial is drawn on the same gain scale as a class's, so it is bounded by the same
  // numbers — from scaleBounds, not from a copy. This check moved here when the schema's hardcoded
  // 0-4 was deleted; the range is still enforced, it is just no longer enforced twice.
  for (const r of doc.remediations || []) {
    if (!Number.isInteger(r.gain) || r.gain < B.gainMin || r.gain > B.gainMax) {
      errors.push(`remediation #${r.rank}: gain is not an integer ${B.gainMin}-${B.gainMax}`);
    }
  }
  if ('intro' in doc && (!isPlainObject(doc.intro) || !nonEmpty(doc.intro.public) || !nonEmpty(doc.intro.academic))) {
    errors.push('intro must carry non-empty public and academic sentences — the page leads with both, and an empty one renders as a heading over nothing');
  }
  // A family declares the sentence a second rater applies, exactly as every vocabulary here does.
  // The schema enforces its presence; this enforces that it is not the PROPOSITION restated, which
  // is the cheapest way to satisfy the field while leaving the family unable to refuse anything.
  for (const f of families) {
    if (nonEmpty(f.test) && nonEmpty(f.proposition) && f.test.trim().toLowerCase().includes(f.proposition.trim().toLowerCase())) {
      errors.push(`family ${f.roman}: the test restates the proposition — a proposition says what is falsely believed, a test decides whether a class belongs, and a family that cannot refuse a member is how family VI absorbed eight rows about a different subject`);
    }
  }
  // Two lexical half-levers over the register's own text, armed 2026-09-06 (lever triage).
  // G14, class proliferation: a class minted without an argument against its nearest neighbour is
  // a class nothing separates. The minting rule lived in prose; this reads it. Either the label
  // or a named "Against <id>" satisfies it, because two rows argued the neighbours without the label.
  // G13, catalogue substitutes for repair: a closure that rose in a re-rate must cite an artefact
  // — a sha, a path, or a register item — because a score that moved on prose alone is the class.
  for (const c of classes) {
    const b = String(c.scoreBasis || '');
    if (/\bMinted\b/.test(b) && !/SEPARATING OBSERVATION|\bAgainst [A-Z]\d{1,2}\b/i.test(b)) {
      errors.push(`${c.id}: minted with no separating observation — name the nearest class and what separates this one from it (G14)`);
    }
    // The re-rate sentence shape is "closure a→b, gain c→d. <reason>"; the first cut of this regex
    // expected a full stop after the closure pair, matched nothing, and --check said OK — C26 in
    // the file that catalogues C26. The test's planted rise is what caught it.
    const RISE = /closure (\d)→(\d), gain \d→\d\.\s*([^]*?)(?=(?: RE-RATED |$))/g;
    let m;
    while ((m = RISE.exec(b))) {
      if (Number(m[2]) > Number(m[1]) && !/\b[0-9a-f]{7,40}\b|\b(?:bin|lib|monitor|admin|cra|mcp|flow|schema|docs|\.claude|\.githooks)\/[\w./-]+|\bR\d{1,2}\b|register item/i.test(m[3])) {
        errors.push(`${c.id}: closure rose ${m[1]}→${m[2]} with no sha, path or register item cited — a closure that moves on prose alone is G13`);
      }
    }
  }
  validateStpa(doc, errors);
  validateRca(doc, errors);
  validateMitigations(doc, errors);
  return errors;
}

// Machine names are one long token; left to itself the browser breaks them mid-word
// ("…absence_rendered_as_suc / cess"), which makes the identifier unreadable at exactly the moment
// someone is copying it. A break opportunity after each separator confines the wrap to . and _.
// <wbr> and NOT a zero-width space: U+200B is a CHARACTER, so it lands in the copy buffer and in the
// PDF text layer, and the identifier pasted out of the page then matches nothing — not a grep, not a
// SQL literal, not the registry it was copied from. Measured before this fix: 333 U+200B in the page
// and zero hits for a plain-text search of any machine name. <wbr> is an element; it breaks the line
// and copies as nothing.
const wrapId = (s) => esc(s).replace(/([._])/g, '$1<wbr>');
const num = (id) => Number(/\d+/.exec(id)[0]);

// The two scores, drawn as METERS rather than the rings that stood here until 2026-09-06: a ring
// at 13px made level 1 and level 3 the same silhouette at reading distance, and the two rings
// carried no label, so the page's most-cited numbers were the two a reader could not read.
// A meter is four segments on one baseline (2px surface gap between them, no borders), the
// filled ones in the level's step of a ONE-HUE ordinal ramp and the unfilled ones in a lighter
// step of the same ramp, so the state reads across the whole bar; the level word rides in the
// title and the number sits beside the bar in text ink. Level 0 is all track, never an absent mark.
//
// The ramps are derived from lib/brand-tokens.mjs — the ok green for closure, the gold accents for
// gain — by stepping OKLCH lightness at the token's hue and chroma, and each passed the ordinal
// ramp checks (monotone L, adjacent dL ≥ 0.06, light end ≥ 2:1 on the page surface, one hue) on
// 2026-09-06: closure light steps from #15803d, dark from #5fd08a; gain light from acc2 #6e5220
// (acc #96702e itself is too light to carry three lighter steps over bond paper) and dark from
// #c9a227. Hex values are pinned here rather than recomputed so two renders stay byte-identical.
const SCORE_RAMPS = Object.freeze({
  light: {
    closure: { fill: ['#5ebd76', '#48a863', '#319450', '#15803d'], track: '#a4d5ad' },
    gain: { fill: ['#c1a270', '#a48655', '#896c3b', '#6e5220'], track: '#e4d2b7' },
  },
  dark: {
    closure: { fill: ['#116e3d', '#00904f', '#3bb06c', '#5fd08a'], track: '#003c1d' },
    gain: { fill: ['#614c07', '#846701', '#a58418', '#c9a227'], track: '#312400' },
  },
});
const CLOSURE_WORDS = ['not solved', 'barely', 'part-solved', 'solved, unpinned', 'solved and pinned'];
const GAIN_WORDS = ['nothing on the table', 'marginal', 'worth doing', 'high', 'biggest available'];
const SEG_W = 9, SEG_GAP = 2, SEG_H = 5;
const rampVar = (kind) => (kind === 'closure' ? 'cl' : 'gn');
const levelWord = (kind, level) => { const w = kind === 'closure' ? CLOSURE_WORDS : GAIN_WORDS; return w[Math.min(level, w.length - 1)]; };
function meter(level, kind, scaleMax) {   // the meter geometry is the bound's fourth consumer
  const word = levelWord(kind, level);
  const w = scaleMax * SEG_W + (scaleMax - 1) * SEG_GAP;
  const pfx = rampVar(kind);
  const segs = Array.from({ length: scaleMax }, (_, i) =>
    `<rect x="${i * (SEG_W + SEG_GAP)}" y="0" width="${SEG_W}" height="${SEG_H}" rx="1" fill="var(--${pfx}${i < level ? level : 't'})"/>`).join('');
  const label = `${kind} ${level} of ${scaleMax}: ${word}`;
  return `<span class="score ${kind}" title="${label}"><span class="k">${kind}</span>`
    + `<svg class="meter" viewBox="0 0 ${w} ${SEG_H}" width="${w}" height="${SEG_H}" role="img" aria-label="${label}"><title>${label}</title>${segs}</svg>`
    + `<span class="v">${level}</span></span>`;
}
// A family's distribution over one score: one stacked bar, a segment per level in the level's own
// ramp step (level 0 in the track colour, because "not solved" is a reading and not an absence),
// widths proportional to counts, and the counts beside it as a text twin so nothing is colour-only.
function distBar(kind, dist, total) {
  const W = 120, H = 6, pfx = rampVar(kind);
  let x = 0;
  const segs = [];
  dist.forEach((cnt, lvl) => {
    if (!cnt) return;
    const span = W * cnt / total;
    segs.push(`<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0.5, span - SEG_GAP).toFixed(1)}" height="${H}" rx="1" fill="var(--${pfx}${lvl || 't'})"><title>${kind} ${lvl} (${levelWord(kind, lvl)}): ${cnt} of ${total}</title></rect>`);
    x += span;
  });
  return `<svg class="dist" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${kind} distribution, levels 0 to ${dist.length - 1}: ${dist.join(', ')}">${segs.join('')}</svg>`;
}

/**
 * The stpa cell. The primary entry (the class in its own loop) is two tags beside the layer tag,
 * each carrying the vocabulary's `test` sentence as its title so the page explains its own labels
 * without leaving the file. Further entries — the attention loop under the wide reading — render
 * as one compact line per loop, so the two readings stay distinguishable on the row.
 */
function stpaCell(c, V) {
  const [primary, ...more] = c.stpa;
  const t = (m, k) => esc(V[m][k].test);
  const tag = (m, k, cls) => `<span class="tag ${cls}" title="${t(m, k)}">${esc(k)}</span>`;
  // The loop is numbered in vocabulary order (operator ruling 2026-09-06) so a reader can cite
  // "loop 6" and the legend resolves it. The number is READ from the vocabulary's key order,
  // never restated here, so a loop added to the registry numbers itself.
  const loop = (k) => `<span class="loop" title="${t('loops', k)}">${loopNumber(V, k)} ${esc(k)}</span>`;
  return `<span class="stpa">${loop(primary.loop)}`
    + `${tag('uca', primary.uca, 'uca')}${tag('cause', primary.cause, 'cause')}</span>`
    + more.map((e) => `<span class="stpa more">${loop(e.loop)}`
      + `<span title="${t('uca', e.uca)}">${esc(e.uca)}</span> / <span title="${t('cause', e.cause)}">${esc(e.cause)}</span></span>`).join('');
}

// 1-based position of a loop in stpaVocabulary.loops — the reference number the page prints.
const loopNumber = (V, k) => Object.keys(V.loops).indexOf(k) + 1;

// The STPA++ layer: the row's layer tag, drawn ABOVE the STPA triple. The registry's enum stays
// CTRL/IMPL/BOTH (schema, sqlite projection and taxonomy-web all key on it); only the printed
// name is the long form — operator ruling 2026-09-06.
const LAYER_NAME = Object.freeze({ CTRL: 'CONTROLLER', IMPL: 'IMPLEMENTER', BOTH: 'BOTH' });
const LAYER_TEST = Object.freeze({
  CTRL: 'controller: decides what runs, on what, in what order, and what the result means',
  IMPL: 'implementer: does the work',
  BOTH: 'both layers',
});
const layerTag = (layer) => `<span class="tag ${layer}" title="${LAYER_TEST[layer] || ''}">${LAYER_NAME[layer] || esc(layer)}</span>`;

/**
 * The rca axis, rendered. It did not render at all for its first day: the axis validated 173 classes
 * on every publish and appeared on no surface, which is R6 in the register that catalogues R6.
 *
 * Two things this must not do. It must not draw `unassessed` as an empty cell — 164 classes carry
 * it, so the blank would BE the page, and a class nobody has judged would look exactly like a class
 * whose review found no outgoing relation. The former is grey; both terminal states are named. And it must not treat the
 * `awaits` deadlock as an error to be hidden: a cycle there is the finding, so it is labelled
 * where it occurs rather than filtered out.
 */
function rcaCell(c, RV, deadlocks) {
  const def = (k) => RV.relations[k] || {};
  return c.rca.map((e) => {
    const title = esc(def(e.relation).test || ``);
    if (def(e.relation).terminal) {
      const state = e.relation === 'unassessed' ? ' grey' : '';
      return `<span class="rca"><span class="tag rel${state}" title="${title}">${esc(e.relation)}</span></span>`;
    }
    const dl = deadlocks.has(`${c.id}|${e.relation}|${e.to}`);
    const cite = e.basis ? ` title="${esc(e.basis.doc)}: \u201c${esc(e.basis.quote)}\u201d"` : '';
    return `<span class="rca"><span class="tag rel" title="${title}">${esc(e.relation)}</span>`
      + `<span class="to"${cite}>\u2192 ${esc(e.to)}</span>`
      + (dl ? '<span class="dl" title="Each end waits on the other and neither is broken. A cycle in a cycleIsFinding relation IS the finding, not a validation error.">deadlock</span>' : '')
      + '</span>';
  }).join('');
}

function main() {
  const dark = process.argv.includes('--dark');
  const jsonPath = argOf('--json', process.env.CW_TAXONOMY_JSON || resolve(REPO, 'monitor', 'failure-taxonomy.json'));
  // RESOLVED, not raw. The versioning guard below compares `out` against an ABSOLUTE constant, so a
  // relative --out naming the live docsite page compared unequal and the page was overwritten with no
  // snapshot taken — a guard that runs and cannot match (C26). Measured 2026-08-30 by passing
  // 'docsite/imported/taxonomy-reference.html' and finding docsite/.versions/taxonomy-reference/ absent.
  const outPath = ((v) => (v === null ? null : resolve(v)))(argOf('--out', null));

  // Two palettes, one document, both derived from lib/brand-tokens.mjs (the bond-paper/gold livery
  // now shared across i.commitwork.online — operator ruling 2026-08-29) rather than a third
  // independent copy of hex values. `page` is set on the ROOT element deliberately — the root
  // background propagates to the page canvas, which is what paints @page margins too; setting it
  // on body alone leaves a white border around every printed page.
  //
  // This page needs more roles than brand-tokens.mjs exports (rule/rule2, wash/zebra, and the
  // three-way ctrl/impl/both layer tags), so the extras are derived from the shared tokens rather
  // than invented: rule/rule2 <- line/line2, wash and zebra both <- panel2 (this page's original
  // wash/zebra were already near-identical near-white/near-black tones — collapsing them to one
  // shared token loses no real distinction, since the header row's border and bold text already
  // separate it from a zebra-striped body row). ctrl takes the accent (the controller decides,
  // which is what the accent already means everywhere else); both takes acc2, the secondary gold.
  // impl takes mut, matching bin/taxonomy-web.mjs's own .l-IMPL{color:var(--mut)} — NOT violet:
  // brand-tokens.mjs's --sev is reserved for one signal (the admin panel's "actively exploited")
  // WITHOUT EXCEPTION per operator ruling 2026-08-29, which reversed a same-day attempt to also
  // use it for `code`. uca/cause keep their original red/green warning-vs-grounding sense, mapped
  // onto crit/ok.
  const THEME = dark
    ? { page: PAPER_DARK.bg, ink: PAPER_DARK.ink, ink2: PAPER_DARK.mut, ink3: PAPER_DARK.dim,
        rule: PAPER_DARK.line, rule2: PAPER_DARK.line2, wash: PAPER_DARK.panel2, zebra: PAPER_DARK.panel2,
        accent: PAPER_DARK.acc, ctrl: PAPER_DARK.acc, impl: PAPER_DARK.mut, both: PAPER_DARK.acc2,
        uca: PAPER_DARK.crit, cause: PAPER_DARK.ok, rel: PAPER_DARK.acc2 }
    : { page: PAPER_LIGHT.bg, ink: PAPER_LIGHT.ink, ink2: PAPER_LIGHT.mut, ink3: PAPER_LIGHT.dim,
        rule: PAPER_LIGHT.line, rule2: PAPER_LIGHT.line2, wash: PAPER_LIGHT.panel2, zebra: PAPER_LIGHT.panel2,
        accent: PAPER_LIGHT.acc, ctrl: PAPER_LIGHT.acc, impl: PAPER_LIGHT.mut, both: PAPER_LIGHT.acc2,
        uca: PAPER_LIGHT.crit, cause: PAPER_LIGHT.ok, rel: PAPER_LIGHT.acc2 };

  let doc = JSON.parse(readFileSync(jsonPath, 'utf8'));
  // This page renders the SAME register as bin/taxonomy-web.mjs, so it needs the same
  // record-scoped scanner redaction. Wiring only the other generator left GuardDog x3 and
  // Prowler x1 on docsite/imported/taxonomy-reference.html — the page lib/publish-redactions.mjs
  // already names as the one a hand-redaction was reverted on, with no test watching it.
  // Applied AFTER validate() below reads `doc`, so the register is validated as it truly is.

  // The edition number comes from the registry, never from the filename: renaming an output must not
  // be able to claim a version the data does not carry.
  const out = outPath || resolve(REPO, 'reports', `FAILURE-TAXONOMY-v${doc.version}${dark ? '-dark' : ''}.html`);

  const errors = validate(doc);

  if (errors.length) {
    for (const e of errors) console.error(`registry: ${e}`);
    process.exit(1);
  }
  doc = redactScannersForPublish(doc);
  if (process.argv.includes('--check')) {
    const per = doc.families.map((f) => `${f.prefix}:${doc.classes.filter((c) => c.id.startsWith(f.prefix) && /^\D\d+$/.test(c.id)).length}`).join(' ');
    const byUca = {};
    for (const c of doc.classes) byUca[c.stpa[0].uca] = (byUca[c.stpa[0].uca] || 0) + 1;
    const ucaLine = Object.keys(doc.stpaVocabulary.uca).map((k) => `${k}:${byUca[k] || 0}`).join(' ');
    console.log(`registry OK — ${doc.classes.length} classes across ${doc.families.length} families (${per}); primary uca ${ucaLine}`);
    // The rca census, and it leads with the grey. 164 of 173 classes are unassessed; that was stated
    // only in rcaProvenance.caveat, which no instrument reads, so the axis's dominant fact was
    // invisible at every surface while --check printed a full uca histogram beside it. Grey must be
    // DISPLAYED, not merely stored, and a relation with zero instances is reported as zero rather
    // than omitted — an unused value and a well-covered one must not look the same.
    if (doc.rcaVocabulary?.relations) {
      const byRel = {}; let edges = 0, deadlocks = 0, targeted = new Set();
      const has = new Set();
      for (const c of doc.classes) for (const e of c.rca || []) { byRel[e.relation] = (byRel[e.relation] || 0) + 1; if (e.to) { edges++; targeted.add(e.to); has.add(`${c.id}|${e.relation}|${e.to}`); } }
      for (const c of doc.classes) for (const e of c.rca || []) {
        if (e.to && doc.rcaVocabulary.relations[e.relation]?.cycleIsFinding && has.has(`${e.to}|${e.relation}|${c.id}`) && c.id < e.to) deadlocks++;
      }
      const relLine = Object.keys(doc.rcaVocabulary.relations).map((k) => `${k}:${byRel[k] || 0}`).join(' ');
      const unjudged = byRel.unassessed || 0;
      console.log(`rca — ${unjudged}/${doc.classes.length} UNASSESSED (outgoing edges unjudged), ${edges} edges over ${targeted.size} targets; ${relLine}`);
      if (deadlocks) console.log(`rca — ${deadlocks} deadlock(s): a cycle in a cycleIsFinding relation is the finding, not an error`);
    }
    // The mitigation census, and it leads with the grey for the same reason the rca census does:
    // NO RECORD is the dominant state of the axis and must be printed, not implied by a small count.
    if (doc.mitigationVocabulary) {
      const B = doc.scaleBounds;
      const per = Object.keys(doc.mitigationVocabulary.products)
        .map((p) => `${p}:${doc.classes.filter((c) => (c.mitigations || []).some((e) => e.product === p)).length}`).join(' ');
      const none = doc.classes.filter((c) => !(c.mitigations || []).length).length;
      const open = doc.classes.filter((c) => c.closure < B.fullyClosed && c.gain > B.gainMin);
      const proposed = open.filter((c) => (c.proposals || []).length).length;
      console.log(`mitigations — ${none}/${doc.classes.length} NO RECORD on any layer; classes with a record per product: ${per}; proposals on ${proposed} of ${open.length} classes with closure possible and gain remaining`);
    }
    process.exit(0);
  }

  const V = doc.stpaVocabulary;
  const P = doc.stpaProvenance;
  const SCALE_MAX = doc.scaleBounds.closureMax;
  const GAIN_MIN = doc.scaleBounds.gainMin;
  const RAMP = SCORE_RAMPS[dark ? 'dark' : 'light'];
  const rampCss = ['closure', 'gain'].map((k) => RAMP[k].fill.map((hex, i) => `--${rampVar(k)}${i + 1}:${hex};`).join(' ') + ` --${rampVar(k)}t:${RAMP[k].track};`).join('\n    ');
  const score = (level, kind) => meter(level, kind, SCALE_MAX);
  const levels = Array.from({ length: SCALE_MAX + 1 }, (_, n) => n);

  const rows = (prefix) => doc.classes
    .filter((c) => /^([A-Z])(\d+)$/.exec(c.id)[1] === prefix)
    .sort((a, b) => num(a.id) - num(b.id));
  const famStats = (prefix) => {
    const rs = rows(prefix);
    const dist = (f) => levels.map((n) => rs.filter((c) => c[f] === n).length);
    return { n: rs.length, closure: dist('closure'), gain: dist('gain') };
  };

  const counts = doc.families.map((f) => `${f.roman}&nbsp;${rows(f.prefix).length}`).join(' · ');

  // The mitigation layers. Products are grouped by the layer the vocabulary assigns them —
  // remediation (what commitwork and spine work on) and help (what the memory and oversight
  // layers do, under their release pseudonyms per monitor/release-redactions.json) — and a
  // third layer carries proposals. A class with nothing recorded on a layer draws NO RECORD in the
  // same dashed grey as an unassessed rca edge: absence of evidence, not a clean and not a finding.
  // A proposal slot on a class with nothing left to propose against says so in plain words rather
  // than grey, because "closed" and "unrecorded" are different states and must not share a glyph.
  const MV = doc.mitigationVocabulary;
  const productsOf = (layer) => (MV ? Object.entries(MV.products).filter(([, d]) => d.layer === layer).map(([k]) => k) : []);
  const byLayer = (c, layer) => (c.mitigations || []).filter((e) => MV.products[e.product] && MV.products[e.product].layer === layer);
  const noRecord = (what) => `<span class="tag rel grey" title="No ${what} on this layer — absence of evidence, not a clean and not a finding.">no record</span>`;
  const mitEntry = (e) => `<span class="ent"><span class="tag prod">${esc(e.product)}</span><span class="tag st ${esc(e.status)}" title="${esc(MV.statuses[e.status].test)}">${esc(e.status)}</span> ${esc(e.what)} <span class="ev">${esc(e.evidence)} · ${esc(e.date)}</span></span>`;
  const propEntry = (p) => `<span class="ent"><span class="tag st proposed">proposed</span> ${esc(p.what)} <span class="ev">effort ${esc(p.effort)}${Number.isInteger(p.closesTo) ? ` · would reach closure ${p.closesTo}` : ''} · ${esc(p.by)} · ${esc(p.date)}</span></span>`;
  const mitRow = (c) => {
    if (!MV) return '';
    const rem = byLayer(c, 'remediation'), help = byLayer(c, 'help'), props = c.proposals || [];
    const closed = c.closure >= SCALE_MAX, spent = c.gain <= GAIN_MIN;
    const propCell = (closed || spent)
      ? `<span class="na" title="closure ${c.closure} of ${SCALE_MAX}, gain ${c.gain}: nothing left to propose against">${closed ? 'closed' : 'nothing on the table'} — no proposal applies</span>`
      : (props.length ? props.map(propEntry).join('') : '<span class="tag rel grey" title="Closure is possible and gain remains, and nobody has written a proposal — absence, not a verdict.">no proposal recorded</span>');
    return `      <tr class="mit"><td colspan="5">
        <span class="lay l-rem"><span class="lk">${esc(productsOf('remediation').join(' · '))}</span>${rem.length ? rem.map(mitEntry).join('') : noRecord('remediation record')}</span>
        <span class="lay l-help"><span class="lk">${esc(productsOf('help').join(' · '))}</span>${help.length ? help.map(mitEntry).join('') : noRecord('help record')}</span>
        <span class="lay l-prop"><span class="lk">proposed</span>${propCell}</span>
      </td></tr>`;
  };
  const layerControls = !MV ? '' : `
<fieldset class="layers"><legend>Layers</legend>
  <label><input type="checkbox" id="lay-rem" checked> ${esc(productsOf('remediation').join(' · '))} — what is being remediated</label>
  <label><input type="checkbox" id="lay-help" checked> ${esc(productsOf('help').join(' · '))} — what helps, or has been implemented</label>
  <label><input type="checkbox" id="lay-prop" checked> proposed — what we propose adding, on every class with closure possible and gain remaining</label>
  <span class="hint">Toggles hide rows on screen only; print carries every layer.</span>
</fieldset>`;
  const mitLegend = !MV ? '' : `<b>Mitigation layers</b>, one row under each class: `
    + Object.entries(MV.products).map(([k, d]) => `<span class="tag prod">${esc(k)}</span> ${esc(d.layer)}`).join(' · ')
    + `. States: ` + Object.entries(MV.statuses).map(([k, d]) => `<span class="tag st ${esc(k)}" title="${esc(d.test)}">${esc(k)}</span>`).join(' ')
    + ` · <span class="tag rel grey">no record</span> nothing recorded for that layer. Hover a state for its test.<br>`
    + `<b>Mitigation records are one rater.</b> ${esc(doc.mitigationProvenance.rater)}, ${esc(doc.mitigationProvenance.date)}, ${esc(doc.mitigationProvenance.method)}. ${esc(doc.mitigationProvenance.caveat)}<br>`;

  const famIndex = `
<nav class="famindex" aria-label="Families, in order">
  <ol>
${doc.families.map((f) => { const s = famStats(f.prefix); return `    <li><a href="#fam-${f.prefix}"><span class="roman">${f.roman}</span>${esc(f.name)}</a><span class="prefix">${f.prefix}1–${f.prefix}${s.n}</span><span class="n">${s.n} classes</span>
      <span class="fdist"><span class="k">closure</span>${distBar('closure', s.closure, s.n)}<span class="twin">${s.closure.join('·')}</span></span>
      <span class="fdist"><span class="k">gain</span>${distBar('gain', s.gain, s.n)}<span class="twin">${s.gain.join('·')}</span></span></li>`; }).join('\n')}
  </ol>
  <div class="fnote">Each family's bar is its classes stacked by level, 0 on the left; the figures beside it are the counts at levels 0·1·2·3·4.</div>
</nav>`;
  // A cycle in a relation declaring cycleIsFinding is a DEADLOCK. Computed once here rather than
  // per row, and reported rather than suppressed.
  const RV = doc.rcaVocabulary;
  const allEdges = new Set();
  for (const c of doc.classes) for (const e of c.rca || []) if (e.to) allEdges.add(`${c.id}|${e.relation}|${e.to}`);
  const deadlocks = new Set();
  for (const k of allEdges) {
    const [f, rel, t] = k.split('|');
    if (RV.relations[rel] && RV.relations[rel].cycleIsFinding && allEdges.has(`${t}|${rel}|${f}`)) deadlocks.add(k);
  }
  // Counts include the ZEROES. enables and masks have never been applied, and a relation with no
  // instances must not look like a well-covered one — the same rule that makes the terminal state
  // visible rather than blank.
  const byRel = {};
  for (const c of doc.classes) for (const e of c.rca || []) byRel[e.relation] = (byRel[e.relation] || 0) + 1;
  const rcaLegend = Object.entries(RV.relations)
    .map(([k, d]) => `<b>${esc(k)}</b> ${byRel[k] || 0}${d.cycleIsFinding && deadlocks.size ? ` (${deadlocks.size / 2} deadlock)` : ''}`).join(' · ');

  const loopsLegend = Object.entries(V.loops)
    .map(([k, l], i) => `<b>${i + 1} ${esc(k)}</b> (${esc(l.controller)} → ${esc(l.controls)})`).join(' · ');

  // The page is the SHARED docsite shell (lib/docsite-page.mjs) with this page's own rules layered
  // on top, rather than a second self-contained stylesheet — operator instruction 2026-08-30, "format
  // all documents the same as the field guide". The shell's @media print block is the PDF renderer,
  // so print survives the move; only the page SIZE is overridden below, because this table is wide
  // and the shell's default is portrait.
  //
  // Every rule here is scoped under .taxref. Unscoped, the bare `header`, `footer`, `h1`, `table`
  // and `:root` selectors this file used to carry would reach OUT of the document body and restyle
  // the shell's own chrome — `header` matches `header.site`, and a `:root{--ink}` would repaint the
  // site header and footer, which share that token. Scoping is what makes "layered on top" true
  // rather than "fighting the shell". The tokens live on .taxref, not :root, for the same reason:
  // custom properties inherit to descendants, so they reach this document and nothing else.
  const extraHead = `
<style>
  @page { size: A4 landscape; margin: 12mm 11mm 13mm; }
  .taxref {
    --page:${THEME.page}; --ink:${THEME.ink}; --ink-2:${THEME.ink2}; --ink-3:${THEME.ink3};
    --rule:${THEME.rule}; --rule-2:${THEME.rule2}; --wash:${THEME.wash}; --zebra:${THEME.zebra};
    --accent:${THEME.accent}; --ctrl:${THEME.ctrl}; --impl:${THEME.impl}; --both:${THEME.both};
    --uca:${THEME.uca}; --cause:${THEME.cause}; --rel:${THEME.rel};
    ${rampCss}
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
    color:var(--ink); font:10.5pt/1.45 "Charter","Iowan Old Style",Georgia,serif;
  }
  .taxref * { box-sizing:border-box; }
  .taxref .dochead { border-bottom:2.5px solid var(--ink); padding-bottom:.6em; margin-bottom:1.1em; }
  .taxref .kicker { font:600 8pt/1 ui-sans-serif,-apple-system,sans-serif; letter-spacing:.14em;
    text-transform:uppercase; color:var(--ink-3); margin-bottom:.5em; }
  .taxref .meta { font:8.5pt/1.5 ui-sans-serif,-apple-system,sans-serif; color:var(--ink-3); }
  .taxref .meta code { background:none; padding:0; }

  .taxref h2 { font:600 12pt/1.25 ui-sans-serif,-apple-system,sans-serif; margin:1.5em 0 .45em;
    padding:.35em .6em; background:var(--wash); border-left:4px solid var(--accent);
    break-after:avoid; break-inside:avoid; }
  .taxref h2 .roman { color:var(--ink-3); font-weight:600; margin-right:.5em; }
  .taxref h2 .prefix { font-family:"SF Mono",Menlo,monospace; font-size:.85em; color:var(--accent); margin-left:.5em; }
  .taxref h2 .prop { display:block; font:400 8.5pt/1.4 "Charter",Georgia,serif; color:var(--ink-2);
    font-style:italic; margin-top:.25em; }
  /* The membership test: the sentence a second rater applies. Set apart from the proposition
     because they answer different questions and were conflated until 2026-09-07. */
  .taxref h2 .ftest { display:block; font:400 8pt/1.45 ui-sans-serif,-apple-system,sans-serif;
    color:var(--ink-3); margin-top:.35em; max-width:78em; }
  .taxref h2 .ftest .lbl { display:block; font:600 6.4pt/1.6 ui-sans-serif,sans-serif;
    letter-spacing:.12em; text-transform:uppercase; opacity:.75; }

  .taxref table { width:100%; border-collapse:collapse; margin:0 0 .3em;
    font:8.6pt/1.4 ui-sans-serif,-apple-system,"Helvetica Neue",sans-serif; }
  .taxref thead { display:table-header-group; }
  .taxref th { text-align:left; font-weight:600; color:var(--ink-2); background:var(--wash);
    border-bottom:1.5px solid var(--rule); padding:.4em .5em; }
  .taxref td { padding:.42em .5em; border-bottom:1px solid var(--rule-2); vertical-align:top; }
  .taxref tr { break-inside:avoid; }
  /* Zebra is structural now: every class row is followed by its washed mitigation row, so the
     alternation survives a hidden layer, which an nth-child stripe would not. */
  .taxref tr.cls td { border-bottom:none; }
  .taxref tr.mit td { background:var(--zebra); padding:.2em .5em .5em 3.9em; font-size:8.2pt; }
  .taxref td.id { font-family:"SF Mono",Menlo,monospace; font-weight:600; white-space:nowrap; width:10.5em; }
  .taxref td.name { width:15%; font-weight:600; }
  .taxref td.machine { width:17%; font-family:"SF Mono",Menlo,monospace; font-size:.9em; color:var(--accent);
    word-break:break-word; }
  .taxref td.layer { width:9.5em; text-align:left; }
  .taxref td.text { width:auto; }
  /* The analogy is marked as a different register, never blended into the technical sentence:
     the held prose corpus keeps the precise description and deletes figurative glosses, so this
     line earns its place by being labelled and separable rather than by reading as prose. */
  .taxref .analogy { display:block; margin-top:.45em; padding-left:.55em; border-left:2px solid var(--rule);
    font:italic 8.4pt/1.42 "Charter","Iowan Old Style",Georgia,serif; color:var(--ink-3); }
  .taxref .analogy .lbl { display:block; font:600 6.6pt/1.4 ui-sans-serif,-apple-system,sans-serif;
    font-style:normal; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);
    opacity:.75; }
  /* The example sits UNDER the description and analogy in the same column (operator instruction
     2026-09-06: one column, two rows, not two columns), separated by a dotted rule and labelled. */
  .taxref .example { display:block; margin-top:.5em; padding-top:.35em; border-top:1px dotted var(--rule-2);
    color:var(--ink-2); }
  .taxref .example .lbl { display:block; font:600 6.6pt/1.4 ui-sans-serif,-apple-system,sans-serif;
    letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); opacity:.75; }
  .taxref .tag { font:600 7pt/1.6 ui-sans-serif,sans-serif; letter-spacing:.04em; padding:.1em .35em;
    border-radius:2px; border:1px solid currentColor; white-space:nowrap; }
  .taxref .tag.CTRL { color:var(--ctrl); } .taxref .tag.IMPL { color:var(--impl); } .taxref .tag.BOTH { color:var(--both); }
  /* STPA: the primary entry is two tags under the STPA++ layer tag, the loop it is judged in as a
     numbered label (the number is the loop's position in the legend).
     Further loops (the attention loop under the wide reading) are one muted line each, so a row
     that carries both readings shows both without the second being mistaken for the first. */
  .taxref .tag.uca { color:var(--uca); } .taxref .tag.cause { color:var(--cause); }
  .taxref .stpa { display:block; margin-top:.3em; line-height:1.9; }
  .taxref .stpa .loop { font:600 6.4pt/1 ui-sans-serif,sans-serif; letter-spacing:.1em; text-transform:uppercase;
    color:var(--ink-3); margin-right:.35em; white-space:nowrap; }
  .taxref .stpa .tag { margin-right:.25em; }
  .taxref .stpa.more { font:7pt/1.5 ui-sans-serif,sans-serif; color:var(--ink-3); margin-top:.1em; }
  /* RCA: one line per causal edge. The terminal state is DASHED and grey — it is not-yet-looked,
     and an empty cell would render 164 of 173 classes as "no causal relation", which is the
     unsupported pass this register exists to catch. A deadlock is labelled, not hidden. */
  .taxref .rca { display:block; line-height:1.9; margin-top:.15em; }
  .taxref .rca .tag.rel { color:var(--rel); margin-right:.25em; }
  .taxref .rca .tag.rel.grey { color:var(--ink-3); border-style:dashed; }
  .taxref .rca .to { font:600 7pt/1 ui-sans-serif,sans-serif; color:var(--ink-2); letter-spacing:.03em; }
  .taxref .rca .dl { font:600 6.4pt/1 ui-sans-serif,sans-serif; letter-spacing:.08em; text-transform:uppercase;
    color:var(--uca); border:1px solid currentColor; border-radius:2px; padding:.1em .3em; margin-left:.35em; }
  /* Scores: two meters under the id, label · bar · number, the number in text ink (never the
     series colour). The family index draws the same ramps as stacked distributions. */
  .taxref .score { display:flex; align-items:center; gap:.3em; margin-top:.28em; font-weight:400; }
  .taxref .score .k, .taxref .fdist .k, .taxref .lay .lk { font:600 6.2pt/1 ui-sans-serif,sans-serif;
    letter-spacing:.1em; text-transform:uppercase; color:var(--ink-3); }
  .taxref .score .k { width:4.8em; }
  .taxref .meta .score { display:inline-flex; margin:0 .1em 0 .35em; vertical-align:middle; }
  .taxref .meta .score .k { display:none; }
  .taxref .score .v { font:600 7pt/1 ui-sans-serif,sans-serif; color:var(--ink-2); }
  .taxref .meter, .taxref .dist { display:inline-block; vertical-align:middle; }
  .taxref .intro { font:11.5pt/1.5 "Charter","Iowan Old Style",Georgia,serif; margin:.3em 0 .55em; max-width:62em; }
  .taxref .intro.public { font-size:12.5pt; }
  .taxref .intro .who { display:block; font:600 6.6pt/1.8 ui-sans-serif,sans-serif; letter-spacing:.12em;
    text-transform:uppercase; color:var(--ink-3); }
  .taxref .famindex { margin:1em 0 1.2em; font:8.6pt/1.5 ui-sans-serif,-apple-system,sans-serif; }
  .taxref .famindex ol { list-style:none; margin:0; padding:0; columns:2; column-gap:2.2em; }
  .taxref .famindex li { break-inside:avoid; padding:.3em 0; border-bottom:1px solid var(--rule-2); }
  .taxref .famindex a { color:var(--ink); text-decoration:none; font-weight:600; }
  .taxref .famindex .roman { color:var(--ink-3); margin-right:.45em; }
  .taxref .famindex .prefix { font-family:"SF Mono",Menlo,monospace; color:var(--accent); font-size:.9em; margin-left:.45em; }
  .taxref .famindex .n { color:var(--ink-3); margin-left:.45em; }
  .taxref .fdist { display:flex; align-items:center; gap:.4em; margin-top:.15em; color:var(--ink-3); }
  .taxref .fdist .k { width:4.8em; }
  /* "twin", not "tw": the shell's .tw is its table wrapper (overflow-x:auto; margin:1.2rem 0), and a
     text twin wearing that class inherited a 1.2rem margin at 200% root scale — the index rendered
     with a 40px hole above and below every bar until the collision was found, 2026-09-06. */
  .taxref .fdist .twin { font-family:"SF Mono",Menlo,monospace; font-size:.85em; }
  .taxref .fnote { color:var(--ink-3); font-size:.92em; margin-top:.4em; }
  .taxref .layers { margin:.9em 0 .3em; padding:.35em .7em .45em; border:1px solid var(--rule);
    font:8.6pt/1.7 ui-sans-serif,sans-serif; }
  .taxref .layers legend { font:600 6.6pt/1 ui-sans-serif,sans-serif; letter-spacing:.12em; text-transform:uppercase;
    color:var(--ink-3); padding:0 .3em; }
  .taxref .layers label { display:block; }
  .taxref .layers .hint { color:var(--ink-3); }
  /* The row is tr.mit; each layer inside it is span.lay. They MUST NOT share a class: a
     display:block rule that reached the <tr> turned the row into a block and its colspan cell
     shrank to the first column's width — measured on the first render, 2026-09-06. */
  .taxref .lay { display:block; line-height:1.75; }
  .taxref .lay .lk { display:inline-block; width:11em; margin-right:.3em; }
  .taxref .lay .ent { display:inline-block; margin-right:1.1em; }
  .taxref .lay .ent + .ent { display:block; padding-left:11.3em; }
  .taxref .tag.prod { color:var(--accent); }
  .taxref .tag.st { color:var(--ink-2); margin-left:.25em; margin-right:.3em; }
  .taxref .tag.st.implemented { color:var(--cause); }
  .taxref .tag.st.open, .taxref .tag.st.wrong { color:var(--uca); }
  .taxref .tag.st.unassessed { color:var(--ink-3); border-style:dashed; }
  .taxref .tag.st.superseded { color:var(--ink-3); }
  .taxref .tag.st.proposed { color:var(--rel); }
  .taxref .lay .ev { color:var(--ink-3); font-size:.92em; }
  .taxref .lay .na { color:var(--ink-3); font-style:italic; }
  /* Layer toggles are CSS-only (:has on the checkboxes): no script, so the page stays file:// safe
     and identical under a strict CSP. Print shows every layer regardless of the screen state. */
  .taxref:has(#lay-rem:not(:checked)) .lay.l-rem,
  .taxref:has(#lay-help:not(:checked)) .lay.l-help,
  .taxref:has(#lay-prop:not(:checked)) .lay.l-prop { display:none; }
  .taxref:has(#lay-rem:not(:checked)):has(#lay-help:not(:checked)):has(#lay-prop:not(:checked)) tr.mit { display:none; }
  .taxref:has(#lay-rem:not(:checked)):has(#lay-help:not(:checked)):has(#lay-prop:not(:checked)) tr.cls td { border-bottom:1px solid var(--rule-2); }
  @media print {
    .taxref .layers { display:none; }
    .taxref tr.mit { display:table-row !important; }
    .taxref .lay { display:block !important; }
    .taxref .famindex ol { columns:2; }
  }

  /* The table.plan and h2.work rules that stood here were removed 2026-08-30: they styled the
     remediation register, which moved to its own page (bin/remediation-web.mjs) in the 2026-08-29
     split, and nothing in this file has emitted a .plan table or an h2.work since. Verified against
     the rendered output, not just the template — zero matches for class="plan" or class="work" in
     docsite/imported/taxonomy-reference.html and on the live page. Dead CSS that names a section a
     reader cannot find is a claim the artifact does not honour. */
  .taxref .docfoot { margin-top:2em; padding-top:.6em; border-top:1px solid var(--rule);
    font:8pt/1.5 ui-sans-serif,sans-serif; color:var(--ink-3); }
  @media (max-width:900px) { .taxref td.machine,.taxref td.example { word-break:break-word; } }
</style>`;

  const intro = !doc.intro ? '' : `
  <p class="intro public"><span class="who">In one sentence</span>${esc(doc.intro.public)}</p>
  <p class="intro academic"><span class="who">For the field</span>${esc(doc.intro.academic)}</p>`;

  const body = `<div class="taxref">
<div class="dochead">
  <div class="kicker">commitwork · oversight failure classification</div>${intro}
  <div class="meta">
    ${doc.classes.length} classes · ${doc.families.length} families (${counts}) ·
    verified against <b>${esc(doc.verifiedAgainst)}</b> ·
    generated by <code>bin/taxonomy-render.mjs</code> from <code>monitor/failure-taxonomy.json</code> —
    do not hand-edit.<br>${esc(doc.note)}<br>
    <b>STPA++ layer</b>, the top line of the column: <span class="tag CTRL">CONTROLLER</span> decides what
    runs, on what, in what order, and what the result means · <span class="tag IMPL">IMPLEMENTER</span>
    does the work · <span class="tag BOTH">BOTH</span> both.<br>
    <b>Scores</b>, two meters under each id — <b>closure</b> ${esc(doc.scales.closure)}: ${levels.map((n) => `${score(n, 'closure')} ${esc(levelWord('closure', n))}`).join(' · ')}<br>
    <b>gain</b> ${esc(doc.scales.gain)}: ${levels.map((n) => `${score(n, 'gain')} ${esc(levelWord('gain', n))}`).join(' · ')}.<br>
    <b>Scores are one rater.</b> ${esc(doc.scoreProvenance)}<br>
    <b>STPA</b>, under the STPA++ layer tag: <span class="tag uca">uca</span> how the control action was unsafe ·
    <span class="tag cause">cause</span> the causal factor · judged in the loop numbered beside them;
    a second line is the same class judged in another loop. Hover a value for its test.
    Loops, numbered for reference (controller → controls): ${loopsLegend}.<br>
    Causal edges: ${rcaLegend}.<br>
    <b>STPA is one rater.</b> ${esc(P.rater)}, ${esc(P.date)}, ${esc(P.method)}. ${esc(P.caveat)}<br>
    ${mitLegend}
  </div>
</div>
${layerControls}
${famIndex}

${doc.families.map((f) => `<section id="fam-${f.prefix}">
  <h2><span class="roman">${f.roman}</span>${esc(f.name)}<span class="prefix">${f.prefix}1–${f.prefix}${rows(f.prefix).length}</span>
    <span class="prop">The false proposition: “${esc(f.proposition)}”</span>
    <span class="ftest"><span class="lbl">membership test</span>${esc(f.test)}</span></h2>
  <table>
    <thead><tr><th>id · scores</th><th>Name</th><th>Machine name</th><th>STPA++ layer · STPA</th><th>Description · analogy · example</th></tr></thead>
    <tbody>
${rows(f.prefix).map((c) => `      <tr class="cls">
        <td class="id">${c.id}${score(c.closure, 'closure')}${score(c.gain, 'gain')}</td>
        <td class="name">${esc(c.name)}</td>
        <td class="machine">${wrapId(c.machine)}</td>
        <td class="layer">${layerTag(c.layer)}${stpaCell(c, V)}${rcaCell(c, RV, deadlocks)}</td>
        <td class="text">${esc(c.description)}
          <span class="analogy"><span class="lbl">analogy</span>${esc(c.analogy)}</span>
          <span class="example"><span class="lbl">example</span>${esc(c.example)}</span></td>
      </tr>
${mitRow(c)}`).join('\n')}
    </tbody>
  </table>
</section>`).join('\n')}

<div class="docfoot">
  Narrative, warrants, incident accounts and ranked mitigations: FAILURE-TAXONOMY.md (v1),
  FAILURE-TAXONOMY-v3.md (v2 + v3). Family I is catalogued per-incident in FALSE-CLEAN-TAXONOMY.md.
</div>
</div>`;

  // The shell renders the <h1> from the title it is given, so the body above no longer carries one
  // — two <h1>s is exactly the duplicate renderPage()'s stripLeadingH1 exists to prevent for the
  // markdown path, and there is no reason for the generated path to reintroduce it.
  //
  // srcHash is the sha256 of the SOURCE JSON, not of the rendered HTML: the shell stamps it into
  // the page as its provenance, and hashing the output would make the stamp a hash of itself.
  // No clock reaches this, so two runs over one registry stay byte-identical.
  const nav = (() => {
    try { return docsiteNav(loadManifest()); } catch { return []; }
  })();
  const html = renderShellPage({
    title: `Failure taxonomy v${doc.version} — class reference`,
    bodyHtml: body,
    srcHash: sha256Hex(JSON.stringify(doc)),
    extraHead,
    nav,
    currentSlug: 'taxonomy-reference',
    generator: 'bin/taxonomy-render.mjs',
  });

  // Versioned only when writing to the real, live docsite location — the default --out (a
  // reports/ path, gitignored, version-numbered by filename) already has its own history by
  // construction and needs no second one.
  const DOCSITE_TAXONOMY_REF = resolve(REPO, 'docsite', 'imported', 'taxonomy-reference.html');
  // resolve() BOTH sides. `--out docsite/imported/taxonomy-reference.html` names the live file and does
  // not string-equal DOCSITE_TAXONOMY_REF, so the raw compare skipped the snapshot while the
  // write below still replaced the real page — versioning off, overwrite on. writeAtomic
  // resolves against cwd exactly as this does, so guard and write now agree on the target.
  if (resolve(out) === DOCSITE_TAXONOMY_REF) {
    let previous = null;
    try { previous = readFileSync(out, 'utf8'); } catch { /* first write */ }
    snapshotBeforeWrite('taxonomy-reference', 'generated', previous);
  }
  // Redact at the boundary — see lib/publish-redactions.mjs. This page ships as
  // docsite/imported/taxonomy-reference.html and IS published, unlike taxonomy.html.
  writeAtomic(out, redactForPublish(html));
  console.log(`wrote ${out} — ${doc.classes.length} classes, ${doc.families.length} families`);
}

// Guarded so validate() can be imported by a test without the import rendering a page.
const isMain = isMainModule(import.meta.url);
if (isMain) main();
