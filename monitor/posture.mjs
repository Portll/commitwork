#!/usr/bin/env node
// posture.mjs — the live security-posture status board: per-approach coverage lights, the
// toolchain inventory, and SLA-breach escalation. Two boards (security vs delivery); grey is never
// green. computePosture() is pure — no I/O, no clock, no spawning.
//
// usage: node monitor/posture.mjs [project]      # the area's posture as JSON on stdout

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registryPath } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

export const WINDOW_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

// ── the light ───────────────────────────────────────────────────────────────────────────────────
// `grey` is not a degraded green — it is the affirmative statement that no result exists.
export const LIGHTS = Object.freeze(['green', 'amber', 'red', 'grey', 'n/a']);

// ── two boards, because they answer different questions ─────────────────────────────────────────
// Split by DECLARED type, never guessed from the check id.
export const SECURITY_TYPES = Object.freeze(['secrets', 'sca', 'sast', 'supply-chain', 'iac', 'dast', 'api-contract', 'posture', 'accessibility']);

// Declared value vocabularies for the non-scanner blocks; anything unrecognised is reported, never
// scored. no-tests/unreadable/env-blocked are amber: not established healthy, not a repo defect.
export const DELIVERY_VERDICT = Object.freeze({
  clean: 'green', green: 'green', ok: 'green', present: 'green',
  RED: 'red', MISSING: 'red',
  advisory: 'amber', 'no-tests': 'amber', unreadable: 'amber', 'env-blocked': 'amber',
  skipped: 'na', 'n/a': 'na',
});

// Traffic light for one approach. The test order is the judgement: no aggregate → grey; ran
// nowhere → grey; crit/high → red; any findings → amber; carried → amber; partial → amber;
// ran+current+clean → green.
export function lightFor(live, { nowMs = 0, windowDays = WINDOW_DAYS, hygiene = false } = {}) {
  if (!live || typeof live !== 'object') {
    return { light: 'grey', why: 'no live counts — the rollup has never spoken for this approach', inWindow: null };
  }
  const ran = Number(live.ran) || 0;
  const skipped = Number(live.skipped) || 0;
  const noscan = Number(live.noscan) || 0;
  const inScope = ran + skipped + noscan;
  // Freshness comes from the category's own lastRunAt, not the history index (which carries no
  // per-category run provenance).
  const t = live.lastRunAt ? Date.parse(live.lastRunAt) : NaN;
  const inWindow = Number.isFinite(t) && nowMs ? (nowMs - t) <= windowDays * DAY_MS : null;

  if (!ran && !live.carried) {
    return { light: 'grey', inWindow,
      why: `in scope on ${inScope} repo(s), produced a scan on none (${skipped} skipped, ${noscan} noscan) — a coverage void, not a clean result` };
  }
  const crit = Number(live.crit) || 0, high = Number(live.high) || 0, total = Number(live.total) || 0;
  if (crit || high) {
    // Hygiene never reaches red — TODO markers glowing like a live exposure trains readers to ignore red.
    if (hygiene) return { light: 'amber', inWindow, why: `${total} marker(s) — hygiene, deliberately excluded from the security headline` };
    return { light: 'red', inWindow, why: `${total} finding(s) including ${crit} critical / ${high} high` };
  }
  if (total) return { light: 'amber', inWindow, why: `${total} finding(s), none critical or high` };
  if (live.carried) {
    return { light: 'amber', inWindow,
      why: `not re-run by the latest sweep — this count is slice ${live.carriedFrom || '?'}'s and is carried until rescanned` };
  }
  if (noscan) {
    return { light: 'amber', inWindow, why: `clean where it ran (${ran} repo(s)), but ${noscan} repo(s) produced no scan at all` };
  }
  if (inWindow === false) {
    return { light: 'amber', inWindow,
      why: `clean on ${ran} repo(s), but its last run was ${live.lastRunAt} — older than the ${windowDays}-day window this board reports` };
  }
  return { light: 'green', inWindow,
    why: `ran on ${ran} of ${inScope} in-scope repo(s) and found nothing${inWindow ? ` (last run ${live.lastRunAt})` : ''}` };
}

