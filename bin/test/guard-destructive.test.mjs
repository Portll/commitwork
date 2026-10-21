// guard-destructive — the PreToolUse gate over the destructive set.
//
// THE FALSE-POSITIVE HALF IS THE LARGER HALF HERE, DELIBERATELY. A gate that fires on real work
// gets removed, and a removed gate protects nothing — guard-cwd.mjs says this in its own header.
// So the "must NOT fire" table below is longer than the "must fire" one, and every entry in it is
// a command shape that actually occurs in this repository: commit messages that discuss
// force-pushing, greps for `rm -rf`, loopback POSTs to veld and the panel, and appends to the
// touch ledger.
//
// The two directions are asserted separately because only one of them lies to you. A gate that
// misses a force-push is silent; a gate that blocks `git log` is loud and will be reported within
// the hour. The dangerous failure is the quiet one, so it gets its own table and its own names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, scrub, judgeFileWrite } from '../hooks/guard-destructive.mjs';

// The commit cases below are about the destructive rules; the operator's own settings store must
// not turn them into human-commit asks. guard-human-commits.test.mjs covers that gate.
process.env.CW_HUMAN_COMMIT_MESSAGES_ONLY = '0';
// What an unattended ask becomes is the operator's posture. These tests state the declared default,
// A, so the store is one that does not exist and no posture variable is inherited.
process.env.CW_SETTINGS = join(mkdtempSync(join(tmpdir(), 'cw-guard-settings-')), 'absent.json');
for (const k of ['CW_SETTINGS_STORE', 'CW_UNATTENDED_POSTURE', 'CW_BYPASS_IS_UNATTENDED', 'CW_MISSING_MODE_IS_UNATTENDED']) delete process.env[k];
// judge() is called here without a hook payload, so there is no permission_mode; these tables state
// the attended tiers, and a missing mode is unattended by default.
process.env.CW_MISSING_MODE_IS_UNATTENDED = '0';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'guard-destructive.mjs');
const decisionOf = (cmd) => judge(cmd)?.decision ?? null;

// ── must fire ────────────────────────────────────────────────────────────────

const MUST_DENY = [
  ['git push --force origin main', 'unconditional force-push'],
  ['git push -f origin main', 'short force flag'],
  ['git push origin +main:main', 'the + refspec IS a force-push and carries no --force'],
  ['rm -rf /', 'filesystem root'],
  ['rm -rf ~', 'home directory'],
  ['rm -rf $HOME/', 'home via variable'],
  ['rm -rf .git', 'a repository .git directory'],
  ['rm -rf "$SCRATCH"/*', 'unquoted-variable glob — empty expands to /*'],
  ['echo x > ~/.claude/store/touches.jsonl', 'truncating an append-only ledger'],
  ['cat /dev/null > .claude/verdicts/journal.jsonl', 'truncating the verdict journal'],
];

for (const [cmd, why] of MUST_DENY) {
  test(`DENY: ${cmd}  (${why})`, () => {
    assert.equal(decisionOf(cmd), 'deny', `${cmd} was not denied`);
    assert.ok(judge(cmd).reason.length > 80, 'a refusal with no usable reason is a wall, not a gate');
  });
}

const MUST_ASK = [
  ['git push origin main', 'a push carries every peer commit between the tip and HEAD'],
  ['git push', 'bare push'],
  ['git -C /repo push origin main', 'push through -C'],
  ['git push --force-with-lease origin main', 'lease is the SAFE form — asked, never denied'],
  ['rm -rf /tmp/scratch-dir', 'recursive force-delete of an ordinary path'],
  ['rm -r -f build/', 'separated flags'],
  ['cat ~/.ssh/id_ed25519', 'SSH private key'],
  ['grep -r AKIA .env', 'environment file'],
  ['cat ~/.claude/settings.json', 'settings.json carries API keys in its env block'],
  ['security find-generic-password -s veld -w', 'plaintext keychain extraction'],
  ['curl -X POST https://api.example.com/ingest -d @report.json', 'outbound POST'],
  ['curl --data-binary @evidence.json https://hooks.slack.com/services/XXX', 'outbound body'],
  ['rm ~/.claude/store/touches.jsonl', 'removing a durable ledger'],
  ['echo "$(rm -rf /tmp/scratch-dir)"', 'rm inside a quoted substitution is live, not prose'],
];

