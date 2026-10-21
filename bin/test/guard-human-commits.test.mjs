// The "Human commit messages only" gate in bin/hooks/guard-destructive.mjs. With the Agent security
// setting on, a commit with a message on its command line runs only when the person chose that
// message at the commit-message question, read back from the session transcript; a commit with no
// message to choose is a permission prompt; where nobody can be asked, it is refused. Every case
// runs against a scratch settings store and scratch transcripts, never the operator's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, judgeFileWrite, commitMessageApproval, COMMIT_QUESTION } from '../hooks/guard-destructive.mjs';
import { setSettings } from '../../monitor/settings.mjs';
import { commitApprover } from '../../lib/security-posture.mjs';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-destructive.mjs');
const NOW = Date.parse('2026-10-11T03:00:00.000Z');
let dir;
const saved = {};
const KEYS = ['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_HUMAN_COMMIT_MESSAGES_ONLY', 'CW_GUARD_UNATTENDED', 'CLAUDE_CODE_SESSION_ATTENDED', 'CW_NOW', 'CW_COMMIT_GATE_LEDGER'];
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-human-commits-'));
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CW_SETTINGS = join(dir, 'settings.json');
  process.env.CW_COMMIT_GATE_LEDGER = join(dir, 'commit-gate.jsonl');
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(dir, { recursive: true, force: true });
});

