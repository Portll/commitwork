// lib/security-posture.mjs — the agent-security settings: each default, env override and
// store value, the stricter reading when either cannot be trusted, isUnattended's truth table, what an
// ask becomes under each posture, the posture C writer, and the flags the posture adds to a claude argv.
// Every store is a fixture; nothing reads or writes ~/.commitwork.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

const T = mkdtempSync(join(tmpdir(), 'cw-secp-'));
const STORE = join(T, 'settings.json');
const QUEUE = join(T, 'sidecar', 'approval-queue.jsonl');
const ENV_KEYS = ['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_UNATTENDED_POSTURE', 'CW_BYPASS_IS_UNATTENDED', 'CW_MISSING_MODE_IS_UNATTENDED',
  'CW_MCP_REPO_ROOTS', 'CW_MCP_REPO_CODE', 'CW_MCP_REPO_CODE_REPOS', 'CW_MCP_REPO_ROOTS_REVIEW_DAYS', 'CW_GUARD_UNATTENDED', 'CW_APPROVAL_QUEUE', 'CW_CLAUDE_GUARD_DIR', 'CW_NOW'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ENV_KEYS) delete process.env[k];
process.env.CW_SETTINGS = STORE;
process.env.CW_APPROVAL_QUEUE = QUEUE;
process.env.CW_CLAUDE_GUARD_DIR = join(T, 'guard');
after(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(T, { recursive: true, force: true });
});

const sp = await import('../security-posture.mjs');
const { claudeArgs, PROFILES, GUARD_HOOK } = await import('../claude-spawn.mjs');
const { setSettings, resetSettingsWarnings } = await import('../../monitor/settings.mjs');

const putStore = (settings) => writeFileSync(STORE, JSON.stringify({ v: 1, settings }));
beforeEach(() => { rmSync(STORE, { force: true }); rmSync(QUEUE, { force: true }); resetSettingsWarnings(); });

// The declared defaults DENY. An allowlist naming nothing allows no repository, and repo code waits
// on an opt-in.
test('defaults: posture A, bypass not counted, a missing mode counted as unattended, an allowlist that allows nothing, repo code opt-in', () => {
  assert.deepEqual(sp.postureFor({}), { mode: 'A', source: 'default' });
  assert.equal(sp.securitySetting('bypassCountsAsUnattended', { env: {} }).value, false);
  assert.equal(sp.securitySetting('missingModeIsUnattended', { env: {} }).value, true, 'measured 2026-10-19: Claude Code sends permission_mode');
  assert.deepEqual(sp.runChecksRootsFor({}), { roots: [], source: 'default' },
    'an empty allowlist is the default, and mcp/server.mjs refuses every repository under it');
  assert.deepEqual(sp.runChecksRepoCodeFor({}), { mode: 'opt-in', source: 'default' });
});

test('the env overrides the store, read at call time, and names its variable', () => {
  putStore({ unattendedPosture: 'off', runChecksRepoCode: 'allow', bypassCountsAsUnattended: false });  // 'allow' is now the non-default
  assert.equal(sp.postureFor({}).source, 'store');
  assert.deepEqual(sp.postureFor({ CW_UNATTENDED_POSTURE: 'c' }), { mode: 'C', source: 'env:CW_UNATTENDED_POSTURE' });
  assert.equal(sp.postureFor({ CW_UNATTENDED_POSTURE: 'OFF' }).mode, 'off');
  assert.equal(sp.securitySetting('bypassCountsAsUnattended', { env: { CW_BYPASS_IS_UNATTENDED: '1' } }).value, true);
  assert.equal(sp.securitySetting('missingModeIsUnattended', { env: { CW_MISSING_MODE_IS_UNATTENDED: 'yes' } }).value, true);
  assert.deepEqual(sp.runChecksRootsFor({ CW_MCP_REPO_ROOTS: `/a${delimiter}/b${delimiter}` }).roots, ['/a', '/b']);
  assert.equal(sp.runChecksRepoCodeFor({ CW_MCP_REPO_CODE: 'opt-in' }).mode, 'opt-in');
  // process.env is the default, read when called
  process.env.CW_UNATTENDED_POSTURE = 'B';
  try { assert.equal(sp.postureFor().mode, 'B'); } finally { delete process.env.CW_UNATTENDED_POSTURE; }
});

