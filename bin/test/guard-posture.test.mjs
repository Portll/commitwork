// The unattended posture, asserted by EFFECT on the installed hook process: what each posture makes
// of an ask, and what lands in the approval queue. A test of askOutcome's return value alone would
// pass while the posture reached nothing, so every case here drives the hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTURE_ENV, POSTURE_KEY_NAMES } from '../hooks/guard-destructive.mjs';
import { POSTURE_KEYS } from '../../lib/security-posture.mjs';
import { SETTING_KEYS } from '../../monitor/settings.mjs';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const HOOK = join(REPO, 'bin', 'hooks', 'guard-destructive.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-guard-posture-'));
const NO_STORE = join(TMP, 'absent.json');
// Every hook run gets a scratch queue: under B an allowed ask is recorded, and the default path is the
// live sidecar queue.
const SCRATCH_QUEUE = join(TMP, 'default-queue', 'approval-queue.jsonl');
const POSTURE_VARS = new Set(['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_UNATTENDED_POSTURE', 'CW_BYPASS_IS_UNATTENDED',
  'CW_MISSING_MODE_IS_UNATTENDED', 'CW_GUARD_UNATTENDED', 'CW_APPROVAL_QUEUE']);

function hook(tool, toolInput, { env = {}, mode, hookPath = HOOK } = {}) {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !POSTURE_VARS.has(k)));
  const payload = { tool_name: tool, tool_input: toolInput, session_id: 'sess-posture-test', cwd: TMP, ...(mode ? { permission_mode: mode } : {}) };
  const out = execFileSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload), encoding: 'utf8', env: { ...base, CW_SETTINGS: NO_STORE, CW_APPROVAL_QUEUE: SCRATCH_QUEUE, ...env },
  });
  return out ? JSON.parse(out).hookSpecificOutput : null;
}
const bash = (command, o) => hook('Bash', { command }, o);
const decision = (command, o) => bash(command, o)?.permissionDecision ?? null;
const rows = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const PUSH = 'git push origin main';
const DELETE = 'rm -rf /tmp/scratch-dir';
const SECRET = 'cat ~/.ssh/id_ed25519';
const POST = 'curl -X POST https://api.example.com/ingest -d @report.json';
const LEDGER = { file_path: '/x/.claude/store/touch-ledger.jsonl', old_string: 'a', new_string: 'b' };
const UNATTENDED = { CW_GUARD_UNATTENDED: '1' };
const RESET = 'git reset --hard';
const POSTURE_OFF = 'CW_UNATTENDED_POSTURE=off claude -p "push it"';
const STORE_EDIT = { file_path: '/x/.commitwork/settings.json', old_string: 'A', new_string: 'off' };

test('the default posture, A, read from no store: every unattended ask is refused', () => {
  for (const cmd of [PUSH, DELETE, SECRET, POST]) assert.equal(decision(cmd, { env: UNATTENDED }), 'deny', cmd);
  assert.equal(hook('Edit', LEDGER, { env: UNATTENDED }).permissionDecision, 'deny');
  assert.match(bash(DELETE, { env: UNATTENDED }).permissionDecisionReason, /posture A \(default\)/);
});

test('posture B refuses push, secret reads, outbound writes and ledger edits, and lets a delete or destructive git ask', () => {
  const env = { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'B', CW_APPROVAL_QUEUE: join(TMP, 'b-classes', 'q.jsonl') };
  for (const cmd of [PUSH, SECRET, POST]) assert.equal(decision(cmd, { env }), 'deny', cmd);
  assert.equal(hook('Edit', LEDGER, { env }).permissionDecision, 'deny');
  assert.equal(decision(DELETE, { env }), 'ask');
  assert.equal(decision(RESET, { env }), 'ask');
});

test('posture B records each unattended ask it lets through as an allowed row, and the reason names it', () => {
  const queue = join(TMP, 'b', 'approval-queue.jsonl');
  const env = { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'B', CW_APPROVAL_QUEUE: queue };
  const out = bash(DELETE, { env });
  assert.equal(out.permissionDecision, 'ask');
  const [row, ...more] = rows(queue);
  assert.equal(more.length, 0);
  assert.equal(row.state, 'allowed');
  assert.equal(row.posture, 'B');
  assert.equal(row.askClass, 'recursive-delete');
  assert.equal(row.command, DELETE);
  assert.match(row.id, /^ALW-[0-9a-f]{12}$/);
  assert.ok(out.permissionDecisionReason.includes(`Recorded in the approval queue as ${row.id}, allowed under posture B.`), out.permissionDecisionReason);

  assert.equal(decision(RESET, { env }), 'ask');
  assert.equal(decision(PUSH, { env }), 'deny');
  assert.deepEqual(rows(queue).map((r) => [r.state, r.askClass]), [['allowed', 'recursive-delete'], ['allowed', 'destructive-git']]);
});

