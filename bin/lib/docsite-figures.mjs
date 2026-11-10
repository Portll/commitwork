// bin/lib/docsite-figures.mjs — every claim-bearing figure on a tracked docsite page, with the
// computation that produces it. The launchlist row `content.evidence` asks that each number on the
// page link to the measurement behind it; this is that link, held as code rather than as prose, so
// the link is executed instead of promised.
//
// THE TWO DIRECTIONS, HELD APART. `figures()` recomputes each registered claim from the tracked
// source and reports stated vs measured — that catches a figure that has gone stale. `unregistered()`
// walks the page's own prose and reports every claim-bearing numeral the registry does not cover —
// that catches a figure nobody linked. Only the second direction notices a NEW unsourced number, so
// a registry alone would read clean forever while the page drifted around it.
//
// WHAT IS NOT A FIGURE. A section number, a date, a standard's number (IEC 61882), a count the
// sentence itself defines ("the seven basic words") and a figure restated from a row above it carry
// no independent claim. Each one is listed in NOT_A_FIGURE with the reason it is there, because an
// exemption with no reason is indistinguishable from an oversight.
//
// FAIL CLOSED. A source this cannot read is `undetermined`, with the reason, and never a reproduced
// figure and never a silent drop. ENOENT alone is "absent"; a parse failure or a permission error is
// an error. A caller that treats `undetermined` as a pass has reintroduced the defect.
//
// env, read at CALL time: CW_DF_ROOT (repo root; tests point it at a fixture)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..');

/** Env read at CALL time — a `const` at module load defeats every test that sets it afterwards. */
export const figuresRoot = () => {
  const v = process.env.CW_DF_ROOT;
  return resolve(typeof v === 'string' && v !== '' ? v : DEFAULT_ROOT);
};

/** The page whose figures are registered below. */
export const GUIDE = 'docsite/content/stpa-hazop-field-guide.md';

/**
 * THE SCOPE, DECLARED. Every tracked docsite SOURCE and how its numbers are sourced. `pages/` is a
 * build artefact (bin/docsite-build.mjs) and is not listed: a figure fixed there dies at the next
 * build. A file added to docsite/ without a row here fails bin/test/docsite-figures.test.mjs,
 * because the cheapest way for this row to go stale is a new page nobody inventoried.
 *
 *  registry      — figures recomputed from tracked data by figures() below
 *  generated     — the page is rendered from data, so its censuses are computed and not restated
 *  dated-snapshot— a measurement reported with its date, which names the source for re-measuring
 *  no-figures    — the page states no numeral at all (asserted, not assumed)
 *  not-content   — editor chrome and assets: no prose a reader takes a figure from
 */
export const PAGES = [
  { path: GUIDE, how: 'registry' },
  { path: 'docsite/content/licensing.md', how: 'no-figures' },
  { path: 'docsite/content/privacy.md', how: 'no-figures' },
  { path: 'docsite/content/commitwork-coverage-survey.md', how: 'no-figures' },
  {
    path: 'docsite/imported/taxonomy-reference.html',
    how: 'generated',
    by: 'bin/taxonomy-render.mjs',
    why: 'every class count and family census is computed from monitor/failure-taxonomy.json at render time; node bin/taxonomy-render.mjs --check validates the registry it counts',
  },
  {
    path: 'docsite/imported/commitwork-coverage-survey.html',
    how: 'dated-snapshot',
    asOf: '26 August 2026',
    // The page refuses to restate its two headline counts and names where to read them instead.
    // Those names are citations, so they are checked: a citation to a file that has moved is worse
    // than no citation, because it reads as sourced.
    cites: ['manifests/security-baseline.json', 'monitor/lane-kinds.mjs'],
    why: 'a snapshot reported with its measurement date, re-checked 4 October 2026, which names its sources rather than restating counts that go stale',
  },
  { path: 'docsite/manifest.json', how: 'not-content' },
  { path: 'docsite/editor/edit.html', how: 'not-content' },
  { path: 'docsite/editor/editor.css', how: 'not-content' },
  { path: 'docsite/editor/editor.js', how: 'not-content' },
  { path: 'docsite/public/og.png', how: 'not-content' },
];

/**
 * Read a tracked JSON source. Returns {ok:true,value} or {ok:false,absent,error} — never `{}`.
 * @param {string} root @param {string} rel
 */
