// bin/annotate.mjs's write path: the `claim` field (additive, non-identity, structured-only) and
// the C-5 fatigue ledger (kind:'suppression-label') it must emit on every accept/wont-fix write.
// Pure-function unit tests live in monitor/test/scanner-annotations.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJournalFile, adjudicationsPath } from '../lib/verdict-journal-core.mjs';
import { acquireLock } from '../../monitor/lockfile.mjs';
import { annotationsLockPath } from '../../monitor/annotate-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANNOTATE = join(HERE, '..', 'annotate.mjs');
const NOW = '2026-08-10T00:00:00.000Z';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cw-annotate-'));
  return { root, annPath: join(root, 'annotations.json'), verdictDir: join(root, 'verdicts') };
}

const run = (fx, args) => spawnSync(process.execPath, [ANNOTATE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CW_ANNOTATIONS: fx.annPath, CW_VERDICT_DIR: fx.verdictDir, CW_NOW: NOW },
});

const labels = (fx) => readJournalFile(adjudicationsPath(fx.verdictDir)).records.filter((r) => r.kind === 'suppression-label');
const store = (fx) => JSON.parse(readFileSync(fx.annPath, 'utf8'));

const ARGS = ['add', '--category', 'secrets', '--repo', 'alpha', '--rule', 'aws-key', '--file', 'src/a.js', '--reason', 'r', '--who', 'tester'];
const EXPIRES = '2027-01-01T00:00:00.000Z';
const ARGS_EXP = [...ARGS, '--expires', EXPIRES];

// R2: expires is REQUIRED at write time — a suppression on a version-less identity is otherwise a
// permanent blindfold. requireExpires unit coverage: monitor/test/scanner-annotations.test.mjs.
test('an accept write with no --expires is refused before any write — naming why', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS, '--action', 'accept']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /missing expires/);
  assert.equal(existsSync(fx.annPath), false, 'a refused record never reaches the store');
  assert.deepEqual(labels(fx), [], 'a refused write must never label a suppression that never happened');
});

test('an accept write WITH --expires is accepted, carries expires, and is never flagged noExpires', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'accept']);
  assert.equal(r.status, 0, r.stderr);
  const ls = labels(fx);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].target, 'secrets:aws-key|src/a.js@alpha');
  assert.equal(ls[0].action, 'accept');
  assert.equal(ls[0].count, 1);
  assert.equal(ls[0].who, 'tester');
  assert.equal(ls[0].at, NOW);
  assert.equal(ls[0].expires, EXPIRES);
  assert.equal(ls[0].noExpires, undefined);
});

test('a wont-fix write also labels (never flagged noExpires — that flag is accept-specific)', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'wont-fix']);
  assert.equal(r.status, 0, r.stderr);
  const ls = labels(fx);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].action, 'wont-fix');
  assert.equal(ls[0].noExpires, undefined);
});

test('false-positive and note writes do NOT label — only accept/wont-fix are suppression fatigue', () => {
  const fx1 = fixture();
  assert.equal(run(fx1, [...ARGS_EXP, '--action', 'false-positive']).status, 0);
  assert.deepEqual(labels(fx1), [], 'false-positive is a machine-truth judgment (adjudication-import.mjs derives `truth` from it directly)');

  const fx2 = fixture();
  assert.equal(run(fx2, [...ARGS_EXP, '--action', 'note']).status, 0);
  assert.deepEqual(labels(fx2), []);
});

test('two identical accept writes append two separate suppression-labels — events are events', () => {
  const fx = fixture();
  assert.equal(run(fx, [...ARGS_EXP, '--action', 'accept']).status, 0);
  assert.equal(run(fx, [...ARGS_EXP, '--action', 'accept']).status, 0);
  assert.equal(store(fx).scannerAnnotations.length, 2, 'the write path never dedupes');
  assert.equal(labels(fx).length, 2, 'each WRITE is its own suppression event, even addressing the same place twice');
});

test('--claim remediated is accepted, stored, and never enters the place-identity target', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'accept', '--claim', 'remediated']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(store(fx).scannerAnnotations[0].claim, 'remediated');
  const ls = labels(fx);
  assert.equal(ls.length, 1);
  assert.equal(ls[0].target, 'secrets:aws-key|src/a.js@alpha', 'claim is additive metadata, not identity');
});

test('an unknown --claim value is refused before any write — structured only, never free text', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'accept', '--claim', 'because I said so']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown claim/);
  assert.equal(existsSync(fx.annPath), false, 'a refused record never reaches the store');
  assert.deepEqual(labels(fx), [], 'a refused write must never label a suppression that never happened');
});

test('a --dry run writes neither the annotation nor a suppression-label', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'accept', '--dry']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(fx.annPath), false);
  assert.deepEqual(labels(fx), []);
});

