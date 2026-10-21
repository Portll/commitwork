// monitor/port-bind.mjs — the port/bind lens: does each socket this box's commitwork-relevant
// processes hold match its DECLARATION (monitor/bind-declarations.json)?
//
// THE SEAM THIS CLOSES. Route auth and socket bind are decided in different places by different
// code: a route can be loopback-gated in the handler while the process listens on 0.0.0.0, and
// every route-level test stays green while the socket contradicts the model it tests. The bind is
// the outermost fact about a service's exposure and nothing asserted it. Three axes per declared
// bind, each machine-decidable:
//   iface    — observed bind class (loopback|any|addressed) vs declared. Broader than declared is
//              the finding; narrower is fine.
//   process  — the pid's command line names the declared entry (an unknown program on our port is
//              the impersonation seam).
//   auth     — an unauthenticated GET at the declared probePath answers with a challenge
//              (401/403/redirect), probed on LOOPBACK ONLY, own box only.
//
// VERDICT DISCIPLINE (explicit uncertainty ≠ red): 'match' is claimed only when every DECLARED axis
// decided ok. An axis that could not be decided leaves the verdict 'undetermined' with the shared
// unknown vocabulary (monitor/unknown.mjs) — never a pass, never a finding. A service that is not
// listening is 'absent', its own state. Enumeration failure is unknown('tool-failed') for the whole
// lens — never "no listeners". Only findings ('mismatch', 'stdio-violation') alarm.
//
// Declaration split from authority: this reads and reports; it binds nothing and kills nothing.
// Env (read at call time): CW_BIND_DECLARATIONS, CW_BIND_LISTENERS (JSON fixture of collected
// listeners — tests run entirely on fixtures), CW_BIND_PROBE=0 disables the auth probe, CW_NOW.
//
//   node monitor/port-bind.mjs [--json]     exit 0 ok/absent, 1 findings, 2 could-not-enumerate

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const declarationsPath = () => process.env.CW_BIND_DECLARATIONS || join(REPO, 'monitor', 'bind-declarations.json');
const SCHEMA = join(REPO, 'schema', 'bind-declarations.schema.json');

/** Read + schema-validate the declarations. Throws on an invalid file — an unassertable surface
 *  must refuse to load, never degrade into asserting whatever parsed. */
export function readDeclarations() {
  const d = JSON.parse(readFileSync(declarationsPath(), 'utf8'));
  const { errors } = validateAgainstSchema(d, { path: SCHEMA });
  if (errors.length) throw new Error(`bind declarations invalid (${declarationsPath()}):\n  - ${errors.join('\n  - ')}`);
  return d;
}

// ── pure: address classification ────────────────────────────────────────────────────────────────
/** 'loopback' | 'any' | 'addressed' for a bind address as lsof/ss print it. */
export function ifaceClass(addr) {
  const a = String(addr || '').replace(/^\[|\]$/g, '');
  if (a === '127.0.0.1' || a === '::1' || a.startsWith('127.')) return 'loopback';
  if (a === '*' || a === '0.0.0.0' || a === '::') return 'any';
  return 'addressed';
}

// ── pure: parsers, one per enumeration tool ─────────────────────────────────────────────────────
/** Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output → [{pid, command, addr, port}]. */
export function parseLsofListeners(text) {
  const out = [];
  let pid = null;
  let command = null;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') { pid = Number(val) || null; command = null; }
    else if (tag === 'c') command = val;
    else if (tag === 'n') {
      // forms: 127.0.0.1:7878  *:8000  [::1]:7980  [::]:443
      const m = /^(.*):(\d+)$/.exec(val);
      if (m) out.push({ pid, command, addr: m[1], port: Number(m[2]) });
    }
  }
  return out;
}

/** Parse `ss -ltnpH` rows → same shape. The process column is absent without privilege; kept null. */
export function parseSsListeners(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const cols = line.trim().split(/\s+/);
    // State Recv-Q Send-Q Local:Port Peer:Port [users:(...)]
    const local = cols[3] || '';
    const m = /^(.*):(\d+)$/.exec(local);
    if (!m) continue;
    const proc = /users:\(\("([^"]+)",pid=(\d+)/.exec(line);
    out.push({ pid: proc ? Number(proc[2]) : null, command: proc ? proc[1] : null, addr: m[1], port: Number(m[2]) });
  }
  return out;
}

// ── pure: the Windows parsers ───────────────────────────────────────────────────────────────────
// This lens had NO win32 branch: `if (platform === 'linux') ss … else lsof …` sent Windows down the
// lsof path, where execFileSync throws ENOENT. Honest — the docstring promises a throw and the
// caller renders unknown — but the host-wide listening-port lens was simply unavailable on Windows
// while both of its sibling host lenses have real win32 adapters (disk-encryption.mjs reads
// BitLocker via manage-bde; persistence-diff.mjs reads the registry Run keys and `sc query`).

