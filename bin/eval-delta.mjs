#!/usr/bin/env node
// bin/eval-delta.mjs — the dimension-level lifecycle loop: diff two scored evaluation artifacts,
// alarm on regression, and verify every residual is LINKED to a backlog item rather than dropped.
//
// usage: node bin/eval-delta.mjs <baseline.json> <current.json> [--json] [--backlog <path>]
// exit:  0 no regressions, all residuals linked or none present
//        2 REGRESSED dimension(s) or vanished dimension(s) — a score that fell between scored runs
//        3 unlinked residuals (gaps named in the artifact but filed nowhere) or linkage UNKNOWN
//        4 usage / unreadable / unparseable / shape refusal — never an empty comparison
//
// Dimension values: bare number, {after}, or {score}; any other shape refuses rather than coerce.
// Residual linkage is structured-ref-only (`| R |` backlog row); unreadable backlog ⇒ UNKNOWN.

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');


export function normalizeDimension(name, value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    if (typeof value.after === 'number' && Number.isFinite(value.after)) return value.after;
    if (typeof value.score === 'number' && Number.isFinite(value.score)) return value.score;
  }
  const shape = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  throw new Error(`dimension "${name}" has unrecognized shape (${shape}) — refusing to coerce; a coerced 0 would read as a catastrophic regression`);
}

