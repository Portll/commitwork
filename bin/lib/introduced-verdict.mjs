// bin/lib/introduced-verdict.mjs — the one "introduced advisories" verdict for a dependency
// update: which advisories the resolved graph after the update carries that the graph before it
// did not. Pure over two graphs (bin/lib/npm-graph.mjs shape) and the advisory findings for the
// pairs lookupSet() names. The contract is docs/INTRODUCED-ADVISORIES.md.
//
// An advisory's record is (advisory id, package name). One present on both sides is introduced when
//   new-copy   the after side adds a version carrying it and keeps every version that carried it
//   now-ships  it was on dev-only versions before and ships after
// and persisting otherwise. A move, the old version gone and the new one still affected, persists,
// so a partial fix is not read as an introduction. One absent before is `new-advisory`.
// A pair is (package name, version); `findings` maps pairKey → { advisories } | { error }.
//
// state: introduces  at least one introduced advisory at a blocking severity
//        unmeasured  no blocking introduction found, and a graph, a pair or a lookup was not measured
//        clear       every pair that could change the answer was measured, and none introduces one

import { pairKey } from './npm-graph.mjs';

export const SCHEMA = 'commitwork.introduced-advisories';
export const VERSION = 1;
export const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'unknown'];
export const DEFAULT_BLOCKING = Object.freeze(['critical', 'high', 'unknown']);
export const CHECK = Object.freeze({ kind: 'security', id: 'dependency-audit' });
const LABEL = { critical: 'critical', crit: 'critical', high: 'high', moderate: 'moderate', medium: 'moderate', med: 'moderate', low: 'low', info: 'low' };

/** Any grader's label as a verdict severity; anything unreadable is unknown. */
export const severityOf = (s) => LABEL[String(s ?? '').toLowerCase()] ?? 'unknown';

const inScope = (graph, includeDev) => new Map([...graph.packages].filter(([, p]) => includeDev || p.exposure !== 'dev'));

/**
 * The pairs whose advisories decide the verdict: every in-scope pair, on either side, of a package
 * whose in-scope versions differ between the graphs. A package with the same versions on both
 * sides carries the same advisories on both, so it can neither introduce nor resolve one.
 */
export function lookupSet(before, after, { includeDev = true } = {}) {
  if (before.error || after.error) return { before: [], after: [] };
  const b = inScope(before, includeDev);
  const a = inScope(after, includeDev);
  // A pair whose source or exposure moved is a changed pair.
  const moved = (k) => !b.has(k) || b.get(k).registry !== a.get(k).registry || b.get(k).exposure !== a.get(k).exposure;
  const names = new Set([...a.keys()].filter(moved).map((k) => a.get(k).name));
  for (const k of b.keys()) if (!a.has(k)) names.add(b.get(k).name);
  const pick = (m) => [...m.values()].filter((p) => names.has(p.name)).map(({ name, version, registry }) => ({ name, version, registry }));
  return { before: pick(b), after: pick(a) };
}

function identities(graph, pairs, findings, side, unmeasured) {
  const out = new Map();
  for (const { name, version, registry } of pairs) {
    if (!registry) { unmeasured.push({ side, package: name, version, reason: 'not a registry package: no advisory database indexes it by version' }); continue; }
    const f = findings.get(pairKey(name, version));
    if (!f || f.error || !Array.isArray(f.advisories)) {
      unmeasured.push({ side, package: name, version, reason: f?.error || 'no advisory lookup answered for this version' });
      continue;
    }
    const node = graph.packages.get(pairKey(name, version));
    for (const adv of f.advisories) {
      const id = `${adv.id}\u0000${name}`;
      const cur = out.get(id) || { advisory: adv.id, aliases: [...(adv.aliases || [])].sort(), package: name, versions: [], severity: severityOf(adv.severity),
        severitySource: adv.severitySource || null, summary: adv.summary || '', url: adv.url || null, exposure: 'dev', paths: [] };
      cur.versions.push(version);
      if (node.exposure === 'prod') cur.exposure = 'prod';
      cur.paths.push(...node.paths);
      if (SEVERITIES.indexOf(severityOf(adv.severity)) < SEVERITIES.indexOf(cur.severity)) cur.severity = severityOf(adv.severity);
      out.set(id, cur);
    }
  }
  return out;
}

