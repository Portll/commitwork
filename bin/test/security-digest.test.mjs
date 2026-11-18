import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  securityDigest,
  DIGEST_EVENT_TYPES,
  DIGEST_STATES,
} from '../../lib/security-digest.mjs';

const at = '2024-01-01T00:00:00Z';
const ev = (over = {}) => ({
  id: 'e1', subject: 'alpha', type: 'severity-crossing', severity: 'high', measured: true, at, ...over,
});
const digest = (events, previousIds = []) => securityDigest({ events, previousIds });
const failsWith = (fn, pattern) => assert.throws(fn, (err) => err instanceof TypeError && pattern.test(err.message));

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

test('measured events are grouped by subject with cause and severity counts', () => {
  const events = [
    ev({ id: 'e4', subject: 'alpha', type: 'coverage-loss', severity: 'crit' }),
    ev({ id: 'e1', subject: 'beta', type: 'sweep-failure', severity: 'low' }),
    ev({ id: 'e3', subject: 'alpha', type: 'coverage-loss', severity: 'high' }),
    ev({ id: 'e2', subject: 'alpha', type: 'severity-crossing', severity: 'high' }),
  ];
  assert.deepEqual(digest(events), {
    state: 'measured',
    subjects: [
      {
        subject: 'alpha',
        count: 3,
        causes: [{ type: 'coverage-loss', count: 2 }, { type: 'severity-crossing', count: 1 }],
        severities: [{ severity: 'crit', count: 1 }, { severity: 'high', count: 2 }],
        ids: ['e2', 'e3', 'e4'],
      },
      {
        subject: 'beta',
        count: 1,
        causes: [{ type: 'sweep-failure', count: 1 }],
        severities: [{ severity: 'low', count: 1 }],
        ids: ['e1'],
      },
    ],
    unmeasured: [],
  });
});

test('duplicate stable ids collapse to one event', () => {
  const one = ev();
  const result = digest([one, { ...one }]);
  assert.deepEqual(result, digest([one]));
  assert.equal(result.subjects[0].count, 1);
  assert.deepEqual(result.subjects[0].ids, ['e1']);
});

test('the same id with different event fields is refused', () => {
  failsWith(() => digest([ev(), ev({ subject: 'beta' })]), /events\[1\]\.id duplicates a different event: e1/);
});

test('previously delivered ids are excluded from measured and unmeasured evidence', () => {
  const result = digest([
    ev({ id: 'a' }),
    ev({ id: 'b', type: 'coverage-loss', severity: null, measured: false }),
    ev({ id: 'c' }),
  ], ['a', 'b', 'missing', 'a']);
  assert.equal(result.state, 'measured');
  assert.deepEqual(result.subjects.map((s) => s.subject), ['alpha']);
  assert.deepEqual(result.subjects[0].ids, ['c']);
  assert.deepEqual(result.unmeasured, []);
});

test('unmeasured evidence is kept out of the measured groups', () => {
  const result = digest([
    ev({ id: 'm1', subject: 'alpha', type: 'severity-crossing', severity: 'high' }),
    ev({ id: 'u1', subject: 'alpha', type: 'coverage-loss', severity: null, measured: false }),
    ev({ id: 'u2', subject: 'beta', type: 'sweep-failure', severity: 'low', measured: false }),
  ]);
  assert.equal(result.state, 'partial');
  assert.deepEqual(result.subjects, [{
    subject: 'alpha',
    count: 1,
    causes: [{ type: 'severity-crossing', count: 1 }],
    severities: [{ severity: 'high', count: 1 }],
    ids: ['m1'],
  }]);
  assert.deepEqual(result.unmeasured, [
    { id: 'u1', subject: 'alpha', type: 'coverage-loss', at },
    { id: 'u2', subject: 'beta', type: 'sweep-failure', at },
  ]);
});

test('each digest state is reachable and named in the exported frozen list', () => {
  const states = [
    digest([ev()]).state,
    digest([ev({ measured: false, severity: null })]).state,
    digest([ev(), ev({ id: 'e2', measured: false, severity: null })]).state,
    digest([]).state,
  ];
  assert.deepEqual(states, ['measured', 'unmeasured', 'partial', 'empty']);
  assert.deepEqual(DIGEST_STATES, ['measured', 'partial', 'unmeasured', 'empty']);
  assert.ok(Object.isFrozen(DIGEST_STATES));
});

test('every event type is accepted and retained as a cause', () => {
  const types = ['severity-crossing', 'coverage-loss', 'ratchet-breach', 'sweep-failure', 'sla-breach'];
  const events = types.map((type, i) => ev({ id: `e${i}`, type }));
  const result = digest(events);
  assert.deepEqual(DIGEST_EVENT_TYPES, types);
  assert.deepEqual(result.subjects[0].causes.map((c) => c.type), [...types].sort());
  assert.equal(result.subjects[0].count, types.length);
  assert.ok(Object.isFrozen(DIGEST_EVENT_TYPES));
});