/**
 * Parse `netstat -ano` → [{pid, addr, port}] for LISTENING TCP rows.
 *
 * LOCALE. The state column is TRANSLATED on a localized Windows ("ABHÖREN", "ÉCOUTE",
 * "ESCUCHANDO"), so matching the literal string "LISTENING" would silently return zero listeners
 * on a non-English box — an empty result that reads as "nothing is listening" rather than as a
 * parse failure, which is the fail-closed rule's exact prohibition. The locale-independent fact is
 * structural instead: a listening TCP socket has no peer, which netstat prints as a foreign address
 * of `0.0.0.0:0` or `[::]:0`. The English word is accepted as well, so a row satisfying either is
 * taken; a row satisfying neither is not.
 */
export function parseNetstatListeners(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto Local Foreign State PID  — a listening TCP row has all five. UDP has four and no
    // state at all, and a UDP socket is not what this lens is about.
    if (cols.length < 5) continue;
    if (!/^TCP$/i.test(cols[0])) continue;
    const [, local, foreign, state, pidCol] = cols;
    const noPeer = /:0$/.test(foreign);
    if (!noPeer && !/^LISTENING$/i.test(state)) continue;
    const m = /^(.*):(\d+)$/.exec(local);
    const pid = Number(pidCol);
    if (!m || !Number.isInteger(pid)) continue;
    // `[::]` and `[::1]` keep their brackets here exactly as lsof prints them, so ifaceClass()
    // — which already strips them — needs no second dialect.
    out.push({ pid, command: null, addr: m[1], port: Number(m[2]) });
  }
  return out;
}

/**
 * Parse `tasklist /FO CSV /NH` → Map(pid -> image name).
 * CSV, not the default table: the table format pads and truncates long image names, and a
 * truncated process name feeding the `process` axis is a wrong answer wearing a right one's shape.
 */
export function parseTasklistCsv(text) {
  const names = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    // "Image Name","PID","Session Name","Session#","Mem Usage" — quoted, and an image name may
    // itself contain a comma, so the first two fields are taken by shape rather than by split(',').
    const m = /^"((?:[^"]|"")*)","(\d+)"/.exec(line.trim());
    if (m) names.set(Number(m[2]), m[1].replace(/""/g, '"'));
  }
  return names;
}

/** Parse the JSON array `Get-CimInstance Win32_Process` emits → Map(pid -> full command line). */
export function parseWin32ProcessJson(text) {
  const args = new Map();
  let rows;
  try { rows = JSON.parse(String(text || '')); } catch { return args; }
  // ConvertTo-Json emits a bare object rather than a 1-element array for a single result.
  for (const r of Array.isArray(rows) ? rows : [rows]) {
    const pid = Number(r && (r.ProcessId ?? r.processId));
    const cmd = r && (r.CommandLine ?? r.commandLine);
    // A null CommandLine is normal for protected/system processes and stays NULL — the `args`
    // contract is that absence is never fabricated, and the process axis then reads undetermined.
    if (Number.isInteger(pid) && typeof cmd === 'string' && cmd.trim()) args.set(pid, cmd.trim());
  }
  return args;
}

// ── collection (I/O) ────────────────────────────────────────────────────────────────────────────
/**
 * Enumerate listening TCP sockets, with each pid's full command line joined in (`args`).
 * CW_BIND_LISTENERS (a JSON array of {pid, command, args, addr, port}) bypasses exec entirely.
 * Throws on enumeration failure — the caller renders unknown; an error is never an empty box.
 */
