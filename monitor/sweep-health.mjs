#!/usr/bin/env node
// sweep-health.mjs — classifies standing `.sweep-inflight.json` markers. THE DISCRIMINATOR IS THE
// PID, NOT THE AGE. This module exists because age-only classification is measurably wrong in both
// directions, and the next reader will otherwise "simplify" it back:
//
// fact: measured 2026-08-23 — the client-a sweep ran 605 minutes and was HEALTHY (pid alive, log mtime current, 289MB written into its batch) while liveness.mjs labelled it HUNG for ~6 of those hours against one fleet-wide 4h constant / client-a (34 projects) and 100randomrepos cross 4h on EVERY normal run, an alarm that fires on every long run trains the reader to ignore it, and a reader acted on one of these labels that week (expiry: on re-measure, prev: wrong)
// fact: measured 2026-08-20 — the genuinely hung markers (client-a pid 36023, client-b pid 90944) had DEAD pids, with nothing running at all at any age (expiry: on re-measure, prev: unknown)
//
// So: a dead pid with a standing marker is a real hang AT ANY AGE. A live pid past a threshold is a
// long sweep — a different fact, reported as a different state ('overrunning'), never as a hang.
//
// DECLARATION SPLIT FROM AUTHORITY: this module classifies. It does not kill, does not write, and
// does not read a clock (nowMs is injected). Naming a marker 'kill-eligible' is a declaration;
// acting on it is a separate, human-authorised step elsewhere.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { processState } from '../lib/pid-alive.mjs';

export const INFLIGHT_FILE = '.sweep-inflight.json';

// Every state this module can emit. Exported so counts can be pre-seeded: a state that cannot occur
// must count 0, never be absent — an absent key reads as "no data", not "cannot happen".
export const STATES = ['running', 'overrunning', 'kill-eligible', 'hung', 'unknown'];

// fact: process.kill(pid, 0) probes without signalling, and EPERM means a pid owned by ANOTHER USER, which is ALIVE / guessing "dead" there invents a hang, the exact over-report this module exists to stop (expiry: never, prev: wrong)
// fact: any other errno throws and the caller turns that into 'unknown', never into a verdict (expiry: never, prev: broken)
// fact: ONE declaration of what a probe error means, used by the default probe AND by classify()'s catch / it was in two places — defaultPidAlive mapped EPERM to alive while classify() treated any throw as unclassifiable, so the same errno meant "alive" or "unknown" depending on whether the caller injected a probe (expiry: never, prev: duplicated)
// Returns true (alive) | false (dead) | null (genuinely unclassifiable).
export function pidErrorMeans(code) {
  if (code === 'ESRCH') return false;   // ProcessLookupError — nothing is running
  if (code === 'EPERM') return true;    // alive, owned by another user; guessing dead INVENTS a hang
  return null;                          // unknown, and never folded into either
}

export function defaultPidAlive(pid) {
  // A zombie exists but has exited; where nothing reaps it, kill(0) alone reads it alive forever.
  try { process.kill(pid, 0); return processState(pid) !== 'Z'; }
  catch (e) {
    const means = pidErrorMeans(e.code);
    if (means === null) throw e;        // unclassifiable ⇒ let classify() report unknown
    return means;
  }
}

// pid 0 signals the entire process GROUP, so it is never a legitimate marker pid; anything
// non-integer or <= 0 is refused before it reaches a probe.
function validPid(pid) { return Number.isInteger(pid) && pid > 0; }

