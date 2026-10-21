// monitor/egress-baseline.mjs — the egress host lens: which EXECUTABLES on this box talk out, and
// is that set the one the operator accepted? persistence-diff watches what starts; listening-ports
// watches what accepts; this watches what dials. A beacon has to reach its operator, and the one
// thing it cannot hide from an unprivileged observer on the same box is that it holds a socket.
//
// IDENTITY IS THE EXECUTABLE PATH, joined from `ps` by pid. Never the pid (it is a fresh number
// every restart), and never the remote address (a CDN's addresses churn hourly, so an
// address-keyed baseline would be all noise and no signal, and it would put third-party addresses
// in a store an audit may quote). The change basis is the set of remote PORT CLASSES the
// executable used: a service port is a property of what it talks to, while an ephemeral peer port
// is a property of nothing, so everything at or above the ephemeral floor collapses into one class
// rather than minting a finding per connection.
//
// COVERAGE IS PARTIAL AND SAYS SO. Unprivileged lsof sees this user's processes only, so a root
// daemon's egress is outside this lens' reach — `coverage: 'user-processes-only'` rides on every
// payload and on the baseline. Never run this under sudo: a lens is read-only and unprivileged, and
// the honest half-answer beats a privileged one nobody can reproduce.
//
// The diff, in priority order:
//   added     an executable that talks out and did not before — THE signal
//   newPorts  a known executable using a remote port class it never used — a lower-priority lead
//   gone      an executable that stopped — informational, recorded, never a finding
//
// lsof or ps failing, or producing nothing this parser understands, is unknown for the WHOLE lens.
// "No connections" is a claim this module will not make from a failed observation.
//
// Env (read at call time): CW_EGRESS_BASELINE, CW_EGRESS_LSOF, CW_EGRESS_PS (fixture text files),
// CW_EPHEMERAL_MIN, CW_NOW.
//
//   node monitor/egress-baseline.mjs [--json]   diff observed egress vs baseline; 0 ok, 1 findings,
//                                               2 grey (no baseline / unknown)
//   node monitor/egress-baseline.mjs --accept   pin the currently observed egress (the human act)

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { parseAddress, classifyBinding, BINDING, EPHEMERAL_MIN } from './listeners.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_EGRESS_BASELINE || join(REPO, '.claude', 'store', 'egress-baseline.json');

export const COVERAGE = 'user-processes-only';

// One call for both protocols: lsof ORs -i selectors, and -sTCP:ESTABLISHED constrains only TCP.
// UDP has no state, so its connected sockets are the ones lsof prints with a `->` peer.
export const LSOF_ARGS = Object.freeze(['-nP', '-iTCP', '-sTCP:ESTABLISHED', '-iUDP']);
export const PS_ARGS = Object.freeze(['-axo', 'pid=,comm=']);

/**
 * The class a remote port is counted under. A service port is the fact ("this process now talks to
 * something on 4444"); an ephemeral peer port is an allocation, identical in meaning to the next
 * one, so it collapses into a single class instead of a finding per connection.
 */
export const portClass = (port) => (port === null || !Number.isFinite(port) ? 'unnumbered' : port >= EPHEMERAL_MIN() ? 'ephemeral' : String(port));

const isLoopback = (addr) => classifyBinding(addr) === BINDING.LOOPBACK;

/**
 * lsof output → connection rows. -> { rows, skipped: [{line, why, kind}] }.
 * kind 'excluded' = understood and deliberately not a row (loopback pairs, listeners); 'unparsed' =
 * the parser failed on it. The two are never reported as one — a parser that cannot read this
 * box's lsof must not look like a quiet box.
 */
