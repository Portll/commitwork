import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machineEvents, MACHINE_EVENT_CATEGORIES } from '../../lib/security-machine-events.mjs';

const NOW = '2026-03-01T00:00:00Z';

const record = (id, overrides = {}) => ({
  id,
  at: '2026-01-02T03:04:05Z',
  subject: 'process:123',
  type: 'process-start',
  summary: 'shell spawned',
  evidenceRefs: ['journal:17'],
  ...overrides,
});

const source = (id, state, records) => ({ id, state, records });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test('a measured record becomes one event with a source-scoped identity', () => {
  const out = machineEvents({ now: NOW, sources: [source('host-a', 'measured', [record('r1')])] });
  assert.deepEqual(out, {
    schemaVersion: 1,
    events: [{
      id: '["host-a","r1"]',
      source: 'host-a',
      recordId: 'r1',
      subject: 'process:123',
      type: 'process-start',
      provenance: { source: 'host-a', state: 'measured' },
      observedAt: '2026-01-02T03:04:05Z',
      observedAtMs: 1767323045000,
      timeState: 'known',
      observation: { evidenceRefs: ['journal:17'], parentIds: null },
      interpretation: 'shell spawned',
    }],
    sourceStates: [{ source: 'host-a', state: 'measured', eventCount: 1 }],
  });
});

test('equal record ids in different sources keep distinct identities', () => {
  const out = machineEvents({
    now: NOW,
    sources: [source('host-a', 'measured', [record('r1')]), source('host-b', 'measured', [record('r1')])],
  });
  assert.deepEqual(out.events.map((e) => e.id), ['["host-a","r1"]', '["host-b","r1"]']);
});

test('observations stay in their own field, apart from the interpretation', () => {
  const [event] = machineEvents({ now: NOW, sources: [source('host-a', 'measured', [record('r1')])] }).events;
  assert.deepEqual(event.observation, { evidenceRefs: ['journal:17'], parentIds: null });
  assert.equal(event.interpretation, 'shell spawned');
  assert.equal('summary' in event, false);
});

test('declared parent ids are preserved and absent parents are null', () => {
  const out = machineEvents({
    now: NOW,
    sources: [source('host-a', 'measured', [record('child', { parentIds: ['parent'] }), record('parent', { parentIds: [] })])],
  });
  assert.deepEqual(out.events.map((e) => [e.recordId, e.observation.parentIds]), [['child', ['parent']], ['parent', []]]);
});

test('invalid and missing dates are explicit unknowns, not fabricated times', () => {
  const out = machineEvents({
    now: NOW,
    sources: [source('host-a', 'measured', [record('missing', { at: undefined }), record('invalid', { at: '2026-02-30T00:00:00Z' })])],
  });
  const byRecord = (id) => out.events.find((e) => e.recordId === id);
  assert.equal(byRecord('missing').observedAt, null);
  assert.equal(byRecord('missing').observedAtMs, null);
  assert.equal(byRecord('missing').timeState, 'unknown');
  assert.equal(byRecord('invalid').observedAt, '2026-02-30T00:00:00Z');
  assert.equal(byRecord('invalid').observedAtMs, null);
  assert.equal(byRecord('invalid').timeState, 'unknown');
  assert.deepEqual(out.sourceStates, [{ source: 'host-a', state: 'measured', eventCount: 2 }]);
});

test('an unavailable source is not an empty measured history', () => {
  const unavailable = machineEvents({ now: NOW, sources: [source('host-a', 'unavailable', [])] });
  const measured = machineEvents({ now: NOW, sources: [source('host-a', 'measured', [])] });
  assert.deepEqual(unavailable.sourceStates, [{ source: 'host-a', state: 'unavailable', eventCount: null }]);
  assert.deepEqual(measured.sourceStates, [{ source: 'host-a', state: 'measured', eventCount: 0 }]);
  assert.notDeepEqual(unavailable, measured);
});

test('a corrupt source emits no events and reports no count', () => {
  const out = machineEvents({ now: NOW, sources: [source('host-a', 'corrupt', [record('r1')])] });
  assert.deepEqual(out.events, []);
  assert.deepEqual(out.sourceStates, [{ source: 'host-a', state: 'corrupt', eventCount: null }]);
});

test('a stale source keeps its events and labels their provenance stale', () => {
  const out = machineEvents({ now: NOW, sources: [source('host-a', 'stale', [record('r1')])] });
  assert.equal(out.events[0].provenance.state, 'stale');
  assert.deepEqual(out.sourceStates, [{ source: 'host-a', state: 'stale', eventCount: 1 }]);
});

test('the exported category list names every returned state and is frozen', () => {
  assert.deepEqual(MACHINE_EVENT_CATEGORIES, ['measured', 'stale', 'unavailable', 'corrupt', 'known', 'unknown']);
  assert.equal(Object.isFrozen(MACHINE_EVENT_CATEGORIES), true);
  assert.throws(() => MACHINE_EVENT_CATEGORIES.push('other'), TypeError);
});