// Light for a non-scanner approach, rolled up from per-repo verdicts (no run provenance here).
// `n/a` is a determination; `null` means never evaluated — the two never share a colour.
export function deliveryLightFor(values) {
  const tally = { green: 0, amber: 0, red: 0, na: 0, unknown: 0, unrecognised: [] };
  for (const v of values) {
    if (v === null || v === undefined || v === '') { tally.unknown++; continue; }
    const verdict = DELIVERY_VERDICT[String(v)];
    if (!verdict) { tally.unknown++; tally.unrecognised.push(String(v).slice(0, 40)); continue; }
    tally[verdict]++;
  }
  const evaluated = tally.green + tally.amber + tally.red + tally.na;
  const total = evaluated + tally.unknown;
  if (!total) return { light: 'grey', why: 'no repo in this area records a value for this check', tally };
  if (tally.unrecognised.length) {
    return { light: 'grey', tally,
      why: `unrecognised value(s) ${[...new Set(tally.unrecognised)].join(', ')} — this board will not score a verdict it cannot read` };
  }
  if (tally.red) return { light: 'red', why: `${tally.red} of ${total} repo(s) failing`, tally };
  if (tally.amber) return { light: 'amber', why: `${tally.amber} of ${total} repo(s) advisory`, tally };
  if (!evaluated) return { light: 'grey', why: `in scope on ${total} repo(s), evaluated on none`, tally };
  if (tally.green === 0 && tally.na === evaluated) {
    return { light: 'n/a', tally,
      why: `evaluated on ${evaluated} repo(s) and found not to apply to any — a determination, not a gap` };
  }
  if (tally.unknown) {
    return { light: 'amber', tally,
      why: `passing on ${tally.green} repo(s)${tally.na ? `, n/a on ${tally.na}` : ''}, but ${tally.unknown} never evaluated` };
  }
  return { light: 'green', why: `passing on ${tally.green} of ${evaluated} evaluated repo(s)${tally.na ? ` (${tally.na} n/a)` : ''}`, tally };
}

// Light for a count-sourced approach: a backlog is not a defect, so never red — amber with the
// number, green at zero, and never scored through the verdict vocabulary.
export function deliveryCountFor(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const unknown = values.length - nums.length;
  const total = nums.reduce((a, b) => a + b, 0);
  const tally = { green: 0, amber: 0, red: 0, na: 0, unknown, unrecognised: [], total };
  if (!nums.length) return { light: 'grey', why: `no repo in this area records a count${unknown ? ` (${unknown} unevaluated)` : ''}`, tally };
  if (!total) return { light: 'green', why: `nothing pending across ${nums.length} repo(s)`, tally };
  return { light: 'amber', tally,
    why: `${total} pending across ${nums.length} repo(s)${unknown ? `, ${unknown} never evaluated` : ''} — a backlog, not a defect` };
}

/** Slices whose `generated` falls inside the window, newest first. Unparseable rows are dropped. */
export function slicesInWindow(indexRows, nowMs, windowDays = WINDOW_DAYS) {
  const floor = nowMs - windowDays * DAY_MS;
  return (Array.isArray(indexRows) ? indexRows : [])
    .map((r) => ({ ...r, _t: Date.parse(r && r.generated) }))
    .filter((r) => Number.isFinite(r._t) && r._t >= floor)
    .sort((a, b) => b._t - a._t);
}

/**
 * The whole board.
 *
 * @param {object} input
 *   taxonomy      — monitor/approach-taxonomy.json, parsed
 *   manifests     — [{ name, checks: [{id, description, groups, requires, report, aliasOf}] }]
 *   scannerChecks — SCANNER_CHECKS (category -> producing check id)
 *   aliases       — CHECK_ALIASES (declared duplicate id -> canonical id)
 *   rollup        — the area's rollup.json, parsed (or null)
 *   historyIndex  — the area's history/index.json rows (or [])
 *   lifecycle     — the area's lifecycle.json, parsed (or null)
 *   toolchain     — [{ tool, kind, installed, version, usedBy: [checkId], install }]
 *   nowMs         — the clock, injected
 */