const ON = { CW_HUMAN_COMMIT_MESSAGES_ONLY: '1', CLAUDE_CODE_SESSION_ATTENDED: '1' };
let n = 0;
/** A transcript holding one answered commit-message question per row spec: { proposed, answer, minutesAgo }. */
function transcript(...answers) {
  const p = join(dir, `t${n += 1}.jsonl`);
  const rows = [{ type: 'user', timestamp: new Date(NOW).toISOString(), message: { role: 'user', content: 'hello' } }];
  for (const { proposed, answer, minutesAgo = 1 } of answers) {
    const question = `${COMMIT_QUESTION.lead}\n${proposed}`;
    rows.push({
      type: 'user', timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
      toolUseResult: {
        questions: [{ question, header: COMMIT_QUESTION.header, options: [{ label: COMMIT_QUESTION.keep }, { label: COMMIT_QUESTION.skip }] }],
        answers: answer === undefined ? {} : { [question]: answer },
      },
    });
  }
  writeFileSync(p, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return p;
}
const at = (cmd, { env = ON, permissionMode = 'default', transcriptPath } = {}) => judge(cmd, { env, permissionMode, cwd: dir, transcriptPath, now: NOW });

test('off by default: with nothing set, a commit is not this gate\'s business', () => {
  assert.equal(judge('git commit -m "fix: a thing"', { env: {}, permissionMode: 'default' }), null);
});

test('on and attended, nobody asked yet: the commit is refused with the question to ask and the proposed message', () => {
  const v = at('git commit -m "fix(bin): keep the flag" -m "second paragraph"', { transcriptPath: transcript() });
  assert.equal(v?.decision, 'deny');
  assert.match(v.reason, /A person chooses every commit message/);
  assert.match(v.reason, /proposed message:\n\s+fix\(bin\): keep the flag\n\s+\n\s+second paragraph/, 'each -m is a paragraph, as git joins them');
  assert.match(v.reason, /AskUserQuestion: header "Commit msg"/);
  assert.match(v.reason, /Write the proposed message as text in your response, in a fenced block the person can copy .*then in that same response call AskUserQuestion/,
    'the question\'s text cannot be copied, so the proposal is shown first as response text');
  assert.match(v.reason, /"Keep proposed" \(a blank answer means the same\)/);
  assert.match(v.reason, /has not been asked in this session/);
});

test('the person\'s answer decides: keep, blank, a typed replacement, decline, stale', () => {
  const msg = 'fix(bin): keep the flag';
  assert.equal(at(`git commit -m "${msg}"`, { transcriptPath: transcript({ proposed: msg, answer: COMMIT_QUESTION.keep }) }), null, 'keep proposed lets the proposed message through');
  assert.equal(at(`git commit -m "${msg}"`, { transcriptPath: transcript({ proposed: msg, answer: '   ' }) }), null, 'a blank answer is keep proposed');
  const typed = transcript({ proposed: msg, answer: 'fix(bin): hold the flag the operator set' });
  assert.equal(at('git commit -m "fix(bin): hold the flag the operator set"', { transcriptPath: typed }), null, 'the typed message is the one that may run');
  const other = at(`git commit -m "${msg}"`, { transcriptPath: typed });
  assert.equal(other?.decision, 'deny', 'the proposal the person replaced may not run');
  assert.match(other.reason, /chose a different message:\n\s+fix\(bin\): hold the flag the operator set/);
  assert.match(at(`git commit -m "${msg}"`, { transcriptPath: transcript({ proposed: msg, answer: COMMIT_QUESTION.skip }) }).reason, /chose not to commit/);
  assert.match(at(`git commit -m "${msg}"`, { transcriptPath: transcript({ proposed: msg, answer: COMMIT_QUESTION.keep, minutesAgo: 31 }) }).reason, /older than 30 minutes/);
  assert.match(at(`git commit -m "${msg}"`, { transcriptPath: transcript({ proposed: msg }) }).reason, /has no answer/);
});

test('only the latest answer counts, and whitespace at line ends does not make a different message', () => {
  const p = transcript({ proposed: 'feat: first', answer: COMMIT_QUESTION.keep, minutesAgo: 5 }, { proposed: 'feat: second\n\nbody  ', answer: COMMIT_QUESTION.keep });
  assert.equal(at('git commit -m "feat: first"', { transcriptPath: p })?.decision, 'deny');
  assert.equal(at('node bin/commit-phase.mjs -m "feat: second\n\nbody" -- a.mjs', { transcriptPath: p }), null);
});

test('a multi-line commit-phase message chosen at the question runs', () => {
  const msg = 'feat(bin): proven end to end\n\nThe checkbox wrote the store; the hook read it.';
  const p = transcript({ proposed: msg, answer: COMMIT_QUESTION.keep });
  assert.equal(at(`node bin/commit-phase.mjs -m "${msg}" -- a.mjs`, { transcriptPath: p }), null);
  assert.equal(at(`CW_SELF_SWEEP=0 node bin/stage-mine.mjs -m "${msg}"`, { transcriptPath: p }), null);
});

test('every way a message reaches git is read, and an unreadable one cannot be chosen', () => {
  const shown = (cmd) => at(cmd)?.reason.split('message:\n')[1];
  assert.match(shown('git -C /tmp commit -am "wip: tidy"'), /wip: tidy/, 'a cluster ending in m takes the next word');
  assert.match(shown('git commit --message="docs: say so"'), /docs: say so/);
  assert.match(shown('git commit -mquick'), /quick/);
  writeFileSync(join(dir, 'msg.txt'), 'chore: from a file\n');
  assert.match(shown('git commit -F msg.txt'), /chore: from a file/, '-F is read relative to the payload cwd');
  assert.equal(at('git commit -F msg.txt', { transcriptPath: transcript({ proposed: 'chore: from a file', answer: COMMIT_QUESTION.keep }) }), null);
  for (const cmd of ['git commit -F -', 'git commit -F missing.txt', 'git commit -m "$(cat /tmp/msg.txt)"', 'git commit -m "`cat m`"']) {
    const v = at(cmd);
    assert.equal(v?.decision, 'deny', `${cmd}: a message the gate cannot read is refused, never downgraded to a prompt`);
    assert.match(v.reason, /Give the message on the command line/);
  }
  assert.match(shown('sh -c "git commit -m nested"'), /nested/, 'a commit inside a shell string is still a commit');
});

test('a commit with no message to choose is a permission prompt that says what message it will carry', () => {
  for (const [cmd, says] of [
    ['git commit --amend --no-edit', /keeps the message already on HEAD/],
    ['git commit -C HEAD~1', /reuses the message of HEAD~1/],
    ['git commit', /git opens an editor/],
    ['git pull', /the message git writes for pull/],
    ['node bin/anchor-commit.mjs', /the message the script composes/],
  ]) {
    const v = at(cmd);
    assert.equal(v?.decision, 'ask', cmd);
    assert.match(v.reason, says);
  }
});

test('commands that make no commit pass', () => {
  for (const cmd of ['git status', 'git log -1', 'git rebase --abort', 'git merge --ff-only origin/main',
    'git commit --dry-run -m x', 'node bin/commit-phase.mjs --check -- a.mjs', 'node bin/commit-phase.mjs --help',
    'node bin/commitwork.mjs scan', 'echo "git commit -m x"']) {
    assert.equal(at(cmd), null, cmd);
  }
});

test('where nobody can be asked, the commit is refused even with a chosen message, and the reason names why', () => {
  const chosen = transcript({ proposed: 'fix: x', answer: COMMIT_QUESTION.keep });
  const cases = [
    [{ ...ON, CLAUDE_CODE_SESSION_ATTENDED: '' }, 'default', /does not mark this session attended/],
    [{ ...ON, CW_GUARD_UNATTENDED: '1' }, 'default', /CW_GUARD_UNATTENDED=1/],
    [ON, 'bypassPermissions', /bypassPermissions asks nobody/],
    [ON, 'dontAsk', /dontAsk asks nobody/],
  ];
  for (const [env, permissionMode, why] of cases) {
    const v = at('git commit -m "fix: x"', { env, permissionMode, transcriptPath: chosen });
    assert.equal(v?.decision, 'deny', `${permissionMode} ${JSON.stringify(env)}`);
    assert.match(v.reason, why);
    assert.match(v.reason, /fix: x/, 'the refused message is still shown');
  }
});

test('a deny from another rule outranks a chosen message', () => {
  const chosen = transcript({ proposed: 'x', answer: COMMIT_QUESTION.keep });
  assert.equal(at('git commit -m x && git push --force origin main', { transcriptPath: chosen })?.decision, 'deny');
});

test('a heredoc is a message the gate reads: stdin to -F -, $(cat <<EOF) to -m, or a file the same command writes', () => {
  const body = 'feat(bin): read the heredoc\n\nA paragraph after a blank line.';
  const forms = [
    `git commit -F - <<'EOF'\n${body}\nEOF`,
    `git commit -m "$(cat <<'EOF'\n${body}\nEOF\n)"`,
    `cat > msg-h.txt <<'EOF'\n${body}\nEOF\ngit commit -F msg-h.txt`,
  ];
  writeFileSync(join(dir, 'msg-h.txt'), 'chore: an older message on disk\n');
  const chosen = transcript({ proposed: body, answer: COMMIT_QUESTION.keep });
  for (const cmd of forms) {
    const before = at(cmd, { transcriptPath: transcript() });
    assert.equal(before?.decision, 'deny', cmd);
    assert.match(before.reason, /proposed message:\n\s+feat\(bin\): read the heredoc\n\s+\n\s+A paragraph after a blank line\./, `${cmd}: the heredoc is the proposal, not the file on disk`);
    assert.equal(at(cmd, { transcriptPath: chosen }), null, `${cmd}: the chosen heredoc message runs`);
  }
  const two = at("git commit -F - <<'A'\nfeat: one\nA\ncat <<'B'\nfeat: two\nB");
  assert.equal(two?.decision, 'deny');
  assert.match(two.reason, /2 heredocs that could be it/);
});

test('a replay, rebase, merge or cherry-pick lists every message it lands, and the ledger keeps each hash', () => {
  const repo = join(dir, 'landing-repo');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: { PATH: process.env.PATH, HOME: dir } });
  const commit = (msg) => git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', msg);
  commit('chore: base');
  git('checkout', '-q', '-b', 'feature');
  commit('feat(lane): first lane change');
  commit('fix(lane): second lane change\n\nA body line written by the lane.');
  const second = git('rev-parse', 'HEAD');

  const ledger = process.env.CW_COMMIT_GATE_LEDGER;
  rmSync(ledger, { force: true });
  const both = /first lane change[\s\S]*second lane change\n\s+\n\s+A body line written by the lane\./;
  for (const [cmd, cwd] of [
    ['node bin/commit-phase.mjs --onto main', repo],
    ['git rebase main', repo],
    [`cd ${repo} && node /abs/bin/commit-phase.mjs --onto main`, dir],
    [`git -C ${repo} rebase main`, dir],
  ]) {
    const v = judge(cmd, { env: ON, permissionMode: 'default', cwd, transcriptPath: transcript(), now: NOW });
    assert.equal(v?.decision, 'ask', cmd);
    assert.match(v.reason, /lands 2 commit\(s\)/, cmd);
    assert.match(v.reason, both, `${cmd}: every landed message is in the prompt, body included`);
  }
  const row = JSON.parse(readFileSync(ledger, 'utf8').trim().split('\n')[0]);
  assert.equal(row.why, 'lands-listed');
  assert.deepEqual(row.lands.map((c) => c.subject), ['feat(lane): first lane change', 'fix(lane): second lane change']);
  assert.equal(row.lands[1].messageSha256, createHash('sha256').update('fix(lane): second lane change\n\nA body line written by the lane.').digest('hex'));

  git('checkout', '-q', 'main');
  assert.match(judge('git merge feature', { env: ON, permissionMode: 'default', cwd: repo, now: NOW }).reason, both, 'a merge lists what it brings in');
  const picked = judge(`git cherry-pick ${second}`, { env: ON, permissionMode: 'default', cwd: repo, now: NOW }).reason;
  assert.match(picked, /lands 1 commit\(s\)[\s\S]*second lane change/);
  assert.doesNotMatch(picked, /first lane change/, 'a cherry-pick lists only what it picks');
  assert.match(judge('git rebase feature', { env: ON, permissionMode: 'default', cwd: repo, now: NOW }).reason, /lands no commit that is not already there/);

  const unknown = judge('git merge no-such-branch', { env: ON, permissionMode: 'default', cwd: repo, now: NOW });
  assert.equal(unknown?.decision, 'deny', 'a landing whose commits cannot be listed is refused');
  assert.match(unknown.reason, /could not be listed/);
  const notRepo = judge('node bin/commit-phase.mjs --onto main', { env: ON, permissionMode: 'default', cwd: dir, now: NOW });
  assert.equal(notRepo?.decision, 'deny');
});

