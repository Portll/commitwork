#!/usr/bin/env node
// The durable session roster: cwNN <-> session id <-> working tree.
//
// WHY. Sessions are referred to by name across durable documents — PLAN.md attributes findings to
// one named session, the conflict register says another holds two files — and nothing on disk
// resolved a name to anything. The names live in the HARNESS session registry, reachable only by an
// agent calling the ListAgents tool. They are not in the transcript, not in git, not in any store.
// When a session ends, its binding leaves with it and every document citing it becomes unverifiable.
//
// So: the same rule the repo applies to every other store. A record that outlives its session needs
// a home that outlives its session. `.claude/store` is a directory symlink into the sidecar, so the
// roster gets a history and does not ship in a base install.
//
// WHERE THE NAME IS *NOT*. In the session title. Titles carrying `(cwNN)` are a hand-maintained
// MIRROR of the registry and are missing for most sessions — measured 2026-08-29, four named live
// sessions had no such title, and this session's own title had none while it held a name.
// `--mirror` reads that annotation and is therefore a lower-confidence source than `--record`; it
// says what it could not see, because a scrape of a partial mirror that prints "no new bindings"
// reads as "the roster is complete".
//
// Append-only. A name is never rewritten in place: a re-binding is a new row, and `--resolve`
// reports the whole history when a name has moved, rather than picking one and looking certain.
//
// THAT SAFETY PATH HAS A FLOOR, AND IT WAS MISSING (2026-09-01). "Reports the whole history when a
// name has moved" only fires once the roster HOLDS the move. Nothing fed this store for three days,
// so `--resolve 5e` found its single 2026-08-29 row and answered `cw5e = [ref] = <transcript>` with
// no caveat — while the live holder of that name was a different session on a different pid. An unfed
// roster does not degrade to grey. It degrades to CONFIDENTLY WRONG, which is the same defect the
// store exists to prevent, with the sign flipped. Feeding it fixes today and leaves every
// historical name resolving wrong forever, so `freshness()` below is the other half of the repair:
// a row is only an ANSWER while something independent still corroborates it.
//
// THREE SOURCES, RANKED, AND THE RANKING IS LOAD-BEARING:
//   observed      an agent read the harness registry with ListAgents. Authoritative.
//   peer-header   the harness's own cross-session-message envelope, harvested by --scan from
//                 transcripts. First-party — nobody types it — and it carries a PID, which is
//                 checkable against the live socket set. See bin/lib/peer-headers.mjs.
//   title-mirror  `(cwNN)` scraped from hand-maintained session titles. MEASURED WRONG, not merely
//                 lower-confidence: on 2026-09-01 a title said `cw-15` for the session whose
//                 harness name is `c5`. Append-only makes a false row permanent, so `mirror()` now
//                 refuses any title binding that contradicts a higher-ranked row and reports it.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { storeDir, treeId } from './lib/store-paths.mjs';
import { sessions } from './session-title.mjs';
import { livePids, socketDir, scanPeerHeaders, collisions } from './lib/peer-headers.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const rosterPath = () => process.env.CW_SESSION_ROSTER || join(storeDir(), 'sessions.jsonl');

/** `(cwNN)` anywhere in a title. Returns the bare NN, lowercased, or null — never a guess. */
export const nameFromTitle = (title) => {
  const m = String(title || '').match(/\(cw([0-9a-z]{2})\)/i);
  return m ? m[1].toLowerCase() : null;
};

/**
 * Rows, plus how many lines could not be parsed. A dropped line is a LOST BINDING — the whole point
 * of this store — so it is counted and surfaced, never swallowed. `readRoster` keeps the array
 * shape its callers expect; `readRosterDetailed` carries the torn count.
 */
export function readRosterDetailed(path = rosterPath()) {
  let raw;
  // Only ENOENT is legitimately "no roster yet". A permission fault must not read as an empty one.
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { rows: [], torn: 0 }; throw e; }
  const rows = [];
  let torn = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { torn++; }
  }
  return { rows, torn };
}

