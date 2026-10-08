// commitwork monitor — who owns this port. Ownership axis of the Nuclei+ solver and the panel's
// Host section. Read-only: one `lsof` (via monitor/listeners.mjs) and one `docker ps`.
//
//   node monitor/host-inventory.mjs                 readable table
//   node monitor/host-inventory.mjs --json          machine-readable (FULL detail, local only)
//   node monitor/host-inventory.mjs --published     the redacted shape the panel may serve

import { execFileSync } from 'node:child_process';
import { hostname, userInfo } from 'node:os';
import { writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listeners, isExternal, BINDING } from './listeners.mjs';
import { loadRegistry } from './registry.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// ── ownership vocabulary ────────────────────────────────────────────────────────────────────
// lsof answers WHO holds a socket (unprivileged: root-owned invisible); netstat answers WHETHER
// one exists — the latter is what makes `unbound-observed` reachable.
export const OWNER = Object.freeze({
  PROJECT: 'project',                          // a container the fleet publishes, or a declared target
  HOST: 'host',                                // a process on this box belonging to no scanned repo
  UNBOUND_OBSERVED: 'unbound-observed',        // the socket table was read and this port is NOT in it
  UNBOUND_UNVERIFIABLE: 'unbound-unverifiable', // lsof saw nothing and the socket table could not be read
  UNKNOWN: 'unknown',                          // observation unavailable, or the scan is out of window
});

// Only `project` and `host` are claims. The other two are admissions.
export const isClaim = (o) => o === OWNER.PROJECT || o === OWNER.HOST;

// ── docker ─────────────────────────────────────────────────────────────────────────────────
// Join on the PORT MAPPING, never the container name — names are chosen by whoever starts the
// container, so a name-keyed ownership model is gameable.
export function parseDockerPorts(text) {
  // `127.0.0.1:8095->8080/tcp`, `0.0.0.0:54339->6543/tcp, [::]:54339->6543/tcp`,
  // `8080/tcp` (exposed, NOT published — no host port, so it owns nothing on this box), ``.
  const out = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const tab = line.indexOf('\t'); if (tab < 0) continue;
    const name = line.slice(0, tab).trim();
    for (const part of line.slice(tab + 1).split(',')) {
      const m = /^\s*(?:(\[[^\]]+\]|[\d.]+):)?(\d+)->\d+\/(tcp|udp)\s*$/i.exec(part);
      if (!m) continue;                                   // unpublished `8080/tcp` owns no host port
      out.push({ container: name, address: (m[1] || '').replace(/^\[|\]$/g, ''), port: Number(m[2]), proto: m[3].toUpperCase() });
    }
  }
  return out;
}

// Fail closed: docker absent means ownership UNKNOWN, never an empty success.
export function readDocker({ run = null, timeout = 10_000 } = {}) {
  const exec = run || (() => execFileSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'],
    { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }));
  try {
    const stdout = exec();
    return { ok: true, mappings: parseDockerPorts(stdout) };
  } catch (e) {
    const why = e && e.code === 'ENOENT' ? '`docker` not found on PATH' : (e && e.message ? e.message.split('\n')[0] : String(e));
    return { ok: false, reason: `${why} — container ownership is UNKNOWN, not absent` };
  }
}

// ── the socket table: does this port exist at all? ──────────────────────────────────────────
// macOS netstat separates the port with a DOT (`*.5353`, `::1.8080`); only LISTEN rows count for
// TCP, and a UDP row with a peer address is a connection.
export function parseNetstat(text) {
  const bound = new Set();
  for (const raw of String(text ?? '').split('\n')) {
    const f = raw.trim().split(/\s+/);
    if (f.length < 5) continue;
    const proto = /^tcp/i.test(f[0]) ? 'TCP' : /^udp/i.test(f[0]) ? 'UDP' : null;
    if (!proto) continue;
    const local = f[3], peer = f[4];
    if (proto === 'TCP' && !/LISTEN/.test(raw)) continue;       // established/TIME_WAIT are not listeners
    if (proto === 'UDP' && peer && peer !== '*.*') continue;     // a connected UDP socket is not a bound port
    const m = /\.(\d+)$/.exec(local);                           // trailing .PORT — `*.*` has none
    if (!m) continue;
    bound.add(`${Number(m[1])}/${proto}`);
  }
  return bound;
}