export function readSource(root, rel) {
  let raw;
  try { raw = readFileSync(join(root, rel), 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return { ok: false, absent: true, error: `${rel} is absent` };
    return { ok: false, absent: false, error: `${rel} could not be read (${e.code || e.message})` };
  }
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch (e) { return { ok: false, absent: false, error: `${rel} is not readable JSON: ${e.message}` }; }
}

/**
 * CWE/CAPEC reach, derived once from the patterns' own `cwe` lists rather than from the published
 * `byCwe` index, so the index and the derivation are two witnesses to the same number.
 */
function reach(capec) {
  const capecsOf = new Map();
  const techniquesOf = new Map();
  const techniqueRowsOf = new Map();
  for (const [id, p] of Object.entries(capec.patterns)) {
    for (const c of p.cwe || []) {
      if (!capecsOf.has(c)) { capecsOf.set(c, new Set()); techniquesOf.set(c, new Set()); techniqueRowsOf.set(c, 0); }
      capecsOf.get(c).add(id);
      for (const t of p.attack || []) { techniquesOf.get(c).add(t); techniqueRowsOf.set(c, techniqueRowsOf.get(c) + 1); }
    }
  }
  return { capecsOf, techniquesOf, techniqueRowsOf };
}

/**
 * Recompute every registered figure.
 * @param {{root?: string}} [opts]
 * @returns {{figures: object[], undetermined: object[], sources: object}}
 */
export function figures({ root = figuresRoot() } = {}) {
  const out = [];
  const undetermined = [];
  const srcs = {
    tax: readSource(root, 'monitor/failure-taxonomy.json'),
    cwe: readSource(root, 'monitor/data/cwe-graph.json'),
    capec: readSource(root, 'monitor/data/capec-graph.json'),
  };
  const add = (f) => out.push(f);
  const needs = (keys, id, claim) => {
    for (const k of keys) if (!srcs[k].ok) { undetermined.push({ id, claim, why: srcs[k].error }); return false; }
    return true;
  };

  if (needs(['tax'], 'stpa.vocabulary', 'the STPA vocabulary counts')) {
    const v = srcs.tax.value.stpaVocabulary || {};
    for (const [key, id, claim] of [['loops', 'stpa.loops', 'STPA loops'], ['uca', 'stpa.uca', 'UCA values'], ['cause', 'stpa.cause', 'causal factors']]) {
      const got = v[key] && typeof v[key] === 'object' ? Object.keys(v[key]).length : null;
      if (got === null) undetermined.push({ id, claim, why: `monitor/failure-taxonomy.json has no stpaVocabulary.${key} object` });
      else add({ id, claim, measured: got, source: 'monitor/failure-taxonomy.json', how: `Object.keys(stpaVocabulary.${key}).length` });
    }
  }

  if (needs(['cwe'], 'cwe.count', 'CWEs in the shipped view')) {
    const c = srcs.cwe.value;
    const keys = Object.keys(c.cwes || {}).length;
    add({ id: 'cwe.count', claim: 'CWEs in the shipped view', measured: keys, source: 'monitor/data/cwe-graph.json', how: 'Object.keys(cwes).length' });
    // Second witness: the file's own `count` must agree with the collection it summarises.
    if (c.count !== keys) undetermined.push({ id: 'cwe.count.disagree', claim: 'CWEs in the shipped view', why: `cwe-graph.json count=${c.count} disagrees with Object.keys(cwes).length=${keys}` });
  }

  if (needs(['capec'], 'capec.live', 'live CAPEC patterns')) {
    const c = srcs.capec.value;
    const live = Object.keys(c.patterns || {}).length;
    const dropped = c.dropped && typeof c.dropped.deprecated === 'number' ? c.dropped.deprecated : null;
    add({ id: 'capec.live', claim: 'live CAPEC patterns', measured: live, source: 'monitor/data/capec-graph.json', how: 'Object.keys(patterns).length' });
    if (dropped === null) undetermined.push({ id: 'capec.deprecated', claim: 'deprecated CAPEC patterns', why: 'capec-graph.json has no numeric dropped.deprecated' });
    else {
      add({ id: 'capec.deprecated', claim: 'deprecated CAPEC patterns', measured: dropped, source: 'monitor/data/capec-graph.json', how: 'dropped.deprecated' });
      add({ id: 'capec.total', claim: 'CAPEC patterns, live and deprecated', measured: live + dropped, source: 'monitor/data/capec-graph.json', how: 'Object.keys(patterns).length + dropped.deprecated' });
    }
    if (c.count !== live) undetermined.push({ id: 'capec.live.disagree', claim: 'live CAPEC patterns', why: `capec-graph.json count=${c.count} disagrees with Object.keys(patterns).length=${live}` });

    const pats = Object.values(c.patterns || {});
    const noAttack = pats.filter((p) => !(p.attack || []).length).length;
    add({ id: 'capec.noAttack', claim: 'live patterns with a CWE mapping but no ATT&CK technique', measured: noAttack, source: 'monitor/data/capec-graph.json', how: 'patterns with attack.length === 0' });
    add({ id: 'capec.noAttack.pct', claim: 'share of live patterns with no ATT&CK technique', measured: Math.round(noAttack / pats.length * 100), source: 'monitor/data/capec-graph.json', how: 'round(noAttack / patterns * 100)' });
    const withCwe = pats.filter((p) => (p.cwe || []).length).length;
    add({ id: 'capec.withCwe', claim: 'live patterns carrying a CWE', measured: withCwe, source: 'monitor/data/capec-graph.json', how: 'patterns with cwe.length > 0' });
    for (const abs of ['Meta', 'Standard', 'Detailed']) {
      const lvl = pats.filter((p) => p.abstraction === abs);
      add({ id: 'capec.abs.' + abs.toLowerCase(), claim: `${abs} patterns carrying a CWE, over ${abs} patterns`, measured: lvl.filter((p) => (p.cwe || []).length).length + '/' + lvl.length, source: 'monitor/data/capec-graph.json', how: `patterns with abstraction === '${abs}'` });
    }
  }

  if (needs(['cwe', 'capec'], 'cwe.reach', 'what one CWE reaches')) {
    const { capecsOf, techniquesOf, techniqueRowsOf } = reach(srcs.capec.value);
    const inView = Object.keys(srcs.cwe.value.cwes || {});
    const reaching = inView.filter((c) => capecsOf.has(c));
    add({ id: 'cwe.noCapec', claim: 'CWEs in the shipped view with no CAPEC', measured: inView.length - reaching.length, source: 'both graphs', how: 'CWEs in cwe-graph.cwes that no capec-graph pattern lists' });
    add({ id: 'cwe.noCapec.pct', claim: 'share of shipped-view CWEs with no CAPEC', measured: ((inView.length - reaching.length) / inView.length * 100).toFixed(1), source: 'both graphs', how: 'noCapec / cwes * 100, one decimal' });
    add({ id: 'cwe.maxCapecs', claim: 'the most CAPEC patterns one CWE reaches', measured: Math.max(...reaching.map((c) => capecsOf.get(c).size)), source: 'both graphs', how: 'max over shipped-view CWEs of distinct patterns listing it' });
    // The row this figure argues about counts ONE ROW PER TECHNIQUE, so the row count and the
    // distinct-technique count are different numbers and both are stated. Collapsing them is the
    // inflation the row is about.
    add({ id: 'cwe.maxTechniqueRows', claim: 'per-technique rows the widest CWE would produce', measured: Math.max(...reaching.map((c) => techniqueRowsOf.get(c))), source: 'both graphs', how: 'max over shipped-view CWEs of sum(pattern.attack.length) across its patterns' });
    add({ id: 'cwe.maxTechniques', claim: 'distinct ATT&CK techniques the widest CWE reaches', measured: Math.max(...reaching.map((c) => techniquesOf.get(c).size)), source: 'both graphs', how: 'max over shipped-view CWEs of distinct attack ids across its patterns' });
    const rowy = reaching.filter((c) => techniqueRowsOf.get(c) > 0);
    add({ id: 'cwe.avgTechniqueRows', claim: 'per-technique rows per CWE that reaches any ATT&CK', measured: (rowy.reduce((a, c) => a + techniqueRowsOf.get(c), 0) / rowy.length).toFixed(1), source: 'both graphs', how: 'sum(technique rows) / CWEs with at least one, one decimal' });
  }

  // The guide-word lexicon is the page's OWN content, so its counts are computed from the table
  // rather than exempted: "ten standard, two extensions, two proposed" is a claim about a table
  // twelve lines further down, and a row added without touching the heading is the drift.
  const lex = lexicon({ root });
  if (lex.error) undetermined.push({ id: 'hazop.lexicon', claim: 'guide words by kind', why: lex.error });
  else for (const [kind, n] of Object.entries(lex.counts)) {
    add({ id: 'hazop.lexicon.' + kind, claim: `${kind} guide words`, measured: n, source: GUIDE, how: `rows whose first table cell is "${kind}" in the lexicon table` });
  }

  return { figures: out, undetermined, sources: srcs };
}

/**
 * Count the lexicon table's rows by the kind in their first cell. The table is found by its
 * heading, not by position: a table moving down the page is not a change to the lexicon.
 * @returns {{counts: Record<string, number>} | {error: string}}
 */
export function lexicon({ root = figuresRoot(), page = GUIDE } = {}) {
  let text;
  try { text = readFileSync(join(root, page), 'utf8'); }
  catch (e) { return { error: `${page} could not be read (${e.code || e.message})` }; }
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^###\s+The lexicon\b/.test(l));
  if (at < 0) return { error: `${page} has no "### The lexicon" heading, so its guide words cannot be counted` };
  const counts = {};
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{2,3}\s/.test(l)) break;
    const m = /^\|\s*(core|extension|proposed)\s*\|/.exec(l);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  if (!Object.keys(counts).length) return { error: `${page}'s lexicon table has no core/extension/proposed rows` };
  return { counts };
}