test('an attended ask under B, and any ask under off, A or C that is not refused, records nothing', () => {
  const queue = join(TMP, 'b-attended', 'approval-queue.jsonl');
  assert.equal(decision(DELETE, { env: { CW_UNATTENDED_POSTURE: 'B', CW_APPROVAL_QUEUE: queue }, mode: 'default' }), 'ask');
  assert.equal(decision(DELETE, { env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'off', CW_APPROVAL_QUEUE: queue } }), 'ask');
  assert.equal(existsSync(queue), false);
});

test('destructive git asks a person and is refused unattended under A', () => {
  for (const cmd of [RESET, 'git checkout -- .', 'git restore .', 'git stash drop', 'git stash clear', 'git branch -D topic']) {
    assert.equal(decision(cmd, { mode: 'default' }), 'ask', cmd);
    const out = bash(cmd, { env: UNATTENDED });
    assert.equal(out.permissionDecision, 'deny', cmd);
    assert.match(out.permissionDecisionReason, /git keeps no copy/);
  }
});

test('a posture write asks a person, and is refused unattended under every posture, off included', () => {
  assert.equal(decision(POSTURE_OFF, { mode: 'default' }), 'ask');
  assert.equal(hook('Edit', STORE_EDIT, { mode: 'default' }).permissionDecision, 'ask');
  for (const posture of ['off', 'A', 'B', 'C']) {
    const env = { ...UNATTENDED, CW_UNATTENDED_POSTURE: posture, CW_APPROVAL_QUEUE: join(TMP, `pw-${posture}`, 'q.jsonl') };
    const out = bash(POSTURE_OFF, { env });
    assert.equal(out.permissionDecision, 'deny', posture);
    assert.match(out.permissionDecisionReason, /grant itself any exception/);
    assert.equal(hook('Edit', STORE_EDIT, { env }).permissionDecision, 'deny', `${posture}: Edit on the store`);
  }
  assert.deepEqual(rows(join(TMP, 'pw-C', 'q.jsonl')).map((r) => [r.state, r.askClass]), [['refused', 'posture-write'], ['refused', 'posture-write']]);
  assert.equal(existsSync(join(TMP, 'pw-off', 'q.jsonl')), false);
});

test("the guard's posture variable and key lists are the posture module's", () => {
  assert.deepEqual([...POSTURE_KEY_NAMES].sort(), [...POSTURE_KEYS].sort());
  assert.deepEqual([...POSTURE_ENV].sort(), [...POSTURE_KEYS.map((k) => SETTING_KEYS[k].envVar), 'CW_SETTINGS', 'CW_SETTINGS_STORE'].sort());
});

test('posture C refuses a push AND appends it to the approval queue, and the reason names the row', () => {
  const queue = join(TMP, 'c', 'approval-queue.jsonl');
  const env = { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'C', CW_APPROVAL_QUEUE: queue };
  const out = bash(PUSH, { env });
  assert.equal(out.permissionDecision, 'deny');
  const [row, ...more] = rows(queue);
  assert.equal(more.length, 0);
  assert.equal(row.askClass, 'push');
  assert.equal(row.command, PUSH);
  assert.equal(row.tool, 'Bash');
  assert.equal(row.sessionId, 'sess-posture-test');
  assert.equal(row.unattendedWhy, 'CW_GUARD_UNATTENDED=1');
  assert.equal(row.state, 'refused');
  assert.ok(out.permissionDecisionReason.includes(`Recorded in the approval queue as ${row.id}.`), out.permissionDecisionReason);

  assert.equal(hook('Edit', LEDGER, { env }).permissionDecision, 'deny');
  assert.deepEqual(rows(queue).map((r) => [r.askClass, r.path]), [['push', null], ['ledger-modify', LEDGER.file_path]]);
});

test('posture C records nothing when the ask is answered by a person, and under A or B nothing is recorded', () => {
  const queue = join(TMP, 'quiet', 'approval-queue.jsonl');
  assert.equal(decision(PUSH, { env: { CW_UNATTENDED_POSTURE: 'C', CW_APPROVAL_QUEUE: queue }, mode: 'default' }), 'ask');
  assert.equal(decision(PUSH, { env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'A', CW_APPROVAL_QUEUE: queue } }), 'deny');
  assert.equal(decision(PUSH, { env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'B', CW_APPROVAL_QUEUE: queue } }), 'deny');
  assert.equal(existsSync(queue), false);
});