test('a commit-phase message its own rules refuse is reported before the person is asked', () => {
  const said = (cmd) => at(cmd, { transcriptPath: transcript() }).reason;
  assert.match(said('node bin/commit-phase.mjs -m "fix(bin): land the gate" -- bin/x.mjs'), /commit-phase will refuse this message; fix it before asking:[\s\S]*clause house/);
  assert.match(said('node bin/commit-phase.mjs -m "fix(docs): add the gate" -- bin/x.mjs'), /commit-phase will refuse this message[\s\S]*scope 'docs'/, 'scope is judged against the declared paths');
  assert.doesNotMatch(said('node bin/commit-phase.mjs -m "fix(bin): add the gate" -- bin/x.mjs'), /commit-phase will refuse/);
  assert.doesNotMatch(said('git commit -m "fix: land it"'), /commit-phase will refuse/, 'a bare git commit is not held to commit-phase rules');
});

test('the decision ledger records every judged commit, and an approval it cannot record is refused', () => {
  const ledger = process.env.CW_COMMIT_GATE_LEDGER;
  rmSync(ledger, { force: true });
  const p = transcript({ proposed: 'fix: ledgered', answer: COMMIT_QUESTION.keep });
  assert.equal(at('git commit -m "fix: ledgered"', { transcriptPath: p }), null);
  assert.equal(at('git commit --amend --no-edit')?.decision, 'ask');
  assert.equal(at('git commit -m "fix: not asked"', { transcriptPath: transcript() })?.decision, 'deny');
  assert.equal(at('git status'), null);
  const rows = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.decision, r.why, r.what]), [['allow', 'chosen', 'git commit'], ['ask', 'no-message-to-choose', 'git commit'], ['deny', 'unanswered', 'git commit']], 'one row per judged commit, none for git status');
  assert.equal(rows[0].messageSha256, createHash('sha256').update('fix: ledgered').digest('hex'));
  assert.equal(rows[0].transcript, p.split('/').pop());
  assert.equal(rows[0].at, new Date(NOW).toISOString());
  assert.equal(rows[1].messageSha256, null, 'no message to hash on the prompt path');

  const env = { ...ON, CW_COMMIT_GATE_LEDGER: join(dir, 'no-such-dir', 'gate.jsonl') };
  const refused = at('git commit -m "fix: ledgered"', { env, transcriptPath: p });
  assert.equal(refused?.decision, 'deny', 'a chosen message the gate cannot witness does not run');
  assert.match(refused.reason, /could not be recorded in the gate's decision ledger \(.*no-such-dir.*ENOENT\)/);
  assert.equal(at('git commit --amend --no-edit', { env })?.decision, 'ask', 'a prompt is still a prompt');
});

