// lib/security-machine-replay.mjs — rebuild observed state from measured events at an instant and
// compare two reconstructions. Commands are never applied; concurrent contradictory observations
// leave a field conflicting, and a field nobody observed stays absent rather than false or empty.

import { isoInstant } from './iso-instant.mjs';

export const MACHINE_REPLAY_STATES = Object.freeze([
  'measured', 'unmeasured', 'conflicting',
  'added', 'removed', 'changed',
  'unmeasured-before', 'unmeasured-after', 'unmeasured-both',
  'conflicting-before', 'conflicting-after',
]);

const EVENT_TYPES = Object.freeze(['measured', 'command']);
const SUBJECT_STATES = MACHINE_REPLAY_STATES.slice(0, 3);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonValue(value, name) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => jsonValue(item, `${name}[${i}]`));
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort(byCodePoint)
      .map((key) => [key, jsonValue(value[key], `${name}.${key}`)]));
  }
  throw new TypeError(`${name} must be a JSON value`);
}

function readEvent(raw, i) {
  const at = `events[${i}]`;
  if (!plainObject(raw)) throw new TypeError(`${at} must be an object`);
  const { id, at: when, subject, type, statePatch, evidenceRefs, sequence } = raw;
  if (typeof id !== 'string' || id === '') throw new TypeError(`${at}.id must be a non-empty string`);
  const atMs = isoInstant(when, `${at}.at`);
  if (typeof subject !== 'string' || subject === '') throw new TypeError(`${at}.subject must be a non-empty string`);
  if (!EVENT_TYPES.includes(type)) throw new TypeError(`${at}.type must be measured or command`);
  if (!Number.isInteger(sequence) || sequence < 0) throw new TypeError(`${at}.sequence must be a non-negative integer`);
  if (!Array.isArray(evidenceRefs)) throw new TypeError(`${at}.evidenceRefs must be an array`);
  for (const [j, ref] of evidenceRefs.entries()) {
    if (typeof ref !== 'string' || ref === '') throw new TypeError(`${at}.evidenceRefs[${j}] must be a non-empty string`);
  }
  if (type === 'command') {
    if (statePatch !== null) throw new TypeError(`${at}.statePatch must be null on a command event`);
    return { id, atMs, subject, type, sequence, patch: null };
  }
  if (!plainObject(statePatch)) throw new TypeError(`${at}.statePatch must be an object`);
  const patch = Object.keys(statePatch).sort(byCodePoint).map((field) => {
    if (field === '') throw new TypeError(`${at}.statePatch field names must be non-empty`);
    return [field, jsonValue(statePatch[field], `${at}.statePatch.${field}`)];
  });
  return { id, atMs, subject, type, sequence, patch };
}

// Same instant and sequence: the id only orders output; two different values are concurrent facts.
function observe(fields, field, event, value) {
  const prior = fields.get(field);
  if (!prior) {
    fields.set(field, { atMs: event.atMs, sequence: event.sequence, value, conflict: false });
    return;
  }
  if (event.atMs > prior.atMs || (event.atMs === prior.atMs && event.sequence > prior.sequence)) {
    fields.set(field, { atMs: event.atMs, sequence: event.sequence, value, conflict: false });
    return;
  }
  if (JSON.stringify(prior.value) !== JSON.stringify(value)) prior.conflict = true;
}

function subjectRecord(subject) {
  const known = [];
  const unknownFields = [];
  const conflictingFields = [];
  for (const field of [...subject.fields.keys()].sort(byCodePoint)) {
    const observed = subject.fields.get(field);
    if (observed.conflict) conflictingFields.push(field);
    else if (observed.value === null) unknownFields.push(field);
    else known.push([field, observed.value]);
  }
  const state = Object.fromEntries(known);
  const status = conflictingFields.length ? 'conflicting'
    : known.length ? 'measured' : 'unmeasured';
  return { subject: subject.subject, status, eventIds: subject.eventIds, state, unknownFields, conflictingFields };
}

export function replayMachine(input = {}) {
  if (!plainObject(input)) throw new TypeError('input must be an object');
  const { events, at } = input;
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const atMs = isoInstant(at, 'at');
  const ids = new Set();
  const subjects = new Map();
  const measured = [];
  for (const [i, raw] of events.entries()) {
    const event = readEvent(raw, i);
    if (ids.has(event.id)) throw new Error(`duplicate event id: ${event.id}`);
    ids.add(event.id);
    if (event.type !== 'measured' || event.atMs > atMs) continue;
    if (!subjects.has(event.subject)) subjects.set(event.subject, { subject: event.subject, eventIds: [], fields: new Map() });
    measured.push(event);
  }
  measured.sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence || byCodePoint(a.id, b.id));
  for (const event of measured) {
    const subject = subjects.get(event.subject);
    subject.eventIds.push(event.id);
    for (const [field, value] of event.patch) observe(subject.fields, field, event, value);
  }
  return { subjects: [...subjects.values()].map(subjectRecord).sort((a, b) => byCodePoint(a.subject, b.subject)) };
}

