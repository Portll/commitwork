// The session lifecycle lexicon: what can be ESTABLISHED about another agent, and what cannot.
//
// The operator asked for live / asleep / down / deleted / cleared / terminated / disappeared. Most
// are not separable by anything observable here, and printing them as if they were would be the
// defect this cycle exists to remove. So the lexicon declares each state with the signal that
// establishes it, and where several of those words collapse into one observable it says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySession, SESSION_STATES, STATE_NAMES, ENDED, REACHABLE, ACTIVE_WINDOW_MS }
  from '../lib/session-lifecycle.mjs';

const NOW = Date.parse('2026-08-30T10:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('a self-declared close BEATS every inference — the session said so', () => {
  assert.equal(classifySession({ hasMarker: true, hasSocket: true, lastRowAt: ago(0), now: NOW }), 'closed',
    'its own statement outranks a socket we have not seen reaped yet');
});

test('socket + recent activity is live; socket + silence is idle, not dead', () => {
  assert.equal(classifySession({ hasSocket: true, lastRowAt: ago(60_000), now: NOW }), 'live');
  assert.equal(classifySession({ hasSocket: true, lastRowAt: ago(ACTIVE_WINDOW_MS + 1), now: NOW }), 'idle');
});

test('THE ONE THAT MATTERS: acted, then vanished with no marker, is DISAPPEARED', () => {
  assert.equal(classifySession({ hasSocket: false, lastRowAt: ago(60 * 60_000), now: NOW }), 'disappeared',
    'it ended without recording that it had — measured today on two real sessions');
});

test('DISAPPEARED is not UNKNOWN — absence of a record is not a record of absence', () => {
  assert.equal(classifySession({ hasSocket: false, lastRowAt: null, now: NOW }), 'unknown');
  assert.notEqual(classifySession({ hasSocket: false, lastRowAt: null }), 'disappeared',
    'an id that never acted may be from another checkout, or never have run');
});

test('the conflation is DECLARED, not hidden — down/deleted/cleared/killed are one observable', () => {
  assert.match(SESSION_STATES.disappeared.note, /CONFLATES/);
  for (const w of ['down', 'deleted', 'cleared', 'killed']) {
    assert.ok(SESSION_STATES.disappeared.note.includes(w), `${w} must be named as conflated, not silently dropped`);
  }
  assert.match(SESSION_STATES.disappeared.note, /does not exist here/,
    'and it must say what evidence WOULD separate them');
});

test('every state declares the signal that establishes it and how certain that is', () => {
  for (const [k, v] of Object.entries(SESSION_STATES)) {
    assert.ok(v.signal && v.signal.length > 10, `${k} has no signal`);
    assert.ok(['observed', 'self-declared', 'inferred from absence', 'none'].includes(v.certainty),
      `${k} has an undeclared certainty: ${v.certainty}`);
  }
});

test('closed is self-declared, disappeared is inferred — the two are NOT equally certain', () => {
  assert.equal(SESSION_STATES.closed.certainty, 'self-declared');
  assert.equal(SESSION_STATES.disappeared.certainty, 'inferred from absence');
});

test('ENDED and REACHABLE partition the states, with unknown in neither', () => {
  for (const s of STATE_NAMES) {
    assert.equal(ENDED.has(s) && REACHABLE.has(s), false, `${s} cannot be both`);
  }
  assert.equal(ENDED.has('unknown') || REACHABLE.has('unknown'), false,
    'unknown belongs to neither — that is the whole point of having it');
});

test('classifySession never invents a state outside the lexicon', () => {
  const inputs = [
    {}, { hasSocket: true }, { hasMarker: true }, { lastRowAt: 'nonsense' },
    { hasSocket: true, lastRowAt: 'nonsense', now: NOW }, { hasSocket: false, lastRowAt: ago(1) },
  ];
  for (const i of inputs) assert.ok(STATE_NAMES.has(classifySession(i)), `escaped the lexicon: ${JSON.stringify(i)}`);
});
