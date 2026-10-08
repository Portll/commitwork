// admin/lib/session-view.mjs — one row per session, in the terms an operator thinks in.
//
// WHY THIS EXISTS. Overwatch showed a session as a uuid, a status pill, a backend, a model and a
// dollar figure, with the window it lives in kept in a SECOND table keyed differently. Every field
// was true and the view answered nothing: you could not tell which agent was working on which
// project, what it had touched, or what it had just said. This assembles the answer from stores
// that already exist and joins them on something that survives.
//
// THE JOIN. A session's identity here is its transcript uuid; the touch ledger writes the first
// eight characters of it as `s`, and a pid as `p`. The uuid prefix is authoritative because it
// cannot be recycled. A pid CAN be: touches.jsonl spans days and the kernel reissues pids, so a
// pid-only match is accepted ONLY when the touch falls inside the session's own lifetime. Keying on
// pid alone would quietly attribute a dead session's edits to whoever inherited its number.
//
// Zero dependencies. Env read at CALL time. Every reader is ENOENT-tolerant and fail-closed: a
// store that cannot be read is UNREADABLE, never an empty list, because "touched nothing" and
// "could not be asked" are different facts about an agent.
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parseTranscript, foldTurns, tokenSummary, textOf } from '../../bin/lib/turn-recorder-core.mjs';

export const storeDir = () => process.env.CW_STORE_DIR || join(process.cwd(), '.claude', 'store');
export const transcriptRoot = () => process.env.CW_TRANSCRIPT_ROOT || join(homedir(), '.claude', 'projects');
/** Bytes of transcript tail read for "what did it last say". A full read is a render-path hazard. */
export const tailBytes = () => Number(process.env.CW_TURN_TAIL_BYTES) || 262144;
export const maxOutputChars = () => Number(process.env.CW_TURN_TEXT_CHARS) || 400;

/** Read a jsonl store into rows. A torn final line is skipped, never fatal. */
export function readJsonl(path, { readFile = readFileSync } = {}) {
  let txt;
  try { txt = readFile(path, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, absent: true, rows: [] };
    return { ok: false, why: `${path}: ${e && e.code ? e.code : e}`, rows: [] };
  }
  const rows = [];
  for (const line of String(txt).split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  return { ok: true, absent: false, rows };
}

/**
 * Files a session touched, from the shared touch ledger.
 *
 * Returns a MAP keyed by uuid-prefix, plus the pid-keyed rows kept separately so the caller can
 * apply the lifetime test it alone can make (it knows when each session started).
 */
export function readTouches({ dir = storeDir(), readFile = readFileSync } = {}) {
  const r = readJsonl(join(dir, 'touches.jsonl'), { readFile });
  if (!r.ok) return { ok: false, why: r.why, byRef: new Map(), rows: [] };
  const byRef = new Map();
  for (const row of r.rows) {
    if (!row || typeof row.x !== 'string') continue;
    const ref = typeof row.s === 'string' ? row.s : null;
    if (!ref) continue;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(row);
  }
  return { ok: true, absent: r.absent, byRef, rows: r.rows };
}

/** Fleet names and cwds, latest row per session wins. */
export function readRoster({ dir = storeDir(), readFile = readFileSync } = {}) {
  const r = readJsonl(join(dir, 'fleet-roster.jsonl'), { readFile });
  if (!r.ok) return { ok: false, why: r.why, byId: new Map() };
  const byId = new Map();
  for (const row of r.rows) {
    if (!row || typeof row.sessionId !== 'string') continue;
    byId.set(row.sessionId, { ...(byId.get(row.sessionId) || {}), ...row });
  }
  return { ok: true, absent: r.absent, byId };
}

/** Where a session's transcript lives. The cwd is encoded into the directory name by the harness. */
export function transcriptPath(ids, { root = transcriptRoot() } = {}) {
  const uuid = ids && typeof ids.transcript === 'string' ? ids.transcript : null;
  const cwd = ids && typeof ids.cwd === 'string' ? ids.cwd : null;
  if (!uuid || !cwd) return null;
  return join(root, cwd.replace(/[/.]/g, '-'), `${uuid}.jsonl`);
}

/** Read the last `n` bytes of a file without loading it. Never throws. */
export function readTail(path, n) {
  let fd = null;
  try {
    const st = statSync(path);
    const len = Math.min(n, st.size);
    const buf = Buffer.alloc(len);
    fd = openSync(path, 'r');
    readSync(fd, buf, 0, len, Math.max(0, st.size - len));
    return { ok: true, text: buf.toString('utf8'), truncated: st.size > len, size: st.size, mtimeMs: st.mtimeMs };
  } catch (e) {
    return { ok: false, why: e && e.code === 'ENOENT' ? 'absent' : `${e && e.code ? e.code : e}` };
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* already closed */ } }
  }
}