test('an invalid env value reads as the stricter setting with the reason, never as the default', () => {
  assert.deepEqual(sp.postureFor({ CW_UNATTENDED_POSTURE: 'of' }).mode, 'A');
  assert.match(sp.postureFor({ CW_UNATTENDED_POSTURE: 'of' }).error, /must be one of off, A, B, C/);
  assert.equal(sp.securitySetting('bypassCountsAsUnattended', { env: { CW_BYPASS_IS_UNATTENDED: 'maybe' } }).value, true);
  assert.equal(sp.runChecksRepoCodeFor({ CW_MCP_REPO_CODE: 'sometimes' }).mode, 'opt-in');
  const r = sp.runChecksRootsFor({ CW_MCP_REPO_ROOTS: 'relative/dir' });
  assert.equal(r.roots, null);
  assert.match(r.error, /not absolute/);
});

test('a corrupt store, or one invalid stored value, reads strict: run_checks roots become unknown', () => {
  writeFileSync(STORE, '{not json');
  assert.equal(sp.postureFor({}).source, 'corrupt-store-fallback');
  assert.equal(sp.postureFor({}).mode, 'A');
  assert.equal(sp.runChecksRootsFor({}).roots, null);
  assert.equal(sp.runChecksRepoCodeFor({}).mode, 'opt-in');
  assert.equal(sp.securitySetting('missingModeIsUnattended', { env: {} }).value, true);
  putStore({ runChecksRoots: ['rel'] });
  assert.match(sp.runChecksRootsFor({}).error, /invalid runChecksRoots/);
});