export function collectListeners({ platform = process.platform, exec = execFileSync } = {}) {
  const fixture = process.env.CW_BIND_LISTENERS;
  if (fixture) {
    const rows = JSON.parse(readFileSync(fixture, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('CW_BIND_LISTENERS is not a JSON array');
    return { listeners: rows, method: 'fixture' };
  }
  if (platform === 'win32') return collectWindowsListeners(exec);
  let rows;
  let method;
  if (platform === 'linux') {
    rows = parseSsListeners(exec('ss', ['-ltnpH'], { encoding: 'utf8', timeout: 5000 }));
    method = 'ss';
  } else {
    rows = parseLsofListeners(exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8', timeout: 5000 }));
    method = 'lsof';
  }
  // args per pid, one ps call. Absence stays null — the process check then reads undetermined.
  const pids = [...new Set(rows.map((r) => r.pid).filter(Boolean))];
  const args = new Map();
  if (pids.length) {
    try {
      const out = exec('ps', ['-o', 'pid=,args=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 5000 });
      for (const line of out.split(/\r?\n/)) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m) args.set(Number(m[1]), m[2]);
      }
    } catch { /* ps unavailable: every args stays null, never fabricated */ }
  }
  return { listeners: rows.map((r) => ({ ...r, args: args.get(r.pid) ?? null })), method };
}

/**
 * The win32 adapter. `netstat -ano` is the enumeration: it is present on every Windows install,
 * needs no elevation for the socket table, and needs no PowerShell module. The socket table is
 * the LOAD-BEARING half and it is taken from netstat alone, so this lens works on a stock box.
 *
 * Process identity is layered on top and is allowed to fail:
 *   `tasklist /FO CSV` gives the image name (always available);
 *   one PowerShell CIM query gives the full COMMAND LINE, which is what the `process` axis
 *   actually needs to tell `node admin/serve.mjs` from any other `node`.
 * Either may be missing. Neither absence is invented around — `command`/`args` stay null and the
 * process axis reads undetermined, exactly as it does when `ps` is unavailable on POSIX.
 *
 * Enumeration failure still THROWS. An empty listener list on a box that is plainly serving would
 * be read as "nothing is listening", and this lens's whole contract is that a failure to enumerate
 * is unknown('tool-failed'), never an empty box.
 */
function collectWindowsListeners(exec) {
  const rows = parseNetstatListeners(exec('netstat.exe', ['-ano'], { encoding: 'utf8', timeout: 15000, windowsHide: true }));
  const names = (() => {
    try { return parseTasklistCsv(exec('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 15000, windowsHide: true })); }
    catch { return new Map(); }
  })();
  const args = (() => {
    try {
      // -NoProfile: a profile can print banners into stdout and can be slow. -NonInteractive: never
      // block on a prompt. -Command with an argv array, never a composed string — nothing here is
      // caller-controlled today and it stays that way by construction.
      const out = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress -Depth 2'],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
      return parseWin32ProcessJson(out);
    } catch { return new Map(); }   // no PowerShell / CIM refused: every args stays null
  })();
  return {
    listeners: rows.map((r) => ({
      ...r,
      command: names.get(r.pid) ?? null,
      args: args.get(r.pid) ?? null,
    })),
    method: 'netstat',
  };
}

// ── auth probe (loopback only, own box only) ────────────────────────────────────────────────────
/**
 * What does an unauthenticated GET at 127.0.0.1:port/path answer?
 * 'challenged' (401/403/407/redirect) | 'open' (2xx) | 'absent' (refused) | unknown(...).
 * A 404 means the probePath names nothing — unknown('no-subject'), NEVER 'challenged'.
 */
export async function probeAuth(port, path, { fetchImpl = fetch, timeoutMs = 1500 } = {}) {
  let res;
  try {
    res = await fetchImpl(`http://127.0.0.1:${port}${path}`, {
      redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' },
    });
  } catch (e) {
    const code = e?.cause?.code || e?.code || e?.name;
    if (code === 'ECONNREFUSED') return { observed: 'absent' };
    return { observed: null, ...unknown('tool-failed', `probe ${code || e}`) };
  }
  const s = res.status;
  if (s === 401 || s === 403 || s === 407) return { observed: 'challenged', status: s };
  if (s >= 300 && s < 400) return { observed: 'challenged', status: s, redirect: res.headers.get('location') || null };
  if (s >= 200 && s < 300) return { observed: 'open', status: s };
  if (s === 404) return { observed: null, status: s, ...unknown('no-subject', `probePath ${path} answers 404`) };
  return { observed: null, status: s, ...unknown('unstated', `status ${s}`) };
}

// ── pure: the assessment ────────────────────────────────────────────────────────────────────────
const IFACE_RANK = { loopback: 0, addressed: 1, any: 2 };

/**
 * Assess observed listeners (+ optional auth probe results, keyed by port) against declarations.
 * Pure and deterministic. Returns { rows, stdioFindings, findings, state }.
 * Verdicts: 'match' | 'mismatch' | 'absent' | 'undetermined'. Only mismatch/stdio-violation alarm.
 */
export function assessBinds(declarations, listeners, probes = {}) {
  const rows = [];
  for (const d of declarations.binds || []) {
    const on = listeners.filter((l) => l.port === d.port);
    if (!on.length) {
      rows.push({ port: d.port, purpose: d.purpose, owner: d.owner, verdict: 'absent' });
      continue;
    }
    // Worst observed interface decides — a port bound loopback AND any is exposed.
    const worst = on.reduce((a, b) => (IFACE_RANK[ifaceClass(b.addr)] > IFACE_RANK[ifaceClass(a.addr)] ? b : a));
    const observedIface = ifaceClass(worst.addr);
    const iface = {
      declared: d.iface, observed: observedIface, addrs: [...new Set(on.map((l) => l.addr))].sort(),
      ok: d.iface === 'any' ? true : IFACE_RANK[observedIface] <= IFACE_RANK[d.iface],
    };
    let proc = null;
    if (d.entryMatch) {
      const texts = on.map((l) => `${l.command ?? ''} ${l.args ?? ''}`);
      const anyArgs = on.some((l) => l.args != null);
      proc = anyArgs
        ? { declared: d.entryMatch, observed: [...new Set(on.map((l) => l.args || l.command))].sort(), ok: texts.some((t) => t.includes(d.entryMatch)) }
        : { declared: d.entryMatch, observed: [...new Set(on.map((l) => l.command).filter(Boolean))].sort(), ok: null, ...unknown('not-recorded', 'no command line available for the pid') };
    }
    let auth = null;
    if (d.auth) {
      const p = probes[d.port];
      if (!p) auth = { declared: d.auth, observed: null, ok: null, ...unknown('not-run', 'auth probe did not run') };
      else if (p.observed === null || p.observed === 'absent') auth = { declared: d.auth, ...p, ok: null };
      else auth = { declared: d.auth, ...p, ok: p.observed === d.auth };
    }
    const axes = [iface, proc, auth].filter(Boolean);
    const verdict = axes.some((a) => a.ok === false) ? 'mismatch'
      : axes.some((a) => a.ok === null) ? 'undetermined'
      : 'match';
    rows.push({ port: d.port, purpose: d.purpose, owner: d.owner, verdict, iface, ...(proc ? { process: proc } : {}), ...(auth ? { auth } : {}) });
  }

  // stdio-by-design declarations: a TCP listener whose command line names the entry violates them.
  const stdioFindings = [];
  for (const s of declarations.stdio || []) {
    const hits = listeners.filter((l) => l.args && s.entryMatch && l.args.includes(s.entryMatch));
    for (const h of hits) {
      stdioFindings.push({ verdict: 'stdio-violation', purpose: s.purpose, entryMatch: s.entryMatch, pid: h.pid, addr: h.addr, port: h.port });
    }
  }

  const findings = rows.filter((r) => r.verdict === 'mismatch').concat(stdioFindings);
  const state = findings.length ? 'findings'
    : rows.some((r) => r.verdict === 'undetermined') ? 'undetermined'
    : 'ok';
  return { rows, stdioFindings, findings, state };
}

// ── the lens, end to end ────────────────────────────────────────────────────────────────────────
export async function runLens({ platform, exec, fetchImpl } = {}) {
  const declarations = readDeclarations();
  let collected;
  try {
    collected = collectListeners({ platform, exec });
  } catch (e) {
    // Fail closed: could not enumerate ⇒ the whole lens is unknown, never "no listeners".
    return { at: nowISO(), ...unknown('tool-failed', `enumerate: ${e.code || e.message}`), state: 'unknown' };
  }
  const probes = {};
  if (process.env.CW_BIND_PROBE !== '0') {
    for (const d of declarations.binds || []) {
      if (d.auth && d.probePath) probes[d.port] = await probeAuth(d.port, d.probePath, { fetchImpl });
    }
  }
  return { at: nowISO(), method: collected.method, ...assessBinds(declarations, collected.listeners, probes) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/port-bind.mjs [--json]   assert observed binds against monitor/bind-declarations.json\n'
      + 'exit 0 ok/absent, 1 findings (iface/process/auth mismatch, stdio violation), 2 could not enumerate');
    process.exit(0);
  }
  const r = await runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) console.log(`port-bind: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
  else {
    console.log(`port-bind: ${r.state}  (${r.method}, ${r.at})`);
    for (const row of r.rows) {
      const bits = [`iface ${row.iface ? `${row.iface.observed ?? '?'}${row.iface.ok === false ? ' ≠ declared ' + row.iface.declared : ''}` : '-'}`];
      if (row.process) bits.push(`process ${row.process.ok === null ? 'undetermined' : row.process.ok ? 'ok' : 'MISMATCH'}`);
      if (row.auth) bits.push(`auth ${row.auth.ok === null ? (row.auth.observed === 'absent' ? 'absent' : 'undetermined') : row.auth.ok ? row.auth.observed : `${row.auth.observed} ≠ declared ${row.auth.declared}`}`);
      console.log(`  :${row.port} ${row.verdict.toUpperCase().padEnd(12)} ${row.purpose}${row.verdict === 'absent' ? '' : ` — ${bits.join(', ')}`}`);
    }
    for (const f of r.stdioFindings) console.log(`  STDIO-VIOLATION ${f.entryMatch} listening on ${f.addr}:${f.port} (pid ${f.pid})`);
  }
  process.exit(r.unknown ? 2 : r.findings?.length ? 1 : 0);
}
