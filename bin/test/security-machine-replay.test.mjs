import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replayMachine,
  compareMachine,
  MACHINE_REPLAY_STATES,
} from '../../lib/security-machine-replay.mjs';

const event = (over = {}) => ({
  id: 'e1',
  at: '2026-01-01T00:00:00Z',
  subject: 'host-a',
  type: 'measured',
  statePatch: { cpu: 1 },
  evidenceRefs: ['witness-1'],
  sequence: 0,
  ...over,
});
const replay = (events, at = '2026-01-02T00:00:00Z') => replayMachine({ events, at });
const subjectOf = (result, subject) => result.subjects.find((s) => s.subject === subject);
const rec = (subject, { state = {}, unknown = [], conflicting = [], status = 'measured' } = {}) => ({
  subject, status, eventIds: [], state, unknownFields: unknown, conflictingFields: conflicting,
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

test('every replay state and compare category is named in the exported frozen list', () => {
  assert.deepEqual(MACHINE_REPLAY_STATES, [
    'measured', 'unmeasured', 'conflicting',
    'added', 'removed', 'changed',
    'unmeasured-before', 'unmeasured-after', 'unmeasured-both',
    'conflicting-before', 'conflicting-after',
  ]);
  assert.ok(Object.isFrozen(MACHINE_REPLAY_STATES));
});

test('replay applies measured events at or before the instant and excludes later ones', () => {
  const events = [
    event({ id: 'e1', at: '2026-01-01T10:00:00Z', statePatch: { cpu: 1 } }),
    event({ id: 'e2', at: '2026-01-01T11:00:00Z', statePatch: { cpu: 2 } }),
    event({ id: 'e3', at: '2026-01-01T12:00:00Z', statePatch: { cpu: 3 } }),
  ];
  assert.deepEqual(replay(events, '2026-01-01T11:00:00Z'), {
    subjects: [{
      subject: 'host-a',
      status: 'measured',
      eventIds: ['e1', 'e2'],
      state: { cpu: 2 },
      unknownFields: [],
      conflictingFields: [],
    }],
  });
});

test('the selected instant and event instants compare as instants, not strings', () => {
  const result = replay([
    event({ id: 'e1', at: '2026-01-01T10:00:00+10:00', statePatch: { cpu: 1 } }),
    event({ id: 'e2', at: '2026-01-01T00:00:01Z', statePatch: { cpu: 2 } }),
  ], '2026-01-01T00:00:00Z');
  assert.deepEqual(subjectOf(result, 'host-a'), {
    subject: 'host-a', status: 'measured', eventIds: ['e1'], state: { cpu: 1 }, unknownFields: [], conflictingFields: [],
  });
});

test('equal timestamps apply sequence order, and a later sequence resolves an earlier disagreement', () => {
  const events = [
    event({ id: 'b', at: '2026-01-01T10:00:00Z', sequence: 0, statePatch: { cpu: 9 } }),
    event({ id: 'a', at: '2026-01-01T10:00:00Z', sequence: 0, statePatch: { cpu: 8 } }),
    event({ id: 'c', at: '2026-01-01T10:00:00Z', sequence: 1, statePatch: { cpu: 2 } }),
  ];
  const subject = subjectOf(replay(events, '2026-01-01T10:00:00Z'), 'host-a');
  assert.deepEqual(subject.state, { cpu: 2 });
  assert.deepEqual(subject.eventIds, ['a', 'b', 'c']);
  assert.deepEqual(subject.conflictingFields, []);
});

test('observations tied on instant and sequence that disagree leave the field conflicting', () => {
  const subject = subjectOf(replay([
    event({ id: 'b', at: '2026-01-01T10:00:00Z', statePatch: { cpu: 9 } }),
    event({ id: 'a', at: '2026-01-01T10:00:00Z', statePatch: { cpu: 8 } }),
  ], '2026-01-01T10:00:00Z'), 'host-a');
  assert.deepEqual(subject, {
    subject: 'host-a', status: 'conflicting', eventIds: ['a', 'b'], state: {}, unknownFields: [], conflictingFields: ['cpu'],
  });
});

test('a null observation is an unmeasured field, not zero or false', () => {
  const subject = subjectOf(replay([event({ statePatch: { cpu: null, running: null } })]), 'host-a');
  assert.deepEqual(subject, {
    subject: 'host-a', status: 'unmeasured', eventIds: ['e1'], state: {}, unknownFields: ['cpu', 'running'], conflictingFields: [],
  });
});

test('a measured field beside an unknown field keeps the subject measured and the gap explicit', () => {
  const subject = subjectOf(replay([event({ statePatch: { cpu: 3, disk: null } })]), 'host-a');
  assert.equal(subject.status, 'measured');
  assert.deepEqual(subject.state, { cpu: 3 });
  assert.deepEqual(subject.unknownFields, ['disk']);
});

test('command events contribute no state and their payload never reaches the output', () => {
  const result = replay([
    event({ id: 'm1', statePatch: { cpu: 1 } }),
    event({ id: 'c1', sequence: 1, type: 'command', statePatch: null, command: 'rm -rf /' }),
  ]);
  assert.deepEqual(result.subjects[0].state, { cpu: 1 });
  assert.deepEqual(result.subjects[0].eventIds, ['m1']);
  assert.ok(!JSON.stringify(result).includes('rm -rf'));
});

test('a command-only subject is not replayed as observed state', () => {
  const result = replay([
    event({ id: 'c1', subject: 'ghost', type: 'command', statePatch: null }),
  ]);
  assert.deepEqual(result, { subjects: [] });
});

test('subjects and state fields are output in sorted order', () => {
  const result = replay([
    event({ id: 'e1', subject: 'zeta', statePatch: { b: 1, a: 2 } }),
    event({ id: 'e2', subject: 'alpha', statePatch: { y: 1 } }),
  ]);
  assert.deepEqual(result.subjects.map((s) => s.subject), ['alpha', 'zeta']);
  assert.deepEqual(Object.keys(subjectOf(result, 'zeta').state), ['a', 'b']);
});

test('a field named like an object prototype key is an ordinary measured field', () => {
  const subject = subjectOf(replay([
    event({ statePatch: { ['__proto__']: 1, constructor: 2 } }),
  ]), 'host-a');
  assert.ok(Object.hasOwn(subject.state, '__proto__'));
  assert.deepEqual(subject.state, { ['__proto__']: 1, constructor: 2 });
  assert.equal(Object.getPrototypeOf(subject.state), Object.prototype);
});

test('input order does not change the output', () => {
  const events = [
    event({ id: 'e3', at: '2026-01-01T10:00:00Z', sequence: 1, statePatch: { cpu: 3, mode: 'idle' } }),
    event({ id: 'e1', at: '2026-01-01T09:00:00Z', sequence: 0, statePatch: { cpu: 1 } }),
    event({ id: 'e2', at: '2026-01-01T10:00:00Z', sequence: 0, statePatch: { cpu: 2 } }),
  ];
  assert.equal(JSON.stringify(replay(events)), JSON.stringify(replay([...events].reverse())));
  assert.deepEqual(subjectOf(replay(events), 'host-a').state, { cpu: 3, mode: 'idle' });
});

test('a deeply frozen input is not mutated', () => {
  const input = deepFreeze({
    events: [event({ statePatch: { cpu: 1, nested: { b: 2, a: 1 } } })],
    at: '2026-01-02T00:00:00Z',
  });
  assert.deepEqual(replayMachine(input).subjects[0].state, { cpu: 1, nested: { a: 1, b: 2 } });
});

test('object-valued measurements are canonical, so key order is not a change', () => {
  const result = replay([event({ statePatch: { config: { b: 2, a: 1 } } })]);
  assert.equal(JSON.stringify(result), JSON.stringify(replay([event({ statePatch: { config: { a: 1, b: 2 } } })])));
});

test('duplicate event ids are refused', () => {
  assert.throws(() => replay([event(), event()]), /duplicate event id: e1/);
});

test('malformed replay input is refused with the field named', () => {
  const at = '2026-01-02T00:00:00Z';
  assert.throws(() => replayMachine(null), /input must be an object/);
  assert.throws(() => replayMachine({ at }), /events must be an array/);
  assert.throws(() => replayMachine({ events: [], at: '2026-01-02' }), /at must be an ISO-8601 instant/);
  assert.throws(() => replayMachine({ events: [], at: '2026-02-30T00:00:00Z' }), /at must be an ISO-8601 instant/);
  assert.throws(() => replay([null]), /events\[0\] must be an object/);
  assert.throws(() => replay([event({ id: '' })]), /events\[0\]\.id must be a non-empty string/);
  assert.throws(() => replay([event({ at: 'soon' })]), /events\[0\]\.at must be an ISO-8601 instant/);
  assert.throws(() => replay([event({ subject: '' })]), /events\[0\]\.subject must be a non-empty string/);
  assert.throws(() => replay([event({ type: 'guess' })]), /events\[0\]\.type must be measured or command/);
  assert.throws(() => replay([event({ sequence: -1 })]), /events\[0\]\.sequence must be a non-negative integer/);
  assert.throws(() => replay([event({ sequence: 1.5 })]), /events\[0\]\.sequence/);
  assert.throws(() => replay([event({ evidenceRefs: 'witness' })]), /events\[0\]\.evidenceRefs must be an array/);
  assert.throws(() => replay([event({ evidenceRefs: [''] })]), /events\[0\]\.evidenceRefs\[0\] must be a non-empty string/);
  assert.throws(() => replay([event({ statePatch: null })]), /events\[0\]\.statePatch must be an object/);
  assert.throws(() => replay([event({ statePatch: { cpu: undefined } })]), /events\[0\]\.statePatch\.cpu must be a JSON value/);
  assert.throws(() => replay([event({ statePatch: { cpu: Infinity } })]), /events\[0\]\.statePatch\.cpu must be a finite number/);
  assert.throws(() => replay([event({ type: 'command', statePatch: { cpu: 1 } })]), /statePatch must be null on a command event/);
});

test('a subject absent before and present after is an addition with its own status', () => {
  const result = compareMachine({
    before: { subjects: [] },
    after: { subjects: [rec('host-b'), rec('ghost', { status: 'unmeasured' })] },
  });
  assert.deepEqual(result.added, [
    { kind: 'added', subject: 'ghost', status: 'unmeasured' },
    { kind: 'added', subject: 'host-b', status: 'measured' },
  ]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.unknown, []);
});

test('a subject present before and absent after is a removal carrying its last status', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { status: 'conflicting', conflicting: ['cpu'] })] },
    after: { subjects: [] },
  });
  assert.deepEqual(result.removed, [{ kind: 'removed', subject: 'host-a', status: 'conflicting' }]);
  assert.deepEqual(result.added, []);
});

