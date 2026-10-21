// version-delta.mjs — lane C: did a package VERSION change BEHAVIOUR CLASS with no matching source
// change? The xz / event-stream shape — a payload that enters the PUBLISHED artifact but not the
// declared source. NOT "does this package look bad": a join of per-snapshot signals across
// REGISTRY-ADJACENT version pairs, ranked into the nondeterministic store, never crit/high/med/low.
//
// THE CONVERGENCE RULE (base rate ~1e-4/version, so a lone signal is noise, not a verdict):
//   a code-behaviour change WITH no matching source diff → ANOMALY (ranked into the store)
//   behaviour PRESENT but not a CHANGE (first-seen / born-bad) → undetermined, never an anomaly
//   the source could not be resolved to confirm/deny → unknown, never an anomaly and never clean
//
// NO BASELINE ⇒ unknown, NEVER "changed" — a first-seen package/version would flood the whole tree on
// day one. 'no-baseline' is spelled `no-reference` in the CLOSED unknown vocabulary (unknown.mjs),
// whose own text is "compared against nothing — no baseline …". A synonym would fragment the
// vocabulary that module exists to keep closed (its named C4 defect), so we reuse the reason, not coin one.
//
// Unmeasured is neither a pass nor a finding. A class not observed on BOTH versions is unobserved — not clean, not a
// finding; it is excluded from the delta AND from the clean count. An unresolved source is unknown,
// never a published anomaly: over-reporting is the costly direction for a tool whose claim is that its
// numbers survive being checked.
//
// PREVALENCE GUARD. >~1% of adjudicated pairs anomalous is a FLOOD signature — an attacker publishing
// near-neighbours to trip a kill-switch — not a fleet in crisis. Response is ANOMALY-BIASED sampling of
// the CHANGED subset (highest rank first, deterministic) + loud grey, and NEVER auto-disable; disabling
// is the attacker's goal. Sampling is of the changed/anomalous subset, never uniform over all packages.
//
// Env, read at CALL time: CW_VERSION_DELTA=off, CW_VERSION_DELTA_PREVALENCE, CW_VERSION_DELTA_CAP.

import { record } from './nondeterministic-store.mjs';
import { unknown } from './unknown.mjs';
import { classifyResolution } from './dep-provenance.mjs';
import { claim } from './denominator.mjs';

// The closed class vocabulary. Each is a MECHANISM, not a severity. install-script / capability /
// minified-blob are CODE behaviour (the source can corroborate them); maintainer-change and
// registry-identity are publisher/registry CONTEXT (the source cannot), so they amplify a convergence
// but never trigger one alone — otherwise ordinary ownership churn floods the store.
export const BEHAVIOUR_CLASSES = Object.freeze({
  INSTALL_SCRIPT: 'install-script', CAPABILITY: 'capability', MINIFIED: 'minified-blob',
  MAINTAINER: 'maintainer-change', IDENTITY: 'registry-identity',
});
const CLASS = BEHAVIOUR_CLASSES;
const CODE_CLASSES = new Set([CLASS.INSTALL_SCRIPT, CLASS.CAPABILITY, CLASS.MINIFIED]);

// Rank weights, combined by noisy-OR so convergence (many classes at once) ranks higher than any one.
export const WEIGHT = Object.freeze({
  'install-script': 0.5, 'capability': 0.4, 'minified-blob': 0.45, 'maintainer-change': 0.25, 'registry-identity': 0.3,
});

// The lifecycle scripts that RUN on install — the classic infection vector. `prepare`/`prepublish`
// run on publish/install too and are included; a plain `build` is not, it never auto-runs.
const LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']);

export const enabled = () => process.env.CW_VERSION_DELTA !== 'off';
const prevalenceThreshold = () => { const v = Number(process.env.CW_VERSION_DELTA_PREVALENCE); return Number.isFinite(v) && v > 0 ? v : 0.01; };
const sampleCap = () => { const v = Number(process.env.CW_VERSION_DELTA_CAP); return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 50; };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const noisyOR = (ws) => 1 - ws.reduce((p, w) => p * (1 - clamp01(w)), 1);
const round4 = (n) => Math.round(n * 1e4) / 1e4;