export function computePosture(input) {
  const { taxonomy = {}, manifests = [], scannerChecks = {}, aliases = {},
    rollup = null, historyIndex = [], lifecycle = null, toolchain = [], nowMs = 0 } = input;

  const catByCheck = new Map(Object.entries(scannerChecks).map(([cat, id]) => [id, cat]));
  const canonical = (id) => (Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : id);
  const scanners = (rollup && rollup.scanners) || {};
  // the per-repo rows the non-scanner approaches read their verdicts from (buildHealth /
  // qualityGates / depsUpdates live here, not in `scanners`)
  const repoRows = (rollup && Array.isArray(rollup.repos)) ? rollup.repos : [];
  const window = slicesInWindow(historyIndex, nowMs);

  // Any bundled manifest's check is declared surface, even if this area never selects it.
  const declared = new Map();
  for (const m of manifests) {
    for (const c of (m.checks || [])) {
      if (declared.has(c.id)) continue;
      declared.set(c.id, { check: c.id, manifest: m.name, description: c.description || '',
        groups: c.groups || [], report: (c.report && c.report.file) || null,
        requires: c.requires || null, aliasOf: c.aliasOf || null });
    }
  }

  const byApproach = new Map((taxonomy.approaches || []).map((a) => [a.check, a]));

  const approaches = [...declared.values()].map((d) => {
    const canonicalId = d.aliasOf || canonical(d.check);
    const category = catByCheck.get(canonicalId) || null;
    const live = (category && scanners[category]) || null;
    const t = byApproach.get(canonicalId) || byApproach.get(d.check) || null;
    // Non-scanner approaches read the declared rollup block; a scanner category always wins.
    const src = (!live && t && t.source) || null;
    const srcValues = src
      ? repoRows.map((r) => (r && r[src.block] ? r[src.block][src.key] : null))
      : null;
    const { light, why, inWindow } = srcValues
      ? { ...(src.kind === 'count' ? deliveryCountFor(srcValues) : deliveryLightFor(srcValues)), inWindow: null }
      : lightFor(live, { nowMs, hygiene: !!t && t.type === 'hygiene' });
    return {
      check: d.check,
      aliasOf: canonicalId === d.check ? null : canonicalId,
      manifest: d.manifest,
      category,
      // Declared, never inferred from the id — a missing taxonomy entry yields null, not a guess.
      name: (t && t.name) || d.check,
      type: (t && t.type) || null,
      typeLabel: (t && t.type && (taxonomy.types || {})[t.type]) || null,
      sourceKind: (t && t.sourceKind) || null,
      sourceKindLabel: (t && t.sourceKind && (taxonomy.sourceKinds || {})[t.sourceKind]) || null,
      findsSourceVulns: t ? !!t.findsSourceVulns : null,
      escalates: (t && t.escalates) || null,
      note: (t && t.note) || null,
      // Lane E — DECLARED weakness-classes + oracle strength, never inferred. [] is a real answer
      // (this lane looks for no weakness class), distinct from null (no taxonomy entry at all).
      weaknessClasses: (t && Array.isArray(t.weaknessClasses)) ? t.weaknessClasses : (t ? [] : null),
      oracleTier: (t && t.oracleTier) || null,
      description: d.description,
      report: d.report,
      runtime: !!(d.requires && d.requires.services) || /^(dast|api)/.test((t && t.type) || ''),
      light,
      why,
      // null = no aggregate at all, distinct from "ran, but outside the window".
      inWindow,
      lastRunAt: (live && live.lastRunAt) || null,
      live,
    };
  }).sort((a, b) => {
    // Worst first; `n/a` sorts last — a settled determination with nothing to act on.
    const rank = { red: 0, grey: 1, amber: 2, green: 3, 'n/a': 4 };
    return (rank[a.light] - rank[b.light]) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)
      || (a.check < b.check ? -1 : a.check > b.check ? 1 : 0);
  });

  // ── the split ─────────────────────────────────────────────────────────────────────────────────
  const isSecurity = (a) => SECURITY_TYPES.includes(a.type);
  const security = approaches.filter(isSecurity);
  const delivery = approaches.filter((a) => !isSecurity(a));

  const count = (rows) => {
    const t = { green: 0, amber: 0, red: 0, grey: 0, 'n/a': 0 };
    for (const a of rows) t[a.light] = (t[a.light] || 0) + 1;
    return t;
  };
  const tally = count(security);

  // ── escalation ────────────────────────────────────────────────────────────────────────────────
  // Reported as rows, not just a count — the named finding is the actionable artifact.
  const records = (lifecycle && Array.isArray(lifecycle.records)) ? lifecycle.records : [];
  const breaches = records
    .filter((r) => r && r.escalation && r.escalation.slaBreached)
    .map((r) => ({
      id: r.id || r.key || null,
      repo: r.repo || null,
      severity: r.severity || null,
      package: r.package || null,
      title: typeof r.title === 'string' ? r.title.slice(0, 160) : null,
      slaTier: r.escalation.slaTier ?? null,
      slaTierBasis: r.escalation.slaTierBasis ?? null,
      exposureDays: (r.dwell && r.dwell.knowableExposureDays) ?? null,
      overdueDays: (r.dwell && Number.isFinite(r.dwell.knowableExposureDays) && Number.isFinite(r.escalation.slaTier))
        ? r.dwell.knowableExposureDays - r.escalation.slaTier : null,
      residualVerdict: r.residualVerdict || null,
    }))
    .sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1));

  const escalation = {
    // present:false is "lifecycle.json absent/unreadable", never "no breaches".
    present: !!lifecycle,
    breached: breaches.length,
    slaBreachCount: (lifecycle && lifecycle.aggregates && lifecycle.aggregates.slaBreachCount) ?? null,
    rows: breaches.slice(0, 200),
    truncated: Math.max(0, breaches.length - 200),
  };

  const missingTools = toolchain.filter((t) => !t.installed);
  return {
    ok: true,
    generated: rollup ? (rollup.generated || null) : null,
    windowDays: WINDOW_DAYS,
    window: {
      slices: window.length,
      // An empty window is its own finding: no sweep landed in seven days, so every light below is
      // describing a result older than the window it is presented in.
      newest: window.length ? window[0].generated : null,
      oldest: window.length ? window[window.length - 1].generated : null,
    },
    tally,
    // `approaches` is the SECURITY board — the name every existing consumer means by it.
    approaches: security,
    delivery: { tally: count(delivery), approaches: delivery },
    toolchain: {
      total: toolchain.length,
      installed: toolchain.length - missingTools.length,
      missing: missingTools.map((t) => t.tool),
      tools: toolchain,
    },
    escalation,
    // HOW MUCH OF THIS BOARD IS NOT A RESULT. monitor/rollup.mjs publishes the tally; posture is
    // where a reader is already asking "what state is this fleet in", so the number belongs beside
    // the lights rather than only in a JSON file somebody has to open.
    //
    // A ROLLUP THAT PREDATES THE TALLY IS NOT A CLEAN ONE. Reading a missing field as zero would
    // publish "nothing is unknown" on every slice rolled before the field existed — grey rendered
    // as green, in the feature whose entire subject is grey. Nulls plus a stated reason, so the
    // difference between "measured none" and "never measured" survives into the panel.
    unknown: (rollup && rollup.unknownFleet)
      ? { blocks: rollup.unknownFleet.blocks ?? null, total: rollup.unknownFleet.total ?? null,
          rate: rollup.unknownFleet.rate ?? null, byReason: rollup.unknownFleet.byReason || {}, measured: true }
      : { blocks: null, total: null, rate: null, byReason: {}, measured: false,
          why: rollup ? 'this rollup predates the fleet unknown tally — re-roll to measure it'
                      : 'no rollup — nothing has been measured for this area' },
  };
}