test('a field measured on both sides with a different value is changed', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { state: { cpu: 1, mode: 'idle' } })] },
    after: { subjects: [rec('host-a', { state: { cpu: 2, mode: 'idle' } })] },
  });
  assert.deepEqual(result.changed, [{ kind: 'changed', subject: 'host-a', field: 'cpu', before: 1, after: 2 }]);
  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
});

test('compare consumes replay output directly', () => {
  const before = replay([event({ id: 'e1', statePatch: { cpu: 1 } })]);
  const after = replay([event({ id: 'e2', at: '2026-01-02T00:00:00Z', statePatch: { cpu: 2 } })]);
  assert.deepEqual(compareMachine({ before, after }).changed, [
    { kind: 'changed', subject: 'host-a', field: 'cpu', before: 1, after: 2 },
  ]);
});

test('a field measured only after is unknown evidence, not an inferred removal or addition', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { state: { mode: 'idle' } })] },
    after: { subjects: [rec('host-a', { state: { mode: 'idle', cpu: 2 } })] },
  });
  assert.deepEqual(result.unknown, [{ kind: 'unmeasured-before', subject: 'host-a', field: 'cpu' }]);
  assert.deepEqual(result.changed, []);
});

test('a field no longer observed is unknown evidence, never an absence', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { state: { cpu: 1 } })] },
    after: { subjects: [rec('host-a', { status: 'unmeasured' })] },
  });
  assert.deepEqual(result, {
    added: [], removed: [], changed: [],
    unknown: [{ kind: 'unmeasured-after', subject: 'host-a', field: 'cpu' }],
  });
});