function fieldList(raw, at, name) {
  if (!Array.isArray(raw)) throw new TypeError(`${at}.${name} must be an array`);
  const fields = new Set();
  for (const [i, field] of raw.entries()) {
    if (typeof field !== 'string' || field === '') throw new TypeError(`${at}.${name}[${i}] must be a non-empty string`);
    fields.add(field);
  }
  return fields;
}

function readSnapshot(snapshot, name) {
  if (!plainObject(snapshot)) throw new TypeError(`${name} must be an object`);
  if (!Array.isArray(snapshot.subjects)) throw new TypeError(`${name}.subjects must be an array`);
  const byId = new Map();
  for (const [i, raw] of snapshot.subjects.entries()) {
    const at = `${name}.subjects[${i}]`;
    if (!plainObject(raw)) throw new TypeError(`${at} must be an object`);
    const { subject, status, state, unknownFields, conflictingFields } = raw;
    if (typeof subject !== 'string' || subject === '') throw new TypeError(`${at}.subject must be a non-empty string`);
    if (byId.has(subject)) throw new Error(`duplicate subject in ${name}: ${subject}`);
    if (!SUBJECT_STATES.includes(status)) throw new TypeError(`${at}.status must be measured, unmeasured or conflicting`);
    if (!plainObject(state)) throw new TypeError(`${at}.state must be an object`);
    const unknown = fieldList(unknownFields, at, 'unknownFields');
    const conflicts = fieldList(conflictingFields, at, 'conflictingFields');
    const measured = new Map();
    for (const field of Object.keys(state)) {
      if (field === '') throw new TypeError(`${at}.state field names must be non-empty`);
      if (unknown.has(field) || conflicts.has(field)) throw new TypeError(`${at}.state.${field} is also listed as unknown or conflicting`);
      measured.set(field, jsonValue(state[field], `${at}.state.${field}`));
    }
    byId.set(subject, { subject, status, state: measured, unknown, conflicts });
  }
  return byId;
}

function fieldStatus(record, field) {
  if (record.conflicts.has(field)) return { status: 'conflicting' };
  if (record.state.has(field)) return { status: 'measured', value: record.state.get(field) };
  if (record.unknown.has(field)) return { status: 'unmeasured' };
  return null;
}

export function compareMachine(input = {}) {
  if (!plainObject(input)) throw new TypeError('input must be an object');
  const before = readSnapshot(input.before, 'before');
  const after = readSnapshot(input.after, 'after');
  const added = [];
  const removed = [];
  const changed = [];
  const unknown = [];
  const subjects = [...new Set([...before.keys(), ...after.keys()])].sort(byCodePoint);
  for (const subject of subjects) {
    const prior = before.get(subject);
    const current = after.get(subject);
    if (!prior) { added.push({ kind: 'added', subject, status: current.status }); continue; }
    if (!current) { removed.push({ kind: 'removed', subject, status: prior.status }); continue; }
    const fields = [...new Set([...prior.state.keys(), ...prior.unknown, ...prior.conflicts,
      ...current.state.keys(), ...current.unknown, ...current.conflicts])].sort(byCodePoint);
    for (const field of fields) {
      const b = fieldStatus(prior, field);
      const a = fieldStatus(current, field);
      if (b?.status === 'conflicting' || a?.status === 'conflicting') {
        if (b?.status === 'conflicting') unknown.push({ kind: 'conflicting-before', subject, field });
        if (a?.status === 'conflicting') unknown.push({ kind: 'conflicting-after', subject, field });
      } else if (b?.status === 'measured' && a?.status === 'measured') {
        if (JSON.stringify(b.value) !== JSON.stringify(a.value)) changed.push({ kind: 'changed', subject, field, before: b.value, after: a.value });
      } else if (b?.status === 'measured') {
        unknown.push({ kind: 'unmeasured-after', subject, field });
      } else if (a?.status === 'measured') {
        unknown.push({ kind: 'unmeasured-before', subject, field });
      } else if (b || a) {
        unknown.push({ kind: 'unmeasured-both', subject, field });
      }
    }
  }
  unknown.sort((x, y) => byCodePoint(x.subject, y.subject) || byCodePoint(x.field, y.field) || byCodePoint(x.kind, y.kind));
  return { added, removed, changed, unknown };
}