test('a write refused by validation (e.g. missing --file) labels nothing', () => {
  const fx = fixture();
  const r = run(fx, ['add', '--category', 'secrets', '--repo', 'alpha', '--rule', 'aws-key', '--action', 'accept', '--reason', 'r', '--who', 'tester']);
  assert.notEqual(r.status, 0, 'missing identity field `file` must refuse the write');
  assert.deepEqual(labels(fx), []);
});

// ---- C2 lock: the shared path, and contention -----------------------------------------------
// bin/annotate.mjs and admin/routes/annotations.mjs must lock the SAME file; proven by pre-taking
// the exact path annotationsLockPath() derives, not by comparing strings.

test('the CLI write path locks the exact path annotationsLockPath() derives — pre-holding it refuses the write, cleanly, with data intact', () => {
  const fx = fixture();
  assert.equal(run(fx, [...ARGS_EXP, '--action', 'false-positive', '--rule', 'seed-rule']).status, 0, 'seed write');
  const before = readFileSync(fx.annPath, 'utf8');

  const lockPath = annotationsLockPath(fx.annPath);
  const held = acquireLock(lockPath, { label: 'other-writer' });
  assert.ok(held.ok, 'test setup: must be able to take the lock the CLI is expected to honour');
  try {
    const r = run(fx, [...ARGS_EXP, '--action', 'accept']);
    assert.notEqual(r.status, 0, 'a write against a lock already held elsewhere must not silently proceed');
    assert.match(r.stderr, /locked by another writer/);
    assert.match(r.stderr, /other-writer/, 'the refusal names the holder, not just "locked"');
    assert.equal(readFileSync(fx.annPath, 'utf8'), before, 'a contended write must never touch the store');
    assert.deepEqual(labels(fx), [], 'and must never label a suppression event that never happened');
  } finally {
    held.release();
  }

  // released: the identical write goes through — the refusal was contention, nothing else
  const r2 = run(fx, [...ARGS_EXP, '--action', 'accept']);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(store(fx).scannerAnnotations.length, 2);
});

// ── BACKLOG item T: the success line must state the EFFECT, not the store size ───────────────────
// A record binding zero rows is a no-op that reads like a completed suppression. Three endings,
// because they are three different states and only one is a working suppression.

const rollupWith = (fx, rows) => {
  const p = join(fx.root, 'rollup.json');
  writeFileSync(p, JSON.stringify({ scannerFindings: { secrets: rows } }));
  return p;
};
// A row the fixture record (repo alpha / rule aws-key / file src/a.js) genuinely binds to, and one
// it cannot — identity is on (repo, rule, file), never the line.
const MATCHING_ROW = { repo: 'alpha', rule: 'aws-key', file: 'src/a.js', line: 12, severity: 'high' };
const OTHER_ROW = { repo: 'alpha', rule: 'private-key', file: 'src/z.js', line: 3, severity: 'high' };

test('T: with a proven match, the success line says how many rows it binds — not how big the store is', () => {
  const fx = fixture();
  const rollup = rollupWith(fx, [MATCHING_ROW, OTHER_ROW]);
  const r = run(fx, [...ARGS_EXP, '--action', 'accept', '--check-rollup', rollup]);
  assert.equal(r.status, 0, r.stderr);
  const last = r.stdout.trim().split('\n').pop();
  assert.match(last, /appended to /);
  assert.match(last, /matches 1 of 2 published secrets row\(s\)/,
    'the line that gets believed must carry the effect');
});

test('T: a ZERO-match write forced through says it suppresses nothing — "appended" must not read as done', () => {
  const fx = fixture();
  const rollup = rollupWith(fx, [OTHER_ROW]);
  const r = run(fx, [...ARGS_EXP, '--action', 'accept', '--check-rollup', rollup, '--force']);
  assert.equal(r.status, 0, r.stderr);
  const last = r.stdout.trim().split('\n').pop();
  assert.match(last, /matches ZERO of 1 published secrets row\(s\)/);
  assert.match(last, /suppresses nothing as written/,
    'writing it may be right — a finding expected to reappear — but it is not a completed suppression');
  assert.equal(store(fx).scannerAnnotations.length, 1, '--force still writes; it is the WORDS that change');
});

test('T: with no --check-rollup the success line states the absence, never a number it does not have', () => {
  const fx = fixture();
  const r = run(fx, [...ARGS_EXP, '--action', 'accept']);
  assert.equal(r.status, 0, r.stderr);
  const last = r.stdout.trim().split('\n').pop();
  assert.match(last, /NOT VERIFIED/);
  assert.doesNotMatch(last, /matches \d/, 'an unrun check must not produce a count — that is the defect, inverted');
});
