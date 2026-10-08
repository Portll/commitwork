// Peer names, recovered from what the HARNESS wrote — not from what a human remembered to annotate.
//
// WHY THIS EXISTS. bin/session-roster.mjs is the durable name register, and for three days nothing
// fed it. The two feeds it shipped with both require somebody to act: `--record` needs an agent to
// call ListAgents and type the result, and `--mirror` reads `(cwNN)` out of session TITLES, which
// are hand-maintained. Measured 2026-09-01: a title said `cw-15` for the session whose harness name
// is `c5`, and a session building a --record line from that title nearly wrote a false binding.
// Append-only means a wrong row is permanent.
//
// So this module reads a THIRD source, and it is the only one of the three the harness itself
// produces. When one session messages another, the receiving transcript records the envelope:
//
//     <cross-session-message from="uds:/tmp/cc-socks/22104.sock" from-name="commitwork-xx" ...>
//
// `from-name` is the registry's own name for the sender and `from` carries the sender's PID. Nobody
// types either. That makes this source first-party in a way the title mirror is not, and it is why
// a binding harvested here is recorded as `via:'peer-header'` rather than folded in with titles.
//
// WHAT IT IS STILL NOT. It is not ListAgents. It sees only sessions that have SENT a message that
// landed in a transcript under this project directory, so it is silent about a session that has
// only ever worked alone — measured 2026-09-01: 103 name<->pid bindings recovered, against 17 live
// sockets, 7 of which were named. Silence here is not evidence of absence, and every caller is
// handed the counts it would need to say so.
//
// THE PULL, NOT THE PUSH. The point of scanning rather than hooking: a push feed needs every
// session to cooperate at the moment it starts, and three days of an empty roster is what that
// costs when one forgets. A scan is retroactive. One session running it once recovers bindings for
// sessions that never cooperated and for sessions that have since exited.
//
// PRIVACY. Only the envelope attributes are read — a name and a socket path. Message bodies are
// matched over and discarded, never returned, the same discipline bin/session-title.mjs states for
// titles. Do not widen this regex to capture content.
//
// Env, all read at CALL time (house rule): CW_PEER_SOCKET_DIR, CW_TRANSCRIPT_DIR.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { transcriptDir } from '../session-title.mjs';

/**
 * Where the harness puts one unix socket per live session. Derived from this process's own
 * CLAUDE_CODE_MESSAGING_SOCKET when present, because that is an observation rather than a guess;
 * the literal is the fallback for a process the harness did not launch.
 */
export const socketDir = () => process.env.CW_PEER_SOCKET_DIR
  || (process.env.CLAUDE_CODE_MESSAGING_SOCKET ? dirname(process.env.CLAUDE_CODE_MESSAGING_SOCKET) : '/tmp/cc-socks');

/** Transcript directory for this repo, overridable so tests read a fixture and not the real fleet. */
export const scanDir = (cwd) => process.env.CW_TRANSCRIPT_DIR || transcriptDir(cwd);

// The envelope, as it appears inside a transcript's JSON — hence the optional backslashes: the
// attribute quotes are escaped when the envelope is nested in a JSON string, and bare when it is
// not. A pattern written for only one of the two forms silently finds nothing, which is exactly how
// this source would read as "no peers have ever messaged" while carrying a hundred bindings.
const ENVELOPE = /from=\\?"uds:([^\\"]*?\/(\d+)\.sock)\\?"\s+from-name=\\?"commitwork-([0-9a-z]{2})\\?"/g;

/**
 * Live session PIDs — TWO WITNESSES, and neither is sufficient alone.
 *
 * A socket file is not a live process: the harness can leave one behind, and a resolver that
 * trusted the file would report a dead session as addressable. A live PID is not a session either;
 * PIDs are recycled, and some unrelated process inheriting 22104 would resurrect a name that ended
 * hours ago. Requiring both narrows it to "a process that is running AND still owns its session
 * socket", and the two cannot fail the same way.
 *
 * Returns null — NOT an empty Set — when the socket directory cannot be read. An empty Set means
 * "measured, nobody is live"; null means "could not measure", and a caller that collapses the two
 * publishes every binding it holds as dead.
 */