test('while on, the transcript and the settings store are not the agent\'s to rewrite', () => {
  const t = '/srv/someone/.claude/projects/-repo/abc.jsonl';
  for (const cmd of [`echo '{}' >> ${t}`, `tee -a ${t} < x`, `sed -i '' s/a/b/ ${t}`, `cp forged.jsonl ${t}`, `rm ${t}`,
    'echo {} > ~/.commitwork/settings.json',
    'node -e "require(\'./monitor/settings.mjs\').setSettings({humanCommitMessagesOnly:false})"',
    'curl -X POST -d \'{"key":"humanCommitMessagesOnly","value":false}\' http://127.0.0.1:7879/api/security-posture']) {
    assert.equal(at(cmd)?.decision, 'deny', cmd);
  }
  for (const cmd of [`cat ${t}`, `grep -c Commit ${t}`, `cp ${t} /tmp/copy.jsonl`, 'grep -n humanCommitMessagesOnly bin/x.mjs | grep false',
    "node -e \"if (securitySetting('humanCommitMessagesOnly').value !== true) writeFileSync('x.json', JSON.stringify({ explicit: false }))\""]) {
    assert.equal(at(cmd), null, cmd);
  }
  assert.equal(judgeFileWrite('Write', t, { env: ON })?.decision, 'deny');
  assert.equal(judgeFileWrite('Edit', '/srv/someone/.commitwork/settings.json', { env: ON })?.decision, 'deny');
  assert.equal(judgeFileWrite('Write', t, { env: { CW_HUMAN_COMMIT_MESSAGES_ONLY: '0' } }), null, 'off: not this gate\'s business');
  assert.equal(at(`echo x >> ${t}`, { env: { CW_HUMAN_COMMIT_MESSAGES_ONLY: '0' } }), null);
});