test('the store write validates each key and is attributed', () => {
  assert.equal(setSettings({ unattendedPosture: 'D' }, { who: 'op' }).code, 400);
  assert.equal(setSettings({ runChecksRoots: ['/'] }, { who: 'op' }).code, 400);
  assert.equal(setSettings({ runChecksRoots: ['/a', '/a/'] }, { who: 'op' }).code, 400);
  assert.equal(setSettings({ bypassCountsAsUnattended: 'true' }, { who: 'op' }).code, 400);
  const r = setSettings({ unattendedPosture: 'C', runChecksRoots: ['/srv/repos'] }, { who: 'op@example.test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = sp.securitySetting('unattendedPosture', { env: {} });
  assert.deepEqual([s.value, s.source, s.setBy], ['C', 'store', 'op@example.test']);
  assert.deepEqual(sp.runChecksRootsFor({}).roots, ['/srv/repos']);
});

test('isUnattended: the truth table', () => {
  const on = { bypassCountsAsUnattended: true, missingModeIsUnattended: true };
  const rows = [
    // [store, env, permissionMode, expected]
    [{}, { CW_GUARD_UNATTENDED: '1' }, 'default', true],
    [{}, { CW_GUARD_UNATTENDED: '1' }, undefined, true],
    [{}, { CW_GUARD_UNATTENDED: '0' }, 'default', false],
    [{}, {}, 'default', false],
    [{}, {}, 'auto', false],
    [{}, {}, 'acceptEdits', false],
    [{}, {}, 'plan', false],
    [{}, {}, 'bypassPermissions', false],
    [{}, {}, 'dontAsk', false],
    [{}, {}, undefined, true],
    [{}, {}, '', true],
    [{ missingModeIsUnattended: false }, {}, undefined, false],
    [{}, { CW_MISSING_MODE_IS_UNATTENDED: '0' }, undefined, false],
    [on, {}, 'bypassPermissions', true],
    [on, {}, 'dontAsk', true],
    [on, {}, 'default', false],
    [on, {}, 'auto', false],
    [on, {}, undefined, true],
    [on, {}, null, true],
    [{ bypassCountsAsUnattended: true }, {}, undefined, true],
    [{ missingModeIsUnattended: true }, {}, 'dontAsk', false],
    [{}, { CW_BYPASS_IS_UNATTENDED: 'on' }, 'bypassPermissions', true],
    [{}, { CW_MISSING_MODE_IS_UNATTENDED: '1' }, undefined, true],
  ];
  for (const [store, env, permissionMode, want] of rows) {
    putStore(store);
    assert.equal(sp.isUnattended({ env, permissionMode }), want, `${JSON.stringify(store)} ${JSON.stringify(env)} ${permissionMode}`);
  }
});

test('what an ask becomes: attended always asks; unattended follows the posture', () => {
  const U = { CW_GUARD_UNATTENDED: '1' };
  const out = (mode, askClass, env = U) => sp.askOutcome({ askClass, env: { ...env, CW_UNATTENDED_POSTURE: mode } });
  const attended = (mode, askClass) => sp.askOutcome({ askClass, env: { CW_UNATTENDED_POSTURE: mode }, permissionMode: 'default' });
  for (const c of sp.ASK_CLASSES) {
    assert.equal(attended('A', c).decision, 'ask', `attended ${c}`);
    assert.equal(out('off', c).decision, c === 'posture-write' ? 'deny' : 'ask', `off ${c}`);
    assert.equal(out('A', c).decision, 'deny', `A ${c}`);
    assert.deepEqual([out('C', c).decision, out('C', c).record], ['deny', true], `C ${c}`);
    assert.equal(out('A', c).record, false);
    assert.equal(attended('A', c).recordAllowed, false, `attended ${c} records nothing`);
  }
  const B = ['push', 'secret-read', 'outbound-write', 'recursive-delete', 'ledger-modify', 'destructive-git', 'posture-write'];
  assert.deepEqual(B.map((c) => out('B', c).decision), ['deny', 'deny', 'deny', 'ask', 'deny', 'ask', 'deny']);
  assert.deepEqual(B.map((c) => out('B', c).recordAllowed), [false, false, false, true, false, true, false], 'B records what it lets through');
  assert.equal(out('off', 'recursive-delete').recordAllowed, false, 'off records nothing');
  assert.equal(out('B', 'some-new-site').decision, 'deny', 'an unnamed class is not let through B');
});

test('posture B writer: an allowed row carries state allowed, posture B and an ALW id', () => {
  process.env.CW_NOW = '2026-10-13T01:02:03.000Z';
  try {
    const before = existsSync(QUEUE) ? readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean).length : 0;
    const r = sp.recordAllowed({ tool: 'Bash', askClass: 'recursive-delete', command: 'rm -rf /tmp/x', reason: 'unattended delete under B' });
    assert.match(r.id, /^ALW-[0-9a-f]{12}$/);
    assert.equal(r.entry.state, 'allowed');
    assert.equal(r.entry.posture, 'B');
    const lines = readFileSync(QUEUE, 'utf8').trim().split('\n');
    assert.equal(lines.length, before + 1);
    assert.throws(() => sp.recordAllowed({ tool: 'Bash' }), /^Error: recordAllowed: reason is required/);
  } finally { delete process.env.CW_NOW; }
});

test('repo-code repositories: none by default, an operator list from env or store, and nothing granted when unreadable', () => {
  assert.deepEqual(sp.runChecksRepoCodeReposFor({}), { repos: [], source: 'default' });
  assert.deepEqual(sp.runChecksRepoCodeReposFor({ CW_MCP_REPO_CODE_REPOS: `/r/a${delimiter}/r/b` }).repos, ['/r/a', '/r/b']);
  putStore({ runChecksRepoCodeRepos: { value: ['/r/c'], at: '2026-10-13T00:00:00.000Z', by: 'op' } });
  assert.deepEqual(sp.runChecksRepoCodeReposFor({}), { repos: ['/r/c'], source: 'store' });
  const bad = sp.runChecksRepoCodeReposFor({ CW_MCP_REPO_CODE_REPOS: 'relative' });
  assert.deepEqual([bad.repos, bad.source], [[], 'invalid-env']);
  assert.match(bad.error, /not absolute/);
});

test('roots review: measured from the store save date; env roots, empty roots and 0 days keep no date', () => {
  putStore({ runChecksRoots: { value: ['/r'], at: '2026-09-01T00:00:00.000Z', by: 'op' } });
  const late = sp.runChecksRootsReview({ CW_NOW: '2026-10-13T00:00:00.000Z' });
  assert.deepEqual([late.overdue, late.due, late.days], [true, '2026-10-01T00:00:00.000Z', 30]);
  assert.equal(sp.runChecksRootsReview({ CW_NOW: '2026-09-20T00:00:00.000Z' }).overdue, false);
  assert.equal(sp.runChecksRootsReview({ CW_NOW: '2026-10-13T00:00:00.000Z', CW_MCP_REPO_ROOTS_REVIEW_DAYS: '60' }).overdue, false);
  assert.deepEqual(sp.runChecksRootsReview({ CW_NOW: '2026-10-13T00:00:00.000Z', CW_MCP_REPO_ROOTS_REVIEW_DAYS: '0' }).due, null);
  assert.equal(sp.runChecksRootsReview({ CW_NOW: '2026-10-13T00:00:00.000Z', CW_MCP_REPO_ROOTS: '/r' }).overdue, false);
  assert.equal(sp.securitySetting('runChecksRootsReviewDays', { env: { CW_MCP_REPO_ROOTS_REVIEW_DAYS: 'soon' } }).source, 'invalid-env');
  putStore({ runChecksRoots: { value: [], at: '2026-01-01T00:00:00.000Z', by: 'op' } });
  assert.equal(sp.runChecksRootsReview({ CW_NOW: '2026-10-13T00:00:00.000Z' }).overdue, false, 'an empty list allows nothing to review');
});

test('posture C writer: one JSON line per refusal, attributed fields, hashed subject, deterministic id', () => {
  process.env.CW_NOW = '2026-10-08T01:02:03.000Z';
  try {
    const a = sp.recordRefusal({ tool: 'Bash', askClass: 'push', command: 'git push origin main', cwd: '/r', sessionId: 's1', permissionMode: 'dontAsk', unattendedWhy: 'x', reason: 'unattended push' });
    const b = sp.recordRefusal({ tool: 'Edit', askClass: 'ledger-modify', path: '/r/.claude/store/x.jsonl', reason: 'ledger edit' });
    assert.equal(a.path, QUEUE);
    const lines = readFileSync(QUEUE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].id, a.id);
    assert.match(a.id, /^REF-[0-9a-f]{12}$/);
    assert.deepEqual([lines[0].at, lines[0].posture, lines[0].state, lines[0].command, lines[0].sessionId], ['2026-10-08T01:02:03.000Z', 'C', 'refused', 'git push origin main', 's1']);
    assert.equal(lines[1].path, '/r/.claude/store/x.jsonl');
    assert.match(lines[0].subjectHash, /^[0-9a-f]{64}$/);
    assert.equal((statSync(QUEUE).mode & 0o777).toString(8), '600');
    rmSync(QUEUE);
    assert.equal(sp.recordRefusal({ tool: 'Bash', askClass: 'push', command: 'git push origin main', cwd: '/r', sessionId: 's1', permissionMode: 'dontAsk', unattendedWhy: 'x', reason: 'unattended push' }).id, a.id, 'same inputs, same id');
    const long = sp.recordRefusal({ tool: 'Bash', command: 'x'.repeat(5000), reason: 'r' }).entry.command;
    assert.ok(long.length < 4200 && long.endsWith('more]'));
  } finally { delete process.env.CW_NOW; }
  assert.deepEqual(sp.readRefusals().entries.length, 2);
});

