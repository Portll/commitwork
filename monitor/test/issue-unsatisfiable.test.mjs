// monitor/test/issue-unsatisfiable.test.mjs — roadmap W4: an item with no path to done leaves the
// queue with its reason, and is counted apart from both the queue and the closed set.
// Fixtures only; the live store is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  emptyIssuesDoc, loadIssues, saveIssues, withIssuesLock, mintIssue, closeIssue, claimIssue,
  blockIssue, reopenIssue, linkIssues, readyIssues, verifyChain, panelRows,
  markUnsatisfiable, findUnsatisfiable, ISSUE_STATES, UNSATISFIABLE_CODES,
} from '../issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCHEMA = join(REPO, 'schema', 'issue.schema.json');
const CLI = join(REPO, 'bin', 'issue.mjs');
const T0 = '2026-08-02T12:00:00.000Z';
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-unsat-'));

const newDoc = () => Object.assign(emptyIssuesDoc(), { organisation: 'FIXTURE' });
const manual = (o = {}) => ({
  area: 'area-a', title: 'a task', severity: 'high', class: 'F',
  source: { kind: 'manual', key: null, tool: null, rule: null }, ...o,
});
const scanner = (category, area = 'area-a', rule = 'rule-1') => ({
  // class pinned: a retired lane's category has no class left to derive one from
  area, title: `${rule} [${category}]`, severity: 'high', repo: 'repo-1', class: 'S',
  source: { kind: 'scanner-row', key: `sc:repo-1|${category}|${rule}|src/a.js`, tool: category, rule },
});
const mint = (doc, f) => mintIssue(doc, f, T0).id;

test('unsatisfiable is a state of its own, neither open nor closed', () => {
  assert.ok(ISSUE_STATES.includes('unsatisfiable'));
  assert.deepEqual(UNSATISFIABLE_CODES, ['lane-retired', 'area-retired', 'blocker-unsatisfiable', 'manual']);
});

test('marking leaves the ready queue, keeps the reason, chains an event, and is not a close', () => {
  const doc = newDoc();
  const id = mint(doc, manual());
  assert.equal(readyIssues(doc, { now: T0 }).length, 1);
  markUnsatisfiable(doc, id, { code: 'manual', reason: 'the target repository was deleted', by: 'operator', at: T0 });
  const iss = doc.issues[id];
  assert.equal(iss.state, 'unsatisfiable');
  assert.equal(iss.closedAs, null, 'not done: no verdict was reached');
  assert.deepEqual(iss.unsatisfiable, { code: 'manual', reason: 'the target repository was deleted', at: T0, by: 'operator' });
  assert.equal(readyIssues(doc, { now: T0 }).length, 0);
  const ev = doc.events.at(-1);
  assert.equal(ev.type, 'issue-unsatisfiable');
  assert.deepEqual(ev.data, { code: 'manual', reason: 'the target repository was deleted', from: 'open', by: 'operator' });
  assert.deepEqual(verifyChain(doc), []);
  // still visible to the panel, as itself
  assert.deepEqual(panelRows(doc, { now: T0 }).map((r) => r.state), ['unsatisfiable']);
});

test('refusals: no reason, unknown code, closed, already unsatisfiable, a live claim', () => {
  const doc = newDoc();
  const id = mint(doc, manual());
  assert.throws(() => markUnsatisfiable(doc, id, { code: 'manual', reason: '  ', at: T0 }), /requires a reason/);
  assert.throws(() => markUnsatisfiable(doc, id, { code: 'gone', reason: 'x', at: T0 }), /must be one of/);
  claimIssue(doc, id, { by: 'agent', sessionId: 's1', at: T0 });
  assert.throws(() => markUnsatisfiable(doc, id, { code: 'manual', reason: 'x', at: T0 }), (e) => e.code === 'CLAIM_CONFLICT');
  const later = '2026-08-03T12:00:00.000Z';
  markUnsatisfiable(doc, id, { code: 'manual', reason: 'x', at: later });
  assert.equal(doc.issues[id].claim, null, 'an expired claim does not hold it');
  assert.throws(() => markUnsatisfiable(doc, id, { code: 'manual', reason: 'y', at: later }), /already unsatisfiable/);
  assert.throws(() => claimIssue(doc, id, { by: 'agent', sessionId: 's2', at: later }), /is unsatisfiable: x/);
  assert.throws(() => blockIssue(doc, id, { reason: 'z', at: later }), /reopen it before blocking/);
  const shut = mint(doc, manual());
  closeIssue(doc, shut, { as: 'accepted', evidence: 'risk accepted in review', at: T0 });
  assert.throws(() => markUnsatisfiable(doc, shut, { code: 'manual', reason: 'x', at: T0 }), /is closed/);
});

