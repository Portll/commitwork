// admin/lib/palette-index.mjs — the command palette's index: every view, check, project and action
// the panel already has, read from the registries that already define them (the menu markup, the
// manifest map, the project registry) so the palette cannot drift from the rail. Pure except for
// the two readers, which take their paths as arguments.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const KIND_ORDER = Object.freeze(['view', 'check', 'project', 'action', 'link']);

// Views the rail does not list, with the scope navigation.js VIEW_SCOPE declares for them. The
// test cross-checks this table against that declaration, so a drift fails loudly.
const SCOPE_NOT_ON_RAIL = Object.freeze({ oversight: 'fleet', correlations: 'fleet', stpa: 'fleet', bola: 'fleet', comments: 'fleet', spinecomments: 'fleet', profile: 'account' });

// Actions reachable from the palette. `operatorOnly` mirrors the route's own gate; the client renders
// such an action disabled off the operator port with the reason, it never hides it.
export const ACTIONS = Object.freeze([
  { id: 'run-checks', label: 'Run checks', hint: 'start a sweep of the selected project', method: 'POST', path: '/api/sweep', operatorOnly: false, needsProject: true, keywords: ['sweep', 'scan', 'start'] },
  { id: 'stop-run', label: 'Stop the running checks', hint: 'stop the sweep in progress', method: 'POST', path: '/api/sweep/stop', operatorOnly: false, needsProject: false, keywords: ['sweep', 'cancel', 'abort'] },
  { id: 'run-healthcheck', label: 'Run healthcheck', hint: 'build-health refresh for the selected project', method: 'POST', path: '/api/health/all', operatorOnly: false, needsProject: true, keywords: ['health', 'toolchain', 'deadcode'] },
  { id: 'ingest-work-items', label: 'Refresh work items', hint: 'ingest the latest results into the issue tracker', method: 'POST', path: '/api/issues/ingest', operatorOnly: false, needsProject: true, keywords: ['issues', 'ingest', 'tracker'] },
  { id: 'restart-panel', label: 'Restart the panel', hint: 'spawn a successor from the code on disk', method: 'POST', path: '/api/panel/restart', operatorOnly: true, needsProject: false, keywords: ['process', 'reload'] },
]);

export const LINKS = Object.freeze([
  { id: 'configuration', label: 'Configuration', hint: 'edit configuration, scanning lanes and approvals', href: '/config', keywords: ['config', 'settings', 'lanes', 'approvals'] },
]);

// &amp; last: decoding it first turns &amp;lt; into a second, real <.
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? decode(m[1]) : ''; };

function readOrThrow(path) {
  try { return readFileSync(path, 'utf8'); } catch (e) {
    const err = new Error(`palette: cannot read ${path}: ${e.code || e.message}`);
    err.code = e.code; throw err;
  }
}

/** The views: every .vtab in view-menu.html, scoped by the rail block that lists it. */
export function readMenuViews(menusDir) {
  const tabs = readOrThrow(join(menusDir, 'view-menu.html'));
  const rail = readOrThrow(join(menusDir, 'section-rail.html'));
  const railScope = new Map();
  let scope = 'project';
  for (const line of rail.split('\n')) {
    if (/data-scope-head="fleet"/.test(line)) scope = 'fleet';
    else if (/data-scope-head="project"/.test(line)) scope = 'project';
    else if (/class="rail-label rail-manage"/.test(line)) scope = 'manage';
    const m = line.match(/<button[^>]*class="rail-link"[^>]*data-route="([^"]+)"[^>]*>([^<]*)</);
    if (m) railScope.set(m[1], { scope, label: decode(m[2]) });
  }
  const views = [];
  const re = /<button([^>]*class="vtab[^"]*"[^>]*)>([^<]*)/g;
  let m;
  while ((m = re.exec(tabs))) {
    const id = attr(m[1], 'data-v');
    if (!id) continue;
    const onRail = railScope.get(id);
    views.push({
      id, label: decode(m[2]), hint: attr(m[1], 'title'),
      scope: onRail ? onRail.scope : (SCOPE_NOT_ON_RAIL[id] || 'project'),
      railLabel: onRail ? onRail.label : null,
    });
  }
  if (!views.length) throw new Error(`palette: no .vtab entries found in ${join(menusDir, 'view-menu.html')}`);
  // Rail-only routes (rollups, projects, settings …) have no tab button; they are views all the same.
  const seen = new Set(views.map((v) => v.id));
  for (const [id, r] of railScope) if (!seen.has(id)) views.push({ id, label: r.label, hint: '', scope: r.scope, railLabel: r.label });
  return views;
}

