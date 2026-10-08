// H1 — bin/commit-phase.mjs must leave a ledger row for what it landed.
//
// The defect these pin: the PostToolUse hook recovers a sha by PARSING `git commit` output, and
// commit-phase lands with commit-tree + update-ref, so commitShaFrom() returned null before a sha
// was ever sought. Measured 2026-08-30 — 41 via:'commit' rows that day for sessions using a bare
// `git commit`, ZERO for the tool that exists to make committing safe on an eight-session index.
// The safe path was the invisible one, and gate-tests told a session it had touched 0 of 159 files
// ninety seconds after it authored four of them.
//
// Nothing asserted this for months, which is the reason it survived: the ledger's silence looks
// exactly like a session that did nothing. So the last test here asserts the CONSUMER's verdict,
// not the row — a row nobody reads as write evidence would leave the gate saying the same thing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isWriteEvidence } from '../lib/touch-ledger-core.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
// Every commit stamps package.json from its parent's, so the fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function cli(cwd, args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CW_COMMIT_REPO: cwd,
      // CW_TOUCH_LEDGER IS SET HERE, at the helper, not in each test. commit-phase records what it
      // lands (H1), so without this every run of this file appended rows for `mine.txt` under a
      // scratch tree-id to the REAL .claude/store/touches.jsonl — 84 of them per suite run,
      // measured 2026-08-30. They were harmless to readers (each carries a foreign `r`) and
      // harmful anyway: they pushed the live ledger past its 2 MB rotation threshold, and a
      // rotation racing a gate read made bin/gate-spine.mjs report "did this session edit
      // anything" as UNKNOWN. A hermetic default belongs where no test can forget it.
      CW_TOUCH_LEDGER: join(cwd, '.cw-test-touches.jsonl'),
      // Signing OFF here for the same reason as commit-phase-e2e: these tests assert attribution,
      // not signatures, and requiring a private key would make them fail off this box.
      // bin/test/commit-phase-signing.test.mjs is where signing is actually covered.
      CW_ALLOW_UNSIGNED: '1',
        ...env,
      },
    });
    return { code: 0, out, err: '' };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '').toString(), err: (e.stderr || '').toString() };
  }
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-attrib-'));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 'test@example.invalid']);
  g(dir, ['config', 'user.name', 'test']);
  writeFileSync(join(dir, 'mine.txt'), 'base\n');
  writeFileSync(join(dir, 'untouched.txt'), 'base\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']);
  g(dir, ['commit', '-m', 'test: base']);
  return dir;
}

const rows = (p) => (existsSync(p)
  ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

test('a land records one via:\'commit\' row per file, carrying the sha it landed', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'touches.jsonl');

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', 'test: commit a file', '--', 'mine.txt'],
    // CLAUDE_PID is PINNED, not inherited: the shape assertion below would otherwise depend on
    // whether the runner happened to have one, passing on a session's machine and failing in CI
    // for a reason that has nothing to do with the change under test.
    { CW_TOUCH_LEDGER: ledger, CW_COMMIT_SESSION: 'sess1234abcd', CLAUDE_PID: '424242' });
  assert.equal(r.code, 0, r.err);
  const sha = r.out.split('\n')[0].trim();

  const got = rows(ledger);
  // Two files in the commit: the declared one, and package.json carrying the version stamp.
  assert.deepEqual(got.map((x) => x.f), ['mine.txt', 'package.json'], 'exactly one row per file in the commit');
  // `prev` is the ledger hash chain. It is in the shape because BOTH writers go through the one
  // appender — bin/commit-phase.mjs:122 and bin/touch-ledger.mjs:59 each call touchAppender() — so
  // parity is a property of the code path rather than of two lists agreeing. This expectation was
  // written before the chaining and had been failing ever since; widening it is the correction.
  // `p` (the CLAUDE_PID of the owning session) joined the shape on 2026-09-02 for the same reason
  // and by the same route: it is added inside touchAppender, so both writers gained it together and
  // parity held without either being edited. The value is pinned above rather than inherited; the
  // appender omits the key entirely when there is no pid, which bin/test/ledger-scratch-guard.test.mjs
  // pins in both directions.
  assert.deepEqual(Object.keys(got[0]).sort(), ['access', 'at', 'f', 'p', 'prev', 'r', 's', 'sha', 'via'].sort(),
    'shape must match the hook\'s commit row exactly — parity is the whole design decision');
  // Asserted, not merely tolerated: a `prev` that were present and always 'genesis' would satisfy
  // the shape above while chaining nothing, and an unchained ledger is exactly what the chain exists
  // to prevent — the attribution log everyone reads could be rewritten without a trace.
  assert.equal(got[0].prev, 'genesis', 'the first row in a fresh ledger anchors the chain');
  assert.equal(got[0].f, 'mine.txt');
  assert.equal(got[0].via, 'commit');
  assert.equal(got[0].sha, sha, 'the sha must be the one that landed, not HEAD read back later');
  assert.equal(got[0].s, 'sess1234', 'session truncated to 8, as the hook does');
  assert.deepEqual([got[1].via, got[1].sha], ['commit', sha], 'the stamped package.json is recorded under the same sha');
});

test('the file list is the COMMIT\'s, not the declared set', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'touches.jsonl');

  // untouched.txt is DECLARED but unchanged, so it is not in the tree the commit writes.
  // Recording it would assert authorship of a file this commit did not carry.
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', 'test: commit a file', '--', 'mine.txt', 'untouched.txt'],
    { CW_TOUCH_LEDGER: ledger, CW_COMMIT_SESSION: 'sess1234abcd' });
  assert.equal(r.code, 0, r.err);

  assert.deepEqual(rows(ledger).map((x) => x.f), ['mine.txt', 'package.json']);
});

test('no session id records NOTHING, and the commit still lands', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'touches.jsonl');

  // EVERY name, because the ambient environment supplies one. This test failed the moment
  // CLAUDE_CODE_SESSION_ID joined the chain — it cleared the two names the code used to read and
  // inherited the third from the real session, so a row appeared. That is the test working: a
  // fail-closed assertion that silently passes because it did not actually reach the closed state
  // is the failure mode this whole file exists to catch.
  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  const r = cli(dir, ['-m', 'test: commit a file', '--', 'mine.txt'],
    { CW_TOUCH_LEDGER: ledger, CW_COMMIT_SESSION: '', CLAUDE_CODE_SESSION_ID: '', CLAUDE_SESSION_ID: '' });

  assert.equal(r.code, 0, r.err);
  assert.equal(g(dir, ['show', '-s', '--format=%s', 'HEAD']), 'test: commit a file',
    'attribution is best-effort; a commit that landed is not undone by a ledger that did not');
  assert.equal(rows(ledger).length, 0, 'an unowned touch would read as somebody\'s — record none');
});

test('the row is WRITE EVIDENCE to the consumer, not merely present', (t) => {
  const dir = scratch();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = join(dir, 'touches.jsonl');

  writeFileSync(join(dir, 'mine.txt'), 'my work\n');
  cli(dir, ['-m', 'test: commit a file', '--', 'mine.txt'],
    { CW_TOUCH_LEDGER: ledger, CW_COMMIT_SESSION: 'sess1234abcd' });

  // The gate reported "YOU touched 0" while rows existed for other routes, so presence was never
  // the property in question — being READ as evidence is.
  assert.ok(isWriteEvidence(rows(ledger)[0]), 'isWriteEvidence must accept it, or the gate still says 0');
});