test('a field explicitly unknown on both sides is unknown evidence on both sides', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { status: 'unmeasured', unknown: ['cpu'] })] },
    after: { subjects: [rec('host-a', { status: 'unmeasured', unknown: ['cpu'] })] },
  });
  assert.deepEqual(result.unknown, [{ kind: 'unmeasured-both', subject: 'host-a', field: 'cpu' }]);
});

test('a conflicting field on one side is reported as unknown evidence for that side', () => {
  const beforeConflict = compareMachine({
    before: { subjects: [rec('host-a', { status: 'conflicting', conflicting: ['cpu'] })] },
    after: { subjects: [rec('host-a', { state: { cpu: 2 } })] },
  });
  assert.deepEqual(beforeConflict.unknown, [{ kind: 'conflicting-before', subject: 'host-a', field: 'cpu' }]);
  const afterConflict = compareMachine({
    before: { subjects: [rec('host-a', { state: { cpu: 1 } })] },
    after: { subjects: [rec('host-a', { status: 'conflicting', conflicting: ['cpu'] })] },
  });
  assert.deepEqual(afterConflict.unknown, [{ kind: 'conflicting-after', subject: 'host-a', field: 'cpu' }]);
});

test('a conflict on both sides reports each side separately, sorted', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { status: 'conflicting', conflicting: ['cpu'] })] },
    after: { subjects: [rec('host-a', { status: 'conflicting', conflicting: ['cpu'] })] },
  });
  assert.deepEqual(result.unknown, [
    { kind: 'conflicting-after', subject: 'host-a', field: 'cpu' },
    { kind: 'conflicting-before', subject: 'host-a', field: 'cpu' },
  ]);
});

