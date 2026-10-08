// bin/stage-mine.mjs end to end, ONLY in a scratch git repo (CW_COMMIT_REPO) with a fixture touch
// ledger (CW_TOUCH_LEDGER). One tracked file carries three hunks: one whose text matches this
// session's standing fingerprint, one matching a peer's, one that only another tree's row names.
// Pins the per-hunk verdicts (mine / theirs / shared / unmatched — another tree's claims never
// count), the blob it would land (HEAD plus MY hunks only), the refusals, --json as one document on
// stdout and nothing else (so `| jq` works at any size), and --land: a commit that carries only my
// hunk while the working tree keeps everybody's edits and no frozen-blob temp dir is left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'stage-mine.mjs');
const ME = 'mine0001-aaaa-bbbb-cccc-000000000001';
const PEER = 'peer0002';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const BASE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
const MY_LINE = 'line 3 — edited by me';
const SHELL_LINE = 'line 14 — written by something the ledger cannot see';
const PEER_LINE = 'line 25 — edited by a peer';

function scratch(t, { ledger: extra = [], pad = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-stage-mine-entry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  // `pad` lines after the fixture's thirty make the --json document as large as a real file's
  const tail = Array.from({ length: pad }, (_, i) => `padding line ${i + 1} ${'x'.repeat(60)}`);
  writeFileSync(join(repo, 'a.txt'), `${[...BASE, ...tail].join('\n')}\n`);
  git('add', '--', 'a.txt'); git('commit', '-q', '-m', 'test: base');
  const edited = [...BASE]; edited[2] = MY_LINE; edited[13] = SHELL_LINE; edited[24] = PEER_LINE;
  writeFileSync(join(repo, 'a.txt'), `${[...edited, ...tail].join('\n')}\n`);
  const ledger = join(root, 'touches.jsonl');
  writeFileSync(ledger, [
    { f: 'a.txt', n: fp(MY_LINE), s: ME.slice(0, 8), t: 'edit', at: '2026-03-01T00:00:00.000Z' },
    { f: 'a.txt', n: fp(PEER_LINE), s: PEER, t: 'edit', at: '2026-03-01T00:01:00.000Z' },
    // the same text claimed from ANOTHER checkout: not evidence about this tree
    { f: 'a.txt', n: fp(SHELL_LINE), s: 'peer0003', t: 'edit', r: '000000000000', at: '2026-03-01T00:02:00.000Z' },
    ...extra,
  ].map((r) => JSON.stringify(r)).join('\n') + '\n{"f": "a.txt", "n":\n');
  return { root, repo, ledger, git };
}

function cli(s, args, { session = true } = {}) {
  // TMPDIR inside the sandbox, so a test can see --land remove the mkdtemp dir its blobs are frozen in
  const tmp = join(s.root, 'tmp'); mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, CW_COMMIT_REPO: s.repo, CW_TOUCH_LEDGER: s.ledger, CW_ALLOW_UNSIGNED: '1', TMPDIR: tmp };
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CW_COMMIT_SESSION', 'CLAUDE_SESSION_ID']) delete env[k];
  if (session) env.CLAUDE_CODE_SESSION_ID = ME;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, cwd: s.root });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** --json: stdout is the document and nothing else; the prose verdict line goes to stderr. */
const jsonOf = (r) => ({ doc: JSON.parse(r.out), tail: r.err.trimEnd().split('\n').at(-1) });

test('each hunk is mine, theirs or unmatched, and the blob to land is HEAD plus my hunk only', (t) => {
  const s = scratch(t);
  const r = cli(s, ['--json', '--', 'a.txt']);
  assert.equal(r.code, 0, r.err);
  const { doc, tail } = jsonOf(r);
  assert.equal(doc.session, 'mine0001');
  assert.equal(doc.ledgerTorn, 1);
  const f = doc.results[0];
  assert.deepEqual(f.hunks, [
    { state: 'mine', sessions: ['mine0001'], range: [3, 3] },
    { state: 'unmatched', sessions: [], range: [14, 14] },
    { state: 'theirs', sessions: [PEER], range: [25, 25] },
  ]);
  assert.deepEqual([f.mine, f.theirs, f.shared, f.unmatched, f.standingClaims, f.searched], [1, 1, 0, 1, 2, true]);
  const want = [...BASE]; want[2] = MY_LINE;
  assert.equal(f.content, `${want.join('\n')}\n`);
  assert.equal(tail, 'stage-mine: 1 file(s) have hunks to land — re-run with --land -m <msg>');
});

