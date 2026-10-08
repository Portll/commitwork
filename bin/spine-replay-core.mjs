// bin/spine-replay-core.mjs — the DECISIONS, with no I/O. bin/spine-replay.mjs does the reading.
//
// WHAT THIS IS. bin/spine-reconcile.mjs established that the attribution ledger names 76 plans and
// the spine store holds one, and deliberately stopped at naming the observation. This module takes
// the next step and only the next step: it turns the surviving ledger rows into plan/task SKELETONS
// that can be re-filed, so the ids, the sequence and the clock survive even though the work's own
// words did not.
//
// WHAT THE LEDGER CAN AND CANNOT ANSWER — the whole design sits on this line.
// bin/spine-ledger.mjs records `{s, r, kind, plan, task, at}` and nothing else, on purpose: content
// in an attribution ledger becomes queryable, so no goal, result or note was ever written there.
// Therefore:
//   RECOVERABLE   plan ids, task ids, which call kinds fired against each id and how many times,
//                 first/last timestamp, the session ids that filed them.
//   NOT           goals, results, notes — and, measured rather than assumed, TWO more that the
//                 brief for this tool expected to get for free:
//     · STATUS. A `set_status` row records that a status was set, never to WHAT. 443 of 1,452 rows
//       are set_status and not one of them carries the value. Every reconstructed task is therefore
//       filed at the schema's own default, and that default is a placeholder, not a finding.
//     · WORKING TREE. `r` was added to the writer later: 1,441 of 1,452 rows carry no tree id at
//       all. The field is recoverable for 11 rows (0.8%) and unknown for the rest, and even then it
//       is a sha256 prefix of a path, not a path. It is reported verbatim and never resolved.
//
// SO: NEVER FABRICATE A GOAL. The placeholder text below says the original is unrecoverable and
// cites the row count, the timestamp span and the session ids that produced them — nothing else. A
// plausible-looking reconstructed goal would be strictly worse than an empty one, because a reader
// six months from now has no way to falsify it: the ledger it would have to be checked against is
// exactly the thing that does not contain goals.
//
// WHAT IS NOT PROPOSED AT ALL. 281 rows name a plan and no task, because the MCP response the hook
// read had no readable id (they carry `shape` — the response's KEY names, never values — so a shape
// change announces itself). Those filings happened to a task that exists and cannot be named. They
// are COUNTED per plan and never filed: minting an id for them would invent a task, and a minted id
// is a per-run key, so every re-run would insert a fresh one and idempotency would be gone.
//
// IDENTITY AND IDEMPOTENCY. Identity is the plan id, and for a task the pair (plan id, task id), as
// the ledger recorded them — never a row number, never a per-run counter. Everything downstream
// follows from that: the fold below is keyed on those ids, the proposal list is a function of the
// ledger alone, and the applier inserts only what is absent and never updates. Running twice is
// running once. A REAL record already in the store is never overwritten by a skeleton.
//
// GREY IS NEITHER GREEN NOR RED. An unreadable ledger is not an empty one and yields no proposals
// at all; a ledger naming no plans reports as "nothing to replay", which is not a clean result; and
// a skipped line makes the whole reconstruction PARTIAL by an unknown amount, because the line that
// failed to parse may be the only one that ever named some plan.

// One definition of "a ledger row's plan id", shared with the reconciler rather than re-stated
// here — the two tools must not be able to disagree about which rows are about which plan.
import { planOf } from './spine-reconcile-core.mjs';

/** The verdicts. */
export const LEDGER_UNREADABLE = 'ledger-unreadable';  // grey: NOT an empty ledger
export const NOTHING_TO_REPLAY = 'nothing-to-replay';  // grey: readable, names no plans
export const NOTHING_MISSING = 'nothing-missing';      // every id the ledger names is already filed
export const PROPOSED = 'proposals';                   // skeletons that would be filed