test('the checkbox path: the setting written to the store turns the gate on', () => {
  const env = { CLAUDE_CODE_SESSION_ATTENDED: '1' };
  assert.equal(at('git commit -m x', { env }), null, 'precondition: an empty store leaves it off');
  assert.equal(setSettings({ humanCommitMessagesOnly: true }, { who: 'test' }).ok, true);
  assert.equal(at('git commit -m x', { env })?.decision, 'deny');
  assert.equal(setSettings({ humanCommitMessagesOnly: false }, { who: 'test' }).ok, true);
  assert.equal(at('git commit -m x', { env }), null);
});

test('an unreadable store fails closed: the gate applies', () => {
  writeFileSync(process.env.CW_SETTINGS, '{ not json');
  try {
    assert.equal(at('git commit -m x', { env: { CLAUDE_CODE_SESSION_ATTENDED: '1' } })?.decision, 'deny');
  } finally { rmSync(process.env.CW_SETTINGS, { force: true }); }
});

test('commitMessageApproval reads the latest answered question and ignores every other row', () => {
  assert.match(commitMessageApproval(undefined, NOW).none, /names no session transcript/);
  assert.match(commitMessageApproval(join(dir, 'absent.jsonl'), NOW).none, /could not be read \(ENOENT\)/);
  const p = join(dir, 'mixed.jsonl');
  const q = (header, lead) => ({ question: `${lead}\nfeat: x`, header });
  writeFileSync(p, [
    JSON.stringify({ type: 'user', timestamp: new Date(NOW).toISOString(), toolUseResult: { questions: [q('Scope', COMMIT_QUESTION.lead)], answers: {} } }),
    JSON.stringify({ type: 'assistant', timestamp: new Date(NOW).toISOString(), toolUseResult: { questions: [q(COMMIT_QUESTION.header, COMMIT_QUESTION.lead)], answers: { [`${COMMIT_QUESTION.lead}\nfeat: x`]: COMMIT_QUESTION.keep } } }),
    'not json mentioning Commit msg',
  ].join('\n'));
  assert.match(commitMessageApproval(p, NOW).none, /has not been asked/, 'another header, an assistant row and garbage are not answers');
});

test('commitApprover needs the harness\'s attended mark, not the absence of a flag', () => {
  assert.equal(commitApprover({ env: {}, permissionMode: 'default' }).canAsk, false);
  assert.equal(commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '1' }, permissionMode: 'default' }).canAsk, true);
  assert.equal(commitApprover({ env: { CLAUDE_CODE_SESSION_ATTENDED: '1' } }).canAsk, true, 'a missing mode with the mark is attended');
});

test('the hook process reads the payload transcript: refused before the question, allowed after it', () => {
  const hookLedger = join(dir, 'hook-ledger.jsonl');
  const run = (transcriptPath) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: ship it"' }, cwd: dir, permission_mode: 'default', transcript_path: transcriptPath }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: dir, CW_SETTINGS: process.env.CW_SETTINGS, CW_COMMIT_GATE_LEDGER: hookLedger, CW_NOW: new Date(NOW).toISOString(), ...ON },
  });
  const before = run(join(dir, 'empty.jsonl'));
  assert.equal(before.status, 0, before.stderr);
  const out = JSON.parse(before.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /feat: ship it/);
  const after = run(transcript({ proposed: 'feat: ship it', answer: '' }));
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, '', 'a chosen message passes without a prompt');
  const rows = readFileSync(hookLedger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.decision), ['deny', 'allow'], 'the hook process writes both decisions to its ledger');
});
