// bin/lib/sandbox-net.mjs on a refusal: it SIGKILLs bwrap, and bwrap may die holding data the helper
// wrote to it (resolv.conf on fd 5) unread. Node's pipes are socketpairs, so the helper's end then
// fails with ECONNRESET. The helper must still exit NOT_RUN with its reason, never 1 with a stack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_RUN } from '../lib/sandbox-net.mjs';

const HELPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'sandbox-net.mjs');
const which = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim();

test('a refusal while bwrap holds unread pipe data exits NOT_RUN with the reason, every time', { skip: process.platform !== 'linux' && 'the helper runs on Linux only' }, () => {
  // Arrange: a fake bwrap that announces a child pid on fd 3 and never reads fd 5; no pasta on PATH
  const bin = mkdtempSync(join(tmpdir(), 'cw-snet-'));
  for (const c of ['sh', 'sleep']) symlinkSync(which(c), join(bin, c));
  writeFileSync(join(bin, 'bwrap'), `#!${which('sh')}\nprintf '{"child-pid": %d}' $$ >&3\nexec sleep 30\n`, { mode: 0o755 });
  const argv = [HELPER, '--', join(bin, 'bwrap'), '--unshare-net', '--info-fd', '3', '--block-fd', '4', '--ro-bind-data', '5', '/etc/resolv.conf', '--', 'true'];
  // Act
  const runs = [];
  for (let i = 0; i < 15; i++) runs.push(spawnSync(process.execPath, argv, { encoding: 'utf8', env: { PATH: bin }, timeout: 20_000 }));
  // Assert
  for (const r of runs) {
    assert.equal(r.status, NOT_RUN, r.stderr);
    assert.match(r.stderr, /pasta is not installed/);
    assert.doesNotMatch(r.stderr, /ECONNRESET|EPIPE|Unhandled/);
  }
});