// ── READ ────────────────────────────────────────────────────────────────────────────────────────
// FAIL CLOSED: a marker that exists but will not parse is UNREADABLE — its own list, never silently
// skipped and never treated as absent. Only ENOENT (and ENOTDIR, i.e. the entry is a plain file, not
// an area dir) means legitimately absent.
// `readFile`/`readdir` are injected so tests need no real reports tree.
export function readMarkers({ reportsRoot, readFile = readFileSync, readdir = readdirSync } = {}) {
  const markers = [];
  const unreadable = [];
  if (!reportsRoot) return { ok: false, markers, unreadable: [{ path: null, area: null, reason: 'no reportsRoot given' }], rootMissing: false, rootUnreadable: true };
  let names;
  try {
    names = readdir(reportsRoot);
  } catch (e) {
    // Absence of the tree is legitimate and stays ok:true with zero rows. A permission failure is
    // NOT absence — it is blindness, and must be distinguishable from "no sweeps are running".
    if (e.code === 'ENOENT') return { ok: true, markers, unreadable, rootMissing: true, rootUnreadable: false };
    return { ok: false, markers, unreadable: [{ path: reportsRoot, area: null, reason: `reports root unreadable (${e.code || 'error'})` }], rootMissing: false, rootUnreadable: true };
  }
  // Dirents or strings — accept both so an injected readdir may return either shape.
  const dirs = [...names].map((n) => (typeof n === 'string' ? n : n && n.name)).filter(Boolean).sort();
  for (const dir of dirs) {
    const path = join(reportsRoot, dir, INFLIGHT_FILE);
    let raw;
    try {
      raw = readFile(path, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue;  // no sweep in flight here
      unreadable.push({ path, area: dir, reason: `marker unreadable (${e.code || 'error'})` });
      continue;
    }
    let j;
    try { j = JSON.parse(raw); } catch { unreadable.push({ path, area: dir, reason: 'marker unparseable' }); continue; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) { unreadable.push({ path, area: dir, reason: 'marker is not an object' }); continue; }
    // `area` inside the marker is the registry SLUG (e.g. "client-a"); the directory is the area's
    // OUT dir (e.g. "client-a-monorepo"). Both travel — a per-area override is keyed on the slug,
    // and the reader needs the path.
    markers.push({ ...j, area: j.area || dir, areaOut: dir, path });
  }
  return { ok: unreadable.length === 0, markers, unreadable, rootMissing: false, rootUnreadable: false };
}

// ── CLASSIFY ────────────────────────────────────────────────────────────────────────────────────
// `reasons` states what DECIDED the verdict (age, pid liveness) so a UI can show the evidence
// rather than a bare label.
export function classify(marker, { nowMs, hangMs, killMs, pidAlive = defaultPidAlive } = {}) {
  const reasons = [];
  const m = marker || {};
  const started = Date.parse(m.startedAt);
  const ageMs = Number.isFinite(started) && Number.isFinite(nowMs) ? Math.max(0, nowMs - started) : null;
  const ageNote = ageMs === null ? 'age not computable (startedAt unparseable or no nowMs)' : `${Math.round(ageMs / 60000)} min old`;

  const pid = m.pid;
  if (!validPid(pid)) {
    // Its own state. A marker we cannot probe is not evidence of a hang, and must not be published
    // as one — explicit uncertainty any more than it is green.
    reasons.push(`pid is missing or not a usable pid (${JSON.stringify(pid ?? null)}) — liveness cannot be probed`, ageNote);
    return { state: 'unknown', ageMs, pid: null, pidAlive: null, reasons };
  }

  let alive;
  try { alive = pidAlive(pid) === true; }
  catch (e) {
    // An INJECTED probe that throws is read with the same table as the default one, so EPERM means
    // alive here exactly as it does there. Only a code the table cannot place is unknown.
    const means = pidErrorMeans(e.code);
    if (means === null) {
      reasons.push(`pid ${pid} could not be probed (${e.code || e.message}) — liveness is UNKNOWN, not dead`, ageNote);
      return { state: 'unknown', ageMs, pid, pidAlive: null, reasons };
    }
    reasons.push(`pid ${pid} probe threw ${e.code} — read as ${means ? 'ALIVE' : 'DEAD'} by the shared probe-error table`);
    alive = means;
  }

  if (!alive) {
    // THE REAL FAILURE, and age has no say in it: the marker stands and nothing is running.
    reasons.push(`pid ${pid} is DEAD and the marker still stands — the sweep died without publishing`, `${ageNote} (age is not the discriminator)`);
    return { state: 'hung', ageMs, pid, pidAlive: false, reasons };
  }

  reasons.push(`pid ${pid} is ALIVE — a sweep is still running, so this is not a hang`);
  if (ageMs === null) {
    // Alive but untimeable: cannot separate running from overrunning. Say so; do not pick one.
    reasons.push(ageNote);
    return { state: 'unknown', ageMs, pid, pidAlive: true, reasons };
  }
  reasons.push(ageNote);
  // `>` matches liveness.mjs's existing threshold comparison — at exactly the threshold, not past it.
  if (Number.isFinite(killMs) && ageMs > killMs) {
    reasons.push(`past killMs (${Math.round(killMs / 60000)} min) — ELIGIBLE for a human-authorised kill; this module does not kill`);
    return { state: 'kill-eligible', ageMs, pid, pidAlive: true, reasons };
  }
  if (Number.isFinite(hangMs) && ageMs > hangMs) {
    reasons.push(`past hangMs (${Math.round(hangMs / 60000)} min) — LONG, not hung`);
    return { state: 'overrunning', ageMs, pid, pidAlive: true, reasons };
  }
  reasons.push(Number.isFinite(hangMs) ? `under hangMs (${Math.round(hangMs / 60000)} min)` : 'no hangMs threshold configured');
  return { state: 'running', ageMs, pid, pidAlive: true, reasons };
}

// ── ROLL UP ─────────────────────────────────────────────────────────────────────────────────────
// `resolveFor` is optional: (area) => {hangMs, killMs}. A per-area override beats the global, and
// the row records WHICH source each threshold came from — a threshold with no provenance is a
// number the reader cannot check.
export function sweepHealth({ reportsRoot, nowMs, hangMs, killMs, resolveFor, pidAlive = defaultPidAlive, ...fs } = {}) {
  const read = readMarkers({ reportsRoot, ...fs });
  const rows = [];
  for (const m of read.markers) {
    let perArea = null;
    let overrideFailed = null;
    if (typeof resolveFor === 'function') {
      // A throwing override must not take the whole sweep down: fall back to the globals and say so.
      try { perArea = resolveFor(m.area) || null; } catch (e) { overrideFailed = e.code || e.message; }
    }
    const pick = (key, global) => {
      const v = perArea && perArea[key];
      return Number.isFinite(v)
        ? { value: v, source: 'area' }
        : { value: Number.isFinite(global) ? global : null, source: Number.isFinite(global) ? 'global' : 'none' };
    };
    const hang = pick('hangMs', hangMs);
    const kill = pick('killMs', killMs);
    const c = classify(m, { nowMs, hangMs: hang.value ?? undefined, killMs: kill.value ?? undefined, pidAlive });
    const reasons = overrideFailed
      ? [...c.reasons, `per-area threshold lookup failed (${overrideFailed}) — global thresholds used`]
      : c.reasons;
    rows.push({
      area: m.area,
      areaOut: m.areaOut,
      sliceId: m.sliceId ?? null,
      group: m.group ?? null,
      batch: m.batch ?? null,
      path: m.path,
      startedAt: m.startedAt ?? null,
      ageMs: c.ageMs,
      pid: c.pid,
      pidAlive: c.pidAlive,
      state: c.state,
      reasons,
      hangMs: hang.value,
      killMs: kill.value,
      thresholdSource: { hangMs: hang.source, killMs: kill.source },
    });
  }
  rows.sort((a, b) => (a.areaOut < b.areaOut ? -1 : a.areaOut > b.areaOut ? 1 : 0));
  // Every state pre-seeded to 0: "cannot happen" and "no data" must not share a rendering.
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  counts.unreadable = read.unreadable.length;
  return {
    ok: read.ok,
    rows,
    unreadable: read.unreadable,
    counts,
    rootMissing: read.rootMissing,
    rootUnreadable: read.rootUnreadable,
  };
}