export function readRoster(path = rosterPath()) { return readRosterDetailed(path).rows; }

const append = (rec, path = rosterPath()) => {
  mkdirSync(dirname(path), { recursive: true });
  // Repair a missing trailing newline BEFORE appending. Without this the new record concatenates
  // onto a torn final line and destroys both — measured: a two-row store plus one --record left one
  // readable row, and the CLI reported success. An append-only store that can eat its predecessor
  // is worse than no store.
  let needsNl = false;
  try { needsNl = readFileSync(path, 'utf8').slice(-1) === '\n' ? false : statSync(path).size > 0; }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  appendFileSync(path, `${needsNl ? '\n' : ''}${JSON.stringify(rec)}\n`);
};

/**
 * Bind a name to what the caller actually observed — the authoritative path. An agent reads the
 * harness registry with ListAgents and records each row here.
 *
 * `ref` is the handle SendMessage addresses; `id` is the transcript uuid. DIFFERENT IDENTIFIER
 * SPACES, and a session usually knows only its own uuid, so either may be absent. Absent stays
 * absent: a null recorded as fact is a claim nobody made.
 */
export function record({ name, ref = null, id = null, title = null, pid = null, via = 'observed' },
  { path = rosterPath(), now = new Date().toISOString() } = {}) {
  const n = String(name || '').replace(/^(commitwork-|cw-?)/, '').toLowerCase();
  if (!/^[0-9a-z]{2}$/.test(n)) throw new Error(`not a session name: ${name}`);
  const p = pid === null || pid === undefined ? null : String(pid);
  const held = readRoster(path).some((r) => r.name === n && (r.ref ?? null) === ref
    && (r.id ?? null) === id && (r.pid ?? null) === p);
  if (held) return null;                              // idempotent: same observation, no new row
  const rec = { name: n, ...(ref ? { ref } : {}), ...(id ? { id } : {}), ...(p ? { pid: p } : {}),
    ...(title ? { title } : {}), tree: treeId(), at: now, via };
  append(rec, path);
  return rec;
}

// ── FRESHNESS ────────────────────────────────────────────────────────────────────────────────────

/** How confident a row's provenance makes it. Higher wins a contradiction; see the header ranking. */
export const CONFIDENCE = { observed: 3, 'peer-header': 2, 'title-mirror': 1 };
const rank = (r) => CONFIDENCE[r?.via] ?? 0;

const staleMs = () => Number(process.env.CW_ROSTER_STALE_MS) || 12 * 60 * 60 * 1000;

/**
 * Is this row still an ANSWER, or only a record? Three-valued, and the third value is the point.
 *
 *   'live'          something independent corroborates it RIGHT NOW — the row carries a pid and
 *                   that pid still holds a live session socket.
 *   'stale'         something independent CONTRADICTS it: the pid is gone, or the row was written
 *                   from a checkout that is not this one, or it has aged out with nothing to renew
 *                   it. A stale row must never be printed as an address.
 *   'unverifiable'  no local witness either way. Most rows land here, because a `ref` is a harness
 *                   handle and NOTHING on this machine resolves one — only ListAgents can. That is
 *                   an honest grey and it is published as one: not a pass, not a finding.
 *
 * `live` is a Set of pid strings, or null for "liveness could not be measured". null must not
 * collapse to an empty Set — that would turn every binding in the store into a contradiction.
 *
 * The tree witness is a hard local fact, not a heuristic: `tree` is sha256(absolute checkout path),
 * so a foreign value names a checkout this process is not in. Measured 2026-09-01 — the roster's 13
 * pre-existing rows carry tree 789775f29db1, which is /Users/username/External/Portll/commitwork,
 * a path that DOES NOT EXIST on this machine. Those rows are unresolvable here by construction,
 * their transcripts are not under this project directory, and they were resolving as answers.
 */