test('no new events yields the explicit empty state, never an implicit pass', () => {
  assert.deepEqual(digest([]), { state: 'empty', subjects: [], unmeasured: [] });
  assert.deepEqual(digest([ev({ id: 'x' })], ['x']), { state: 'empty', subjects: [], unmeasured: [] });
});

test('output is byte-identical whatever order events and previousIds arrive in', () => {
  const events = [
    ev({ id: 'b', subject: 'beta', type: 'sweep-failure', severity: 'low' }),
    ev({ id: 'a', subject: 'alpha', type: 'coverage-loss', severity: 'crit' }),
    ev({ id: 'u1', subject: 'alpha', type: 'ratchet-breach', severity: null, measured: false }),
    ev({ id: 'e0', subject: 'beta', type: 'sla-breach', severity: 'high' }),
  ];
  const forward = digest(events, ['old2', 'old1']);
  const reverse = digest([...events].reverse(), ['old1', 'old2']);
  assert.equal(JSON.stringify(forward), JSON.stringify(reverse));
});

test('a deep-frozen input is not mutated', () => {
  const events = deepFreeze([
    ev({ id: 'b', subject: 'beta' }),
    ev({ id: 'a', subject: 'alpha' }),
    ev({ id: 'u', subject: 'beta', measured: false, severity: null }),
  ]);
  const previousIds = deepFreeze(['old']);
  const result = digest(events, previousIds);
  assert.deepEqual(result.subjects.map((s) => s.subject), ['alpha', 'beta']);
  assert.deepEqual(result.unmeasured.map((u) => u.id), ['u']);
});

test('fields the specification does not name, including credentials, never reach the output', () => {
  const secret = 'tok_live_should_not_appear';
  const result = digest([ev({ token: secret, credential: secret, note: secret })]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(Object.keys(result.subjects[0]).sort(), ['causes', 'count', 'ids', 'severities', 'subject']);
});

test('missing named fields are refused even when an alternative name is present', () => {
  failsWith(() => digest([{ ...ev(), type: undefined, kind: 'severity-crossing' }]), /events\[0\]\.type/);
  failsWith(() => digest([{ ...ev(), severity: undefined, severityScore: 9 }]), /events\[0\]\.severity/);
});

test('malformed input throws a TypeError naming the field', () => {
  failsWith(() => securityDigest(), /events must be an array/);
  failsWith(() => securityDigest(null), /events must be an array/);
  failsWith(() => digest('events'), /events must be an array/);
  failsWith(() => securityDigest({ events: [] }), /previousIds must be an array/);
  failsWith(() => digest([null]), /events\[0\] must be an object/);
  failsWith(() => digest([[]]), /events\[0\] must be an object/);
  failsWith(() => digest([ev({ id: '' })]), /events\[0\]\.id must be a non-empty string/);
  failsWith(() => digest([ev({ subject: '' })]), /events\[0\]\.subject must be a non-empty string/);
  failsWith(() => digest([ev({ type: 'unknown' })]), /events\[0\]\.type must be one of/);
  failsWith(() => digest([ev({ measured: 'true' })]), /events\[0\]\.measured must be a boolean/);
  failsWith(() => digest([ev({ severity: null })]), /events\[0\]\.severity must be a non-empty string when measured/);
  failsWith(() => digest([ev({ measured: false, severity: undefined })]), /events\[0\]\.severity must be a non-empty string or null when unmeasured/);
  failsWith(() => digest([ev({ measured: false, severity: 42 })]), /events\[0\]\.severity must be a non-empty string or null when unmeasured/);
  failsWith(() => digest([ev({ at: '2023-02-30T00:00:00Z' })]), /events\[0\]\.at must be an ISO-8601 instant/);
  failsWith(() => digest([ev({ at: undefined })]), /events\[0\]\.at must be an ISO-8601 instant/);
  failsWith(() => digest([], [1]), /previousIds\[0\] must be a non-empty string/);
  failsWith(() => digest([], ['']), /previousIds\[0\] must be a non-empty string/);
});

test('unmeasured evidence is ordered by id', () => {
  const r = digest([
    ev({ id: 'u2', measured: false, severity: null }),
    ev({ id: 'u1', measured: false, severity: null }),
    ev({ id: 'u3', measured: false, severity: null }),
  ]);
  assert.deepEqual(r.unmeasured.map((u) => u.id), ['u1', 'u2', 'u3']);
});
