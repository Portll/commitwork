#!/usr/bin/env node
// bin/feature-census.mjs — artifact (2) of the featureset census (docs/LAUNCHLIST.md): put every
// inventoried entry point in EXACTLY ONE class, by applying a declared membership test to the
// inventory's own fields. No model. The judgement lives in manifests/feature-charter.json, which is
// data; this file is the mechanism that applies it the same way every time.
//
//   node bin/feature-inventory.mjs --out reports/features.json
//   node bin/feature-census.mjs --in reports/features.json --out reports/census.json --md reports/census.md
//
// env (read at CALL time): CW_FC_IN · CW_FC_CHARTER · CW_FC_OUT · CW_FC_MD · CW_NOW
//
// THE TWO MECHANICAL CLASSES OUTRANK THE DECLARED ONE. `orphan` and `fragment` are computed from
// fields a human did not set — wired, uiReachable, hasHandler, referencedFrom, tests, docs — and they
// win over the charter's class, because a group can be core in intent and still have an entry point
// nothing reaches. Both are kept on the row (`class` and `declaredClass`), so the disposition reads
// as "core, currently a fragment, missing X" rather than collapsing to one word.
//
// NOTHING IS CLASSED BY DEFAULT. A (surface, key) pair the charter does not name comes out
// `unclassified`, counted, and listed. A census that silently files the unknown as core is the
// unsupported-pass defect this repository exists to refuse, pointed at itself.
//
// DEAD IS NOT CUT. No rule here proposes a deletion. An orphan's disposition is a DECISION — wire
// it, flag it, or cut it — and that decision is an operator's, recorded beside the row.

import { readFileSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { charterPath, routeKey, flagTable, ENFORCED_BY } from '../lib/feature-charter.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const envStr = (n) => (typeof process.env[n] === 'string' && process.env[n] !== '' ? process.env[n] : null);
export const censusNow = () => envStr('CW_NOW') || new Date().toISOString();
// One resolver for the census and the runtime flag gate (lib/feature-charter.mjs).
export { charterPath };
export const inventoryPath = () => resolve(envStr('CW_FC_IN') || join(ROOT, 'reports', 'features.json'));

/** ENOENT is absence; a parse failure is a failure. Neither is an empty census. */
function loadJson(abs, what) {
  let text;
  try { text = readFileSync(abs, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') throw new Error(`feature-census: no ${what} at ${abs} — run bin/feature-inventory.mjs first`);
    throw e;
  }
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`feature-census: ${what} at ${abs} does not parse (${e.message}) — refusing to census an unreadable input`); }
}

/**
 * The GROUPING KEY, declared per surface so a second rater derives the same one. It is deliberately
 * coarse: a census of 1,200 individual entry points answers no question anybody asks, and the
 * product already has a taxonomy of its own (the panel's nav sections, the route areas, the module
 * directories), so the census uses that rather than inventing a parallel one.
 */
export function groupKey(f) {
  switch (f.surface) {
    case 'cli-command': return f.name;
    case 'cli-script': return f.name.split('/')[0];
    case 'http-route': return routeKey(f.name.split(' ')[1] || '');
    case 'ui-view': return f.navGroup || 'chrome';
    case 'mcp-tool': return f.name;
    case 'job': return f.name;
    case 'package-api': return f.name;
    default: return f.name;
  }
}

/**
 * ORPHAN: wired into nothing that runs. One field per surface, named here so the test is auditable
 * rather than impressionistic. A surface with no wiring field returns null — "this test does not
 * apply", which is not the same as "it passed".
 * @returns {string|null} why it is an orphan, or null
 */
export function orphanReason(f) {
  switch (f.surface) {
    case 'http-route':
      return f.wired === false ? 'its route module is not spread into MODULAR_ROUTES, so nothing serves these paths' : null;
    case 'ui-view':
      return f.uiReachable === false ? 'no tab strip button, rail link or nav group reaches it' : null;
    case 'mcp-tool':
      return f.hasHandler === false ? 'a descriptor on the wire with no handler behind it' : null;
    case 'cli-script':
      return (f.entryKind === 'guard' && Array.isArray(f.referencedFrom) && f.referencedFrom.length === 0)
        ? 'no shebang, and no non-test file in the tree names it' : null;
    case 'config-flag':
      return f.readSites === 0 ? 'read only from tests — nothing in production consults it' : null;
    default:
      return null;
  }
}

