#!/usr/bin/env node
// gate-send-name — PreToolUse hook on SendMessage. Registry remediation WP4, class L8.
//
// A session name is not an identifier: it is minted from a hash prefix and reassigned on restart,
// and one ListAgents call has carried two live sessions under one name (4 of 25 unaddressable on
// 2026-09-02). bin/session-roster.mjs has refused to RESOLVE such a name since 2026-09-01 (exit 3,
// holders printed), but nothing consulted it at the one moment the ambiguity costs anything — the
// send. This hook is that consultation.
//
// It blocks on exactly one condition: the roster corroborates MORE THAN ONE live holder of the bare
// name being addressed. Everything else passes —
//   · a `to` carrying a [ref] is already disambiguated, and the harness resolves refs, not this hook;
//   · a name the roster has no row for, or only stale/unverifiable rows for, is UNVERIFIABLE, not
//     contended. Blocking on it would fire on every peer that never recorded itself and make the gate
//     A4 (alarm fatigue) within the hour;
//   · a name from another project's namespace is outside this roster's population;
//   · a roster that cannot be read is a measurement failure and is reported on stderr, never a block
//     (a broken gate must not silence the fleet).
// Fail-open on every error, by construction: the cost of a wrong block is a message that never went;
// the cost of a wrong pass is the status quo.
//
// Payload: PreToolUse JSON on stdin — { tool_name, tool_input: { to, message } }. Exit 2 with a
// stderr line is the harness's "deny and show the reason"; exit 0 is pass.
//
// Env (read at call time): CW_SESSION_ROSTER, CW_PEER_SOCKET_DIR — the roster's own seams, so a
// test drives this exact file against a fixture roster and a fixture socket directory.
import { isMainModule } from '../../lib/is-main.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolve as rosterResolve, assess } from '../session-roster.mjs';
import { livePids } from '../lib/peer-headers.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));

/** The bare name and optional [ref] out of a `to` field. Returns null for anything else. */
export function parseTo(to) {
  const m = /^\s*([A-Za-z][A-Za-z-]*-[0-9a-z]{2})\s*(?:\[([0-9a-f]{4,8})\])?\s*$/.exec(String(to || ''));
  if (!m) return null;
  return { name: m[1], ref: m[2] || null, project: m[1].slice(0, m[1].lastIndexOf('-')) };
}

/**
 * Decide. Pure over its inputs; the CLI below supplies live pids and the roster.
 * Returns { decision: 'pass' | 'block', why }.
 */
export function decide(payload, { rows, live } = {}) {
  if (!payload || payload.tool_name !== 'SendMessage') return { decision: 'pass', why: 'not a send' };
  const to = parseTo(payload.tool_input?.to);
  if (!to) return { decision: 'pass', why: 'to is not a session name' };
  if (to.ref) return { decision: 'pass', why: 'addressed by ref — already disambiguated' };
  if (to.project !== 'commitwork') return { decision: 'pass', why: `${to.project} is outside this roster's population` };
  if (!rows || !rows.length) return { decision: 'pass', why: 'no roster row — unverifiable, not contended' };
  const a = assess(rows, { live });
  if (a.live > 1) {
    const holders = a.scored.filter((s) => s.verdict === 'live').map((s) => `pid=${s.row.pid}${s.row.ref ? ` [${s.row.ref}]` : ''}`);
    return { decision: 'block', why: `${a.live} LIVE holders of ${to.name} (${holders.join(', ')}) — L8: the name does not identify one session. Address it with its [ref] from ListAgents.` };
  }
  return { decision: 'pass', why: a.live === 1 ? 'one live holder' : 'no live holder — unverifiable, not contended' };
}

if (isMainModule(import.meta.url)) {
  let payload = null;
  try { payload = JSON.parse(readFileSync(0, 'utf8') || 'null'); } catch { process.exit(0); }
  let rows = [];
  let live = null;
  try {
    const to = parseTo(payload?.tool_input?.to);
    if (to && !to.ref && to.project === 'commitwork') { rows = rosterResolve(to.name); live = livePids(); }
  } catch (e) {
    process.stderr.write(`gate-send-name: roster unreadable (${e.message}) — not measured, not blocked\n`);
    process.exit(0);
  }
  const d = decide(payload, { rows, live });
  if (d.decision === 'block') {
    process.stderr.write(`gate-send-name: REFUSED — ${d.why}\n`);
    process.exit(2);
  }
  process.exit(0);
}
