// gate-send-name — the L8 gate at the send. The property: it blocks on two LIVE holders of a bare
// name and on NOTHING else, because every other condition is unverifiable rather than contended and
// a gate that fires on unverifiable becomes alarm fatigue within the hour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, parseTo } from '../hooks/gate-send-name.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = resolve(HERE, '..', 'hooks', 'gate-send-name.mjs');
const NOW = new Date().toISOString();
const row = (name, pid, ref) => ({ name, ref, id: `${ref}00-0000`, pid: String(pid), tree: 'fixture', at: NOW, via: 'observed' });
const send = (to) => ({ tool_name: 'SendMessage', tool_input: { to, message: 'x' } });

test('parseTo: names with and without refs, and things that are not names', () => {
  assert.deepEqual(parseTo('commitwork-xa'), { name: 'commitwork-xa', ref: null, project: 'commitwork' });
  assert.deepEqual(parseTo('commitwork-xa [0d7008]'), { name: 'commitwork-xa', ref: '0d7008', project: 'commitwork' });
  assert.deepEqual(parseTo('sample-layer-3c'), { name: 'sample-layer-3c', ref: null, project: 'sample-layer' });
  assert.equal(parseTo('main'), null);
  assert.equal(parseTo('a-6109-s0opuv'), null);
});

test('two LIVE holders of the bare name block; the same name with a [ref] passes', () => {
  const rows = [row('xa', 111, '0d7008'), row('xa', 222, '625132')];
  const live = new Set(['111', '222']);
  const b = decide(send('commitwork-xa'), { rows, live });
  assert.equal(b.decision, 'block');
  assert.match(b.why, /2 LIVE holders/);
  assert.match(b.why, /0d7008/);
  assert.equal(decide(send('commitwork-xa [0d7008]'), { rows, live }).decision, 'pass');
});

test('one live holder passes; two rows with only one still live passes — the dead one is stale, not contending', () => {
  const rows = [row('xa', 111, '0d7008'), row('xa', 222, '625132')];
  assert.equal(decide(send('commitwork-xa'), { rows, live: new Set(['111']) }).decision, 'pass');
});

test('no roster row, or rows nothing corroborates, is UNVERIFIABLE and passes', () => {
  assert.equal(decide(send('commitwork-zz'), { rows: [], live: new Set() }).decision, 'pass');
  const uncorroborated = [{ name: 'zz', ref: 'aaaaaa', tree: 'fixture', at: NOW, via: 'observed' }, { name: 'zz', ref: 'bbbbbb', tree: 'fixture', at: NOW, via: 'observed' }];
  const d = decide(send('commitwork-zz'), { rows: uncorroborated, live: new Set() });
  assert.equal(d.decision, 'pass');
  assert.match(d.why, /unverifiable/);
});

test('liveness unmeasurable (live=null) never blocks — an unmeasurable witness may not veto', () => {
  const rows = [row('xa', 111, '0d7008'), row('xa', 222, '625132')];
  assert.equal(decide(send('commitwork-xa'), { rows, live: null }).decision, 'pass');
});

test('other tools, other projects and non-name addresses pass without consulting anything', () => {
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }).decision, 'pass');
  assert.equal(decide(send('sample-layer-3c'), { rows: [row('3c', 1, 'a'), row('3c', 2, 'b')], live: new Set(['1', '2']) }).decision, 'pass');
  assert.equal(decide(send('main')).decision, 'pass');
  assert.equal(decide(null).decision, 'pass');
});

test('end to end: the hook reads the roster through its own env seams and exits 2 only on the contended send', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-send-gate-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const roster = join(d, 'sessions.jsonl');
  const sock = join(d, 'socks');
  mkdirSync(sock);
  // Two holders whose pids are alive as far as `kill -0` is concerned: this process and its parent.
  const me = String(process.pid); const parent = String(process.ppid);
  writeFileSync(join(sock, `${me}.sock`), ''); writeFileSync(join(sock, `${parent}.sock`), '');
  writeFileSync(roster, [row('xa', me, '0d7008'), row('xa', parent, '625132'), row('xb', me, 'cafe01')].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const run = (payload) => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, CW_SESSION_ROSTER: roster, CW_PEER_SOCKET_DIR: sock },
  });
  const blocked = run(send('commitwork-xa'));
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /REFUSED — 2 LIVE holders of commitwork-xa/);
  assert.equal(run(send('commitwork-xa [0d7008]')).status, 0);
  assert.equal(run(send('commitwork-xb')).status, 0, 'one live holder');
  assert.equal(run(send('commitwork-xc')).status, 0, 'no row');
  assert.equal(run({ tool_name: 'Bash', tool_input: {} }).status, 0);
  const garbage = spawnSync(process.execPath, [HOOK], { input: '{not json', encoding: 'utf8', env: { ...process.env, CW_SESSION_ROSTER: roster } });
  assert.equal(garbage.status, 0, 'a payload the hook cannot read is a pass, never a block');
});
