// admin/routes/settings.mjs — the Settings view: global sweep knobs, their per-area/per-repo
// override tables, and the report of which sweeps currently exceed them.
//
// WHY THESE THREE THINGS SIT ON ONE ROUTE. They are one question asked three ways: what is the
// threshold, what overrides it here, and what is over it right now. Split across three routes the
// panel would poll them separately and could render a table of exceedances against a threshold it
// had not refetched — a number beside a rule that no longer produced it. One payload cannot
// disagree with itself.
//
// WHAT THIS ROUTE DOES NOT DO: it never kills a sweep. `kill-eligible` is a DECLARATION computed by
// monitor/sweep-health.mjs, and acting on it stays a human act — the same split the deploy tooling
// keeps between describing a tunnel and applying one. There is deliberately no parameter here that
// could be mistaken for an instruction to terminate anything.

import { join } from 'node:path';
import {
  SETTING_KEYS, RULE_TABLES, getAllSettings, setSettings, getAllRules, setRules,
} from '../../monitor/settings.mjs';
import { systemSnapshot } from '../../monitor/perf-tuning.mjs';
import { parseRules, resolveFor, rowsToRules, SWEEP_RULE_COLUMNS } from '../../monitor/sweep-rules.mjs';
import { sweepHealth, STATES } from '../../monitor/sweep-health.mjs';
import { sessionWho } from '../../monitor/attribution.mjs';
import { listSources, setSourceKey, removeSourceKey, isKnownSource, getSourceKey } from '../integrations.mjs';
import { fetchKevCatalog, saveCatalogCache, loadCatalogCache } from '../../monitor/vulncheck-enrich.mjs';
import { CW, registry, resolvedRepos } from '../lib/core.mjs';

// Loopback is the operator port and is ungated by the panel's own gate; everything else needs a
// session. Mirrors admin/routes/projects-view.mjs so the two cannot drift on who may read this.
function gate(ctx) {
  if (ctx.isLoopbackReq) return { ok: true, who: 'operator@loopback' };
  const s = ctx.adminSession ? ctx.adminSession(ctx.req) : null;
  if (!s || !s.user) return { ok: false };
  return { ok: true, who: sessionWho(s), session: s };
}

// KEYED ON THE SLUG, NOT THE REPORT DIR. sweepHealth calls `resolveFor(marker.area)`, and a marker's
// `area` is the AREA SLUG while the directory it sits in is `out`. For client-a those differ — slug
// `client-a`, out `client-a-monorepo` — and both are load-bearing, so a map keyed on `out` misses the
// largest area on the box and silently hands it the global threshold instead of its override. This
// is the repo's documented slug != out trap; key on the value the caller actually passes.
function areaBySlug(reg) {
  const bySlug = new Map();
  for (const a of (reg.areas || [])) bySlug.set(a.slug, a);
  return bySlug;
}

/**
 * Build the (area) => {hangMs, killMs} resolver the health report uses, from the rule tables.
 * The DIRECTORY a rule matches on is the repo's parent folder as the fleet resolver reports it, so
 * a rule can name `Portll` and mean "everything checked out under Portll" without listing repos.
 */
function overrideResolver({ ruleRows, globals, reposByArea }) {
  const parsed = {};
  for (const table of Object.keys(RULE_TABLES)) parsed[table] = parseRules(ruleRows[table] || []).rules;
  return (slug, areaMeta) => {
    const name = (areaMeta && areaMeta.slug) || slug;
    // An area is a set of repos; a rule may name the area OR any repo in it. Directory comes from
    // the repo when a repo matched, and is `*`-matchable either way.
    const targets = [{ directory: '*', name }, ...(reposByArea.get(slug) || [])];
    const pick = (table, fallback) => {
      for (const t of targets) {
        const r = resolveFor(t, { rules: parsed[table], fallback: undefined });
        if (r.source !== 'fallback') return { value: r.value, source: r.source, matchedBy: r.matchedBy, ruleIndex: r.ruleIndex, target: t };
      }
      return { value: fallback, source: 'global', matchedBy: null, ruleIndex: null, target: null };
    };
    const hang = pick('hang', globals.sweepHangMs);
    const kill = pick('kill', globals.sweepKillMs);
    // RETURN NOTHING WHEN NO RULE MATCHED, rather than the global with a different name on it.
    // sweepHealth labels any finite value it gets back as source 'area', so echoing the global here
    // made every row claim a per-area override it did not have — the panel would have named a rule
    // as the reason for a threshold that came from the fleet default. An absent key is how this
    // resolver says "nothing of mine applies", and it is the only answer that stays true.
    const out = {};
    if (hang.source !== 'global' && typeof hang.value === 'number') out.hangMs = hang.value;
    if (kill.source !== 'global' && typeof kill.value === 'number') out.killMs = kill.value;
    out.hangRule = hang.ruleIndex;
    out.killRule = kill.ruleIndex;
    return out;
  };
}