/**
 * FRAGMENT: reachable, but a completeness field the inventory measured is missing. Ordered, so the
 * reported reason is the most actionable one rather than whichever matched first by accident.
 * @returns {string|null}
 */
export function fragmentReason(f) {
  // UNMEASURED IS NOT MISSING. `coverageMeasured === false` means the inventory had no probe for
  // this surface, so neither `tests` nor `docs` is evidence of anything here.
  if (f.coverageMeasured && Array.isArray(f.tests) && f.tests.length === 0) {
    return (Array.isArray(f.coreSiblingTests) && f.coreSiblingTests.length)
      ? `its logic is tested through ${f.coreSibling}, but nothing tests the entry point itself`
      : 'no test in the tree names it';
  }
  if (f.surface === 'ui-view' && f.pathRouted === false) return 'no durable URL — the view does not survive a reload';
  return null;
}

/**
 * The documentation gap is RECORDED, not classed. "No .md in this tree names this route" is true of
 * 79 of 173 routes and 101 of 307 scripts, and it is true because commitwork has no per-route or
 * per-script reference document — by design, so far. A measure that fires on half a surface because
 * of a design choice is a descriptive signal, and filing it as a `fragment` verdict is exactly the
 * defect signature CLAUDE.md names (one detector accounting for most of a bucket). Whether a
 * per-entry-point reference is required before publication is an OPERATOR call; this field is what
 * that call would be made on.
 * @returns {boolean|null} true documented, false undocumented, null not measured
 */
export function documented(f) {
  if (!f.coverageMeasured) return null;
  return Array.isArray(f.docs) && f.docs.length > 0;
}