test('each declared category is reached by a returned state', () => {
  const out = machineEvents({
    now: NOW,
    sources: [
      source('measured', 'measured', [record('known'), record('unknown', { at: null })]),
      source('stale', 'stale', [record('old')]),
      source('unavailable', 'unavailable', []),
      source('corrupt', 'corrupt', []),
    ],
  });
  const seen = new Set();
  for (const state of out.sourceStates) seen.add(state.state);
  for (const event of out.events) {
    seen.add(event.provenance.state);
    seen.add(event.timeState);
  }
  assert.deepEqual([...seen].sort(), [...MACHINE_EVENT_CATEGORIES].sort());
});

test('duplicate source ids and duplicate event identities are refused', () => {
  assert.throws(
    () => machineEvents({ now: NOW, sources: [source('host-a', 'measured', [record('r1')]), source('host-a', 'measured', [record('r2')])] }),
    /duplicate source id: host-a/,
  );
  assert.throws(
    () => machineEvents({ now: NOW, sources: [source('host-a', 'measured', [record('r1'), record('r1')])] }),
    /duplicate machine event identity: \["host-a","r1"\]/,
  );
});

test('output is byte-identical when sources and records arrive in another order', () => {
  const a = machineEvents({
    now: NOW,
    sources: [source('b', 'measured', [record('2'), record('1')]), source('a', 'stale', [record('3')])],
  });
  const b = machineEvents({
    now: NOW,
    sources: [source('a', 'stale', [record('3')]), source('b', 'measured', [record('1'), record('2')])],
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.events.map((e) => e.id), ['["a","3"]', '["b","1"]', '["b","2"]']);
  assert.deepEqual(a.sourceStates.map((s) => s.source), ['a', 'b']);
});

test('a deep-frozen input is read without mutation', () => {
  const input = deepFreeze({ now: NOW, sources: [source('host-a', 'measured', [record('r1')])] });
  const before = JSON.stringify(input);
  const out = machineEvents(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(out.events.length, 1);
  assert.deepEqual(out.sourceStates, [{ source: 'host-a', state: 'measured', eventCount: 1 }]);
});

test('fields outside the evidence model are not retained', () => {
  const extra = record('r1', {
    token: 'secret-token',
    prompt: 'raw prompt text',
    argv: ['--password', 'hunter2'],
    content: 'private file body',
  });
  const out = machineEvents({ now: NOW, sources: [source('host-a', 'measured', [extra])] });
  const text = JSON.stringify(out);
  for (const value of ['secret-token', 'raw prompt text', 'hunter2', 'private file body']) {
    assert.equal(text.includes(value), false);
  }
  assert.deepEqual(Object.keys(out.events[0]).sort(), [
    'id', 'interpretation', 'observation', 'observedAt', 'observedAtMs',
    'provenance', 'recordId', 'source', 'subject', 'timeState', 'type',
  ]);
});

test('malformed sources and records are refused with a named field', () => {
  assert.throws(() => machineEvents(), /sources must be an array/);
  assert.throws(() => machineEvents({ now: NOW, sources: 'nope' }), /sources must be an array/);
  assert.throws(() => machineEvents({ now: NOW, sources: [null] }), /sources\[0\] must be an object/);
  assert.throws(() => machineEvents({ now: NOW, sources: [{ state: 'measured', records: [] }] }), /sources\[0\]\.id/);
  assert.throws(() => machineEvents({ now: NOW, sources: [{ id: 'h', state: 'maybe', records: [] }] }), /sources\[0\]\.state/);
  assert.throws(() => machineEvents({ now: NOW, sources: [{ id: 'h', state: 'measured' }] }), /sources\[0\]\.records must be an array/);
  assert.throws(() => machineEvents({ now: NOW, sources: [source('h', 'measured', [null])] }), /sources\[0\]\.records\[0\] must be an object/);
  const missing = (field) => {
    const r = record('r1');
    delete r[field];
    return r;
  };
  for (const field of ['id', 'subject', 'type', 'summary', 'evidenceRefs']) {
    assert.throws(
      () => machineEvents({ now: NOW, sources: [source('h', 'measured', [missing(field)])] }),
      new RegExp(`sources\\[0\\]\\.records\\[0\\]\\.${field}`),
    );
  }
  assert.throws(
    () => machineEvents({ now: NOW, sources: [source('h', 'measured', [record('r1', { evidenceRefs: [''] })])] }),
    /sources\[0\]\.records\[0\]\.evidenceRefs\[0\] must be a non-empty string/,
  );
  assert.throws(
    () => machineEvents({ now: NOW, sources: [source('h', 'measured', [record('r1', { parentIds: 'r0' })])] }),
    /sources\[0\]\.records\[0\]\.parentIds must be an array/,
  );
  assert.throws(
    () => machineEvents({ now: NOW, sources: [source('h', 'measured', [record('r1', { at: 123 })])] }),
    /sources\[0\]\.records\[0\]\.at must be an ISO-8601 instant string or null/,
  );
});

test('a malformed now is refused', () => {
  assert.throws(() => machineEvents({ sources: [] }), /now must be an ISO-8601 instant with a zone/);
  assert.throws(() => machineEvents({ now: 'yesterday', sources: [] }), /now must be an ISO-8601 instant with a zone/);
});