// Fail closed: an unreadable or zero-row socket table is a tool failure, never an empty box.
export function readSocketTable({ run = null, bin = 'netstat', timeout = 10_000 } = {}) {
  const exec = run || (() => execFileSync(bin, ['-an'], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }));
  try {
    const bound = parseNetstat(exec());
    if (!bound.size) return { ok: false, reason: 'the socket table parsed to ZERO bound ports — a live machine always has some, so this is a parse or tool failure, not an empty box' };
    return { ok: true, bound };
  } catch (e) {
    const why = e && e.code === 'ENOENT' ? `\`${bin}\` not found on PATH` : (e && e.message ? e.message.split('\n')[0] : String(e));
    return { ok: false, reason: `${why} — whether a port is bound is UNKNOWN, so nothing may be refuted on its absence` };
  }
}

// ── the registry's declared targets ─────────────────────────────────────────────────────────
// A declared target is a weaker ownership signal than a live container.
export function declaredPorts(reg) {
  const out = [];
  const add = (repo, url) => {
    const m = /^https?:\/\/([^/:]+)(?::(\d+))?/i.exec(String(url || '')); if (!m) return;
    const port = m[2] ? Number(m[2]) : (/^https:/i.test(url) ? 443 : 80);
    out.push({ repo, address: m[1], port, proto: 'TCP' });
  };
  for (const [repo, url] of Object.entries((reg && reg.urls) || {})) add(repo, url);
  for (const p of (reg && reg.projects) || []) {
    if (p.url) add(p.name, p.url);
    for (const [repo, url] of Object.entries(p.urls || {})) add(repo, url);
  }
  return out;
}

// ── the inventory ───────────────────────────────────────────────────────────────────────────
// One entry per (port, proto); `owners` is an array — ports are legitimately shared.
export function inventory({
  observe = listeners, docker = readDocker, reg = null, sockets = readSocketTable,
  now = () => new Date().toISOString(), windowStart = null, run = null,
} = {}) {
  const at = now();
  const obs = observe();
  if (!obs || obs.ok !== true) {
    return { ok: false, at, reason: (obs && obs.reason) || 'the listener observation returned no result' };
  }
  const dock = docker({ run });
  const table = sockets({});
  const registry = reg !== null ? reg : (() => { try { return loadRegistry({ quiet: true }); } catch { return null; } })();
  const declared = registry ? declaredPorts(registry) : [];

  const byKey = new Map();
  for (const r of obs.rows) {
    if (r.port === null) continue;                        // a named port cannot be joined numerically
    const key = `${r.port}/${r.proto}`;
    if (!byKey.has(key)) byKey.set(key, { port: r.port, proto: r.proto, sockets: [], containers: [], declaredFor: [] });
    byKey.get(key).sockets.push(r);
  }
  // A container mapping for a port nothing is listening on is still evidence the fleet owns it.
  for (const m of (dock.ok ? dock.mappings : [])) {
    const key = `${m.port}/${m.proto}`;
    if (!byKey.has(key)) byKey.set(key, { port: m.port, proto: m.proto, sockets: [], containers: [], declaredFor: [] });
    byKey.get(key).containers.push(m.container);
  }
  for (const d of declared) {
    const key = `${d.port}/${d.proto}`;
    if (byKey.has(key)) byKey.get(key).declaredFor.push(d.repo);
  }

  const entries = [...byKey.values()].map((e) => {
    const live = e.sockets.filter((s) => !s.ephemeral);
    // `project` wins if ANY owner is a project
    const owner = e.containers.length || e.declaredFor.length ? OWNER.PROJECT
      : live.length ? OWNER.HOST
        : e.sockets.length ? OWNER.HOST                   // ephemeral-only: still a process on this box
          : OWNER.UNBOUND_UNVERIFIABLE;
    return {
      port: e.port, proto: e.proto, owner,
      binding: live.length ? (live.some(isExternal) ? (live.some((s) => s.binding === BINDING.WILDCARD) ? BINDING.WILDCARD : BINDING.INTERFACE) : BINDING.LOOPBACK) : null,
      external: live.some(isExternal),
      ephemeralOnly: e.sockets.length > 0 && live.length === 0,
      containers: [...new Set(e.containers)].sort(),
      declaredFor: [...new Set(e.declaredFor)].sort(),
      // Local-only detail — stripped by publishedView() before anything reaches the panel
      owners: e.sockets.map((s) => ({ command: s.command, pid: s.pid, user: s.user, address: s.address, ephemeral: s.ephemeral })),
    };
  }).sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto));

  return {
    ok: true,
    // Identity and window of this observation — consumers outside it degrade to unknown
    observedBy: { hostId: hostname(), euid: typeof process.geteuid === 'function' ? process.geteuid() : null, argv: obs.argv || null },
    window: { capturedAt: at, from: windowStart || at, to: at },
    privileged: typeof process.geteuid === 'function' ? process.geteuid() === 0 : false,
    // The socket table is what lets an absence be asserted
    socketTable: table.ok ? { ok: true, bound: [...table.bound].sort() } : { ok: false, reason: table.reason },
    docker: dock.ok ? { ok: true, containers: [...new Set(dock.mappings.map((m) => m.container))].length } : { ok: false, reason: dock.reason },
    registry: registry ? { ok: true, declaredPorts: declared.length } : { ok: false, reason: 'the registry could not be loaded — declared targets are UNKNOWN' },
    counts: {
      total: entries.length,
      project: entries.filter((e) => e.owner === OWNER.PROJECT).length,
      host: entries.filter((e) => e.owner === OWNER.HOST).length,
      external: entries.filter((e) => e.external).length,
      // Bound off-box and covered by no ingress declaration
      externalUndeclared: entries.filter((e) => e.external && !e.declaredFor.length && !e.containers.length).length,
    },
    entries,
  };
}