export function parseEgressLsof(stdout) {
  const rows = [];
  const skipped = [];
  const drop = (line, why, kind) => skipped.push({ line, why, kind });
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^COMMAND\s+PID\b/.test(line)) continue;
    if (/^lsof[: ]/i.test(line) || /^\s*WARNING\b/i.test(line)) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 9) { drop(line, `expected >=9 whitespace fields, got ${f.length}`, 'unparsed'); continue; }
    const [, pid, , , , , , node] = f;
    if (!/^\d+$/.test(pid)) { drop(line, `PID field '${pid}' is not numeric`, 'unparsed'); continue; }
    const name = f.slice(8).join(' ');
    const proto = String(node || '').toUpperCase();
    const state = (/\(([A-Z_]+)\)\s*$/.exec(name) || [])[1] || null;
    const bare = name.replace(/\s*\([A-Z_]+\)\s*$/, '');
    if (!bare.includes('->')) { drop(line, 'not a connected socket', 'excluded'); continue; }
    if (proto === 'TCP' && state && state !== 'ESTABLISHED') { drop(line, `TCP socket in ${state}, not ESTABLISHED`, 'excluded'); continue; }
    const [localText, remoteText] = bare.split('->');
    const local = parseAddress(localText);
    const remote = parseAddress(remoteText);
    if (!local || !remote) { drop(line, `NAME '${name}' is not local->remote`, 'unparsed'); continue; }
    // A loopback pair never leaves the box. Excluded on BOTH ends: a loopback source with an
    // off-box destination is impossible, and a loopback destination from an off-box source is not
    // this box dialling out.
    if (isLoopback(local.address) && isLoopback(remote.address)) { drop(line, 'loopback pair — never leaves the box', 'excluded'); continue; }
    rows.push({ pid: Number(pid), proto, local, remote });
  }
  return { rows, skipped };
}

/** `ps -axo pid=,comm=` → Map(pid → executable path). comm is the path on macOS, spaces intact. */
export function parsePsComm(text) {
  const byPid = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) byPid.set(Number(m[1]), m[2]);
  }
  return byPid;
}

/**
 * Connection rows + the ps table → one entry per executable.
 *
 * A pid that is not in the ps table raced away between the two reads: unknown('truncated'),
 * counted, never folded into a neighbour and never dropped — an unidentifiable connection is the
 * one a reader most needs to see.
 */
