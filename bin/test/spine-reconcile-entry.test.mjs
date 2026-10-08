// bin/spine-reconcile.mjs — the I/O half — as a process, on a fixture ledger (CW_SPINE_LEDGER) and a
// fixture SQLite store (SPINE_TASKS_DB) built in tmp. The decisions are pinned against the core
// module elsewhere; this pins what only the entry point does: reading the JSONL (a torn line is
// counted, never dropped silently), reading plan ids from SQLite read-only, telling an absent store
// from an unreadable one by stat rather than by error text, an absent ledger from an unreadable one
// by ENOENT, naming both paths in the report, the human rendering of dangling plans and route
// evidence, and exit 0 in every case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'spine-reconcile.mjs');

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* node < 22: the store tests skip */ }

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-spine-reconcile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, ledger: join(dir, 'spine-touches.jsonl'), db: join(dir, 'tasks.db') };
}

function store(path, ids) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE plans (id TEXT PRIMARY KEY, title TEXT)');
  const ins = db.prepare('INSERT INTO plans (id, title) VALUES (?, ?)');
  for (const id of ids) ins.run(id, `plan ${id}`);
  db.close();
}

const rows = (list) => `${list.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;

function cli(s, args = []) {
  const env = { ...process.env, CW_SPINE_LEDGER: s.ledger, SPINE_TASKS_DB: s.db };
  delete env.SUBSTRATE_TASKS_DB;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr, json: args.includes('--json') ? JSON.parse(r.stdout) : null };
}

const BYPASS = 'direct store write — the tool was not attached to this session';

test('dangling plans are found against a real SQLite store; a torn ledger line is counted', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a', 'plan-b']);
  writeFileSync(s.ledger, rows([
    { plan: 'plan-a', at: '2026-03-01T00:00:00.000Z' },
    { plan: 'plan-a', at: '2026-03-02T00:00:00.000Z' },
    { plan: 'plan-gone', at: '2026-03-03T00:00:00.000Z' },
    { plan: 'plan-gone', at: '2026-03-04T00:00:00.000Z', via: BYPASS },
    { plan: 'plan-gone', at: '2026-03-05T00:00:00.000Z' },
    '{"plan": "plan-a", "at": ',
  ]));
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0, r.err);
  const j = r.json;
  assert.equal(j.verdict, 'dangling-referents');
  assert.equal(j.ledgerPath, s.ledger);
  assert.equal(j.storePath, s.db);
  assert.equal(j.storeReadable, true);
  assert.equal(j.ledgerSkippedLines, 1);
  assert.deepEqual([j.planCount, j.storeCount, j.danglingRows], [2, 2, 3]);
  assert.deepEqual(j.dangling, [{ plan: 'plan-gone', rows: 3, newest: '2026-03-05T00:00:00.000Z' }]);
  assert.deepEqual(j.present, [{ plan: 'plan-a', rows: 2, newest: '2026-03-02T00:00:00.000Z' }]);
  assert.equal(j.coverage, 2 / 5);
  assert.deepEqual(j.bypass.reasons, [{ reason: BYPASS, rows: 1, plans: ['plan-gone'] }]);
});

test('the human report names both paths, the torn line, the dangling plan and the route evidence verbatim', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a']);
  writeFileSync(s.ledger, rows([{ plan: 'plan-a', at: '2026-03-01T00:00:00.000Z' },
    { plan: 'plan-gone', at: '2026-03-03T00:00:00.000Z', via: BYPASS }, 'not json']));
  const r = cli(s);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^spine-reconcile — /);
  assert.ok(r.out.includes(`  ledger: ${s.ledger}\n`) && r.out.includes(`  store:  ${s.db}\n`));
  assert.match(r.out, /NOTE: 1 unparseable ledger line\(s\) skipped/);
  assert.match(r.out, /plans the ledger names but the store does not hold \(1\), worst first:\n {8}1 filing\(s\) {2}plan-gone {2}\(newest 2026-03-03T00:00:00\.000Z\)/);
  assert.match(r.out, /present \(1\):\n {8}1 filing\(s\) {2}plan-a/);
  assert.match(r.out, /1 filing\(s\) came by a route OTHER than the tool/);
  assert.ok(r.out.includes(`"${BYPASS}"`), 'the reason is printed verbatim, not categorised');
});

test('every ledger plan present is reconciled', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a', 'plan-b', 'plan-unfiled']);
  writeFileSync(s.ledger, rows([{ plan: 'plan-a' }, { plan: 'plan-b' }, { tool: 'no plan named' }]));
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0);
  assert.deepEqual([r.json.verdict, r.json.planCount, r.json.storeCount, r.json.coverage], ['reconciled', 2, 3, 1]);
});

test('no store file is STORE-ABSENT and grey — never reconciled, never an empty store', (t) => {
  const s = sandbox(t);
  writeFileSync(s.ledger, rows([{ plan: 'plan-a' }]));
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0);
  assert.deepEqual([r.json.verdict, r.json.grey, r.json.storeCount, r.json.storeReadable], ['store-absent', true, null, false]);
  const human = cli(s);
  assert.match(human.out, /Absence of evidence is displayed as itself — this is not a clean result\./);
});

test('a store file that is not SQLite is STORE-UNREADABLE with the driver\'s reason, not absent and not empty', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  writeFileSync(s.db, 'this is not a database file, though it is long enough to look like one at a glance\n');
  writeFileSync(s.ledger, rows([{ plan: 'plan-a' }]));
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json.verdict, 'store-unreadable');
  assert.equal(r.json.storeReadable, false);
  assert.equal(r.json.storeCount, null, 'an unreadable store must not be counted as zero plans');
  assert.match(String(r.json.why), /\S/);
});

test('an absent ledger is grey with no plan count — absence is never reported as "nothing was filed"', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a']);
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json.grey, true);
  assert.equal(r.json.planCount, null);
  assert.equal(r.json.storeReadable, true);
});

test('an absent ledger is LEDGER-ABSENT — unknown, not a read fault, and not pinned on the store that answered', { skip: !DatabaseSync && 'node:sqlite unavailable' }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a']);
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json.verdict, r.json.grey, r.json.planCount, r.json.storeCount, r.json.storeReadable, r.json.why],
    ['ledger-absent', true, null, 1, true, null]);
  const human = cli(s);
  assert.match(human.out, /^spine-reconcile — spine ledger absent — UNKNOWN, not a finding\n/);
  assert.doesNotMatch(human.out, /unreadable/);
  assert.match(human.out, /Absence of evidence is displayed as itself — this is not a clean result\./);
});

// NTFS cannot deny the owner by mode, and root reads through a 000 mode anyway.
const CAN_DENY = process.platform !== 'win32' && process.getuid?.() !== 0;

test('an unreadable ledger is a read fault with its reason, never LEDGER-ABSENT — only ENOENT is absence', { skip: (!DatabaseSync && 'node:sqlite unavailable') || (!CAN_DENY && 'cannot deny a read here') }, (t) => {
  const s = sandbox(t);
  store(s.db, ['plan-a']);
  writeFileSync(s.ledger, rows([{ plan: 'plan-a' }]));
  chmodSync(s.ledger, 0o000);
  const r = cli(s, ['--json']);
  assert.equal(r.code, 0, r.err);
  assert.notEqual(r.json.verdict, 'ledger-absent');
  assert.equal(r.json.grey, true);
  assert.equal(r.json.planCount, null);
  assert.match(String(r.json.why), /EACCES/);
});
