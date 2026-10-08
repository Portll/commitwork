// Plans and agents use the upstream HTTP API. Window attribution uses a read-only SQLite fallback
// until the API exposes session ids. Failures remain explicit rather than looking like empty data.
// Resolve environment overrides at call time so tests and long-running processes can change them.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
// The SHARED redaction layer, never a second one: a rival redactor drifts from this one's ruleset.
import { redactForPublish } from '../../lib/publish-redactions.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spineStorePath } from '../../lib/spine-store-path.mjs';

/** The operator socket. Never the published one: POST verbs exist only on the operator listener. */
export const operatorBase = () => process.env.CW_SUBSTRATE_OPERATOR_URL || 'http://127.0.0.1:7980';
export { spineStorePath };

const TIMEOUT_MS = () => Number(process.env.CW_SUBSTRATE_TIMEOUT_MS || 6000);

/** Bounded GET against the operator socket, with timeout distinct from connection failure. */
export async function getJson(path, { fetchImpl = fetch, base = operatorBase() } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS());
  try {
    const res = await fetchImpl(`${base}${path}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, why: `overwatch layer answered HTTP ${res.status} for ${path}` };
    const body = await res.json();
    // A 200 carrying no usable payload is MALFORMED, not empty. Returning ok:true with []
    // here made a garbage-but-successful response render as "asked, and the fleet has nothing" —
    // the fail-closed rule broken by the one status code nobody thinks to check.
    // ?? IS THE TRAP HERE. `body.data ?? body` falls back to the whole envelope when data is
    // explicitly null, so the guard saw an object and passed — the check I wrote to catch a
    // malformed 200 was defeated by the exact case it existed for. Ask whether the KEY is present
    // before asking what it holds.
    const hasData = body != null && typeof body === "object" && "data" in body;
    const payload = hasData ? body.data : body;
    if (payload == null || typeof payload !== "object") {
      return { ok: false, why: `overwatch layer answered 200 for ${path} with no readable payload` };
    }
    // Preserve the envelope version so contract changes remain visible.
    return { ok: true, data: body.data ?? body, schemaVersion: body.schemaVersion ?? null, envelope: body };
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `overwatch layer did not answer ${path} within ${TIMEOUT_MS()}ms — slow, not necessarily down`
      : `overwatch layer unreachable at ${base}${path}: ${e && e.message ? e.message : 'error'}`;
    return { ok: false, why };
  } finally {
    clearTimeout(t);
  }
}

/** Plans and their task trees. Carries byProject and unattributed straight through — see below. */
export async function plans(opts = {}) {
  const r = await getJson('/api/v1/spine', opts);
  if (!r.ok) return r;
  const d = r.data || {};
  return {
    ok: true,
    schemaVersion: r.schemaVersion,
    store: d.store ?? null,
    plans: Array.isArray(d.plans) ? d.plans : [],
    // Unattributed plans are real work, not missing data.
    byProject: d.byProject ?? null,
    unattributed: d.unattributed ?? null,
    taskCount: d.taskCount ?? null,
  };
}

/** Dispatched agent sessions, the backend roster, and slot pressure. */
export async function agents(opts = {}) {
  const r = await getJson('/api/v1/agents', opts);
  if (!r.ok) return r;
  const d = r.data || {};
  return {
    ok: true,
    schemaVersion: r.schemaVersion,
    sessions: Array.isArray(d.sessions) ? d.sessions : [],
    backends: Array.isArray(d.backends) ? d.backends : [],
    slots: d.slots ?? null,
    operator: d.operator ?? null,
  };
}

/** Read sessions without creating the database; only a missing store is legitimate absence. */
export function sessionsFromStore({ path = spineStorePath(), all = false, status = null } = {}) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || /unable to open database|no such file/i.test(String(e.message)))) {
      return { ok: true, absent: true, sessions: [] };
    }
    return { ok: false, why: `spine store unreadable: ${e && e.message ? e.message : 'error'}` };
  }
  try {
    // THE FILTER BELONGS IN THE QUERY, NOT AFTER THE LIMIT. Filtering a 500-row window in JS looks
    // identical until the store outgrows the window: 500 newer CLOSED sessions would push every
    // active one out of the result, and the tab would report nobody working while the fleet ran.
    // The limit must apply to the population being asked about.
    // `status` takes a string OR a set, because the closed population is not one value. Measured:
    // completed 109, reaped 46, active 7. Sampling `completed` alone would drop every REAPED
    // session — and those are the ones that crashed or were swept, which is to say precisely the
    // ones least likely to have written a close record. Excluding them does not merely shrink the
    // sample, it biases it toward the sessions that behaved.
    const wanted = status == null ? null : (Array.isArray(status) ? status : [status]);
    const clause = wanted ? ` WHERE status IN (${wanted.map(() => '?').join(',')})`
      : (all ? '' : " WHERE status = 'active'");
    const stmt = db.prepare(
      `SELECT id, plan_id, owner, agent, status, label, started_at, ended_at, pid, last_seen, ids
       FROM sessions${clause} ORDER BY started_at DESC LIMIT 500`,
    );
    const rows = wanted ? stmt.all(...wanted) : stmt.all();
    return {
      ok: true,
      absent: false,
      sessions: rows.map((r) => ({
        id: r.id, planId: r.plan_id, owner: r.owner, agent: r.agent, status: r.status,
        label: r.label, startedAt: r.started_at, endedAt: r.ended_at, pid: r.pid, lastSeen: r.last_seen,
        // null means identity resolution never ran, not that it found nothing.
        ids: parseIds(r.ids),
      })),
    };
  } catch (e) {
    // An old store is degraded, not an empty fleet.
    if (/no such column: ids/i.test(String(e.message))) {
      return { ok: false, why: 'this spine store predates the ids column — restart the overwatch layer to migrate it' };
    }
    return { ok: false, why: `spine query failed: ${e && e.message ? e.message : 'error'}` };
  } finally {
    try { db.close(); } catch { /* already gone */ }
  }
}

/**
 * The approval a session is currently parked on, or null.
 *
 * WHY THIS IS READ FROM THE EVENT LOG. The session list reports `status: "awaiting_approval"` and
 * nothing else — no requestId, no tool name. A verdict cannot be delivered without the requestId,
 * so a panel built on the session list alone can show that a session is blocked and offer no way to
 * unblock it: the approval path exists end to end and is unreachable from the surface that displays
 * it. That is the same defect as an unrun lane rendered clean, one layer in.
 *
 * The runner appends `approval_request` / `approval_resolved` to a per-session ndjson. Reading it is
 * a file read of a store this panel does not own, so it is read-only and ENOENT-tolerant. The right
 * long-term fix is for the runner's session payload to carry its own pending approvals; until then
 * this derives them rather than leaving the buttons undrawable.
 */
export function pendingApproval(sessionId, { dir = agentsDir() } = {}) {
  // The id is interpolated into a PATH, so it is shape-checked here and not only at the route.
  // Today it arrives from the upstream session list and the mutation routes already require a
  // uuid — but a reader that builds a path from a value it did not validate is one upstream bug
  // away from reading any .ndjson on the box. Defence in depth costs one regex.
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return null;
  let txt;
  try { txt = readFileSync(join(dir, `${sessionId}.ndjson`), 'utf8'); }
  catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.code || 'error' }; }
  const open = new Map();
  for (const line of txt.split('\n')) {
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }   // a torn line is skipped, never fatal
    if (ev.kind === 'approval_request' && ev.requestId) {
      open.set(ev.requestId, {
        requestId: ev.requestId,
        toolName: ev.toolName ?? null,
        displayName: ev.displayName ?? null,
        // The CLI's own suggestions ride along, but a `setMode` suggestion must never become a
        // one-click in a panel: next to "allow" it would offer a control that escalates the WHOLE
        // session to accept every later edit. Carried as data, rendered as text.
        suggestions: Array.isArray(ev.suggestions) ? ev.suggestions : null,
        at: ev.ts ?? null,
      });
    }
    if (ev.kind === 'approval_resolved' && ev.requestId) open.delete(ev.requestId);
  }
  const rows = [...open.values()];
  return rows.length ? rows[rows.length - 1] : null;
}

export const agentsDir = () => process.env.CW_AGENTS_DIR || join(homedir(), '.substrate', 'agents');

/**
 * Derived readiness for a runner backend. NEVER claims a local port is up: the upstream roster
 * refuses to probe one on render, and repeating that refusal here is the point — an unprobed
 * "ready" is unsupported finding.
 */
export function backendState(b) {
  if (!b || typeof b !== 'object') return 'unknown';   // an absent row is not a declared one
  if (b.why) return 'not-ready';
  return b && b.kind === 'local' ? 'declared-unprobed' : 'declared';
}

/**
 * The plan the runner files its own dispatches under. Upstream's constant, mirrored here.
 */
export const RUNNER_PLAN_ID = 'runner';

/**
 * Separate real work from the tab's own exhaust.
 *
 * THE RUNNER CLAIMS A SPINE TASK BEFORE IT SPAWNS — correctly, so a session can never exist that
 * the spine cannot name. The side effect is that every dispatch mints a task, and they land in a
 * cwd-less `runner` plan carrying no project slug. This tab reads the spine and offers a start
 * button, so left alone it would render its own dispatch residue as work to be done, and offer to
 * dispatch it, which mints more. Measured 2026-09-02: the runner plan held 6 tasks, 4 of them
 * created by this feature's own verification probes an hour earlier.
 *
 * IT IS SEPARATED, NOT HIDDEN. Dropping the rows would be the same defect in the other direction —
 * those dispatches happened, and a reader looking for one needs to find it. It gets its own bucket
 * with its own count and a stated reason, outside the work totals.
 *
 * The better fix is upstream: file a dispatch under the plan whose task it was, so the residue is
 * never minted. That is a change to the runner's claim path, which a peer session has open.
 */
export function partitionPlans(plans, { residuePlanId = RUNNER_PLAN_ID } = {}) {
  const work = [];
  const residue = [];
  for (const p of (plans || [])) (p && p.id === residuePlanId ? residue : work).push(p);
  return {
    work,
    residue,
    residueTasks: residue.reduce((n, p) => n + ((p.tasks || []).length), 0),
  };
}

/**
 * Project plans for the surface that asked.
 *
 * TASK GOALS ARE PROSE, AND IN THIS FLEET PROSE QUOTES EVIDENCE. A goal is written by whoever filed
 * the work and routinely names the thing it is about — a finding, a path, a credential class. This
 * panel answers on three public hostnames, so emitting goals verbatim publishes whatever the fleet
 * happened to write into them. Measured while building this: a live task goal in the store reads
 * "allowlist projection for the IDE lockfile (it carries a live authToken)". That one is harmless
 * prose. The next one need not be.
 *
 * `redactForPublish` is NOT sufficient on its own and is not used as though it were: it maps
 * declared product names to their public aliases, which does nothing about a goal that quotes a
 * secret. So the rule is structural rather than pattern-based — OFF THE OPERATOR PORT, CONTENT IS
 * NOT EMITTED AT ALL. Ids, statuses, counts and structure travel; goal, result and notes do not.
 * The published surface declares what exists; the operator surface carries what it says.
 *
 * `redacted: true` rides on every projected row, so a reader can never mistake "this task has no
 * goal" for "the goal was withheld from this surface".
 */
export function projectPlans(plans, { full }) {
  if (full) return plans;
  return (plans || []).map((p) => ({
    ...p,
    name: typeof p.name === 'string' ? redactForPublish(p.name) : p.name,
    tasks: (p.tasks || []).map((t) => {
      const { goal, result, notes, abandon_reason: ar, state, ...rest } = t;
      return { ...rest, redacted: true };
    }),
  }));
}

/** Mirror of the spine's own parseIds: null is UNKNOWN, bad JSON is its own state, never {}. */
export function parseIds(raw) {
  if (raw == null) return null;
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : { unreadable: 'ids column is not an object' };
  } catch { return { unreadable: 'ids column is not valid JSON' }; }
}

/** Group sessions as bound, unattributed (resolved without a window), or unknown (not resolved). */
export function byWindow(sessions) {
  // Null-tolerant like every other helper in this file. It threw where the rest returned empty,
  // which is the kind of inconsistency the next caller discovers in production.
  if (!Array.isArray(sessions)) sessions = [];
  const windows = new Map();
  const out = { windows: [], unattributed: [], unknown: [], degraded: [] };
  for (const s of sessions) {
    if (s.ids == null) { out.unknown.push(s); continue; }
    // RESOLUTION FAILED is a fourth state, and folding it into `unattributed` was a real defect in
    // the first cut of this function. `unattributed` renders as "asked, and no window was found",
    // which is a claim about the SESSION. A degrade marker means the instrument did not work — the
    // process table was unreadable, or the ids blob would not parse — which is a claim about the
    // READING. Reporting an instrument failure as a finding about the subject is the same error
    // this tab refuses everywhere else, one level in.
    if (s.ids.unresolved || s.ids.degraded || s.ids.unreadable) {
      out.degraded.push({ ...s, why: s.ids.unresolved || s.ids.degraded || s.ids.unreadable });
      continue;
    }
    const port = s.ids.idePort ?? null;
    const ws = s.ids.workspace ?? null;
    if (port == null && ws == null) { out.unattributed.push(s); continue; }
    const key = `${port ?? 'no-port'}|${ws ?? 'no-workspace'}`;
    if (!windows.has(key)) {
      windows.set(key, {
        idePort: port, workspace: ws, vscodePid: s.ids.vscodePid ?? null,
        // Keep the attribution method so callers can judge confidence.
        how: (s.ids.how || {}).idePort ?? null,
        sessions: [],
      });
    }
    windows.get(key).sessions.push(s);
  }
  out.windows = [...windows.values()];
  return out;
}
