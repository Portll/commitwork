#!/usr/bin/env node
// monitor/host-baseline.mjs — the host inventory as a RATCHET rather than a snapshot.
//
// WHAT IS ALREADY HERE, AND WHAT IS NOT. monitor/host-inventory.mjs answers "who owns this port
// right now", carefully, with a vocabulary that already distinguishes an unbound port that was
// OBSERVED to be unbound from one that could not be verified. monitor/host-inventory.mjs's
// `reconcile()` brackets a single batch with two observations and marks anything that changed hands
// mid-window as unknown. Both are about NOW.
//
// Nothing compares this week to last week. A snapshot answers "what is listening"; a baseline
// answers "what is listening that was not listening before", and only the second one is a
// detector. Amnesty's method leans on exactly this shift — the Pegasus process names are not
// interesting because of what they are, they are interesting because they were not there before
// and the device's own records show when they arrived.
//
// THE RULE THAT MAKES THIS SAFE, AND THE ONLY ONE THAT REALLY MATTERS:
//
//   A PORT IS NEVER REPORTED GONE ON THE STRENGTH OF AN OBSERVATION THAT FAILED.
//
// fact: a degraded `lsof` — unavailable, unprivileged, or timed out — yields `unknown` per port and `usable: false` overall, and the CLI exits non-zero / the naive diff reports every baselined listener as GONE, which renders as "the surface shrank": the most reassuring thing a security tool can say and, there, the most wrong (expiry: never, prev: broken)
// fact: absence of evidence must not become evidence of REMOVAL any more than evidence of presence — explicit uncertainty pointed at its most dangerous direction (expiry: never, prev: broken)
//
// IDENTITY EXCLUDES THE PID. A listener's identity is (port, proto) plus the COMMAND and USER
// holding it. Process ids change on every restart and every reboot; keying on one converts a
// routine restart into "the owner changed" and buries the real change. This is the same defect as
// keying a finding on a line number, in a different store.
//
// ACCEPTING A NEW BASELINE IS A HUMAN ACT. `--accept` is the only thing here that writes a
// baseline, it is never invoked automatically, and it records who accepted what and when. A
// ratchet that re-baselines itself on every run is not a ratchet.
//
// usage: node monitor/host-baseline.mjs [--json] [--accept]
//   env: CW_HOST_BASELINE  baseline path (default .claude/host-baseline.json)
//        CW_NOW            pins timestamps

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from './lockfile.mjs';
import { unknown } from './unknown.mjs';
import { OWNER } from './host-inventory.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

/** The closed change vocabulary. `unknown` is a first-class member, not a fallback. */
export const CHANGE = Object.freeze({
  UNCHANGED: 'unchanged',
  NEW: 'new',
  GONE: 'gone',
  CHANGED: 'changed',
  UNKNOWN: 'unknown',
});

const keyOf = (e) => `${e.port}/${e.proto}`;

/**
 * EPHEMERAL-ONLY PORTS ARE NOT A SURFACE, and baselining them makes the ratchet worthless.
 *
 * Measured on this box 2026-08-25: accepting a baseline and immediately re-running it produced 3
 * new and 5 gone, every one of them a high port in the 60136-60177 range — outbound connections
 * that opened and closed in the 150 ms between the two observations. host-inventory already flags
 * these (`ephemeralOnly`), because it is answering "who holds this socket" and an outbound socket
 * has a holder. This module is answering "what is reachable", and a socket nothing can connect TO
 * is not part of that answer.
 *
 * This is a scoping decision, not a filter: the count is published as `ephemeralExcluded` on every
 * result, so the narrowing is visible rather than inferred from a suspiciously quiet report.
 */
export const isListeningSurface = (e) => e.ephemeralOnly !== true;
const surfaceOf = (entries) => (entries || []).filter(isListeningSurface);

/** The comparable identity of a listener: never the pid, never the ephemeral sockets. */
export function listenerIdentity(entry) {
  const holders = (entry.owners || [])
    .filter((o) => !o.ephemeral)
    .map((o) => `${o.command ?? '?'}:${o.user ?? '?'}`);
  return {
    owner: entry.owner,
    external: !!entry.external,
    binding: entry.binding ?? null,
    holders: [...new Set(holders)].sort(),
    containers: [...(entry.containers || [])].sort(),
    declaredFor: [...(entry.declaredFor || [])].sort(),
  };
}