// The store's own vocabulary, read from substrate's spine/db.mjs (STATUSES) and the live schema
// rather than assumed. tasks.status has no CHECK constraint — it is enforced in setStatus(), which
// throws on anything outside this list, so an invented value like 'unknown' would be rejected by
// every writer and skipped by counts() that iterate the list. There is no member meaning "not
// known", which is the honest state here; see RECONSTRUCTED_TASK_STATUS.
export const TASK_STATUSES = ['pending', 'active', 'completed', 'abandoned'];

// A skeleton task is filed at the column default. This is the one value in the whole tool that the
// ledger does not evidence, and it is chosen as the least-claiming member of a closed vocabulary
// that has no member for "unrecoverable": 'completed' would assert work that may never have
// happened, 'abandoned' asserts a dead end AND requires an abandon_reason nobody wrote. 'pending'
// still over-claims in the other direction for any task that finished, so it is never left to
// speak for itself — every skeleton says in its goal text that status was not recovered.
export const RECONSTRUCTED_TASK_STATUS = 'pending';

// Plans are filed 'archived', not 'active'. listPlans() defaults to status='active', so filing 75
// historical plans as active would push a decade of finished work into every "what am I doing"
// view at once. 'archived' is a real value (archivePlan writes it) and it is the true one: these
// are records of work, not live work.
export const RECONSTRUCTED_PLAN_STATUS = 'archived';

/** A ledger row's task id as a string, or null. Numbers are coerced; anything else is not an id. */
export const taskOf = (r) => {
  const t = r ? r.task : null;
  if (typeof t === 'string' && t) return t;
  if (typeof t === 'number' && Number.isFinite(t)) return String(t);
  return null;
};

