// bin/issue-loop.mjs — the headless auto-remediate driver, on fixtures via the CW_* seams (the
// store is built through the real issue-store library, the agent is faked via CW_ISSUE_AGENT_CMD).
// The invariant every test re-asserts: THE LOOP NEVER CLOSES AN ISSUE — closure is ingest's job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock, loadIssues } from '../../monitor/issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOOP = join(HERE, '..', 'issue-loop.mjs');

const NOW = '2026-08-02T12:00:00.000Z';
const FRESH = '2026-08-02T10:00:00.000Z';   // 2h old — inside the 26h window
const STALE = '2026-07-31T12:00:00.000Z';   // 48h old — outside it
const AREA = 'testarea';

// ── fixture plumbing ────────────────────────────────────────────────────────────
function mkFixture(t, { attemptCount = 0, rollupGenerated = FRESH, issue = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issue-loop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const storePath = join(dir, 'issues.json');
  const doc = emptyIssuesDoc();
  const { id } = mintIssue(doc, {
    area: AREA, title: issue.title ?? 'fixture: outdated dependency', severity: issue.severity ?? 'high',
    repo: null, kind: 'task', body: issue.body ?? 'fixture body', remediation: issue.remediation ?? 'bump it',
    class: 'F',   // manual-sourced: no scanner to infer a class from, so the fixture states one
    source: { kind: 'manual', key: null, tool: null, rule: null },
  }, '2026-08-01T00:00:00.000Z');
  if (attemptCount) doc.issues[id].attemptCount = attemptCount;
  // saveIssues refuses to write without the store's lock; a fixture build is not exempt from it.
  withIssuesLock(() => saveIssues(doc, { path: storePath }), { path: storePath });

  const rollupPath = join(dir, 'rollup.json');
  writeFileSync(rollupPath, JSON.stringify({ generated: rollupGenerated, sliceId: 'sweep-fixture', repos: [] }));

  const outDir = join(dir, 'out');
  mkdirSync(outDir, { recursive: true });
  return { dir, storePath, rollupPath, outDir, id };
}

function writeAgent(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

function runLoop(fx, { args = [], agent = null, extraEnv = {} } = {}) {
  return spawnSync(process.execPath, [LOOP, '--area', AREA, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CW_ISSUES: fx.storePath,
      CW_ROLLUP: fx.rollupPath,
      CW_MONITOR_OUT: fx.outDir,
      CW_NOW: NOW,
      // Without this the loop appends to the REAL agent registry in the sidecar.
      CW_AGENT_TAGS: join(fx.dir, 'agent-tags.jsonl'),
      ...(agent ? { CW_ISSUE_AGENT_CMD: `node ${agent}` } : {}),
      ...extraEnv,
    },
  });
}

function handoffFiles(fx) {
  const d = join(fx.outDir, 'handoff');
  return existsSync(d) ? readdirSync(d) : [];
}

// The invariant: the loop NEVER closes. Not a state, not an event.
function assertNeverClosed(fx) {
  const doc = loadIssues({ path: fx.storePath });
  for (const iss of Object.values(doc.issues)) {
    assert.notEqual(iss.state, 'closed', `${iss.id} was closed by the loop — closure is ingest's job, never the loop's`);
  }
  assert.equal(doc.events.filter((e) => e.type === 'issue-closed').length, 0, 'the loop emitted an issue-closed event');
}

// ── tests ───────────────────────────────────────────────────────────────────────

test('dry-run is the default: no --apply means byte-identical store, no handoff, no spawn, exit 0', (t) => {
  const fx = mkFixture(t);
  const sentinel = join(fx.dir, 'sentinel-dry');
  const agent = writeAgent(fx.dir, 'agent-sentinel.mjs',
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SENTINEL, 'ran');\n`);
  const before = readFileSync(fx.storePath, 'utf8');

  const r = runLoop(fx, { agent, extraEnv: { SENTINEL: sentinel } });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would claim/);
  assert.equal(readFileSync(fx.storePath, 'utf8'), before, 'dry-run mutated the store');
  assert.equal(handoffFiles(fx).length, 0, 'dry-run wrote a handoff file');
  assert.equal(existsSync(sentinel), false, 'dry-run spawned the agent');
  assertNeverClosed(fx);
});

test('stale gate: rollup 48h old ⇒ exit 4 and NOTHING touched, even with --apply', (t) => {
  const fx = mkFixture(t, { rollupGenerated: STALE });
  const sentinel = join(fx.dir, 'sentinel-stale');
  const agent = writeAgent(fx.dir, 'agent-sentinel.mjs',
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SENTINEL, 'ran');\n`);
  const before = readFileSync(fx.storePath, 'utf8');

  const r = runLoop(fx, { args: ['--apply'], agent, extraEnv: { SENTINEL: sentinel } });

  assert.equal(r.status, 4, `expected exit 4, got ${r.status}: ${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /stale/i);
  assert.equal(readFileSync(fx.storePath, 'utf8'), before, 'stale gate mutated the store');
  assert.equal(handoffFiles(fx).length, 0);
  assert.equal(existsSync(sentinel), false, 'stale gate still spawned the agent');
});

test('missing rollup ⇒ exit 4, store untouched', (t) => {
  const fx = mkFixture(t);
  rmSync(fx.rollupPath);
  const before = readFileSync(fx.storePath, 'utf8');
  const r = runLoop(fx, { args: ['--apply'] });
  assert.equal(r.status, 4);
  assert.equal(readFileSync(fx.storePath, 'utf8'), before);
});

test('--apply with a succeeding agent: fix-applied evidence, claim released, state open — never closed', (t) => {
  const fx = mkFixture(t);
  const agent = writeAgent(fx.dir, 'agent-ok.mjs', 'process.exit(0);\n');

  const r = runLoop(fx, { args: ['--apply'], agent });
  assert.equal(r.status, 0, r.stderr);

  const doc = loadIssues({ path: fx.storePath });
  const iss = doc.issues[fx.id];
  assert.equal(iss.state, 'open', 'issue should be released back to open, awaiting sweep evidence');
  assert.equal(iss.claim, null);
  assert.equal(iss.attemptCount, 1);
  const fixApplied = iss.evidence.filter((e) => e.tier === 'fix-applied');
  assert.equal(fixApplied.length, 1);
  assert.match(fixApplied[0].detail, /agent run \d{14}; gate skipped/);
  // the declared skip is recorded in the event data, never silent
  const upd = doc.events.find((e) => e.type === 'issue-updated' && e.issueId === fx.id);
  assert.ok(upd, 'expected an issue-updated event carrying the evidence');
  assert.match(upd.data.gate, /skipped \(no --gate-manifest\)/);

  // handoff file exists, names the issue, and carries the do-not-close instruction
  const files = handoffFiles(fx);
  assert.equal(files.length, 1);
  assert.ok(files[0].startsWith(`${fx.id}-`), `handoff file ${files[0]} should be <id>-<stamp>.md`);
  const handoff = readFileSync(join(fx.outDir, 'handoff', files[0]), 'utf8');
  assert.ok(handoff.includes(fx.id));
  assert.match(handoff, /Do NOT close the issue yourself/);
  assert.match(handoff, /BLOCKED: <reason>/);

  assertNeverClosed(fx);
});

test('failing agent (exit 1): issue blocked with the exit as reason, claim cleared, not closed', (t) => {
  const fx = mkFixture(t);
  const agent = writeAgent(fx.dir, 'agent-fail.mjs', 'process.exit(1);\n');

  const r = runLoop(fx, { args: ['--apply'], agent });
  assert.equal(r.status, 0, r.stderr); // the loop itself completed; the issue carries the failure

  const doc = loadIssues({ path: fx.storePath });
  const iss = doc.issues[fx.id];
  assert.equal(iss.state, 'blocked');
  assert.equal(iss.blockedReason, 'agent exited 1');
  assert.equal(iss.claim, null);
  assert.ok(doc.events.some((e) => e.type === 'issue-blocked' && e.issueId === fx.id));
  assertNeverClosed(fx);
});

test('BLOCKED: marker on exit 0: blocked with the agent-stated reason', (t) => {
  const fx = mkFixture(t);
  const agent = writeAgent(fx.dir, 'agent-blocked.mjs',
    `console.log('tried a few things');\nconsole.log('BLOCKED: cannot repro');\nprocess.exit(0);\n`);

  const r = runLoop(fx, { args: ['--apply'], agent });
  assert.equal(r.status, 0, r.stderr);

  const doc = loadIssues({ path: fx.storePath });
  const iss = doc.issues[fx.id];
  assert.equal(iss.state, 'blocked');
  assert.equal(iss.blockedReason, 'cannot repro');
  assert.equal(iss.evidence.filter((e) => e.tier === 'fix-applied').length, 0, 'a blocked run must not record fix-applied');
  assertNeverClosed(fx);
});

test('attempt cap: attemptCount already at --max-attempts ⇒ blocked WITHOUT spawning the agent', (t) => {
  const fx = mkFixture(t, { attemptCount: 2 });
  const sentinel = join(fx.dir, 'sentinel-cap');
  const agent = writeAgent(fx.dir, 'agent-sentinel.mjs',
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SENTINEL, 'ran');\n`);

  const r = runLoop(fx, { args: ['--apply'], agent, extraEnv: { SENTINEL: sentinel } });
  assert.equal(r.status, 0, r.stderr);

  const doc = loadIssues({ path: fx.storePath });
  const iss = doc.issues[fx.id];
  assert.equal(iss.state, 'blocked');
  assert.equal(iss.blockedReason, 'attempt cap reached');
  assert.equal(iss.attemptCount, 2, 'a cap-block must not consume another attempt');
  assert.equal(existsSync(sentinel), false, 'capped issue still reached the agent');
  assert.equal(handoffFiles(fx).length, 0, 'capped issue still got a handoff');
  assertNeverClosed(fx);
});

test('two consecutive successful runs still never close — closure stays with the sweep', (t) => {
  const fx = mkFixture(t);
  const agent = writeAgent(fx.dir, 'agent-ok.mjs', 'process.exit(0);\n');

  const r1 = runLoop(fx, { args: ['--apply'], agent });
  assert.equal(r1.status, 0, r1.stderr);
  const r2 = runLoop(fx, { args: ['--apply'], agent });
  assert.equal(r2.status, 0, r2.stderr);

  const doc = loadIssues({ path: fx.storePath });
  const iss = doc.issues[fx.id];
  assert.equal(iss.state, 'open');
  assert.equal(iss.attemptCount, 2);
  assert.equal(iss.evidence.filter((e) => e.tier === 'fix-applied').length, 2);
  assertNeverClosed(fx);
});
