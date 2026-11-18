// lib/security-async-check-jobs.mjs — bounded asynchronous MCP scan jobs as a pure state
// machine. The caller supplies every instant, reason and piece of evidence; nothing here runs a scan.

import { isoInstant } from './iso-instant.mjs';

export const JOB_STATES = Object.freeze(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

const STATE = new Set(JOB_STATES);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const ACTIVE = new Set(['queued', 'running']);
const EVENTS = new Set(['start', 'succeed', 'fail', 'timeout', 'cancel']);

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v !== '';
const stateList = JOB_STATES.join(', ');

function readState(state) {
  if (!isRecord(state)) throw new TypeError('state must be an object');
  if (!nonEmpty(state.id)) throw new TypeError('state.id must be a non-empty string');
  if (!STATE.has(state.state)) throw new TypeError(`state.state must be one of: ${stateList}`);
  if (state.reason !== undefined && state.reason !== null && !nonEmpty(state.reason)) {
    throw new TypeError('state.reason must be a non-empty string or null');
  }
  if (state.evidence !== undefined && state.evidence !== null && !isRecord(state.evidence)) {
    throw new TypeError('state.evidence must be an object or null');
  }
  if (state.updatedAt !== undefined && state.updatedAt !== null) isoInstant(state.updatedAt, 'state.updatedAt');
  return { id: state.id, state: state.state };
}

function readEvent(event) {
  if (!isRecord(event)) throw new TypeError('event must be an object');
  if (!EVENTS.has(event.type)) throw new TypeError(`event.type must be one of: ${[...EVENTS].join(', ')}`);
  isoInstant(event.at, 'event.at');
  if ((event.type === 'fail' || event.type === 'timeout') && !nonEmpty(event.reason)) {
    throw new TypeError('event.reason must be a non-empty string');
  }
  if (event.type === 'cancel' && event.reason !== undefined && event.reason !== null && !nonEmpty(event.reason)) {
    throw new TypeError('event.reason must be a non-empty string or null');
  }
  if (event.type === 'succeed' && !(isRecord(event.evidence) && event.evidence.ok === true)) {
    throw new TypeError('event.evidence.ok must be true');
  }
  return { type: event.type, at: event.at, reason: event.reason ?? null };
}

function nextState(from, type) {
  if (type === 'start') return from === 'queued' ? 'running' : null;
  if (type === 'succeed') return from === 'running' ? 'succeeded' : null;
  if (type === 'fail' || type === 'timeout') return from === 'running' ? 'failed' : null;
  if (type === 'cancel') return from === 'queued' || from === 'running' ? 'cancelled' : null;
  return null;
}

export function transitionJob(state, event) {
  const current = readState(state);
  const next = readEvent(event);
  if (TERMINAL.has(current.state)) throw new Error(`cannot transition from terminal state: ${current.state}`);
  const to = nextState(current.state, next.type);
  if (to === null) throw new Error(`cannot ${next.type} a job that is ${current.state}`);
  return {
    id: current.id,
    state: to,
    reason: to === 'failed' || to === 'cancelled' ? next.reason : null,
    evidence: to === 'succeeded' ? { ok: true } : null,
    updatedAt: next.at,
  };
}

function countActive(jobs) {
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array');
  const seen = new Set();
  let active = 0;
  for (const [i, job] of jobs.entries()) {
    if (!isRecord(job)) throw new TypeError(`jobs[${i}] must be an object`);
    if (!nonEmpty(job.id)) throw new TypeError(`jobs[${i}].id must be a non-empty string`);
    if (!STATE.has(job.state)) throw new TypeError(`jobs[${i}].state must be one of: ${stateList}`);
    if (seen.has(job.id)) throw new Error(`duplicate job id: ${job.id}`);
    seen.add(job.id);
    if (ACTIVE.has(job.state)) active++;
  }
  return { seen, active };
}

export function admitJob(input = {}) {
  if (!isRecord(input)) throw new TypeError('input must be an object');
  const { jobs, limit, id } = input;
  if (!Number.isInteger(limit) || limit < 0) throw new TypeError('limit must be a non-negative integer');
  if (!nonEmpty(id)) throw new TypeError('id must be a non-empty string');
  const { seen, active } = countActive(jobs);
  if (seen.has(id)) throw new Error(`duplicate job id: ${id}`);
  if (active >= limit) throw new Error(`active job capacity exceeded: ${active} active, limit ${limit}`);
  return { id, state: 'queued', reason: null, evidence: null, updatedAt: null };
}
