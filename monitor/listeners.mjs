// commitwork monitor — what is actually bound on this box: the observation layer the deploy
// declaration is checked AGAINST, never a second declaration. Strictly read-only (one lsof).
// Honesty contract: unavailable/failed/unparseable/zero-rows -> { ok:false, reason } — never an
// empty success. Callers must branch on `ok`, never on `rows.length`.
//
// node monitor/listeners.mjs            readable table
// node monitor/listeners.mjs --json     machine-readable
// node monitor/listeners.mjs --external only the sockets reachable from off-box

import { execFileSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';
// One implementation of process naming, shared with the sibling host lens.
import { parseTasklistCsv } from './port-bind.mjs';
import { fileURLToPath } from 'node:url';

// Protocol-aware gate: TCP must carry (LISTEN); UDP (no LISTEN state) must be unconnected with a
// real port. Ephemeral-range ports are kept as rows but flagged, never silently dropped.
export const EPHEMERAL_MIN = () => {
  const v = Number(process.env.CW_EPHEMERAL_MIN);
  return Number.isFinite(v) && v > 0 ? v : 32768;   // read at CALL time — see the CW_* invariant
};
export const isEphemeral = (row) => row.proto === 'UDP' && row.port !== null && row.port >= EPHEMERAL_MIN();

// ── binding classification ──────────────────────────────────────────────────────────────────
// The distinction that matters is not IPv4/IPv6, it is REACHABLE FROM OFF-BOX or not.
export const BINDING = Object.freeze({
  // 127.0.0.0/8, ::1 — the kernel refuses off-box packets. The tunnel's origins live here.
  LOOPBACK: 'loopback',
  // *, 0.0.0.0, :: — every interface, present and future. Reachable from the LAN, and from
  // anywhere the LAN is bridged.
  WILDCARD: 'wildcard',
  // A specific non-loopback address (192.168.1.121, a Tailscale 100.x, a public v6). Narrower
  // than wildcard but still OFF-BOX reachable — it is not a safer class, only a smaller one.
  INTERFACE: 'interface',
});

// Wildcard, not loopback ⇒ off-box reachable. This is the field a gate should read.
export const isExternal = (row) => row.binding !== BINDING.LOOPBACK;

const WILDCARD_ADDRS = new Set(['*', '0.0.0.0', '::', '[::]', '']);

export function classifyBinding(address) {
  const a = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (WILDCARD_ADDRS.has(a)) return BINDING.WILDCARD;
  if (a === '::1' || a === 'localhost' || /^127\./.test(a)) return BINDING.LOOPBACK;
  // an IPv6 v4-mapped loopback, e.g. ::ffff:127.0.0.1
  if (/^::ffff:127\./.test(a)) return BINDING.LOOPBACK;
  return BINDING.INTERFACE;
}

// lsof NAME field -> { address, port, portLabel }. Handles `*:8081`, `127.0.0.1:8099`,
// `[::1]:9229`, `[::]:8080`. Returns null when it is not an address:port at all — an
// unrecognised shape is REPORTED as skipped, never quietly dropped.
export function parseAddress(name) {
  const s = String(name ?? '').trim();
  if (!s || s.includes('->')) return null;               // established connection, not a listener
  const m = /^(\[[^\]]*\]|[^:]*):([^:\s]+)$/.exec(s);
  if (!m) return null;
  const address = m[1].replace(/^\[|\]$/g, '') || '*';
  const portLabel = m[2];
  const port = /^\d+$/.test(portLabel) ? Number(portLabel) : null;
  return { address, port, portLabel };
}