test('posture C writer refuses a bad entry, and an absent sidecar is an error, never a created dir', (t) => {
  assert.throws(() => sp.recordRefusal({ reason: 'r' }), /tool is required/);
  assert.throws(() => sp.recordRefusal({ tool: 'Bash' }), /reason is required/);
  assert.throws(() => sp.recordRefusal(null), /must be an object/);
  delete process.env.CW_APPROVAL_QUEUE;
  try {
    const p = sp.approvalQueuePath();
    assert.match(p, /monitor\/private\/approval-queue\.jsonl$/);
    // never written here: where the sidecar link exists this would append to the operator's real queue
    if (existsSync(join(p, '..'))) { t.skip('this checkout has its sidecar dir; a clone or git-archive export runs the absent case'); return; }
    assert.throws(() => sp.recordRefusal({ tool: 'Bash', reason: 'r' }), /sidecar directory .* is absent/);
    assert.equal(existsSync(join(p, '..')), false, 'the sidecar dir was created');
  } finally { process.env.CW_APPROVAL_QUEUE = QUEUE; }
});

test('the queue reader: absent is empty, a bad line is an error with what was read', () => {
  assert.deepEqual(sp.readRefusals(), { ok: true, path: QUEUE, entries: [], error: null });
  sp.recordRefusal({ tool: 'Bash', reason: 'r' });
  writeFileSync(QUEUE, `${readFileSync(QUEUE, 'utf8')}{torn\n`);
  const r = sp.readRefusals();
  assert.equal(r.ok, false);
  assert.match(r.error, /line 2/);
  assert.equal(r.entries.length, 1);
});

