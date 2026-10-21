// bin/close-gate.mjs — the two things a receipt cannot tell you: whether the client sent what the
// author meant, and whether THIS session used the spine. A check that COULD NOT RUN must never
// read as one that passed, and a gate a third party can satisfy on your behalf is not a gate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(CW, 'bin', 'close-gate.mjs');

// SPINE_TASKS_DB outranks the fixture's SUBSTRATE_TASKS_DB: inherited from the shell, it would aim
// the gate at the live store.
const inheritedEnv = () => { const e = { ...process.env }; delete e.SPINE_TASKS_DB; return e; };
const run = (args, env = {}) => {
  try { return { code: 0, out: execFileSync('node', [TOOL, ...args], { cwd: CW, encoding: 'utf8', env: { ...inheritedEnv(), ...env } }) }; }
  catch (e) { return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};
const withFile = (body, fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-gate-'));
  const f = join(d, 'payload.json');
  writeFileSync(f, body);
  try { return fn(f); } finally { rmSync(d, { recursive: true, force: true }); }
};
// Unset, the gate reads the live spine at ~/.substrate/tasks.db: absent on a fresh box, and written
// by every co-session on this one, so a test reading it passes or fails by whatever is there. Rows
// carry the live schema's ISO-text created_at, which the gate compares against --since as text.
const withSpine = (tasks, fn) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-gate-spine-'));
  const f = join(d, 'tasks.db');
  const db = new DatabaseSync(f);
  db.exec('CREATE TABLE tasks (id TEXT NOT NULL, plan_id TEXT NOT NULL, created_at TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO tasks (id, plan_id, created_at) VALUES (?, ?, ?)');
  for (const [id, createdAt] of tasks) ins.run(id, 'p1', createdAt);
  db.close();
  try { return fn({ SUBSTRATE_TASKS_DB: f }); } finally { rmSync(d, { recursive: true, force: true }); }
};
const IN_WINDOW = [['t-1', '2026-01-02T00:00:00.000Z'], ['t-2', '2026-01-03T00:00:00.000Z']];

describe('payload — the gap between what the author meant and what was sent', () => {
  test('shell wreckage is caught: an executed backtick leaves "command not found"', () => {
    withFile('worklist: created with , not \n(eval):1: command not found: parent\n', (f) => {
      const r = run(['payload', f]);
      assert.equal(r.code, 1);
      assert.match(r.out, /a shell executed part of this payload/);
    });
  });

  test('an UNEXPANDED template is wreckage too — it never interpolated', () => {
    withFile('{"session":"${SESSION_ID}"}\n', (f) => {
      const r = run(['payload', f]);
      assert.equal(r.code, 1);
      assert.match(r.out, /UNEXPANDED/);
    });
  });

  test('a required token that vanished is named — the case a receipt would still verify', () => {
    withFile('{"note":"the backticked word was eaten"}\n', (f) => {
      const r = run(['payload', f, '--must-contain', 'parentId']);
      assert.equal(r.code, 1);
      assert.match(r.out, /MISSING required token/);
      assert.match(r.out, /a receipt would verify it anyway/);
    });
  });

  test('an EMPTY payload fails — it would verify perfectly and say nothing', () => {
    withFile('', (f) => {
      const r = run(['payload', f]);
      assert.equal(r.code, 1);
      assert.match(r.out, /EMPTY/);
    });
  });

  test('a clean payload with all its tokens passes', () => {
    withFile('{"worklist":"tasks 5, 5.1 — parentId was the wrong param name"}\n', (f) => {
      const r = run(['payload', f, '--must-contain', 'parentId', 'worklist']);
      assert.equal(r.code, 0);
      assert.match(r.out, /PASS/);
    });
  });
});

describe('worklist — did THIS session use the spine', () => {
  test('an ABSENT task store FAILS rather than passing — cannot-determine is not a pass', () => {
    const r = run(['worklist', '--since', '2020-01-01T00:00:00Z'], { SUBSTRATE_TASKS_DB: '/nonexistent/tasks.db' });
    assert.equal(r.code, 1);
    assert.match(r.out, /CANNOT DETERMINE/);
    assert.match(r.out, /not a pass/);
  });

  test('the store is named by SUBSTRATE_TASKS_DB, as the panel and gate-spine name it; the old name is honoured and flagged', () => {
    // Two resolvers on one store: a test that pointed the panel at a fixture left this gate on the
    // live store, and both passed while reading different files.
    const old = run(['worklist', '--since', '2020-01-01T00:00:00Z'], { CW_SUBSTRATE_TASKS: '/nonexistent/tasks.db' });
    assert.equal(old.code, 1);
    assert.match(old.out, /CANNOT DETERMINE/);
    assert.match(old.out, /CW_SUBSTRATE_TASKS is the old name/);
    // The canonical name wins when both are set.
    const both = run(['worklist', '--since', '2020-01-01T00:00:00Z'], { SUBSTRATE_TASKS_DB: '/nonexistent/a.db', CW_SUBSTRATE_TASKS: '/nonexistent/b.db' });
    assert.match(both.out, /a\.db/);
    assert.doesNotMatch(both.out, /old name/);
  });

  test('naming a task that does not exist in the window FAILS — the strong form catches a false claim', () => {
    withSpine(IN_WINDOW, (env) => {
      const r = run(['worklist', '--since', '2020-01-01T00:00:00Z', '--mine', 'definitely-not-a-task-id'], env);
      assert.equal(r.code, 1);
      assert.match(r.out, /were NOT created since/);
      // Positive control: a true claim against the same store passes, so the FAIL is about the id.
      const ok = run(['worklist', '--since', '2020-01-01T00:00:00Z', '--mine', 't-1'], env);
      assert.equal(ok.code, 0, ok.out);
      assert.match(ok.out, /attributable to this session \(t-1\)/);
    });
  });

  test('a future window has no commits, so it demands nothing rather than failing', () => {
    // No work happened ⇒ no task is owed. The gate must not fire on a session that did nothing.
    withSpine(IN_WINDOW, (env) => {
      const r = run(['worklist', '--since', '2099-01-01T00:00:00Z'], env);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /0 commits/);
    });
  });

  test('the unattributed count is reported as ---- , never PASS', () => {
    // `tasks` has no session column, so a bare count can be satisfied by somebody else's work
    withSpine(IN_WINDOW, (env) => {
      const r = run(['worklist', '--since', '2020-01-01T00:00:00Z'], env);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /2 task\(s\) created since/);
      assert.match(r.out, /NOT ATTRIBUTED/);
      assert.ok(!/PASS\s+worklist: \d+ task\(s\) created since/.test(r.out),
        'an unattributed count must not render as PASS');
    });
  });
});
