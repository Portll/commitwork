// A doc that is not in the repository does not exist for anybody but its author. R11.
//
// THE PROBE THAT FOUND IT, 2026-08-30: a doc that was stamped fresh, listed in README's
// "## Documentation" index, and NOT `git add`ed scored **green**, and the run exited **0**. The gate
// whose whole purpose is certifying documentation certified a file no clone contains.
//
// WHY A POSITIVE SET. The fix asks git `ls-files` — the TRACKED set — never
// `ls-files --others --exclude-standard`. The negative form EXCLUDES IGNORED PATHS, so a doc hidden
// under an ignore rule is invisible to the very check meant to find hidden docs; that blind spot and
// the thing it hid were one mechanism (CLAUDE.md). Membership of a positive set cannot have it.
//
// THREE STATES, because absent evidence is not evidence of absence: a tracked set, `null` for "not a
// repository" (inapplicable), and `undefined` for "git present but unreadable" — which must degrade
// a green to grey, never leave it green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDocs, verdict } from '../docs-doctor.mjs';

// Date-only, deliberately: a stamp carrying a SHA invites gitStaleness, and a fixture repo cannot
// contain the sha its own doc names without a chicken-and-egg amend. The existing docs-doctor suite
// uses the same shape for the same reason. Tracked-ness is what these tests are about.
const STAMP = '<!-- verified-against: 2026-08-30 -->';