/**
 * A SECOND WITNESS for a listener's identity, read from a substrate the socket table cannot reach.
 *
 * listenerIdentity() keys a holder on `command:user` — a NAME. A different binary running under the
 * same name and the same user produces a byte-identical identity, so the ratchet cannot see that
 * substitution at all. That is not hypothetical for the ports worth substituting: a resolver on :53
 * is checked by almost nobody, and "something called limactl is listening" is the whole of what the
 * current identity asserts about it.
 *
 * A daemon that writes a pidfile supplies the missing witness. The kernel says which pid holds the
 * socket; the filesystem says which pid the daemon believes itself to be. An impostor has to win
 * both, and the two cannot share a failure mode — which is the only property that makes a second
 * witness worth having. Neither corrects the other; disagreement is simply a fact worth publishing.
 *
 * Deliberately FOUR states, not a boolean. A daemon that is not running writes no pidfile, and that
 * is not a mismatch — it is the absence of a claim. A pidfile that cannot be read is not a
 * confirmation either. Folding any of these into true/false is how a check whose subject has gone
 * away starts reporting that everything is fine:
 *   'confirmed'   the pidfile names a pid that holds the socket
 *   'mismatch'    the pidfile names a pid that does NOT hold it — the holder is not who it claims
 *   'absent'      no pidfile: the daemon is not running, or does not write one here
 *   'unreadable'  a pidfile exists and could not be read or parsed as a pid
 *
 * Pure: the caller supplies the holder pids and the raw pidfile contents (null when absent).
 */
export function pidfileWitness(holderPids, raw) {
  const pids = (holderPids || []).map(Number).filter(Number.isInteger);
  if (raw === null || raw === undefined) return { state: 'absent', claimed: null, holders: pids };
  const claimed = Number(String(raw).trim());
  if (!Number.isInteger(claimed) || claimed <= 0) {
    return { state: 'unreadable', claimed: null, holders: pids, reason: 'pidfile did not parse as a pid' };
  }
  if (!pids.length) {
    // A pidfile naming a pid while nothing holds the socket is not a match and not a forgery —
    // it is a stale file or a race, and saying so beats picking one of the two.
    return { state: 'mismatch', claimed, holders: pids, reason: 'a pid is claimed but no observed holder' };
  }
  return pids.includes(claimed)
    ? { state: 'confirmed', claimed, holders: pids }
    : { state: 'mismatch', claimed, holders: pids, reason: `pidfile claims ${claimed}; socket is held by ${pids.join(',')}` };
}

const sameIdentity = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Can this observation support an ABSENCE claim? Only if the socket table was actually read.
 * `host-inventory` already models this: `socketTable.ok` is what makes `unbound-observed`
 * reachable at all, and without it every "not listening" is an admission rather than a finding.
 */
export function canAssertAbsence(inventory) {
  return !!(inventory && inventory.ok === true && inventory.socketTable && inventory.socketTable.ok === true);
}

/**
 * Diff a current observation against an accepted baseline.
 *
 * Returns `{usable, changes, counts, ...}`. When `usable` is false the changes are all `unknown`
 * and the caller must not render a surface comparison at all.
 */