test('a blocked item keeps its blockedReason when it becomes unsatisfiable; reopen returns it to the queue', () => {
  const doc = newDoc();
  const id = mint(doc, manual());
  blockIssue(doc, id, { reason: 'waiting on upstream', at: T0 });
  markUnsatisfiable(doc, id, { code: 'manual', reason: 'upstream archived', at: T0 });
  assert.equal(doc.issues[id].blockedReason, 'waiting on upstream');
  reopenIssue(doc, id, { at: T0, reason: 'upstream unarchived' });
  assert.equal(doc.issues[id].state, 'open');
  assert.equal(doc.issues[id].unsatisfiable, null);
  assert.equal(readyIssues(doc, { now: T0 }).length, 1);
});

test('an unsatisfiable item may still be closed on evidence', () => {
  const doc = newDoc();
  const id = mint(doc, manual());
  markUnsatisfiable(doc, id, { code: 'manual', reason: 'no target', at: T0 });
  closeIssue(doc, id, { as: 'superseded', evidence: 'replaced by a broader item', at: T0 });
  assert.equal(doc.issues[id].state, 'closed');
});

test('the store round-trips through the schema with the new state, field and event', () => {
  const path = join(tmp(), 'issues.json');
  withIssuesLock(() => {
    const doc = newDoc();
    const legacy = mint(doc, manual());
    const id = mint(doc, manual());
    markUnsatisfiable(doc, id, { code: 'manual', reason: 'no target', at: T0 });
    saveIssues(doc, { path, schemaPath: SCHEMA });
    assert.ok(!('unsatisfiable' in doc.issues[legacy]), 'a record that never left the queue gains no field');
  }, { path });
  const back = loadIssues({ path, schemaPath: SCHEMA });
  assert.equal(Object.values(back.issues).filter((i) => i.state === 'unsatisfiable').length, 1);
});

// ── the reader ───────────────────────────────────────────────────────────────────────────────
test('reader: a scanner issue whose lane is no longer registered is lane-retired', () => {
  const doc = newDoc();
  const live = mint(doc, scanner('laneLive'));
  const gone = mint(doc, scanner('laneGone'));
  const out = findUnsatisfiable(doc, { categories: new Set(['laneLive']), areas: new Set(['area-a']) });
  assert.deepEqual(out.assign.map((a) => [a.id, a.code]), [[gone, 'lane-retired']]);
  assert.match(out.assign[0].reason, /'laneGone' is no longer registered/);
  assert.deepEqual(out.unmeasured, []);
  assert.ok(!out.assign.some((a) => a.id === live));
});

test('reader: a scan-sourced issue in an unregistered area is area-retired; a manual one is not', () => {
  const doc = newDoc();
  const scan = mint(doc, scanner('laneLive', 'area-gone'));
  mint(doc, manual({ area: 'area-gone' }));
  const out = findUnsatisfiable(doc, { categories: new Set(['laneLive']), areas: new Set(['area-a']) });
  assert.deepEqual(out.assign.map((a) => [a.id, a.code]), [[scan, 'area-retired']]);
});

test('reader: a missing list is an unrun check, never "everything is retired"', () => {
  const doc = newDoc();
  mint(doc, scanner('laneGone', 'area-gone'));
  const out = findUnsatisfiable(doc, {});
  assert.deepEqual(out.assign, []);
  assert.equal(out.unmeasured.length, 2);
});

test('reader: dependants of an unsatisfiable blocker follow it, transitively', () => {
  const doc = newDoc();
  const root = mint(doc, scanner('laneGone'));
  const mid = mint(doc, manual());
  const leaf = mint(doc, manual());
  const free = mint(doc, manual());
  linkIssues(doc, root, { blocks: mid, at: T0 });
  linkIssues(doc, mid, { blocks: leaf, at: T0 });
  const out = findUnsatisfiable(doc, { categories: new Set(), areas: new Set(['area-a']) });
  const got = Object.fromEntries(out.assign.map((a) => [a.id, a]));
  assert.equal(got[root].code, 'lane-retired');
  assert.equal(got[mid].code, 'blocker-unsatisfiable');
  assert.equal(got[mid].reason, `blocked by ${root}, which cannot be completed`);
  assert.equal(got[leaf].reason, `blocked by ${mid}, which cannot be completed`);
  assert.ok(!got[free]);
});