// ── two observations, one window ────────────────────────────────────────────────────────────
// Two observations bracket the batch; where they disagree, the port changed hands mid-window and
// the verdict is `unknown`.
export function reconcile(before, after) {
  if (!before || before.ok !== true) return after && after.ok === true ? after : (before || after);
  if (!after || after.ok !== true) return before;
  const key = (e) => `${e.port}/${e.proto}`;
  const post = new Map(after.entries.map((e) => [key(e), e]));
  const pre = new Map(before.entries.map((e) => [key(e), e]));
  const entries = [];
  for (const k of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(k), b = post.get(k);
    if (a && b && a.owner === b.owner) { entries.push({ ...b, stable: true }); continue; }
    const e = b || a;
    entries.push({
      ...e, owner: OWNER.UNKNOWN, stable: false,
      unstableWhy: !a ? 'the port appeared during the batch'
        : !b ? 'the port went away during the batch'
          : `ownership changed during the batch: ${a.owner} -> ${b.owner}`,
    });
  }
  entries.sort((x, y) => x.port - y.port || x.proto.localeCompare(y.proto));
  return {
    ...after,
    window: { capturedAt: after.window.capturedAt, from: before.window.capturedAt, to: after.window.capturedAt },
    entries,
    counts: {
      ...after.counts,
      total: entries.length,
      project: entries.filter((e) => e.owner === OWNER.PROJECT).length,
      host: entries.filter((e) => e.owner === OWNER.HOST).length,
      unstable: entries.filter((e) => e.stable === false).length,
    },
  };
}

