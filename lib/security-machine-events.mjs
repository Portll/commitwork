// lib/security-machine-events.mjs — observed machine history as evidence: one event per source
// record, with unreadable sources kept distinct from a measured empty history.

import { isoInstant } from './iso-instant.mjs';

const SOURCE_STATES = ['measured', 'stale', 'unavailable', 'corrupt'];
const TIME_STATES = ['known', 'unknown'];

export const MACHINE_EVENT_CATEGORIES = Object.freeze([...SOURCE_STATES, ...TIME_STATES]);

const SOURCE_STATE_SET = new Set(SOURCE_STATES);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const identity = (source, record) => JSON.stringify([source, record]);

function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function stringList(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((entry, i) => nonEmptyString(entry, `${name}[${i}]`));
}

function observedAt(value, name) {
  if (value === undefined || value === null) return { observedAt: null, observedAtMs: null, timeState: 'unknown' };
  if (typeof value !== 'string') throw new TypeError(`${name} must be an ISO-8601 instant string or null`);
  try {
    return { observedAt: value, observedAtMs: isoInstant(value, name), timeState: 'known' };
  } catch {
    return { observedAt: value, observedAtMs: null, timeState: 'unknown' };
  }
}

function readSource(source, name) {
  if (!source || typeof source !== 'object') throw new TypeError(`${name} must be an object`);
  const id = nonEmptyString(source.id, `${name}.id`);
  if (!SOURCE_STATE_SET.has(source.state)) throw new TypeError(`${name}.state must be measured, stale, unavailable or corrupt`);
  if (!Array.isArray(source.records)) throw new TypeError(`${name}.records must be an array`);
  return { id, state: source.state, records: source.records };
}

function readRecord(record, name) {
  if (!record || typeof record !== 'object') throw new TypeError(`${name} must be an object`);
  const id = nonEmptyString(record.id, `${name}.id`);
  const subject = nonEmptyString(record.subject, `${name}.subject`);
  const type = nonEmptyString(record.type, `${name}.type`);
  if (typeof record.summary !== 'string') throw new TypeError(`${name}.summary must be a string`);
  const evidenceRefs = stringList(record.evidenceRefs, `${name}.evidenceRefs`);
  const parentIds = record.parentIds === undefined || record.parentIds === null
    ? null
    : stringList(record.parentIds, `${name}.parentIds`);
  return { id, subject, type, summary: record.summary, evidenceRefs, parentIds, ...observedAt(record.at, `${name}.at`) };
}

export function machineEvents({ sources, now } = {}) {
  if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
  isoInstant(now, 'now');

  const seenSources = new Set();
  const seenEvents = new Set();
  const events = [];
  const sourceStates = [];

  for (const [i, rawSource] of sources.entries()) {
    const source = readSource(rawSource, `sources[${i}]`);
    if (seenSources.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    seenSources.add(source.id);

    if (source.state === 'unavailable' || source.state === 'corrupt') {
      sourceStates.push({ source: source.id, state: source.state, eventCount: null });
      continue;
    }

    for (const [j, rawRecord] of source.records.entries()) {
      const record = readRecord(rawRecord, `sources[${i}].records[${j}]`);
      const id = identity(source.id, record.id);
      if (seenEvents.has(id)) throw new Error(`duplicate machine event identity: ${id}`);
      seenEvents.add(id);
      events.push({
        id,
        source: source.id,
        recordId: record.id,
        subject: record.subject,
        type: record.type,
        provenance: { source: source.id, state: source.state },
        observedAt: record.observedAt,
        observedAtMs: record.observedAtMs,
        timeState: record.timeState,
        observation: { evidenceRefs: record.evidenceRefs, parentIds: record.parentIds },
        interpretation: record.summary,
      });
    }

    sourceStates.push({ source: source.id, state: source.state, eventCount: source.records.length });
  }

  events.sort((a, b) => byCodePoint(a.id, b.id));
  sourceStates.sort((a, b) => byCodePoint(a.source, b.source));
  return { schemaVersion: 1, events, sourceStates };
}