export function freshness(row, { now = Date.now(), self = treeId(), live = null, stale = staleMs() } = {}) {
  const reasons = [];
  let positive = false;
  let negative = false;

  if (row?.pid) {
    if (live === null) reasons.push('liveness-unmeasured');
    else if (live.has(String(row.pid))) { reasons.push('socket-live'); positive = true; }
    else { reasons.push('socket-gone'); negative = true; }
  }
  if (row?.tree && row.tree !== self) { reasons.push('foreign-tree'); negative = true; }
  const at = row?.at ? Date.parse(row.at) : NaN;
  if (Number.isFinite(at) && now - at > stale) { reasons.push('aged'); negative = true; }
  if (!row?.at) reasons.push('undated');

  // A live socket outranks the soft contradictions: the session IS reachable now, whatever
  // checkout recorded it or however long ago. A DEAD socket is never outranked by anything.
  const verdict = reasons.includes('socket-gone') ? 'stale'
    : positive ? 'live'
      : negative ? 'stale'
        : 'unverifiable';
  return { verdict, reasons };
}

/**
 * Rows for one name, newest first, each with its freshness — plus what the set as a whole permits.
 * `answer` is the single row a caller may act on, and it is null unless exactly one row is 'live'.
 * Two live rows is L8 itself (two holders of one name) and must not resolve to either.
 */
export function assess(rows, opts = {}) {
  const scored = rows.map((r) => ({ row: r, ...freshness(r, opts) }))
    .sort((a, b) => rank(b.row) - rank(a.row) || String(b.row.at ?? '').localeCompare(String(a.row.at ?? '')));
  const liveRows = scored.filter((s) => s.verdict === 'live');
  return {
    scored,
    live: liveRows.length,
    unverifiable: scored.filter((s) => s.verdict === 'unverifiable').length,
    stale: scored.filter((s) => s.verdict === 'stale').length,
    answer: liveRows.length === 1 ? liveRows[0].row : null,
    ...summarise(rows),
  };
}

/**
 * The PULL feed: harvest harness-written name<->pid envelopes and record what is new.
 * Retroactive by construction, which is why it exists — a push feed only ever binds sessions that
 * cooperated at the moment they started, and three days of an empty roster is what that costs.
 * Returns { added, scanned, files, unreadable, collisions }.
 */
export function scan({ path = rosterPath(), now = new Date().toISOString(), cwd, dir,
  read = scanPeerHeaders, live = undefined } = {}) {
  const { bindings, files, unreadable } = read({ cwd, ...(dir ? { dir } : {}) });
  const liveSet = live === undefined ? livePids() : live;
  const added = [];
  for (const b of bindings) {
    // The binding's own timestamp, never the clock: a scan run today must not date a binding the
    // harness wrote a week ago as though it were observed today.
    const rec = record({ name: b.name, pid: b.pid, via: 'peer-header' }, { path, now: b.at || now });
    if (rec) added.push(rec);
  }
  return { added, scanned: bindings.length, files, unreadable, collisions: collisions(bindings, liveSet) };
}

/**
 * Lower-confidence: harvest `(cwNN)` from transcript titles. A MIRROR of the registry, maintained by
 * hand, so it is silent about every session nobody annotated. Returns { added, unseen }.
 */
