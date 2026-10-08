import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killTree, describeKill } from '../proc-tree.mjs';
import { pidAlive } from '../pid-alive.mjs';

// ── the Windows branch, without needing to be on Windows ───────────────────────────────────────

test('WINDOWS uses taskkill /T /F — an argv array, never a shell', () => {
  const calls = [];
  const r = killTree(4242, { platform: 'win32', spawn: (f, a, o) => { calls.push([f, a, o]); return { status: 0 }; } });
  assert.equal(r.ok, true);
  assert.equal(r.survived, false);
  assert.equal(r.method, 'taskkill');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'taskkill.exe');
  assert.deepEqual(calls[0][1], ['/T', '/F', '/PID', '4242'], '/T is the whole tree — the point of the fix');
  assert.equal(calls[0][2].shell, undefined, 'no shell:true anywhere near a kill');
});

test('WINDOWS: taskkill exit 128 is "already gone" — a post-condition met, not a swallowed error', () => {
  const r = killTree(1, { platform: 'win32', spawn: () => ({ status: 128 }) });
  assert.equal(r.ok, true);
  assert.equal(r.survived, false);
  assert.equal(r.alreadyGone, true);
  assert.equal(describeKill(r), '; the process had already exited');
});

test('WINDOWS: a FAILED taskkill is reported as survived, not silently discarded', () => {
  const r = killTree(1, { platform: 'win32', spawn: () => ({ status: 1, stderr: 'Access is denied.' }) });
  assert.equal(r.ok, false);
  assert.equal(r.survived, true);
  assert.match(r.error, /exited 1/);
  assert.match(r.error, /Access is denied/, 'the OS reason survives to the operator');
  // The claim the old code made — "was killed" — is now contradicted in the record itself.
  assert.match(describeKill(r), /WARNING: the kill FAILED/);
  assert.match(describeKill(r), /still be running and writing/);
});

test('WINDOWS: taskkill.exe missing entirely is a reported failure, not a throw', () => {
  const r = killTree(1, { platform: 'win32', spawn: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.equal(r.ok, false);
  assert.equal(r.survived, true);
  assert.equal(r.error, 'ENOENT');
});

// ── the POSIX branch ───────────────────────────────────────────────────────────────────────────

test('POSIX kills the process GROUP first — that is why the child is spawned detached', () => {
  const sent = [];
  const r = killTree(99, { platform: 'linux', kill: (p, s) => sent.push([p, s]) });
  assert.equal(r.ok, true);
  assert.equal(r.method, 'group');
  assert.deepEqual(sent, [[-99, 'SIGKILL']], 'negative pid = the group led by 99');
  assert.equal(describeKill(r), '', 'a clean kill adds nothing to the reason line');
});

test('POSIX: a group kill that fails falls back to the leader and ADMITS the descendants are unaccounted for', () => {
  const sent = [];
  const r = killTree(99, {
    platform: 'linux',
    kill: (p, s) => { if (p < 0) { const e = new Error('no group'); e.code = 'EPERM'; throw e; } sent.push([p, s]); },
  });
  assert.equal(r.ok, true);
  assert.equal(r.method, 'leader-only');
  assert.equal(r.survived, true, 'killing only the leader is not a clean kill and must not claim to be');
  assert.deepEqual(sent, [[99, 'SIGKILL']]);
  assert.match(describeKill(r), /only the leader was killed/);
});

test('POSIX: ESRCH means it already exited — success, with the reason recorded', () => {
  const r = killTree(99, { platform: 'linux', kill: () => { const e = new Error('gone'); e.code = 'ESRCH'; throw e; } });
  assert.equal(r.ok, true);
  assert.equal(r.survived, false);
  assert.equal(r.alreadyGone, true);
});

test('POSIX: both kills failing is a reported failure carrying BOTH causes', () => {
  const r = killTree(99, {
    platform: 'linux',
    kill: () => { const e = new Error('nope'); e.code = 'EPERM'; throw e; },
  });
  assert.equal(r.ok, false);
  assert.equal(r.survived, true);
  assert.match(r.error, /EPERM; then EPERM/);
});

// ── input validation ───────────────────────────────────────────────────────────────────────────

test('a non-pid never reaches the OS', () => {
  for (const bad of [0, -1, null, undefined, NaN, 1.5, '123']) {
    let touched = false;
    const r = killTree(bad, { platform: 'win32', spawn: () => { touched = true; return { status: 0 }; } });
    assert.equal(r.ok, false, `${bad} must not be treated as a pid`);
    assert.equal(r.survived, true);
    assert.equal(touched, false, `${bad} must not reach taskkill — a stringly-typed pid is how you kill pid 1`);
  }
});

// ── SECOND WITNESS: a real tree, on this box ───────────────────────────────────────────────────
// The unit tests above verify the argv we construct. They cannot verify that taskkill /T actually
// reaps a GRANDCHILD, which is the entire claim. This spawns a real two-level tree and checks the
// grandchild's own liveness independently, so it cannot share a failure mode with the mock.

// A killed process nothing reaps stays a zombie that kill(0) still finds; pidAlive reads it dead.
const alive = (pid) => pidAlive(pid);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('EFFECT: killTree reaps a real GRANDCHILD, not just the process we spawned', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-kill-'));
  const pidFile = join(dir, 'grandchild.pid');
  // parent: spawn a child that records its own pid, then both sit idle for a minute
  const parentSrc = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.env.PIDFILE, String(process.pid)); setTimeout(()=>{}, 60000);'],
      { env: process.env, stdio: 'ignore' });
    fs.writeFileSync(process.env.PIDFILE + '.parent', String(process.pid));
    setTimeout(() => {}, 60000);
  `;
  const parent = spawn(process.execPath, ['-e', parentSrc], {
    env: { ...process.env, PIDFILE: pidFile }, stdio: 'ignore', detached: true,
  });
  parent.unref();
  try {
    for (let i = 0; i < 100 && !existsSync(pidFile); i++) await settle(50);
    if (!existsSync(pidFile)) { t.skip('the fixture tree did not start'); return; }
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    assert.ok(grandchild > 0);
    assert.equal(alive(parent.pid), true, 'the parent is running before the kill');
    assert.equal(alive(grandchild), true, 'the grandchild is running before the kill');

    const res = killTree(parent.pid);
    assert.equal(res.ok, true, `the kill must succeed: ${res.error}`);

    // Both must go. The grandchild is the one the old Windows code left running.
    let pAlive = true, gAlive = true;
    for (let i = 0; i < 100 && (pAlive || gAlive); i++) {
      await settle(50);
      pAlive = alive(parent.pid);
      gAlive = alive(grandchild);
    }
    assert.equal(pAlive, false, 'the parent was killed');
    assert.equal(gAlive, false, 'THE GRANDCHILD WAS KILLED — on Windows this is what kill(-pid) never did');
    assert.equal(res.survived, false, 'and the record agrees with the machine');
  } finally {
    try { process.kill(parent.pid, 'SIGKILL'); } catch { /* already reaped, which is the pass case */ }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EFFECT: killing a pid that is already gone reports success, against the real OS', () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  return new Promise((resolve) => {
    child.on('exit', () => {
      const r = killTree(pid);
      // The post-condition "this tree is not running" holds, so this is a pass on both platforms.
      assert.equal(r.ok, true, `an exited process is not a kill failure: ${r.error}`);
      assert.equal(r.survived, false);
      resolve();
    });
  });
});

test('describeKill on null/undefined is empty, never "undefined" in an operator-facing string', () => {
  assert.equal(describeKill(null), '');
  assert.equal(describeKill(undefined), '');
});
