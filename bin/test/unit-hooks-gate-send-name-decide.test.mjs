// Whether a SendMessage to a bare commitwork session name passes or is blocked as contended (bin/hooks/gate-send-name.mjs decide).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../hooks/gate-send-name.mjs';

const DASH = '\u2014';
const send = (to) => ({ tool_name: 'SendMessage', tool_input: { to } });
const rows = [
  { pid: 100, ref: 'aa11', name: 'commitwork-aa' },
  { pid: 200, ref: 'bb22', name: 'commitwork-aa' },
];

test('a null payload passes as not a send', () => {
  assert.deepEqual(decide(null), { decision: 'pass', why: 'not a send' });
});

test('a payload for another tool passes as not a send even when its to looks like a session name', () => {
  const r = decide({ tool_name: 'Read', tool_input: { to: 'commitwork-aa' } });
  assert.deepEqual(r, { decision: 'pass', why: 'not a send' });
});

test('a send whose to has no name-suffix shape passes as not a session name', () => {
  assert.deepEqual(decide(send('invalid')), { decision: 'pass', why: 'to is not a session name' });
});

test('a send with no tool_input passes as not a session name', () => {
  assert.deepEqual(decide({ tool_name: 'SendMessage' }), { decision: 'pass', why: 'to is not a session name' });
});

test('a send addressed with a bracketed ref passes as already disambiguated', () => {
  const r = decide(send('commitwork-aa[1234]'));
  assert.deepEqual(r, { decision: 'pass', why: `addressed by ref ${DASH} already disambiguated` });
});

test('a send to a session of another project passes as outside the roster population', () => {
  const r = decide(send('other-aa'));
  assert.deepEqual(r, { decision: 'pass', why: "other is outside this roster's population" });
});

test('a send to a commitwork name with no options passes as having no roster row', () => {
  const r = decide(send('commitwork-aa'));
  assert.deepEqual(r, { decision: 'pass', why: `no roster row ${DASH} unverifiable, not contended` });
});

test('a send to a commitwork name with an empty roster passes as having no roster row', () => {
  const r = decide(send('commitwork-aa'), { rows: [] });
  assert.deepEqual(r, { decision: 'pass', why: `no roster row ${DASH} unverifiable, not contended` });
});

test('a send whose roster rows have no pid in the live set passes as having no live holder', () => {
  const r = decide(send('commitwork-aa'), { rows, live: new Set([999]) });
  assert.deepEqual(r, { decision: 'pass', why: `no live holder ${DASH} unverifiable, not contended` });
});

test('a live list given as an array instead of a set makes the roster assessment throw', () => {
  assert.throws(() => decide(send('commitwork-aa'), { rows, live: [100, 200] }), {
    name: 'TypeError',
    message: 'live.has is not a function',
  });
});