// ── the toolchain lane ──────────────────────────────────────────────────────────────────────────
// Every executable the manifests declare via requires.tools, plus Docker images recovered from the
// command text (there is no requires.images field).
const IMAGE_RE = /docker\s+run\s+(?:--[^\s]+\s+|-[a-zA-Z]\s+\S+\s+)*((?:ghcr\.io|docker\.io|quay\.io|[a-z0-9.-]+\/)[a-z0-9._/-]+(?::[a-zA-Z0-9._-]+)?)/g;

// Manifest names an area's registry entries declare, as a Set. `project` may be a project name or
// an area slug; an unresolvable project returns the whole-registry union, never an empty set.
export function manifestNamesForArea(project, reg = null) {
  const registry = reg || (() => { try { return JSON.parse(readFileSync(registryPath(), 'utf8')); } catch { return { projects: [] }; } })();
  const entries = registry.projects || [];
  const names = new Set();
  const want = project ? String(project) : null;
  const add = (p) => { const m = p.manifest; if (!m) return; (Array.isArray(m) ? m : [m]).forEach((x) => names.add(x)); };
  if (!want) { entries.forEach(add); return names; }
  const areas = registry.areas || [];
  const areaFor = (name) => {
    const a = areas.find((x) => x && (x.slug === name || x.out === name || x.name === name));
    return a ? a.slug : null;
  };
  const targetArea = areaFor(want);
  let matched = false;
  for (const p of entries) {
    const pArea = p.area || areaFor(p.name);
    if (p.name === want || (targetArea && pArea === targetArea)) { add(p); matched = true; }
  }
  if (!matched) entries.forEach(add);
  return names;
}