export function diffAgainstBaseline(baseline, current) {
  if (!current || current.ok !== true) {
    return {
      usable: false,
      ...unknown('not-run', 'the current host observation failed; nothing may be compared against it'),
      changes: [], counts: emptyCounts(),
    };
  }
  if (!baseline || !Array.isArray(baseline.entries)) {
    return {
      usable: false,
      ...unknown('no-reference', 'no accepted baseline exists — run with --accept once the current surface has been reviewed'),
      changes: [], counts: emptyCounts(),
    };
  }

  const absenceIsAssertable = canAssertAbsence(current);
  const currentSurface = surfaceOf(current.entries);
  const ephemeralExcluded = current.entries.length - currentSurface.length;
  const pre = new Map(surfaceOf(baseline.entries).map((e) => [keyOf(e), e]));
  const post = new Map(currentSurface.map((e) => [keyOf(e), e]));

  const changes = [];
  for (const k of [...new Set([...pre.keys(), ...post.keys()])].sort(sortKey)) {
    const before = pre.get(k);
    const after = post.get(k);

    if (!before && after) {
      changes.push({
        key: k, change: CHANGE.NEW, port: after.port, proto: after.proto,
        after: listenerIdentity(after), before: null,
        detail: 'listening now, and absent from the accepted baseline',
      });
      continue;
    }

    if (before && !after) {
      // THE RULE. A missing port is only GONE if this observation could see the socket table.
      if (!absenceIsAssertable) {
        changes.push({
          key: k, change: CHANGE.UNKNOWN, port: before.port, proto: before.proto,
          before: listenerIdentity(before), after: null,
          ...unknown('not-permitted', 'the socket table could not be read, so this port is unverifiable — NOT gone'),
          detail: 'baselined port not seen, by an observation that cannot assert absence',
        });
        continue;
      }
      changes.push({
        key: k, change: CHANGE.GONE, port: before.port, proto: before.proto,
        before: listenerIdentity(before), after: null,
        detail: 'baselined port is absent from a socket table that was successfully read',
      });
      continue;
    }

    const a = listenerIdentity(before);
    const b = listenerIdentity(after);
    if (sameIdentity(a, b)) {
      changes.push({ key: k, change: CHANGE.UNCHANGED, port: after.port, proto: after.proto, before: a, after: b });
      continue;
    }
    if (after.owner === OWNER.UNKNOWN || after.owner === OWNER.UNBOUND_UNVERIFIABLE) {
      changes.push({
        key: k, change: CHANGE.UNKNOWN, port: after.port, proto: after.proto, before: a, after: b,
        ...unknown('not-permitted', `ownership of this port is ${after.owner}; the difference from the baseline cannot be attributed`),
      });
      continue;
    }
    changes.push({
      key: k, change: CHANGE.CHANGED, port: after.port, proto: after.proto, before: a, after: b,
      detail: describeChange(a, b),
    });
  }

  return {
    usable: true,
    baselineAcceptedAt: baseline.acceptedAt ?? null,
    baselineAcceptedBy: baseline.acceptedBy ?? null,
    observedAt: current.window ? current.window.capturedAt : null,
    absenceAssertable: absenceIsAssertable,
    // The narrowing, stated. See isListeningSurface.
    ephemeralExcluded,
    counts: countChanges(changes),
    // Ranked, not judged: a new externally-bound port that no declaration covers is what a reader
    // should see first. It is still not a finding.
    changes: changes.sort(rank),
  };
}

function describeChange(a, b) {
  const bits = [];
  if (a.owner !== b.owner) bits.push(`owner ${a.owner} -> ${b.owner}`);
  if (a.external !== b.external) bits.push(b.external ? 'became externally bound' : 'is no longer externally bound');
  if (a.binding !== b.binding) bits.push(`binding ${a.binding} -> ${b.binding}`);
  if (JSON.stringify(a.holders) !== JSON.stringify(b.holders)) bits.push(`holder ${a.holders.join(',') || '-'} -> ${b.holders.join(',') || '-'}`);
  if (JSON.stringify(a.containers) !== JSON.stringify(b.containers)) bits.push(`containers ${a.containers.join(',') || '-'} -> ${b.containers.join(',') || '-'}`);
  return bits.join('; ') || 'identity differs';
}

/** New-and-external-and-undeclared first, then new, then changed, then gone, then the rest. */
function rank(x, y) {
  const score = (c) => {
    if (c.change === CHANGE.NEW && c.after?.external && !c.after.declaredFor.length && !c.after.containers.length) return 0;
    if (c.change === CHANGE.NEW) return 1;
    if (c.change === CHANGE.CHANGED) return 2;
    if (c.change === CHANGE.UNKNOWN) return 3;
    if (c.change === CHANGE.GONE) return 4;
    return 5;
  };
  return score(x) - score(y) || x.port - y.port || (x.proto < y.proto ? -1 : 1);
}

const sortKey = (a, b) => (Number(a.split('/')[0]) - Number(b.split('/')[0])) || (a < b ? -1 : 1);

function emptyCounts() {
  return { unchanged: 0, new: 0, gone: 0, changed: 0, unknown: 0 };
}

function countChanges(changes) {
  const c = emptyCounts();
  for (const ch of changes) c[ch.change] += 1;
  return c;
}

// ── baseline I/O ────────────────────────────────────────────────────────────────────────────────

export function baselinePath() {
  return process.env.CW_HOST_BASELINE || join(REPO, '.claude', 'host-baseline.json');
}