test('the human report names every hunk by line range and owner, and the torn ledger line', (t) => {
  const s = scratch(t);
  const r = cli(s, ['--session', ME, '--', 'a.txt']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /stage-mine: a\.txt — 3 hunk\(s\): 1 mine · 1 theirs · 0 shared · 1 unmatched · 2 standing fingerprint\(s\) in the ledger/);
  assert.match(r.out, / {2}lines 3-3 {2}MINE {6}mine0001\n/);
  assert.match(r.out, / {2}lines 14-14 {2}UNMATCHED \(no fingerprint covers this hunk\)\n/);
  assert.match(r.out, / {2}lines 25-25 {2}THEIRS {4}peer0002\n/);
  assert.match(r.out, /stage-mine: 1 torn ledger line\(s\) skipped/);
});

test('a hunk both sessions\' fingerprints cover is SHARED and is not landed as mine', (t) => {
  const s = scratch(t, { ledger: [{ f: 'a.txt', n: fp(`line 2\n${MY_LINE}`), s: PEER, t: 'edit', at: '2026-03-01T00:03:00.000Z' }] });
  const r = cli(s, ['--json', '--', 'a.txt']);
  const { doc, tail } = jsonOf(r);
  assert.equal(doc.results[0].hunks[0].state, 'shared');
  assert.deepEqual(doc.results[0].hunks[0].sessions.sort(), ['mine0001', PEER]);
  assert.equal(doc.results[0].content, null, 'nothing is mine alone, so there is no blob');
  assert.equal(r.code, 1);
  assert.equal(tail, 'stage-mine: nothing of yours to land');
});

test('refusals: no paths, no session, --land without -m, a repo with no HEAD', (t) => {
  const s = scratch(t);
  const noPaths = cli(s, ['--json']);
  assert.equal(noPaths.code, 2);
  assert.match(noPaths.err, /stage-mine: no paths\./);
  const noSession = cli(s, ['--', 'a.txt'], { session: false });
  assert.equal(noSession.code, 2);
  assert.match(noSession.err, /no session id .* Refusing: "mine" is undefined without one\./);
  const noMsg = cli(s, ['--land', '--', 'a.txt']);
  assert.equal(noMsg.code, 2);
  assert.match(noMsg.err, /--land needs -m <message>/);
  const bare = { ...s, repo: s.root };   // the scratch root itself is not a repository
  const noHead = cli(bare, ['--', 'a.txt']);
  assert.equal(noHead.code, 2);
  assert.match(noHead.err, /HEAD unreadable — refusing\./);
});

test('an untracked file is named as not splittable, and nothing is landed', (t) => {
  const s = scratch(t);
  writeFileSync(join(s.repo, 'new.txt'), 'brand new\n');
  const r = cli(s, ['--', 'new.txt']);
  assert.equal(r.code, 1);
  assert.match(r.out, /stage-mine: new\.txt — not a blob at HEAD \(untracked or a directory\)/);
  assert.match(r.out, /stage-mine: nothing of yours to land/);
});

test('--land commits only my hunk and leaves every edit in the working tree', (t) => {
  const s = scratch(t);
  const head0 = s.git('rev-parse', 'HEAD');
  const worktree = readFileSync(join(s.repo, 'a.txt'), 'utf8');
  const r = cli(s, ['--land', '-m', 'fix: keep only my hunk', '--', 'a.txt']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(s.git('rev-parse', 'HEAD~1'), head0, 'one commit on top of the old HEAD');
  assert.equal(s.git('log', '-1', '--format=%s'), 'fix: keep only my hunk');
  const want = [...BASE]; want[2] = MY_LINE;
  assert.equal(s.git('show', 'HEAD:a.txt'), want.join('\n'), 'the commit carries my line and nobody else\'s');
  assert.equal(readFileSync(join(s.repo, 'a.txt'), 'utf8'), worktree, 'the working tree was touched');
  assert.match(s.git('diff', 'HEAD', '--', 'a.txt'), /\+line 14 — written by[\s\S]*\+line 25 — edited by a peer/);
  assert.deepEqual(readdirSync(join(s.root, 'tmp')).filter((n) => n.startsWith('cw-stage-mine-')), [], 'the frozen-blob dir is removed');
});

test('--json past the 64KB pipe buffer still reaches a reader whole', (t) => {
  const s = scratch(t, { pad: 4000 });
  assert.ok(statSync(join(s.repo, 'a.txt')).size > 256 * 1024, 'fixture: the file, and so the document, is past any pipe buffer');
  const r = cli(s, ['--json', '--', 'a.txt']);
  assert.equal(r.code, 0, r.err);
  const { doc } = jsonOf(r);   // process.exit() cut it at the buffer, and a cut document does not parse
  assert.equal(doc.results[0].mine, 1);
  assert.ok(doc.results[0].content.endsWith(`padding line 4000 ${'x'.repeat(60)}\n`));
});