test('reader: claimed issues are listed as skipped, closed and unsatisfiable ones are not re-judged', () => {
  const doc = newDoc();
  const claimed = mint(doc, scanner('laneGone', 'area-a', 'r1'));
  const done = mint(doc, scanner('laneGone', 'area-a', 'r2'));
  const already = mint(doc, scanner('laneGone', 'area-a', 'r3'));
  claimIssue(doc, claimed, { by: 'agent', sessionId: 's1', at: T0 });
  closeIssue(doc, done, { as: 'fixed', evidence: 'fixed in review', at: T0 });
  markUnsatisfiable(doc, already, { code: 'manual', reason: 'x', at: T0 });
  const out = findUnsatisfiable(doc, { categories: new Set(), areas: new Set(['area-a']) });
  assert.deepEqual(out.assign, []);
  assert.deepEqual(out.skippedClaimed, [claimed]);
});

test('reader: deterministic — same store, same answer, in id order', () => {
  const build = () => {
    const doc = newDoc();
    for (const c of ['z', 'a', 'm']) mint(doc, scanner(`lane-${c}`));
    return doc;
  };
  const a = findUnsatisfiable(build(), { categories: new Set(), areas: new Set(['area-a']) });
  const b = findUnsatisfiable(build(), { categories: new Set(), areas: new Set(['area-a']) });
  assert.deepEqual(a, b);
  assert.deepEqual(a.assign.map((x) => x.id), [...a.assign.map((x) => x.id)].sort());
});

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────
test('CLI: dry run lists, --write assigns, list shows the reason, a manual mark needs --reason', () => {
  const dir = tmp();
  const store = join(dir, 'issues.json');
  const reg = join(dir, 'projects.json');
  writeFileSync(reg, JSON.stringify({ reportsRoot: 'reports', roots: [], projects: [], areas: [{ slug: 'area-a' }] }));
  let gone, kept;
  withIssuesLock(() => {
    const doc = newDoc();
    gone = mint(doc, scanner('laneNeverRegistered'));
    kept = mint(doc, manual());
    saveIssues(doc, { path: store });
  }, { path: store });
  const env = { ...process.env, CW_ISSUES: store, CW_REGISTRY: reg, CW_NOW: T0 };
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: 'utf8', env });

  const dry = run(['unsatisfiable', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.deepEqual(plan.assign.map((a) => a.id), [gone]);
  assert.equal(loadIssues({ path: store }).issues[gone].state, 'open', 'a dry run writes nothing');

  const wrote = run(['unsatisfiable', '--write']);
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.equal(loadIssues({ path: store }).issues[gone].state, 'unsatisfiable');
  assert.equal(run(['unsatisfiable', '--write']).status, 0, 'idempotent: a second pass finds nothing new');

  const list = run(['list', '--state', 'unsatisfiable']);
  assert.match(list.stdout, /lane-retired: scanner category 'laneNeverRegistered'/);

  assert.equal(run(['unsatisfiable', kept]).status, 2);
  const m = run(['unsatisfiable', kept, '--reason', 'target removed', '--by', 'operator']);
  assert.equal(m.status, 0, m.stderr);
  assert.deepEqual(loadIssues({ path: store }).issues[kept].unsatisfiable,
    { code: 'manual', reason: 'target removed', at: T0, by: 'operator' });
  assert.ok(readFileSync(store, 'utf8').includes('issue-unsatisfiable'));
});

test('CLI: against the shipped example registry the area check is unrun and exits 4', () => {
  const dir = tmp();
  const store = join(dir, 'issues.json');
  const env = { ...process.env, CW_ISSUES: store, CW_REGISTRY: join(REPO, 'monitor', 'projects.example.json'), CW_NOW: T0 };
  delete env.CW_REGISTRY_REQUIRE_REAL;
  const r = spawnSync(process.execPath, [CLI, 'unsatisfiable'], { cwd: REPO, encoding: 'utf8', env });
  assert.equal(r.status, 4, r.stderr);
  assert.match(r.stdout, /not checked — area-retired/);
});
