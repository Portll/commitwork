import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateSignal, parseLog, scan, applyAllowlist, loadAllowlist, TOOL } from '../commit-velocity.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-velocity.mjs');
const t0 = 1_700_000_000; // fixed epoch seconds
const commit = (author, minute, paths = []) => ({ sha: `s${author}${minute}`, authorName: author, authorEmail: `${author}@x`, at: t0 + minute * 60, paths });
// Identity env outranks the fixture's `git config user.email`, and the operator's harness sets it
// session-wide, so a fixture commit inherits the operator's address unless the keys are removed.
const fixtureGitEnv = (extra) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)$/.test(k))),
  ...extra,
});

test('a machine-speed commit burst trips machine-speed-commits, a slow human does not', () => {
  const fast = Array.from({ length: 40 }, (_, i) => commit('agent', i)); // 40 commits in 39 min
  const slow = Array.from({ length: 5 }, (_, i) => commit('alice', i * 30)); // 5 over 2h
  const r = rateSignal([...fast, ...slow], { windowMin: 60, commitsPerHour: 30 });
  const rules = r.findings.filter((f) => f.rule === 'machine-speed-commits').map((f) => f.path);
  assert.ok(rules.some((p) => p.startsWith('agent')), 'the 40-in-an-hour author must trip');
  assert.ok(!rules.some((p) => p.startsWith('alice')), 'a human at 5 over 2h must not trip');
});

test('the incident shape: 4.5 days of sustained machine-speed activity trips', () => {
  // ~163/hour sustained; sample one dense hour is enough for the rolling window
  const burst = Array.from({ length: 120 }, (_, i) => commit('sol', i * 0.5)); // 120 in 60 min
  const r = rateSignal(burst, { windowMin: 60, commitsPerHour: 30 });
  assert.equal(r.findings.filter((f) => f.rule === 'machine-speed-commits').length, 1);
});

test('workflow-file edits at machine speed trip workflow-edit-burst separately', () => {
  const wf = Array.from({ length: 10 }, (_, i) => commit('ci', i * 2, ['.github/workflows/deploy.yml']));
  const r = rateSignal(wf, { windowMin: 60, commitsPerHour: 100, workflowPerHour: 6 });
  assert.equal(r.findings.filter((f) => f.rule === 'workflow-edit-burst').length, 1);
  assert.equal(r.findings.filter((f) => f.rule === 'machine-speed-commits').length, 0, 'the high commit threshold suppresses that rule');
});

test('credential/config touches at machine speed trip sensitive-file-burst', () => {
  const sen = Array.from({ length: 20 }, (_, i) => commit('bot', i, ['.claude/settings.json']));
  const r = rateSignal(sen, { windowMin: 60, commitsPerHour: 100, sensitivePerHour: 12 });
  assert.ok(r.findings.some((f) => f.rule === 'sensitive-file-burst'));
});

test('the rolling window is genuinely rolling — a burst spanning the boundary still counts', () => {
  // 20 commits from minute 55 to 75 — no single clock-hour holds all, but a 60m window does
  const spanning = Array.from({ length: 20 }, (_, i) => commit('x', 55 + i));
  const r = rateSignal(spanning, { windowMin: 60, commitsPerHour: 15 });
  assert.ok(r.findings.some((f) => f.rule === 'machine-speed-commits'), 'a window straddling the hour boundary must still see the burst');
});

test('parseLog reads the formatted line then the name-only paths', () => {
  const rec = `\x1eabc\x1fSol\x1fsol@x\x1f${t0}\n.github/workflows/x.yml\nsrc/a.js\n`;
  const parsed = parseLog(rec);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].paths, ['.github/workflows/x.yml', 'src/a.js']);
  assert.equal(parsed[0].at, t0);
});

test('scan on a real repo emits the rule-counts shape; a non-repo exits 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vel-'));
  const run = (args, env) => execFileSync('git', ['-C', d, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  run(['init', '-q']);
  run(['config', 'user.email', 'a@x']); run(['config', 'user.name', 'alice']);
  execFileSync('git', ['-C', d, 'commit', '-q', '--allow-empty', '-m', 'one'], { encoding: 'utf8', env: fixtureGitEnv({ GIT_AUTHOR_DATE: `${t0} +0000`, GIT_COMMITTER_DATE: `${t0} +0000` }) });
  const out = scan(d);
  assert.equal(out.tool, TOOL);
  assert.ok(Array.isArray(out.findings));
  assert.equal(out.summary.commitsScanned, 1);
  rmSync(d, { recursive: true, force: true });

  const empty = mkdtempSync(join(tmpdir(), 'cw-vel-nogit-'));
  try {
    execFileSync(process.execPath, [BIN, empty], { encoding: 'utf8' });
    assert.fail('should exit 2 outside a git repo');
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(JSON.parse(e.stdout).summary.couldNotRun, /not a git repository/);
  }
  rmSync(empty, { recursive: true, force: true });
});

test('a bad env value could-not-run rather than defaulting silently', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vel-env-'));
  execFileSync('git', ['-C', d, 'init', '-q']);
  try {
    execFileSync(process.execPath, [BIN, d], { encoding: 'utf8', env: { ...process.env, CW_VELOCITY_COMMITS_PER_HOUR: 'banana' } });
    assert.fail('should exit 2');
  } catch (e) {
    assert.equal(e.status, 2);
    assert.match(JSON.parse(e.stdout).summary.couldNotRun, /CW_VELOCITY_COMMITS_PER_HOUR/);
  }
  rmSync(d, { recursive: true, force: true });
});

