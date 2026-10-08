// lib/launchlist.mjs — the launch checklist: generic spec (manifests/launchlist.json), private
// per-project config, ticks and audit-derived items (sidecar store), and the evaluation that joins
// measured results to human ticks.
//
// Store layout under launchlistDir(): config.json, state.json, results/<project>.json. The store
// holds private-repo findings, so it defaults into the sidecar through monitor/private.
//
// An item is DONE when its check passed, or when a person ticked it. A tick on a measured item is an
// acceptance bound to the evidence digest it was made against; it lapses when the evidence changes.
// UNMEASURED is never done.

import { nowISO } from './clock.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateAgainstSchema } from './json-schema.mjs';
import { acquireLockOrReason, describeAge, writeAtomic } from '../monitor/lockfile.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const STATUS = Object.freeze({ PASS: 'pass', FAIL: 'fail', WARN: 'warn', UNMEASURED: 'unmeasured' });
export const TICK_STATES = Object.freeze(['done', 'na', 'open']);
export const SEVERITY_ORDER = Object.freeze({ HARD: 0, SHOULD: 1, LATER: 2 });

export const specPath = () => process.env.CW_LAUNCHLIST_SPEC || join(REPO, 'manifests', 'launchlist.json');
export const schemaPath = () => join(REPO, 'schema', 'launchlist.schema.json');
export const launchlistDir = () => process.env.CW_LAUNCHLIST_DIR || join(REPO, 'monitor', 'private', 'launchlist');
export const configPath = () => join(launchlistDir(), 'config.json');
export const statePath = () => join(launchlistDir(), 'state.json');
export const resultsPath = (project) => join(launchlistDir(), 'results', `${safeSlug(project)}.json`);
export { nowISO };

export function safeSlug(s) {
  const v = String(s || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(v) || v.includes('..')) throw new Error(`launchlist: not a project slug: ${JSON.stringify(v)}`);
  return v;
}

// Only ENOENT is absence; anything else (EACCES, a parse failure) throws.
function readJsonOrNull(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`launchlist: cannot read ${path}: ${e.message}`);
  }
  try { return JSON.parse(raw); } catch (e) { throw new Error(`launchlist: ${path} is not valid JSON: ${e.message}`); }
}

export function loadSpec(path = specPath()) {
  const spec = readJsonOrNull(path);
  if (!spec) throw new Error(`launchlist: spec missing at ${path}`);
  const { errors } = validateAgainstSchema(spec, { path: schemaPath() });
  if (errors.length) throw new Error(`launchlist: spec rejected by ${schemaPath()}: ${errors[0]}`);
  const seen = new Set();
  for (const it of spec.items) {
    if (seen.has(it.id)) throw new Error(`launchlist: duplicate item id ${it.id}`);
    seen.add(it.id);
    if (!spec.sections[it.section]) throw new Error(`launchlist: ${it.id} names unknown section ${it.section}`);
    for (const p of profilesOf(it)) {
      if (!spec.profiles[p]) throw new Error(`launchlist: ${it.id} names unknown profile ${p}`);
      if (!spec.profiles[p].sections.includes(it.section)) throw new Error(`launchlist: ${it.id} section ${it.section} is not in profile ${p}`);
    }
  }
  return spec;
}

export const profilesOf = (item) => (Array.isArray(item.profile) ? item.profile : [item.profile]);

export function loadConfig() {
  const c = readJsonOrNull(configPath());
  if (!c) return { projects: {}, defaults: { profiles: ['publication'] }, absent: true };
  if (typeof c !== 'object' || Array.isArray(c) || (c.projects && typeof c.projects !== 'object')) {
    throw new Error(`launchlist: ${configPath()} must be an object with a projects map`);
  }
  return { projects: c.projects || {}, defaults: c.defaults || { profiles: ['publication'] }, accounts: c.accounts || {} };
}

export function emptyState() { return { version: 1, ticks: {}, items: {}, log: [] }; }

export function loadState() {
  const s = readJsonOrNull(statePath());
  if (!s) return emptyState();
  if (!s.ticks || !s.items || !Array.isArray(s.log)) throw new Error(`launchlist: ${statePath()} is missing ticks/items/log`);
  return s;
}

export function loadResults(project) { return readJsonOrNull(resultsPath(project)); }

