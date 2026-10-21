// monitor/listening-ports.mjs — item 5, the host-wide listening-port inventory: every listening
// TCP socket on the box, not just commitwork's, diffed so a NEW listener is an event.
//
// port-bind.mjs asserts the DECLARED surface (are our binds what we said); this lens watches the
// WHOLE surface (what else is listening, and did that set change). Same enumeration, opposite
// question. A new listener is the classic beacon/implant shape and also the ordinary shape of
// installing anything — which is why this diffs against an --accept baseline instead of alarming
// on existence: the finding is CHANGE nobody accepted, never presence.
//
// Identity is the PORT (a place); the change basis is who holds it and how it is bound — so a
// restarted service (new pid, same command/iface) is unchanged, a port whose OWNER changed is
// 'changed', and a port that appeared is 'added'. Declared binds join for context so a row can
// say "that one is the panel". Enumeration failure is unknown for the whole lens, never an empty
// box. Baseline in .claude/store/, moved only by --accept.
//
// Env (read at call time): CW_PORTS_BASELINE, CW_BIND_LISTENERS (shared fixture with port-bind),
// CW_NOW.
//
//   node monitor/listening-ports.mjs [--json]   diff vs baseline; exit 0 ok, 1 findings, 2 grey
//   node monitor/listening-ports.mjs --accept   pin the currently observed listener set

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { collectListeners, ifaceClass, readDeclarations } from './port-bind.mjs';
import { diffPersistence } from './persistence-diff.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_PORTS_BASELINE || join(REPO, '.claude', 'store', 'listening-ports-baseline.json');

/** Aggregate raw listeners into one item per port: which iface classes, which commands. */
export function aggregateByPort(listeners) {
  const byPort = new Map();
  for (const l of listeners) {
    if (!byPort.has(l.port)) byPort.set(l.port, { ifaces: new Set(), commands: new Set() });
    const p = byPort.get(l.port);
    p.ifaces.add(ifaceClass(l.addr));
    if (l.command) p.commands.add(l.command);
  }
  return [...byPort.entries()]
    .map(([port, p]) => {
      const ifaces = [...p.ifaces].sort();
      const commands = [...p.commands].sort();
      return {
        id: `port:${port}`, kind: 'listener', port, ifaces, commands,
        sha256: createHash('sha256').update(JSON.stringify([ifaces, commands])).digest('hex'),
      };
    })
    .sort((a, b) => a.port - b.port);
}

/** ENOENT is "no baseline yet"; anything else THROWS. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);
  if (!b || !Array.isArray(b.items)) throw new Error('baseline has no items[]');
  return b;
}

const joinDeclared = (rows) => {
  let declared = new Map();
  try { declared = new Map(readDeclarations().binds.map((b) => [b.port, b.purpose])); }
  catch { /* declarations unreadable: rows simply carry no context — context, not a verdict */ }
  return rows.map((r) => (declared.has(r.port) ? { ...r, declared: declared.get(r.port) } : r));
};

export function runLens({ platform, exec } = {}) {
  const baseline = readBaseline();
  let collected;
  try { collected = collectListeners({ platform, exec }); }
  catch (e) {
    return { at: nowISO(), ...unknown('tool-failed', `enumerate: ${e.code || e.message}`), state: 'unknown' };
  }
  const observed = { items: aggregateByPort(collected.listeners), unknowns: [] };
  const diff = diffPersistence(observed, baseline);
  if (baseline) {
    const base = new Map(baseline.items.map((i) => [i.id, i]));
    for (const c of diff.changed) c.was = base.get(c.id) ?? null;
  }
  return {
    at: nowISO(), method: collected.method, baselineAt: baseline?.at ?? null, ports: observed.items.length,
    ...diff,
    added: joinDeclared(diff.added), changed: joinDeclared(diff.changed), removed: joinDeclared(diff.removed),
  };
}

export function acceptBaseline({ platform, exec } = {}) {
  const collected = collectListeners({ platform, exec });   // throws → the CLI fails loudly, pins nothing
  const doc = { at: nowISO(), items: aggregateByPort(collected.listeners) };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: doc.items.length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/listening-ports.mjs [--json]   diff every listening socket vs the accepted baseline\n'
      + 'node monitor/listening-ports.mjs --accept   pin the currently observed listener set (the human act)\n'
      + 'exit 0 ok, 1 findings (new/changed/vanished listener), 2 grey (no baseline / could not enumerate)');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = acceptBaseline();
    console.log(`pinned ${a.pinned} listening port(s) → ${a.path}`);
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`listening-ports: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`listening-ports: ${r.state}  (${r.ports} port(s), baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    const label = (i) => `:${i.port} [${i.ifaces.join(',')}] ${i.commands.join(',') || '?'}${i.declared ? `  — declared: ${i.declared}` : ''}`;
    for (const i of r.added) console.log(`  NEW      ${label(i)}`);
    for (const i of r.changed) console.log(`  CHANGED  ${label(i)}${i.was ? `  (was [${i.was.ifaces.join(',')}] ${i.was.commands.join(',')})` : ''}`);
    for (const i of r.removed) console.log(`  GONE     ${label(i)}`);
  }
  process.exit(r.unknown ? 2 : r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}