// ── allowlist ────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-16T00:00:00Z');
const finding = (rule, author) => ({ rule, path: `${author} <${author}@x>`, sev: 'high', cwe: 'CWE-799', detail: 'x' });

test('an acknowledged author is suppressed per rule and per repo; an unlisted burst still fires', () => {
  const findings = [finding('machine-speed-commits', 'agent'), finding('workflow-edit-burst', 'agent'), finding('machine-speed-commits', 'stranger')];
  const entries = [{ repo: 'fleet-repo', rule: 'machine-speed-commits', author: 'agent@x', expires: '2027-01-01' }];
  const r = applyAllowlist(findings, entries, { repo: 'fleet-repo', selfScan: false, now: NOW });
  assert.deepEqual(r.findings.map((f) => `${f.rule}:${f.path}`), ['workflow-edit-burst:agent <agent@x>', 'machine-speed-commits:stranger <stranger@x>']);
  assert.equal(r.suppressed, 1);
  const other = applyAllowlist(findings, entries, { repo: 'other-repo', selfScan: false, now: NOW });
  assert.equal(other.suppressed, 0, 'a repo-scoped entry does not reach another repo');
  const full = applyAllowlist(findings, [{ repo: 'fleet-repo', rule: 'machine-speed-commits', author: 'agent <agent@x>', expires: '2027-01-01' }], { repo: 'fleet-repo', selfScan: false, now: NOW });
  assert.equal(full.suppressed, 1, 'the exact `Name <email>` form matches too');
});

test('an expired entry stops suppressing and is counted; an unscoped entry reaches only the self scan', () => {
  const findings = [finding('machine-speed-commits', 'agent')];
  const expired = applyAllowlist(findings, [{ rule: 'machine-speed-commits', author: 'agent@x', expires: '2026-01-01' }], { repo: 'commitwork', selfScan: true, now: NOW });
  assert.equal(expired.suppressed, 0);
  assert.equal(expired.expired, 1);
  const unscoped = [{ rule: 'machine-speed-commits', author: 'agent@x', expires: '2027-01-01' }];
  assert.equal(applyAllowlist(findings, unscoped, { repo: 'commitwork', selfScan: true, now: NOW }).suppressed, 1);
  assert.equal(applyAllowlist(findings, unscoped, { repo: 'commitwork', selfScan: false, now: NOW }).suppressed, 0, 'a checkout merely NAMED commitwork is not the self scan');
});

test('loadAllowlist: absent is empty, a schema failure (no expires) or non-JSON suppresses nothing and says so', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-vel-al-'));
  const p = join(d, 'allow.json');
  assert.deepEqual(loadAllowlist({ CW_VELOCITY_ALLOWLIST: p }), { entries: [] });
  writeFileSync(p, JSON.stringify({ allow: [{ rule: 'machine-speed-commits', author: 'agent@x' }] }));
  const noExpiry = loadAllowlist({ CW_VELOCITY_ALLOWLIST: p });
  assert.deepEqual(noExpiry.entries, []);
  assert.match(noExpiry.unreadable, /schema/);
  writeFileSync(p, '{not json');
  assert.match(loadAllowlist({ CW_VELOCITY_ALLOWLIST: p }).unreadable, /not JSON/);
  writeFileSync(p, JSON.stringify({ allow: [{ rule: 'machine-speed-commits', author: 'agent@x', expires: 'never' }] }));
  assert.match(loadAllowlist({ CW_VELOCITY_ALLOWLIST: p }).unreadable, /schema/, 'an unparseable expiry is refused by shape, not honoured forever');
  rmSync(d, { recursive: true, force: true });
});

test('the shipped allowlist satisfies its schema, and the CLI carries the allowlist counters on a real repo', () => {
  const shipped = loadAllowlist({});
  assert.equal(shipped.unreadable, undefined, shipped.unreadable);
  const d = mkdtempSync(join(tmpdir(), 'cw-vel-cli-'));
  const repo = join(d, 'fleet-repo'); const p = join(d, 'allow.json');
  execFileSync('git', ['-C', d, 'init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'agent@x']); execFileSync('git', ['-C', repo, 'config', 'user.name', 'agent']);
  for (let i = 0; i < 35; i++) {
    const at = `${t0 + i * 60} +0000`;
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', `c${i}`], { env: fixtureGitEnv({ GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }) });
  }
  const run = (env) => JSON.parse(execFileSync(process.execPath, [BIN, repo], { encoding: 'utf8', env: { ...process.env, CW_VELOCITY_ALLOWLIST: p, CW_NOW: '2026-09-16T00:00:00Z', ...env } }));
  const before = run({});
  assert.equal(before.summary.byRule['machine-speed-commits'], 1, 'the planted burst is seen before any suppression');
  assert.equal(before.summary.allowlisted, 0);
  writeFileSync(p, JSON.stringify({ allow: [{ repo: 'fleet-repo', rule: 'machine-speed-commits', author: 'agent@x', expires: '2027-01-01' }] }));
  const after = run({});
  assert.equal(after.summary.byRule['machine-speed-commits'], 0);
  assert.equal(after.summary.allowlisted, 1);
  assert.equal(after.summary.findings, 0);
  writeFileSync(p, JSON.stringify({ allow: [{ repo: 'fleet-repo', rule: 'machine-speed-commits', author: 'agent@x', expires: '2026-01-01' }] }));
  const lapsed = run({});
  assert.equal(lapsed.summary.byRule['machine-speed-commits'], 1);
  assert.equal(lapsed.summary.allowlistExpired, 1);
  rmSync(d, { recursive: true, force: true });
});