export function mirror({ path = rosterPath(), now = new Date().toISOString(), cwd,
  readSessions = sessions } = {}) {
  const rows = readRoster(path);
  const held = new Set(rows.map((r) => `${r.name} ${r.id}`));
  // uuid -> the best-ranked name already bound to it. A title that disagrees with this is not a new
  // binding, it is a CONTRADICTION of a better source, and append-only makes it permanent.
  const bestFor = new Map();
  for (const r of rows) {
    if (!r.id) continue;
    const cur = bestFor.get(r.id);
    if (!cur || rank(r) > rank(cur)) bestFor.set(r.id, r);
  }
  const added = [];
  const refused = [];
  let unseen = 0;
  // Injected so a test can supply a session list. sessions(cwd) DERIVES a project directory from
  // cwd rather than reading one, so passing a scratch directory reads somewhere else entirely.
  for (const s of readSessions(cwd)) {
    const name = nameFromTitle(s.title);
    if (!name) { unseen++; continue; }
    if (held.has(`${name} ${s.id}`)) continue;
    // THE MEASURED FAILURE, refused mechanically. On 2026-09-01 one session carried a title
    // reading `cw-15` while the harness name for it is `c5`; a session building a --record line
    // from that title would have written a false binding indistinguishable from a true one. One
    // uuid cannot hold two names, so a title claiming otherwise loses to the better source and is
    // reported as a finding rather than used as a fallback.
    const clash = bestFor.get(s.id);
    if (clash && clash.name !== name && rank(clash) > rank({ via: 'title-mirror' })) {
      refused.push({ id: s.id, titleName: name, boundName: clash.name, boundVia: clash.via, title: s.title });
      continue;
    }
    const rec = { name, id: s.id, title: s.title, tree: treeId(), at: now, via: 'title-mirror' };
    append(rec, path);
    added.push(rec);
  }
  return { added, unseen, refused };
}

/**
 * What a set of rows for one name actually says. The CLI held this inline, so the tests that
 * claimed to pin it were reimplementing it and could not have caught a change to the shipped code.
 *
 * `reused` is per identifier space and never their OR: one session observed twice — once by ref,
 * once by uuid — is ONE session, and two spellings of the ref under one uuid is a re-observation,
 * not a reuse. Only two distinct values of the SAME space are a genuine collision.
 */
export function summarise(rows) {
  const uniq = (k) => [...new Set(rows.map((r) => r[k]).filter(Boolean))];
  const ids = uniq('id'); const refs = uniq('ref');
  // Three-valued, because two of the three cases were previously collapsed into "REUSED":
  //   'reused'     two distinct uuids — definitely two sessions.
  //   'ambiguous'  two distinct refs and no uuid to tie them — MIGHT be two sessions, or one
  //                re-observed. Unknowable from the roster, so it is not published as either.
  //   'single'     one session, however many partial observations of it there are.
  const verdict = ids.length > 1 ? 'reused'
    : (refs.length > 1 && ids.length === 0) ? 'ambiguous'
      : 'single';
  return { name: rows[0]?.name ?? null, ids, refs, verdict, complete: ids.length === 1 && refs.length === 1 };
}

// ── THE SECOND WITNESS ───────────────────────────────────────────────────────────────────────────
//
// Is the roster being FED? Nothing already in this module can answer that. Every check reachable
// from here reads the roster, so a roster that is empty, wrong or three days old looks identical to
// a correct one — which is precisely how this store sat unfed from 2026-08-29 to 2026-09-01 with a
// green test suite over it. A writability test would have shared the failure mode exactly: the tool
// was ALWAYS writable, and that was never the problem.
//
// So the witness is a different store with a different feed: the touch ledger, written by a
// PostToolUse hook on every edit by every session. The two cannot fail together. The roster fails
// when an agent forgets a convention; the ledger fails when a hook stops firing, and a hook that
// stopped firing would take the whole attribution stack with it long before this check noticed.
//
// WHAT IT REFUSES TO SAY. An empty ledger is not a finding, it is an absence of measurement — in CI
// there is no harness, no hook and no ledger at all, and a check that called that "unfed" would
// manufacture exactly the fabricated failure the house rule forbids. Nor is a short run of activity
// enough: a checkout minutes old with no roster row is a new checkout, not a neglected one. Only a
// tree that has been WORKED ON for longer than the lag budget, and still holds no fresh roster row,
// is positively unfed — and that is a measurement, not an inference.
const feedLagMs = () => Number(process.env.CW_ROSTER_MAX_FEED_LAG_MS) || 24 * 60 * 60 * 1000;
const feedSpanMs = () => Number(process.env.CW_ROSTER_MIN_SPAN_MS) || 24 * 60 * 60 * 1000;

