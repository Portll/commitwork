// corroboration.mjs — how many analysts saw this, and did they agree.
//
// THE CLAIM THIS EXISTS TO MAKE TRUE. commitwork's pitch is comparative-adversarial scanning:
// several engines over one surface, where their DISAGREEMENT is the signal. Measured on
// sweep-20260820120254 before this module existed: 4,096 distinct (repo, advisory, package)
// groups, 3,938 of them seen by exactly one analyst, and the 158 seen by two rendered as two
// unrelated rows. Their agreement was structurally unrepresentable, and so was their disagreement.
//
// IT IS A VIEW, NOT A RE-KEY. Finding identity stays exactly as it is — keyOf remains
// repo|tool|id|package|path, tool included. Merging analysts by CHANGING that key would re-key the
// entire historical corpus: counts.born and counts.cleaned would both read the full corpus size in
// one slice, every issue anchored on an old key would auto-close, and it would render as a mass
// remediation. That is CLAUDE.md's named trap in a new dimension, and this module refuses it by
// deriving the grouping at read time and never writing it back.
//
// THE GROUPING KEY EXCLUDES tool, path AND line, for the reason the house rule gives: identity is
// PLACE — repo, advisory, package. A finding that moves file or is seen by a second engine is the
// SAME finding, not a new one.

/** Package identity across ecosystems: strip a purl prefix and any version suffix. */
const normPkg = (s) => String(s || '').toLowerCase()
  .replace(/^pkg:[a-z]+\//, '')
  .replace(/@[^@/]*$/, '');

/** Advisory identity. Upper-cased; aliases are folded by the caller, never guessed here. */
const normId = (s) => String(s || '').toUpperCase().trim();

// A severity an analyst DECLINED to give. `unknown` and `''` are not opinions, and treating them
// as one manufactures disagreement: osv reports `unknown` for most GO-* advisories while
// govulncheck reports `med` for the same record, which is one analyst filling a gap the other
// left — not a conflict. 30 of the 40 apparent severity conflicts in sweep-20260820120254 are
// this shape.
const NO_OPINION = new Set(['', 'unknown', 'none', 'unspecified']);
const RANK = { crit: 4, high: 3, med: 2, low: 1 };

/**
 * Build agreement groups from a rollup.
 *
 * Returns { groups, summary } where each group is:
 *   { key, repo, id, package, analysts[], severities{analyst:sev},
 *     agreement: 'single'|'corroborated'|'disputed'|'complemented',
 *     reachability?: { provenBy[], analyzer } }
 *
 * `agreement` values:
 *   single         one analyst saw it. NOT a confidence statement — most of the fleet is here
 *                  because most lanes cover one ecosystem each.
 *   corroborated   two or more analysts, and every one that expressed a severity agreed.
 *   complemented   two or more analysts, but only one expressed a severity. The others saw the
 *                  same fact without rating it. This is NOT a dispute.
 *   disputed       two or more analysts expressed severities and they differ. THE VALUABLE ROW.
 */
export function agreementGroups(rollup) {
  const g = new Map();
  const add = (repo, id, pkg, analyst, sev, extra) => {
    if (!repo || !id) return;                       // a group needs a place and an advisory
    const key = `${repo}|${normId(id)}|${normPkg(pkg)}`;
    let e = g.get(key);
    if (!e) { e = { key, repo, id: normId(id), package: normPkg(pkg), analysts: [], severities: {}, reach: [] }; g.set(key, e); }
    if (!e.analysts.includes(analyst)) e.analysts.push(analyst);
    const s = String(sev || '').toLowerCase();
    if (!NO_OPINION.has(s)) e.severities[analyst] = s;
    if (extra && extra.reachable) e.reach.push(analyst);
  };

  const repos = (rollup && rollup.repos) || {};
  for (const rp of Object.values(repos)) {
    for (const f of (rp.findings || [])) add(rp.name, f.id, f.package, f.tool || 'osv', f.severity);
  }
  const sf = (rollup && rollup.scannerFindings) || {};
  for (const f of (sf.depsJvm || [])) add(f.repo, f.id, f.package, 'depsJvm', f.sev);
  // A second JVM analyst, whose resolution is DECLARED (version catalogs and build files closed
  // through deps.dev) rather than observed. That is exactly the kind of independence worth
  // corroborating against depsJvm — two readings of one dependency set, arrived at differently.
  // Tolerant of the lane being absent: `|| []` means this is correct before and after it lands.
  for (const f of (sf.depsGradleDeclared || [])) add(f.repo, f.id, f.package, 'depsGradleDeclared', f.sev);
  for (const f of (sf.depsRetire || [])) add(f.repo, f.id, f.package, 'depsRetire', f.sev);
  for (const f of (sf.maliciousPackages || [])) add(f.repo, f.id, f.package, 'maliciousPackages', 'crit');
  // govulncheck is the only analyst in the fleet that can PROVE a call path, so its reachable rows
  // are marked as such — a corroboration carrying a proof is worth more than one that does not.
  for (const f of (sf.depsGo || [])) {
    // The TYPED field, not the sentence. extractors.mjs types this precisely so a consumer need not
    // parse prose — and then this line parsed the prose anyway, which is the failure that comment
    // was written to prevent: re-wording the message would silently have zeroed every proven
    // reachability in the corroboration lane, with no test and no error.
    add(f.repo, f.id, f.package, 'depsGo', f.sev, { reachable: f.reachability === 'reachable' });
  }
  for (const f of (sf.depsReachability || [])) {
    add(f.repo, f.id, f.package, 'depsReachability', f.sev, { reachable: f.reachability === 'exploitable' });
  }

  const groups = [];
  for (const e of g.values()) {
    const rated = Object.values(e.severities);
    const distinct = new Set(rated);
    const agreement = e.analysts.length < 2 ? 'single'
      : rated.length < 2 ? 'complemented'
        : distinct.size > 1 ? 'disputed' : 'corroborated';
    const out = { key: e.key, repo: e.repo, id: e.id, package: e.package,
      analysts: [...e.analysts].sort(), severities: e.severities, agreement };
    if (agreement === 'disputed') {
      // Name the spread rather than picking a winner. Resolving a disagreement silently is the
      // thing this module exists to stop; the highest is offered as `worst` because a consumer
      // that must act needs the conservative reading, clearly labelled as a choice.
      const ranks = rated.map((s) => RANK[s] || 0);
      out.worst = rated[ranks.indexOf(Math.max(...ranks))];
      out.spread = [...distinct].sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0));
    }
    if (e.reach.length) out.reachabilityProvenBy = [...e.reach].sort();
    groups.push(out);
  }
  groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const summary = {
    groups: groups.length,
    single: groups.filter((x) => x.agreement === 'single').length,
    corroborated: groups.filter((x) => x.agreement === 'corroborated').length,
    complemented: groups.filter((x) => x.agreement === 'complemented').length,
    disputed: groups.filter((x) => x.agreement === 'disputed').length,
    withProvenReachability: groups.filter((x) => x.reachabilityProvenBy).length,
    // The fraction nobody checked twice. Published because it is the honest ceiling on any
    // comparative-adversarial claim: a fleet that is 96% single-analyst has not been cross-examined,
    // whatever its finding count says.
    singleAnalystShare: groups.length ? Number((groups.filter((x) => x.agreement === 'single').length / groups.length).toFixed(4)) : null,
  };
  return { groups, summary };
}

/** The disputed rows alone — the ones worth a human's attention first. */
export const disputes = (rollup) => agreementGroups(rollup).groups.filter((x) => x.agreement === 'disputed');
