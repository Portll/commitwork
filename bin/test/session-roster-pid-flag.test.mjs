// --record: the pid is what makes a row an address, and there are three ways to hand it over.
// Registry remediation #19 was written against a CLI that took only the positional form; the
// session that wrote it ran `--pid N`, the flag was absorbed as a positional, and its row stayed
// unverifiable all day. Both spellings and the env fallback must produce the SAME row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'session-roster.mjs');
const UUID = '11111111-2222-3333-4444-555555555555';

function fx(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-roster-pid-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  // An ABSENT socket dir means liveness is unmeasurable, and an unmeasurable witness may not veto —
  // so the pid is recorded rather than refused. That is the documented behaviour under test here,
  // not a loophole: a present-but-empty dir would refuse, and session-roster.test.mjs pins that.
  return { roster: join(d, 's.jsonl'), sock: join(d, 'no-such-dir') };
}
const run = (f, args, env = {}) => spawnSync(process.execPath, [CLI, '--record', ...args], {
  encoding: 'utf8', env: { ...process.env, CW_SESSION_ROSTER: f.roster, CW_PEER_SOCKET_DIR: f.sock, CLAUDE_PID: '', ...env },
});
const rows = (f) => (existsSync(f.roster) ? readFileSync(f.roster, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('`--pid N` and the positional pid write the same row, and the second is idempotent against the first', (t) => {
  const f = fx(t);
  const a = run(f, ['99', 'abc123', UUID, '--pid', '4242']);
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /recorded cw99 \[abc123\] pid=4242/);
  const b = run(f, ['99', 'abc123', UUID, '4242']);
  assert.equal(b.status, 0, b.stderr);
  assert.match(b.stdout, /already held/, 'same observation by the other spelling adds nothing');
  assert.equal(rows(f).length, 1);
  assert.equal(rows(f)[0].pid, '4242');
});

test('the flag may come before the positionals', (t) => {
  const f = fx(t);
  const a = run(f, ['--pid', '4242', '99', 'abc123', UUID]);
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual([rows(f)[0].name, rows(f)[0].ref, rows(f)[0].id, rows(f)[0].pid], ['99', 'abc123', UUID, '4242']);
});

test('CLAUDE_PID in the environment is NOT read — an omitted pid stays omitted', (t) => {
  // The harness exports CLAUDE_PID into every subprocess. An env fallback would turn "omitted"
  // into "asserted", and the first attempt at one was refused against a fixture socket set by the
  // test runner's own session pid. Omitting is the documented way to record an honest unverifiable.
  const f = fx(t);
  const a = run(f, ['98', 'abc124'], { CLAUDE_PID: '4343' });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(rows(f)[0].pid, undefined, 'no pid was asserted');
  assert.match(a.stdout, /recorded cw98 \[abc124\]\n/, 'and the line does not print one');
});

test('a flag and a positional that DISAGREE are refused — the tool does not guess which is this session', (t) => {
  const f = fx(t);
  const r = run(f, ['97', 'abc125', UUID, '2', '--pid', '1']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /disagree/);
  assert.equal(rows(f).length, 0, 'nothing written');
});

test('a non-numeric pid is refused by either spelling', (t) => {
  const f = fx(t);
  assert.equal(run(f, ['96', 'abc126', UUID, '--pid', 'x']).status, 2);
  assert.equal(run(f, ['96', 'abc126', UUID, 'x']).status, 2);
  assert.equal(rows(f).length, 0);
});