// ── the posture reaching a claude argv ───────────────────────────────────────────────────────────
const after1 = (a, f) => a[a.indexOf(f) + 1];

test('posture off: every profile builds its argv with no posture flags', () => {
  const env = { CW_UNATTENDED_POSTURE: 'off', CW_CLAUDE_GUARD_DIR: join(T, 'guard') };
  for (const [name, p] of Object.entries(PROFILES)) {
    const a = claudeArgs({ ...p, env });
    assert.ok(!a.includes('--settings'), name);
    assert.equal(after1(a, '--setting-sources'), p.settingSources ?? '', name);
    assert.equal(a.includes('--permission-prompts'), name === 'codeql', name);
  }
});

test('posture A/B/C: unattended -p runs refuse prompts, guarded profiles load only the guard', () => {
  for (const mode of ['A', 'B', 'C']) {
    const env = { CW_UNATTENDED_POSTURE: mode, CW_CLAUDE_GUARD_DIR: join(T, 'guard') };
    for (const [name, p] of Object.entries(PROFILES)) {
      const a = claudeArgs({ ...p, env });
      assert.equal(after1(a, '--permission-prompts') === 'none', !!p.unattended && p.print !== false, `${mode} ${name}`);
      assert.equal(a.includes('--settings'), !!p.guarded, `${mode} ${name}`);
      if (p.guarded) assert.equal(after1(a, '--setting-sources'), '', `${mode} ${name}`);
      assert.equal(a.at(-1), '--strict-mcp-config', name);
    }
  }
  assert.equal(PROFILES.handoff.unattended, undefined, 'the handoff is attended: its prompts reach a person');
  assert.deepEqual(Object.entries(PROFILES).filter(([, p]) => p.guarded).map(([n]) => n).sort(), ['handoff', 'issueLoop']);
});

test('the posture is read from the store when the env is silent', () => {
  putStore({ unattendedPosture: 'off' });
  assert.ok(!claudeArgs({ ...PROFILES.daily, env: {} }).includes('--permission-prompts'));
  putStore({ unattendedPosture: 'B' });
  assert.equal(after1(claudeArgs({ ...PROFILES.daily, env: {} }), '--permission-prompts'), 'none');
});

test('the guard settings file wires guard-destructive with absolute paths, named by its content', () => {
  const dir = join(T, 'guard-file');
  const a = claudeArgs({ ...PROFILES.issueLoop, env: { CW_UNATTENDED_POSTURE: 'A', CW_CLAUDE_GUARD_DIR: dir } });
  const f = after1(a, '--settings');
  assert.match(f, /guard-settings-[0-9a-f]{12}\.json$/);
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const h = j.hooks.PreToolUse[0];
  const surface = JSON.parse(readFileSync(new URL('../../manifests/agent-surface.json', import.meta.url), 'utf8'));
  assert.equal(h.matcher, surface.hooks['guard-destructive'].matcher, 'a spawned session gets the matcher the checkout declares');
  assert.match(h.matcher, /(?:^|\|)Read(?:\||$)/);
  assert.equal(h.hooks[0].command, `${JSON.stringify(process.execPath)} ${JSON.stringify(GUARD_HOOK)}`);
  assert.ok(existsSync(GUARD_HOOK));
  const before = statSync(f).mtimeMs;
  assert.equal(after1(claudeArgs({ ...PROFILES.handoff, env: { CW_UNATTENDED_POSTURE: 'C', CW_CLAUDE_GUARD_DIR: dir } }), '--settings'), f, 'one file per content');
  assert.equal(statSync(f).mtimeMs, before, 'an identical file is not rewritten');
  assert.deepEqual(readdirSync(dir), [f.split('/').at(-1)], 'no tmp file left behind');
});
