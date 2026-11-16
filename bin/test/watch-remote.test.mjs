// node --test bin/test/ — the off-box watcher's decision. Pure: rows and the clock are injected.
//
// The load-bearing assertions are the quiet ones: a host that stays down is NOT re-notified every tick, and a
// machine that lost its own connection is NOT reported as every host down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../watch-remote.mjs';

const ok = (hostname) => ({ hostname, state: 'ok', ok: true, status: 401 });
const bad = (hostname, state = 'unexpected-status', status = 502) => ({ hostname, state, ok: false, status, detail: `answered ${status}` });
const H = 3_600_000;

test('first run: healthy hosts are silent, a bad one is notified', () => {
	const { notes, next } = decide(null, [ok('a'), bad('b')], 1000);
	assert.deepEqual(notes.map((n) => [n.kind, n.host]), [['bad', 'b']]);
	assert.equal(next.hosts.a.state, 'ok');
	assert.equal(next.hosts.b.state, 'unexpected-status');
});

test('a host that stays bad is not re-notified before the re-alert interval, then is', () => {
	const first = decide(null, [bad('b')], 0).next;
	assert.deepEqual(decide(first, [bad('b')], 5 * 60_000).notes, []);
	const later = decide(first, [bad('b')], 6 * H);
	assert.deepEqual(later.notes.map((n) => n.kind), ['still-bad']);
	assert.deepEqual(decide(later.next, [bad('b')], 6 * H + 60_000).notes, []);
});

test('recovery and a change of failure kind are both transitions', () => {
	const down = decide(null, [ok('a'), bad('b')], 0).next;
	assert.deepEqual(decide(down, [ok('a'), ok('b')], 30 * 60_000).notes.map((n) => n.kind), ['recovered']);
	// A second host answers, so b's timeout is b's, not this machine going offline.
	const timedOut = decide(down, [ok('a'), bad('b', 'timeout', null)], 60_000);
	assert.deepEqual(timedOut.notes.map((n) => n.kind), ['bad']);
});

test('a gate that disappears (401 expected, 200 seen) is a transition from ok', () => {
	const healthy = decide(null, [ok('panel')], 0).next;
	const open = decide(healthy, [{ hostname: 'panel', state: 'unexpected-status', ok: false, status: 200, detail: 'answered 200 where 401 was expected' }], 60_000);
	assert.equal(open.notes[0].kind, 'bad');
	assert.match(open.notes[0].text, /200/);
});

test('every host unreachable is this machine offline: one note, host states kept', () => {
	const healthy = decide(null, [ok('a'), ok('b')], 0).next;
	const off = decide(healthy, [bad('a', 'unreachable', null), bad('b', 'timeout', null)], 60_000);
	assert.equal(off.offline, true);
	assert.deepEqual(off.notes.map((n) => n.kind), ['offline']);
	assert.equal(off.next.hosts.a.state, 'ok', 'an unknown must not overwrite the last known state');
	const stillOff = decide(off.next, [bad('a', 'unreachable', null), bad('b', 'unreachable', null)], 120_000);
	assert.deepEqual(stillOff.notes, []);
	const back = decide(stillOff.next, [ok('a'), ok('b')], 180_000);
	assert.deepEqual(back.notes.map((n) => n.kind), ['online']);
});

test('one host unreachable while others answer is that host, not the watcher', () => {
	const healthy = decide(null, [ok('a'), ok('b')], 0).next;
	const r = decide(healthy, [ok('a'), bad('b', 'unreachable', null)], 60_000);
	assert.equal(r.offline, false);
	assert.deepEqual(r.notes.map((n) => [n.kind, n.host]), [['bad', 'b']]);
});