// ── lsof output parser ──────────────────────────────────────────────────────────────────────
// Whitespace-split (lsof escapes COMMAND spaces as \x20). -> { rows, skipped: [{line, why, kind}] };
// skipped is returned, not swallowed. kind: 'unparsed' = the parser failed on it; 'excluded' =
// understood and deliberately not a row — the two must never report as one.
export function parseLsof(stdout) {
  const rows = [], skipped = [];
  const drop = (line, why, kind) => skipped.push({ line, why, kind });
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^COMMAND\s+PID\b/.test(line)) continue;                               // header
    if (/^lsof[: ]/i.test(line) || /^\s*WARNING\b/i.test(line)) continue;      // lsof's own chatter
    const f = line.trim().split(/\s+/);
    if (f.length < 9) { drop(line, `expected >=9 whitespace fields, got ${f.length}`, 'unparsed'); continue; }
    const [command, pid, user, fd, type, , , node] = f;
    const name = f.slice(8).join(' ');
    if (!/^\d+$/.test(pid)) { drop(line, `PID field '${pid}' is not numeric`, 'unparsed'); continue; }
    const proto = String(node || '').toUpperCase();
    // TCP keeps the (LISTEN) gate; a bound UDP socket is unconnected with a real port.
    if (proto === 'UDP') {
      if (/->/.test(name)) { drop(line, 'UDP row is a connected socket, not a bound port', 'excluded'); continue; }
    } else if (!/\(LISTEN\)/.test(name)) {
      drop(line, 'not a (LISTEN) row', 'excluded'); continue;
    }
    const addr = parseAddress(name.replace(/\s*\(LISTEN\)\s*$/, ''));
    if (!addr) { drop(line, `NAME '${name}' is not address:port`, 'unparsed'); continue; }
    // `*:*` is a socket with no port at all — excluded on the port LABEL, not on port === null
    // (a service name like `*:mdns` is also a null numeric port but a real listener).
    if (addr.portLabel === '*' || addr.portLabel === '') { drop(line, `NAME '${name}' names no port at all`, 'excluded'); continue; }
    const row = {
      command: command.replace(/\\x20/g, ' '),
      pid: Number(pid), user, fd, family: type, proto,
      address: addr.address, port: addr.port, portLabel: addr.portLabel,
      binding: classifyBinding(addr.address),
    };
    row.ephemeral = isEphemeral(row);
    rows.push(row);
  }
  return { rows, skipped };
}

// ── the lsof runner ─────────────────────────────────────────────────────────────────────────
// `+c 0` asks for the full command name (not universally supported — plain form second). One call
// covers TCP+UDP: lsof ORs -i selectors and -sTCP:LISTEN constrains only the TCP half.
export const LSOF_ARGV = Object.freeze([
  ['+c', '0', '-nP', '-iTCP', '-sTCP:LISTEN', '-iUDP'],
  ['-nP', '-iTCP', '-sTCP:LISTEN', '-iUDP'],
]);