/** Epoch ms for a row's clock, or null. */
const atOf = (r) => {
  const t = r && typeof r.at === 'string' ? Date.parse(r.at) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Composite task identity. Keyed on ids, never on position. */
export const taskKey = (plan, task) => `${plan}\u0000${task}`;

// Code-unit order, not localeCompare: determinism here means byte-identical output on any box, and
// localeCompare's answer depends on ICU data and the ambient locale.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Task addresses are dotted trees ("1", "1.2", "1.10"), so lexicographic order puts 10 before 2.
 * Compare segment-wise, numerically where both segments are numeric and by code unit otherwise.
 * Total and deterministic either way.
 */
export function compareTaskIds(a, b) {
  const A = String(a).split('.');
  const B = String(b).split('.');
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    if (A[i] === undefined) return -1;
    if (B[i] === undefined) return 1;
    const na = /^\d+$/.test(A[i]) ? Number(A[i]) : null;
    const nb = /^\d+$/.test(B[i]) ? Number(B[i]) : null;
    if (na !== null && nb !== null) { if (na !== nb) return na - nb; continue; }
    const c = byCodeUnit(A[i], B[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/** "1.2.3" → "1.2"; a root address has no parent. The store derives parent_id the same way. */
export const parentOf = (id) => {
  const i = String(id).lastIndexOf('.');
  return i < 0 ? null : String(id).slice(0, i);
};

const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
const day = (s) => (typeof s === 'string' ? s.slice(0, 10) : '?');

/** A fresh evidence accumulator. Every field is a count, an id or a timestamp — never content. */
const emptyEvidence = () => ({
  rows: 0,
  first: null,
  last: null,
  sessions: new Set(),
  kinds: {},
  viaRows: 0,
  trees: {},
});

function absorb(e, r) {
  e.rows += 1;
  const t = atOf(r);
  if (t !== null) {
    if (e.first === null || t < e.first) e.first = t;
    if (e.last === null || t > e.last) e.last = t;
  }
  if (typeof r.s === 'string' && r.s) e.sessions.add(r.s);
  const k = typeof r.kind === 'string' && r.kind ? r.kind : 'unknown-kind';
  e.kinds[k] = (e.kinds[k] || 0) + 1;
  // `via` marks a row filed by a bypass path (spine/db.mjs direct) rather than the MCP tool. It is
  // NOT equivalent evidence: it was written by a different code path than the one the hook was
  // built around, so it is counted separately and surfaced, never folded into the total silently.
  if (r.via !== undefined && r.via !== null) e.viaRows += 1;
  const tree = typeof r.r === 'string' && r.r ? r.r : 'unknown';
  e.trees[tree] = (e.trees[tree] || 0) + 1;
}

/** Freeze an accumulator into a plain, deterministically-ordered record. */
const seal = (e) => ({
  rows: e.rows,
  first: iso(e.first),
  last: iso(e.last),
  sessions: [...e.sessions].sort(byCodeUnit),
  kinds: Object.fromEntries(Object.keys(e.kinds).sort(byCodeUnit).map((k) => [k, e.kinds[k]])),
  viaRows: e.viaRows,
  trees: Object.fromEntries(Object.keys(e.trees).sort(byCodeUnit).map((k) => [k, e.trees[k]])),
});

/** Sessions, capped so a goal string stays readable. Deterministic: sorted, then the head. */
function sessionList(sessions, cap = 3) {
  if (sessions.length <= cap) return sessions.join(', ');
  return `${sessions.slice(0, cap).join(', ')} +${sessions.length - cap} more`;
}

const kindSummary = (kinds) => Object.entries(kinds).map(([k, n]) => `${k}×${n}`).join(' ');

/**
 * The placeholder goal. It says the original is gone and cites only what the ledger holds.
 *
 * Read the assertions: unrecoverable, then counts, then ids, then timestamps. There is no sentence
 * here that a reader could mistake for the task's own words, and nothing in it was inferred.
 */
export function reconstructedGoal(ev, { plan, task }) {
  const parts = [
    '[RECONSTRUCTED SKELETON — ORIGINAL GOAL UNRECOVERABLE]',
    `No goal text for ${plan}/${task} survives anywhere on this box.`,
    'The attribution ledger (.claude/store/spine-touches.jsonl) records ids only, by design —'
    + ' it never held a goal, result or note to lose.',
    `Ledger evidence: ${ev.rows} row(s) [${kindSummary(ev.kinds)}]`,
    ev.first === ev.last ? `at ${ev.first};` : `from ${ev.first} to ${ev.last};`,
    `session(s) ${sessionList(ev.sessions) || 'none recorded'}.`,
    // Two different unknowns, kept apart. "A status was set and the value is gone" and "no status
    // change was ever witnessed" are not the same sentence, and printing the first over the second
    // would put a set_status row into the record that the ledger does not contain.
    (ev.kinds.set_status
      ? `STATUS WAS NOT RECOVERED: the ledger records that a status was set ${ev.kinds.set_status} time(s), never to what;`
      : 'STATUS IS UNKNOWN: no set_status row names this task, so whether its status ever changed was never recorded;')
    + ` this task is filed at the schema default '${RECONSTRUCTED_TASK_STATUS}', which is a`
    + ' placeholder and not a claim that the work is outstanding.',
  ];
  if (ev.viaRows) {
    parts.push(`${ev.viaRows} of these row(s) were filed by a bypass path (\`via\`: direct spine/db.mjs,`
      + ' not the MCP tool) and are not equivalent evidence.');
  }
  return parts.join(' ');
}

/**
 * The plan name. plans has no notes/state column — id, name, cwd, project, status, created_at,
 * updated_at and nothing else — so `name` is the ONLY place a mark can ride along with the record
 * itself. It therefore carries the mark and the smallest citation that fits; the full evidence
 * lives in this tool's JSON output.
 */
export function reconstructedPlanName(ev, { plan, createdAtWitnessed }) {
  const span = ev.first === null ? 'no timestamps'
    : (day(ev.first) === day(ev.last) ? day(ev.first) : `${day(ev.first)}..${day(ev.last)}`);
  const witness = createdAtWitnessed ? '' : '; creation not witnessed';
  return `${plan} [RECONSTRUCTED — original unrecoverable; ${ev.rows} ledger row(s) ${span}${witness}]`;
}

/**
 * Fold ledger rows into proposed plan/task skeletons.
 *
 * Pure: every input is already-read data — no fs, no env, no clock. `now` is passed in by the
 * caller (which honours CW_NOW) and is used ONLY to stamp the report; not one field of a proposed
 * record comes from a clock, so re-running tomorrow proposes byte-identical records.
 *
 * @param ledgerRows      {Array|null} parsed rows; null = UNREADABLE, which is not empty
 * @param ledgerSkipped   {number}     unparseable lines, counted by the caller
 * @param existingPlanIds {Array|null} plan ids already in the target; null = unknown
 * @param existingTasks   {Array|null} [{plan_id, id}] already in the target; null = unknown
 * @param planFilter      {string|null} restrict to one plan id
 * @param now             {string|null} report stamp only
 */
export function replay({
  ledgerRows,
  ledgerSkipped = 0,
  existingPlanIds = null,
  existingTasks = null,
  planFilter = null,
  now = null,
} = {}) {
  const base = {
    generatedAt: now,
    ledgerSkipped,
    // A skipped line may be the only row that ever named some plan, so the reconstruction is
    // incomplete by an amount nobody can measure. Say so rather than reporting a total.
    partial: ledgerSkipped > 0,
    planFilter,
    counts: {
      ledgerRows: 0,
      rowsWithoutPlan: 0,
      unnamedTaskRows: 0,
      viaRows: 0,
      plansNamed: 0,
      tasksNamed: 0,
      plansProposed: 0,
      tasksProposed: 0,
      plansPreexisting: 0,
      tasksPreexisting: 0,
    },
    plans: [],
    tasks: [],
  };

  if (!Array.isArray(ledgerRows)) {
    return {
      ...base,
      verdict: LEDGER_UNREADABLE,
      grey: true,
      detail: 'the spine ledger could not be read, so what was filed is UNKNOWN — not "nothing". '
        + 'No skeletons are proposed: reconstructing from a ledger you failed to read would file '
        + 'whatever fragment happened to be legible and call it the history.',
      counts: { ...base.counts, ledgerRows: null },
    };
  }

  const heldPlans = Array.isArray(existingPlanIds) ? new Set(existingPlanIds.map(String)) : null;
  const heldTasks = Array.isArray(existingTasks)
    ? new Set(existingTasks.map((t) => taskKey(String(t.plan_id ?? t.plan), String(t.id ?? t.task))))
    : null;

  const planEv = new Map();      // plan id -> evidence
  const taskEv = new Map();      // taskKey -> { plan, task, ev }
  const unnamed = new Map();     // plan id -> { kind: n } for filings whose subject id was never recorded
  let rowsWithoutPlan = 0;
  let ledgerRowCount = 0;
  let viaRows = 0;

  for (const r of ledgerRows) {
    ledgerRowCount += 1;
    const plan = planOf(r);
    if (!plan) { rowsWithoutPlan += 1; continue; }   // counted, never silently dropped
    if (planFilter && plan !== planFilter) continue;
    if (r && r.via !== undefined && r.via !== null) viaRows += 1;

    let pe = planEv.get(plan);
    if (!pe) { pe = emptyEvidence(); planEv.set(plan, pe); }
    absorb(pe, r);

    const task = taskOf(r);
    if (task === null) {
      // create_plan legitimately has no task. Any OTHER kind with no task is a filing against a
      // task that exists and cannot be named — recorded as a gap, never as a proposal.
      if (r.kind !== 'create_plan') {
        const u = unnamed.get(plan) || {};
        const k = typeof r.kind === 'string' && r.kind ? r.kind : 'unknown-kind';
        u[k] = (u[k] || 0) + 1;
        unnamed.set(plan, u);
      }
      continue;
    }
    const key = taskKey(plan, task);
    let te = taskEv.get(key);
    if (!te) { te = { plan, task, ev: emptyEvidence() }; taskEv.set(key, te); }
    absorb(te.ev, r);
  }

  // ── PROPOSALS ─────────────────────────────────────────────────────────────────────────────────
  const plans = [];
  for (const [plan, acc] of planEv) {
    const ev = seal(acc);
    const createdAtWitnessed = (ev.kinds.create_plan || 0) > 0;
    const u = unnamed.get(plan) || {};
    const unnamedTotal = Object.values(u).reduce((a, b) => a + b, 0);
    const preexisting = heldPlans === null ? null : heldPlans.has(plan);
    plans.push({
      table: 'plans',
      id: plan,
      // Every column the live schema declares, named explicitly. cwd/project are null because the
      // ledger never recorded either — a plausible guess from the tree hash would be an invention.
      record: {
        id: plan,
        name: reconstructedPlanName(ev, { plan, createdAtWitnessed }),
        cwd: null,
        project: null,
        status: RECONSTRUCTED_PLAN_STATUS,
        created_at: ev.first,
        updated_at: ev.last,
      },
      preexisting,
      // created_at is the first row that MENTIONS the plan. With no create_plan row it is a lower
      // bound on creation, not creation. 12 of 76 plans measured are in exactly that state.
      createdAtWitnessed,
      unrecoverable: {
        goal: 'plans carry no goal column; the plan\'s purpose was never in the ledger',
        cwd: true,
        project: true,
        status: true,
      },
      unnamedTaskFilings: Object.keys(u).sort(byCodeUnit).map((k) => ({ kind: k, rows: u[k] })),
      unnamedTaskRows: unnamedTotal,
      evidence: ev,
    });
  }
  plans.sort((a, b) => byCodeUnit(a.id, b.id));

  const tasks = [];
  const namedByPlan = new Map();
  for (const { plan, task } of taskEv.values()) {
    let s = namedByPlan.get(plan);
    if (!s) { s = new Set(); namedByPlan.set(plan, s); }
    s.add(task);
  }
  for (const { plan, task, ev: acc } of taskEv.values()) {
    const ev = seal(acc);
    const parent = parentOf(task);
    const preexisting = heldTasks === null ? null : heldTasks.has(taskKey(plan, task));
    tasks.push({
      table: 'tasks',
      plan_id: plan,
      id: task,
      record: {
        id: task,
        plan_id: plan,
        // parent_id is a denormalisation OF THE ID, which is why deriving it is not an inference:
        // "24.6" names its own parent. Whether that parent was ever filed is a separate fact —
        // parentPresent below — and inventing the missing ancestor would be a fabricated task.
        parent_id: parent,
        goal: reconstructedGoal(ev, { plan, task }),
        status: RECONSTRUCTED_TASK_STATUS,
        state: JSON.stringify({
          reconstructed: {
            by: 'bin/spine-replay.mjs',
            source: 'spine attribution ledger (ids only)',
            rows: ev.rows,
            kinds: ev.kinds,
            first: ev.first,
            last: ev.last,
            sessions: ev.sessions,
            trees: ev.trees,
            viaRows: ev.viaRows,
            statusRecovered: false,
            resultRecovered: false,
            notesRecovered: false,
          },
        }),
        depends_on: '[]',
        created_at: ev.first,
        updated_at: ev.last,
      },
      preexisting,
      parentPresent: parent === null ? null : (namedByPlan.get(plan) || new Set()).has(parent),
      unrecoverable: { goal: true, status: true, result: true, notes: true, depends_on: true },
      evidence: ev,
    });
  }
  tasks.sort((a, b) => byCodeUnit(a.plan_id, b.plan_id) || compareTaskIds(a.id, b.id));

  const plansProposed = plans.filter((p) => p.preexisting !== true).length;
  const tasksProposed = tasks.filter((t) => t.preexisting !== true).length;
  const counts = {
    ledgerRows: ledgerRowCount,
    rowsWithoutPlan,
    unnamedTaskRows: [...unnamed.values()].reduce((a, u) => a + Object.values(u).reduce((x, y) => x + y, 0), 0),
    viaRows,
    plansNamed: plans.length,
    tasksNamed: tasks.length,
    plansProposed,
    tasksProposed,
    plansPreexisting: plans.filter((p) => p.preexisting === true).length,
    tasksPreexisting: tasks.filter((t) => t.preexisting === true).length,
  };

  if (plans.length === 0) {
    return {
      ...base,
      verdict: NOTHING_TO_REPLAY,
      grey: true,
      detail: ledgerSkipped > 0
        ? `the ledger's readable rows name no plans, and ${ledgerSkipped} line(s) did not parse — `
          + 'so this is "nothing legible to replay", which is not the same as "nothing was filed".'
        : 'the ledger names no plans, so there is nothing to reconstruct — this is not a clean result.',
      counts, plans, tasks,
    };
  }

  if (plansProposed === 0 && tasksProposed === 0) {
    return {
      ...base,
      verdict: NOTHING_MISSING,
      grey: false,
      detail: `every one of the ${plans.length} plan(s) and ${tasks.length} task(s) the ledger names `
        + 'is already filed in the target. Nothing would be written.',
      counts, plans, tasks,
    };
  }

  return {
    ...base,
    verdict: PROPOSED,
    grey: false,
    detail: `${plansProposed} plan(s) and ${tasksProposed} task(s) the ledger names are absent from `
      + 'the target and would be filed as SKELETONS: ids, sequence and clock only. No goal, result, '
      + 'note or status is restored, because none was ever recorded.',
    counts, plans, tasks,
  };
}

/** One line per verdict, for a human. Never collapses grey into either direction. */
export function summarise(r) {
  if (r.verdict === LEDGER_UNREADABLE) return 'spine ledger unreadable — UNKNOWN, not an empty ledger';
  if (r.verdict === NOTHING_TO_REPLAY) return 'ledger names no plans — nothing to replay (not a clean result)';
  if (r.verdict === NOTHING_MISSING) {
    return `nothing missing: ${r.counts.plansNamed} plan(s), ${r.counts.tasksNamed} task(s), all present`;
  }
  return `${r.counts.plansProposed} plan skeleton(s) + ${r.counts.tasksProposed} task skeleton(s) would be filed`
    + `${r.partial ? ` (PARTIAL — ${r.ledgerSkipped} unparseable line(s))` : ''}`;
}

/** SQLite string literal. Single quotes doubled; null is the keyword, never the four letters. */
export const sqlLit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/**
 * The INSERT statements a human could review and run themselves — declaration split from authority.
 *
 * `INSERT OR IGNORE`, never `INSERT OR REPLACE`: the primary key is the record's identity, so a
 * second run is a no-op and a real record that already exists is never overwritten by a skeleton.
 */
export function toSql(result) {
  const out = [];
  for (const p of result.plans) {
    if (p.preexisting === true) continue;
    const r = p.record;
    out.push('INSERT OR IGNORE INTO plans (id,name,cwd,project,status,created_at,updated_at) VALUES ('
      + [r.id, r.name, r.cwd, r.project, r.status, r.created_at, r.updated_at].map(sqlLit).join(',') + ');');
  }
  for (const t of result.tasks) {
    if (t.preexisting === true) continue;
    const r = t.record;
    out.push('INSERT OR IGNORE INTO tasks (id,plan_id,parent_id,goal,status,state,depends_on,created_at,updated_at) VALUES ('
      + [r.id, r.plan_id, r.parent_id, r.goal, r.status, r.state, r.depends_on, r.created_at, r.updated_at]
        .map(sqlLit).join(',') + ');');
  }
  return out;
}
