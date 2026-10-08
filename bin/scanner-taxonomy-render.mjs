#!/usr/bin/env node
/**
 * scanner-taxonomy-render.mjs — render monitor/scanner-subject-taxonomy.json as a self-contained
 * reference page.
 *
 * THE SUBJECT IS THE RUN. monitor/failure-taxonomy.json holds 166 classes whose subject is a
 * repository under scan; this registry transposes the axis so that the scanner run, the gate and
 * the agent session become the SUBJECT rather than the controller. It is a separate registry and
 * not new families in the parent, for two reasons that are mechanical rather than editorial: the
 * parent's schema pins `prefix` to ^[CARPMGDWKE]$ with additionalProperties false, and
 * bin/taxonomy-web.mjs refuses to render a page whose editions do not account for exactly the
 * classes the parent registry holds. Adding classes there breaks both.
 *
 * THE CITATION FLOOR. Every parent id a class cites is resolved against the parent registry at
 * validate() time. A citation that no longer resolves fails the render rather than printing a dead
 * id, because a taxonomy whose cross-references rot is a worse artifact than one that refuses.
 *
 * THE SECOND WITNESS ON `origin`. Each class hand-declares inherited / transposed / novel. That is
 * one rater, and this repository's own history says a single rater's label is a reading, not a
 * measurement. --distance measures the nearest neighbour of every class in each reference set with
 * lib/taxonomy-distance.mjs, judged against that set's OWN internal median nearest-neighbour
 * distance, and reports where the label and the measurement disagree. The two cannot share a
 * failure mode: one is an author's intent, the other is tf-idf over the text actually written.
 *
 * Self-contained by house rule: no CDN, no external font, file:// safe. Print CSS included so the
 * same file is the PDF source.
 *
 * Usage: scanner-taxonomy-render.mjs [--json <path>] [--out <path>] [--check] [--distance] [--dark]
 *   --check     validate and print the tally; exit 0 clean, 1 on any error
 *   --distance  print the measured distance report (implies the validation above)
 * Env: CW_SCANNER_TAXONOMY_JSON, CW_TAXONOMY_JSON (parent). Both read at CALL time; flags win.
 */
import { isMainModule } from '../lib/is-main.mjs';
import { esc } from '../lib/html-escape.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../monitor/registry.mjs';
import { LIGHT as PAPER_LIGHT, DARK as PAPER_DARK, LIGHT_SEMANTIC, DARK_SEMANTIC } from '../lib/brand-tokens.mjs';
import { snapshotBeforeWrite } from '../lib/docsite-versions.mjs';
import { privateRoot, docsiteRoot } from '../lib/docsite-roots.mjs';
import { redactForPublish } from '../lib/publish-redactions.mjs';
import { compare } from '../lib/taxonomy-distance.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = resolve(REPO, 'schema', 'scanner-subject-taxonomy.schema.json');
const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
};
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const num = (id) => Number(/\d+/.exec(id)[0]);
const prefixOf = (id) => id.replace(/\d+$/, '');

/** The parent registry, read for its classes (citation resolution) and its stpa vocabulary. */
export function loadParent(doc, { repo = REPO } = {}) {
  const path = process.env.CW_TAXONOMY_JSON || resolve(repo, doc.parentRegistry);
  // Fail CLOSED: a parent that cannot be read is not "no citations to check". Only the absence of
  // the declared file is reportable, and it is still an error — this registry cites into it.
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return { error: `parentRegistry ${path} could not be read (${e.code || e.message}) — every inherits id cites into it, so nothing here can be reported valid without it` }; }
  try { return { parent: JSON.parse(raw), path }; }
  catch (e) { return { error: `parentRegistry ${path} is not valid JSON (${e.message})` }; }
}

/**
 * Validate before rendering. A registry that renders a malformed row as a pretty table is the same
 * false clean as everything it catalogues, so this runs on every render, not only under --check.
 */