/** Every repo the fleet resolver returns, grouped by AREA SLUG, as rule targets. */
function repoTargets(reg) {
  const byArea = new Map();
  let repos = [];
  try { repos = resolvedRepos() || []; } catch { repos = []; }
  for (const r of repos) {
    const out = r.area || null;   // the slug — matching what sweepHealth passes to resolveFor
    if (!out) continue;
    // The parent folder as it sits on disk — `Portll`, `External/Portll`, … — so a DIRECTORY rule
    // means what an operator reading the path would expect.
    const parts = String(r.path || '').split('/');
    const directory = parts.length >= 2 ? parts[parts.length - 2] : '*';
    if (!byArea.has(out)) byArea.set(out, []);
    byArea.get(out).push({ directory, name: r.name });
  }
  return byArea;
}

export function settingsState({ nowMs = Date.now() } = {}) {
  const all = getAllSettings();
  const rules = getAllRules();
  const ruleRows = {};
  const ruleErrors = {};
  for (const t of Object.keys(RULE_TABLES)) {
    ruleRows[t] = rules[t].rows;
    ruleErrors[t] = rules[t].error;
  }
  const globals = {
    sweepHangMs: all.settings.sweepHangMs.value,
    sweepKillMs: all.settings.sweepKillMs.value,
    sweepCadenceMs: all.settings.sweepCadenceMs.value,
  };

  const reg = registry();
  const metaBySlug = areaBySlug(reg);
  const reposByArea = repoTargets(reg);
  const resolve = overrideResolver({ ruleRows, globals, reposByArea });

  const reportsRoot = join(CW, reg.reportsRoot || 'reports');
  let health;
  try {
    health = sweepHealth({
      reportsRoot, nowMs,
      hangMs: globals.sweepHangMs, killMs: globals.sweepKillMs,
      // the SLUG, not the report dir — see areaBySlug above
      resolveFor: (slug) => resolve(slug, metaBySlug.get(slug)),
    });
  } catch (e) {
    // A failed read is UNKNOWN exposure to a hang, never "nothing is overrunning".
    health = { ok: false, rows: [], unreadable: [], counts: {}, error: `sweep health could not be computed (${e.message})` };
  }

  return {
    ok: true,
    // unit, nullable and options are LOAD-BEARING for the page, not decoration: setKind() derives
    // each control's shape from spec.unit/spec.options. Serialising only the labels left every kind
    // check false and every key rendering as a bare text box — the ms sliders, the level sliders
    // and the reportFormats checkboxes were all dead against this payload.
    keys: Object.fromEntries(Object.entries(SETTING_KEYS).map(([k, v]) => [k, {
      label: v.label, description: v.description || null, envVar: v.envVar, default: v.default,
      unit: v.unit || null, nullable: !!v.nullable, options: Array.isArray(v.options) ? v.options : null,
    }])),
    settings: all.settings,
    system: systemSnapshot(),
    storeError: all.storeError,
    tables: RULE_TABLES,
    columns: SWEEP_RULE_COLUMNS,
    rules: ruleRows,
    ruleErrors,
    health,
    states: STATES,
    // The declared cadence per area, so the frequency table can show what is in force today without
    // the panel re-deriving it from the registry (a second derivation is a second answer).
    areas: (reg.areas || []).map((a) => ({
      slug: a.slug, out: a.out || a.slug, label: a.label || a.slug,
      cadenceMs: typeof a.cadenceMs === 'number' ? a.cadenceMs : null,
      cadenceSource: typeof a.cadenceMs === 'number' ? 'registry' : 'global-default',
    })),
  };
}

