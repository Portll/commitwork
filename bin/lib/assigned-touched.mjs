// bin/lib/assigned-touched.mjs — the assigned set and the touched set for turn-gate.
//
// The one comparison narrative cannot dress up: what was assigned, what was advanced, what is
// covered by a blocker that names it. It is the only turn-gate rule fed from outside the
// transcript — it reads two ledgers and ignores the words entirely.
//
// Every reader here returns `undefined` for UNREADABLE and `null` for LEGITIMATELY ABSENT. The
// rule treats the first as grey and the second as not-applicable, and collapsing them is the false
// clean it exists to catch: an empty assigned set reads as "nothing was assigned".
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// node:sqlite is core from node 22, imported behind a try so an older runtime degrades to grey
// rather than taking the gate down. Same posture as bin/gate-spine.mjs.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* reported as unreadable */ }

/** Read at CALL time so a test can point it at a fixture (house rule). */
export const tasksDb = () => process.env.SPINE_TASKS_DB || process.env.SUBSTRATE_TASKS_DB || join(homedir(), '.spine', 'tasks.db');

/** Statuses that mean the item is no longer owed. */
const SETTLED = new Set(['done', 'complete', 'completed', 'abandoned', 'cancelled', 'canceled']);

/**
 * The plan and start time for a session, by either id namespace.
 *
 * `since` comes from the ROW, not from the hook payload. The Stop payload carries session_id,
 * transcript_path and cwd — no start time — so a rule that took `since` from there was grey on
 * every real invocation while looking wired.
 *
 * @returns {{planId:string|null, startedAt:string|null}|null|undefined} null = no such session
 */
export function sessionFacts(sessionId, { db } = {}) {
  if (!sessionId) return null;
  const handle = db ?? openDb();
  if (!handle) return undefined;
  try {
    const direct = handle.prepare('select plan_id, started_at from sessions where id = ?').get(sessionId);
    const row = direct || (/^[0-9a-fA-F-]{8,}$/.test(sessionId)
      ? handle.prepare("select plan_id, started_at from sessions where ids like ? order by (status = 'active') desc, started_at desc limit 1").get(`%"${sessionId}"%`)
      : null);
    return row ? { planId: row.plan_id ?? null, startedAt: row.started_at ?? null } : null;
  } catch { return undefined; }
  finally { if (!db) try { handle.close(); } catch { /* already closed */ } }
}

export function planForSession(sessionId, { db } = {}) {
  if (!sessionId) return null;
  const handle = db ?? openDb();
  if (!handle) return undefined;
  try {
    const row = handle.prepare('select plan_id from sessions where id = ?').get(sessionId);
    if (row) return row.plan_id ?? null;

    // TWO NAMESPACES, AND THE HOOK SPEAKS THE OTHER ONE. substrate mints `s-<uuid>` for its own
    // session rows; the Stop payload carries Claude's session id, which is the TRANSCRIPT uuid.
    // They never collide, so the direct lookup above returns nothing for every real hook
    // invocation — and "no such session" reads as `null`, i.e. "no plan, nothing to compare",
    // which is a clean-looking ABSENT rather than a grey. Gate A would have been permanently
    // decorative and reported itself satisfied. The transcript id is on the row, in `ids`.
    //
    // Matched with LIKE, so the needle is restricted to id characters first: a payload value
    // containing % or _ would otherwise be a wildcard and could match an unrelated session's plan.
    if (!/^[0-9a-fA-F-]{8,}$/.test(sessionId)) return null;
    const alt = handle.prepare(
      "select plan_id from sessions where ids like ? order by (status = 'active') desc, started_at desc limit 1",
    ).get(`%"${sessionId}"%`);
    return alt ? (alt.plan_id ?? null) : null;
  } catch { return undefined; }
  finally { if (!db) try { handle.close(); } catch { /* already closed */ } }
}

function openDb() {
  const path = tasksDb();
  if (!existsSync(path) || !DatabaseSync) return null;
  try { return new DatabaseSync(path, { readOnly: true }); } catch { return null; }
}

/**
 * Assigned and touched, for one plan.
 *
 * ASSIGNED is every unsettled task on the plan. TOUCHED is every task that moved since the session
 * started — status off `pending`, a result written, or `updated_at` later than `since`. A task whose
 * row was never rewritten was never advanced, whatever the closing message says about it.
 *
 * `since` is required and must be an ISO string: without it every task ever updated counts as
 * touched this session, which turns the gate into a rubber stamp. A missing `since` is UNREADABLE.
 *
 * @returns {{assigned:Array<{id,goal}>, touched:Array<string>}|null|undefined}
 *          null = no plan / no tasks · undefined = UNREADABLE
 */
export function assignedTouched(planId, since, { db } = {}) {
  if (!planId) return null;
  if (typeof since !== 'string' || !since) return undefined;
  const handle = db ?? openDb();
  if (!handle) return undefined;
  try {
    const rows = handle.prepare(
      'select id, goal, status, result, updated_at from tasks where plan_id = ?',
    ).all(planId);
    if (!rows.length) return null;

    const assigned = [];
    const touched = [];
    for (const r of rows) {
      const status = String(r.status ?? '').toLowerCase();
      const settled = SETTLED.has(status);
      if (!settled) assigned.push({ id: String(r.id), goal: r.goal ?? '' });
      const moved = settled
        || (status !== '' && status !== 'pending')
        || (r.result != null && String(r.result).trim() !== '')
        || (typeof r.updated_at === 'string' && r.updated_at > since);
      if (moved) touched.push(String(r.id));
    }
    return { assigned, touched };
  } catch { return undefined; }
  finally { if (!db) try { handle.close(); } catch { /* already closed */ } }
}

/**
 * Blockers a closing message declares, with the task ids each one NAMES.
 *
 * A blocker covers the items it names and no others. Three sessions cited a real blocker over a
 * contended file and stranded items that shared none of it — "the stop was dressed in a correct
 * technical fact". So a blocker sentence that names no task id covers nothing, deliberately: an
 * unattributed blocker is exactly the shape that launders a stop.
 */
export function declaredBlockers(message, assignedIds = []) {
  if (typeof message !== 'string' || !message) return [];
  const ids = new Set(assignedIds.map(String));
  const out = [];
  const re = /^[^\n]*\b(blocked|blocker|held by|contended|waiting on|needs? (?:your|operator|a decision)|cannot proceed)\b[^\n]*$/gim;
  for (const m of message.matchAll(re)) {
    const line = m[0];
    const covers = [];
    for (const tok of line.matchAll(/\b(?:task|item)\s*#?([0-9]+(?:\.[0-9]+)*)\b/gi)) {
      if (ids.has(tok[1])) covers.push(tok[1]);
    }
    if (covers.length) out.push({ covers, statement: line.trim().slice(0, 200) });
  }
  return out;
}