export function buildCensus({ inventory, charter, now = censusNow() }) {
  if (!inventory || !Array.isArray(inventory.features)) throw new Error('feature-census: the inventory has no features array');
  if (!charter || !Array.isArray(charter.groups)) throw new Error('feature-census: the charter has no groups array');

  const population = new Set(charter.censusPopulation || []);
  // Throws on a malformed flag declaration: a census over a charter the runtime gate cannot read
  // would report flags nothing enforces.
  const flags = flagTable(charter);
  // (surface, key) -> group. A duplicate claim is a charter defect: "exactly one class" has to be
  // guaranteed by the data, not hoped for.
  const declared = new Map();
  for (const g of charter.groups) {
    for (const k of g.keys) {
      const id = `${g.surface}\u0000${k}`;
      if (declared.has(id)) throw new Error(`feature-census: charter claims ${g.surface}/${k} twice (${declared.get(id).id} and ${g.id}) — a feature cannot be in two classes`);
      declared.set(id, g);
    }
  }

  const rows = [];
  for (const f of inventory.features) {
    if (!population.has(f.surface)) continue;
    const key = groupKey(f);
    const g = declared.get(`${f.surface}\u0000${key}`) || null;
    const orphan = orphanReason(f);
    const fragment = orphan ? null : fragmentReason(f);
    const doc = documented(f);
    rows.push({
      id: f.id,
      surface: f.surface,
      name: f.name,
      groupKey: key,
      group: g ? g.id : null,
      declaredClass: g ? g.class : null,
      class: orphan ? 'orphan' : fragment ? 'fragment' : (g ? g.class : 'unclassified'),
      // A group the charter itself declares a fragment carries the charter's reason, so no row in
      // this class is ever reported with an empty `missing`.
      missing: orphan || fragment || (g && g.class === 'fragment' ? g.why : null),
      documented: doc,
      coverageMeasured: f.coverageMeasured !== false,
      location: f.file ? `${f.file}:${f.line}` : null,
      tests: Array.isArray(f.tests) ? f.tests.length : null,
      docs: Array.isArray(f.docs) ? f.docs.length : null,
      experimental: !!(g && g.experimental === true),
      flag: g && g.flag ? g.flag : null,
      flagEnforcedBy: g && g.flag ? (ENFORCED_BY[f.surface] || null) : null,
      testProbeWeak: !!f.testProbeWeak,
      undetermined: !!f.undetermined,
      undeterminedWhy: f.undeterminedWhy || null,
    });
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const counts = {};
  for (const r of rows) counts[r.class] = (counts[r.class] || 0) + 1;
  const bySurface = {};
  for (const r of rows) {
    const s = (bySurface[r.surface] ||= {});
    s[r.class] = (s[r.class] || 0) + 1;
  }

  // Flags are inventoried but not censused (charter.populationNote). Their gap is still counted, so
  // excluding them from the class map does not make it disappear.
  // Reported apart from the class map, per `documented()` above.
  const docGap = {};
  for (const r of rows) {
    const d = (docGap[r.surface] ||= { documented: 0, undocumented: 0, notMeasured: 0 });
    if (r.documented === true) d.documented++;
    else if (r.documented === false) d.undocumented++;
    else d.notMeasured++;
  }
  const configFlags = inventory.features.filter((f) => f.surface === 'config-flag');
  // Per flag: the rows it covers and which of them a runtime gate can switch off.
  const experimentalFlags = [...flags.values()].map((fl) => {
    const covered = rows.filter((r) => r.flag === fl.id);
    return {
      id: fl.id, label: fl.label, groups: fl.groups.map((g) => g.id), rows: covered.length,
      enforcedBy: [...new Set([
        ...fl.groups.map((g) => ENFORCED_BY[g.surface]),
        (fl.keys.view || []).length ? ENFORCED_BY['ui-view'] : null,
        // No group: the flag exists for code that asks featureEnabled()/gateFeature() by id.
        fl.groups.length ? null : 'code (lib/feature-flags.mjs featureEnabled)',
      ].filter(Boolean))].sort(),
      unenforcedSurfaces: [...new Set(fl.groups.map((g) => g.surface).filter((sf) => !ENFORCED_BY[sf]))].sort(),
    };
  });
  return {
    schema: 'commitwork.feature-census/1',
    generatedBy: 'bin/feature-census.mjs',
    generatedAt: now,
    charterVersion: charter.charterVersion || null,
    inventoryGeneratedAt: inventory.generatedAt || null,
    rater: 'rater-1 (mechanical classes computed; declared classes read from the charter)',
    membershipTests: charter.membershipTests || {},
    counts,
    bySurface: Object.fromEntries(Object.entries(bySurface).sort(([a], [b]) => (a < b ? -1 : 1))),
    documentationGap: {
      rule: 'an entry point is DOCUMENTED when a tracked .md in this tree contains its exact name or path. Recorded, never classed — see documented() in bin/feature-census.mjs.',
      bySurface: Object.fromEntries(Object.entries(docGap).sort(([a], [b]) => (a < b ? -1 : 1))),
      operatorCall: 'is a per-entry-point reference document required before publication? If yes, the undocumented counts are the work; if no, they are a measurement and not a gap.',
    },
    notCensused: {
      'config-flag': {
        total: configFlags.length,
        why: charter.populationNote || null,
        readOnlyFromTests: configFlags.filter((f) => f.readSites === 0).length,
        undocumented: configFlags.filter((f) => f.docs.length === 0).length,
      },
    },
    experimentalFlags,
    rows,
  };
}

function markdown(c) {
  const L = [];
  L.push('<!-- Generated by bin/feature-census.mjs — do not hand-edit; regenerate. -->');
  L.push('# Feature census');
  L.push('');
  L.push(`Charter \`${c.charterVersion}\` · inventory \`${c.inventoryGeneratedAt}\` · census \`${c.generatedAt}\` · ${c.rater}`);
  L.push('');
  L.push('## Membership tests, as applied');
  L.push('');
  for (const [k, v] of Object.entries(c.membershipTests)) L.push(`- **${k}** — ${v}`);
  L.push('');
  L.push('## Counts');
  L.push('');
  L.push('| class | rows |');
  L.push('|---|---:|');
  for (const [k, v] of Object.entries(c.counts).sort(([, a], [, b]) => b - a)) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('| surface | ' + Object.keys(c.counts).sort().join(' | ') + ' |');
  L.push('|---|' + Object.keys(c.counts).map(() => '---:').join('|') + '|');
  for (const [s, m] of Object.entries(c.bySurface)) {
    L.push(`| ${s} | ` + Object.keys(c.counts).sort().map((k) => m[k] || 0).join(' | ') + ' |');
  }
  for (const cls of ['orphan', 'fragment', 'unclassified']) {
    const rows = c.rows.filter((r) => r.class === cls);
    L.push('');
    L.push(`## ${cls} (${rows.length})`);
    if (!rows.length) { L.push(''); L.push('_none_'); continue; }
    L.push('');
    L.push('| feature | surface | would-be class | missing | location |');
    L.push('|---|---|---|---|---|');
    for (const r of rows) {
      L.push(`| \`${r.name}\` | ${r.surface} | ${r.declaredClass || '—'} | ${r.missing || '—'} | \`${r.location || '—'}\` |`);
    }
  }
  L.push('');
  L.push(`## Experimental flags (${c.experimentalFlags.length})`);
  L.push('');
  if (!c.experimentalFlags.length) L.push('_none declared_');
  else {
    L.push('| flag | groups | rows | enforced by | no runtime gate |');
    L.push('|---|---|---:|---|---|');
    for (const fl of c.experimentalFlags) {
      L.push(`| \`${fl.id}\` | ${fl.groups.join(', ')} | ${fl.rows} | ${fl.enforcedBy.join('; ') || '—'} | ${fl.unenforcedSurfaces.join(', ') || '—'} |`);
    }
  }
  L.push('');
  L.push('## Documentation gap (recorded, not classed)');
  L.push('');
  L.push(`_${c.documentationGap.rule}_`);
  L.push('');
  L.push('| surface | documented | undocumented | not measured |');
  L.push('|---|---:|---:|---:|');
  for (const [sf, v] of Object.entries(c.documentationGap.bySurface)) {
    L.push(`| ${sf} | ${v.documented} | ${v.undocumented} | ${v.notMeasured} |`);
  }
  L.push('');
  L.push(`**Operator call:** ${c.documentationGap.operatorCall}`);
  L.push('');
  L.push('## Not censused');
  L.push('');
  for (const [s, v] of Object.entries(c.notCensused)) {
    L.push(`- **${s}** — ${v.total} inventoried, ${v.readOnlyFromTests} read only from tests, ${v.undocumented} undocumented. ${v.why || ''}`);
  }
  return L.join('\n') + '\n';
}

function main(argv) {
  let inPath = null, outPath = null, mdPath = null, charterP = null, summaryOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') inPath = argv[++i];
    else if (a === '--out') outPath = argv[++i];
    else if (a === '--md') mdPath = argv[++i];
    else if (a === '--charter') charterP = argv[++i];
    else if (a === '--summary') summaryOnly = true;
    else { console.error(`feature-census: unknown argument ${a}`); return 2; }
  }
  const inv = loadJson(inPath ? resolve(inPath) : inventoryPath(), 'inventory');
  const charter = loadJson(charterP ? resolve(charterP) : charterPath(), 'charter');
  const census = buildCensus({ inventory: inv, charter });
  const out = outPath || envStr('CW_FC_OUT') || join(ROOT, 'reports', 'census.json');
  const md = mdPath || envStr('CW_FC_MD') || null;
  if (!summaryOnly) {
    writeAtomic(resolve(out), `${JSON.stringify(census, null, 2)}\n`, { mkdir: true });
    if (md) writeAtomic(resolve(md), markdown(census), { mkdir: true });
  }
  const parts = Object.entries(census.counts).sort(([, a], [, b]) => b - a).map(([k, v]) => `${k} ${v}`);
  console.log(`census ${census.rows.length} rows · ${parts.join(' · ')}`);
  for (const cls of ['orphan', 'unclassified']) {
    for (const r of census.rows.filter((x) => x.class === cls)) {
      console.log(`  ${cls.toUpperCase()} ${r.surface} ${r.name} — ${r.missing || 'no charter group for ' + r.surface + '/' + r.groupKey}`);
    }
  }
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
