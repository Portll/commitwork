#!/usr/bin/env node
// bin/close-gate.mjs — the two checks /close cannot make about itself.
//
// usage:
//   node bin/close-gate.mjs worklist --since <iso> [--mine <taskId>…]   did THIS session use the spine?
//   node bin/close-gate.mjs payload <file> --must-contain <s>…   is the payload what the author meant?
//   node bin/close-gate.mjs both <file> --since <iso> --must-contain <s>…
// exit: 0 pass · 1 a named failure · 2 usage / cannot determine
//
// payload: a verified receipt proves sent==stored, not sent==meant — assert content before send.
// worklist: a clean close over an empty task spine is a named failure, not a pass.

import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { spineStorePath } from '../lib/spine-store-path.mjs';

// The store is resolved as the spine, the panel and gate-spine.mjs resolve it (lib/spine-store-path.mjs).
// This file alone read CW_SUBSTRATE_TASKS, so a test could point the panel at a fixture and this gate
// at the live store, and both would pass while checking different things. The old name still works,
// and says so.
const tasksDb = () => (!process.env.SPINE_TASKS_DB && !process.env.SUBSTRATE_TASKS_DB && process.env.CW_SUBSTRATE_TASKS
    && (console.error('  note  CW_SUBSTRATE_TASKS is the old name; set SPINE_TASKS_DB'), process.env.CW_SUBSTRATE_TASKS))
  || spineStorePath();
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const flagAll = (n) => {
  const out = []; let i = argv.indexOf(n);
  while (i !== -1) { for (let j = i + 1; j < argv.length && !argv[j].startsWith('--'); j++) out.push(argv[j]); i = argv.indexOf(n, i + 1); }
  return out;
};

let failed = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => { failed++; console.error(`  FAIL  ${m}`); };
const skip = (m) => console.log(`  ----  ${m}`);

// ── worklist ───────────────────────────────────────────────────────────────────────────────────
function worklist(sinceIso) {
  if (!sinceIso) { console.error('worklist: --since <iso> required'); process.exit(2); }
  // Commits are the evidence that the session did substantive work. No commits, nothing to demand.
  let commits = 0;
  try {
    commits = execFileSync('git', ['log', '--oneline', `--since=${sinceIso}`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean).length;
  } catch { skip('worklist: not a git repo — cannot establish that work happened'); return; }

  const TASKS_DB = tasksDb();
  if (!existsSync(TASKS_DB)) {
    // Absent is not pass: a check that could not run must not read as passed.
    fail(`worklist: overwatch-layer task store not found at ${TASKS_DB} — CANNOT DETERMINE whether the spine learned anything (this is not a pass)`);
    return;
  }

  let rows = [];
  try {
    const db = new DatabaseSync(TASKS_DB, { readOnly: true });
    rows = db.prepare('select id, plan_id, created_at from tasks where created_at >= ?').all(sinceIso);
  } catch (e) {
    fail(`worklist: task store unreadable (${e.message}) — cannot determine, which is not a pass`);
    return;
  }

  if (!commits) { skip(`worklist: 0 commits since ${sinceIso} — no substantive work to demand a task for`); return; }

  // `tasks` has no session column, so a bare count can be satisfied by a co-session; --mine is the
  // attributable strong form, and without it the check degrades to "the spine moved" and says so.
  const mine = flagAll('--mine');
  if (mine.length) {
    const have = new Set(rows.map((r) => String(r.id)));
    const missing = mine.filter((id) => !have.has(String(id)));
    if (missing.length) {
      fail(`worklist: task(s) ${missing.join(', ')} were named as this session's but were NOT created since ${sinceIso}`);
      return;
    }
    pass(`worklist: ${mine.length} task(s) attributable to this session (${mine.join(', ')})`);
    return;
  }

  if (!rows.length) {
    fail(`worklist: ${commits} commit(s) since ${sinceIso} and ZERO overwatch-layer tasks created.\n`
      + '        The session produced work and the fleet task spine learned nothing. A handoff\n'
      + '        document is not a task queue — nothing surfaces a markdown file to the next\n'
      + '        session. Create or reuse a plan (mcp__spine__list_plans) and add the open\n'
      + '        items as tasks, then re-run.');
    return;
  }
  // Deliberately not a clean PASS: this proves the spine moved, not that YOU moved it.
  skip(`worklist: ${rows.length} task(s) created since ${sinceIso} across ALL sessions on this box, against ${commits} commit(s) here.\n`
    + '        NOT ATTRIBUTED — tasks carry no session id, so this cannot tell your tasks from a\n'
    + '        co-session\'s. Re-run with --mine <taskId>… to assert the ones you created.');
}

// ── payload ────────────────────────────────────────────────────────────────────────────────────
function payload(file, must) {
  if (!file) { console.error('payload: needs a file path'); process.exit(2); }
  let src;
  try { src = readFileSync(file, 'utf8'); } catch (e) { fail(`payload: ${file} unreadable (${e.code || e.message})`); return; }
  if (!src.trim()) { fail(`payload: ${file} is EMPTY — an empty write verifies perfectly and says nothing`); return; }

  // Shell-corruption tells left behind when a payload was built inside a quoted string.
  const wreckage = [
    [/command not found/i, 'contains "command not found" — a shell executed part of this payload'],
    [/\$\{[A-Za-z_]/, 'contains an UNEXPANDED ${...} — a template that never interpolated'],
    [/\(eval\):\d+/, 'contains shell eval wreckage'],
  ];
  for (const [re, why] of wreckage) if (re.test(src)) fail(`payload: ${why}`);

  for (const token of must) {
    if (src.includes(token)) pass(`payload: contains ${JSON.stringify(token.slice(0, 48))}`);
    else fail(`payload: MISSING required token ${JSON.stringify(token.slice(0, 48))} — the payload is not what the author meant, and a receipt would verify it anyway`);
  }
  if (!must.length) pass(`payload: ${file} is non-empty and carries no shell wreckage (no --must-contain given)`);
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────
if (!cmd || !['worklist', 'payload', 'both'].includes(cmd)) {
  console.error('usage: close-gate.mjs worklist --since <iso>');
  console.error('       close-gate.mjs payload <file> [--must-contain <s>…]');
  console.error('       close-gate.mjs both <file> --since <iso> [--must-contain <s>…]');
  process.exit(2);
}

console.log('close-gate:');
if (cmd === 'worklist') worklist(flag('--since'));
else if (cmd === 'payload') payload(argv[1], flagAll('--must-contain'));
else { payload(argv[1], flagAll('--must-contain')); worklist(flag('--since')); }

process.exit(failed ? 1 : 0);