// -> { ok: true, stdout, argv } | { ok: false, reason }. Every failure carries WHY.
export function runLsof({ bin = 'lsof', timeout = 10_000 } = {}) {
  const tried = [];
  for (const args of LSOF_ARGV) {
    try {
      // lsof exits 1 when it merely has nothing to report, so a non-empty stdout is the success
      // test, not the exit code — which is also why the catch below inspects e.stdout.
      const stdout = execFileSync(bin, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
      if (stdout && stdout.trim()) return { ok: true, stdout, argv: [bin, ...args] };
      tried.push(`${bin} ${args.join(' ')}: exited 0 with empty stdout`);
    } catch (e) {
      if (e && typeof e.stdout === 'string' && e.stdout.trim()) return { ok: true, stdout: e.stdout, argv: [bin, ...args] };
      if (e && e.code === 'ENOENT') return { ok: false, reason: `\`${bin}\` not found on PATH — listener state is UNKNOWN, not empty` };
      tried.push(`${bin} ${args.join(' ')}: ${e && e.message ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  return { ok: false, reason: `\`${bin}\` produced no usable output — listener state is UNKNOWN, not empty. Tried: ${tried.join(' | ')}` };
}

// ── the win32 adapter ───────────────────────────────────────────────────────────────────────
//
// There is no lsof on Windows, so this lens answered `ok:false, reason: lsof not found` on every
// Windows box. That is HONEST — UNKNOWN is not empty, and the refusal is the rule working — but it
// is not an answer, and this is a security lens: "what is bound, and is it reachable from off the
// machine" is exactly the question a monitor must not shrug at. monitor/port-bind.mjs, its sibling
// lens, grew a netstat adapter earlier in this cycle and its own note observes that the other host
// lenses have real win32 adapters. This closes the same gap here.
//
// `netstat -ano` and `tasklist` ship with every Windows install — no optional component, nothing to
// install, which is the standing constraint for this platform.
//
// UDP IS INCLUDED, and that is the reason this does not simply reuse parseNetstatListeners() from
// port-bind.mjs: that parser is TCP-only by design, because its lens is about listening TCP
// sockets. This lens counts bound UDP sockets too, and quietly dropping them on one platform would
// under-report exactly the externally-bound sockets it exists to surface. parseTasklistCsv IS
// reused, so process naming keeps one implementation.

/**
 * Parse `netstat -ano` → rows in the same shape parseLsof() produces.
 *
 * LOCALE. The state column is translated on a localized Windows ("ABHÖREN", "ÉCOUTE"), so matching
 * the literal "LISTENING" would return zero rows on a non-English box — an empty result reading as
 * "nothing is bound", which is the fail-closed rule's exact prohibition. The locale-independent
 * fact is structural: a listening TCP socket has no peer, printed as a foreign address ending `:0`.
 * The English word is accepted too; a row satisfying neither is not taken. Same reasoning, and the
 * same test, as port-bind.mjs — stated here rather than cross-referenced because a reader editing
 * this parser needs it in front of them.
 */
export function parseNetstat(stdout, names = new Map()) {
  const rows = [], skipped = [];
  const drop = (line, why, kind) => skipped.push({ line, why, kind });
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^\s*(Active Connections|Proto\s+Local Address)/i.test(line)) continue;   // banner + header
    const cols = line.trim().split(/\s+/);
    const proto = String(cols[0] || '').toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') { drop(line, `first field '${cols[0]}' is not TCP or UDP`, 'unparsed'); continue; }
    // TCP: Proto Local Foreign State PID (5). UDP: Proto Local Foreign PID (4) — no state column.
    const want = proto === 'TCP' ? 5 : 4;
    if (cols.length < want) { drop(line, `${proto} row has ${cols.length} fields, expected ${want}`, 'unparsed'); continue; }
    const local = cols[1];
    const foreign = cols[2];
    const pid = Number(cols[want - 1]);
    if (!Number.isInteger(pid)) { drop(line, `PID field '${cols[want - 1]}' is not numeric`, 'unparsed'); continue; }
    if (proto === 'TCP') {
      const noPeer = /:0$/.test(foreign);
      if (!noPeer && !/^LISTENING$/i.test(cols[3])) { drop(line, 'not a listening TCP row', 'excluded'); continue; }
    } else if (!/^(\*:\*|0\.0\.0\.0:0|\[::\]:0)$/.test(foreign)) {
      // a UDP row WITH a peer is a connected socket, not a bound port — the same exclusion parseLsof
      // applies to `->` in an lsof NAME field
      drop(line, 'UDP row is a connected socket, not a bound port', 'excluded'); continue;
    }
    const addr = parseAddress(local);
    if (!addr) { drop(line, `local address '${local}' is not address:port`, 'unparsed'); continue; }
    if (addr.portLabel === '*' || addr.portLabel === '') { drop(line, `'${local}' names no port at all`, 'excluded'); continue; }
    const row = {
      // A pid with no tasklist entry keeps command null rather than inventing one — the absence is
      // the answer, and a fabricated process name on a security lens is worse than a blank.
      command: names.get(pid) ?? null,
      pid,
      user: null,          // netstat does not report the owner, and `tasklist /V` is locale-shaped
      fd: null,            // no such concept here
      // Tested on the RAW local field and on the stripped address, because parseAddress() removes
      // the brackets — checking `addr.address.startsWith('[')` made every row read IPv4, which the
      // fixture test caught. A bare `::` has no brackets left but is still v6, hence both.
      family: (local.startsWith('[') || addr.address.includes(':')) ? 'IPv6' : 'IPv4',
      proto,
      address: addr.address,
      port: addr.port,
      portLabel: addr.portLabel,
      binding: classifyBinding(addr.address),
    };
    row.ephemeral = isEphemeral(row);
    rows.push(row);
  }
  return { rows, skipped };
}

/** -> { ok: true, stdout, argv, names } | { ok: false, reason }. Every failure carries WHY. */
export function runNetstat({ bin = 'netstat', timeout = 10_000 } = {}) {
  let stdout;
  try {
    stdout = execFileSync(bin, ['-ano'], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, reason: `\`${bin}\` not found on PATH — listener state is UNKNOWN, not empty` };
    return { ok: false, reason: `\`${bin} -ano\` failed: ${e && e.message ? e.message.split('\n')[0] : String(e)} — listener state is UNKNOWN, not empty` };
  }
  if (!stdout || !stdout.trim()) return { ok: false, reason: `\`${bin} -ano\` produced no output — listener state is UNKNOWN, not empty` };
  // Process names are a NICETY here: a tasklist failure leaves every command null and the socket
  // rows stand on their own. It must never turn a successful enumeration into an UNKNOWN.
  let names = new Map();
  try {
    names = parseTasklistCsv(execFileSync('tasklist', ['/FO', 'CSV', '/NH'],
      { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch { /* command stays null on every row, which the shape already allows */ }
  return { ok: true, stdout, argv: [bin, '-ano'], names, parse: (s) => parseNetstat(s, names) };
}

// ── the linux adapter ───────────────────────────────────────────────────────────────────────
// Unprivileged lsof on Linux lists only the caller's own sockets and exits 1 with nothing to say,
// which this lens must read as UNKNOWN. `ss` reads every socket from netlink and exits 0 with an
// empty body when nothing is bound, so empty and failed stay distinct. Process names are only
// visible for the caller's sockets; the rest keep command and pid null.

/** Parse `ss -H -lntup` → rows in the same shape parseLsof() produces. */
export function parseSs(stdout) {
  const rows = [], skipped = [];
  const drop = (line, why, kind) => skipped.push({ line, why, kind });
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (/^Netid\s+State\b/.test(line)) continue;                                // header, when -H is ignored
    const f = line.trim().split(/\s+/);
    if (f.length < 6) { drop(line, `expected >=6 whitespace fields, got ${f.length}`, 'unparsed'); continue; }
    const [netid, state, , , local] = f;
    const proto = netid.toUpperCase();
    if (proto !== 'TCP' && proto !== 'UDP') { drop(line, `Netid '${netid}' is not tcp or udp`, 'unparsed'); continue; }
    if (proto === 'TCP' && state !== 'LISTEN') { drop(line, 'not a LISTEN row', 'excluded'); continue; }
    if (proto === 'UDP' && state !== 'UNCONN') { drop(line, 'UDP row is a connected socket, not a bound port', 'excluded'); continue; }
    // fact: ss appends the interface scope to the address (127.0.0.53%lo:53, [fe80::1%eth0]:546)
    const addr = parseAddress(local.replace(/%[^\]:]+/, ''));
    if (!addr) { drop(line, `local address '${local}' is not address:port`, 'unparsed'); continue; }
    if (addr.portLabel === '*' || addr.portLabel === '') { drop(line, `'${local}' names no port at all`, 'excluded'); continue; }
    const proc = /users:\(\("([^"]*)",pid=(\d+),fd=(\d+)\)/.exec(f.slice(6).join(' '));
    const row = {
      command: proc ? proc[1] : null,
      pid: proc ? Number(proc[2]) : null,
      user: null,
      fd: proc ? proc[3] : null,
      family: (local.startsWith('[') || addr.address.includes(':')) ? 'IPv6' : 'IPv4',
      proto,
      address: addr.address,
      port: addr.port,
      portLabel: addr.portLabel,
      binding: classifyBinding(addr.address),
    };
    row.ephemeral = isEphemeral(row);
    rows.push(row);
  }
  return { rows, skipped };
}

export const SS_ARGV = Object.freeze(['-H', '-lntup']);

/** -> { ok: true, stdout, argv, parse } | { ok: false, missing?, reason }. Every failure carries WHY. */
export function runSs({ bin = 'ss', timeout = 10_000 } = {}) {
  try {
    const stdout = execFileSync(bin, SS_ARGV, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, stdout, argv: [bin, ...SS_ARGV], parse: parseSs };
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, missing: true, reason: `\`${bin}\` not found on PATH — listener state is UNKNOWN, not empty` };
    return { ok: false, reason: `\`${bin} ${SS_ARGV.join(' ')}\` failed: ${e && e.message ? e.message.split('\n')[0] : String(e)} — listener state is UNKNOWN, not empty` };
  }
}

/** The platform's enumerator. Injectable everywhere it is used, so no test depends on this choice. */
export const defaultRunner = (opts = {}) => {
  const platform = opts.platform || process.platform;
  if (platform === 'win32') return runNetstat(opts);
  if (platform === 'linux') {
    const ss = runSs(opts);
    return ss.missing ? runLsof(opts) : ss;
  }
  return runLsof(opts);
};

// ── the public entry point ──────────────────────────────────────────────────────────────────
// `run` is injectable so the failure paths are testable without breaking lsof on the machine.
// -> { ok:true, at, argv, rows, counts, skipped } | { ok:false, at, reason }
export function listeners({ run = defaultRunner, bin = null, now = () => new Date().toISOString() } = {}) {
  const at = now();
  // `bin` stays overridable but is no longer defaulted to 'lsof' here: the enumerator differs by
  // platform and each runner names its own default binary.
  const got = run(bin ? { bin } : {});
  if (!got || got.ok !== true) {
    return { ok: false, at, reason: (got && got.reason) || 'the lsof runner returned no result' };
  }
  // A runner may bring its own parser (the win32 adapter does). An injected fake that returns only
  // {ok, stdout} still parses as lsof, so every existing test is unaffected.
  const { rows, skipped } = (got.parse || parseLsof)(got.stdout);
  if (!rows.length) {
    // A running machine always has something bound — zero parsed rows is a tool failure.
    // Names the enumerator that actually ran, not a hardcoded "lsof" — on Windows that sentence
    // would send a reader to look for a tool the box does not have.
    return { ok: false, at, reason: `${(got.argv && got.argv[0]) || 'the enumerator'} returned ${String(got.stdout).split('\n').filter((l) => l.trim()).length} line(s) but ZERO parsed as LISTEN rows` +
      (skipped.length ? ` (${skipped.length} unparsed, first: ${skipped[0].why})` : '') +
      ' — listener state is UNKNOWN, not empty', skipped };
  }
  rows.sort((a, b) => (a.port ?? 0) - (b.port ?? 0) || a.proto.localeCompare(b.proto) || String(a.command ?? '').localeCompare(String(b.command ?? '')));
  const counts = {
    total: rows.length,
    external: rows.filter(isExternal).length,
    tcp: rows.filter((r) => r.proto === 'TCP').length,
    udp: rows.filter((r) => r.proto === 'UDP').length,
    // Kept apart from `total`: an ephemeral socket is a real observation but not a service.
    ephemeral: rows.filter((r) => r.ephemeral).length,
    [BINDING.LOOPBACK]: rows.filter((r) => r.binding === BINDING.LOOPBACK).length,
    [BINDING.WILDCARD]: rows.filter((r) => r.binding === BINDING.WILDCARD).length,
    [BINDING.INTERFACE]: rows.filter((r) => r.binding === BINDING.INTERFACE).length,
  };
  return { ok: true, at, argv: got.argv, rows, counts, skipped };
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────
export function formatTable(result) {
  if (!result || result.ok !== true) {
    return `listeners: UNKNOWN — ${result?.reason || 'no result'}\n` +
      '  (this is NOT "nothing is listening". Nothing was observed, so nothing is claimed.)';
  }
  const { rows, counts } = result;
  const head = ['PROTO', 'BINDING', 'ADDRESS', 'PORT', 'PROC', 'PID', 'FAM'];
  const body = rows.map((r) => [r.proto + (r.ephemeral ? '*' : ''), r.binding, r.address, r.portLabel, r.command ?? '?', r.pid == null ? '?' : String(r.pid), r.family]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (c) => c.map((v, i) => (i === c.length - 1 ? v : v.padEnd(w[i]))).join('  ').trimEnd();
  const out = [line(head), w.map((n) => '-'.repeat(n)).join('  ')];
  for (const b of body) out.push(line(b));
  out.push('');
  out.push(`${counts.total} bound socket(s) — ${counts.tcp} TCP, ${counts.udp} UDP — ` +
    `${counts.external} EXTERNALLY BOUND (${counts.wildcard} wildcard, ${counts.interface} interface), ` +
    `${counts.loopback} loopback.`);
  if (counts.ephemeral) {
    out.push(`${counts.ephemeral} marked * are UDP sockets in the ephemeral range (>= ${EPHEMERAL_MIN()}) — ` +
      'transient client sockets, not services. They are shown because they were observed, and must not be read as owned ports.');
  }
  if (counts.external) {
    out.push('EXTERNALLY BOUND — reachable from off-box, and NOT covered by any tunnel/ingress declaration:');
    for (const r of rows.filter(isExternal)) out.push(`  ${r.address}:${r.portLabel}  ${r.command ?? '?'} (pid ${r.pid ?? '?'})`);
  }
  // Deliberately-excluded and could-not-read are different statements; only the second warns.
  const unparsed = (result.skipped || []).filter((s) => s.kind !== 'excluded');
  const excluded = (result.skipped || []).filter((s) => s.kind === 'excluded');
  if (excluded.length) out.push(`${excluded.length} line(s) understood and excluded — not bound ports (first: ${excluded[0].why})`);
  if (unparsed.length) out.push(`${unparsed.length} line(s) NOT UNDERSTOOD by the parser (first: ${unparsed[0].why})`);
  return out.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
// Exit 0 when the observation succeeded, 1 when it did not. An unavailable tool must not exit 0
// with an empty table — that is the silent green this module exists to refuse.
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  let r = listeners();
  if (r.ok && argv.includes('--external')) {
    const rows = r.rows.filter(isExternal);
    r = { ...r, rows, counts: { ...r.counts, total: rows.length } };
  }
  process.stdout.write((argv.includes('--json') ? JSON.stringify(r, null, 2) : formatTable(r)) + '\n');
  process.exit(r.ok ? 0 : 1);
}