// ── THE SECOND DIRECTION: numerals the registry does not cover ─────────────────────────────────

/**
 * The page's prose with code removed. Fenced blocks, inline code and inline SVG carry coordinates,
 * ids and CSS, none of which is a claim about the world; leaving them in makes 41 claim-bearing
 * numerals read as 153 and buries the ones that matter.
 */
export function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' \u0000code\u0000 ')
    .replace(/`[^`\n]*`/g, ' \u0000c\u0000 ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' \u0000svg\u0000 ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Numerals in prose that carry no independent claim. Each entry names WHY, because an exemption
 * list with no reasons is a way to make any page read as fully sourced.
 */
export const NOT_A_FIGURE = [
  { re: /^0\d$/, after: /^\s*—\s/, why: 'a section number: the "## 01 — …" heading form, matched with the em dash that follows it' },
  { re: /^61882$/, before: /\bIEC\s*$/, why: 'the number of a standard, matched only where IEC precedes it: not a measurement' },
];
// There is deliberately NO year exemption. An ISO date never reaches this list — the numeral
// pattern's trailing (?![\w-]) rejects `2026` in `2026-08-23` — so one would match nothing, and a
// four-digit count beginning 19 or 20 would be the only thing it could ever exempt. An exemption
// that cannot fire reads as coverage; bin/test/docsite-figures.test.mjs asserts that none is dead.

/**
 * Every claim-bearing numeral in the page, with the registry entry that covers it or `null`.
 * A numeral is covered when its value appears among the measured figures; the check that the
 * doc's value is CORRECT is `figures()`, not this.
 * @returns {{covered: object[], unregistered: object[]}}
 */
export function unregistered({ root = figuresRoot(), page = GUIDE, measured = null } = {}) {
  let text;
  try { text = readFileSync(join(root, page), 'utf8'); }
  catch (e) { return { error: `${page} could not be read (${e.code || e.message})`, covered: [], unregistered: [] }; }
  const values = new Set();
  for (const f of measured || figures({ root }).figures) {
    for (const part of String(f.measured).split('/')) values.add(part);
  }
  const covered = [];
  const un = [];
  const body = prose(text);
  const re = /(?<![\w.#-])(\d+(?:[.,]\d+)*)(?![\w-])/g;
  let m;
  while ((m = re.exec(body))) {
    const n = m[1];
    const context = body.slice(Math.max(0, m.index - 70), Math.min(body.length, m.index + n.length + 70)).trim();
    // An exemption matches the VALUE and its surroundings. On value alone, "20xx is a year" would
    // also exempt a count of 2026 things, and "0x is a section number" any two-digit value written
    // with a leading zero.
    const exempt = NOT_A_FIGURE.find((x) => x.re.test(n)
      && (!x.after || x.after.test(body.slice(m.index + n.length, m.index + n.length + 24)))
      && (!x.before || x.before.test(body.slice(Math.max(0, m.index - 24), m.index))));
    if (values.has(n)) covered.push({ value: n, context });
    else if (exempt) covered.push({ value: n, context, exempt: exempt.why });
    else un.push({ value: n, context });
  }
  return { covered, unregistered: un };
}