export function validate(doc, { repo = REPO } = {}) {
  const errors = validateAgainstSchema(doc, { path: SCHEMA }).errors;
  const { families, classes, scaleBounds: B, origins, instrumentStates, lenses, lensBands, editions } = doc;

  // THE SHAPE FLOOR, DERIVED FROM THE SCHEMA — never restated beside it. Every semantic guard below
  // dereferences the register's required structures, so a missing one crashed with a TypeError
  // instead of refusing: a stack trace where this function's whole promise is a reported error.
  //
  // Two wrong versions preceded this one, and both are worth naming because each is a named defect
  // in this repo already. A hand-written list of the fields is the `mirrored` binding that
  // monitor/registry-inventory.json calls out — two copies of one truth, only the code bites — and
  // it covered 7 of the 13 required fields, leaving `parentRegistry` still throwing at
  // loadParent's resolve(repo, undefined), the exact defect the guard existed to remove. Returning
  // on ANY schema error is complete but too blunt: `fullClosureAbsent: ""` is PRESENT and correctly
  // typed, so the schema rejects it on minLength and the semantic guard that explains WHY the
  // declaration matters never runs. A guard that trades a diagnosis for a type name is a downgrade.
  //
  // The guards crash on absent-or-wrong-type and nothing else, so that is exactly what is gated
  // here, read from the schema's own `required` and `type` at call time. A required field added to
  // the schema later is covered the day it is added, and value-level errors still fall through to
  // the guards that explain them.
  const shape = JSON.parse(readFileSync(SCHEMA, 'utf8'));
  const shapeOf = (k) => shape.properties?.[k]?.type;
  const wrong = (k) => {
    const v = doc?.[k];
    if (v === undefined) return 'is missing';
    // ONLY the kinds a guard below can choke on. `integer` vs `number` is a real schema distinction
    // and never a crash, so it stays the schema's to report — checking it here reported the shipped
    // register dirty on `version` and took 14 tests with it. The boundary is deliberate: this gate
    // exists to stop a TypeError, not to become a second JSON Schema implementation.
    switch (shapeOf(k)) {
      case 'array': return Array.isArray(v) ? null : `is ${Array.isArray(v) ? 'array' : typeof v} where the checks below iterate an array`;
      case 'object': return (v !== null && typeof v === 'object' && !Array.isArray(v)) ? null : `is ${Array.isArray(v) ? 'an array' : v === null ? 'null' : typeof v} where the checks below read an object`;
      case 'string': return typeof v === 'string' ? null : `is ${typeof v} where the checks below resolve it as a path`;
      default: return null;
    }
  };
  const misshapen = (shape.required || []).map((k) => [k, wrong(k)]).filter(([, w]) => w);
  if (misshapen.length) {
    for (const [k, w] of misshapen) {
      errors.push(`${k} ${w} — the checks below read it, and a guard that throws is not a guard that refused`);
    }
    return errors;
  }

  if (!B || ['closureMin', 'closureMax', 'gainMin', 'gainMax', 'fullyClosed'].some((k) => typeof B[k] !== 'number')) {
    errors.push('scaleBounds is missing or incomplete — consumers read this to size their thresholds, and a guessed bound is how a guard stops guarding');
    return errors;
  }
  if (B.fullyClosed !== B.closureMax) errors.push(`scaleBounds.fullyClosed (${B.fullyClosed}) must equal closureMax (${B.closureMax})`);

  // THE INVERTED FULL-CLOSURE CHECK. The parent registry errors when NO class reaches full closure,
  // because a consumer gating on it would pass vacuously. Here nothing is fully closed — no test in
  // this tree takes a run as a subject — so the absence is required to be DECLARED instead. Same
  // defect guarded, opposite direction: silence about it is what is barred, not the absence itself.
  const anyFullyClosed = classes.some((c) => c.closure >= B.fullyClosed);
  if (!anyFullyClosed && !nonEmpty(doc.fullClosureAbsent)) {
    errors.push(`no class reaches closure ${B.fullyClosed} and fullClosureAbsent does not say so — a consumer gating on full closure would pass proving nothing, and the absence must be stated rather than discovered`);
  }
  if (anyFullyClosed && nonEmpty(doc.fullClosureAbsent)) {
    errors.push('fullClosureAbsent claims nothing reaches full closure, and a class does — the declaration and the data disagree');
  }

  if (!isPlainObject(lenses) || !Object.keys(lenses).length) errors.push('lenses is missing or empty');
  if (!isPlainObject(lensBands) || !Object.keys(lensBands).length) errors.push('lensBands is missing or empty');
  for (const [k, l] of Object.entries(lenses || {})) {
    if (!lensBands || !(l.band in lensBands)) errors.push(`lens ${k}: band "${l.band}" is not in lensBands`);
    for (const inst of l.instruments || []) {
      if (!existsSync(resolve(repo, inst))) errors.push(`lens ${k}: instrument ${inst} does not exist — a lens that names a module nobody can open is a claim, not a lens`);
    }
  }

  const { parent, error } = loadParent(doc, { repo });
  if (error) { errors.push(error); return errors; }
  const parentIds = new Set((parent.classes || []).map((c) => c.id));
  const V = parent.stpaVocabulary;
  if (!isPlainObject(V)) errors.push('parent registry has no stpaVocabulary — loop/uca/cause are READ from it, never restated here');

  const byPrefix = new Map(families.map((f) => [f.prefix, f]));
  const seenMachine = new Set();
  const seenId = new Set();
  const numbers = new Map();

  for (const c of classes) {
    const p = prefixOf(c.id);
    const fam = byPrefix.get(p);
    if (!fam) { errors.push(`${c.id}: no family declares prefix ${p}`); continue; }
    if (seenId.has(c.id)) errors.push(`${c.id}: duplicate id`);
    seenId.add(c.id);
    if (!c.machine.startsWith(`${fam.key}.`)) errors.push(`${c.id}: machine name "${c.machine}" does not start with "${fam.key}."`);
    if (seenMachine.has(c.machine)) errors.push(`${c.id}: duplicate machine name "${c.machine}"`);
    seenMachine.add(c.machine);

    for (const f of ['closure', 'gain']) {
      const lo = f === 'closure' ? B.closureMin : B.gainMin;
      const hi = f === 'closure' ? B.closureMax : B.gainMax;
      if (!Number.isInteger(c[f]) || c[f] < lo || c[f] > hi) errors.push(`${c.id}: ${f} is not an integer ${lo}-${hi}`);
    }

    // origin / inherits agreement, and the CITATION FLOOR
    const od = origins[c.origin];
    if (!od) errors.push(`${c.id}: origin "${c.origin}" is not in origins`);
    else if (od.requiresInherits && c.inherits.length === 0) errors.push(`${c.id}: origin ${c.origin} requires at least one inherits id`);
    else if (!od.requiresInherits && c.inherits.length > 0) errors.push(`${c.id}: origin novel must carry no inherits ids, and carries ${c.inherits.join(' ')}`);
    for (const pid of c.inherits) {
      if (!parentIds.has(pid)) errors.push(`${c.id}: cites parent class ${pid}, which does not exist in ${doc.parentRegistry} — a citation that no longer resolves is worse than none`);
    }
    if (c.inherits.length > 0 && !nonEmpty(c.originNote)) errors.push(`${c.id}: cites ${c.inherits.join(' ')} with no originNote — without it, a transposition cannot be told from a duplicate wearing a new id`);
    if (c.inherits.length === 0 && c.originNote !== null) errors.push(`${c.id}: origin novel must carry originNote null`);

    // lens closure
    for (const l of c.lens) if (!lenses[l]) errors.push(`${c.id}: lens "${l}" is not in the lenses vocabulary`);

    // instrument state must agree with the tree, not with an intention
    const st = c.instrumentState;
    if (!instrumentStates[st]) errors.push(`${c.id}: instrumentState "${st}" is not in instrumentStates`);
    if (st === 'absent' && c.instrument !== null) errors.push(`${c.id}: instrumentState absent must carry instrument null`);
    if (st !== 'absent') {
      if (!nonEmpty(c.instrument)) errors.push(`${c.id}: instrumentState ${st} requires an instrument path`);
      else if (!existsSync(resolve(repo, c.instrument))) errors.push(`${c.id}: instrument ${c.instrument} does not exist in the tree — the state is measured, so a path that cannot be opened fails rather than renders`);
    }
    // status and edition must agree: the edition split IS the held/proposed split
    const ed = editions.find((e) => e.ids.includes(c.id));
    if (!ed) errors.push(`${c.id}: no edition accounts for it`);
    else if (ed.version !== c.edition) errors.push(`${c.id}: declares edition ${c.edition} and is listed in edition ${ed.version}`);
    if ((c.status === 'held') !== (c.edition === 1)) errors.push(`${c.id}: status ${c.status} disagrees with edition ${c.edition}`);

    // stpa against the PARENT vocabulary — read, never restated
    if (isPlainObject(V)) {
      const loops = new Set();
      for (const [i, e] of c.stpa.entries()) {
        for (const m of ['loops', 'uca', 'cause']) {
          const key = m === 'loops' ? e.loop : e[m];
          if (!V[m] || !(key in V[m])) errors.push(`${c.id}: stpa[${i}].${m === 'loops' ? 'loop' : m} "${key}" is not in the parent's stpaVocabulary.${m}`);
        }
        if (loops.has(e.loop)) errors.push(`${c.id}: loop "${e.loop}" appears twice — one judgement per loop per class`);
        loops.add(e.loop);
      }
    }

    if (!numbers.has(p)) numbers.set(p, []);
    numbers.get(p).push(num(c.id));
  }

  for (const [p, nums] of numbers) {
    nums.sort((a, b) => a - b);
    for (let i = 0; i < nums.length; i++) if (nums[i] !== i + 1) { errors.push(`${p}: numbering is not 1..n (gap or duplicate at ${p}${nums[i]})`); break; }
  }

  // EDITIONS MUST ACCOUNT FOR EXACTLY THE CLASSES HELD — the guard bin/taxonomy-web.mjs applies to
  // the parent, for the same reason: an edition list that drifts from the registry lets two
  // documents disagree about what the taxonomy contains, and both look authoritative.
  const listed = editions.flatMap((e) => e.ids);
  const dupes = listed.filter((id, i) => listed.indexOf(id) !== i);
  if (dupes.length) errors.push(`editions list ${[...new Set(dupes)].join(' ')} more than once`);
  const held = new Set(classes.map((c) => c.id));
  for (const id of listed) if (!held.has(id)) errors.push(`editions list ${id}, which the registry does not hold`);
  for (const id of held) if (!listed.includes(id)) errors.push(`${id} is held by the registry and accounted for by no edition`);

  return errors;
}

