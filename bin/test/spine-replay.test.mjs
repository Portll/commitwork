// bin/test/spine-replay.test.mjs — the reconstructor's floor.
//
// This tool's failure mode is not "it crashes". It is "it produces something that READS like the
// lost history": a plausible goal, a status it guessed, a task id it minted. Every one of those
// would be unfalsifiable later, because the only record left to check against is the ledger, and
// the ledger never held content. So most of these tests assert about what must NOT appear.
//
// The rest hold the two mechanical properties the tool is worthless without: the same ledger must
// produce byte-identical output on any box, and running it twice must be running it once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  replay, summarise, toSql, compareTaskIds, parentOf, taskOf, sqlLit,
  reconstructedGoal, TASK_STATUSES, RECONSTRUCTED_TASK_STATUS, RECONSTRUCTED_PLAN_STATUS,
  LEDGER_UNREADABLE, NOTHING_TO_REPLAY, NOTHING_MISSING, PROPOSED,
} from '../spine-replay-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'spine-replay.mjs');
const LIVE_STORES = ['.spine', '.substrate'].map((h) => join(process.env.HOME || '/nonexistent', h, 'tasks.db'));

const row = (o) => ({ s: 'sess-a', kind: 'create_task', plan: 'p1', task: '1', at: '2026-08-20T00:00:00.000Z', ...o });
const lines = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

