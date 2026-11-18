// lib/security-machine-future.mjs — the declared future of the machine: requested plans with their
// blockers and deadlines, scheduled executions and hypothetical scenarios. Every date is supplied,
// and nothing planned is presented as an observed fact.

import { isoInstant } from './iso-instant.mjs';

export const MACHINE_FUTURE_STATES = Object.freeze([
  'ready', 'blocked', 'in-progress', 'done', 'failed', 'abandoned', 'unreviewed',
  'scheduled', 'due', 'disabled', 'hypothetical',
]);

const TASK_STATUSES = Object.freeze(['requested', 'in-progress', 'done', 'failed', 'abandoned', 'unreviewed']);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function stringField(obj, key, at) {
  const value = obj[key];
  if (typeof value !== 'string' || value === '') throw new TypeError(`${at}.${key} must be a non-empty string`);
  return value;
}

function stringList(value, at, field) {
  if (!Array.isArray(value)) throw new TypeError(`${at}.${field} must be an array`);
  return value.map((item, i) => {
    if (typeof item !== 'string' || item === '') throw new TypeError(`${at}.${field}[${i}] must be a non-empty string`);
    return item;
  });
}

function readTask(raw, i) {
  const at = `tasks[${i}]`;
  if (!isRecord(raw)) throw new TypeError(`${at} must be an object`);
  const id = stringField(raw, 'id', at);
  const title = stringField(raw, 'title', at);
  const owner = stringField(raw, 'owner', at);
  if (!TASK_STATUSES.includes(raw.status)) {
    throw new TypeError(`${at}.status must be one of ${TASK_STATUSES.join(', ')}`);
  }
  const dependsOn = stringList(raw.dependsOn, at, 'dependsOn');
  const seen = new Set();
  for (const [j, dep] of dependsOn.entries()) {
    if (seen.has(dep)) throw new TypeError(`${at}.dependsOn[${j}] duplicates dependency: ${dep}`);
    seen.add(dep);
  }
  let dueAt = null;
  if (raw.dueAt !== undefined && raw.dueAt !== null) {
    isoInstant(raw.dueAt, `${at}.dueAt`);
    dueAt = raw.dueAt;
  }
  return { id, title, owner, status: raw.status, dependsOn, dueAt, at };
}

function assertAcyclic(byId) {
  const mark = new Map();
  const visit = (id, path) => {
    const state = mark.get(id);
    if (state === 'done') return;
    if (state === 'open') {
      const start = path.indexOf(id);
      throw new TypeError(`${byId.get(id).at}.dependsOn forms a dependency cycle: ${[...path.slice(start), id].join(' -> ')}`);
    }
    mark.set(id, 'open');
    path.push(id);
    for (const dep of [...byId.get(id).dependsOn].sort(byCodePoint)) visit(dep, path);
    path.pop();
    mark.set(id, 'done');
  };
  for (const id of [...byId.keys()].sort(byCodePoint)) visit(id, []);
}

function toPlan(task, byId) {
  const blockers = task.dependsOn
    .map((id) => byId.get(id))
    .filter((dep) => dep.status !== 'done')
    .map((dep) => ({ id: dep.id, status: dep.status }))
    .sort((a, b) => byCodePoint(a.id, b.id));
  const state = task.status === 'requested' ? (blockers.length === 0 ? 'ready' : 'blocked') : task.status;
  return {
    id: task.id,
    title: task.title,
    owner: task.owner,
    state,
    dependsOn: [...task.dependsOn].sort(byCodePoint),
    blockers,
    deadline: task.dueAt,
    // No ETA is supplied, so completion is not predicted; a deadline is not a completion date.
    eta: null,
  };
}

function readSchedule(raw, i, seen) {
  const at = `schedules[${i}]`;
  if (!isRecord(raw)) throw new TypeError(`${at} must be an object`);
  const id = stringField(raw, 'id', at);
  if (seen.has(id)) throw new TypeError(`${at}.id duplicates schedule: ${id}`);
  seen.add(id);
  const nextAtMs = isoInstant(raw.nextAt, `${at}.nextAt`);
  if (!Number.isInteger(raw.cadenceMs) || raw.cadenceMs <= 0) {
    throw new TypeError(`${at}.cadenceMs must be a positive integer`);
  }
  if (typeof raw.enabled !== 'boolean') throw new TypeError(`${at}.enabled must be a boolean`);
  return { id, nextAt: raw.nextAt, nextAtMs, cadenceMs: raw.cadenceMs, enabled: raw.enabled };
}

function readScenario(raw, i, seen) {
  const at = `scenarios[${i}]`;
  if (!isRecord(raw)) throw new TypeError(`${at} must be an object`);
  const id = stringField(raw, 'id', at);
  if (seen.has(id)) throw new TypeError(`${at}.id duplicates scenario: ${id}`);
  seen.add(id);
  return {
    id,
    label: stringField(raw, 'label', at),
    assumptions: stringList(raw.assumptions, at, 'assumptions'),
    outcomes: stringList(raw.outcomes, at, 'outcomes'),
  };
}

export function machineFuture(input = {}) {
  if (!isRecord(input)) throw new TypeError('input must be an object');
  const { tasks, schedules, scenarios, now } = input;
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  if (!Array.isArray(schedules)) throw new TypeError('schedules must be an array');
  if (!Array.isArray(scenarios)) throw new TypeError('scenarios must be an array');
  const nowMs = isoInstant(now, 'now');

  const taskById = new Map();
  const taskList = tasks.map((raw, i) => {
    const task = readTask(raw, i);
    if (taskById.has(task.id)) throw new TypeError(`${task.at}.id duplicates task: ${task.id}`);
    taskById.set(task.id, task);
    return task;
  });
  for (const task of taskList) {
    for (const [j, dep] of task.dependsOn.entries()) {
      if (!taskById.has(dep)) throw new TypeError(`${task.at}.dependsOn[${j}] references unknown task: ${dep}`);
    }
  }
  assertAcyclic(taskById);

  const plans = [...taskById.keys()].sort(byCodePoint).map((id) => toPlan(taskById.get(id), taskById));

  const scheduleIds = new Set();
  const scheduleOut = schedules
    .map((raw, i) => readSchedule(raw, i, scheduleIds))
    .map((s) => ({
      id: s.id,
      nextAt: s.nextAt,
      cadenceMs: s.cadenceMs,
      enabled: s.enabled,
      state: !s.enabled ? 'disabled' : s.nextAtMs <= nowMs ? 'due' : 'scheduled',
    }))
    .sort((a, b) => byCodePoint(a.id, b.id));

  const scenarioIds = new Set();
  const scenarioOut = scenarios
    .map((raw, i) => readScenario(raw, i, scenarioIds))
    .map((s) => ({ ...s, state: 'hypothetical' }))
    .sort((a, b) => byCodePoint(a.id, b.id));

  const unknowns = taskList
    .filter((t) => t.dueAt === null)
    .map((t) => ({ scope: 'plan', id: t.id, field: 'dueAt', reason: 'missing' }))
    .sort((a, b) => byCodePoint(a.id, b.id));

  return { schemaVersion: 1, plans, schedules: scheduleOut, scenarios: scenarioOut, unknowns };
}
