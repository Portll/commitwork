#!/usr/bin/env node
// cra/evidence-status.mjs — is the evidence pack current, and how did the last refresh end?
//
// cra/refresh.mjs writes evidence-index.json (when, and from which inputs) and refresh-status.json
// (how the run ended). This reads both. A pack is `current` only when it is inside the threshold,
// none of its evidence inputs has changed since, and the last refresh did not fail. Otherwise it is
// `never-generated`, `stale`, `failed` or `unknown`, each with its reasons.
//
// Beside that, `timestamp` reports the pack's RFC 3161 tokens: anchored / unanchored / absent /
// invalid, re-verified from disk on every call (CW_TSA_CA read then). A pack refreshed without
// CW_TSA_URL is absent. Revocation is not checked.
//
//   node cra/evidence-status.mjs [--json]
//   exit 0 current · 20 stale · 21 never generated · 22 last refresh failed · 23 unknown

import { readFileSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { resolvePaths, sha256, hoursSince, nowISO, craRoot } from './lib.mjs';
import { verifyStamp } from './timestamp.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const EVIDENCE_INDEX = 'evidence-index.json';
export const REFRESH_STATUS = 'refresh-status.json';
export const REFRESH_STATUS_SCHEMA = 'commitwork.cra-refresh-status/1';
// Indexes written before this stamp carry none; this reader needs only generatedAt and inputs.
export const EVIDENCE_INDEX_SCHEMA = 'commitwork.cra-evidence-index/1';
export const STALE_HOURS_ENV = 'CW_CRA_EVIDENCE_STALE_HOURS';
// The scheduled refresh is daily; the slack absorbs one late or slow run before it reads stale.
export const EVIDENCE_STALE_HOURS_DEFAULT = 36;
export const EXIT = Object.freeze({ current: 0, stale: 20, 'never-generated': 21, failed: 22, unknown: 23 });

export function evidenceStaleHours(env = process.env) {
  const raw = env[STALE_HOURS_ENV];
  if (raw === undefined || raw === '') return EVIDENCE_STALE_HOURS_DEFAULT;
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) throw new Error(`${STALE_HOURS_ENV} must be a number of hours > 0 (got ${JSON.stringify(raw)})`);
  return h;
}

// [name, resolvePaths key, feed]. A feed (KEV, EPSS) refreshes on its own clock, several times
// between packs; its change is reported but does not by itself make the pack stale.
export const EVIDENCE_INPUTS = Object.freeze([
  ['rollup', 'rollup', false], ['ledger', 'ledger', false], ['history', 'historyIndex', false],
  ['annotations', 'annotations', false], ['products', 'products', false], ['controls', 'controls', false],
  ['kev', 'kev', true], ['epss', 'epss', true],
]);

const shown = (p) => {
  const rel = relative(craRoot(), p);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p;
};

export function fingerprintInputs(paths) {
  return EVIDENCE_INPUTS.map(([name, key, feed]) => {
    const p = paths[key];
    if (!p) return { name, feed, path: null, state: 'unresolved' };
    let buf;
    try { buf = readFileSync(p); }
    catch (e) {
      if (e.code === 'ENOENT') return { name, feed, path: shown(p), state: 'absent' };
      return { name, feed, path: shown(p), state: 'unreadable', error: e.code || e.message };
    }
    return { name, feed, path: shown(p), state: 'present', bytes: buf.length, sha256: sha256(buf) };
  });
}

// Only ENOENT is absence; anything else unreadable is an error the caller must report.
function readRecord(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? { absent: true } : { error: `unreadable (${e.code || e.message})` }; }
  try { return { doc: JSON.parse(raw) }; }
  catch (e) { return { error: `unparseable JSON (${e.message})` }; }
}

function lastRunOf(statusPath) {
  const r = readRecord(statusPath);
  if (r.absent) return { recorded: false, path: statusPath };
  if (r.error) return { recorded: true, path: statusPath, readable: false, reason: `${statusPath} is ${r.error}` };
  const d = r.doc || {};
  if (typeof d.exit !== 'number' || typeof d.ok !== 'boolean') {
    return { recorded: true, path: statusPath, readable: false, reason: `${statusPath} records no exit/ok` };
  }
  return {
    recorded: true, path: statusPath, readable: true, ok: d.ok, exit: d.exit, reason: d.reason ?? null,
    startedAt: d.startedAt ?? null, finishedAt: d.finishedAt ?? null,
    failedSteps: (d.steps || []).filter((s) => s.outcome === 'failed'),
  };
}

const sameInput = (a, b) => a.state === b.state && (a.sha256 || null) === (b.sha256 || null);

// Best first. No record at all is absent, never anchored.
export const TIMESTAMP_STATES = Object.freeze(['anchored', 'unanchored', 'absent', 'invalid']);
export function worstTimestamp(states) {
  if (!states.length) return 'absent';
  return states.reduce((w, s) => (TIMESTAMP_STATES.indexOf(s) > TIMESTAMP_STATES.indexOf(w) ? s : w), 'anchored');
}

