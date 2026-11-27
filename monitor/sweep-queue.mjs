#!/usr/bin/env node
// The admission queue in front of the sweep permits: who is waiting, in what order, and whether each is still there.
// fact: a permit goes to the oldest live ticket; a second ticket for a waiting scope is coalesced; an unstamped one is reaped
// usage: node monitor/sweep-queue.mjs list|reap <reportsRoot> [--prefix self] [--json | --apply]
// exit: 0 · 1 the queue or a slot was unreadable, or a reap failed or went unrecorded · 2 usage
// env: CW_NOW — the instant used for ages and the reap journal
import { mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { holderVerdict, holderDead, inspectLock, ownStartMs, writeAtomic, describeAge } from './lockfile.mjs';
import { appendRecord } from '../bin/lib/verdict-journal-core.mjs';

export const QUEUE_REAP_JOURNAL = 'sweep-queue-reaps.jsonl';
// A waiter re-stamps every poll (30 s); three missed stamps and nobody is holding the place.
export const TICKET_STALE_MS = 5 * 60 * 1000;

export const queueDirFor = (reportsRoot, prefix = 'sweep') => join(reportsRoot, `.${prefix}-queue`);
// Sorts as arrival order: zero-padded enqueue instant, then pid, then the nonce as a tiebreak.
const ticketName = (t) => `${String(t.enqueuedAt).padStart(15, '0')}-${t.pid}-${t.nonce}.json`;

function readTicket(path) {
  try {
    const t = JSON.parse(readFileSync(path, 'utf8'));
    return t && typeof t === 'object' && typeof t.nonce === 'string' ? { ticket: t } : { error: 'not a ticket' };
  } catch (e) { return { absent: e.code === 'ENOENT', error: e.code || 'unparseable' }; }
}

// Every ticket in arrival order: `waiting` live, `abandoned` dead pid or stopped stamp, `unreadable` kept in place
export function readQueue(reportsRoot, { prefix = 'sweep', nowMs = Date.now(), staleMs = TICKET_STALE_MS, kill, liveStart } = {}) {
  const dir = queueDirFor(reportsRoot, prefix);
  let names;
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); }
  catch (e) {
    if (e.code === 'ENOENT') return { ok: true, dir, waiting: [], abandoned: [], unreadable: [], rootMissing: true };
    return { ok: false, dir, waiting: [], abandoned: [], unreadable: [], rootMissing: false, error: e.code || e.message };
  }
  const waiting = [], abandoned = [], unreadable = [];
  for (const name of names) {
    const path = join(dir, name);
    const got = readTicket(path);
    if (got.absent) continue;
    if (!got.ticket) { unreadable.push({ path, name, error: got.error }); continue; }
    const t = got.ticket;
    const v = holderVerdict({ pid: t.pid, host: t.host, startedAt: t.startedAt }, { kill, liveStart });
    const stampAge = Number.isFinite(t.at) ? Math.max(0, nowMs - t.at) : null;
    const row = { ...t, path, name, waitedMs: Math.max(0, nowMs - t.enqueuedAt), stampAgeMs: stampAge, holderAlive: v.holderAlive, holderMatches: v.holderMatches };
    const dead = holderDead({ ...v, ageMs: stampAge }, staleMs);
    const stopped = stampAge === null || stampAge >= staleMs;
    if (dead) abandoned.push({ ...row, why: v.holderAlive === false ? 'pid dead' : 'pid reused' });
    else if (stopped) abandoned.push({ ...row, why: stampAge === null ? 'no stamp' : `stamp stopped ${describeAge(stampAge)}` });
    else waiting.push(row);
  }
  return { ok: true, dir, waiting, abandoned, unreadable, rootMissing: false };
}

// Removes abandoned tickets, each journaled; compare-and-delete, so one re-stamped since it was judged is left alone
export function reapQueue(reportsRoot, { prefix = 'sweep', nowMs = Date.now(), apply = false, append = appendRecord, ...probe } = {}) {
  const q = readQueue(reportsRoot, { prefix, nowMs, ...probe });
  const reaped = [], failed = [];
  if (!apply) return { ...q, applied: false, reaped, failed };
  for (const a of q.abandoned) {
    const now = readTicket(a.path);
    if (now.absent) { failed.push({ ...a, why: 'already gone' }); continue; }
    if (!now.ticket || now.ticket.nonce !== a.nonce || now.ticket.at !== a.at) { failed.push({ ...a, why: 'ticket changed since it was judged' }); continue; }
    try { rmSync(a.path, { force: true }); } catch (e) { failed.push({ ...a, why: `remove failed (${e.code || e.message})` }); continue; }
    const record = { v: 1, kind: 'sweep-queue-reaped', at: new Date(nowMs).toISOString(), pid: a.pid, label: a.label, area: a.area ?? null, group: a.group ?? null, enqueuedAt: new Date(a.enqueuedAt).toISOString(), why: a.why };
    const w = append(join(reportsRoot, QUEUE_REAP_JOURNAL), record);
    reaped.push({ ...a, recorded: !!w.ok, ...(w.ok ? {} : { recordError: w.error }) });
  }
  return { ...q, applied: true, reaped, failed };
}