/** The checks: every id in the manifest map, with its description and groups. */
export function readChecks(mapPath) {
  let doc;
  try { doc = JSON.parse(readOrThrow(mapPath)); } catch (e) { if (e.code) throw e; throw new Error(`palette: ${mapPath} is not JSON: ${e.message}`); }
  const byId = doc && doc.byId;
  if (!byId || typeof byId !== 'object') throw new Error(`palette: ${mapPath} has no byId`);
  return Object.entries(byId).map(([id, c]) => ({ id, description: String(c.description || ''), groups: Array.isArray(c.groups) ? c.groups : [] }));
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function buildPaletteIndex({ views = [], checks = [], projects = [], actions = ACTIONS, links = LINKS } = {}) {
  const entries = [];
  for (const v of views) entries.push({ kind: 'view', id: v.id, label: v.label, hint: v.hint || '', scope: v.scope, operatorOnly: false, keywords: words(v.railLabel) });
  for (const c of checks) entries.push({ kind: 'check', id: c.id, label: c.id, hint: c.description.split(/[.(]/)[0].trim(), scope: 'project', operatorOnly: false, keywords: [...c.groups, ...words(c.description).slice(0, 12)] });
  for (const p of [...projects].sort()) entries.push({ kind: 'project', id: p, label: p, hint: 'select this project', scope: 'fleet', operatorOnly: false, keywords: [] });
  for (const a of actions) entries.push({ kind: 'action', id: a.id, label: a.label, hint: a.hint, scope: a.needsProject ? 'project' : 'fleet', operatorOnly: !!a.operatorOnly, method: a.method, path: a.path, keywords: a.keywords });
  for (const l of links) entries.push({ kind: 'link', id: l.id, label: l.label, hint: l.hint, scope: 'fleet', operatorOnly: false, href: l.href, keywords: l.keywords });
  return entries;
}

function subsequence(hay, needle) {
  let i = 0;
  for (const ch of hay) { if (ch === needle[i]) i++; if (i === needle.length) return true; }
  return needle.length === 0;
}

function scoreEntry(e, q) {
  const label = e.label.toLowerCase(), id = e.id.toLowerCase();
  if (label === q || id === q) return 100;
  if (label.startsWith(q) || id.startsWith(q)) return 80;
  if (words(label).some((w) => w.startsWith(q))) return 60;
  if (e.keywords.some((k) => k === q)) return 50;
  if (e.keywords.some((k) => k.startsWith(q))) return 40;
  if (label.includes(q) || id.includes(q) || e.hint.toLowerCase().includes(q)) return 35;
  if (q.length >= 3 && subsequence(label.replace(/\s+/g, ''), q)) return 20;
  return 0;
}

const byKindThenLabel = (a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

/** Rank entries for a query. Every term must match; an empty query lists everything in kind order. */
export function searchPalette(entries, query, { limit = 20 } = {}) {
  const terms = words(query);
  if (!terms.length) return entries.slice().sort(byKindThenLabel).slice(0, limit);
  const scored = [];
  for (const e of entries) {
    let total = 0;
    for (const t of terms) { const s = scoreEntry(e, t); if (!s) { total = 0; break; } total += s; }
    if (total) scored.push({ e, total });
  }
  scored.sort((a, b) => (b.total - a.total) || byKindThenLabel(a.e, b.e));
  return scored.slice(0, limit).map(({ e, total }) => ({ ...e, score: total }));
}
