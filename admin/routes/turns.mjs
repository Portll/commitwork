// admin/routes/turns.mjs — token efficiency and behavioural-gate outcome per agent session.
//
// LOOPBACK ONLY, and that is the whole design decision in this file. The other surfaces carrying
// this data are local by construction: the CLI runs on the box, and the MCP tool speaks stdio to a
// process on the same machine. This panel is different — it is published through a tunnel at a
// routed hostname behind auth, so a route here is reachable from the internet the moment it exists.
//
// The data is derived from the operator's own agent transcripts. Even reduced to counts it is a
// behavioural record of a person's working sessions: how many turns, how much output, when a gate
// judged them to be reporting instead of working. That belongs on the operator port and nowhere
// else. Auth is not the right control either — a session cookie says who is asking, not where the
// answer may travel, and the reason to keep this local is the second question.
//
// So: `isLoopbackReq` (operator port, loopback Host, no CF header), refusing with 403 and a stated
// reason off it, on the precedent of admin/routes/host.mjs, which gates process and account detail
// the same way for the same reason.
//
// NO SESSION PROSE, matching bin/turn-gate.mjs's ledger record and the MCP tool. The evidence for an
// unwitnessed claim is the sentence the model wrote, and a session's prose can hold anything it was
// working on. Turn uuids and rule names are enough to reach the transcript, which is
// access-controlled where it already lives. Sessions are named by BASENAME — a full path carries the
// operator's home directory and the project layout.
//
// Every ratio is null rather than 0 when its denominator is absent, and an unparseable transcript
// reports `unknown` rather than a rate computed over a denominator nobody knows.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseTranscript, foldTurns, tokenSummary } from '../../bin/lib/turn-recorder-core.mjs';
import { assess } from '../../bin/lib/turn-gate-core.mjs';
import { transcriptDir } from '../../bin/lib/transcript-dir.mjs';

const MAX_SESSIONS = 50;

/** One transcript → aggregates, or a stated reason it could not be read. Never a silent skip. */
export function summarise(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    // ENOENT is absence; anything else is a broken reader. Reported apart so "no such session" and
    // "could not open it" cannot be confused, and neither reads as a clean session.
    return {
      session: basename(path, '.jsonl'),
      outcome: 'unknown',
      reason: e && e.code === 'ENOENT' ? 'transcript absent' : `transcript unreadable (${e?.code})`,
    };
  }
  const { steps, unparseable } = parseTranscript(text);
  const turns = foldTurns(steps);
  const g = assess({ turns, unparseable, steps: steps.length });
  const t = tokenSummary(turns);
  return {
    session: basename(path, '.jsonl'),
    outcome: g.outcome,
    reason: g.reason,
    vetoedBy: g.vetoedBy,
    // Rule name and verdict only. No evidence text crosses this boundary.
    rules: g.verdicts.map((v) => ({ rule: v.rule, verdict: v.verdict })),
    turns: t.turns,
    syntheticTurns: t.syntheticTurns,
    turnsWithoutTools: t.turnsWithoutTools,
    turnsWithoutUsage: t.turnsWithoutUsage,
    tokens: t.totals,
    ruminationShare: t.ruminationShare,
    cacheHitRatio: t.cacheHitRatio,
    outputPerTurn: t.outputPerTurn,
  };
}

/** Newest transcripts first. An unreadable directory is reported, never rendered as no sessions. */
export function listSessions(dir, limit) {
  let names;
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch (e) {
    return { ok: false, reason: e && e.code === 'ENOENT' ? 'absent' : `unreadable (${e?.code})` };
  }
  const withTime = names.map((f) => {
    const p = join(dir, f);
    let m = 0;
    try { m = statSync(p).mtimeMs; } catch { /* keep 0 — an unstattable file sorts last, not away */ }
    return { p, m };
  }).sort((a, b) => b.m - a.m);
  const n = Math.max(1, Math.min(Number(limit) || 10, MAX_SESSIONS));
  return { ok: true, files: withTime.slice(0, n).map((x) => x.p), total: withTime.length };
}

/**
 * Fleet totals, with their denominators attached.
 *
 * A rate whose denominator is not on the page is the false-measurement family's headline defect, so
 * every ratio here ships beside the counts it came from and is null — never 0 — when the denominator
 * is absent. `sessionsUnreadable` is reported separately from `sessions` so a fleet where half the
 * transcripts could not be opened cannot look like a small quiet fleet.
 */
export function fleetTotals(rows) {
  const readable = rows.filter((r) => r.tokens);
  const sum = (k) => readable.reduce((a, r) => (r.tokens[k] === null ? a : a + r.tokens[k]), 0);
  const anyKnown = (k) => readable.some((r) => r.tokens[k] !== null);
  const output = anyKnown('output') ? sum('output') : null;
  const cacheRead = anyKnown('cacheRead') ? sum('cacheRead') : null;
  const input = anyKnown('input') ? sum('input') : null;
  const cacheCreation = anyKnown('cacheCreation') ? sum('cacheCreation') : null;
  const charged = cacheRead === null && input === null && cacheCreation === null
    ? null : (cacheRead ?? 0) + (input ?? 0) + (cacheCreation ?? 0);
  const turns = readable.reduce((a, r) => a + (r.turns || 0), 0);
  const ratio = (num, den) => (num === null || den === null || den === 0 ? null : num / den);
  return {
    sessions: readable.length,
    sessionsUnreadable: rows.length - readable.length,
    turns,
    output,
    cacheHitRatio: ratio(cacheRead, charged),
    outputPerTurn: ratio(output, turns),
    blocked: rows.filter((r) => r.outcome === 'block').length,
    undetermined: rows.filter((r) => r.outcome === 'unknown').length,
  };
}

export const routes = [
  {
    method: 'GET',
    path: '/api/turns',
    handle: ({ send, query, isLoopbackReq }) => {
      if (!isLoopbackReq) {
        // 403 with the reason, not 404. Pretending the route does not exist would leave an operator
        // debugging a missing feature; the honest answer is that it exists and is deliberately local.
        return send(403, {
          ok: false,
          error: 'operator port only',
          detail: 'This reads the operator\'s own agent transcripts. Reduced to counts it is still a '
            + 'behavioural record of their working sessions, so it is served on loopback and never '
            + 'through the published tunnel. Auth would say who is asking, not where the answer may travel.',
        });
      }
      const dir = transcriptDir();
      const listed = listSessions(dir, query.get('limit'));
      if (!listed.ok) {
        return send(200, {
          ok: false,
          error: `transcript directory is ${listed.reason}`,
          detail: 'Reported rather than returned as an empty list — no sessions and none readable are different states. '
            + 'The directory is derived from this checkout\'s path; CW_TRANSCRIPT_DIR names it outright. The path is '
            + 'withheld here for the reason every other path on this route is.',
          sessions: null,
          totals: null,
        });
      }
      const sessions = listed.files.map(summarise);
      return send(200, {
        ok: true,
        note: 'Aggregates only; no session text crosses this boundary. A null ratio means the denominator was absent, never zero.',
        transcriptsAvailable: listed.total,
        shown: sessions.length,
        totals: fleetTotals(sessions),
        sessions,
      });
    },
  },
];
