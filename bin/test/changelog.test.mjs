// fact: every range is read from a REAL throwaway repository / a mocked git agrees with whatever it was told (expiry: never, prev: missing)
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PREAMBLE, GENERATED_MARK, build, classify, previousTag, renderSection, upsert } from '../changelog.mjs';

const CLI = fileURLToPath(new URL('../changelog.mjs', import.meta.url));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXED = '2026-01-02T03:04:05Z';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: FIXED, GIT_AUTHOR_DATE: FIXED },
}).trim();

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-changelog-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  return dir;
}
const commit = (dir, message) => { git(dir, 'commit', '-q', '--allow-empty', '-m', message); return git(dir, 'rev-parse', 'HEAD'); };

const run = (dir, args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CW_REPO_ROOT: dir, CW_CHANGELOG_OUT: join(dir, 'docs', 'CHANGELOG.md'), CW_NOW: '', ...env },
});

/** a history with one release tag and a mixed range after it */
function released() {
  const dir = repo();
  commit(dir, 'feat(core): add the first thing');
  git(dir, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  commit(dir, 'fix(core): stop dropping the last line');
  commit(dir, 'feat(api): accept a second input');
  commit(dir, 'docs: explain the second input');
  commit(dir, 'feat(api)!: rename the input field');
  commit(dir, 'refactor(core): split the parser\n\nBREAKING CHANGE: the parser module moved');
  commit(dir, 'tidy things up');
  commit(dir, 'wip(core): an unlisted type');
  return dir;
}

test('the default range starts at the nearest release tag before --to', () => {
  const dir = released();
  assert.equal(previousTag('HEAD', dir), 'v0.1.0');
  const p = build({ cwd: dir });
  assert.equal(p.from, 'v0.1.0');
  assert.equal(p.commits, 7, 'the tagged commit itself is outside the range');
});

test('the section groups by type, breaking first, every commit on one line with its short id', () => {
  const dir = released();
  const { section } = build({ cwd: dir });
  const headings = section.split('\n').filter((l) => l.startsWith('### '));
  assert.deepEqual(headings, ['### Breaking changes', '### Features', '### Fixes', '### Documentation', '### Other: wip', '### Not conventional']);
  assert.match(section, /^## Unreleased — 2026-01-02\n/);
  assert.match(section, /^`v0\.1\.0\.\.HEAD` · 7 commits$/m);
  assert.match(section, /^- \*\*feat\(api\):\*\* rename the input field \(`[0-9a-f]{8}`\)$/m);
  assert.match(section, /^- \*\*refactor\(core\):\*\* split the parser BREAKING CHANGE: the parser module moved \(`[0-9a-f]{8}`\)$/m);
  assert.match(section, /### Not conventional\n\n- tidy things up \(`[0-9a-f]{8}`\)/, 'a non-conventional subject is listed, not dropped');
  assert.equal((section.match(/^- /gm) || []).length, 7, 'each commit appears exactly once');
});

test('a tagged --to names the section after its tag, and the range ends there', () => {
  const dir = released();
  git(dir, 'tag', 'v0.2.0');
  commit(dir, 'feat(core): land after the release');
  const p = build({ to: 'v0.2.0', cwd: dir });
  assert.equal(p.from, 'v0.1.0');
  assert.equal(p.label, 'v0.2.0');
  assert.doesNotMatch(p.section, /land after the release/);
  assert.equal(build({ cwd: dir }).from, 'v0.2.0', 'past the new tag, HEAD starts from it');
});

test('no release tag and no --from is exit 20, and nothing is written', () => {
  const dir = repo();
  commit(dir, 'feat: begin');
  commit(dir, 'fix: follow up');
  const r = run(dir, []);
  assert.equal(r.status, 20, r.stderr);
  assert.match(r.stderr, /pass --from/);
  assert.throws(() => readFileSync(join(dir, 'docs', 'CHANGELOG.md')), /ENOENT/);
  const s = run(dir, ['--from', 'HEAD~1', '--stdout']);
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /- follow up/);
});

test('a ref that names no commit is exit 21, never an empty range', () => {
  const dir = released();
  const r = run(dir, ['--from', 'v9.9.9']);
  assert.equal(r.status, 21);
  assert.throws(() => readFileSync(join(dir, 'docs', 'CHANGELOG.md')), /ENOENT/);
});

test('unknown arguments and missing values are usage errors', () => {
  const dir = released();
  assert.equal(run(dir, ['--frm', 'x']).status, 22);
  assert.equal(run(dir, ['--from']).status, 22);
});

test('the written file is byte-identical on a re-run, and a regenerated range replaces its section', () => {
  const dir = released();
  const out = join(dir, 'docs', 'CHANGELOG.md');
  assert.equal(run(dir, []).status, 0);
  const first = readFileSync(out, 'utf8');
  assert.ok(first.startsWith(PREAMBLE));
  assert.equal(run(dir, []).status, 0);
  assert.equal(readFileSync(out, 'utf8'), first, 'a re-run changes no byte');
  assert.equal((first.match(/^## /gm) || []).length, 1);

  git(dir, 'tag', 'v0.2.0');
  commit(dir, 'fix(core): after the second release');
  assert.equal(run(dir, ['--to', 'v0.2.0']).status, 0);
  assert.deepEqual(readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('## ')), ['## v0.2.0 — 2026-01-02'],
    'the release absorbed the stale Unreleased section');
  assert.equal(run(dir, []).status, 0);
  const second = readFileSync(out, 'utf8');
  const heads = second.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## Unreleased — 2026-01-02', '## v0.2.0 — 2026-01-02'], 'Unreleased leads, releases follow newest first');
  assert.match(second, /`v0\.2\.0\.\.HEAD` · 1 commit$/m);
});

test('CW_NOW pins the date', () => {
  const dir = released();
  const r = run(dir, ['--stdout'], { CW_NOW: '2030-05-06T00:00:00Z' });
  assert.match(r.stdout, /^## Unreleased — 2030-05-06/);
});

test('a hand-written CHANGELOG is refused rather than overwritten', () => {
  const dir = released();
  const out = join(dir, 'CHANGELOG.md');
  writeFileSync(out, '# My notes\n');
  const r = run(dir, [], { CW_CHANGELOG_OUT: out });
  assert.equal(r.status, 21);
  assert.equal(readFileSync(out, 'utf8'), '# My notes\n');
});

test('commit text is untrusted: control characters and raw HTML are neutralised', () => {
  const s = renderSection({
    label: 'Unreleased', date: '2026-01-01', fromLabel: 'a', toLabel: 'b',
    commits: [{ sha: 'a'.repeat(40), message: 'fix: drop <script> tags\u0007 now' }],
  });
  assert.match(s, /drop &lt;script> tags {2}now/);
});

test('classify reads the bang and the footer, and keeps an unparsable subject whole', () => {
  assert.equal(classify('feat(x)!: y').breaking, true);
  assert.equal(classify('fix: y\n\nbody\n\nBREAKING-CHANGE: z\n').note, 'z');
  assert.deepEqual(classify('Revert "feat: y"'), { type: 'revert', scope: null, breaking: false, description: 'Revert "feat: y"', note: null });
  assert.equal(classify('no colon here').type, null);
});

test('upsert with no sections is exactly the preamble', () => {
  assert.equal(upsert(null, '## v1.0.0 — 2026-01-01\n\nx\n').startsWith(`${PREAMBLE}\n## v1.0.0`), true);
});

test('the tracked docs/CHANGELOG.md is the generator\'s, and every commit id it cites exists in this repository', () => {
  const text = readFileSync(join(ROOT, 'docs', 'CHANGELOG.md'), 'utf8');
  assert.ok(text.includes(GENERATED_MARK));
  assert.ok(text.startsWith(PREAMBLE), 'the preamble is owned by bin/changelog.mjs');
  // a section carried from another history cites commits this repository does not have
  const ids = [...text.matchAll(/\(`([0-9a-f]{8})`\)$/gm)].map((m) => m[1]);
  for (const id of ids) {
    const r = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${id}^{commit}`]);
    assert.equal(r.status, 0, `docs/CHANGELOG.md cites ${id}, which is not a commit in this repository`);
  }
});