/** A scratch dir that cleans itself up. Never the live store, never the repo. */
function scratch(t) {
  const d = mkdtempSync(join(tmpdir(), 'spine-replay-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A fixture spine store with the live schema's shape for the columns this tool writes. */
async function fixtureStore(path, { plans = [], tasks = [] } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT, project TEXT,
             status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
           CREATE TABLE tasks (id TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
             parent_id TEXT, goal TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT,
             state TEXT NOT NULL DEFAULT '{}', abandon_reason TEXT, depends_on TEXT NOT NULL DEFAULT '[]',
             notes TEXT, ring_parent TEXT, worktree TEXT, branch TEXT, anchor TEXT,
             created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (id, plan_id));`);
  for (const p of plans) {
    db.prepare('INSERT INTO plans (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(p.id, p.name || p.id, p.status || 'active', p.created_at || '2026-08-01T00:00:00.000Z', p.updated_at || '2026-08-01T00:00:00.000Z');
  }
  for (const tk of tasks) {
    db.prepare('INSERT INTO tasks (id,plan_id,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(tk.id, tk.plan_id, tk.goal, tk.status || 'pending', tk.created_at || '2026-08-01T00:00:00.000Z', tk.updated_at || '2026-08-01T00:00:00.000Z');
  }
  db.close();
}

const readStore = async (path) => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  const out = {
    plans: db.prepare('SELECT * FROM plans ORDER BY id').all(),
    tasks: db.prepare('SELECT * FROM tasks ORDER BY plan_id, id').all(),
  };
  db.close();
  return out;
};

// An inherited SPINE_TASKS_DB outranks the SUBSTRATE_TASKS_DB a test sets, and would aim a
// fixture read at the live store; neither is inherited.
const { SPINE_TASKS_DB: _s, SUBSTRATE_TASKS_DB: _l, ...BASE_ENV } = process.env;
const runCli = (args, env = {}) => execFileSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  // The real ledger's JSON is several MB; execFileSync's 1MB default would truncate it into a
  // parse error and the test would read as a defect in the tool rather than in the harness.
  maxBuffer: 64 * 1024 * 1024,
  env: { ...BASE_ENV, CW_NOW: '2026-09-07T00:00:00.000Z', ...env },
});

// ── The greys: unreadable is not empty ────────────────────────────────────────────────────────────

test('an unreadable ledger is UNKNOWN and proposes NOTHING — not a partial history', () => {
  const r = replay({ ledgerRows: null });
  assert.equal(r.verdict, LEDGER_UNREADABLE);
  assert.equal(r.grey, true);
  assert.equal(r.plans.length, 0);
  assert.equal(r.tasks.length, 0);
  assert.equal(r.counts.ledgerRows, null, 'zero rows would be a claim; unknown is the answer');
  assert.match(summarise(r), /UNKNOWN, not an empty ledger/);
});

test('a readable ledger naming no plans is grey, and says it is not a clean result', () => {
  const r = replay({ ledgerRows: [] });
  assert.equal(r.verdict, NOTHING_TO_REPLAY);
  assert.equal(r.grey, true);
  assert.match(r.detail, /not a clean result/);
});

test('everything already filed is NOTHING_MISSING and is not grey', () => {
  const r = replay({
    ledgerRows: [row({})],
    existingPlanIds: ['p1'],
    existingTasks: [{ plan_id: 'p1', id: '1' }],
  });
  assert.equal(r.verdict, NOTHING_MISSING);
  assert.equal(r.grey, false);
  assert.equal(r.counts.plansProposed, 0);
  assert.equal(r.counts.tasksProposed, 0);
});

test('an unknown target (null existing) never reports a record as present or absent', () => {
  const r = replay({ ledgerRows: [row({})] });
  assert.equal(r.plans[0].preexisting, null, 'unknown must not collapse into false');
  assert.equal(r.tasks[0].preexisting, null);
});

// ── Fail closed on malformed input ────────────────────────────────────────────────────────────────

test('malformed ledger lines are COUNTED, never silently dropped, and mark the run PARTIAL', (t) => {
  const d = scratch(t);
  const p = join(d, 'ledger.jsonl');
  writeFileSync(p, `${JSON.stringify(row({}))}\nnot json at all\n{"unterminated":\n["a valid json array, not a row"]\n`);
  const out = JSON.parse(runCli(['--json'], { CW_SPINE_LEDGER: p, SUBSTRATE_TASKS_DB: join(d, 'absent.db') }));
  assert.equal(out.ledgerSkipped, 3, 'two unparseable lines plus one valid-JSON-wrong-shape line');
  assert.equal(out.partial, true);
  assert.equal(out.counts.ledgerRows, 1);
  assert.equal(out.plans.length, 1, 'the legible row is still reconstructed');
});

test('a ledger whose every line is malformed reports partial, not "nothing was filed"', () => {
  const r = replay({ ledgerRows: [], ledgerSkipped: 4 });
  assert.equal(r.verdict, NOTHING_TO_REPLAY);
  assert.equal(r.partial, true);
  assert.match(r.detail, /nothing legible to replay.*not the same as "nothing was filed"/s);
});

test('rows naming no plan are counted, not dropped into silence', () => {
  const r = replay({ ledgerRows: [row({ plan: null }), row({ plan: '' }), row({})] });
  assert.equal(r.counts.rowsWithoutPlan, 2);
  assert.equal(r.counts.ledgerRows, 3);
});

// ── The point of the whole tool: no fabricated content ────────────────────────────────────────────

test('NO fabricated goal: every emitted goal declares itself unrecoverable and cites only evidence', () => {
  const r = replay({
    ledgerRows: [
      row({ kind: 'create_task', at: '2026-08-20T01:00:00.000Z' }),
      row({ kind: 'set_status', at: '2026-08-21T02:00:00.000Z', s: 'sess-b' }),
    ],
  });
  const goal = r.tasks[0].record.goal;
  assert.match(goal, /^\[RECONSTRUCTED SKELETON — ORIGINAL GOAL UNRECOVERABLE\]/);
  assert.match(goal, /records ids only/);
  assert.match(goal, /Ledger evidence: 2 row\(s\)/);
  assert.match(goal, /create_task×1/);
  assert.match(goal, /set_status×1/);
  assert.match(goal, /2026-08-20T01:00:00\.000Z/);
  assert.match(goal, /2026-08-21T02:00:00\.000Z/);
  assert.match(goal, /sess-a, sess-b/);
  // The negative half. Every token in the goal must be a literal from the ledger, a number, a
  // timestamp, or this module's own fixed prose — never a description of work.
  for (const forbidden of [/\bimplement\b/i, /\bfix\b/i, /\brefactor\b/i, /\bTODO\b/, /\bprobably\b/i, /\blikely\b/i]) {
    assert.doesNotMatch(goal, forbidden, `goal must not read like a task: ${forbidden}`);
  }
});

test('the goal states plainly that STATUS was not recovered — a set_status row has no value in it', () => {
  const r = replay({ ledgerRows: [row({ kind: 'set_status' })] });
  const t = r.tasks[0];
  assert.match(t.record.goal, /STATUS WAS NOT RECOVERED: the ledger records that a status was set 1 time\(s\), never to what/);
  assert.equal(t.unrecoverable.status, true);
  assert.equal(JSON.parse(t.record.state).reconstructed.statusRecovered, false);
});

test('a task with no set_status row says its status is UNKNOWN, not that a status was set', () => {
  // The mirror of the test above. Printing "a status was set" for a task the ledger never saw a
  // set_status for would put a row into the record that the ledger does not contain — a small
  // fabrication, and exactly the kind that survives review because it reads like boilerplate.
  const r = replay({ ledgerRows: [row({ kind: 'create_task' })] });
  assert.match(r.tasks[0].record.goal, /STATUS IS UNKNOWN: no set_status row names this task/);
  assert.doesNotMatch(r.tasks[0].record.goal, /a status was set/);
});

test('a plan name carries the reconstruction mark, because plans have nowhere else to carry it', () => {
  const r = replay({ ledgerRows: [row({ kind: 'create_plan', task: null })] });
  assert.match(r.plans[0].record.name, /^p1 \[RECONSTRUCTED — original unrecoverable; 1 ledger row\(s\) 2026-08-20\]$/);
  assert.equal(r.plans[0].record.cwd, null, 'cwd was never in the ledger; a guess would be an invention');
  assert.equal(r.plans[0].record.project, null);
});

test('a plan with no create_plan row is marked: created_at is a lower bound, not creation', () => {
  const withOut = replay({ ledgerRows: [row({ kind: 'create_task' })] }).plans[0];
  const within = replay({ ledgerRows: [row({ kind: 'create_plan', task: null })] }).plans[0];
  assert.equal(withOut.createdAtWitnessed, false);
  assert.match(withOut.record.name, /creation not witnessed/);
  assert.equal(within.createdAtWitnessed, true);
  assert.doesNotMatch(within.record.name, /creation not witnessed/);
});

// ── Status: the one value the ledger does not evidence ────────────────────────────────────────────

test('status is only ever a value the real store permits, and it is the least-claiming one', () => {
  const r = replay({ ledgerRows: [row({ kind: 'set_status' }), row({ kind: 'update_task' })] });
  for (const t of r.tasks) {
    assert.ok(TASK_STATUSES.includes(t.record.status), `${t.record.status} is outside substrate's STATUSES`);
    assert.equal(t.record.status, RECONSTRUCTED_TASK_STATUS);
    assert.notEqual(t.record.status, 'completed', 'never assert work that may not have happened');
    assert.notEqual(t.record.status, 'abandoned', 'abandoned asserts a dead end and needs a reason nobody wrote');
  }
  assert.equal(r.tasks[0].record.result, undefined, 'no result column is written at all');
});

test('plans are filed archived, not active — 75 historical plans must not become live work', () => {
  const r = replay({ ledgerRows: [row({})] });
  assert.equal(r.plans[0].record.status, RECONSTRUCTED_PLAN_STATUS);
  assert.equal(RECONSTRUCTED_PLAN_STATUS, 'archived');
});

// ── Rows with a null task ─────────────────────────────────────────────────────────────────────────

test('create_plan carries task:null by design and does NOT produce a phantom task', () => {
  const r = replay({ ledgerRows: [row({ kind: 'create_plan', task: null })] });
  assert.equal(r.plans.length, 1);
  assert.equal(r.tasks.length, 0);
  assert.equal(r.counts.unnamedTaskRows, 0, 'create_plan has no task to be unnamed');
});

test('a non-create_plan row with no task is an UNNAMEABLE filing: counted per plan, never filed', () => {
  const r = replay({
    ledgerRows: [
      row({ kind: 'create_task', task: null, shape: ['0'] }),
      row({ kind: 'create_task', task: null, shape: [] }),
      row({ kind: 'set_status', task: null, shape: [] }),
    ],
  });
  assert.equal(r.tasks.length, 0, 'minting an id would invent a task AND destroy idempotency');
  assert.equal(r.counts.unnamedTaskRows, 3);
  assert.deepEqual(r.plans[0].unnamedTaskFilings, [{ kind: 'create_task', rows: 2 }, { kind: 'set_status', rows: 1 }]);
  assert.equal(r.plans[0].evidence.rows, 3, 'they are still evidence ABOUT the plan');
});

test('a plan known only through null-task rows still yields a plan skeleton', () => {
  const r = replay({ ledgerRows: [row({ kind: 'update_task', task: null, shape: [] })] });
  assert.equal(r.plans.length, 1);
  assert.equal(r.plans[0].id, 'p1');
});

// ── `via` rows: flagged, never equated ────────────────────────────────────────────────────────────

test('`via` rows are counted separately at every level and named in the goal', () => {
  const via = 'spine/db.mjs direct — substrate MCP not attached to this session';
  const r = replay({ ledgerRows: [row({}), row({ kind: 'set_status', via })] });
  assert.equal(r.counts.viaRows, 1);
  assert.equal(r.plans[0].evidence.viaRows, 1);
  assert.equal(r.tasks[0].evidence.viaRows, 1);
  assert.match(r.tasks[0].record.goal, /1 of these row\(s\) were filed by a bypass path/);
  assert.match(r.tasks[0].record.goal, /not equivalent evidence/);
  assert.equal(JSON.parse(r.tasks[0].record.state).reconstructed.viaRows, 1);
});

test('a task with no via rows says nothing about a bypass path', () => {
  const r = replay({ ledgerRows: [row({})] });
  assert.doesNotMatch(r.tasks[0].record.goal, /bypass/);
});

// ── Tree identity: unknown for 99% of rows, and reported as unknown ───────────────────────────────

test('a row with no tree id is recorded as unknown, never resolved to a tree', () => {
  const r = replay({ ledgerRows: [row({}), row({ r: '789775f29db1', task: '2' })] });
  assert.deepEqual(r.plans[0].evidence.trees, { '789775f29db1': 1, unknown: 1 });
});

// ── Determinism and ordering ──────────────────────────────────────────────────────────────────────

test('same ledger, byte-identical output — including when the rows arrive shuffled', () => {
  const rows = [
    row({ plan: 'p2', task: '10' }), row({ plan: 'p1', task: '2' }),
    row({ plan: 'p1', task: '10' }), row({ plan: 'p1', task: '1.2' }),
    row({ plan: 'p1', task: '1' }), row({ plan: 'p2', task: '2' }),
  ];
  const a = JSON.stringify(replay({ ledgerRows: rows, now: 'X' }));
  const b = JSON.stringify(replay({ ledgerRows: [...rows].reverse(), now: 'X' }));
  assert.equal(a, b, 'ordering must not depend on ledger arrival order');
});

test('task ids sort by address, not lexicographically — 10 comes after 2', () => {
  const r = replay({
    ledgerRows: ['1', '10', '2', '1.2', '1.10', '1.1'].map((task) => row({ task })),
  });
  assert.deepEqual(r.tasks.map((t) => t.id), ['1', '1.1', '1.2', '1.10', '2', '10']);
  assert.equal(compareTaskIds('1.2', '1.10') < 0, true);
  assert.equal(compareTaskIds('1', '1'), 0);
});

test('sessions, kinds and trees are all emitted in sorted order', () => {
  const r = replay({
    ledgerRows: [row({ s: 'z' }), row({ s: 'a', kind: 'set_status' }), row({ s: 'm', kind: 'create_task' })],
  });
  assert.deepEqual(r.tasks[0].evidence.sessions, ['a', 'm', 'z']);
  assert.deepEqual(Object.keys(r.tasks[0].evidence.kinds), ['create_task', 'set_status']);
});

test('no proposed record takes any value from a clock — only the report stamp does', () => {
  const rows = [row({})];
  const a = replay({ ledgerRows: rows, now: '2026-01-01T00:00:00.000Z' });
  const b = replay({ ledgerRows: rows, now: '2099-12-31T00:00:00.000Z' });
  assert.deepEqual(a.plans, b.plans);
  assert.deepEqual(a.tasks, b.tasks);
  assert.notEqual(a.generatedAt, b.generatedAt);
  assert.equal(a.tasks[0].record.created_at, '2026-08-20T00:00:00.000Z');
});

test('CW_NOW is read at CALL time, and the CLI honours it', (t) => {
  const d = scratch(t);
  const p = join(d, 'ledger.jsonl');
  writeFileSync(p, lines([row({})]));
  const env = { CW_SPINE_LEDGER: p, SUBSTRATE_TASKS_DB: join(d, 'absent.db') };
  const a = runCli(['--json'], { ...env, CW_NOW: '2026-01-02T03:04:05.000Z' });
  const b = runCli(['--json'], { ...env, CW_NOW: '2030-01-02T03:04:05.000Z' });
  assert.equal(JSON.parse(a).generatedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(JSON.parse(a).tasks[0].record.created_at, JSON.parse(b).tasks[0].record.created_at);
});

// ── Identity and idempotency ──────────────────────────────────────────────────────────────────────

test('identity is the plan/task id, so re-filing the same ledger twice inserts nothing the second time', async (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const db = join(d, 'copy.db');
  writeFileSync(led, lines([
    row({ plan: 'pa', task: '1', kind: 'create_plan', task: null }),
    row({ plan: 'pa', task: '1' }),
    row({ plan: 'pa', task: '1.1', at: '2026-08-21T00:00:00.000Z' }),
    row({ plan: 'pb', task: '3' }),
  ]));
  await fixtureStore(db);

  const first = JSON.parse(runCli(['--apply', '--target', db, '--json'], { CW_SPINE_LEDGER: led }));
  assert.equal(first.applied.ok, true);
  assert.equal(first.applied.plansInserted, 2);
  assert.equal(first.applied.tasksInserted, 3);

  const afterOne = await readStore(db);
  const second = JSON.parse(runCli(['--apply', '--target', db, '--json'], { CW_SPINE_LEDGER: led }));
  assert.equal(second.applied.ok, true);
  assert.equal(second.applied.plansInserted, 0, 'a second run must insert nothing');
  assert.equal(second.applied.tasksInserted, 0);
  assert.equal(second.verdict, NOTHING_MISSING, 'and must SAY nothing is missing');

  const afterTwo = await readStore(db);
  assert.deepEqual(afterTwo, afterOne, 'running twice is running once, byte for byte');
});

test('a REAL surviving record is never overwritten by a skeleton', async (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const db = join(d, 'copy.db');
  writeFileSync(led, lines([row({ plan: 'survivor', task: '1' }), row({ plan: 'survivor', task: '2' })]));
  await fixtureStore(db, {
    plans: [{ id: 'survivor', name: 'the real name', status: 'active' }],
    tasks: [{ id: '1', plan_id: 'survivor', goal: 'the real goal, still here', status: 'completed' }],
  });

  const out = JSON.parse(runCli(['--apply', '--target', db, '--json'], { CW_SPINE_LEDGER: led }));
  assert.equal(out.applied.tasksInserted, 1, 'only the absent task is filed');
  assert.equal(out.applied.plansInserted, 0);

  const store = await readStore(db);
  const real = store.tasks.find((x) => x.id === '1');
  assert.equal(real.goal, 'the real goal, still here', 'the surviving goal must be untouched');
  assert.equal(real.status, 'completed', 'and its real status must not be reset to the placeholder');
  assert.equal(store.plans[0].name, 'the real name');
  assert.equal(store.plans[0].status, 'active', 'a live plan must not be archived by a replay');
  const filled = store.tasks.find((x) => x.id === '2');
  assert.match(filled.goal, /ORIGINAL GOAL UNRECOVERABLE/);
});

test('the SQL it prints is INSERT OR IGNORE — identity-keyed, never REPLACE', () => {
  const r = replay({ ledgerRows: [row({})] });
  const sql = toSql(r);
  assert.equal(sql.length, 2);
  for (const s of sql) {
    assert.match(s, /^INSERT OR IGNORE INTO/);
    assert.doesNotMatch(s, /INSERT OR REPLACE|UPDATE |DELETE /);
  }
  assert.equal(sqlLit("it's"), "'it''s'");
  assert.equal(sqlLit(null), 'NULL');
});

test('preexisting records are excluded from the SQL as well as from the apply', () => {
  const r = replay({
    ledgerRows: [row({ plan: 'p1', task: '1' }), row({ plan: 'p1', task: '2' })],
    existingPlanIds: ['p1'],
    existingTasks: [{ plan_id: 'p1', id: '1' }],
  });
  const sql = toSql(r).join('\n');
  assert.doesNotMatch(sql, /INTO plans/);
  assert.match(sql, /INTO tasks/);
  assert.equal(toSql(r).length, 1);
});

// ── Writing is refused by default and refused for the live store ──────────────────────────────────

test('--apply without --target refuses and exits 2, having written nothing', (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  writeFileSync(led, lines([row({})]));
  assert.throws(
    () => runCli(['--apply'], { CW_SPINE_LEDGER: led, SUBSTRATE_TASKS_DB: join(d, 'absent.db') }),
    (e) => {
      assert.equal(e.status, 2);
      assert.match(String(e.stderr), /REFUSED.*explicit --target/s);
      return true;
    },
  );
});

test('--apply at the live store is refused outright, with no override flag offered', (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const fakeLive = join(d, 'live.db');
  writeFileSync(led, lines([row({})]));
  // Point SUBSTRATE_TASKS_DB at a scratch file and then name that same file as the target: the
  // guard must follow the env var, because the env var IS how the live store is repointed.
  assert.throws(
    () => runCli(['--apply', '--target', fakeLive], { CW_SPINE_LEDGER: led, SUBSTRATE_TASKS_DB: fakeLive }),
    (e) => {
      assert.equal(e.status, 2);
      assert.match(String(e.stderr), /LIVE spine store/);
      assert.match(String(e.stderr), /no override flag/);
      return true;
    },
  );
  assert.equal(existsSync(fakeLive), false, 'the refusal must not have created the store either');
});

// The store moved from ~/.substrate to ~/.spine. A live set built from the old home alone let
// --apply write the real store on any box where only the new home exists and no env var is set.
for (const home of ['.spine', '.substrate']) {
  test(`--apply at ~/${home}/tasks.db is refused with no store env var set`, async (t) => {
    const d = scratch(t);
    const led = join(d, 'ledger.jsonl');
    writeFileSync(led, lines([row({})]));
    mkdirSync(join(d, home));
    const live = join(d, home, 'tasks.db');
    await fixtureStore(live);
    const env = { ...BASE_ENV, HOME: d, CW_SPINE_LEDGER: led, CW_NOW: '2026-09-07T00:00:00.000Z' };
    const before = await readStore(live);
    assert.throws(
      () => execFileSync(process.execPath, [CLI, '--apply', '--target', live], { encoding: 'utf8', env, stdio: 'pipe' }),
      (e) => { assert.equal(e.status, 2); assert.match(String(e.stderr), /LIVE spine store/); return true; },
    );
    assert.deepEqual(await readStore(live), before, 'the live store must be byte-for-byte untouched');
  });
}

test('--apply at the store SPINE_TASKS_DB names is refused', (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const fakeLive = join(d, 'live.db');
  writeFileSync(led, lines([row({})]));
  assert.throws(
    () => runCli(['--apply', '--target', fakeLive], { CW_SPINE_LEDGER: led, SPINE_TASKS_DB: fakeLive }),
    (e) => { assert.equal(e.status, 2); assert.match(String(e.stderr), /LIVE spine store/); return true; },
  );
  assert.equal(existsSync(fakeLive), false);
});

test('the default run writes nothing and never opens a store for writing', (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const db = join(d, 'copy.db');
  writeFileSync(led, lines([row({})]));
  const before = existsSync(db);
  const out = runCli([], { CW_SPINE_LEDGER: led, SUBSTRATE_TASKS_DB: db });
  assert.equal(existsSync(db), before, 'a dry run must not conjure a store');
  assert.match(out, /Nothing was written/);
  assert.match(out, /skeleton/i);
});

test('--apply into an unreadable-but-present target is refused, not treated as an empty store', async (t) => {
  const d = scratch(t);
  const led = join(d, 'ledger.jsonl');
  const db = join(d, 'garbage.db');
  writeFileSync(led, lines([row({})]));
  writeFileSync(db, 'this is not a sqlite database');
  assert.throws(
    () => runCli(['--apply', '--target', db, '--json'], { CW_SPINE_LEDGER: led }),
    (e) => {
      assert.equal(e.status, 2);
      const out = JSON.parse(String(e.stdout));
      assert.equal(out.applied.ok, false);
      assert.match(out.applied.why, /present and unreadable|no plans\/tasks tables/);
      return true;
    },
  );
});

test('--apply from an unreadable ledger is refused — a partial history must not be filed', async (t) => {
  const d = scratch(t);
  const db = join(d, 'copy.db');
  await fixtureStore(db);
  assert.throws(
    () => runCli(['--apply', '--target', db], { CW_SPINE_LEDGER: join(d, 'no-such-ledger.jsonl') }),
    (e) => {
      assert.equal(e.status, 2);
      assert.match(String(e.stderr), /ledger is unreadable/);
      return true;
    },
  );
  const store = await readStore(db);
  assert.equal(store.plans.length, 0);
});

// ── Structure the ids themselves establish ────────────────────────────────────────────────────────

test('parent_id is derived from the address, and a missing ancestor is a flagged gap, not a synthesis', () => {
  const r = replay({ ledgerRows: [row({ task: '24.6' }), row({ task: '3' }), row({ task: '3.1' })] });
  const ids = r.tasks.map((x) => x.id);
  assert.deepEqual(ids, ['3', '3.1', '24.6'], 'the missing ancestor 24 is NOT invented');
  const orphan = r.tasks.find((x) => x.id === '24.6');
  assert.equal(orphan.record.parent_id, '24');
  assert.equal(orphan.parentPresent, false);
  assert.equal(r.tasks.find((x) => x.id === '3.1').parentPresent, true);
  assert.equal(r.tasks.find((x) => x.id === '3').parentPresent, null, 'a root has no parent to be absent');
  assert.equal(parentOf('1'), null);
  assert.equal(parentOf('1.2.3'), '1.2');
});

test('a numeric task id is accepted and a structured one is not mistaken for an id', () => {
  assert.equal(taskOf({ task: 7 }), '7');
  assert.equal(taskOf({ task: null }), null);
  assert.equal(taskOf({ task: { id: 3 } }), null);
  assert.equal(taskOf({ task: '' }), null);
});

test('--plan restricts the reconstruction to one plan without changing any record', () => {
  const rows = [row({ plan: 'p1' }), row({ plan: 'p2', task: '9' })];
  const all = replay({ ledgerRows: rows });
  const one = replay({ ledgerRows: rows, planFilter: 'p2' });
  assert.equal(one.plans.length, 1);
  assert.equal(one.plans[0].id, 'p2');
  assert.deepEqual(one.tasks[0].record, all.tasks.find((x) => x.plan_id === 'p2').record);
});

// ── The live ledger, read but never written ───────────────────────────────────────────────────────

test('the real ledger reconstructs without throwing, and claims nothing it cannot show', (t) => {
  const real = resolve(HERE, '..', '..', '.claude', 'store', 'spine-touches.jsonl');
  if (!existsSync(real)) { t.skip('no spine ledger on this box — absence is not a failure'); return; }
  const d = scratch(t);
  const out = JSON.parse(runCli(['--json'], {
    CW_SPINE_LEDGER: real,
    SUBSTRATE_TASKS_DB: join(d, 'absent.db'),   // never the live store, even for a read
  }));
  assert.ok(out.counts.plansNamed > 0);
  assert.equal(out.comparedAgainst, join(d, 'absent.db'));
  assert.ok(!LIVE_STORES.includes(out.comparedAgainst));
  for (const task of out.tasks) {
    assert.match(task.record.goal, /ORIGINAL GOAL UNRECOVERABLE/);
    assert.ok(TASK_STATUSES.includes(task.record.status));
    assert.equal(task.record.result, undefined);
  }
  for (const plan of out.plans) assert.match(plan.record.name, /\[RECONSTRUCTED/);
});

test('reconstructedGoal is a pure function of its evidence — no hidden clock, no hidden env', () => {
  const ev = { rows: 1, first: 'T1', last: 'T1', sessions: ['s'], kinds: { create_task: 1 }, viaRows: 0, trees: {} };
  const a = reconstructedGoal(ev, { plan: 'p', task: '1' });
  const b = reconstructedGoal(ev, { plan: 'p', task: '1' });
  assert.equal(a, b);
});