// Normalise a repo/identity URL to a comparable key: drop protocol, git+ prefix, .git suffix, host of
// the common forges, and any #ref/?query — so github vs git+https vs …/foo.git#sha all compare equal.
const repoKey = (u) => String(u || '').toLowerCase().trim()
  .replace(/^git\+/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[#?].*$/, '')
  .replace(/\.git$/, '').replace(/\/+$/, '').replace(/^(www\.)?(github\.com|gitlab\.com|bitbucket\.org)\//, '');

// ── registry-adjacency ────────────────────────────────────────────────────────────────────────────
// Two versions are a STEP only when the registry's publish order says so. Semver order ≠ publish order
// (an attacker can publish out of band), so adjacency is read from the order, never inferred. Without
// the order we refuse to attribute a delta rather than guess a step (fail closed). Same version string
// with changed signals is a `republish` — the strongest shape and one that needs no order.
export function adjacencyOf(prevVer, currVer, order) {
  if (prevVer === currVer) return { relation: 'republish', window: 0 };
  const ord = Array.isArray(order) ? order : null;
  if (!ord) return { relation: 'unordered', window: null };
  const pi = ord.indexOf(prevVer); const ci = ord.indexOf(currVer);
  if (pi < 0 || ci < 0) return { relation: 'unordered', window: null };
  if (ci === pi + 1) return { relation: 'adjacent', window: 1 };
  if (ci > pi + 1) return { relation: 'window', window: ci - pi };   // slow-boil: change entered SOMEWHERE in here
  return { relation: 'regressed', window: ci - pi };                 // curr precedes prev — not a forward step
}

// Items present in curr and absent from prev, but ONLY when BOTH sides carried the field (explicit uncertainty:
// a missing field is unobserved, not "none present").
function newlyAppeared(prevArr, currArr, keep = () => true) {
  if (!Array.isArray(prevArr) || !Array.isArray(currArr)) return { observed: false, added: [] };
  const p = new Set(prevArr.filter(keep));
  return { observed: true, added: [...new Set(currArr.filter(keep))].filter((x) => !p.has(x)).sort() };
}
function minifiedAppeared(prev, curr) {
  if (typeof prev.minified !== 'number' || typeof curr.minified !== 'number') return { observed: false, appeared: false };
  return { observed: true, appeared: prev.minified === 0 && curr.minified > 0 };
}
function maintainerChanged(prev, curr) {
  if (!Array.isArray(prev.maintainers) || !Array.isArray(curr.maintainers)) return { observed: false, changed: false };
  const p = new Set(prev.maintainers); const c = new Set(curr.maintainers);
  const added = [...c].filter((x) => !p.has(x)).sort(); const removed = [...p].filter((x) => !c.has(x)).sort();
  return { observed: true, changed: added.length > 0 || removed.length > 0, added, removed };
}
// Registry identity diverging from the DECLARED repo — read through dep-provenance's classifier so the
// two lanes agree on what "off registry" means. A divergence counts only when it is NEW this version.
function identityState(o) {
  const decl = repoKey(o.declaredRepo); const id = repoKey(o.registryIdentity);
  if (!decl || !id) return { observed: false, diverged: false };
  return { observed: true, diverged: decl !== id, from: decl, to: id, resolution: classifyResolution(o.registryIdentity) };
}
function identityDiverged(prev, curr) {
  const cs = identityState(curr); const ps = identityState(prev);
  if (!cs.observed) return { observed: false, diverged: false };
  return { observed: true, diverged: cs.diverged && (!ps.observed || !ps.diverged), from: cs.from, to: cs.to, resolution: cs.resolution };
}

// Does the DECLARED-source view of this version reflect the artifact's new behaviour? Present and it
// has the item → matching (ordinary dev). Present without it → none (artifact-only = the xz shape).
// Absent, or the source did not observe THIS dimension → unresolved (fail closed to unknown).
function corroborate(kind, added, source) {
  if (!source || typeof source !== 'object') return 'unresolved';
  if (kind === CLASS.INSTALL_SCRIPT || kind === CLASS.CAPABILITY) {
    const field = kind === CLASS.INSTALL_SCRIPT ? source.scripts : source.capabilities;
    if (!Array.isArray(field)) return 'unresolved';
    const s = new Set(field);
    return added.every((a) => s.has(a)) ? 'matching' : 'none';
  }
  if (kind === CLASS.MINIFIED) {
    if (typeof source.minified !== 'number') return 'unresolved';
    return source.minified > 0 ? 'matching' : 'none';
  }
  return 'unresolved';
}

// Concerning signals PRESENT in a single (first-seen) observation — born-bad, not a delta.
export function bornBadSignals(o) {
  const s = [];
  if (Array.isArray(o.scripts) && o.scripts.some((x) => LIFECYCLE.has(x))) s.push(CLASS.INSTALL_SCRIPT);
  if (Array.isArray(o.capabilities) && o.capabilities.length) s.push(CLASS.CAPABILITY);
  if (typeof o.minified === 'number' && o.minified > 0) s.push(CLASS.MINIFIED);
  if (identityState(o).diverged) s.push(CLASS.IDENTITY);
  return s;
}

/**
 * Classify ONE registry-adjacent pair for one package. PURE — records nothing. Returns a verdict of
 * anomaly | explained | undetermined | clean | unknown(reason). `order` is the registry publish order
 * for this package (or null); its absence makes any cross-version pair `not-adjudicated`, never clean.
 */
export function classifyPair(prevObs, currObs, { order = null } = {}) {
  const adj = adjacencyOf(prevObs.version, currObs.version, order);
  const base = { from: prevObs.version, to: currObs.version, relation: adj.relation, window: adj.window };
  if (adj.relation === 'unordered') {
    return { ...base, verdict: 'unknown', ...unknown('not-adjudicated', 'no registry publish order to establish these versions are a step — refusing to attribute a delta') };
  }
  if (adj.relation === 'regressed') {
    return { ...base, verdict: 'unknown', ...unknown('unexaminable', 'the observed version precedes the baseline in publish order — not a forward step') };
  }

  const scripts = newlyAppeared(prevObs.scripts, currObs.scripts, (s) => LIFECYCLE.has(s));
  const caps = newlyAppeared(prevObs.capabilities, currObs.capabilities);
  const minif = minifiedAppeared(prevObs, currObs);
  const maint = maintainerChanged(prevObs, currObs);
  const ident = identityDiverged(prevObs, currObs);
  const observedAny = scripts.observed || caps.observed || minif.observed || maint.observed || ident.observed;

  const code = [];
  if (scripts.observed && scripts.added.length) code.push({ class: CLASS.INSTALL_SCRIPT, added: scripts.added, corroboration: corroborate(CLASS.INSTALL_SCRIPT, scripts.added, currObs.source) });
  if (caps.observed && caps.added.length) code.push({ class: CLASS.CAPABILITY, added: caps.added, corroboration: corroborate(CLASS.CAPABILITY, caps.added, currObs.source) });
  if (minif.observed && minif.appeared) code.push({ class: CLASS.MINIFIED, added: ['blob'], corroboration: corroborate(CLASS.MINIFIED, ['blob'], currObs.source) });

  const context = [];
  if (maint.observed && maint.changed) context.push({ class: CLASS.MAINTAINER, added: maint.added, removed: maint.removed });
  if (ident.observed && ident.diverged) context.push({ class: CLASS.IDENTITY, from: ident.from, to: ident.to, resolution: ident.resolution });

  const uncorroborated = code.filter((c) => c.corroboration === 'none');
  const unresolved = code.filter((c) => c.corroboration === 'unresolved');

  // CONVERGENCE: a code-behaviour change the source does not explain. Only this is an anomaly.
  if (uncorroborated.length) {
    const converged = [...uncorroborated.map((c) => c.class), ...context.map((c) => c.class)];
    let score = noisyOR(converged.map((k) => WEIGHT[k] ?? 0.2));
    if (adj.relation === 'republish') score = noisyOR([score, 0.35]);  // same version string, changed bytes
    if (adj.relation === 'window') score *= 0.9;                        // attribution spread across the window
    return {
      ...base, verdict: 'anomaly', score: round4(clamp01(score)), corroboration: 'none',
      convergence: converged.length, code: uncorroborated, context,
      detail: `${uncorroborated.map((c) => `${c.class}[${c.added.join(',')}]`).join(' + ')} in published ${adj.relation === 'republish' ? 're-publish' : 'version'} ${currObs.version}`
        + (adj.relation === 'window' ? ` (entered somewhere in the ${adj.window}-version window ${prevObs.version}..${currObs.version}, not pinned to a single publish)` : '')
        + `, NOT reflected in the declared source${context.length ? `; amplified by ${context.map((c) => c.class).join(', ')}` : ''}`,
    };
  }
  // A code change we could not check against the source is UNKNOWN, never an anomaly and never clean.
  if (unresolved.length) {
    return { ...base, verdict: 'unknown', code: unresolved, context, ...unknown('not-adjudicated', `a code-behaviour change (${unresolved.map((c) => c.class).join(', ')}) whose declared-source view was not resolved — cannot confirm it is source-corroborated`) };
  }
  // Code changed and the source explains all of it → ordinary development.
  if (code.length) return { ...base, verdict: 'explained', code, context };
  // Only publisher/registry context moved, no code delta → watch, not a convergence.
  if (context.length) {
    return { ...base, verdict: 'undetermined', context, detail: `${context.map((c) => c.class).join(', ')} changed with no code-behaviour delta — a context shift to watch, not a convergence` };
  }
  // Nothing observable on both sides is UNKNOWN, not a clean pass (explicit uncertainty).
  if (!observedAny) return { ...base, verdict: 'unknown', ...unknown('not-adjudicated', 'no behaviour-class field was observed on both versions — nothing to compare') };
  return { ...base, verdict: 'clean' };
}

/**
 * Join two snapshots and rank the anomalies. A snapshot is { packages: { name: observation }, order?:
 * { name: [versions in publish order] } }. An observation carries the ARTIFACT-side signals (scripts,
 * capabilities, minified count, maintainers, declaredRepo, registryIdentity) and an OPTIONAL `source`
 * view of the same version for corroboration. Records each anomaly to the nondeterministic store under
 * dimension 'supply-anomaly'; pass { record: false } to compute without writing.
 */
export function versionDelta(prev, curr, { record: doRecord = true } = {}) {
  if (!enabled()) return { ran: false, enabled: false, note: 'CW_VERSION_DELTA=off', pairs: [], anomalies: [], unknowns: [], undetermined: [], recorded: [] };
  const pPk = (prev && prev.packages) || {};
  const cPk = (curr && curr.packages) || {};
  const orderFor = (name) => (curr && curr.order && curr.order[name]) || (prev && prev.order && prev.order[name]) || null;

  const out = { ran: true, enabled: true, compared: 0, pairs: [], anomalies: [], unknowns: [], undetermined: [], recorded: [] };
  let candidatePairs = 0;

  for (const name of Object.keys(cPk).sort()) {
    const c = cPk[name]; if (!c) continue;
    const p = pPk[name];
    if (!p) {
      // FIRST-SEEN: no baseline. Never "changed". Concerning signals make it born-bad → undetermined.
      const born = bornBadSignals(c);
      const u = { package: name, version: c.version, bornBad: born,
        ...unknown('no-reference', born.length
          ? `first observation of ${name}@${c.version}; born-bad signals (${born.join(', ')}) present but there is no prior version to call this a CHANGE`
          : `first observation of ${name}@${c.version} — no baseline to compare against`) };
      out.unknowns.push(u);
      if (born.length) out.undetermined.push({ package: name, version: c.version, verdict: 'undetermined', bornBad: born });
      continue;
    }
    candidatePairs += 1;
    const r = { package: name, ...classifyPair(p, c, { order: orderFor(name) }) };
    out.pairs.push(r);
    if (r.verdict === 'unknown') { out.unknowns.push(r); continue; }
    out.compared += 1;                                    // an adjudicated pair — the honest denominator
    if (r.verdict === 'anomaly') out.anomalies.push(r);
    else if (r.verdict === 'undetermined') out.undetermined.push(r);
  }

  // PREVALENCE GUARD over adjudicated pairs. Flood ⇒ anomaly-biased sample + loud grey; NEVER disable.
  const threshold = prevalenceThreshold();
  const anomalyRate = out.compared ? out.anomalies.length / out.compared : 0;
  const flooded = out.compared > 0 && anomalyRate > threshold;
  const ranked = [...out.anomalies].sort((a, b) => b.score - a.score || a.package.localeCompare(b.package) || a.to.localeCompare(b.to));
  const toRecord = flooded ? ranked.slice(0, sampleCap()) : ranked;

  if (doRecord) {
    for (const a of toRecord) {
      const subject = `${a.package}@${a.to}`;
      const rec = record({ subject, dimension: 'supply-anomaly', score: a.score,
        detail: { from: a.from, to: a.to, relation: a.relation, window: a.window, convergence: a.convergence,
          classes: a.code.map((c) => c.class), context: a.context.map((c) => c.class), note: a.detail } });
      out.recorded.push({ subject, score: a.score, path: rec.path });
    }
  }

  out.coverage = claim({ count: out.anomalies.length, observed: out.compared, population: candidatePairs, unit: 'version-pair', of: 'supply-anomaly' });
  out.prevalence = {
    threshold, anomalyRate: round4(anomalyRate), compared: out.compared, anomalies: out.anomalies.length,
    changed: out.pairs.filter((r) => r.verdict === 'anomaly' || r.verdict === 'explained' || r.verdict === 'undetermined').length,
    flooded, mode: flooded ? 'anomaly-biased-sample' : 'full', disabled: false,
    recorded: doRecord ? toRecord.length : 0, suppressedFromStore: flooded ? Math.max(0, out.anomalies.length - toRecord.length) : 0,
    grey: flooded
      ? `anomaly rate ${(anomalyRate * 100).toFixed(1)}% exceeds ${(threshold * 100).toFixed(1)}% — this is the signature of a NEAR-NEIGHBOUR FLOOD (an attacker publishing look-alikes to trip a kill-switch), NOT a fleet in crisis. Recorded the top ${toRecord.length} by rank from the CHANGED subset; the lane is NOT disabled and every anomaly remains in .anomalies for a reader.`
      : null,
  };
  return out;
}

export default { versionDelta, classifyPair, adjacencyOf, bornBadSignals, BEHAVIOUR_CLASSES, WEIGHT, enabled };