export function loadArtifact(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') throw new Error(`no such artifact: ${path}`);
    throw new Error(`artifact at ${path} is unreadable (${e && (e.code || e.message)}); refusing to compare against nothing`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch { throw new Error(`artifact at ${path} is not valid JSON; refusing to treat it as empty`); }
  if (!doc || typeof doc !== 'object' || !doc.dimensions || typeof doc.dimensions !== 'object' || Array.isArray(doc.dimensions)) {
    throw new Error(`artifact at ${path} carries no dimensions map — not a scored evaluation, refusing`);
  }
  return doc;
}

export function diffDimensions(baseDoc, curDoc) {
  const base = baseDoc.dimensions, cur = curDoc.dimensions;
  const names = [...new Set([...Object.keys(base), ...Object.keys(cur)])].sort();
  const rows = [];
  for (const name of names) {
    const inBase = Object.hasOwn(base, name), inCur = Object.hasOwn(cur, name);
    if (inBase && !inCur) { rows.push({ name, before: normalizeDimension(name, base[name]), after: null, delta: null, state: 'vanished' }); continue; }
    if (!inBase && inCur) { rows.push({ name, before: null, after: normalizeDimension(name, cur[name]), delta: null, state: 'new-dimension' }); continue; }
    const b = normalizeDimension(name, base[name]);
    const a = normalizeDimension(name, cur[name]);
    const delta = Math.round((a - b) * 10) / 10;
    rows.push({ name, before: b, after: a, delta, state: delta > 0 ? 'improved' : delta < 0 ? 'REGRESSED' : 'unchanged' });
  }
  const comparable = rows.filter((r) => r.state !== 'vanished' && r.state !== 'new-dimension');
  const totals = {
    before: Math.round(comparable.reduce((s, r) => s + r.before, 0) * 10) / 10,
    after: Math.round(comparable.reduce((s, r) => s + r.after, 0) * 10) / 10,
    regressed: rows.filter((r) => r.state === 'REGRESSED').length,
    vanished: rows.filter((r) => r.state === 'vanished').length,
    improved: rows.filter((r) => r.state === 'improved').length,
  };
  return { rows, totals };
}

// Collects per-dimension {residual, backlog} entries and followOnBridge[] items.
export function collectResiduals(doc) {
  const out = [];
  for (const [name, v] of Object.entries(doc.dimensions)) {
    if (v && typeof v === 'object' && typeof v.residual === 'string' && v.residual.trim() && v.residual.trim() !== '—') {
      out.push({ source: `dimension:${name}`, text: v.residual.trim(), ref: v.backlog || v.backlogRef || null,
        nonActionable: v.nonActionable === true });
    }
  }
  for (const f of Array.isArray(doc.followOnBridge) ? doc.followOnBridge : []) {
    if (f && typeof f.item === 'string') {
      const m = f.item.match(/BACKLOG\s+([A-Z])\b|\(([A-Z])\)\s*$/);
      out.push({ source: `followOn:${f.rank ?? '?'}`, text: f.item, ref: f.backlog || f.backlogRef || (m ? (m[1] || m[2]) : null) });
    }
  }
  return out;
}

export function checkLinkage(residuals, backlogPath) {
  let raw = null;
  try { raw = readFileSync(backlogPath, 'utf8'); }
  catch (e) {
    return { state: 'linkage-unknown', reason: `backlog at ${backlogPath} is ${e && e.code === 'ENOENT' ? 'absent' : 'unreadable'} — reporting UNKNOWN, never "all filed"`, linked: [], unlinked: residuals.filter((r) => !r.nonActionable), missingRefs: [], accepted: residuals.filter((r) => r.nonActionable) };
  }
  const linked = [], unlinked = [], missingRefs = [], accepted = [];
  for (const r of residuals) {
    // nonActionable is an explicit author statement — counted and named, never alarmed.
    if (r.nonActionable) { accepted.push(r); continue; }
    if (!r.ref) { unlinked.push(r); continue; }
    // structured check only: the ref must exist as a backlog table row `| R |`
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- ref is a backlog row id from the operator-authored residuals ledger, not scanned-repo input
    if (new RegExp(`^\\|\\s*${r.ref}\\s*\\|`, 'm').test(raw)) linked.push(r);
    else missingRefs.push(r);
  }
  return { state: 'checked', linked, unlinked, missingRefs, accepted };
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const bIdx = argv.indexOf('--backlog');
  const backlogPath = bIdx !== -1 ? resolve(argv[bIdx + 1]) : resolve(process.env.CW_BACKLOG || join(REPO, 'evaluations', 'BACKLOG-commitwork.md'));
  const args = argv.filter((a, i) => !a.startsWith('--') && (bIdx === -1 || i !== bIdx + 1));
  if (args.length !== 2) { console.error('usage: node bin/eval-delta.mjs <baseline.json> <current.json> [--json] [--backlog <path>]'); process.exit(4); }

  let baseDoc, curDoc, diff, residuals, linkage;
  try {
    baseDoc = loadArtifact(resolve(args[0]));
    curDoc = loadArtifact(resolve(args[1]));
    diff = diffDimensions(baseDoc, curDoc);
    residuals = collectResiduals(curDoc);
    linkage = checkLinkage(residuals, backlogPath);
  } catch (e) { console.error(`eval-delta: ${e.message}`); process.exit(4); }

  const report = { generated: nowISO(), baseline: args[0], current: args[1], ...diff, residuals: { total: residuals.length, linkage } };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`eval-delta — ${args[0]} → ${args[1]}`);
    for (const r of diff.rows) {
      const line = r.state === 'vanished' ? `  ${r.name}: ${r.before} → VANISHED — a removed dimension is how a regression hides`
        : r.state === 'new-dimension' ? `  ${r.name}: (new) → ${r.after}`
        : `  ${r.name}: ${r.before} → ${r.after}  (${r.delta >= 0 ? '+' : ''}${r.delta})${r.state === 'REGRESSED' ? '  ⟵ REGRESSED' : ''}`;
      console.log(line);
    }
    console.log(`total: ${diff.totals.before} → ${diff.totals.after} · improved ${diff.totals.improved} · regressed ${diff.totals.regressed} · vanished ${diff.totals.vanished}`);
    if (linkage.state === 'linkage-unknown') console.log(`residual linkage: UNKNOWN — ${linkage.reason}`);
    else console.log(`residuals: ${residuals.length} stated · ${linkage.linked.length} linked · ${linkage.accepted.length} accepted (non-actionable, stated) · ${linkage.unlinked.length} UNLINKED (no ref) · ${linkage.missingRefs.length} ref MISSING from backlog${linkage.unlinked.length ? '\n  unlinked: ' + linkage.unlinked.map((r) => r.source).join(', ') : ''}${linkage.missingRefs.length ? '\n  missing refs: ' + linkage.missingRefs.map((r) => `${r.source}→${r.ref}`).join(', ') : ''}`);
  }

  if (diff.totals.regressed > 0 || diff.totals.vanished > 0) process.exit(2);
  if (linkage.state === 'linkage-unknown' || linkage.unlinked.length > 0 || linkage.missingRefs.length > 0) process.exit(3);
  process.exit(0);
}

if (isMainModule(import.meta.url)) main();