/** ENOENT is the only absence. A corrupt baseline must never degrade to "no baseline", because
 *  that path silently accepts the next observation as the new normal. */
export function readBaseline(path = baselinePath()) {
  if (!existsSync(path)) return unknown('absent', path);
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return unknown('unparseable', `${path}: ${e.message}`);
  }
}

/** The only writer. Records provenance, because a baseline whose acceptor is unrecorded is a
 *  claim nobody made. */
export function acceptBaseline(inventory, { path = baselinePath(), by = null } = {}) {
  if (!inventory || inventory.ok !== true) {
    throw new Error('host-baseline: refusing to accept a failed observation as a baseline');
  }
  if (!canAssertAbsence(inventory)) {
    throw new Error('host-baseline: refusing to accept an observation that cannot assert absence — '
      + 'a baseline built without a readable socket table records a surface it could not see, and every '
      + 'later diff inherits that blindness as "unchanged"');
  }
  const record = {
    acceptedAt: process.env.CW_NOW || new Date().toISOString(),
    acceptedBy: by,
    observedBy: inventory.observedBy ?? null,
    window: inventory.window ?? null,
    ephemeralExcluded: inventory.entries.length - surfaceOf(inventory.entries).length,
    entries: surfaceOf(inventory.entries).map((e) => ({
      port: e.port, proto: e.proto, owner: e.owner, binding: e.binding ?? null,
      external: !!e.external, ephemeralOnly: !!e.ephemeralOnly,
      containers: e.containers || [], declaredFor: e.declaredFor || [],
      // The pid is deliberately NOT carried. See the header.
      owners: (e.owners || []).map((o) => ({ command: o.command ?? null, user: o.user ?? null, ephemeral: !!o.ephemeral })),
    })),
  };
  writeAtomic(path, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const { inventory } = await import('./host-inventory.mjs');
  const current = inventory();

  if (argv.includes('--accept')) {
    const rec = acceptBaseline(current, { by: process.env.USER || null });
    console.log(`host-baseline: accepted ${rec.entries.length} listener(s) as the baseline at ${rec.acceptedAt} (by ${rec.acceptedBy ?? 'unrecorded'})`);
    console.log(`host-baseline: ${baselinePath()}`);
    return;
  }

  const base = readBaseline();
  const diff = diffAgainstBaseline(base.ok ? base.value : null, current);

  if (argv.includes('--json')) { console.log(JSON.stringify({ baselineRead: base.ok ? 'ok' : base.unknownReason, ...diff }, null, 2)); return; }

  if (!diff.usable) {
    console.log(`host-baseline: NO COMPARISON MADE — ${diff.unknownReason}: ${diff.unknownDetail}`);
    if (!base.ok && base.unknownReason === 'unparseable') {
      console.log('host-baseline: the baseline is CORRUPT. It is not being treated as absent, because that would '
        + 'silently promote the current surface to the new normal.');
    }
    process.exitCode = 2;
    return;
  }

  const c = diff.counts;
  console.log(`host-baseline: baseline accepted ${diff.baselineAcceptedAt} by ${diff.baselineAcceptedBy ?? 'unrecorded'}; observed ${diff.observedAt}`);
  console.log(`host-baseline: ${c.new} new, ${c.changed} changed, ${c.gone} gone, ${c.unknown} unknown, ${c.unchanged} unchanged`
    + `${diff.ephemeralExcluded ? ` (${diff.ephemeralExcluded} ephemeral-only socket(s) are outbound, not surface, and are out of scope)` : ''}`);
  if (!diff.absenceAssertable) {
    console.log('host-baseline: the socket table could NOT be read, so nothing is reported gone — absent ports are unknown.');
  }
  for (const ch of diff.changes) {
    if (ch.change === CHANGE.UNCHANGED) continue;
    const tag = ch.change.toUpperCase().padEnd(10);
    const ext = ch.after?.external ? ' EXTERNAL' : '';
    console.log(`  ${tag} ${ch.key}${ext}  ${ch.detail ?? ch.unknownDetail ?? ''}`);
  }
  if (c.new + c.changed + c.gone + c.unknown > 0) process.exitCode = 1;
}

if (isMain) {
  main().catch((e) => { console.error(`host-baseline: ${(e && e.stack) || e}`); process.exitCode = 2; });
}