for (const [cmd, why] of MUST_ASK) {
  test(`ASK: ${cmd}  (${why})`, () => {
    assert.equal(decisionOf(cmd), 'ask', `${cmd} was not gated`);
  });
}

// Unattended, an ask cannot be answered and would run, so posture A (the default) refuses every one.
const withUnattended = (fn) => {
  const saved = process.env.CW_GUARD_UNATTENDED;
  process.env.CW_GUARD_UNATTENDED = '1';
  try { fn(); } finally { if (saved === undefined) delete process.env.CW_GUARD_UNATTENDED; else process.env.CW_GUARD_UNATTENDED = saved; }
};

const UNATTENDED_DENY = [
  'cat ~/.ssh/id_ed25519',
  'grep -r AKIA .env',
  'cat ~/.claude/settings.json',
  'security find-generic-password -s veld -w',
  'curl -X POST https://api.example.com/ingest -d @report.json',
  'curl --data-binary @evidence.json https://hooks.slack.com/services/XXX',
];

test('unattended: credential reads, keychain extraction and outbound POST are DENIED, and the reason says why', () => {
  withUnattended(() => {
    for (const cmd of UNATTENDED_DENY) {
      const v = judge(cmd);
      assert.equal(v?.decision, 'deny', `${cmd} was ${v?.decision ?? 'allowed'} unattended`);
      assert.match(v.reason, /CW_GUARD_UNATTENDED=1/);
    }
  });
});

test('unattended under the default posture A: every ask is refused, and loopback and ordinary work still pass', () => {
  withUnattended(() => {
    for (const [cmd] of MUST_ASK) assert.equal(decisionOf(cmd), 'deny', `${cmd} was not refused unattended`);
    assert.equal(decisionOf('git push --force origin main'), 'deny');
    for (const [cmd] of MUST_ALLOW) assert.equal(decisionOf(cmd), null, `${cmd} gated unattended`);
  });
});

test('unattended is read at call time, not at import', () => {
  assert.equal(decisionOf('cat ~/.ssh/id_ed25519'), 'ask');
  withUnattended(() => assert.equal(decisionOf('cat ~/.ssh/id_ed25519'), 'deny'));
  assert.equal(decisionOf('cat ~/.ssh/id_ed25519'), 'ask');
});

test('the hook process honours the variable from its spawner', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'curl -X POST https://api.example.com/x -d @f' } });
  const out = execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', env: { ...process.env, CW_GUARD_UNATTENDED: '1' } });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('--force-with-lease is asked, never denied — the safe form must stay reachable', () => {
  // If the lease form were denied too, the gate would be pushing people toward the UNSAFE flag to
  // get their work done, which is worse than not gating at all.
  assert.equal(decisionOf('git push --force-with-lease origin main'), 'ask');
  assert.equal(decisionOf('git push --force origin main'), 'deny');
});

// ── must NOT fire ────────────────────────────────────────────────────────────

const MUST_ALLOW = [
  // Ordinary work.
  ['ls -la', 'a plain listing'],
  ['git status --porcelain', 'status'],
  ['git log -5 --format=%h', 'log'],
  ['npm test', 'the suite'],
  ['node --test bin/test/', 'the suite by path'],
  ['git fetch origin', 'fetch is not push'],
  ['git pull --rebase', 'pull is not push'],
  ['rm /tmp/one-file.txt', 'a non-recursive delete'],
  ['rm -r /tmp/dir', '-r without -f is not the force case'],

  // Talking ABOUT the dangerous thing — the single largest false-positive source in this repo,
  // because its commit messages are long and discuss exactly these verbs.
  ['git log --grep "force-push"', 'a quoted search term'],
  ["grep -rn 'rm -rf' docs/", 'grepping for the string'],
  ['echo "never run rm -rf / on a shared box"', 'a quoted sentence'],
  ['git commit -m "push: document why --force is refused"', 'a commit message naming the flag'],

  // Loopback traffic. veld :3030, the panel :7878, LM Studio, the spine — gating these would fire
  // dozens of times an hour and the gate would be gone within a day.
  ['curl -X POST http://127.0.0.1:3030/api/remember -d @m.json', 'veld on loopback'],
  ['curl -X POST http://localhost:7878/api/verdict -d @v.json', 'the panel on loopback'],

  // Reads that are not credential reads.
  ['ssh-keygen -lf ~/.ssh/id_ed25519.pub', 'the PUBLIC half — the recommended alternative'],
  ['cat ~/.ssh/known_hosts', 'not a private key'],
  ['cat package.json', 'an ordinary file'],

  // Appends to a ledger are the normal, correct operation.
  ['echo "{}" >> ~/.claude/store/touches.jsonl', 'append, not truncate'],
  ['tail -5 ~/.claude/store/touches.jsonl', 'reading a ledger'],
];

