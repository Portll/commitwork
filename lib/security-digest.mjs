// lib/security-digest.mjs — one deterministic digest of new security events, grouped by
// subject. Unmeasured evidence stays in its own state so an empty measured summary is never a pass.
import { isoInstant } from './iso-instant.mjs';

export const DIGEST_EVENT_TYPES = Object.freeze([
  'severity-crossing', 'coverage-loss', 'ratchet-breach', 'sweep-failure', 'sla-breach',
]);

export const DIGEST_STATES = Object.freeze(['measured', 'partial', 'unmeasured', 'empty']);

const TYPES = new Set(DIGEST_EVENT_TYPES);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const sameEvent = (a, b) => a.subject === b.subject && a.type === b.type && a.severity === b.severity
  && a.measured === b.measured && a.at === b.at;

function readEvent(raw, i) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError(`events[${i}] must be an object`);
  }
  const field = (k) => `events[${i}].${k}`;
  const { id, subject, type, severity, measured, at } = raw;
  if (!nonEmpty(id)) throw new TypeError(`${field('id')} must be a non-empty string`);
  if (!nonEmpty(subject)) throw new TypeError(`${field('subject')} must be a non-empty string`);
  if (!TYPES.has(type)) throw new TypeError(`${field('type')} must be one of ${DIGEST_EVENT_TYPES.join(', ')}`);
  if (typeof measured !== 'boolean') throw new TypeError(`${field('measured')} must be a boolean`);
  if (measured) {
    if (!nonEmpty(severity)) throw new TypeError(`${field('severity')} must be a non-empty string when measured`);
  } else if (severity !== null && !nonEmpty(severity)) {
    throw new TypeError(`${field('severity')} must be a non-empty string or null when unmeasured`);
  }
  isoInstant(at, field('at'));
  return { id, subject, type, severity, measured, at };
}

export function securityDigest(input) {
  const events = input?.events;
  const previousIds = input?.previousIds;
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  if (!Array.isArray(previousIds)) throw new TypeError('previousIds must be an array');

  const delivered = new Set();
  for (const [i, id] of previousIds.entries()) {
    if (!nonEmpty(id)) throw new TypeError(`previousIds[${i}] must be a non-empty string`);
    delivered.add(id);
  }

  const byId = new Map();
  for (const [i, raw] of events.entries()) {
    const event = readEvent(raw, i);
    const prior = byId.get(event.id);
    if (prior === undefined) byId.set(event.id, event);
    else if (!sameEvent(prior, event)) {
      throw new TypeError(`events[${i}].id duplicates a different event: ${event.id}`);
    }
  }

  const subjects = new Map();
  const unmeasured = [];
  for (const event of byId.values()) {
    if (delivered.has(event.id)) continue;
    if (!event.measured) {
      unmeasured.push({ id: event.id, subject: event.subject, type: event.type, at: event.at });
      continue;
    }
    let group = subjects.get(event.subject);
    if (group === undefined) {
      group = { subject: event.subject, count: 0, causes: new Map(), severities: new Map(), ids: [] };
      subjects.set(event.subject, group);
    }
    group.count += 1;
    group.causes.set(event.type, (group.causes.get(event.type) ?? 0) + 1);
    group.severities.set(event.severity, (group.severities.get(event.severity) ?? 0) + 1);
    group.ids.push(event.id);
  }

  const measured = [...subjects.values()]
    .sort((a, b) => byCodePoint(a.subject, b.subject))
    .map((g) => ({
      subject: g.subject,
      count: g.count,
      causes: [...g.causes.entries()]
        .sort((a, b) => byCodePoint(a[0], b[0]))
        .map(([type, count]) => ({ type, count })),
      severities: [...g.severities.entries()]
        .sort((a, b) => byCodePoint(a[0], b[0]))
        .map(([severity, count]) => ({ severity, count })),
      ids: g.ids.sort(byCodePoint),
    }));
  unmeasured.sort((a, b) => byCodePoint(a.id, b.id));

  const state = measured.length === 0
    ? (unmeasured.length === 0 ? 'empty' : 'unmeasured')
    : (unmeasured.length === 0 ? 'measured' : 'partial');
  return { state, subjects: measured, unmeasured };
}
