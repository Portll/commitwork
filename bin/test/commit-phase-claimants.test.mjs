// commit-phase consumes the fingerprints: a pathspec land of a file that carries ANOTHER session's
// standing edit names that session before landing (P12 — a whole-file land banks their hunks under
// your message). A report, not a refusal: the author may be landing on their behalf deliberately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeId } from '../lib/store-paths.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commit-phase.mjs');
const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
// Rows dated AFTER the fixture's base commit: only an edit since the path's last commit can still
// be uncommitted, and the report filters on that boundary.
const later = (secs) => new Date(Date.now() + 5_000 + secs * 1000).toISOString();
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// Every commit stamps package.json from its parent's, so the fixture carries one.
const PKG = '{\n  "name": "fixture",\n  "version": "0.1.0",\n  "private": true\n}\n';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-claimants-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 't@example.invalid']); g(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(dir, 'package.json'), PKG);
  g(dir, ['add', '-A']); g(dir, ['commit', '-q', '-m', 'test: base']);
  return dir;
}

function cli(cwd, args, ledger) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, CW_COMMIT_REPO: cwd, CW_TOUCH_LEDGER: ledger, CW_ALLOW_UNSIGNED: '1', CLAUDE_CODE_SESSION_ID: 'me000000-0000' },
  });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

test('a peer\'s STANDING fingerprint on a declared path is named before the land; my own is not an alarm', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo edited by peer\nthree by me\n');
  const ledger = join(dir, 'touches.jsonl');
  const r = treeId(dir);
  writeFileSync(ledger, [
    { s: 'peer0000', r, at: later(0), f: 'a.txt', h: fp('two'), n: fp('two edited by peer'), t: 'edit', access: 'write' },
    { s: 'me000000', r, at: later(60), f: 'a.txt', h: fp('two edited by peer\n'), n: fp('two edited by peer\nthree by me\n'), t: 'edit', access: 'write' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const res = cli(dir, ['-m', 'fix: commit a shared file whole', '--', 'a.txt'], ledger);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /P12 — a\.txt carries a standing edit by peer0000/);
  assert.match(res.err, /stage-mine/);
  assert.match(res.out, /landed/);
});

test('no peer fingerprint: nothing is said', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree by me\n');
  const ledger = join(dir, 'touches.jsonl');
  writeFileSync(ledger, JSON.stringify({ s: 'me000000', r: treeId(dir), at: later(60), f: 'a.txt', n: fp('three by me'), t: 'edit', access: 'write' }) + '\n');
  const res = cli(dir, ['-m', 'fix: commit mine alone', '--', 'a.txt'], ledger);
  assert.equal(res.code, 0, res.err);
  assert.doesNotMatch(res.err, /P12/);
});

test('an unreadable ledger is reported as unread, never as "no peer edits"', (t) => {
  const dir = scratch(t);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nx\n');
  const res = cli(dir, ['-m', 'fix: commit with the ledger absent', '--', 'a.txt'], join(dir, 'no-such-ledger.jsonl'));
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /touch ledger not read/);
});
