// get-focused hook, driven through the command line PRODUCTION uses — not a flag.
//
// Two pins, both from the same defect family. (1) WP3's prerequisite: the gate-focus record's
// `session` must be the hook payload's session_id, because 134 of the first 139 records keyed on
// cksum(PWD|USER|hour) and identified a directory-hour, not a session. (2) WP6's reachability
// precedent: the state-unreadable branch shipped with two passing tests that drove it through a CLI
// flag no caller passed. Here the corrupt state file is met by the hook itself.
//
// The hook lives at user scope (~/.claude/hooks/get-focused.sh) and is not part of this repository.
// An absent hook SKIPS with the reason printed — a skip is a measurement of the environment, never a
// pass. CW_FOCUS_HOOK overrides the location.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW_HOME = resolve(HERE, '..', '..');
const HOOK = process.env.CW_FOCUS_HOOK || join(homedir(), '.claude', 'hooks', 'get-focused.sh');
// The hook hard-codes its state directory; a unique session id keeps this test's files apart.
const STATE_DIR = '/tmp/claude-session-state';

const hookPresent = existsSync(HOOK);
const jqPresent = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
// node:test skips on ANY non-undefined `skip`, null included — so the "do not skip" value is false.
const skipWhy = !hookPresent ? `hook absent at ${HOOK}` : !jqPresent ? 'jq absent — the hook cannot parse its payload' : false;

function runHook(fx, payload) {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: fx.cwd,
    env: { ...process.env, CW_VERDICT_DIR: fx.verdicts, CW_HOME },
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// The journal write is backgrounded by the hook, so the record is polled for rather than read once.
async function records(fx, { want = 1, ms = 8000 } = {}) {
  const p = join(fx.verdicts, 'gate-focus.jsonl');
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(p)) {
      const rows = readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      if (rows.length >= want) return rows;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cw-focus-hook-'));
  const cwd = join(root, 'commitwork');
  mkdirSync(cwd);
  // A UUID starts with eight digits about 2% of the time, which is the cksum fallback's shape, and
  // the assertion that tells the two apart would then fail on a correct hook.
  const session = `f${randomUUID().slice(1)}`;
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(join(STATE_DIR, `${session}.focus.json`), { force: true });
  });
  return { root, cwd, verdicts: join(root, 'verdicts'), session };
}

test('two bare nudges fire a record whose session IS the payload session_id, truncated the way the ledger keys', { skip: skipWhy }, async (t) => {
  const fx = fixture(t);
  const nudge = { prompt: 'continue', session_id: fx.session, cwd: fx.cwd };
  const first = runHook(fx, nudge);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, '', 'one nudge is below threshold and prints nothing');
  const second = runHook(fx, nudge);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /get-focused signal/, 'the reminder is printed at streak 2');

  const rows = await records(fx);
  assert.equal(rows.length, 1, 'exactly one firing is journalled');
  assert.equal(rows[0].gate, 'gate-focus');
  assert.equal(rows[0].verdict, 'refocus-fired');
  assert.equal(rows[0].session, fx.session.slice(0, 8), 'the record keys on the payload session, not a directory-hour cksum');
  assert.doesNotMatch(rows[0].session, /^\d{8}$/, 'an all-digit key is the cksum fallback');
  assert.equal(rows[0].streak, 2);
  assert.equal(rows[0].prompts, 2, 'the denominator counts every prompt the session has seen');
  assert.equal(rows[0].class, null, 'the sensor never assigns a class');
  assert.ok(!JSON.stringify(rows[0]).includes('continue'), 'prompt text never reaches the journal');
});

test('a corrupt state file is reached through the hook itself and records state-unreadable, never quiet', { skip: skipWhy }, async (t) => {
  const fx = fixture(t);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(join(STATE_DIR, `${fx.session}.focus.json`), 'not json at all\n');
  const r = runHook(fx, { prompt: 'a real instruction, not a nudge', session_id: fx.session, cwd: fx.cwd });
  assert.equal(r.code, 0, 'the hook never fails closed onto the user\'s turn');
  assert.equal(r.stdout, '', 'sensor blindness is recorded, not alarmed at the user');

  const rows = await records(fx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'state-unreadable');
  assert.equal(rows[0].session, fx.session.slice(0, 8));
  assert.equal(rows[0].streak, null, 'an unreadable state has no streak, and null is not zero');
});

test('with no session_id in the payload the hook still runs, and the record says so by its key shape', { skip: skipWhy }, async (t) => {
  // The cksum fallback is deliberate — a shared counter beats none — but it must be recognisable
  // as the fallback rather than pass as a session. The pin is on the shape, not on the value.
  const fx = fixture(t);
  const payload = { prompt: 'continue', cwd: fx.cwd };
  runHook(fx, payload); const r = runHook(fx, payload);
  assert.equal(r.code, 0);
  const rows = await records(fx);
  // Whatever fired was keyed on the cksum, and that key is the one this test must clean up.
  t.after(() => { for (const row of rows) rmSync(join(STATE_DIR, `${row.session}.focus.json`), { force: true }); });
  if (rows.length) assert.match(String(rows[0].session), /^\d+$/, 'the fallback key is numeric, which is how a reader tells it apart');
});