export function saveResults(project, doc) {
  const p = resultsPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeAtomic(p, `${JSON.stringify(doc, null, 2)}\n`);
}

/** Run `fn(state)` under the store lock; persists when fn returns {ok:true}. */
export function withState(fn, { label = 'launchlist' } = {}) {
  mkdirSync(launchlistDir(), { recursive: true });
  const got = acquireLockOrReason(join(launchlistDir(), '.state.lock'), { attempts: 150, spinMs: 20, staleMs: 30_000, label });
  if (!got.ok) {
    if (got.reason === 'busy') return { ok: false, refused: 'busy', error: `launchlist store is locked by another writer (${describeAge(got.heldFor)})` };
    return { ok: false, refused: 'unavailable', error: `launchlist store unavailable: ${got.message}` };
  }
  try {
    const state = loadState();
    const out = fn(state);
    if (out && out.ok) writeAtomic(statePath(), `${JSON.stringify(state, null, 2)}\n`);
    return out;
  } finally { got.lock.release(); }
}

// Checks a run performs only when its flag asks for them. A run that did not ask carries the last
// measured result forward rather than writing unmeasured over it: an acceptance binds to the
// evidence digest, so the overwrite voided acceptances nobody had re-examined. Measured 2026-10-04,
// a flagless run 67 s after a --history acceptance reopened pub.secrets.history.
export const OPT_IN_CHECKS = Object.freeze({ secretsHistory: 'history', publicTest: 'tests' });

/** `results` with every opt-in check this run did not ask for replaced by its last measured result. */
export function carryForward(results, previous, { items, flags }) {
  const prior = (previous && previous.results) || {};
  const out = { ...results };
  for (const it of items) {
    const flag = OPT_IN_CHECKS[it.check];
    if (!flag || flags[flag]) continue;
    const last = prior[it.id];
    if (!last || last.status === STATUS.UNMEASURED) continue;
    out[it.id] = { ...last, carriedFrom: last.carriedFrom || previous.measuredAt || null };
  }
  return out;
}

