// Every host git that names a repository goes through scannedGit (bin/lib/git-env.mjs), or its file
// is listed here with the reason its repositories are commitwork's own. A scanned repo's config
// names commands git runs on status, ls-files, diff, log -p, show, archive and merge; a raw spawn
// against one runs them on the host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Any call whose first argument is the literal 'git' (spawnSync, execFileSync, a local wrapper),
// a shell string that starts with git, and a `sh -c` script that runs git.
const FORMS = [
  /\b[A-Za-z_$][\w$]*\(\s*(['"`])git\1\s*,(?![^\n]{0,60}scannedGitArgv\()/g,
  /\b(?:execSync|exec)\(\s*(['"`])git\s/g,
  /(['"`])(?:sh|bash)\1\s*,\s*\[\s*(['"`])-c\2\s*,\s*(['"`])[^'"`]*\bgit\s/g,
];
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

function rawGitCalls(text) {
  const code = text.split('\n').filter((l) => !COMMENT_LINE.test(l)).join('\n');
  return FORMS.reduce((n, re) => n + [...code.matchAll(re)].length, 0);
}

const OWN = 'commitwork\'s own checkout (or a linked worktree of it)';
// file → [most raw calls allowed, why its repositories are not scanned ones]. A ceiling, not an
// exact count: sessions land into this tree concurrently, and a peer's held edit must not fail a
// clone that lacks it. Lower a ceiling when you remove a call; an entry with none left fails.
const ALLOWED = {
  'admin/routes/comments.mjs': [1, 'ls-files over the two operator projects it serves, commitwork and spine'],
  'admin/routes/docsite.mjs': [3, 'docsite documents live in commitwork and its sidecar; held by another session when this census was written'],
  'bin/addsecret.mjs': [1, OWN],
  'bin/adjudicate-gates.mjs': [2, OWN],
  'bin/anchor-commit.mjs': [1, 'the operator\'s chain-anchor store, a repository commitwork itself writes'],
  'bin/anchor-staleness.mjs': [6, OWN],
  'bin/anchor-triage.mjs': [3, OWN],
  'bin/anchor-witness.mjs': [1, 'the operator\'s off-host anchor witness repository; gitChildEnv already'],
  'bin/canary-harness.mjs': [2, OWN],
  'bin/close-gate.mjs': [1, OWN],
  'bin/commit-msg.mjs': [1, 'a commit-msg hook, running inside the commit it checks'],
  'bin/commit-phase.mjs': [6, OWN],
  'bin/commitwork.mjs': [1, 'toolchainVintage reads ROOT, commitwork itself; the scan target goes through scannedGit'],
  'bin/daily-run.mjs': [1, 'the operator\'s skill repository the daily command is read from'],
  'bin/docs-doctor.mjs': [4, OWN],
  'bin/docsite-publish-scheduled.mjs': [1, 'commitwork\'s ref to publish and the repository holding its private docsite root, both exported'],
  'bin/exit-codes.mjs': [1, OWN],
  'bin/format-phase.mjs': [1, OWN],
  'bin/gate-ratchet.mjs': [5, OWN],
  'bin/gate-tests.mjs': [1, OWN],
  'bin/head-sha.mjs': [1, OWN],
  'bin/hook.mjs': [2, 'runs as a repository\'s own pre-commit hook, inside a commit git is already making there, and must inherit its GIT_INDEX_FILE'],
  'bin/hooks/guard-destructive.mjs': [2, 'a session hook: the operator\'s global git config file and the session\'s own checkout'],
  'bin/install-commit-msg.mjs': [1, OWN],
  'bin/lane-fixture.mjs': [4, 'builds the fixture repository it then hands to a lane'],
  'bin/lib/lexical-ratchet.mjs': [1, OWN],
  'bin/lib/platform-seams.mjs': [1, OWN],
  'bin/lib/provenance-fixture.mjs': [1, 'builds a fixture repository, hooks already off'],
  'bin/lib/release-candidate-core.mjs': [5, 'commitwork\'s release candidate and its sidecar'],
  'bin/lib/release-names-head-scan.mjs': [6, 'commitwork\'s HEAD and its sidecar'],
  'bin/lib/release-reviews.mjs': [3, 'commitwork\'s release reviews'],
  'bin/lib/scan-target.mjs': [1, 'rev-parse on commitwork\'s own checkout, to keep a scan out of it'],
  'bin/offbox-watch-check.mjs': [1, 'the operator\'s off-host anchor witness repository; gitChildEnv already'],
  'bin/pattern-scan.mjs': [3, 'commitwork\'s own tree (its durable roots are evaluations/ and docs/)'],
  'bin/pin-actions.mjs': [1, 'ls-remote of a github.com URL; no repository operand'],
  'bin/projectstatus.mjs': [1, OWN],
  'bin/ratchet-corroborate.mjs': [1, OWN],
  'bin/reference.mjs': [2, `${OWN}: ls-files and the check-attr that leaves export-ignored files out; CW_REFERENCE_ROOT points it at a test fixture`],
  'bin/release-tag.mjs': [2, OWN],
  'bin/releases-atom.mjs': [1, OWN],
  'bin/resolve-sha.mjs': [2, OWN],
  'bin/stage-mine.mjs': [1, OWN],
  'bin/stale-worktree.mjs': [1, OWN],
  'bin/test-select.mjs': [1, OWN],
  'bin/touch-ledger.mjs': [2, OWN],
  'bin/web-roadmap.mjs': [1, 'log of commitwork\'s own release source (CW_RELEASE_SOURCE, default this checkout) for the roadmap\'s commits'],
  'bin/worktree-imports.mjs': [2, OWN],
  'codegraph/report.mjs': [2, OWN],
  'flow/static.mjs': [1, OWN],
  'lib/launchlist-checks.mjs': [3, 'init, add and commit in the scratch repository the check itself creates from a HEAD export'],
  'monitor/coincidence.mjs': [1, OWN],
  'monitor/defect-classify.mjs': [1, OWN],
  'monitor/history-chain.mjs': [3, 'the chain-anchor store in commitwork\'s sidecar'],
  'monitor/install-git-hook.mjs': [1, OWN],
};

function sources() {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', '*.mjs', '*.js', '*.cjs'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\0').filter(Boolean)
    .filter((f) => !/(^|\/)(test|fixtures|node_modules)\//.test(f) && f !== 'bin/lib/git-env.mjs');
}

test('the detector sees every call form, and none of the hardened or quoted ones', () => {
  const seen = [
    "spawnSync('git', ['-C', repo, 'status'])",
    'execFileSync("git", args, { cwd })',
    'const r = git(`git`, [\'log\'])',
    "run('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args])",
    "execSync('git log -1 --format=%H', { cwd: repo })",
    "execFileSync('sh', ['-c', 'git -C \"$1\" archive HEAD | tar -x', 'sh', repo])",
    "execFileSync(\n  'git',\n  ['-C', repo, 'ls-files'])",
  ];
  for (const s of seen) assert.equal(rawGitCalls(s), 1, `missed: ${s}`);
  const unseen = [
    "scannedGit(repo, ['status'])",
    "run('git', scannedGitArgv(repo, args), { env })",
    "// spawnSync('git', ['status'])",
    " * execFileSync('git', ['ls-files'])",
    "spawnSync('gitleaks', ['git', repo])",
    "throw new Error(`git log failed: ${why}`)",
  ];
  for (const s of unseen) assert.equal(rawGitCalls(s), 0, `false positive: ${s}`);
});

test('every raw host git is in a file whose repositories are commitwork\'s own', () => {
  const found = {};
  for (const f of sources()) {
    let text;
    try { text = readFileSync(join(ROOT, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const n = rawGitCalls(text);
    if (n) found[f] = n;
  }
  assert.ok(Object.keys(found).length > 10, 'the census found almost nothing: the detector or the file list is broken, not the tree clean');
  const problems = [];
  for (const [f, n] of Object.entries(found)) {
    if (!ALLOWED[f]) problems.push(`${f}: ${n} raw git call(s) — route them through scannedGit (bin/lib/git-env.mjs), or allow the file here with the reason its repositories are not scanned ones`);
    else if (n > ALLOWED[f][0]) problems.push(`${f}: ${n} raw git call(s), allowed ${ALLOWED[f][0]} — a new call against a scanned repo goes through scannedGit; otherwise raise the ceiling with the reason`);
  }
  for (const f of Object.keys(ALLOWED)) if (!found[f]) problems.push(`${f}: allowed but has no raw git call now — drop the entry`);
  assert.deepEqual(problems, []);
});