// -> { ok, ticket, path, touch(), position(), leave() } | { ok:false, reason: coalesced|unreadable, duplicate?, error? }
export function enqueue(reportsRoot, { prefix = 'sweep', label = 'sweep', area = null, group = null, deadlineMs = null, nowMs = Date.now(), kill, liveStart } = {}) {
  const probe = { prefix, kill, liveStart };
  const seen = readQueue(reportsRoot, { ...probe, nowMs });
  if (!seen.ok) return { ok: false, reason: 'unreadable', error: seen.error };
  const duplicate = seen.waiting.find((w) => w.label === label);
  if (duplicate) return { ok: false, reason: 'coalesced', duplicate };

  const dir = queueDirFor(reportsRoot, prefix);
  const ticket = {
    v: 1, pid: process.pid, nonce: randomBytes(8).toString('hex'), label, area, group,
    host: hostname(), startedAt: ownStartMs(), enqueuedAt: nowMs, at: nowMs,
    deadlineAt: Number.isFinite(deadlineMs) ? nowMs + deadlineMs : null,
  };
  const path = join(dir, ticketName(ticket));
  const write = () => { mkdirSync(dir, { recursive: true }); writeAtomic(path, JSON.stringify(ticket)); };
  write();
  let left = false;
  const onExit = () => { try { leave(); } catch { /* exiting anyway */ } };
  const leave = () => {
    if (left) return;
    left = true;
    process.off('exit', onExit);
    const now = readTicket(path);
    if (now.ticket && now.ticket.nonce === ticket.nonce) { try { rmSync(path, { force: true }); } catch { /* a reaper may clear it */ } }
    try { rmdirSync(dir); } catch { /* another ticket is waiting, or it is already gone */ }
  };
  process.on('exit', onExit);
  const touch = (at = Date.now()) => { if (left) return { ok: false, reason: 'left' }; ticket.at = at; write(); return { ok: true, at }; };
  const position = (at = Date.now()) => {
    const q = readQueue(reportsRoot, { ...probe, nowMs: at });
    const index = q.waiting.findIndex((w) => w.nonce === ticket.nonce);
    return { ok: q.ok, index: index < 0 ? Infinity : index, ahead: index < 0 ? q.waiting : q.waiting.slice(0, index), total: q.waiting.length, error: q.error };
  };
  return { ok: true, ticket, path, touch, position, leave };
}

// The permits beside the queue, read the way the next acquirer will read them.
export function readSlots(reportsRoot, { prefix = 'sweep', kill, liveStart } = {}) {
  let names;
  try { names = readdirSync(reportsRoot).filter((n) => new RegExp(`^\\.${prefix}-slot-\\d+\\.lock$`).test(n)).sort(); }
  catch (e) { return { ok: false, slots: [], error: e.code || e.message }; }
  return { ok: true, slots: names.map((n) => ({ name: n, ...inspectLock(join(reportsRoot, n), { kill, liveStart }) })) };
}

export function listQueue(reportsRoot, opts = {}) {
  const slots = readSlots(reportsRoot, opts);
  const queue = readQueue(reportsRoot, opts);
  return { ok: slots.ok && queue.ok, prefix: opts.prefix || 'sweep', slots: slots.slots, slotsError: slots.error, ...queue };
}

const mins = (ms) => `${Math.round(ms / 60_000)} min`;
export function renderQueue(l) {
  const out = [];
  out.push(`${l.prefix} permits: ${l.slots.length}${l.slotsError ? ` (unreadable: ${l.slotsError})` : ''}`);
  for (const s of l.slots) {
    out.push(s.held
      ? `  ${s.name}: ${s.holder ? `pid ${s.holder.pid} (${s.holder.label})` : 'token unreadable'}, ${describeAge(s.ageMs)}, alive: ${s.holderAlive}, start matches: ${s.holderMatches}${s.stale ? ' — STALE, next acquirer takes it' : ''}`
      : `  ${s.name}: free`);
  }
  out.push(`${l.prefix} queue: ${l.waiting.length} waiting${l.rootMissing ? ' (no queue directory yet)' : ''}${l.error ? ` (unreadable: ${l.error})` : ''}`);
  l.waiting.forEach((w, i) => out.push(`  ${i + 1}. pid ${w.pid} (${w.label}) waited ${mins(w.waitedMs)}${w.deadlineAt ? `, gives up in ${mins(Math.max(0, w.deadlineAt - (w.at + w.stampAgeMs)))}` : ''}, stamp ${describeAge(w.stampAgeMs)}`));
  for (const a of l.abandoned) out.push(`  abandoned: pid ${a.pid} (${a.label}) — ${a.why}`);
  for (const u of l.unreadable) out.push(`  unreadable: ${u.name} (${u.error})`);
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, root, ...flags] = process.argv.slice(2);
  const prefixIdx = flags.indexOf('--prefix');
  const prefix = prefixIdx > -1 ? flags[prefixIdx + 1] : 'sweep';
  const rest = flags.filter((f, i) => f !== '--prefix' && !(prefixIdx > -1 && i === prefixIdx + 1));
  const allowed = cmd === 'list' ? ['--json'] : cmd === 'reap' ? ['--apply'] : null;
  if (!allowed || !root || !prefix || rest.some((f) => !allowed.includes(f))) {
    console.error('usage: node monitor/sweep-queue.mjs list <reportsRoot> [--prefix self] [--json]\n       node monitor/sweep-queue.mjs reap <reportsRoot> [--prefix self] [--apply]');
    process.exit(2);
  }
  const nowMs = Number.isFinite(Date.parse(process.env.CW_NOW)) ? Date.parse(process.env.CW_NOW) : Date.now();
  const reportsRoot = resolve(root);
  if (cmd === 'list') {
    const l = listQueue(reportsRoot, { prefix, nowMs });
    console.log(rest.includes('--json') ? JSON.stringify(l, null, 2) : renderQueue(l));
    process.exit(l.ok ? 0 : 1);
  }
  const r = reapQueue(reportsRoot, { prefix, nowMs, apply: rest.includes('--apply') });
  console.log(JSON.stringify(r, null, 2));
  const blind = !r.ok || r.failed.some((f) => f.why !== 'already gone') || r.reaped.some((x) => !x.recorded);
  process.exit(blind ? 1 : 0);
}