test('compare output is sorted and independent of subject order', () => {
  const before = { subjects: [rec('b', { state: { cpu: 1 } }), rec('a', { state: { cpu: 1 } })] };
  const after = { subjects: [rec('a', { state: { cpu: 2 } }), rec('b', { state: { cpu: 1 } }), rec('c', { state: { disk: 1 } })] };
  const one = compareMachine({ before, after });
  const two = compareMachine({
    before: { subjects: [...before.subjects].reverse() },
    after: { subjects: [...after.subjects].reverse() },
  });
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.deepEqual(one.changed.map((c) => c.subject), ['a']);
  assert.deepEqual(one.added.map((c) => c.subject), ['c']);
});

test('a deeply frozen compare input is not mutated', () => {
  const before = deepFreeze({ subjects: [rec('host-a', { state: { cpu: 1 } })] });
  const after = deepFreeze({ subjects: [rec('host-a', { state: { cpu: 2 } })] });
  assert.deepEqual(compareMachine({ before, after }).changed, [
    { kind: 'changed', subject: 'host-a', field: 'cpu', before: 1, after: 2 },
  ]);
});

test('objects with the same members in another key order are not changed', () => {
  const result = compareMachine({
    before: { subjects: [rec('host-a', { state: { config: { a: 1, b: 2 } } })] },
    after: { subjects: [rec('host-a', { state: { config: { b: 2, a: 1 } } })] },
  });
  assert.deepEqual(result.changed, []);
});

test('malformed compare input is refused with the field named', () => {
  const empty = { subjects: [] };
  assert.throws(() => compareMachine(null), /input must be an object/);
  assert.throws(() => compareMachine({ after: empty }), /before must be an object/);
  assert.throws(() => compareMachine({ before: {}, after: empty }), /before\.subjects must be an array/);
  assert.throws(() => compareMachine({ before: { subjects: [null] }, after: empty }), /before\.subjects\[0\] must be an object/);
  assert.throws(() => compareMachine({ before: { subjects: [{ ...rec('h'), subject: '' }] }, after: empty }), /before\.subjects\[0\]\.subject/);
  assert.throws(() => compareMachine({ before: { subjects: [rec('h', { status: 'pass' })] }, after: empty }), /before\.subjects\[0\]\.status/);
  assert.throws(() => compareMachine({ before: { subjects: [{ ...rec('h'), state: null }] }, after: empty }), /before\.subjects\[0\]\.state must be an object/);
  assert.throws(() => compareMachine({ before: { subjects: [{ ...rec('h'), unknownFields: 'cpu' }] }, after: empty }), /before\.subjects\[0\]\.unknownFields must be an array/);
  assert.throws(() => compareMachine({ before: { subjects: [{ ...rec('h'), conflictingFields: [''] }] }, after: empty }), /before\.subjects\[0\]\.conflictingFields\[0\]/);
  assert.throws(() => compareMachine({ before: { subjects: [rec('h'), rec('h')] }, after: empty }), /duplicate subject in before: h/);
  assert.throws(() => compareMachine({ before: { subjects: [rec('h', { state: { cpu: 1 }, unknown: ['cpu'] })] }, after: empty }), /also listed as unknown or conflicting/);
  assert.throws(() => compareMachine({ before: { subjects: [{ ...rec('h', { state: { cpu: 1 } }), conflictingFields: ['cpu'] }] }, after: empty }), /also listed as unknown or conflicting/);
  assert.throws(() => compareMachine({ before: { subjects: [rec('h', { state: { cpu: undefined } })] }, after: empty }), /before\.subjects\[0\]\.state\.cpu must be a JSON value/);
});
