import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pidAlive, processState } from '../pid-alive.mjs';

const err = (code) => Object.assign(new Error(code), { code });
const existing = () => {};

test('ESRCH is dead, EPERM is alive under another user', () => {
  assert.equal(pidAlive(4242, { kill: () => { throw err('ESRCH'); } }), false);
  assert.equal(pidAlive(4242, { kill: () => { throw err('EPERM'); }, platform: 'darwin', spawn: () => ({ status: 0, stdout: 'S' }) }), true);
});

test('an existing pid in state Z is dead: it has exited and only waits to be reaped', () => {
  assert.equal(pidAlive(4242, { kill: existing, platform: 'darwin', spawn: () => ({ status: 0, stdout: 'Z+\n' }) }), false);
  assert.equal(pidAlive(4242, { kill: existing, platform: 'darwin', spawn: () => ({ status: 0, stdout: 'Ss\n' }) }), true);
});

test('linux reads the state after the LAST paren, so a comm with parens cannot fool it', () => {
  const stat = '4242 (evil) Z (x)) S 1 4242 4242 0 -1';
  assert.equal(processState(4242, { platform: 'linux', readFile: () => stat }), 'S');
  assert.equal(processState(4242, { platform: 'linux', readFile: () => '4242 (node) Z 1 4242' }), 'Z');
});

test('a state it cannot read leaves the answer alive — no death is reported unseen', () => {
  const noPs = () => ({ error: err('ENOENT'), status: null });
  assert.equal(pidAlive(4242, { kill: existing, platform: 'darwin', spawn: noPs }), true);
  assert.equal(pidAlive(4242, { kill: existing, platform: 'linux', readFile: () => { throw err('ENOENT'); }, spawn: noPs }), true);
  assert.equal(pidAlive(4242, { kill: existing, platform: 'darwin', spawn: () => ({ status: 1, stdout: '' }) }), true);
});

test('not a pid is not alive, and pid 0 never reaches kill', () => {
  let touched = false;
  for (const bad of [0, -1, 1.5, NaN, '12']) assert.equal(pidAlive(bad, { kill: () => { touched = true; } }), false);
  assert.equal(touched, false);
});

test('EFFECT: a real unreaped child reads dead, while kill(0) alone still says it exists', { skip: process.platform === 'win32' && 'no zombies on Windows' }, async () => {
  // The backgrounded `sleep 0` exits at once; its parent becomes `sleep 3` by exec, which never
  // waits, so the child stays a zombie until that parent exits.
  const sh = spawn('/bin/sh', ['-c', 'sleep 0 & echo $!; exec sleep 3'], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const zpid = Number((await new Promise((r) => sh.stdout.once('data', r))).toString().trim());
    let state = null;
    for (let i = 0; i < 40 && state !== 'Z'; i++) { await new Promise((r) => setTimeout(r, 25)); state = processState(zpid); }
    assert.equal(state, 'Z', 'the fixture produced a zombie');
    assert.doesNotThrow(() => process.kill(zpid, 0), 'kill(0) still finds the zombie — the failure mode');
    assert.equal(pidAlive(zpid), false);
  } finally {
    sh.kill('SIGKILL');
  }
});