/** Lenses declared and carried by no class. Reported, never an error: an uncovered lens is a real
 *  reading about this registry, and turning it into a failure would invite padding the taxonomy. */
export function lensCoverage(doc) {
  const used = new Map();
  for (const c of doc.classes) for (const l of c.lens) used.set(l, (used.get(l) || 0) + 1);
  return {
    counts: Object.fromEntries([...used.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    uncovered: Object.keys(doc.lenses).filter((l) => !used.has(l)).sort(),
  };
}

/**
 * A reference set's file, located at CALL time.
 *
 * A declared path may name an input this checkout does not hold. `$CW_SIDECAR/…` is the private
 * sidecar: the env var wins, and with it unset the sidecar directory beside the checkout is the
 * default, which is where the operator's lives. A public clone has neither, and the honest answer
 * there is the NAME of the input it is missing — not `<repo>/$CW_SIDECAR/…`, which would resolve
 * inside the tree, come back ENOENT, and report "file absent on this machine" about a place nothing
 * writes to. The distinction is the whole point: a missing input is not an absent file.
 */
export function resolveSetPath(declared, repo) {
  const m = /^\$(CW_[A-Z0-9_]+)\/(.+)$/.exec(declared);
  if (!m) return { path: resolve(repo, declared) };
  const [, name, rest] = m;
  const set = process.env[name];
  const base = set || (name === 'CW_SIDECAR' ? resolve(repo, '..', 'commitwork-sidecar') : null);
  if (!base) return { path: null, why: `missing input: ${name} is unset and has no default` };
  if (!existsSync(base)) {
    return { path: null, why: `missing input: ${name} ${set ? `names ${base}, which` : `is unset and its default ${base}`} does not exist` };
  }
  return { path: resolve(base, rest) };
}

/**
 * The measured distance. Reference sets are read at call time; a set whose file is ENOENT is
 * UNMEASURED (its own state), never zero distance and never an assumed duplicate. A set whose
 * declared path names an env input this machine does not have is unmeasured for THAT reason, which
 * is reported as such. Any other read failure fails closed.
 */
export function measureDistance(doc, { repo = REPO } = {}) {
  const subject = doc.classes.map((c) => ({ id: c.id, text: [c.name, c.description, c.machine] }));
  const references = {};
  const unmeasured = [];
  for (const rs of doc.referenceSets || []) {
    const { path, why } = resolveSetPath(rs.path, repo);
    if (!path) { unmeasured.push({ name: rs.name, path: rs.path, why }); continue; }
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') { unmeasured.push({ name: rs.name, path: rs.path, why: 'file absent on this machine' }); continue; }
      throw new Error(`referenceSet ${rs.name} at ${rs.path} could not be read (${e.code}) — a set that fails to read is not an empty set`);
    }
    const j = JSON.parse(raw);
    const rows = rs.pick === 'classes' ? (j.classes || []) : (Array.isArray(j) ? j : Object.values(j));
    references[rs.name] = rows.map((c) => ({
      id: c.id,
      // The two sets spell the same fields differently: the parent uses name/description, the
      // sidecar's proposals use title/def. Both are read; neither is renamed in its own file.
      text: [c.name || c.title || '', c.description || c.def || '', c.machine || ''],
    }));
  }
  if (!Object.keys(references).length) return { unmeasured, report: null };
  const citations = Object.fromEntries(doc.classes.filter((c) => c.inherits.length).map((c) => [c.id, c.inherits]));
  // Citations resolve against the PARENT set only — the set whose path is doc.parentRegistry.
  const parentSet = (doc.referenceSets || []).find((r) => r.path === doc.parentRegistry);
  const citationSets = parentSet ? [parentSet.name] : null;
  const report = compare({ subject, references, citations, citationSets });
  // A measured aside worth carrying: ids the sidecar still PROPOSES that the parent already holds.
  const staleProposals = [];
  if (references.proposed && references.landed) {
    const landedIds = new Set(references.landed.map((c) => c.id));
    for (const c of references.proposed) if (landedIds.has(c.id)) staleProposals.push(c.id);
  }
  return { unmeasured, report, staleProposals };
}

/**
 * origin label vs measured verdict, with the two directions asserted SEPARATELY.
 *
 * The first version of this counted every `duplicate` as a disagreement and reported five, two of
 * which were its own defect: a class labelled `inherited` MEANS "the parent class applies verbatim",
 * so measuring it as a duplicate is the label and the measurement AGREEING. Counting agreement as
 * disagreement is the flattering direction — it inflates the appearance of rigour while hiding the
 * reading that actually matters.
 *
 * The three signed cases:
 *   over-claimed   novel or transposed, measured inside the set's own resolution. The class may be
 *                  a duplicate wearing a new id. Read the originNote and check it names a real
 *                  difference rather than restating the parent.
 *   under-claimed  inherited, measured DISTINCT. The citation says "applies verbatim" and the text
 *                  says otherwise, so either the citation is wrong or the class drifted from it.
 *                  This is the direction that lies to you: it looks like a well-cited class.
 *   confirmed      inherited and measured duplicate or adjacent. Agreement, reported as a count so
 *                  the disagreement figure cannot be read without its denominator.
 */
/** How near the cited class must rank for a citation to count as borne out by the text. Derived
 *  from the reference set's size in the caller, not fixed here — see NEAR_RANK at the call site. */
const NEAR_RANK = 10;

export function labelVersusMeasurement(doc, report) {
  if (!report) return { rows: [], confirmed: 0 };
  const byId = new Map(doc.classes.map((c) => [c.id, c]));
  const rows = [];
  let confirmed = 0;
  for (const row of report.rows) {
    const c = byId.get(row.id);
    for (const [set, r] of Object.entries(row.against)) {
      if (r.verdict === 'unmeasured') continue;
      const near = r.verdict === 'duplicate' || r.verdict === 'adjacent';
      if (c.origin === 'inherited') {
        // Judge an inherited class ONLY against the set its citation points into. Measuring it
        // "distinct" from a set it never cited is not a finding about the class; the first version
        // of this did exactly that and reported nine such rows, every one of them noise.
        const cites = (report.cited[row.id] || []).filter((x) => x.set === set);
        if (!cites.length) continue;
        const best = cites.slice().sort((a, b) => a.rank - b.rank)[0];
        if (near || best.rank <= NEAR_RANK) { confirmed++; continue; }
        rows.push({ id: row.id, set, direction: 'under-claimed', verdict: r.verdict, nearest: r.nearest, distance: r.distance, pct: r.pct, origin: c.origin,
          note: `cites ${c.inherits.join(' ')} as applying verbatim, and the nearest of those (${best.id}) ranks ${best.rank} of ${best.of} by distance while ${r.nearest} ranks first — either the citation is wrong or the text has drifted from what it cites` });
        continue;
      }
      if (r.verdict === 'duplicate') {
        rows.push({ id: row.id, set, direction: 'over-claimed', verdict: r.verdict, nearest: r.nearest, distance: r.distance, pct: r.pct, origin: c.origin,
          note: c.origin === 'novel'
            ? `labelled novel and measured nearer to ${r.nearest} than ${100 - r.pct}% of this set's own sibling pairs — the strongest disagreement in the table`
            : `labelled transposed and measured nearer to ${r.nearest} than ${100 - r.pct}% of this set's own sibling pairs — legitimate only if the originNote names a difference the text does not already carry` });
      } else if (c.origin === 'novel' && r.verdict === 'adjacent') {
        rows.push({ id: row.id, set, direction: 'over-claimed', verdict: r.verdict, nearest: r.nearest, distance: r.distance, pct: r.pct, origin: c.origin,
          note: `labelled novel and measured adjacent to ${r.nearest} — weaker than a duplicate, but a claim of no precedent deserves the second look` });
      }
    }
  }
  return { rows, confirmed };
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────

// <wbr> and NOT U+200B: a zero-width space is a CHARACTER, so it lands in the copy buffer and the
// PDF text layer, and a machine name pasted out of the page then matches nothing. See the same note
// in bin/taxonomy-render.mjs, where it was measured at 333 stray codepoints.
const wrapId = (s) => esc(s).replace(/([._])/g, '$1<wbr>');

// Both dials take the escalation ramp of docs/THEME.md §3.4 (--low, --med, --high, --crit), so they
// follow the theme rendered. Gain climbs it; closure descends it and ends on --ok, the house --live.
// Level 0 draws no arc, so its step only names the floor.
export const CLOSURE_RAMP = Object.freeze(['crit', 'high', 'med', 'low', 'ok']);
export const GAIN_RAMP = Object.freeze(['plan', 'low', 'med', 'high', 'crit']);
const R = 5, CIRC = 2 * Math.PI * R;
function ring(level, kind, scaleMax) {
  const ramp = kind === 'closure' ? CLOSURE_RAMP : GAIN_RAMP;
  const colour = `var(--${ramp[Math.min(level, ramp.length - 1)]})`;
  const frac = level / scaleMax;
  const label = kind === 'closure'
    ? ['not solved', 'barely', 'part-solved', 'solved, unpinned', 'solved and pinned'][level]
    : ['nothing on the table', 'marginal', 'worth doing', 'high', 'biggest available'][level];
  return `<svg class="ring" viewBox="0 0 14 14" width="13" height="13" role="img" aria-label="${kind}: ${label}"><title>${kind}: ${label}</title>`
    + `<circle cx="7" cy="7" r="${R}" fill="none" stroke="var(--rule)" stroke-width="2"/>`
    + (frac > 0 ? `<circle cx="7" cy="7" r="${R}" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="butt"`
      + ` stroke-dasharray="${(CIRC * frac).toFixed(2)} ${CIRC.toFixed(2)}" transform="rotate(-90 7 7)"/>` : '')
    + (level === scaleMax ? `<circle cx="7" cy="7" r="2.6" fill="${colour}"/>` : '')
    + '</svg>';
}

function main() {
  const dark = process.argv.includes('--dark');
  const jsonPath = argOf('--json', process.env.CW_SCANNER_TAXONOMY_JSON
    || resolve(REPO, 'monitor', 'scanner-subject-taxonomy.json'));
  const doc = JSON.parse(readFileSync(jsonPath, 'utf8'));

  const errors = validate(doc);
  if (errors.length) {
    for (const e of errors) console.error(`registry: ${e}`);
    process.exit(1);
  }

  const cov = lensCoverage(doc);
  const { unmeasured, report, staleProposals } = measureDistance(doc);
  const lvm = labelVersusMeasurement(doc, report);
  const disagreements = lvm.rows;

  if (process.argv.includes('--check') || process.argv.includes('--distance')) {
    const per = doc.families.map((f) => `${f.prefix}:${doc.classes.filter((c) => prefixOf(c.id) === f.prefix).length}`).join(' ');
    const byState = {};
    for (const c of doc.classes) byState[c.instrumentState] = (byState[c.instrumentState] || 0) + 1;
    const byOrigin = {};
    for (const c of doc.classes) byOrigin[c.origin] = (byOrigin[c.origin] || 0) + 1;
    console.log(`registry OK — ${doc.classes.length} classes across ${doc.families.length} families (${per})`);
    console.log(`  editions: ${doc.editions.map((e) => `v${e.version} ${e.label} ${e.ids.length}`).join(' · ')}`);
    console.log(`  origin:   ${Object.entries(byOrigin).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  instrument: ${Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  lenses: ${Object.keys(doc.lenses).length} declared${cov.uncovered.length ? ` · UNCOVERED: ${cov.uncovered.join(', ')}` : ' · all carried by at least one class'}`);
    if (process.argv.includes('--distance')) {
      if (staleProposals && staleProposals.length) console.log(`  NOTE: ${staleProposals.length} sidecar-proposed id(s) already held by the parent: ${staleProposals.join(' ')}`);
      console.log('\nmeasured distance — nearest neighbour per reference set, threshold = that set\'s OWN internal median');
      for (const u of unmeasured) console.log(`  ${u.name}: UNMEASURED (${u.why}) — not zero distance, not a duplicate`);
      if (report) {
        for (const [name, b] of Object.entries(report.baselines)) {
          console.log(`  ${name}: n=${b.n} internal nearest-neighbour distance median ${b.median} (min ${b.min}, max ${b.max})`);
        }
        console.log(`  subject: n=${report.subjectInternal.n} internal median ${report.subjectInternal.median}`);
        const tally = {};
        for (const r of report.rows) for (const [set, v] of Object.entries(r.against)) {
          tally[set] = tally[set] || {};
          tally[set][v.verdict] = (tally[set][v.verdict] || 0) + 1;
        }
        for (const [set, t] of Object.entries(tally)) {
          console.log(`  vs ${set}: ${Object.entries(t).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`);
        }
        console.log(`\n  label vs measurement: ${lvm.confirmed} confirmed · ${disagreements.length} disagreement(s)`);
        for (const d of disagreements) console.log(`    [${d.direction}] ${d.id} vs ${d.set}: ${d.verdict} of ${d.nearest} at ${d.distance} (pct ${d.pct}) — ${d.note}`);
      }
    }
    process.exit(0);
  }

  const T = dark
    ? { page: PAPER_DARK.bg, ink: PAPER_DARK.ink, ink2: PAPER_DARK.mut, ink3: PAPER_DARK.dim,
        rule: PAPER_DARK.line, rule2: PAPER_DARK.line2, wash: PAPER_DARK.panel2,
        accent: PAPER_DARK.acc, ctrl: PAPER_DARK.acc, impl: PAPER_DARK.mut, both: PAPER_DARK.acc2,
        ok: PAPER_DARK.ok, crit: PAPER_DARK.crit, part: DARK_SEMANTIC.part,
        plan: DARK_SEMANTIC.plan, low: DARK_SEMANTIC.low, med: DARK_SEMANTIC.med, high: DARK_SEMANTIC.high }
    : { page: PAPER_LIGHT.bg, ink: PAPER_LIGHT.ink, ink2: PAPER_LIGHT.mut, ink3: PAPER_LIGHT.dim,
        rule: PAPER_LIGHT.line, rule2: PAPER_LIGHT.line2, wash: PAPER_LIGHT.panel2,
        accent: PAPER_LIGHT.acc, ctrl: PAPER_LIGHT.acc, impl: PAPER_LIGHT.mut, both: PAPER_LIGHT.acc2,
        ok: PAPER_LIGHT.ok, crit: PAPER_LIGHT.crit, part: LIGHT_SEMANTIC.part,
        plan: LIGHT_SEMANTIC.plan, low: LIGHT_SEMANTIC.low, med: LIGHT_SEMANTIC.med, high: LIGHT_SEMANTIC.high };

  const out = argOf('--out', resolve(REPO, 'reports', `SCANNER-SUBJECT-TAXONOMY-v${doc.version}${dark ? '-dark' : ''}.html`));
  const SCALE_MAX = doc.scaleBounds.closureMax;
  const dial = (l, k) => ring(l, k, SCALE_MAX);
  const levels = Array.from({ length: SCALE_MAX + 1 }, (_, n) => n);
  const rows = (prefix) => doc.classes.filter((c) => prefixOf(c.id) === prefix).sort((a, b) => num(a.id) - num(b.id));
  const counts = doc.families.map((f) => `${f.roman}&nbsp;${rows(f.prefix).length}`).join(' · ');
  const byId = new Map((report ? report.rows : []).map((r) => [r.id, r]));

  const distCell = (id) => {
    const r = byId.get(id);
    if (!r) return '<span class="grey">unmeasured</span>';
    return Object.entries(r.against).map(([set, v]) =>
      `<span class="d d-${v.verdict}" title="nearest in ${esc(set)}: ${esc(v.nearest)} at distance ${v.distance}; threshold is that set's own internal median">`
      + `${esc(set)} ${esc(v.nearest || '—')} <b>${v.distance === null ? '—' : v.distance}</b></span>`).join('');
  };

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Scanner-as-subject taxonomy v${doc.version}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 11mm 13mm; }
  :root { --page:${T.page}; --ink:${T.ink}; --ink-2:${T.ink2}; --ink-3:${T.ink3};
    --rule:${T.rule}; --rule-2:${T.rule2}; --wash:${T.wash}; --accent:${T.accent};
    --ctrl:${T.ctrl}; --impl:${T.impl}; --both:${T.both}; --ok:${T.ok}; --crit:${T.crit}; --part:${T.part};
    --plan:${T.plan}; --low:${T.low}; --med:${T.med}; --high:${T.high}; }
  * { box-sizing:border-box; }
  html { -webkit-print-color-adjust:exact; print-color-adjust:exact; background:var(--page); }
  @media screen { body { max-width:1220px; margin-inline:auto; } }
  body { margin:0; padding:14px 18px 40px; background:var(--page); color:var(--ink);
    font:10.5pt/1.45 "Charter","Iowan Old Style",Georgia,serif; }
  header { border-bottom:2.5px solid var(--ink); padding-bottom:.6em; margin-bottom:1.1em; }
  .kicker { font:600 8pt/1 ui-sans-serif,-apple-system,sans-serif; letter-spacing:.14em;
    text-transform:uppercase; color:var(--ink-3); margin-bottom:.5em; }
  h1 { font:600 19pt/1.15 ui-sans-serif,-apple-system,sans-serif; letter-spacing:-.015em; margin:0 0 .3em; }
  .meta { font:8.5pt/1.5 ui-sans-serif,-apple-system,sans-serif; color:var(--ink-3); }
  h2 { font:600 12pt/1.25 ui-sans-serif,-apple-system,sans-serif; margin:1.5em 0 .45em;
    padding:.35em .6em; background:var(--wash); border-left:4px solid var(--accent);
    break-after:avoid; break-inside:avoid; }
  h2 .roman { color:var(--ink-3); font-weight:600; margin-right:.5em; }
  h2 .prefix { font-family:"SF Mono",Menlo,monospace; font-size:.85em; color:var(--accent); margin-left:.5em; }
  h2 .prop { display:block; font:400 8.5pt/1.4 "Charter",Georgia,serif; color:var(--ink-2);
    font-style:italic; margin-top:.25em; }
  h2.work { border-left-color:var(--ctrl); }
  .lede { font:10pt/1.5 "Charter",Georgia,serif; color:var(--ink-2); max-width:52em; margin:.6em 0; }
  .lede b { color:var(--ink); }
  .box { border:1px solid var(--rule); border-left:4px solid var(--accent); padding:.7em .9em;
    margin:.8em 0; background:var(--wash); break-inside:avoid; }
  .box .lbl { display:block; font:600 6.8pt/1.4 ui-sans-serif,sans-serif; letter-spacing:.12em;
    text-transform:uppercase; color:var(--ink-3); margin-bottom:.35em; }
  ul { margin:.4em 0 .4em 1.1em; padding:0; } li { margin:.22em 0; }
  table { width:100%; border-collapse:collapse; margin:0 0 .3em;
    font:8.6pt/1.4 ui-sans-serif,-apple-system,"Helvetica Neue",sans-serif; }
  thead { display:table-header-group; }
  th { text-align:left; font-weight:600; color:var(--ink-2); background:var(--wash);
    border-bottom:1.5px solid var(--rule); padding:.4em .5em; }
  td { padding:.42em .5em; border-bottom:1px solid var(--rule-2); vertical-align:top; }
  tr { break-inside:avoid; }
  tbody tr:nth-child(even) td { background:var(--wash); }
  td.id { font-family:"SF Mono",Menlo,monospace; font-weight:600; white-space:nowrap; width:3.4em; }
  td.name { width:14%; font-weight:600; }
  td.machine { width:15%; font-family:"SF Mono",Menlo,monospace; font-size:.9em; color:var(--accent); word-break:break-word; }
  td.desc { width:26%; } td.example { width:26%; color:var(--ink-2); }
  .analogy { display:block; margin-top:.45em; padding-left:.55em; border-left:2px solid var(--rule);
    font:italic 8.4pt/1.42 "Charter","Iowan Old Style",Georgia,serif; color:var(--ink-3); }
  .analogy .lbl { display:block; font:600 6.6pt/1.4 ui-sans-serif,-apple-system,sans-serif;
    font-style:normal; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3); opacity:.75; }
  .tag { font:600 7pt/1.6 ui-sans-serif,sans-serif; letter-spacing:.04em; padding:.1em .35em;
    border-radius:2px; border:1px solid currentColor; white-space:nowrap; }
  .tag.CTRL { color:var(--ctrl); } .tag.IMPL { color:var(--impl); } .tag.BOTH { color:var(--both); }
  .o { display:inline-block; font:600 6.8pt/1.6 ui-sans-serif,sans-serif; letter-spacing:.08em;
    text-transform:uppercase; padding:.1em .35em; border-radius:2px; border:1px solid currentColor; }
  .o-inherited { color:var(--ink-3); } .o-transposed { color:var(--accent); } .o-novel { color:var(--crit); }
  .st { display:inline-block; font:600 6.8pt/1.6 ui-sans-serif,sans-serif; letter-spacing:.06em;
    padding:.1em .35em; border-radius:2px; border:1px solid currentColor; }
  .st-wired { color:var(--ok); } .st-partial { color:var(--part); }
  .st-orphaned { color:var(--crit); } .st-absent { color:var(--ink-3); }
  .lens { display:block; margin-top:.3em; font:7.2pt/1.6 ui-sans-serif,sans-serif; color:var(--ink-3); }
  .lens span { border:1px solid var(--rule-2); border-radius:2px; padding:.05em .3em; margin-right:.2em; }
  .cites { font-family:"SF Mono",Menlo,monospace; font-size:.9em; color:var(--ink-3); }
  .dials { display:block; margin-top:.3em; } .ring { display:inline-block; margin-right:2px; vertical-align:middle; }
  .d { display:block; font:7.2pt/1.5 ui-sans-serif,sans-serif; white-space:nowrap; }
  .d-duplicate { color:var(--crit); font-weight:600; } .d-adjacent { color:var(--part); }
  .d-distinct { color:var(--ok); } .d-unmeasured { color:var(--ink-3); }
  .grey { color:var(--ink-3); font-style:italic; }
  footer { margin-top:2em; padding-top:.6em; border-top:1px solid var(--rule);
    font:8pt/1.5 ui-sans-serif,sans-serif; color:var(--ink-3); }
  @media (max-width:900px) { td.machine,td.example { word-break:break-word; } }
</style></head>
<body>
<header>
  <div class="kicker">commitwork · subject class: ${esc(doc.subjectClass.name)}</div>
  <h1>What can go wrong when the scanner is the subject</h1>
  <div class="meta">
    ${doc.classes.length} classes · ${doc.families.length} families (${counts}) ·
    ${doc.editions.map((e) => `edition ${e.version} ${esc(e.label)} ${e.ids.length}`).join(' · ')} ·
    verified against <b>${esc(doc.verifiedAgainst)}</b> ·
    generated by <code>bin/scanner-taxonomy-render.mjs</code> from
    <code>monitor/scanner-subject-taxonomy.json</code> — do not hand-edit.<br>
    Layer: <span class="tag CTRL">CTRL</span> decides what runs and what the result means ·
    <span class="tag IMPL">IMPL</span> does the work · <span class="tag BOTH">BOTH</span> both.
    Origin: <span class="o o-inherited">inherited</span> applies verbatim ·
    <span class="o o-transposed">transposed</span> changes meaning under the new subject ·
    <span class="o o-novel">novel</span> has no cell in the parent.
    Instrument: <span class="st st-wired">wired</span> runs unasked ·
    <span class="st st-partial">partial</span> narrower than the class ·
    <span class="st st-orphaned">orphaned</span> exists, nothing calls it ·
    <span class="st st-absent">absent</span> nothing addresses it.<br>
    Dials: <b>closure</b> ${levels.map((n) => dial(n, 'closure')).join('')} ${esc(doc.scales.closure)} ·
    <b>gain</b> ${levels.map((n) => dial(n, 'gain')).join('')} ${esc(doc.scales.gain)}.<br>
    <b>Scores are one rater.</b> ${esc(doc.scoreProvenance)}
  </div>
</header>

<section>
  <h2 class="work">The subject class<span class="prefix">${esc(doc.subjectClass.key)}</span>
    <span class="prop">${esc(doc.subjectClass.definition)}</span></h2>
  <p class="lede">${esc(doc.subjectClass.contrast)}</p>
  <div class="box"><span class="lbl">What changes when the subject is a run</span>
    <ul>${doc.subjectClass.whatChanges.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
  <div class="box"><span class="lbl">Boundary</span>${esc(doc.subjectClass.boundary)}</div>
  <div class="box"><span class="lbl">Full closure is absent, and that is the reading</span>${esc(doc.fullClosureAbsent)}</div>
</section>

<section>
  <h2 class="work">Security lenses<span class="prefix">${Object.keys(doc.lenses).length} lenses</span>
    <span class="prop">${esc(doc.lensNote || '')}</span></h2>
  <table>
    <thead><tr><th>Lens</th><th>Band</th><th>The question it asks</th><th>Instruments</th><th>State in this tree</th><th>Classes</th></tr></thead>
    <tbody>
${Object.entries(doc.lenses).map(([k, l]) => `      <tr>
        <td class="name">${esc(k)}${l.named ? '' : ' <span class="o o-novel">found</span>'}</td>
        <td style="width:9em">${esc(l.band)}</td>
        <td class="desc">${esc(l.test)}</td>
        <td class="machine">${l.instruments.map((i) => wrapId(i)).join('<br>')}</td>
        <td class="example">${esc(l.state)}</td>
        <td style="width:3.5em;text-align:center">${cov.counts[k] || '<span class="grey">0</span>'}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
  <p class="lede">Bands: ${Object.entries(doc.lensBands).map(([b, d]) => `<b>${esc(b)}</b> — ${esc(d)}`).join(' ')}</p>
</section>

<section>
  <h2 class="work">Measured distance from the other sets<span class="prefix">second witness on <code>origin</code></span>
    <span class="prop">Every class hand-declares inherited, transposed or novel. That is one rater. This measures the nearest neighbour of each class in each reference set and judges it against that set's OWN internal median nearest-neighbour distance, so the threshold is derived rather than chosen.</span></h2>
${report ? `  <p class="lede">Reference set baselines: ${Object.entries(report.baselines).map(([n, b]) => `<b>${esc(n)}</b> n=${b.n}, internal median ${b.median} (min ${b.min}, max ${b.max})`).join(' · ')}. This registry's own internal median is <b>${report.subjectInternal.median}</b>.
  A class measured <span class="d-duplicate">closer</span> than a set's median sits inside that set's own resolution; <span class="d-adjacent">adjacent</span> is within twice it; <span class="d-distinct">distinct</span> is beyond.</p>
  <div class="box"><span class="lbl">Label versus measurement — ${lvm.confirmed} confirmed, ${disagreements.length} disagreement${disagreements.length === 1 ? '' : 's'}</span>
  ${disagreements.length ? `<ul>${disagreements.map((d) => `<li><span class="o o-novel">${esc(d.direction)}</span> <b>${esc(d.id)}</b> vs <b>${esc(d.set)}</b>: nearest ${esc(d.nearest)} at ${d.distance}, percentile ${d.pct} — ${esc(d.note)}</li>`).join('')}</ul>`
    : 'No class labelled novel measured closer than adjacent to any reference set, and no class of any origin measured inside a reference set’s own resolution. The hand labels and the measurement agree everywhere. That is a floor under the origin column, not a proof that every transposition is real: the measurement can only see the text that was written.'}</div>`
  : '  <p class="lede grey">No reference set could be read on this machine, so distance is UNMEASURED. That is its own state: it is not zero distance, and it is not evidence that these classes are new.</p>'}
${unmeasured.length ? `  <p class="lede grey">Unmeasured sets: ${unmeasured.map((u) => `<b>${esc(u.name)}</b> (${esc(u.path)}) — ${esc(u.why)}`).join(' · ')}. Absent, not empty.</p>` : ''}
</section>

${doc.families.map((f) => `<section>
  <h2><span class="roman">${f.roman}</span>${esc(f.name)}<span class="prefix">${f.prefix}1&ndash;${f.prefix}${rows(f.prefix).length}</span>
    <span class="prop">The false proposition: &ldquo;${esc(f.proposition)}&rdquo;</span></h2>
  <table>
    <thead><tr><th>id</th><th>Name</th><th>Machine name</th><th>Origin &amp; lens</th><th>Instrument</th><th>Description &amp; analogy</th><th>Example</th><th>Distance</th></tr></thead>
    <tbody>
${rows(f.prefix).map((c) => `      <tr>
        <td class="id">${c.id}<span class="dials">${dial(c.closure, 'closure')}${dial(c.gain, 'gain')}</span>
          <span class="lens">ed ${c.edition}</span></td>
        <td class="name">${esc(c.name)}<span class="lens"><span class="tag ${c.layer}">${c.layer}</span></span></td>
        <td class="machine">${wrapId(c.machine)}</td>
        <td style="width:11%"><span class="o o-${c.origin}">${c.origin}</span>
          ${c.inherits.length ? `<span class="lens cites">${c.inherits.join(' ')}</span>` : ''}
          <span class="lens">${c.lens.map((l) => `<span>${esc(l)}</span>`).join('')}</span></td>
        <td style="width:10%"><span class="st st-${c.instrumentState}">${c.instrumentState}</span>
          ${c.instrument ? `<span class="lens cites">${wrapId(c.instrument)}</span>` : ''}</td>
        <td class="desc">${esc(c.description)}
          ${c.originNote ? `<span class="analogy"><span class="lbl">what changes</span>${esc(c.originNote)}</span>` : ''}
          <span class="analogy"><span class="lbl">analogy</span>${esc(c.analogy)}</span></td>
        <td class="example">${esc(c.example)}</td>
        <td style="width:9em">${distCell(c.id)}</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
</section>`).join('\n')}

<section>
  <h2 class="work">Editions</h2>
  <table>
    <thead><tr><th>#</th><th>Label</th><th>Date</th><th>What it is</th><th>Classes</th></tr></thead>
    <tbody>
${doc.editions.map((e) => `      <tr><td class="id">v${e.version}</td><td class="name">${esc(e.label)}</td>
        <td style="width:6em">${esc(e.date)}</td><td class="desc" style="width:46%">${esc(e.note)}</td>
        <td class="machine">${e.ids.join(' ')}</td></tr>`).join('\n')}
    </tbody>
  </table>
</section>

<footer>
  Parent registry: <code>${esc(doc.parentRegistry)}</code> — 166 classes whose subject is a scanned
  repository. Every <code>inherits</code> id above is resolved against it at render time, so a
  citation that stops resolving fails the render rather than printing a dead id.
  ${esc(doc.note)}
</footer>
</body></html>`;

  // The docsite copy is a draft document in the private root (lib/docsite-roots.mjs).
  const pageRoot = privateRoot() || docsiteRoot();
  const DOCSITE = resolve(pageRoot, 'imported', 'scanner-subject-taxonomy.html');
  // resolve() BOTH sides. `--out docsite/imported/scanner-subject-taxonomy.html` names the live file and does
  // not string-equal DOCSITE, so the raw compare skipped the snapshot while the
  // write below still replaced the real page — versioning off, overwrite on. writeAtomic
  // resolves against cwd exactly as this does, so guard and write now agree on the target.
  if (resolve(out) === DOCSITE) {
    let previous = null;
    try { previous = readFileSync(out, 'utf8'); } catch { /* first write */ }
    snapshotBeforeWrite('scanner-subject-taxonomy', 'generated', previous, { root: pageRoot });
  }
  // Redact at the boundary, exactly as bin/taxonomy-web.mjs and bin/taxonomy-render.mjs do. This
  // was the THIRD generator writing a public page and the only one with no redaction wired: the
  // page was clean, but only because nothing mapped had reached this register yet — detection
  // without prevention. The two witnesses (publish-redactions' fleet-wide page scan and
  // publish-scanner-redactions' tracked-page scan) would have caught a leak here AFTER it was
  // written; this stops it being written.
  //
  // Deliberately NOT redactScannersForPublish: that map is record-scoped to failure-taxonomy class
  // ids (C12, A11, …) and this register numbers its classes U1..U47. There is no collision today,
  // and if one ever appeared the module would THROW on a class whose text does not match — so
  // wiring it here would claim a coverage it does not have and break the render the day it did.
  writeAtomic(out, redactForPublish(html));
  console.log(`wrote ${out} — ${doc.classes.length} classes, ${doc.families.length} families, ${Object.keys(doc.lenses).length} lenses`);
}

const isMain = isMainModule(import.meta.url);
if (isMain) main();