/**
 * What the session last said, from the transcript tail.
 *
 * The FIRST line of a tail read is almost always a fragment of a larger entry, so it is dropped
 * rather than parsed — a half-line that happens to parse would render as a real turn.
 */
export function lastOutput(path, { tail = tailBytes(), chars = maxOutputChars() } = {}) {
  if (!path) return { state: 'unknown', why: 'session reports no transcript id' };
  const r = readTail(path, tail);
  if (!r.ok) return r.why === 'absent' ? { state: 'absent', why: 'no transcript on this box' } : { state: 'unreadable', why: r.why };
  const lines = r.text.split('\n').filter((l) => l.trim());
  if (r.truncated) lines.shift();
  let found = null;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const t = String(textOf(e) ?? '').trim();
    if (t && e && (e.type === 'assistant' || e.role === 'assistant')) found = { text: t, at: e.timestamp ?? null };
  }
  if (!found) return { state: 'none', why: 'no assistant turn in the tail read' };
  return {
    state: 'live',
    at: found.at,
    text: found.text.length > chars ? `${found.text.slice(0, chars)}…` : found.text,
    clipped: found.text.length > chars,
  };
}

// Token totals need a whole-file pass, which is a hazard in a render path repainted every few
// seconds. Memoised on (size, mtime): a transcript that has not changed cannot have new tokens.
const tokenCache = new Map();
export const TOKEN_CACHE_MAX = 64;