export function livePids({ dir = socketDir() } = {}) {
  let names;
  try { names = readdirSync(dir); }
  catch (e) { return e.code === 'ENOENT' ? new Set() : null; }
  const live = new Set();
  for (const n of names) {
    const m = /^(\d+)\.sock$/.exec(n);
    if (!m) continue;
    // Signal 0 tests for existence and permission without delivering anything. EPERM means the
    // process exists and is not ours, which is still a live process.
    try { process.kill(Number(m[1]), 0); live.add(m[1]); }
    catch (e) { if (e.code === 'EPERM') live.add(m[1]); }
  }
  return live;
}

/**
 * Every name<->pid binding the harness wrote into this project's transcripts.
 *
 * Returns { bindings, files, unreadable }. `bindings` is one row per DISTINCT (name, pid) pair with
 * a hit count and the newest timestamp seen next to it; a name held by two pids yields two rows,
 * because that is the L8 collision this register exists to make visible and collapsing it to one
 * row would erase the only evidence of it.
 *
 * `unreadable` is counted, never swallowed: a transcript that cannot be read is a set of bindings
 * this scan did not see, and a scan that reports a clean sweep it never performed is the failure
 * the roster already has.
 */
export function scanPeerHeaders({ cwd, dir = scanDir(cwd) } = {}) {
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); }
  catch (e) { if (e.code === 'ENOENT') return { bindings: [], files: 0, unreadable: 0 }; throw e; }

  const seen = new Map();
  let unreadable = 0;
  for (const f of files) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); }
    catch { unreadable++; continue; }
    // Cheap reject before the scan: most transcripts carry no envelope at all.
    if (!text.includes('cross-session-message')) continue;
    for (const line of text.split('\n')) {
      if (!line.includes('from-name')) continue;
      ENVELOPE.lastIndex = 0;
      let m;
      while ((m = ENVELOPE.exec(line))) {
        const [, sock, pid, name] = m;
        const key = `${name} ${pid}`;
        const at = timestampOf(line);
        const row = seen.get(key) || { name, pid, sock, hits: 0, at: null, seenIn: new Set() };
        row.hits++;
        row.seenIn.add(f.replace(/\.jsonl$/, ''));
        // Newest wins. An absent timestamp stays absent rather than defaulting to now, which would
        // make every binding look freshly observed on the day somebody happened to run the scan.
        if (at && (!row.at || at > row.at)) row.at = at;
        seen.set(key, row);
      }
    }
  }
  const bindings = [...seen.values()]
    .map((r) => ({ ...r, seenIn: [...r.seenIn] }))
    .sort((a, b) => (a.name === b.name ? a.pid.localeCompare(b.pid) : a.name.localeCompare(b.name)));
  return { bindings, files: files.length, unreadable };
}

/** The line's own ISO timestamp, or null. Never invents one. */
function timestampOf(line) {
  const m = /"timestamp"\s*:\s*"([0-9T:.\-Z]+)"/.exec(line);
  return m ? m[1] : null;
}

/**
 * Names held by more than one PID — the L8 signature, computed rather than remembered.
 * `live` (a Set, or null) upgrades a historical collision to a CURRENT one: two live holders of a
 * name is an active routing hazard, two dead ones is a record.
 */
export function collisions(bindings, live = null) {
  const byName = new Map();
  for (const b of bindings) byName.set(b.name, [...(byName.get(b.name) || []), b]);
  const out = [];
  for (const [name, rows] of byName) {
    if (rows.length < 2) continue;
    // null live ⇒ liveness unmeasured ⇒ the count is unknown, not zero.
    const liveNow = live ? rows.filter((r) => live.has(r.pid)).length : null;
    out.push({ name, holders: rows.length, liveNow, pids: rows.map((r) => r.pid) });
  }
  return out.sort((a, b) => b.holders - a.holders || a.name.localeCompare(b.name));
}