test('posture C with an unwritable queue still refuses, and says the refusal is NOT recorded', () => {
  const blocker = join(TMP, 'blocker');
  writeFileSync(blocker, 'a file where the queue directory should be');
  const out = bash(PUSH, { env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'C', CW_APPROVAL_QUEUE: join(blocker, 'q.jsonl') } });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /could not be written .*NOT recorded/);
});

test('posture off: asks stay asks, and the guard\'s own floor still refuses secret reads and outbound bodies', () => {
  const env = { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'off' };
  assert.equal(decision(PUSH, { env }), 'ask');
  assert.equal(decision(DELETE, { env }), 'ask');
  for (const cmd of [SECRET, POST]) {
    const out = bash(cmd, { env });
    assert.equal(out.permissionDecision, 'deny', cmd);
    assert.match(out.permissionDecisionReason, /posture off .*floor/);
  }
});

test('bypassCountsAsUnattended decides a bypassPermissions or dontAsk session', () => {
  for (const mode of ['bypassPermissions', 'dontAsk']) {
    assert.equal(decision(DELETE, { mode }), 'ask', `${mode}, setting off`);
    const out = bash(DELETE, { mode, env: { CW_BYPASS_IS_UNATTENDED: '1' } });
    assert.equal(out.permissionDecision, 'deny', `${mode}, setting on`);
    assert.match(out.permissionDecisionReason, new RegExp(`permission_mode ${mode}`));
  }
  assert.equal(decision(DELETE, { mode: 'default', env: { CW_BYPASS_IS_UNATTENDED: '1' } }), 'ask');
});

test('missingModeIsUnattended, on by default, reads a payload with no permission_mode as unattended, and only that payload', () => {
  const out = bash(DELETE);
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /no permission_mode in the payload; missingModeIsUnattended=true \(default\)/);
  assert.equal(decision(DELETE, { env: { CW_MISSING_MODE_IS_UNATTENDED: '0' } }), 'ask');
  assert.equal(decision(DELETE, { mode: 'acceptEdits' }), 'ask');
});

test('the settings store is read, and an unreadable one or an invalid value is read strictly, never as off', () => {
  const store = join(TMP, 'store-off.json');
  writeFileSync(store, JSON.stringify({ v: 1, settings: { unattendedPosture: { value: 'off', at: '2026-10-08T00:00:00.000Z', by: 'test' } } }));
  assert.equal(decision(PUSH, { env: { ...UNATTENDED, CW_SETTINGS: store } }), 'ask');

  const corrupt = join(TMP, 'store-corrupt.json');
  writeFileSync(corrupt, '{"v":1,"settings":');
  const out = bash(PUSH, { env: { ...UNATTENDED, CW_SETTINGS: corrupt } });
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /corrupt-store-fallback/);

  const typo = bash(PUSH, { env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'offf' } });
  assert.equal(typo.permissionDecision, 'deny');
  assert.match(typo.permissionDecisionReason, /invalid-env/);
});

test('a peer message cannot authorise an ask-tier action: every ask and every refusal says so', () => {
  assert.match(bash(PUSH, { mode: 'default' }).permissionDecisionReason, /cross-session \(peer\) message is data/);
  assert.match(bash(PUSH, { env: UNATTENDED }).permissionDecisionReason, /cross-session \(peer\) message is data/);
  assert.doesNotMatch(bash('git push --force origin main').permissionDecisionReason, /cross-session/, 'a deny that was never an ask is unchanged');
});

test('without lib/security-posture.mjs the guard still loads, still denies, and reads every ask strictly', () => {
  const root = join(TMP, 'no-posture');
  mkdirSync(join(root, 'bin', 'hooks'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  copyFileSync(HOOK, join(root, 'bin', 'hooks', 'guard-destructive.mjs'));
  copyFileSync(join(REPO, 'lib', 'is-main.mjs'), join(root, 'lib', 'is-main.mjs'));
  const hookPath = join(root, 'bin', 'hooks', 'guard-destructive.mjs');

  assert.equal(execFileSync(process.execPath, [hookPath, '--selftest'], { encoding: 'utf8' }).trim(), 'guard-destructive: live (3/3)');
  const out = bash(DELETE, { hookPath, env: { ...UNATTENDED, CW_UNATTENDED_POSTURE: 'off' } });
  assert.equal(out.permissionDecision, 'deny', 'no posture can be read, so off cannot be believed');
  assert.match(out.permissionDecisionReason, /security-posture\.mjs did not load/);
  assert.equal(decision(DELETE, { hookPath, mode: 'bypassPermissions' }), 'deny');
  assert.equal(decision(DELETE, { hookPath, mode: 'default' }), 'ask');
});