export function aggregateEgress(rows, psByPid) {
  const peers = new Map();
  const unknowns = [];
  for (const r of rows) {
    const exe = psByPid.get(r.pid);
    if (!exe) { unknowns.push({ id: `pid:${r.pid}`, kind: 'egress-peer', ...unknown('truncated', 'process not in the ps table — it exited between the two reads') }); continue; }
    if (!peers.has(exe)) peers.set(exe, { connections: 0, ports: new Map(), remotes: new Set(), protos: new Set() });
    const p = peers.get(exe);
    p.connections += 1;
    const cls = portClass(r.remote.port);
    p.ports.set(cls, (p.ports.get(cls) || 0) + 1);
    // The address is counted and discarded in the same breath: the COUNT is the fact worth keeping
    // ("one endpoint or two hundred"), and the addresses belong to third parties.
    p.remotes.add(r.remote.address);
    p.protos.add(r.proto);
  }
  const items = [...peers.entries()].map(([id, p]) => ({
    id,
    kind: 'egress-peer',
    ports: [...p.ports.keys()].sort(),
    portHistogram: Object.fromEntries([...p.ports.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    connections: p.connections,
    remotes: p.remotes.size,
    protos: [...p.protos].sort(),
  })).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { items, unknowns };
}

/** Fixture text or the real tool. The fixture path is read at CALL time, per the CW_* invariant. */
function source(envVar, cmd, args, { exec = execFileSync, timeout = 10_000 } = {}) {
  const fixture = process.env[envVar];
  if (fixture) {
    try { return { ok: true, text: readFileSync(fixture, 'utf8'), from: `${envVar}=${fixture}` }; }
    catch (e) { return { ok: false, why: `${envVar} is set and unreadable (${e.code}) — a fixture that is not there is not an empty box` }; }
  }
  try {
    const text = exec(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, text, from: `${cmd} ${args.join(' ')}` };
  } catch (e) {
    // lsof exits 1 when it merely has nothing to report, so stdout decides, not the exit code.
    if (e && typeof e.stdout === 'string' && e.stdout.trim()) return { ok: true, text: e.stdout, from: `${cmd} ${args.join(' ')}` };
    return { ok: false, why: `${cmd}: ${e && (e.code || e.message) ? (e.code || e.message.split('\n')[0]) : 'failed'}` };
  }
}

/**
 * Observe egress. -> { ok: true, coverage, items, unknowns, skipped, connections } |
 *                    { ok: false, ...unknown(...) }
 * Zero UNDERSTOOD rows out of non-empty output is unparseable, not quiet: the one reading this
 * module refuses to publish is "nothing is talking out" inferred from an observation that failed.
 */
export function observeEgress({ exec = execFileSync } = {}) {
  const lsof = source('CW_EGRESS_LSOF', 'lsof', LSOF_ARGS, { exec });
  if (!lsof.ok) return { ok: false, ...unknown('tool-failed', lsof.why) };
  const ps = source('CW_EGRESS_PS', 'ps', PS_ARGS, { exec });
  if (!ps.ok) return { ok: false, ...unknown('tool-failed', ps.why) };
  const psByPid = parsePsComm(ps.text);
  if (!psByPid.size) return { ok: false, ...unknown('unparseable', 'the ps table parsed to zero rows — every connection would be unattributable') };
  if (!String(lsof.text).trim()) return { ok: false, ...unknown('tool-failed', 'lsof produced no output at all — this is not "no connections"') };
  const { rows, skipped } = parseEgressLsof(lsof.text);
  const understood = rows.length + skipped.filter((s) => s.kind === 'excluded').length;
  if (!understood) {
    return { ok: false, ...unknown('unparseable', `lsof produced ${String(lsof.text).split('\n').filter((l) => l.trim()).length} line(s) and none parsed as a socket`) };
  }
  const { items, unknowns } = aggregateEgress(rows, psByPid);
  return { ok: true, coverage: COVERAGE, items, unknowns, skipped, connections: rows.length };
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

/**
 * Pure diff, keyed on the executable path. The per-run detail (connection counts, histograms,
 * distinct-remote counts) is NOT a change basis: it moves every second on an idle box, and a
 * baseline that churned would be re-accepted until nobody read it.
 */
export function diffEgress(observed, baseline) {
  const now = new Map(observed.items.map((i) => [i.id, i]));
  const base = baseline ? new Map(baseline.items.map((i) => [i.id, i])) : null;
  const added = [];
  const gone = [];
  const newPorts = [];
  let known = 0;
  if (base) {
    for (const [id, item] of now) {
      const b = base.get(id);
      if (!b) { added.push(item); continue; }
      known++;
      const seen = new Set(b.ports || []);
      const fresh = item.ports.filter((p) => !seen.has(p));
      if (fresh.length) newPorts.push({ ...item, newPorts: fresh, baselinePorts: [...seen].sort() });
    }
    for (const [id, item] of base) if (!now.has(id)) gone.push(item);
  }
  const state = !base ? 'no-baseline'
    : (added.length || newPorts.length) ? 'findings'
    : observed.unknowns.length ? 'partial'
    : 'ok';
  return { added, newPorts, gone, known, unknowns: observed.unknowns, state };
}

export function runLens(opts = {}) {
  const baseline = readBaseline();
  const observed = observeEgress(opts);
  if (!observed.ok) return { at: nowISO(), coverage: COVERAGE, ...observed, state: 'unknown' };
  return {
    at: nowISO(), coverage: COVERAGE, baselineAt: baseline?.at ?? null,
    executables: observed.items.length, connections: observed.connections,
    ...diffEgress(observed, baseline),
    observed: observed.items,
  };
}

/** The human act. A failed observation pins NOTHING: an empty baseline would make the next real
 *  observation report every executable on the box as newly talking out. */
export function acceptBaseline(opts = {}) {
  const observed = observeEgress(opts);
  if (!observed.ok) throw new Error(`egress not observed (${observed.unknownReason}: ${observed.unknownDetail}) — nothing pinned`);
  const doc = {
    at: nowISO(), coverage: COVERAGE,
    items: observed.items.map((i) => ({ id: i.id, kind: i.kind, ports: i.ports })),
  };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: doc.items.length, unknowns: observed.unknowns };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/egress-baseline.mjs [--json]   which executables talk out, vs the accepted baseline\n'
      + 'node monitor/egress-baseline.mjs --accept   pin the currently observed egress (the human act)\n'
      + `coverage: ${COVERAGE} — unprivileged lsof sees this user's processes only; never run under sudo\n`
      + 'exit 0 ok, 1 findings (a new executable talking out, or a new remote port class), 2 grey');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = acceptBaseline();
    console.log(`pinned ${a.pinned} executable(s) → ${a.path}`);
    for (const u of a.unknowns) console.log(`  NOT pinned: ${u.id} (${u.unknownReason})`);
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`egress-baseline: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`egress-baseline: ${r.state}  (${r.executables} executable(s), ${r.connections} connection(s), `
      + `coverage ${r.coverage}, baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    for (const i of r.added) console.log(`  NEW EGRESS  ${i.id}  ${i.connections} conn to ${i.remotes} address(es) on [${i.ports.join(',')}]`);
    for (const i of r.newPorts) console.log(`  NEW PORT    ${i.id}  now also [${i.newPorts.join(',')}] (lead, not a finding on its own)`);
    for (const i of r.gone) console.log(`  GONE        ${i.id} (informational)`);
    for (const u of r.unknowns) console.log(`  UNKNOWN     ${u.id} (${u.unknownReason})`);
  }
  process.exit(r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}