/**
 * 'ok' | 'unfed' | 'unmeasurable' — never a boolean, and never a default.
 *
 * `ledgerRows` of null means the ledger could not be read (fail closed: unmeasurable, not unfed).
 * Both stores are filtered to THIS tree, because `tree`/`r` is sha256(absolute checkout path) and a
 * shared store carries rows from checkouts that are not this one; counting those would let another
 * machine's activity vouch for this one's bookkeeping.
 */
export function feedLag({ rosterRows, ledgerRows, self = treeId(), now = Date.now(),
  maxLagMs = feedLagMs(), minSpanMs = feedSpanMs() } = {}) {
  if (!ledgerRows) return { state: 'unmeasurable', reason: 'ledger-unreadable' };
  const ts = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : null; };
  const mine = ledgerRows.filter((r) => r?.r === self).map((r) => ts(r.at)).filter((t) => t !== null);
  if (!mine.length) return { state: 'unmeasurable', reason: 'no-ledger-activity-for-this-tree' };
  const newestEdit = Math.max(...mine);
  const span = newestEdit - Math.min(...mine);
  if (span < minSpanMs) return { state: 'unmeasurable', reason: 'insufficient-activity-span', span };
  const sessions = new Set(ledgerRows.filter((r) => r?.r === self && r?.s).map((r) => r.s));

  const rosterMine = (rosterRows || []).filter((r) => r?.tree === self).map((r) => ts(r.at))
    .filter((t) => t !== null);
  const newestBind = rosterMine.length ? Math.max(...rosterMine) : null;
  const base = { span, sessions: sessions.size, newestEdit, newestBind, maxLagMs };
  if (newestBind === null) {
    return { ...base, state: 'unfed', reason: 'no-roster-row-for-this-tree', lag: null };
  }
  const lag = newestEdit - newestBind;
  return lag > maxLagMs
    ? { ...base, state: 'unfed', reason: 'roster-lags-ledger', lag }
    : { ...base, state: 'ok', reason: 'fed', lag };
}

/** Rows for a name (cwNN or cw-NN or commitwork-NN) or for a session id / 8-char prefix. */
export function resolve(query, { path = rosterPath() } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const asName = q.replace(/^(commitwork-|cw-?)/, '');
  const rows = readRoster(path);
  const byName = rows.filter((r) => r.name === asName);
  if (byName.length) return byName;
  return rows.filter((r) => r.ref === q || r.id === q || (r.id && String(r.id).slice(0, 8) === q.slice(0, 8)));
}