export const routes = [
  { method: 'GET', path: '/api/settings', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, settingsState()); }
    catch (e) { return ctx.send(500, { ok: false, error: `settings could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/settings', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const patch = body && typeof body === 'object' ? body.settings : null;
      if (!patch) return ctx.send(400, { ok: false, error: 'body must be {settings: {key: value}}' });
      const r = setSettings(patch, { who: g.who });
      return ctx.send(r.ok ? 200 : (r.code || 400), r.ok ? { ...r, state: settingsState() } : r);
    });
  } },

  { method: 'POST', path: '/api/settings/rules', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const table = body && body.table;
      const rows = body && body.rows;
      if (!table || !Array.isArray(rows)) return ctx.send(400, { ok: false, error: 'body must be {table, rows: []}' });
      // Grammar first, persistence second: rowsToRules/parseRules own the row shape, and a row that
      // cannot be parsed must be refused with its index rather than stored and silently ignored at
      // match time — an unparseable rule that persists reads exactly like a rule that does not match.
      const parsed = parseRules(rowsToRules(rows));
      if (!parsed.ok) {
        return ctx.send(400, { ok: false, error: 'one or more rules are invalid', errors: parsed.errors });
      }
      const r = setRules(table, rows, { who: g.who });
      return ctx.send(r.ok ? 200 : (r.code || 400), r.ok ? { ...r, state: settingsState() } : r);
    });
  } },

  { method: 'GET', path: '/api/integrations', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    try { return ctx.send(200, { ok: true, sources: listSources(), kevCache: kevCacheStatus() }); }
    catch (e) { return ctx.send(500, { ok: false, error: `integrations could not be read: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/integrations', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const name = body && body.name;
      const key = body && body.key;
      if (!isKnownSource(name)) return ctx.send(400, { ok: false, error: `unknown source '${name}'` });
      try {
        const r = setSourceKey(name, key);
        return ctx.send(200, { ok: true, ...r, sources: listSources() });
      } catch (e) { return ctx.send(400, { ok: false, error: e.message }); }
    });
  } },

  // Fetches VulnCheck's KEV catalogue with the stored key (or CW_VULNCHECK_KEY) into the cache the
  // rollup reads. The panel is the only place a stored key is used: monitor/ never imports admin/.
  { method: 'POST', path: '/api/integrations/vulncheck/refresh', handle: async (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    if (listSources().find((s) => s.name === 'vulncheck')?.source === 'unknown') {
      return ctx.send(503, { ok: false, error: 'the integrations store is unreadable, so whether a VulnCheck key is set is unknown' });
    }
    try {
      const r = await fetchKevCatalog({ apiKey: getSourceKey('vulncheck') });
      if (r.state === 'no-key') return ctx.send(400, { ok: false, state: r.state, error: 'no VulnCheck key: save one above, or set CW_VULNCHECK_KEY' });
      if (r.state !== 'ok') return ctx.send(502, { ok: false, state: r.state, error: `VulnCheck did not return the catalogue: ${r.detail}` });
      const saved = saveCatalogCache(r);
      return ctx.send(200, { ok: true, state: 'ok', entries: saved.count, kevCache: kevCacheStatus() });
    } catch (e) { return ctx.send(500, { ok: false, error: `refresh failed: ${e.message}` }); }
  } },

  { method: 'POST', path: '/api/integrations/remove', handle: (ctx) => {
    const g = gate(ctx);
    if (!g.ok) return ctx.send(401, { ok: false, error: 'authentication required' });
    return ctx.readJsonBody(ctx.req, (body, err) => {
      if (err) return ctx.send(400, { ok: false, error: err });
      const name = body && body.name;
      if (!isKnownSource(name)) return ctx.send(400, { ok: false, error: `unknown source '${name}'` });
      const r = removeSourceKey(name);
      return ctx.send(200, { ok: true, ...r, sources: listSources() });
    });
  } },
];

// The cache the rollup reads: null when it has never been fetched, and an unreadable one is reported
// as unreadable rather than as absent.
function kevCacheStatus() {
  try {
    const c = loadCatalogCache();
    return c ? { fetchedAt: c.fetchedAt, entries: c.entries.length } : null;
  } catch (e) { return { error: e.message }; }
}

export default routes;
