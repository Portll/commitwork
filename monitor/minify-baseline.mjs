#!/usr/bin/env node
/*
 * minify-baseline.mjs — one-shot baseline for the minifiedCode lane: grandfather what already
 * exists, enforce only what appears afterward. The baseline is a set of line-free PLACE keys
 * (`sc:<repo>|minifiedCode|<rule>|<file>`); ingestArea skips filing baselined places.
 * Capture is ONE-SHOT per repo — a re-runnable baseline is a laundering primitive, so --refresh
 * is an explicit, journaled operator act. Git-tracked, atomic, never inside rollup.json.
 *
 *   node monitor/minify-baseline.mjs <rollup.json | reportDir> [--refresh] [--who NAME]
 * Env: CW_MINIFY_BASELINE (path), CW_NOW (deterministic timestamp).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJSONAtomic } from '../cra/lib.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = () => process.env.CW_MINIFY_BASELINE || join(__dirname, 'minify-baseline.json');
// fix: resolved at CALL time - a const read at import defeats a test's override.
export const BASELINE_SCHEMA_PATH = () => process.env.CW_MINIFY_BASELINE_SCHEMA || join(__dirname, '..', 'schema', 'minify-baseline.schema.json');
const CATEGORY = 'minifiedCode';

// The place key MUST match issue-store's scannerPlaceKey(scannerSourceKey(row, category)) exactly:
// `sc:<repo>|<category>|<rule>|<file>` — no line, so a finding that moves stays baselined.
export const placeKeyFor = (repo, rule, file) => `sc:${repo}|${CATEGORY}|${rule}|${file}`;

// Extract the minifiedCode place keys per repo from a rollup document.
export function placeKeysFromRollup(rollup) {
  const byRepo = {};
  const rows = (rollup && rollup.scannerFindings && rollup.scannerFindings[CATEGORY]) || [];
  for (const r of rows) {
    if (!r || !r.repo || !r.rule || !r.file) continue;
    (byRepo[r.repo] ||= new Set()).add(placeKeyFor(r.repo, r.rule, r.file));
  }
  const out = {};
  for (const [repo, set] of Object.entries(byRepo)) out[repo] = [...set].sort();
  return out;
}

const EMPTY = () => ({ version: 1, repos: {}, journal: [] });

export function loadBaseline(path = BASELINE_PATH()) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (!j || typeof j !== 'object' || typeof j.repos !== 'object') return { ...EMPTY(), _unreadable: true };
    // fix: shape checked before the keys are trusted - a place key naming another lane suppresses
    // that lane, because issue-store consults these as ONE flat set across every category. Same
    // failure mode as an unparseable file: grandfather nothing, refuse to overwrite.
    const v = validateAgainstSchema(j, { path: BASELINE_SCHEMA_PATH() });
    if (v.errors.length) return { ...EMPTY(), _unreadable: true, _schemaErrors: v.errors };
    return { version: j.version || 1, repos: j.repos || {}, journal: Array.isArray(j.journal) ? j.journal : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return EMPTY();
    return { ...EMPTY(), _unreadable: true }; // fail toward alarm: an unreadable baseline grandfathers NOTHING
  }
}

// Flat Set of every baselined place key across all repos — what ingestArea consults.
export function loadBaselinePlaceKeys(path = BASELINE_PATH()) {
  const doc = loadBaseline(path);
  const set = new Set();
  for (const rep of Object.values(doc.repos || {})) for (const k of (rep.placeKeys || [])) set.add(k);
  return set;
}

// Pure capture: add or (with refresh) replace one repo's baseline. Returns { doc, action, count } or
// throws on a one-shot violation. `at` and `who` are recorded; `sliceHash` anchors what was captured.
export function applyCapture(doc, { repo, placeKeys, at, sliceId = null, who = 'operator', refresh = false }) {
  if (!repo) throw new Error('minify-baseline: repo required');
  const d = { version: doc.version || 1, repos: { ...(doc.repos || {}) }, journal: [...(doc.journal || [])] };
  const existing = d.repos[repo];
  if (existing && !refresh) {
    throw new Error(`minify-baseline: ${repo} is already baselined (captured ${existing.capturedAt}). `
      + 'Re-baselining is an explicit operator act — pass --refresh; it is journaled. A re-runnable '
      + 'baseline would let a payload landing after capture become permanently pre-existing.');
  }
  const keys = [...new Set(placeKeys)].sort();
  const sliceHash = createHash('sha256').update(keys.join('\n')).digest('hex').slice(0, 16);
  d.repos[repo] = { capturedAt: at, sliceId, sliceHash, placeKeys: keys };
  d.journal.push({ at, action: existing ? 'refresh' : 'capture', repo, count: keys.length, who, sliceId, sliceHash });
  return { doc: d, action: existing ? 'refresh' : 'capture', count: keys.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = argv.slice(2);
  const refresh = args.includes('--refresh');
  const whoIdx = args.indexOf('--who');
  const who = whoIdx >= 0 ? args[whoIdx + 1] : 'operator';
  const target = args.find((a) => !a.startsWith('--') && a !== who);
  if (!target) { process.stderr.write('usage: minify-baseline.mjs <rollup.json | reportDir> [--refresh] [--who NAME]\n'); process.exit(2); }
  const rollupPath = existsSync(target) && statSync(target).isDirectory() ? join(target, 'rollup.json') : target;
  const rollup = JSON.parse(readFileSync(rollupPath, 'utf8'));
  const at = process.env.CW_NOW || new Date().toISOString();
  const perRepo = placeKeysFromRollup(rollup);
  let doc = loadBaseline();
  if (doc._unreadable) {
    const why = doc._schemaErrors ? `\n  - ${doc._schemaErrors.join('\n  - ')}` : '';
    process.stderr.write(`minify-baseline: existing baseline unreadable — refusing to overwrite${why}\n`);
    process.exit(3);
  }
  const results = [];
  for (const [repo, keys] of Object.entries(perRepo)) {
    try { const r = applyCapture(doc, { repo, placeKeys: keys, at, sliceId: rollup.sliceId || null, who, refresh }); doc = r.doc; results.push(`${repo}: ${r.action} ${r.count}`); }
    catch (e) { results.push(`${repo}: REFUSED (${e.message.split('.')[0]})`); }
  }
  writeJSONAtomic(BASELINE_PATH(), doc);
  process.stdout.write(`minify-baseline @ ${at}\n${results.map((r) => `  ${r}`).join('\n')}\n`);
}

if (isMainModule(import.meta.url)) main(process.argv);