if (isMainModule(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === '--record') {
    // usage: --record <name> <ref> [session-uuid] [pid]  — argv is [node, script, '--record', ...]
    //
    // THE PID IS WHAT MAKES THE ROW AN ADDRESS. `freshness()` only returns 'live' for a row whose
    // pid still holds a session socket, and a `ref` resolves nowhere on this machine — so until
    // 2026-09-06 this path, the RANKED-AUTHORITATIVE one, could only ever mint 'unverifiable'
    // rows. The store's own header says an unfed roster degrades to confidently wrong; a roster fed
    // only by rows that can never corroborate is the same defect one step back.
    //
    // A pid the caller got wrong would be WORSE than none: it mints a row that reads 'live' while
    // naming another session's process. So the pid is checked against the live socket set before it
    // is written, and a pid that holds no socket is REFUSED rather than downgraded — the caller
    // saying "this is my process" and the machine saying otherwise is a contradiction to surface,
    // not to average out. When liveness cannot be measured at all the pid is still recorded and
    // `freshness()` reports it 'liveness-unmeasured', which is the honest grey.
    // `--pid N` is an alias for the positional pid. Registry remediation #19 recorded a session
    // that ran `--pid 86372` against a CLI that only took the positional form; the flag was
    // silently absorbed as a positional and the row it should have corroborated stayed
    // unverifiable all day. Both spellings write the same row.
    //
    // CLAUDE_PID is deliberately NOT a fallback. The harness exports it into every subprocess, so an
    // env fallback turns "the caller omitted the pid" into "the caller asserted this process" —
    // measured the first time it was tried: the existing omit-the-pid test picked up the test
    // runner's own session pid and was REFUSED against a fixture socket set. The SessionStart
    // instruction already says to omit a pid rather than substitute one; the CLI honours that.
    const rest = process.argv.slice(3);
    let flagPid;
    const pi = rest.indexOf('--pid');
    if (pi >= 0) { flagPid = rest[pi + 1]; rest.splice(pi, 2); }
    const [name, ref, id, posPid] = rest;
    const pid = flagPid ?? posPid;
    try {
      if (flagPid !== undefined && posPid !== undefined && flagPid !== posPid) {
        throw new Error(`--pid ${flagPid} and positional pid ${posPid} disagree — refusing to guess which is this session`);
      }
      if (pid !== undefined) {
        if (!/^\d+$/.test(pid)) throw new Error(`not a pid: ${pid}`);
        // An ABSENT socket directory and an EMPTY one are different facts, and only one of them
        // contradicts the caller. `livePids` maps ENOENT to an empty Set — correct for its own
        // callers, who are asking "which pids are live", but here it would turn "this machine keeps
        // no session sockets" into "your pid is dead" and refuse a record nobody could ever make.
        // So the directory is checked for existence first: gone means UNMEASURABLE, and an
        // unmeasurable witness may not veto. The row is written and `freshness()` files it
        // 'liveness-unmeasured', which is the honest answer rather than a confident one.
        const live = existsSync(socketDir()) ? livePids() : null;
        if (live !== null && !live.has(String(pid))) {
          throw new Error(`pid ${pid} holds no session socket — refusing to record it as cw${name}. `
            + 'A pid that is not live cannot corroborate a name, and writing it would produce a row '
            + 'that reads live while naming someone else. Re-run without the pid to record an '
            + 'honestly unverifiable binding.');
        }
      }
      const rec = record({ name, ref: ref || null, id: id || null, pid: pid ?? null });
      process.stdout.write(rec ? `roster: recorded cw${rec.name}${rec.ref ? ` [${rec.ref}]` : ''}${rec.pid ? ` pid=${rec.pid}` : ''}\n` : 'roster: already held\n');
    } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
    process.exit(0);
  }
  if (cmd === '--mirror') {
    const { added, unseen, refused } = mirror();
    for (const r of refused) {
      process.stderr.write(`REFUSED: title says cw${r.titleName} for ${r.id.slice(0, 8)}, but ${r.boundVia} binds it to cw${r.boundName}. `
        + `The title is WRONG and was not written. Titles are hand-maintained; do not derive a name from one.\n`);
    }
    process.stdout.write(added.length
      ? `roster: +${added.length} from titles — ${added.map((r) => `cw${r.name}=${r.id.slice(0, 8)}`).join(', ')}\n`
      : 'roster: no new bindings from titles\n');
    // Never silent about the gap: this source cannot see a session nobody annotated, and a quiet
    // run here would otherwise read as a complete roster.
    process.stdout.write(`roster: ${unseen} transcript(s) carry no (cwNN) title — this source cannot see them. `
      + `The registry is authoritative: an agent should ListAgents and --record each row.\n`);
    process.exit(0);
  }
  if (cmd === '--scan') {
    const { added, scanned, files, unreadable, collisions: coll } = scan();
    process.stdout.write(`roster: scanned ${files} transcript(s), ${scanned} harness name<->pid binding(s), +${added.length} new\n`);
    if (unreadable) process.stdout.write(`roster: ${unreadable} transcript(s) UNREADABLE — bindings in them were not seen, and this scan is not a clean sweep\n`);
    for (const c of coll) {
      process.stdout.write(`L8: cw${c.name} has been held by ${c.holders} pids (${c.pids.join(', ')})`
        + `${c.liveNow === null ? ' — liveness unmeasured' : c.liveNow > 1 ? ` — ${c.liveNow} LIVE NOW, addressing this name is unsafe` : ''}\n`);
    }
    // This source cannot see a session that never messaged anyone. Saying so is the whole
    // difference between a partial scan and one that reads as complete.
    process.stdout.write('roster: --scan sees only sessions that SENT a cross-session message. '
      + 'A session that worked alone is invisible to it; ListAgents + --record remains authoritative.\n');
    process.exit(0);
  }
  if (cmd === '--resolve' && arg) {
    const rows = resolve(arg);
    if (!rows.length) { process.stderr.write(`no roster entry for ${arg}\n`); process.exit(1); }
    const live = livePids();
    const a = assess(rows, { live });
    for (const { row: r, verdict, reasons } of a.scored) {
      process.stdout.write(`${verdict.toUpperCase().padEnd(13)} cw${r.name}  ${r.ref ? `[${r.ref}]` : '(no ref)'}  `
        + `${r.id ?? '(no uuid)'}  ${r.pid ? `pid=${r.pid}` : ''}  tree=${r.tree}  ${r.at}  ${r.via}  `
        + `${reasons.length ? `(${reasons.join(', ')})` : ''}  ${r.title ?? ''}\n`);
    }
    // Count DEFINED values only, per identifier space. Two rows for one name are usually two
    // partial observations of one session — a ref from the registry, a uuid from a title — and
    // counting `undefined` as a distinct id reported that as "bound to 2 sessions". An absent
    // field is not a second identity.
    if (a.verdict === 'reused') {
      process.stdout.write(`note: cw${a.name} is bound to ${a.ids.length} distinct sessions — the name has been REUSED, so a document citing it is ambiguous about which\n`);
    } else if (a.verdict === 'ambiguous') {
      process.stdout.write(`note: cw${a.name} carries ${a.refs.length} refs and no uuid — one session re-observed, or two. The roster cannot tell, and does not guess.\n`);
    }
    // The equality line is an ADDRESS, so it is printed only when something still corroborates it.
    // It used to print off a single row of any age: that is how a three-day-old binding for a name
    // that had since moved was published as fact, with no caveat, to a session about to act on it.
    if (a.answer && a.answer.ref && a.answer.id) {
      process.stdout.write(`cw${a.answer.name} = [${a.answer.ref}] = ${a.answer.id}\n`);
      process.exit(0);
    }
    if (a.live > 1) {
      process.stdout.write(`REFUSED: ${a.live} live holders of cw${a.name}. This is L8 — the name does not identify one session. Address a ref or a pid, never the name.\n`);
      process.exit(3);
    }
    if (a.live === 0) {
      process.stdout.write(`NOT AN ADDRESS: no row for ${arg} is corroborated by anything live `
        + `(${a.stale} stale, ${a.unverifiable} unverifiable). The rows above are a RECORD of past bindings, not a current one. `
        + `Run --scan, or ListAgents + --record, before addressing this name.\n`);
      process.exit(3);
    }
    process.exit(0);
  }
  if (cmd === '--list' || !cmd) {
    const rows = readRoster();
    if (!rows.length) { process.stderr.write(`roster is empty (${rosterPath()}) — run --scan\n`); process.exit(1); }
    const live = livePids();
    const self = treeId();
    let liveN = 0;
    for (const r of rows) {
      const { verdict } = freshness(r, { live, self });
      if (verdict === 'live') liveN++;
      process.stdout.write(`${verdict.toUpperCase().padEnd(13)} cw${r.name}  ${(r.ref ? `[${r.ref}]` : '        ')}  `
        + `${r.id ? r.id.slice(0, 8) : '        '}  ${(r.pid ? `pid=${r.pid}` : '').padEnd(11)}  tree=${r.tree}  ${r.via ?? ''}  ${r.title ?? ''}\n`);
    }
    process.stdout.write(`roster: ${rows.length} row(s), ${liveN} corroborated live${live === null ? ' (liveness UNMEASURED — the socket dir could not be read)' : ''}\n`);
    process.exit(0);
  }
  process.stderr.write('usage: session-roster.mjs [--record <cwNN> <ref> [uuid] [pid] | --scan | --mirror | --resolve <cwNN|ref|uuid> | --list]\n');
  process.exit(2);
}
