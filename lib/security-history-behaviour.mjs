// lib/security-history-behaviour.mjs — bot registration, workflow-edit bursts, suppression expiry and
// observation freshness compared between two scans. Thresholds and cadence are declared by the caller;
// absence, unmeasured subjects, a changed source or window are unknown, never inactivity or compromise.

import { isoInstant } from './iso-instant.mjs';

const HOUR_MS = 3_600_000;
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function readSubject(s, at) {
  if (!s || typeof s !== 'object') throw new TypeError(`${at} must be an object`);
  if (typeof s.id !== 'string' || s.id === '') throw new TypeError(`${at}.id must be a non-empty string`);
  if (typeof s.measured !== 'boolean') throw new TypeError(`${at}.measured must be a boolean`);
  if (!s.measured) return { id: s.id, measured: false };
  if (s.botRegistration !== null && (typeof s.botRegistration !== 'string' || s.botRegistration === '')) {
    throw new TypeError(`${at}.botRegistration must be a non-empty string or null`);
  }
  if (s.workflowEditCount !== null && (!Number.isInteger(s.workflowEditCount) || s.workflowEditCount < 0)) {
    throw new TypeError(`${at}.workflowEditCount must be a non-negative integer or null`);
  }
  return {
    id: s.id,
    measured: true,
    botRegistration: s.botRegistration,
    workflowEditCount: s.workflowEditCount,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    windowStartMs: isoInstant(s.windowStart, `${at}.windowStart`),
    windowEndMs: isoInstant(s.windowEnd, `${at}.windowEnd`),
    observedAt: s.observedAt,
    observedAtMs: isoInstant(s.observedAt, `${at}.observedAt`),
    suppressionExpiresAt: s.suppressionExpiresAt,
    suppressionExpiresAtMs: s.suppressionExpiresAt === null ? null : isoInstant(s.suppressionExpiresAt, `${at}.suppressionExpiresAt`),
  };
}

function readSnapshot(snap, name) {
  if (!snap || typeof snap !== 'object') throw new TypeError(`${name} must be an object`);
  if (typeof snap.source !== 'string' || snap.source === '') throw new TypeError(`${name}.source must be a non-empty string`);
  const observedAtMs = isoInstant(snap.observedAt, `${name}.observedAt`);
  if (!Array.isArray(snap.subjects)) throw new TypeError(`${name}.subjects must be an array`);
  const byId = new Map();
  for (const [i, s] of snap.subjects.entries()) {
    const subject = readSubject(s, `${name}.subjects[${i}]`);
    if (byId.has(subject.id)) throw new Error(`duplicate subject id in ${name}: ${subject.id}`);
    byId.set(subject.id, subject);
  }
  return { source: snap.source, observedAtMs, byId };
}

function burst(id, b, a, threshold) {
  if (b.workflowEditCount === null || a.workflowEditCount === null) return { unknown: { id, scope: 'workflow-edit-burst', reason: 'edit-count-missing' } };
  if (!(a.workflowEditCount > threshold && b.workflowEditCount <= threshold)) return {};
  const windowMs = a.windowEndMs - a.windowStartMs;
  return {
    change: {
      id,
      kind: 'workflow-edit-burst',
      prior: { workflowEditCount: b.workflowEditCount },
      current: { workflowEditCount: a.workflowEditCount },
      count: a.workflowEditCount,
      threshold,
      windowStart: a.windowStart,
      windowEnd: a.windowEnd,
      windowMs,
      editsPerHour: a.workflowEditCount / (windowMs / HOUR_MS),
    },
  };
}

function compareSubject(id, b, a, ctx) {
  const changes = [];
  const unknowns = [];
  if (b.windowStartMs !== a.windowStartMs || b.windowEndMs !== a.windowEndMs) {
    return { changes, unknowns: [{ id, scope: 'subject', reason: 'window-changed' }] };
  }
  if (b.botRegistration !== a.botRegistration) {
    changes.push({ id, kind: 'bot-registration', prior: { botRegistration: b.botRegistration }, current: { botRegistration: a.botRegistration } });
  }
  if (a.windowEndMs <= a.windowStartMs) {
    unknowns.push({ id, scope: 'workflow-edit-burst', reason: 'empty-window' });
  } else {
    const r = burst(id, b, a, ctx.threshold);
    if (r.change) changes.push(r.change);
    if (r.unknown) unknowns.push(r.unknown);
  }
  const expiredNow = a.suppressionExpiresAtMs !== null && a.suppressionExpiresAtMs <= ctx.nowMs;
  const liveBefore = b.suppressionExpiresAtMs === null || b.suppressionExpiresAtMs > b.observedAtMs;
  if (expiredNow && liveBefore) {
    changes.push({
      id,
      kind: 'suppression-expired',
      prior: { suppressionExpiresAt: b.suppressionExpiresAt, observedAt: b.observedAt },
      current: { suppressionExpiresAt: a.suppressionExpiresAt },
      now: ctx.now,
    });
  }
  const ageMs = ctx.nowMs - a.observedAtMs;
  const freshBefore = ctx.beforeObservedAtMs - b.observedAtMs <= ctx.cadenceMs;
  if (ageMs > ctx.cadenceMs && freshBefore) {
    changes.push({
      id,
      kind: 'observation-stale',
      prior: { observedAt: b.observedAt },
      current: { observedAt: a.observedAt },
      lastObservedAt: a.observedAt,
      ageMs,
      cadenceMs: ctx.cadenceMs,
    });
  }
  return { changes, unknowns };
}

export function compareHistoryBehaviour({ before, after, now, thresholds } = {}) {
  const prior = readSnapshot(before, 'before');
  const current = readSnapshot(after, 'after');
  const nowMs = isoInstant(now, 'now');
  if (!thresholds || typeof thresholds !== 'object') throw new TypeError('thresholds must be an object');
  const ctx = {
    now,
    nowMs,
    threshold: positiveInteger(thresholds.workflowEditsPerWindow, 'thresholds.workflowEditsPerWindow'),
    cadenceMs: positiveInteger(thresholds.cadenceMs, 'thresholds.cadenceMs'),
    beforeObservedAtMs: prior.observedAtMs,
  };

  const changes = [];
  const unknowns = [];
  const ids = [...new Set([...prior.byId.keys(), ...current.byId.keys()])];
  for (const id of ids) {
    const b = prior.byId.get(id);
    const a = current.byId.get(id);
    if (prior.source !== current.source) { unknowns.push({ id, scope: 'subject', reason: 'source-changed' }); continue; }
    if (!b) { unknowns.push({ id, scope: 'subject', reason: 'absent-before' }); continue; }
    if (!a) { unknowns.push({ id, scope: 'subject', reason: 'absent-after' }); continue; }
    if (!b.measured) { unknowns.push({ id, scope: 'subject', reason: 'unmeasured-before' }); continue; }
    if (!a.measured) { unknowns.push({ id, scope: 'subject', reason: 'unmeasured-after' }); continue; }
    const r = compareSubject(id, b, a, ctx);
    changes.push(...r.changes);
    unknowns.push(...r.unknowns);
  }
  changes.sort((x, y) => byCodePoint(x.id, y.id) || byCodePoint(x.kind, y.kind));
  unknowns.sort((x, y) => byCodePoint(x.id, y.id) || byCodePoint(x.scope, y.scope) || byCodePoint(x.reason, y.reason));
  return { changes, unknowns };
}