// The index names the records the refresh stamped; their tokens are verified again here, so a record
// or token changed since the refresh reads invalid rather than as the refresh recorded it.
export function timestampStatus(doc, paths, env = process.env) {
  const out = (state, reason, records = []) => ({ state, reason, revocation: 'not checked', records });
  if (!doc) return out('absent', 'no evidence pack has been generated');
  const ts = doc.timestamp;
  if (ts === undefined) return out('absent', 'the pack records no timestamp step');
  if (!ts || typeof ts !== 'object' || !Array.isArray(ts.records)) return out('invalid', 'the pack\'s timestamp record is malformed');
  if (!ts.records.length) return out('absent', typeof ts.reason === 'string' ? ts.reason : 'the pack stamped no records');
  const records = ts.records.map((rec) => {
    const name = typeof rec?.record === 'string' ? rec.record : '';
    const p = resolve(paths.out, name);
    const rel = relative(paths.out, p);
    if (!name || !rel || rel.startsWith('..') || isAbsolute(rel)) return { record: name, state: 'invalid', reason: 'the recorded path is not inside the CRA output directory' };
    const live = verifyStamp(p, { env });
    // A reply refused at stamp time was never written: keep the refresh's verdict and reason.
    if (live.state === 'absent' && (rec.state === 'invalid' || rec.state === 'absent') && rec.reason) return { record: name, state: rec.state, reason: rec.reason };
    if (live.state === 'anchored' || live.state === 'unanchored') return { record: name, state: live.state, genTime: live.genTime, tsa: live.tsa };
    return { record: name, state: live.state, reason: live.reason };
  });
  const state = worstTimestamp(records.map((r) => r.state));
  const off = records.filter((r) => r.state === state && r.reason);
  const reason = state === 'anchored' ? null
    : state === 'unanchored' ? 'tokens verify but are unanchored: CW_TSA_CA names no trust anchor'
      : `${off.length} of ${records.length} record(s) ${state}: ${[...new Set(off.map((r) => r.reason))].join('; ')}`;
  return out(state, reason, records);
}

export function evidenceStatus(paths = resolvePaths(), at = nowISO()) {
  const indexPath = join(paths.out, EVIDENCE_INDEX);
  const lastRun = lastRunOf(join(paths.out, REFRESH_STATUS));
  const res = {
    state: null, at, indexPath, generatedAt: null, ageHours: null, maxHours: null,
    inputs: null, inputsChanged: [], feedsChanged: [], lastRun, timestamp: null, reasons: [],
  };
  const done = (state) => ({ ...res, state, exit: EXIT[state] });

  if (lastRun.recorded && !lastRun.readable) res.reasons.push(`last refresh outcome unknown: ${lastRun.reason}`);
  else if (lastRun.recorded && !lastRun.ok) {
    res.reasons.push(`last refresh failed (exit ${lastRun.exit}${lastRun.finishedAt ? ` at ${lastRun.finishedAt}` : ''}): ${lastRun.reason || 'no reason recorded'}`);
  }

  const idx = readRecord(indexPath);
  if (idx.absent) {
    res.reasons.unshift(`no evidence pack has been generated: ${indexPath} is absent (run node cra/refresh.mjs)`);
    res.timestamp = timestampStatus(null, paths);
    return done('never-generated');
  }
  if (idx.error) { res.reasons.unshift(`${indexPath} is ${idx.error}`); return done('unknown'); }
  res.timestamp = timestampStatus(idx.doc, paths);

  try { res.maxHours = evidenceStaleHours(); }
  catch (e) { res.reasons.unshift(e.message); return done('unknown'); }

  const gen = idx.doc?.generatedAt;
  if (typeof gen !== 'string' || !Number.isFinite(Date.parse(gen))) {
    res.reasons.unshift(`${indexPath} records no generatedAt, so its age is unmeasured`);
    return done('unknown');
  }
  res.generatedAt = gen;
  res.ageHours = Math.round(hoursSince(gen, at) * 10) / 10;

  const stale = [];
  if (res.ageHours > res.maxHours) stale.push(`generated ${res.ageHours}h ago (> ${res.maxHours}h)`);
  let unmeasured = null;
  if (!Array.isArray(idx.doc.inputs)) {
    unmeasured = 'the pack records no inputs, so whether they changed since it was generated is unmeasured';
  } else {
    res.inputs = idx.doc.inputs;
    const now = new Map(fingerprintInputs(paths).map((i) => [i.name, i]));
    for (const rec of idx.doc.inputs) {
      const cur = now.get(rec.name);
      if (!cur || sameInput(rec, cur)) continue;
      (rec.feed ? res.feedsChanged : res.inputsChanged).push(rec.name);
    }
    if (res.inputsChanged.length) stale.push(`input(s) changed since it was generated: ${res.inputsChanged.join(', ')}`);
  }

  res.reasons.unshift(...stale);
  if (stale.length) return done('stale');
  if (lastRun.recorded && !lastRun.readable) return done('unknown');
  if (lastRun.recorded && !lastRun.ok) return done('failed');
  if (unmeasured) { res.reasons.unshift(unmeasured); return done('unknown'); }
  return done('current');
}

if (isMainModule(import.meta.url)) {
  const s = evidenceStatus();
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else {
    console.log(`cra evidence pack: ${s.state}${s.generatedAt ? ` (generated ${s.generatedAt}, ${s.ageHours}h ago, threshold ${s.maxHours}h)` : ''}`);
    for (const r of s.reasons) console.log(`  - ${r}`);
    if (s.feedsChanged.length) console.log(`  · feed(s) updated since: ${s.feedsChanged.join(', ')}`);
    if (s.timestamp) console.log(`  · timestamp: ${s.timestamp.state}${s.timestamp.reason ? ` — ${s.timestamp.reason}` : ''} (revocation not checked)`);
  }
  process.exitCode = s.exit;
}