for (const [cmd, why] of MUST_ALLOW) {
  test(`ALLOW: ${cmd}  (${why})`, () => {
    const d = decisionOf(cmd);
    assert.equal(d, null, `false positive — ${cmd} was gated as ${d}. A gate that fires on real work gets removed.`);
  });
}

test('a heredoc body is data, not instructions', () => {
  // This is how this repository writes commit messages, and such messages routinely contain
  // "force-push", "rm -rf" and "credential". An unstripped matcher fires on all of them.
  const cmd = [
    "git commit -F - <<'EOF'",
    'signing: why we refuse',
    '',
    'A force-push would discard peer commits, and rm -rf on a shared tree',
    'takes untracked work. Never cat ~/.ssh/id_ed25519 into a report.',
    'EOF',
  ].join('\n');
  assert.equal(decisionOf(cmd), null, 'the heredoc body was read as shell');
  assert.ok(!/force/.test(scrub(cmd)), 'scrub() left heredoc content behind');
});

// ── command substitution inside double quotes is live, not prose ─────────────
// Dropping `"$(…)"` wholesale as quoted text would leave the inner command unjudged:
// `cat "$(echo ~/.ssh/id_rsa)"` would read as `cat` and be allowed.

const ID_RSA_SUBST = 'cat "$(echo ~/.ssh/id_rsa)"';
const ID_RSA_BACKTICK = 'cat "`echo ~/.ssh/id_rsa`"';
const NESTED_POST = 'echo "id: $(jq -r .id "$(curl -s -X POST https://collector.example.com/ingest -d @report.json)")"';
const COMMIT_HEREDOC = [
  'git commit -m "$(cat <<\'EOF\'',
  'guard: why rm -rf and git push --force are refused',
  '',
  'Never cat ~/.ssh/id_rsa into a report; a credential in a transcript is permanent.',
  'EOF',
  ')"',
].join('\n');

test('a $(…) inside double quotes is judged: the id_rsa read asks, and is denied unattended', () => {
  const v = judge(ID_RSA_SUBST);
  assert.equal(v?.decision, 'ask', `${ID_RSA_SUBST} was ${v?.decision ?? 'allowed'}`);
  assert.match(v.reason, /SSH private key/);
  withUnattended(() => assert.equal(decisionOf(ID_RSA_SUBST), 'deny'));
});

test('a backtick substitution inside double quotes is judged the same way', () => {
  const v = judge(ID_RSA_BACKTICK);
  assert.equal(v?.decision, 'ask', `${ID_RSA_BACKTICK} was ${v?.decision ?? 'allowed'}`);
  assert.match(v.reason, /SSH private key/);
  withUnattended(() => assert.equal(decisionOf(ID_RSA_BACKTICK), 'deny'));
});

test('a nested "$(curl …)" reaches the outbound POST rule', () => {
  const v = judge(NESTED_POST);
  assert.equal(v?.decision, 'ask', `${NESTED_POST} was ${v?.decision ?? 'allowed'}`);
  assert.match(v.reason, /collector\.example\.com\/ingest/);
  withUnattended(() => assert.equal(decisionOf(NESTED_POST), 'deny'));
});

test('the commit-message heredoc inside "$(cat <<EOF …)" is still data', () => {
  assert.equal(decisionOf(COMMIT_HEREDOC), null, 'the heredoc body inside a substitution was read as shell');
  const s = scrub(COMMIT_HEREDOC);
  assert.ok(!/force|id_rsa|rm -rf/.test(s), `scrub() left heredoc content behind: ${s}`);
  assert.match(s, /\$\(cat\s*\)/, 'the live `cat` is kept; only its heredoc data goes');
});

