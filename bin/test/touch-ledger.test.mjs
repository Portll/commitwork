// node --test bin/test/ — the touch ledger, which is the ownership oracle every attribution gate
// reads. Two failure directions matter here and they are not symmetric: UNDER-recording makes a
// session's work read as a co-author's (the defect this Bash path exists to close), and OVER-
// recording banks someone else's commit against this session, which is worse because it is
// confident. Most of these tests are the second kind.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { responseText, commitShaFrom } from '../lib/touch-ledger-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HOOK = join(REPO, 'bin', 'touch-ledger.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function run(payload) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  dirs.push(dir);
  const ledger = join(dir, 'touches.jsonl');
  const r = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CW_TOUCH_LEDGER: ledger },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rows = existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { rows, stdout: r };
}

describe('commitShaFrom — the command must be a commit AND the sha must come from its own output', () => {
  test('a real commit is recognised, including a root commit', () => {
    assert.equal(commitShaFrom('git -C /r commit -q -F -', '[main f00d7e1] subject here'), 'f00d7e1');
    assert.equal(commitShaFrom('git commit -m x', '[main (root-commit) 1234567] first'), '1234567');
    assert.equal(commitShaFrom('git commit --amend', '[detached HEAD 0a1b2c3d4e5f] x'), '0a1b2c3d4e5f');
  });

  test('a command that is NOT a commit is refused even when the output looks like one', () => {
    // This is the over-recording direction: `git log` prints the same bracket form, and banking
    // HEAD off it would attribute a co-session's commit to whoever ran the log.
    assert.equal(commitShaFrom('git log -1 --oneline', '[main f00d7e1] someone else work'), null);
    assert.equal(commitShaFrom('git show HEAD', '[main f00d7e1] x'), null);
    assert.equal(commitShaFrom('echo "about to commit"', '[main f00d7e1] x'), null);
    assert.equal(commitShaFrom('git status', '[main f00d7e1] x'), null);
  });

  test('a commit that produced nothing records nothing', () => {
    assert.equal(commitShaFrom('git commit -m x', 'nothing to commit, working tree clean'), null);
    assert.equal(commitShaFrom('git commit -m x', ''), null);
    assert.equal(commitShaFrom('git commit -m x', undefined), null);
  });

  test('a piped or chained command cannot smuggle a commit past the invocation check', () => {
    // The regex stops at | ; & on purpose: `git log | grep commit` must not qualify.
    assert.equal(commitShaFrom('git log --oneline | grep commit', '[main f00d7e1] x'), null);
  });

  test('missing input is null, never a throw — this runs inside a hook', () => {
    assert.equal(commitShaFrom(undefined, undefined), null);
    assert.equal(commitShaFrom(null, null), null);
  });
});

describe('responseText — whichever shape the harness hands over', () => {
  test('string, content blocks, and object forms all read', () => {
    assert.equal(responseText({ tool_response: 'plain' }), 'plain');
    assert.match(responseText({ tool_response: [{ text: 'a' }, { text: 'b' }] }), /a\nb/);
    assert.match(responseText({ tool_response: { stdout: 'out', stderr: 'err' } }), /out\nerr/);
    assert.equal(responseText({}), '');
    assert.equal(responseText(undefined), '');
  });
});

describe('the hook end to end', () => {
  test('an Edit payload records the file, as it always did — no regression', () => {
    const { rows } = run({ session_id: 'aaaabbbb-1', tool_input: { file_path: join(REPO, 'monitor/retention.mjs') } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].f, 'monitor/retention.mjs');
    assert.equal(rows[0].s, 'aaaabbbb');
    assert.equal(rows[0].via, undefined, 'a direct edit is not commit-derived and must not claim to be');
  });

  test('an ordinary Bash command records NOTHING — silence beats a guess', () => {
    const { rows } = run({ session_id: 'aaaabbbb-1', tool_input: { command: 'python3 - <<EOF\nopen("x").write("y")\nEOF' }, tool_response: { stdout: 'done' } });
    assert.deepEqual(rows, [], 'a shell write is invisible by design; inventing a file here would be worse than missing one');
  });

  test('a Bash GIT COMMIT records every file of that commit, marked commit-derived', () => {
    const sha = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const files = execFileSync('git', ['-C', REPO, 'show', '--name-only', '--format=', sha], { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const { rows } = run({
      session_id: 'ccccdddd-2',
      tool_input: { command: `git -C ${REPO} commit -q -F -` },
      tool_response: { stdout: `[main ${sha.slice(0, 7)}] a subject` },
    });
    assert.equal(rows.length, files.length, `expected one row per file of ${sha.slice(0, 7)}`);
    assert.deepEqual(rows.map((r) => r.f).sort(), files.slice().sort());
    for (const r of rows) {
      assert.equal(r.via, 'commit', 'commit-derived rows must be distinguishable from direct touches');
      assert.equal(r.s, 'ccccdddd');
      assert.ok(sha.startsWith(r.sha) || r.sha.startsWith(sha.slice(0, 7)));
    }
  });

  test('no session id records nothing — an unowned touch would read as somebody\'s', () => {
    assert.deepEqual(run({ tool_input: { file_path: join(REPO, 'monitor/retention.mjs') } }).rows, []);
  });

  test('a file outside the repo is not our business', () => {
    assert.deepEqual(run({ session_id: 'aaaabbbb-1', tool_input: { file_path: '/etc/hosts' } }).rows, []);
  });

  test('a garbage payload exits 0 and writes nothing — the hook never interrupts a tool call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-tl-')); dirs.push(dir);
    const ledger = join(dir, 'touches.jsonl');
    // execFileSync throws on a non-zero exit; that it returns at all is the assertion.
    execFileSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8', env: { ...process.env, CW_TOUCH_LEDGER: ledger } });
    assert.equal(existsSync(ledger), false);
  });

  test('an unknown sha in the output does not throw — git fails, the hook still exits 0', () => {
    const { rows } = run({
      session_id: 'eeeeffff-3',
      tool_input: { command: 'git commit -m x' },
      tool_response: { stdout: '[main deadbee] a commit that does not exist' },
    });
    assert.deepEqual(rows, []);
  });
});
