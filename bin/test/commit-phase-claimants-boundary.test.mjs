// The claimants report fires only on edits since the path's last commit. A standing fingerprint
// older than that commit was landed by somebody already — naming it would fire on every
// frequently-edited file (measured: five sessions named on bin/commit-phase.mjs, all landed).
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
const g = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim();

test('a peer fingerprint OLDER than the last commit of the path is not reported', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-claimants-b-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  g(dir, ['init', '-q', '-b', 'main']);
  g(dir, ['config', 'user.email', 't@example.invalid']); g(dir, ['config', 'user.name', 't']);
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo edited by peer\n');
  // Every commit stamps package.json from its parent's, so the fixture carries one.
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "fixture",\n  "version": "0.1.0"\n}\n');
  g(dir, ['add', '-A']);
  // The base commit is dated in the FUTURE relative to the peer's row, so the row predates it.
  g(dir, ['commit', '-q', '-m', 'test: base'], { GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2030-01-01T00:00:00Z' });
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo edited by peer\nthree by me\n');
  const ledger = join(dir, 'touches.jsonl');
  writeFileSync(ledger, JSON.stringify({ s: 'peer0000', r: treeId(dir), at: '2026-09-09T10:00:00Z', f: 'a.txt', h: fp('two'), n: fp('two edited by peer'), t: 'edit', access: 'write' }) + '\n');
  const r = spawnSync(process.execPath, [CLI, '-m', 'fix: commit mine after their committed edit', '--', 'a.txt'], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, CW_COMMIT_REPO: dir, CW_TOUCH_LEDGER: ledger, CW_ALLOW_UNSIGNED: '1', CLAUDE_CODE_SESSION_ID: 'me000000-0000' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /P12/, 'their edit was already landed by that commit; nothing of theirs rides on mine');
});