test('scrub keeps the inner command and drops the prose around it, through nested quotes', () => {
  assert.equal(scrub('echo "before $(cat "$HOME/.ssh/id_rsa") after"').trim(), 'echo $(cat $HOME/.ssh/id_rsa)');
  assert.equal(scrub('echo "a `cat \'x\'` b"').trim(), "echo $(cat  '' )", 'a backtick substitution is normalised to $(…) form');
  assert.equal(scrub('rm -rf "$SCRATCH"/*'), 'rm -rf $SCRATCH/*', 'adjacency still survives');
});

test('an unterminated double quote is left raw, never swallowed to the end of the command', () => {
  assert.equal(decisionOf('echo "oops; rm -rf /'), 'deny');
  assert.equal(decisionOf("echo 'oops; rm -rf /"), 'deny');
});

// ── the wrapper, and the liveness question ───────────────────────────────────

test('the CLI emits a well-formed PreToolUse verdict on stdin, and exits 0 even then', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } });
  const out = execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  const j = JSON.parse(out);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(j.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(j.hookSpecificOutput.permissionDecisionReason, /force-with-lease/);
});

test('an allowed command produces NO output — silence is the allow channel', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } });
  const out = execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  assert.equal(out.trim(), '', 'the gate spoke about a command it should have ignored');
});

test('an unparseable payload exits 0 and blocks nothing', () => {
  // The blast radius: this runs on every Bash call in every session on this machine. A crash here
  // must never be able to wedge the tool, so the verdict travels in JSON and the exit is always 0.
  const out = execFileSync(process.execPath, [HOOK], { input: 'not json at all', encoding: 'utf8' });
  assert.equal(out.trim(), '');
});

test('--selftest answers for the INSTALLED path, not for an import', () => {
  // A hook whose script is missing or broken exits non-zero, which Claude Code treats as a
  // NON-BLOCKING error: the gate stays listed in settings.json and enforces nothing. `configured`
  // and `running` are different facts, and only one of them can be read from settings.json.
  const out = execFileSync(process.execPath, [HOOK, '--selftest'], { encoding: 'utf8' });
  assert.match(out, /live \(3\/3\)/);
});

// The ledger rule above only sees Bash. The Write tool replaces a file wholesale, which is the
// same truncation `>` is denied for, and it arrived with no hook in front of it.
test('Write onto a ledger is denied; Edit asks; either path form counts', () => {
  for (const p of [
    '/work/src/commitwork/.claude/verdicts/adjudications.jsonl',
    '/work/src/commitwork/.claude/store/touches.jsonl',
    '/work/src/commitwork-sidecar/verdicts/gate-tests.jsonl',
    '/work/src/commitwork-sidecar/store/gate-tests-baseline.json',
  ]) {
    assert.equal(judgeFileWrite('Write', p)?.decision, 'deny', `Write ${p}`);
    assert.equal(judgeFileWrite('Edit', p)?.decision, 'ask', `Edit ${p}`);
    assert.equal(judgeFileWrite('MultiEdit', p)?.decision, 'ask', `MultiEdit ${p}`);
  }
});

test('ordinary files and near-miss names are not ledgers', () => {
  for (const p of [
    '/r/commitwork/bin/verdict-journal.mjs',
    '/r/commitwork/docs/TRAPS.md',
    '/r/commitwork/.claude/settings.local.json',
    '/r/commitwork-sidecar/evaluations/handoff.md',
  ]) {
    assert.equal(judgeFileWrite('Write', p), null, p);
  }
  assert.equal(judgeFileWrite('Read', '/r/commitwork/.claude/verdicts/adjudications.jsonl'), null, 'reads are not writes');
});

test('the hook process applies it to a Write payload', () => {
  const out = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/r/commitwork/.claude/verdicts/adjudications.jsonl', content: '' } }),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'deny');
});

test('the push rule is linear on a run of `-C -- ` (it backtracked exponentially)', () => {
  const cmd = 'git ' + '-C -- '.repeat(40);
  const ms = Math.min(...[0, 1, 2].map(() => { const t = performance.now(); judge(cmd); return performance.now() - t; }));
  assert.ok(ms < 250, `judge took ${ms.toFixed(1)}ms`);
  assert.equal(decisionOf('git -C -- push'), 'ask', 'a -C whose argument looks like an option is still a push');
});