export function tokenBudget(path, { cache = tokenCache, readFile = readFileSync } = {}) {
  if (!path) return { state: 'unknown', why: 'session reports no transcript id' };
  let st;
  try { st = statSync(path); }
  catch (e) { return e && e.code === 'ENOENT' ? { state: 'absent', why: 'no transcript on this box' } : { state: 'unreadable', why: `${e && e.code ? e.code : e}` }; }
  const key = `${path}:${st.size}:${st.mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let out;
  try {
    // parseTranscript returns {steps, unparseable} — the wrapper, not the steps. `unparseable` is
    // carried through rather than dropped: a summary computed over a transcript with torn lines is
    // a summary of PART of the session, and saying so is the difference between a total and a floor.
    const parsed = parseTranscript(readFile(path, 'utf8'));
    const summary = tokenSummary(foldTurns(parsed.steps));
    out = { state: 'live', ...summary, unparseableLines: parsed.unparseable || 0 };
  } catch (e) {
    out = { state: 'unreadable', why: `transcript parse failed: ${e.message}` };
  }
  // Drop only THIS path's older entries, never the whole cache. Clearing it wholesale meant a
  // fleet of six sessions evicted each other every render and the memo never hit.
  for (const k of cache.keys()) if (k.startsWith(`${path}:`)) cache.delete(k);
  cache.set(key, out);
  if (cache.size > TOKEN_CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}

/** Tokens the fleet has spent, over the sessions that could be measured. Never a silent zero. */
export function fleetTokens(rows) {
  const measured = rows.filter((r) => r.tokens && r.tokens.state === 'live');
  const add = (a, b) => (a === null || b === null ? (a === null ? b : a) : a + b);
  const totals = measured.reduce((acc, r) => ({
    input: add(acc.input, r.tokens.totals?.input ?? null),
    output: add(acc.output, r.tokens.totals?.output ?? null),
    cacheRead: add(acc.cacheRead, r.tokens.totals?.cacheRead ?? null),
    cacheCreation: add(acc.cacheCreation, r.tokens.totals?.cacheCreation ?? null),
  }), { input: null, output: null, cacheRead: null, cacheCreation: null });
  return {
    totals,
    turns: measured.reduce((n, r) => n + (r.tokens.turns || 0), 0),
    measured: measured.length,
    // The denominator is stated so a total over 2 of 14 sessions cannot read as a fleet total.
    of: rows.length,
    unmeasured: rows.filter((r) => !r.tokens || r.tokens.state !== 'live').map((r) => ({ id: r.id, why: r.tokens?.why || r.tokens?.state || 'unknown' })),
  };
}

const fileStem = (p) => basename(String(p || ''));

/**
 * The merged row model. `sessions` are spine rows; `runs` are dispatch agent sessions keyed by
 * sessionId; both are optional, because one source being down must not blank the other.
 */
export function buildRows(sessions, { runs = [], touches, roster, now = Date.now(), transcripts = true } = {}) {
  const runById = new Map((runs || []).map((r) => [r.sessionId || r.id, r]));
  return (sessions || []).map((s) => {
    const ids = s.ids || {};
    const ref = typeof ids.transcript === 'string' ? ids.transcript.slice(0, 8) : null;
    const rosterRow = roster && roster.byId ? roster.byId.get(ids.transcript || s.id) : null;

    // Name: the fleet name the session answers to, then its declared label, then its id. A uuid is
    // the last resort because it is the thing an operator cannot recognise.
    const name = ids.fleetName || (rosterRow && rosterRow.name) || s.agent || null;
    const cwd = ids.cwd || (rosterRow && rosterRow.cwd) || null;

    const files = collectFiles(s, ref, touches, now);
    const tPath = transcripts ? transcriptPath(ids) : null;

    return {
      id: s.id,
      name,
      label: s.label || (rosterRow && rosterRow.label) || null,
      project: cwd ? fileStem(cwd) : null,
      cwd,
      workspace: ids.workspace || null,
      idePort: ids.idePort ?? null,
      status: s.status || null,
      planId: s.planId || null,
      pid: s.pid ?? null,
      startedAt: s.startedAt || null,
      lastSeen: s.lastSeen || null,
      kind: ids.kind || (rosterRow && rosterRow.kind) || null,
      entrypoint: ids.entrypoint || (rosterRow && rosterRow.entrypoint) || null,
      backend: runById.get(s.id)?.backend ?? null,
      model: runById.get(s.id)?.model ?? null,
      files,
      tokens: transcripts ? tokenBudget(tPath) : { state: 'unknown', why: 'transcripts not read' },
      output: transcripts ? lastOutput(tPath) : { state: 'unknown', why: 'transcripts not read' },
    };
  });
}

/**
 * Files this session touched. The pid path carries the lifetime test described at the top of the
 * file; the uuid-prefix path does not need one.
 */
export function collectFiles(session, ref, touches, now = Date.now()) {
  if (!touches) return { state: 'unknown', why: 'touch ledger not read' };
  if (!touches.ok) return { state: 'unreadable', why: touches.why };
  const rows = [];
  if (ref && touches.byRef.has(ref)) rows.push(...touches.byRef.get(ref));
  if (!rows.length && session && session.pid != null) {
    const from = session.startedAt ? Date.parse(session.startedAt) : null;
    const to = session.endedAt ? Date.parse(session.endedAt) : now;
    for (const row of touches.rows || []) {
      if (row.p !== session.pid || typeof row.x !== 'string') continue;
      const at = row.at ? Date.parse(row.at) : null;
      // A pid match with no usable timestamp is REFUSED, not accepted: pids are recycled, and an
      // untestable match is exactly the one that attributes a dead session's edits to a live one.
      if (at === null || from === null || at < from || at > to) continue;
      rows.push({ ...row, viaPid: true });
    }
  }
  if (!rows.length) return { state: 'none', count: 0, paths: [], recent: null };
  const paths = [...new Set(rows.map((r) => r.x))];
  const latest = rows.reduce((a, b) => ((a && Date.parse(a.at || 0) > Date.parse(b.at || 0)) ? a : b), null);
  return {
    state: 'live',
    count: paths.length,
    touches: rows.length,
    paths: paths.slice(0, 12),
    more: Math.max(0, paths.length - 12),
    recent: latest ? { path: latest.x, access: latest.access || latest.via || null, at: latest.at || null } : null,
    viaPid: rows.every((r) => r.viaPid),
  };
}