/** Why an after-side record is an introduction, or null when it persists. */
function whyIntroduced(before, after) {
  if (!before) return 'new-advisory';
  const had = new Set(before.versions);
  const has = new Set(after.versions);
  if ([...has].some((v) => !had.has(v)) && [...had].every((v) => has.has(v))) return 'new-copy';
  if (before.exposure === 'dev' && after.exposure === 'prod') return 'now-ships';
  return null;
}

const byKey = (a, b) => (a.advisory < b.advisory ? -1 : a.advisory > b.advisory ? 1 : a.package < b.package ? -1 : a.package > b.package ? 1 : 0);
const tidy = (r) => ({ ...r, versions: [...new Set(r.versions)].sort(), paths: r.paths.sort((x, y) => x.length - y.length).slice(0, 3) });

/**
 * The verdict document. `subject` and `source` are echoed; `generatedAt` is the caller's clock.
 * Every list is sorted, so the same inputs give byte-identical JSON.
 */
export function computeVerdict({ before, after, findingsBefore = new Map(), findingsAfter = new Map(), includeDev = true,
  blocking = DEFAULT_BLOCKING, subject = null, source = null, generatedAt = null }) {
  const reasons = [];
  const unmeasured = [];
  for (const [side, g] of [['before', before], ['after', after]]) if (g.error) reasons.push(`the ${side} graph could not be resolved: ${g.error}`);
  const base = { schema: SCHEMA, version: VERSION, check: CHECK, generatedAt, ecosystem: after.ecosystem || before.ecosystem || null,
    subject, source, scope: { includeDev, blocking: SEVERITIES.filter((s) => blocking.includes(s)) } };
  if (reasons.length) {
    return { ...base, state: 'unmeasured', reasons, counts: { introduced: 0, blocking: 0, resolved: 0, persisting: 0, unmeasured: 0, looked: 0 },
      introduced: [], resolved: [], unmeasured: [] };
  }
  const known = new Set(before.unresolved.map((u) => u.location));
  for (const u of after.unresolved) if (!known.has(u.location)) unmeasured.push({ side: 'after', package: null, version: null, location: u.location, reason: u.reason });
  const set = lookupSet(before, after, { includeDev });
  const b = identities(before, set.before, findingsBefore, 'before', unmeasured);
  const a = identities(after, set.after, findingsAfter, 'after', unmeasured);
  // An advisory on a package whose before side was not measured may have been there already.
  const blind = new Set(unmeasured.filter((u) => u.side === 'before').map((u) => u.package));
  for (const [k, r] of a) {
    if (b.has(k) || !blind.has(r.package)) continue;
    unmeasured.push({ side: 'after', package: r.package, version: tidy(r).versions.join(', '), advisory: r.advisory,
      reason: `${r.advisory} is on this package after the update, and its versions before the update were not measured` });
    a.delete(k);
  }
  const introduced = [...a].map(([k, r]) => [r, whyIntroduced(b.get(k), r)]).filter(([, why]) => why)
    .map(([r, why]) => ({ ...tidy(r), why, blocking: blocking.includes(r.severity) })).sort(byKey);
  const resolved = [...b].filter(([k]) => !a.has(k)).map(([, r]) => tidy(r)).sort(byKey);
  const persisting = [...a].filter(([k, r]) => b.has(k) && !whyIntroduced(b.get(k), r)).length;
  const blockers = introduced.filter((r) => r.blocking);
  unmeasured.sort((x, y) => `${x.side} ${x.package} ${x.version}`.localeCompare(`${y.side} ${y.package} ${y.version}`));
  const state = blockers.length ? 'introduces' : unmeasured.length ? 'unmeasured' : 'clear';
  if (state === 'unmeasured') reasons.push(`${unmeasured.length} version(s) that could change the answer were not measured`);
  return { ...base, state, reasons,
    counts: { introduced: introduced.length, blocking: blockers.length, resolved: resolved.length, persisting, unmeasured: unmeasured.length, looked: set.before.length + set.after.length },
    introduced, resolved, unmeasured };
}