/** A fixture repo whose README lists `docs/d.md`. `track` decides whether the doc is git-added. */
function fixture({ track, initRepo = true }) {
  const root = mkdtempSync(join(tmpdir(), 'cw-docsdr-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'README.md'),
    `${STAMP}\n# Fixture\n\n## Documentation\n- [D](docs/d.md) — a listed doc\n`);
  writeFileSync(join(root, 'docs', 'd.md'), `${STAMP}\n# D\n\nBody.\n`);
  if (initRepo) {
    const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('add', 'README.md');
    if (track) git('add', 'docs/d.md');
    git('commit', '-q', '-m', 'fixture');
  }
  return root;
}

const scan = (root) => collectDocs({ root, now: new Date('2026-08-30T12:00:00Z'), cachePath: null });
const statusOf = (r, p) => r.docs.find((d) => d.path === p)?.status;

test('THE DEFECT: a stamped, listed, UNTRACKED doc is not green', () => {
  const root = fixture({ track: false });
  try {
    const r = scan(root);
    assert.equal(statusOf(r, 'docs/d.md'), 'untracked',
      'an untracked doc scored green — this is the R11 defect, and the gate is certifying a file no clone has');
    assert.equal(verdict(r), 1, 'and the run must not exit 0');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the same doc, tracked, is green — the check discriminates rather than condemning', () => {
  const root = fixture({ track: true });
  try {
    const r = scan(root);
    assert.equal(statusOf(r, 'docs/d.md'), 'green', 'a tracked, stamped, listed doc must pass');
    assert.equal(verdict(r), 0, 'and the run exits clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("`untracked` is its own state — never folded into orange", () => {
  const root = fixture({ track: false });
  try {
    const r = scan(root);
    const d = r.docs.find((x) => x.path === 'docs/d.md');
    assert.notEqual(d.status, 'orange',
      'orange means "needs updating"; untracked means "is not in the repository". Conflating them reports a missing document as a stale one.');
    assert.match(d.reasons.join(' '), /not tracked in git/, 'and it must say why in its own words');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('NOT A REPOSITORY is inapplicable, not a failure — a fixture dir must not fail on tracked-ness', () => {
  const root = fixture({ track: false, initRepo: false });
  try {
    const r = scan(root);
    assert.notEqual(statusOf(r, 'docs/d.md'), 'untracked',
      'with no git repo there is nothing to be untracked FROM; asserting otherwise fails every fixture');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CW_DOCS_GIT=0 disables the check, and disabling does not mean passing silently', () => {
  const root = fixture({ track: false });
  const prev = process.env.CW_DOCS_GIT;
  process.env.CW_DOCS_GIT = '0';
  try {
    const r = collectDocs({ root, now: new Date('2026-08-30T12:00:00Z'), cachePath: null, git: false });
    assert.notEqual(statusOf(r, 'docs/d.md'), 'untracked', 'the switch must actually switch it off');
  } finally {
    if (prev === undefined) delete process.env.CW_DOCS_GIT; else process.env.CW_DOCS_GIT = prev;
    rmSync(root, { recursive: true, force: true });
  }
});

// The exemption has to be asserted too, or the next person deletes it as dead code.
test('evaluations/ is exempt — untracked there is operator policy, not a defect', () => {
  const root = fixture({ track: true });
  try {
    mkdirSync(join(root, 'evaluations'), { recursive: true });
    writeFileSync(join(root, 'evaluations', 'PLAN.md'), '<!-- living-doc -->\n# Plan\n\nBody.\n');
    const r = scan(root);
    assert.notEqual(statusOf(r, 'evaluations/PLAN.md'), 'untracked',
      'evaluations/ is untracked on purpose and lives in the sidecar repo; flagging it reports policy as a defect');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A sidecar register resolved on the author's disk, so an index link to it passed everywhere the gate
// ran and dangled in every clone. The link must be a finding where the author runs the gate, and the
// register must stop being required in an index that ships.
function withSidecarRegister(root, { listed }) {
  mkdirSync(join(root, 'evaluations'), { recursive: true });
  writeFileSync(join(root, 'evaluations', 'DECISIONS.md'), '<!-- living-doc -->\n# Decisions\n');
  if (listed) writeFileSync(join(root, 'README.md'),
    `${STAMP}\n# Fixture\n\n## Documentation\n- [D](docs/d.md) — a listed doc\n- [R](evaluations/DECISIONS.md) — the register\n`);
}

test('an index link to an untracked sidecar register is a finding in the author tree', () => {
  const root = fixture({ track: true });
  try {
    withSidecarRegister(root, { listed: true });
    const reasons = scan(root).indexFindings.map((f) => f.reason);
    assert.deepEqual(reasons, ['doc index links to an untracked file a clone will not have: evaluations/DECISIONS.md']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an untracked sidecar register is not required in the index', () => {
  const root = fixture({ track: true });
  try {
    withSidecarRegister(root, { listed: false });
    const r = scan(root);
    assert.equal(statusOf(r, 'evaluations/DECISIONS.md'), 'living');
    assert.deepEqual(r.indexFindings, []);
    assert.equal(verdict(r), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a TRACKED register under evaluations/ must still be indexed — the exemption is for the sidecar only', () => {
  const root = fixture({ track: true });
  try {
    withSidecarRegister(root, { listed: false });
    execFileSync('git', ['-C', root, 'add', 'evaluations/DECISIONS.md'], { stdio: 'ignore' });
    assert.equal(statusOf(scan(root), 'evaluations/DECISIONS.md'), 'orange');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an index link to a tracked directory is not an untracked file', () => {
  const root = fixture({ track: true });
  try {
    writeFileSync(join(root, 'README.md'),
      `${STAMP}\n# Fixture\n\n## Documentation\n- [D](docs/d.md) — a listed doc\n- [all](docs/) — the folder\n`);
    assert.deepEqual(scan(root).indexFindings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an export-ignored doc is not required in the index, and an index link to one is a finding', () => {
  const root = fixture({ track: true });
  try {
    writeFileSync(join(root, '.gitattributes'), '/docs/d.md export-ignore\n');
    execFileSync('git', ['-C', root, 'add', '.gitattributes'], { stdio: 'ignore' });
    assert.deepEqual(scan(root).indexFindings.map((f) => f.reason),
      ['doc index links to an export-ignored file the published snapshot will not have: docs/d.md']);
    writeFileSync(join(root, 'README.md'), `${STAMP}\n# Fixture\n\n## Documentation\n`);
    const r = scan(root);
    assert.equal(statusOf(r, 'docs/d.md'), 'green', 'unlisted, and not required to be');
    assert.deepEqual(r.indexFindings, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