// ── ownership lookup, the solver's entry point ──────────────────────────────────────────────
// A scan timestamp outside the observation window is UNKNOWN, never a verdict.
export function ownerOf(inv, { port, proto = 'TCP', at = null } = {}) {
  if (!inv || inv.ok !== true) return { owner: OWNER.UNKNOWN, why: (inv && inv.reason) || 'no inventory' };
  if (at && inv.window) {
    const t = Date.parse(at), from = Date.parse(inv.window.from), to = Date.parse(inv.window.to);
    if (Number.isFinite(t) && Number.isFinite(from) && Number.isFinite(to) && (t < from || t > to)) {
      return { owner: OWNER.UNKNOWN, why: `the scan at ${at} falls outside the observation window ${inv.window.from}..${inv.window.to}` };
    }
  }
  const p = Number(port); if (!Number.isFinite(p)) return { owner: OWNER.UNKNOWN, why: 'no port on the finding' };
  const key = `${p}/${String(proto).toUpperCase()}`;
  const e = inv.entries.find((x) => x.port === p && x.proto === String(proto).toUpperCase());
  if (!e) {
    // lsof attributed nothing here. The socket table decides which KIND of nothing that is.
    const t = inv.socketTable;
    if (!t || t.ok !== true) {
      return { owner: OWNER.UNBOUND_UNVERIFIABLE,
        why: `lsof attributed nothing to this port and the socket table could not be read (${(t && t.reason) || 'not captured'}) — so absence is unproven and refutes nothing` };
    }
    if (t.bound.includes(key)) {
      // Bound but unattributable (root-owned socket): unknown, never absent
      return { owner: OWNER.UNKNOWN,
        why: 'the socket table shows this port IS bound, but lsof could not attribute it — a root-owned socket is invisible to an unprivileged observer, so the owner is unknown and the port is certainly not free' };
    }
    return { owner: OWNER.UNBOUND_OBSERVED,
      why: 'the kernel socket table was read and this port is not in it — nothing is bound here, and that is an observation rather than an inference' };
  }
  return { owner: e.owner, why: '', entry: e };
}

// ── the published shape ─────────────────────────────────────────────────────────────────────
// Strip `command`/`pid`/`user` — the panel is served over a tunnel; publish the shape of the box,
// not who is sitting at it.
export function publishedView(inv) {
  if (!inv || inv.ok !== true) return { ok: false, at: inv?.at ?? null, reason: inv?.reason ?? 'no inventory' };
  return {
    ok: true,
    window: inv.window, privileged: inv.privileged,
    docker: inv.docker, registry: inv.registry, counts: inv.counts,
    entries: inv.entries.map(({ owners, ...rest }) => rest),
  };
}

export function writeInventory(dir, inv, { published = false } = {}) {
  const out = join(dir, published ? 'host-inventory.json' : 'host-inventory.local.json');
  writeAtomic(out, JSON.stringify(published ? publishedView(inv) : inv, null, 2) + '\n');
  return out;
}

export function readInventory(dir) {
  for (const f of ['host-inventory.local.json', 'host-inventory.json']) {
    try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { /* try the next */ }
  }
  return null;
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────
export function formatTable(inv) {
  if (!inv || inv.ok !== true) {
    return `host-inventory: UNKNOWN — ${inv?.reason || 'no result'}\n` +
      '  (this is NOT "the box owns nothing". Nothing was observed, so nothing is claimed.)';
  }
  const head = ['PORT', 'PROTO', 'OWNER', 'BINDING', 'CONTAINER / DECLARED'];
  const body = inv.entries.map((e) => [String(e.port), e.proto, e.owner, e.binding || '—',
    [...e.containers, ...e.declaredFor.map((d) => `declared:${d}`)].join(' ') || (e.ephemeralOnly ? '(ephemeral only)' : '—')]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => c.map((v, i) => (i === c.length - 1 ? v : v.padEnd(w[i]))).join('  ').trimEnd();
  const out = [line(head), w.map((n) => '-'.repeat(n)).join('  ')];
  for (const b of body) out.push(line(b));
  out.push('');
  out.push(`${inv.counts.total} port(s): ${inv.counts.project} project · ${inv.counts.host} host · ${inv.counts.external} externally bound.`);
  if (inv.counts.externalUndeclared) {
    out.push(`${inv.counts.externalUndeclared} externally bound and covered by NO tunnel or ingress declaration.`);
  }
  if (!inv.privileged) {
    out.push('UNPRIVILEGED OBSERVATION — root-owned sockets are invisible here, so an absent port means ' +
      '"not seen", never "not bound". No finding may be refuted on that basis.');
  }
  if (!inv.docker.ok) out.push(`docker: ${inv.docker.reason}`);
  if (!inv.registry.ok) out.push(`registry: ${inv.registry.reason}`);
  return out.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const inv = inventory();
  const payload = argv.includes('--published') ? publishedView(inv) : inv;
  process.stdout.write(((argv.includes('--json') || argv.includes('--published')) ? JSON.stringify(payload, null, 2) : formatTable(inv)) + '\n');
  process.exit(inv.ok ? 0 : 1);
}