export function toolInventory(manifests) {
  const tools = new Map();
  const add = (name, kind, checkId) => {
    if (!tools.has(name)) tools.set(name, { tool: name, kind, usedBy: [] });
    const e = tools.get(name);
    if (!e.usedBy.includes(checkId)) e.usedBy.push(checkId);
  };
  for (const m of manifests) {
    for (const c of (m.checks || [])) {
      for (const t of ((c.requires || {}).tools || [])) add(t, 'binary', c.id);
      for (const cmd of (c.local || [])) {
        IMAGE_RE.lastIndex = 0;
        let hit;
        while ((hit = IMAGE_RE.exec(String(cmd)))) add(hit[1], 'image', c.id);
      }
    }
  }
  return [...tools.values()].sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
}

export default computePosture;

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const { spawnSync } = await import('node:child_process');
  const { resolvePinnedTool, INSTALL_COMMAND } = await import('../lib/cobolwork-resolve.mjs');
  const { probeToolVersion } = await import('./tool-version.mjs');
  const { SCANNER_CHECKS, CHECK_ALIASES } = await import('./scanner-checks.mjs');
  const { outDirFor } = await import('./area.mjs');
  const { areaSlugOf } = await import('./project-scope.mjs');

  const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const project = process.argv[2] || null;

  // Only the manifests THIS area declares — other projects' checks would sit as permanent greys.
  const manifestsFor = manifestNamesForArea(project);
  const MANIFEST_DIR = join(CW, 'manifests');
  const manifests = readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).sort()
    .map((f) => ({ name: f.replace(/\.json$/, ''), j: readJSON(join(MANIFEST_DIR, f)) }))
    .filter((m) => m.j && manifestsFor.has(m.name))
    .map((m) => ({ name: m.name, checks: m.j.checks || [] }));

  // outDirFor takes an AREA SLUG, not a project name — resolve through areaSlugOf first.
  const out = outDirFor(project ? areaSlugOf(project) : null);
  const rollup = readJSON(join(out, 'rollup.json'));
  const lifecycle = readJSON(join(out, 'lifecycle.json'));
  const histIdx = readJSON(join(out, 'history', 'index.json'));
  const historyIndex = Array.isArray(histIdx) ? histIdx : (histIdx && histIdx.rows) || [];

  // probe each tool once; the version string is best-effort and its absence is never an error
  const inv = toolInventory(manifests).map((t) => {
    if (t.kind === 'image') {
      const r = spawnSync('docker', ['image', 'inspect', t.tool], { stdio: 'ignore', timeout: 20_000 });
      return { ...t, installed: r.status === 0, version: null, install: `docker pull ${t.tool}` };
    }
    // A pinned tool is where the lanes run it (lib/cobolwork-resolve.mjs), never PATH.
    const pinned = resolvePinnedTool(t.tool);
    if (pinned) {
      const v = pinned.ok ? probeToolVersion(t.tool) : null;
      return { ...t, installed: pinned.ok, version: v && v.version ? v.version : null, install: pinned.ok ? null : INSTALL_COMMAND };
    }
    const found = spawnSync('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', t.tool], { stdio: 'ignore' }).status === 0;
    let version = null;
    if (found) {
      for (const flag of ['--version', '-version', 'version', '-v']) {
        const r = spawnSync(t.tool, [flag], { encoding: 'utf8', timeout: 15_000 });
        const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
        if (r.status === 0 && text) { version = text.split('\n')[0].slice(0, 80); break; }
      }
    }
    return { ...t, installed: found, version, install: null };
  });

  const nowMs = process.env.CW_NOW ? Date.parse(process.env.CW_NOW) : Date.now();
  const posture = computePosture({
    taxonomy: readJSON(join(HERE, 'approach-taxonomy.json')) || {},
    manifests, scannerChecks: SCANNER_CHECKS, aliases: CHECK_ALIASES,
    rollup, historyIndex, lifecycle, toolchain: inv, nowMs,
  });
  process.stdout.write(`${JSON.stringify(posture, null, 1)}\n`);
}