export function digestEvidence(result) {
  if (!result) return null;
  const basis = JSON.stringify({ status: result.status, summary: result.summary, evidence: result.evidence || [] });
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

export function projectProfiles(project, config) {
  const p = (config.projects || {})[project];
  return (p && Array.isArray(p.profiles) && p.profiles.length) ? p.profiles : ((config.defaults && config.defaults.profiles) || ['publication']);
}

/** Spec items for these profiles plus the project's own items, in spec order then insertion order. */
export function itemsFor(project, { spec, config, state }) {
  const profiles = new Set(projectProfiles(project, config));
  const base = spec.items.filter((it) => profilesOf(it).some((p) => profiles.has(p)));
  const own = ((state.items || {})[project] || []).map((it) => ({ ...it, custom: true }));
  return [...base, ...own];
}

function customItemErrors(item, spec) {
  const errs = [];
  if (!/^[a-z0-9][a-z0-9.-]{1,80}$/.test(String(item.id || ''))) errs.push('id must be lowercase [a-z0-9.-], 2-81 chars');
  if (!spec.sections[item.section]) errs.push(`section must be one of ${Object.keys(spec.sections).join(', ')}`);
  if (!spec.severities.includes(item.severity)) errs.push(`severity must be one of ${spec.severities.join(', ')}`);
  if (!spec.owners.includes(item.owner)) errs.push(`owner must be one of ${spec.owners.join(', ')}`);
  if (!spec.sizes.includes(item.size)) errs.push(`size must be one of ${spec.sizes.join(', ')}`);
  if (!item.title || String(item.title).length > 200) errs.push('title is required, at most 200 chars');
  return errs;
}

export function addItem(state, project, item, { spec, by, at = nowISO() }) {
  safeSlug(project);
  const errs = customItemErrors(item, spec);
  if (errs.length) return { ok: false, refused: 'invalid', errors: errs };
  if (spec.items.some((s) => s.id === item.id)) return { ok: false, refused: 'invalid', errors: [`${item.id} is a spec item id`] };
  const list = (state.items[project] ||= []);
  const clean = {
    id: item.id, profile: item.profile || 'publication', section: item.section, severity: item.severity,
    owner: item.owner, size: item.size, title: String(item.title),
    why: item.why ? String(item.why) : '', how: item.how ? String(item.how) : '',
    evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : (item.evidence ? [String(item.evidence)] : []),
    source: item.source ? String(item.source) : '', addedBy: by, addedAt: at,
  };
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = clean; else list.push(clean);
  state.log.push({ at, by, project, item: item.id, action: i >= 0 ? 'item-replace' : 'item-add' });
  return { ok: true, item: clean };
}

export function recordTick(state, project, itemId, { state: tickState = 'done', note = '', by, at = nowISO(), spec, config }) {
  safeSlug(project);
  if (!TICK_STATES.includes(tickState)) return { ok: false, refused: 'invalid', errors: [`state must be one of ${TICK_STATES.join(', ')}`] };
  if (!by) return { ok: false, refused: 'no-identity', errors: ['a tick needs an identity'] };
  const item = itemsFor(project, { spec, config, state }).find((it) => it.id === itemId);
  if (!item) return { ok: false, refused: 'no-subject', errors: [`${itemId} is not on ${project}'s list`] };
  const res = item.check ? ((loadResults(project) || {}).results || {})[item.id] : null;
  const tick = { state: tickState, note: String(note || '').slice(0, 1000), by, at, evidenceDigest: item.check ? digestEvidence(res) : null };
  const ticks = (state.ticks[project] ||= {});
  if (tickState === 'open') delete ticks[itemId]; else ticks[itemId] = tick;
  state.log.push({ at, by, project, item: itemId, action: `tick-${tickState}`, note: tick.note });
  return { ok: true, tick };
}

/** Join spec, results and ticks into the rows a renderer shows. */
export function evaluateProject(project, { spec, config, state, results }) {
  const ticks = (state.ticks || {})[project] || {};
  const measured = (results && results.results) || {};
  const rows = itemsFor(project, { spec, config, state }).map((it) => {
    const res = it.check ? (measured[it.id] || { status: STATUS.UNMEASURED, summary: results ? 'no result for this check in the last run' : 'launchlist has not run for this project', evidence: [] }) : null;
    const tick = ticks[it.id] || null;
    let accepted = false;
    let lapsed = false;
    let stale = false;
    if (tick && it.check) {
      if (tick.evidenceDigest && tick.evidenceDigest === digestEvidence(res)) accepted = true;
      // No evidence is not changed evidence: the tick is held, and counts again once a run measures
      // the same evidence it was made against.
      else if (res.status === STATUS.UNMEASURED) stale = true;
      else lapsed = true;
    }
    // An acceptance cannot turn an unmeasured check green; ruling it not applicable can.
    const done = it.check
      ? (res.status === STATUS.PASS || (accepted && (res.status !== STATUS.UNMEASURED || tick.state === 'na')))
      : !!tick;
    return {
      id: it.id, title: it.title, section: it.section, severity: it.severity, owner: it.owner, size: it.size,
      why: it.why || '', how: it.how || '', check: it.check || null, custom: !!it.custom,
      evidence: it.custom ? (it.evidence || []) : (res ? res.evidence || [] : []),
      source: it.source || '', result: res, tick, accepted, lapsed, stale, done,
      na: !!(tick && tick.state === 'na' && (!it.check || accepted)),
    };
  });
  const open = rows.filter((r) => !r.done);
  const count = (sev) => open.filter((r) => r.severity === sev).length;
  return {
    project,
    profiles: projectProfiles(project, config),
    measuredAt: results ? results.measuredAt : null,
    repo: results ? results.repo : null,
    rows,
    summary: { total: rows.length, done: rows.length - open.length, openHard: count('HARD'), openShould: count('SHOULD'), openLater: count('LATER'),
      unmeasured: rows.filter((r) => r.result && r.result.status === STATUS.UNMEASURED).length },
  };
}

export function projectsInStore(config, state) {
  const names = new Set(Object.keys(config.projects || {}));
  for (const k of Object.keys(state.items || {})) names.add(k);
  for (const k of Object.keys(state.ticks || {})) names.add(k);
  return [...names].sort();
}

export function buildModel({ spec = loadSpec(), config = loadConfig(), state = loadState(), projects = null } = {}) {
  const list = projects || projectsInStore(config, state);
  return {
    generatedAt: nowISO(),
    sections: spec.sections,
    profiles: spec.profiles,
    configAbsent: !!config.absent,
    projects: list.map((p) => evaluateProject(p, { spec, config, state, results: loadResults(p) })),
  };
}
