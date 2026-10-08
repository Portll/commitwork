// guard: isolation rides beside coverage and never moves status
import { spawn as spawnChild, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fsSync from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { POSTURES, DECLARABLE_CREDENTIALS, EGRESS_CLASSES, expandSandboxPath, hostSandboxArgv } from './sandbox.mjs';
import { evaluateBoundary, FORBIDDEN_CREDENTIAL_SEGMENTS, SCANNER_LABELS } from '../../lib/security-execution-boundary.mjs';

export const ISOLATION = Object.freeze(['none', 'fs-only', 'full']);

export const UNSANDBOXED_REASON = 'ran unsandboxed: this lane executes repository code under the operator user with network access';

// fact: a container lane is confined by the posture its command names, never by the host wrapper / the docker client needs the daemon socket, which the host profile denies as network (expiry: never, prev: not built)
export function containerLaneIsolation(check) {
  const text = (check?.local || []).join('\n');
  const named = [...text.matchAll(/--posture\s+([a-z-]+)/g)].map((m) => m[1]);
  const known = named.filter((n) => POSTURES[n]);
  const full = known.length > 0 && known.length === named.length && known.every((n) => POSTURES[n].network === 'none');
  const where = named.length ? `posture ${[...new Set(named)].join(', ')}` : 'the posture its script selects';
  return { isolation: full ? 'full' : 'fs-only', isolationReason: `container lane: confined by ${where}; host wrapper not applied` };
}

export function applyIsolation(res, check) {
  if (!res || res.isolation !== 'none' || !check?.executesRepoCode) return res;
  if (res.coverage === 'unknown') return res;
  res.coverage = 'reduced';
  res.coverageReason = [res.coverageReason, UNSANDBOXED_REASON].filter(Boolean).join('; ');
  res.coverageBasis = 'isolation';
  return res;
}

// ---- execution boundary: declared containment against measured effects, per lane command ----

export const BOUNDARY_PROBES = Object.freeze(['permitted-read', 'credential-read', 'write-escape', 'egress', 'network-control', 'loopback', 'loopback-control']);
export const PROBE_OUTCOMES = Object.freeze(['allowed', 'denied', 'error', 'not-run']);
export const BOUNDARY_ADAPTERS = Object.freeze(['host-sandbox', 'container']);
export const PHASES = Object.freeze(['warm', 'read', 'execute']);
export const THREATS = Object.freeze(['credential-theft', 'write-outside-roots', 'exfiltration', 'repo-code-with-network', 'local-service-reach']);
export const THREAT_STATUS = Object.freeze(['mitigated', 'exposed', 'accepted', 'unmeasured', 'not-applicable']);

const SENTINEL = 'cw-boundary-probe-synthetic-not-a-credential';
const PROBE_TIMEOUT_MS = 20_000;
const isRecord = (v) => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
const within = (p, root) => p === root || p.startsWith(`${root}/`);
const overlaps = (a, b) => within(a, b) || within(b, a);
const probe = (name, outcome, reason = null) => ({ probe: name, outcome, reason });
const notRun = (reason) => BOUNDARY_PROBES.map((n) => probe(n, 'not-run', reason));
const text = (r) => `${r?.stdout ?? ''}`;

/**
 * Reduces probe records to the measured section evaluateBoundary reads. A probe counts only when its
 * record is well formed and unique; the positive read control is what evidences that the run happened,
 * and a denied egress counts only beside a network control that connected under the same harness.
 */
export function measuredFromProbes(probes) {
  if (!Array.isArray(probes)) return undefined;
  const seen = new Map();
  for (const p of probes) {
    if (!isRecord(p) || !BOUNDARY_PROBES.includes(p.probe) || !PROBE_OUTCOMES.includes(p.outcome)) continue;
    seen.set(p.probe, seen.has(p.probe) && seen.get(p.probe) !== p.outcome ? 'conflict' : p.outcome);
  }
  const at = (n) => seen.get(n);
  const out = {};
  if (at('permitted-read') === 'allowed') out.ran = true;
  else if (at('permitted-read') === 'denied') out.ran = false;
  const deny = (n) => (at(n) === 'denied' ? true : at(n) === 'allowed' ? false : undefined);
  if (deny('credential-read') !== undefined) out.credentialReadDenied = deny('credential-read');
  if (deny('write-escape') !== undefined) out.writeEscapeDenied = deny('write-escape');
  if (at('egress') === 'allowed') out.egressDenied = false;
  else if (at('egress') === 'denied' && at('network-control') === 'allowed') out.egressDenied = true;
  return out;
}

/** Whether the lane was kept from a loopback listener: true only beside a control that reached it, false when it connected. */
export function loopbackFromProbes(probes) {
  if (!Array.isArray(probes)) return undefined;
  const seen = new Map();
  for (const p of probes) {
    if (!isRecord(p) || !BOUNDARY_PROBES.includes(p.probe) || !PROBE_OUTCOMES.includes(p.outcome)) continue;
    seen.set(p.probe, seen.has(p.probe) && seen.get(p.probe) !== p.outcome ? 'conflict' : p.outcome);
  }
  if (seen.get('permitted-read') !== 'allowed') return undefined;
  if (seen.get('loopback') === 'allowed') return false;
  return seen.get('loopback') === 'denied' && seen.get('loopback-control') === 'allowed' ? true : undefined;
}

const markerOutcome = (r, ok, denied) => {
  if (!r || r.error) return ['error', !r ? 'no-result' : r.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn-error'];
  const out = text(r);
  if (out.includes(ok)) return ['allowed', null];
  if (out.includes(denied)) return ['denied', null];
  return ['error', 'no-marker'];
};

const credentialOutcome = (r) => {
  if (!r || r.error) return ['error', 'spawn-error'];
  const out = text(r);
  if (out.includes(SENTINEL)) return ['allowed', null];
  if (out.includes('CW-CRED-END')) return ['denied', null];
  return ['error', 'no-marker'];
};

const writeOutcome = (r, landed) => {
  if (landed) return ['allowed', null];
  if (!r || r.error) return ['error', 'spawn-error'];
  const out = text(r);
  if (out.includes('CW-WRITE-DENIED')) return ['denied', null];
  if (out.includes('CW-WRITE-OK')) return ['error', 'inconsistent'];
  return ['error', 'no-marker'];
};

// Connects to every target in CW_PROBE_TARGETS at once and prints one line per target as it settles.
const NET_JS = "const t=JSON.parse(process.env.CW_PROBE_TARGETS);let n=t.length;if(!n)process.exit(0);"
  + "for(const x of t){let over=false,tm=null;const s=require('net').connect(x.port,x.host);"
  + "const end=(r)=>{if(over)return;over=true;clearTimeout(tm);s.destroy();console.log('CW-NET '+x.name+' '+r);if(--n===0)process.exit(0)};"
  + "tm=setTimeout(()=>end('TIMEOUT'),x.wait);s.on('connect',()=>end('OK'));s.on('error',e=>end('ERR '+(e.code||e.name)))}";

// RFC 5737 documentation address: no host answers it, so the probe never depends on the internet.
export const EGRESS_PROBE_ADDRESS = '192.0.2.1';
const EGRESS_PROBE_PORT = 9;

/**
 * A connect probe's outcome. 'permission': seatbelt refuses a connect it denies with EPERM at once,
 * so any other result (connected, refused, unreachable, still waiting) is a connect the sandbox let
 * through. 'reach': only a completed connection counts as reached.
 */
const netOutcome = (r, name, mode) => {
  if (!r || r.error) return ['error', !r ? 'no-result' : r.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn-error'];
  const m = new RegExp(`^CW-NET ${name} (OK|TIMEOUT|ERR (\\S+))$`, 'm').exec(text(r));
  if (!m) return ['error', 'no-marker'];
  if (mode === 'permission') return m[2] === 'EPERM' || m[2] === 'EACCES' ? ['denied', null] : ['allowed', null];
  return m[1] === 'OK' ? ['allowed', null] : ['denied', null];
};

const HOST_PROBES = {
  'permitted-read': 'ls "$CW_PROBE_READ" >/dev/null 2>&1 && echo CW-READ-OK || echo CW-READ-DENIED',
  'credential-read': `set -f; IFS='\n'; for p in $CW_PROBE_CREDENTIALS; do cat "$p" 2>/dev/null; done; echo CW-CRED-END`,
  'write-escape': '(echo cw-escape > "$CW_PROBE_ESCAPE") 2>/dev/null && echo CW-WRITE-OK || echo CW-WRITE-DENIED',
  egress: '"$CW_PROBE_NODE" -e "$CW_PROBE_JS"',
};

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Process-wide cleanup: the shared listener is killed and any scratch still open is removed at exit.
const openScratch = new Set();
// Network controls already reached in this process, per spawn function; never written to disk.
let controlCache = new WeakMap();
let shared = null;
let exitHooked = false;
const hookExit = () => {
  if (exitHooked) return;
  exitHooked = true;
  process.once('exit', () => {
    closeLoopbackListener();
    for (const d of openScratch) { try { fsSync.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
};

// Marks the helper in a process list. It exits when its stdin closes, so it dies with the parent however
// the parent ends, and after thirty minutes regardless; a dead helper is replaced on the next call.
export const LISTENER_MARK = 'cw-boundary-listener';
const LISTENER_JS = "const f=process.argv[1];process.stdin.on('end',()=>process.exit(0));process.stdin.on('error',()=>process.exit(0));process.stdin.resume();"
  + 'setTimeout(()=>process.exit(0),1800000).unref();'
  + "const s=require('net').createServer(c=>c.destroy()).listen(0,'127.0.0.1',()=>{const t=f+'.'+process.pid;require('fs').writeFileSync(t,String(s.address().port));require('fs').renameSync(t,f)})";

// A child that exited stays a zombie until the event loop turns, so signal 0 cannot tell; its state can.
function helperAlive(pid, { fs = fsSync, spawn = spawnSync } = {}) {
  if (process.platform === 'linux') {
    try { return !/^\S+ \(.*\) [ZX]/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; }
  }
  const r = spawn('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.error) { try { process.kill(pid, 0); return true; } catch { return false; } }
  return r.status === 0 && !/^\s*Z/.test(r.stdout || '');
}

/**
 * One loopback listener per process, in a helper so a synchronous caller can probe egress without the
 * internet. It is reused by every measurement, so a loop that never yields leaves no zombie behind.
 * @returns {{port:number, pid:number}|null}
 */
export function loopbackListener({ execPath = process.execPath, spawn = spawnChild, fs = fsSync, waitMs = 15_000 } = {}) {
  if (shared && helperAlive(shared.pid, { fs })) return { port: shared.port, pid: shared.pid };
  if (shared) closeLoopbackListener();
  const base = scratchBase({ fs });
  if (!base || checkScratchBase(base, { fs })) return null;
  let dir;
  try { dir = fs.mkdtempSync(join(base, `.cw-listener-${process.pid}-`)); } catch { return null; }
  const file = join(dir, 'port');
  let child;
  try {
    child = spawn(execPath, ['-e', LISTENER_JS, file, LISTENER_MARK], { stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: process.env.PATH || '/usr/bin:/bin' } });
    child.unref();
    child.stdin?.unref?.();
    child.stdin?.on?.('error', () => {});
  } catch { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } return null; }
  hookExit();
  const until = Date.now() + waitMs;
  let port = null;
  while (Date.now() < until) {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { /* not written yet */ }
    if (/^\d+$/.test(raw) && Number(raw) > 0 && Number(raw) < 65536) { port = Number(raw); break; }
    sleepMs(10);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  if (port === null) { try { child.stdin?.destroy?.(); child.kill(); } catch { /* already gone */ } return null; }
  shared = { port, pid: child.pid, child };
  return { port, pid: child.pid };
}

/** Ends the shared helper; `kill: false` only closes its stdin, which alone must end it. */
export function closeLoopbackListener({ kill = true } = {}) {
  if (!shared) return;
  try { shared.child.stdin?.destroy?.(); } catch { /* already closed */ }
  if (kill) { try { shared.child.kill(); } catch { /* already gone */ } }
  shared = null;
}

const STALE_MS = 10 * 60_000;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Removes probe scratch left by a run that was interrupted: its pid is dead or it is older than ten minutes. */
export function sweepStaleScratch(base, { fs = fsSync, now = Date.now() } = {}) {
  let names = [];
  try { names = fs.readdirSync(base); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    const m = /^\.cw-(?:boundary|listener)-(\d+)-/.exec(n);
    if (!m) continue;
    const p = join(base, n);
    let old = false;
    try { old = now - fs.lstatSync(p).mtimeMs > STALE_MS; } catch { continue; }
    if (Number(m[1]) !== process.pid && (old || !alive(Number(m[1])))) {
      try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { /* another sweeper got it */ }
    } else if (old && Number(m[1]) === process.pid && !openScratch.has(p)) {
      try { fs.rmSync(p, { recursive: true, force: true }); removed++; } catch { /* best effort */ }
    }
  }
  return removed;
}

/**
 * Where probe scratch lives: a 0700 directory in the user's cache dir. No lane profile grants a write
 * there (lanes write the report dir, the temp dir, /tmp and their declared tool caches), so repository
 * code cannot plant or swap the fixture between the unconfined check and the confined probe.
 */
export function scratchBase({ fs = fsSync, home = homedir(), env = process.env, platform = process.platform } = {}) {
  if (typeof process.getuid !== 'function' || typeof home !== 'string' || !home.startsWith('/')) return null;
  const xdg = platform === 'linux' && typeof env.XDG_CACHE_HOME === 'string' && env.XDG_CACHE_HOME.startsWith('/') ? env.XDG_CACHE_HOME : null;
  const dir = join(xdg ?? join(home, '.cache'), 'commitwork', 'boundary');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return fs.realpathSync(dir); } catch { return null; }
}

/** Why a scratch base cannot be trusted, or null: a resolved path to a real directory, ours, 0700, with no link on the way. */
export function checkScratchBase(base, { fs = fsSync, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {}) {
  if (typeof base !== 'string' || !base.startsWith('/') || uid === null) return 'scratch-base-unsafe';
  let st; let real;
  try { st = fs.lstatSync(base); real = fs.realpathSync(base); } catch { return 'no-scratch'; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 'scratch-base-unsafe';
  if (st.uid !== uid || (st.mode & 0o077) !== 0) return 'scratch-base-unsafe';
  if (real !== base.replace(/\/+$/, '')) return 'scratch-base-unsafe';
  return null;
}

// The home-relative paths a declaration could use to reach a credential store, as `~/` paths.
const CREDENTIAL_PLACES = [...FORBIDDEN_CREDENTIAL_SEGMENTS.map((s) => (s === 'Keychains' ? '~/Library/Keychains' : `~/${s}`)), ...DECLARABLE_CREDENTIALS.map((s) => `~/${s}`)];
const tildeForm = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? (p.replace(/\/+$/, '') || '~') : null);
const touchesCredentials = (p) => { const t = tildeForm(p); return t !== null && CREDENTIAL_PLACES.some((c) => overlaps(t, c)); };

/**
 * The posture a probe run measures, and the key measurements are shared on. The five probes depend on
 * the platform, whether the class allows network (every networked class compiles to the same rule),
 * the process-wide toolchain reads, and the home-relative declarations that reach a credential store.
 * The repository, report dir, temp dir and home are fixtures; any other path only widens what the lane
 * may read or write inside its own roots and cannot change a probe, so it is left out of the key.
 */
export function probePosture(spec) {
  if (!isRecord(spec)) return null;
  const keep = (v) => (Array.isArray(v) ? [...new Set(v.filter(touchesCredentials).map(tildeForm))].sort() : []);
  const egress = spec.egress === 'none' || !EGRESS_CLASSES.includes(spec.egress) ? spec.egress : 'registry';
  return {
    platform: spec.platform, egress, cwRoot: spec.cwRoot, nodePrefix: spec.nodePrefix,
    developerDir: spec.developerDir ?? null, userCacheDir: spec.userCacheDir ?? null,
    extraReads: keep(spec.extraReads), extraWrites: keep(spec.extraWrites),
  };
}

/** Every path a host lane with this spec may write, expanded against its own home and repository. */
export function laneWriteRoots(spec, { fs = fsSync } = {}) {
  if (!isRecord(spec)) return [];
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const writes = (Array.isArray(spec.extraWrites) ? spec.extraWrites : []).map((p) => {
    try { return expandSandboxPath(p, { home: spec.home, repoPath: spec.repoPath, userCacheDir: spec.userCacheDir ?? null }); } catch { return null; }
  });
  return [spec.reportDir, spec.tmpDir, '/tmp', '/private/tmp', ...writes].filter((p) => typeof p === 'string' && p.startsWith('/'))
    .map((p) => p.replace(/\/+$/, '') || '/').flatMap((p) => [p, real(p)]);
}

/**
 * Runs the five probes for the lane's posture (probePosture) in a scratch fixture: a repository, a
 * report dir, a temp dir and a home holding synthetic credential files. The operator's stores and the
 * scanned repository are never touched. The base must be ours, 0700 and outside every write root of
 * the lane; each probe is preceded by an unconfined check that its target exists or is writable, and
 * followed by a check that the fixture is unchanged, so neither a planted fixture nor a missing one
 * can turn a leak into a denial.
 *
 * @returns {{adapter:'host-sandbox', probes:{probe:string, outcome:string, reason:string|null}[]}}
 */
export function measureHostEffects(spec, { spawn = spawnSync, fs = fsSync, base = scratchBase({ fs }), listen = loopbackListener, execPath = process.execPath, path = process.env.PATH } = {}) {
  const posture = probePosture(spec);
  if (!posture) return { adapter: 'host-sandbox', probes: notRun('malformed-spec') };
  if (!base) return { adapter: 'host-sandbox', probes: notRun('no-scratch') };
  const unsafe = checkScratchBase(base, { fs });
  if (unsafe) return { adapter: 'host-sandbox', probes: notRun(unsafe) };
  const baseReal = fs.realpathSync(base);
  if (laneWriteRoots(spec, { fs }).some((r) => within(baseReal, r) || within(base, r))) return { adapter: 'host-sandbox', probes: notRun('scratch-base-writable-by-lane') };
  sweepStaleScratch(base, { fs });
  let scratch;
  try { scratch = fs.realpathSync(fs.mkdtempSync(join(base, `.cw-boundary-${process.pid}-`))); } catch { return { adapter: 'host-sandbox', probes: notRun('no-scratch') }; }
  openScratch.add(scratch);
  hookExit();
  try {
    const at = (n) => join(scratch, n);
    const probeSpec = { ...posture, repoPath: at('repo'), reportDir: at('report'), tmpDir: at('tmp'), home: at('home'), toolPrefixes: [] };
    const outside = at('outside');
    const known = join(probeSpec.repoPath, 'known.txt');
    const credentials = [];
    let fixtureReady = true;
    try {
      for (const d of ['repo', 'report', 'tmp', 'home', 'outside']) fs.mkdirSync(at(d), { recursive: true });
      fs.writeFileSync(known, 'known');
      for (const seg of FORBIDDEN_CREDENTIAL_SEGMENTS) {
        const file = seg === '.netrc' ? join(probeSpec.home, seg)
          : seg === 'Keychains' ? join(probeSpec.home, 'Library', 'Keychains', 'cw-probe') : join(probeSpec.home, seg, 'cw-probe');
        fs.mkdirSync(join(file, '..'), { recursive: true });
        fs.writeFileSync(file, SENTINEL);
        credentials.push(file);
      }
    } catch { fixtureReady = false; }
    const regular = (p, content) => { try { const st = fs.lstatSync(p); return st.isFile() && fs.readFileSync(p, 'utf8') === content; } catch { return false; } };
    const realDir = (p) => { try { const st = fs.lstatSync(p); return st.isDirectory() && fs.realpathSync(p) === p; } catch { return false; } };
    const intact = () => checkScratchBase(base, { fs }) === null && realDir(scratch) && realDir(outside)
      && regular(known, 'known') && credentials.every((c) => regular(c, SENTINEL));
    if (!fixtureReady || !intact()) return { adapter: 'host-sandbox', probes: notRun('precondition-failed') };
    const escape = join(outside, 'escape');
    let escapeReady = true;
    try { fs.writeFileSync(join(outside, 'control'), 'x'); fs.rmSync(join(outside, 'control')); } catch { escapeReady = false; }
    const listener = listen({ execPath, fs });
    const env = {
      PATH: path || '/usr/bin:/bin', HOME: probeSpec.home, CW_PROBE_READ: probeSpec.repoPath, CW_PROBE_CREDENTIALS: credentials.join('\n'),
      CW_PROBE_ESCAPE: escape, CW_PROBE_NODE: execPath, CW_PROBE_JS: NET_JS,
    };
    const run = (cmd, over = {}, extraEnv = null) => {
      let argv;
      try { argv = hostSandboxArgv({ ...probeSpec, ...over, cmd }).argv; } catch { return { error: { code: 'wrapper-refused' } }; }
      try {
        return spawn(argv[0], argv.slice(1), { encoding: 'utf8', env: extraEnv ? { ...env, ...extraEnv } : env, cwd: probeSpec.repoPath, timeout: PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { return { error: { code: e.code || 'spawn-threw' } }; }
    };
    const refused = (r) => r && r.error && r.error.code === 'wrapper-refused';
    const result = (name, r, [outcome, reason]) => (refused(r) ? probe(name, 'error', 'wrapper-refused')
      : !intact() ? probe(name, 'error', 'fixture-changed') : probe(name, outcome, reason));
    const probes = [];
    let r = run(HOST_PROBES['permitted-read']);
    probes.push(result('permitted-read', r, markerOutcome(r, 'CW-READ-OK', 'CW-READ-DENIED')));
    r = run(HOST_PROBES['credential-read']);
    probes.push(result('credential-read', r, credentialOutcome(r)));
    if (escapeReady && !fs.existsSync(escape)) {
      r = run(HOST_PROBES['write-escape']);
      probes.push(result('write-escape', r, writeOutcome(r, fs.existsSync(escape))));
    } else probes.push(probe('write-escape', 'not-run', 'precondition-failed'));
    // Egress: on macOS a connect to a non-local IPv4 address, judged by whether seatbelt refused it;
    // on Linux bwrap gives no such signal, so reaching a listener in the host network namespace.
    // Its control is the same posture with a networked class. Loopback: the shared listener, whose
    // control on macOS is a target posture naming the listener's port, the one loopback allowance.
    // The controls depend on the platform, the toolchain and the listener, never on the lane, so a
    // process measures them once; only a control that reached its target is kept for reuse.
    const darwin = posture.platform === 'darwin';
    const lb = listener ? { host: '127.0.0.1', port: listener.port, wait: 3000 } : null;
    const egressTarget = darwin ? { host: EGRESS_PROBE_ADDRESS, port: EGRESS_PROBE_PORT, wait: 500 } : lb;
    const egressMode = darwin ? 'permission' : 'reach';
    const networked = { egress: 'registry' };
    const netRun = (over, entries) => {
      const live = entries.filter(([, t]) => t);
      if (!live.length) return {};
      const rr = run(HOST_PROBES.egress, over, { CW_PROBE_TARGETS: JSON.stringify(live.map(([name, t]) => ({ name, ...t }))) });
      return Object.fromEntries(live.map(([name, , mode]) => [name, result(name, rr, netOutcome(rr, name, mode))]));
    };
    const settled = { ...netRun({}, [['egress', egressTarget, egressMode], ['loopback', lb, 'reach']]) };
    const controlKey = JSON.stringify([posture.platform, posture.cwRoot, posture.nodePrefix, posture.developerDir, posture.userCacheDir, egressTarget, lb]);
    const cache = controlCache.get(spawn) ?? new Map();
    controlCache.set(spawn, cache);
    let controls = cache.get(controlKey);
    if (!controls) {
      // Controls under the same posture share one run.
      const groups = new Map();
      for (const [name, over, t, mode] of [['network-control', networked, egressTarget, egressMode],
        ['loopback-control', darwin && listener ? { egress: 'target', loopbackPorts: [listener.port] } : networked, lb, 'reach']]) {
        const k = JSON.stringify(over);
        if (!groups.has(k)) groups.set(k, { over, entries: [] });
        groups.get(k).entries.push([name, t, mode]);
      }
      controls = Object.assign({}, ...[...groups.values()].map((g) => netRun(g.over, g.entries)));
      if (Object.keys(controls).length === 2 && Object.values(controls).every((p) => p.outcome === 'allowed')) cache.set(controlKey, controls);
    }
    Object.assign(settled, controls);
    for (const name of ['egress', 'network-control', 'loopback', 'loopback-control']) probes.push(settled[name] ?? probe(name, 'not-run', 'no-listener'));
    return { adapter: 'host-sandbox', probes };
  } finally {
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
    openScratch.delete(scratch);
  }
}

function repoCodeOf(check, buildsTree) {
  const d = check.executesRepoCode;
  if (buildsTree === true) return { value: true, basis: d === true ? 'declared' : d === false ? 'contradicted-by-command' : 'command-builds-tree' };
  if (typeof d === 'boolean') return { value: d, basis: 'declared' };
  return { value: null, basis: 'undeclared' };
}

// Per-run and per-machine prefixes become tokens in the output, so a lane's record is the same on
// every run. Applied after evaluation: forbidden roots are judged on the absolute paths.
function relativizer(spec, home) {
  const strip = (p) => p.replace(/\/+$/, '') || '/';
  const anchors = [['@repo', spec.repoPath], ['@report', spec.reportDir], ['@tmp', spec.tmpDir]]
    .filter(([, p]) => typeof p === 'string' && p.startsWith('/') && strip(p) !== '/')
    .map(([t, p]) => [t, strip(p)])
    .sort((a, b) => b[1].length - a[1].length);
  return (p) => {
    if (typeof p !== 'string') return p;
    for (const [token, root] of anchors) if (within(p, root)) return `/${token}${p.slice(root.length)}`;
    if (home && within(p, home)) return `~${p.slice(home.length)}`;
    return p;
  };
}

function hostDeclared(spec, executesRepoCode) {
  if (!isRecord(spec)) return { declared: { executesRepoCode }, rel: null };
  const home = typeof spec.home === 'string' && spec.home.startsWith('/') ? spec.home.replace(/\/+$/, '') : '';
  const expand = (p) => { try { return expandSandboxPath(p, { home, repoPath: spec.repoPath, userCacheDir: spec.userCacheDir ?? null }); } catch { return p; } };
  const list = (v) => (Array.isArray(v) ? v : []);
  const writes = list(spec.extraWrites).map(expand);
  const readRoots = [spec.repoPath, spec.reportDir, spec.tmpDir, spec.cwRoot, spec.nodePrefix, spec.developerDir,
    ...list(spec.toolPrefixes).map(expand), ...list(spec.extraReads).map(expand), ...writes].filter((p) => p !== null && p !== undefined);
  const writeRoots = [spec.reportDir, spec.tmpDir, '/tmp', ...writes];
  const network = spec.egress === 'none' ? 'none' : EGRESS_CLASSES.includes(spec.egress) ? 'open' : spec.egress;
  // The declarable stores are masked or unreadable unless a declared read reaches them; those reached are mounted.
  const credentialsMounted = home
    ? DECLARABLE_CREDENTIALS.filter((s) => readRoots.some((r) => typeof r === 'string' && overlaps(`${home}/${s}`, r))).map((s) => `~/${s}`)
    : null;
  const ports = Array.isArray(spec.loopbackPorts) ? spec.loopbackPorts : [];
  // What the profile builder grants a lane on loopback, by platform and class.
  const loopback = network === 'none' ? 'none' : spec.platform !== 'darwin' ? 'not-filtered' : ports.length ? 'target-ports-only' : 'denied';
  return { declared: { executesRepoCode, network, readRoots, writeRoots, credentialsMounted }, rel: relativizer(spec, home), loopback };
}

function containerDeclared(p, executesRepoCode) {
  return {
    executesRepoCode: p.allowSourceMount ? executesRepoCode : false,
    network: p.network === 'none' ? 'none' : p.requiresEgressProxy ? 'restricted' : 'open',
    credentialsMounted: [],
  };
}

const phaseOf = (executesRepoCode, posture) => {
  if (posture && !posture.allowSourceMount) return posture.network === 'none' ? 'read' : 'warm';
  return executesRepoCode === true ? 'execute' : executesRepoCode === false ? 'read' : null;
};

const READABLE_CREDENTIALS = { kind: 'repo-code-with-readable-credentials', source: 'declared', field: 'declared.credentialsMounted' };
const REACHES_LOOPBACK = { kind: 'repo-code-reaches-loopback', source: 'measured', field: 'measured.loopbackDenied' };

function threatsOf(b, phase, loopbackDeclared) {
  const control = (name) => b.controls.find((c) => c.control === name);
  const has = (...kinds) => b.violations.some((v) => kinds.includes(v.kind));
  const status = (name, violation) => {
    const c = control(name);
    if (has(violation)) return 'exposed';
    if (c.required === false) return 'accepted';
    return c.outcome === 'denied' && b.measured.ran === true ? 'mitigated' : 'unmeasured';
  };
  const cm = b.declared.credentialsMounted;
  const credDeclared = cm === true ? 'unbounded' : Array.isArray(cm) ? (cm.length ? 'declarable-stores-readable' : 'none-mounted') : 'unknown';
  let credential = has('forbidden-credential-mount', 'credential-read', READABLE_CREDENTIALS.kind) ? 'exposed' : status('credential-read', 'credential-read');
  if (credential === 'mitigated' && credDeclared === 'declarable-stores-readable') credential = 'accepted';
  const exec = b.declared.executesRepoCode;
  let separation;
  if (phase === 'warm' || exec === false) separation = 'not-applicable';
  else if (exec !== true) separation = 'unmeasured';
  else if (has('repo-code-with-open-egress', 'egress-not-denied')) separation = 'exposed';
  else separation = status('egress', 'egress-not-denied');
  return [
    { threat: 'credential-theft', control: 'credential-read', declared: credDeclared, measured: control('credential-read').outcome, status: credential },
    { threat: 'write-outside-roots', control: 'write-escape', declared: b.declared.writeRoots ? 'bounded' : 'unknown', measured: control('write-escape').outcome, status: status('write-escape', 'write-escape') },
    { threat: 'exfiltration', control: 'egress', declared: b.declared.network ?? 'unknown', measured: control('egress').outcome, status: status('egress', 'egress-not-denied') },
    { threat: 'repo-code-with-network', control: 'phase-separation', declared: phase ?? 'unknown', measured: control('egress').outcome, status: separation },
    { threat: 'local-service-reach', control: 'loopback', declared: loopbackDeclared ?? 'unknown',
      measured: b.measured.loopbackDenied === true ? 'denied' : b.measured.loopbackDenied === false ? 'not-denied' : 'unknown',
      status: has(REACHES_LOOPBACK.kind) ? 'exposed' : b.measured.loopbackDenied === true ? 'mitigated' : b.measured.loopbackDenied === false ? 'accepted' : 'unmeasured' },
  ];
}

const worst = (states) => (states.includes('finding') ? 'finding' : states.length && states.every((s) => s === 'pass') ? 'pass' : 'unmeasured');

/**
 * The per-command threat model for one lane: each command's declaration (from the check and the
 * enforcement adapter that wraps it), the measured effects (derived here from probe records, never
 * taken as supplied), evaluateBoundary's verdict, and the threats that verdict covers. Pure.
 * Raw command text never appears; evaluateBoundary reduces it to a scanner label and a digest.
 * findingSource says whether a finding rests on a measured breach or on the declaration alone.
 *
 * @param {{check:object, adapter:'host-sandbox'|'container'|null, spec?:object|null,
 *   effects?:{probes:object[]}|{byPosture:Object<string,{probes:object[]}>}|null, buildsTree?:boolean}} input
 */
export function threatModel(input) {
  const base = { schemaVersion: 1, check: null, scanner: null, adapter: null, executesRepoCode: null, executesRepoCodeBasis: 'undeclared', probes: [] };
  const empty = { findingSource: null, commands: [] };
  if (!isRecord(input) || !isRecord(input.check) || typeof input.check.id !== 'string' || !input.check.id) {
    return { ...base, state: 'unmeasured', reason: 'malformed-input', ...empty };
  }
  const { check, spec = null, effects = null, buildsTree = false } = input;
  const adapter = input.adapter ?? null;
  const tools = Array.isArray(check.requires?.tools) ? check.requires.tools : [];
  const head = { ...base, check: check.id, scanner: tools.find((t) => SCANNER_LABELS.includes(t)) ?? null };
  if (adapter !== null && !BOUNDARY_ADAPTERS.includes(adapter)) return { ...head, state: 'unmeasured', reason: 'malformed-input', ...empty };
  const repo = repoCodeOf(check, buildsTree);
  Object.assign(head, { adapter, executesRepoCode: repo.value, executesRepoCodeBasis: repo.basis });
  const cmds = Array.isArray(check.local) ? check.local : [];
  if (!cmds.length) return { ...head, state: 'unmeasured', reason: 'no-commands', ...empty };

  const entry = (cmd, posture, declared, probes, rel = null, loopbackDeclared = null) => {
    const b = evaluateBoundary({ command: cmd, declared, measured: probes ? measuredFromProbes(probes) : undefined });
    const lb = probes ? loopbackFromProbes(probes) : undefined;
    b.measured = { ...b.measured, loopbackDenied: lb ?? null };
    if (lb === false && b.declared.executesRepoCode === true) {
      b.violations = [...b.violations, REACHES_LOOPBACK];
      b.state = 'finding';
      b.reason = 'violations-found';
    }
    if (rel) {
      for (const k of ['readRoots', 'writeRoots']) if (Array.isArray(b.declared[k])) b.declared[k] = [...new Set(b.declared[k].map(rel))].sort();
      b.violations = b.violations.map((v) => (typeof v.path === 'string' ? { ...v, path: rel(v.path) } : v));
    }
    if (b.declared.executesRepoCode === true && Array.isArray(b.declared.credentialsMounted) && b.declared.credentialsMounted.length) {
      b.violations = [...b.violations, READABLE_CREDENTIALS];
      b.state = 'finding';
      b.reason = 'violations-found';
    }
    const phase = phaseOf(declared.executesRepoCode ?? null, posture ? POSTURES[posture] : null);
    return { command: b.command, posture, phase, state: b.state, reason: b.reason, declarationRejected: b.declarationRejected,
      declared: b.declared, measured: b.measured, controls: b.controls, violations: b.violations, unknowns: b.unknowns, threats: threatsOf(b, phase, loopbackDeclared) };
  };

  const commands = [];
  let probes = [];
  if (adapter === 'host-sandbox') {
    probes = isRecord(effects) && Array.isArray(effects.probes) ? effects.probes : null;
    const { declared, rel, loopback } = hostDeclared(spec, repo.value);
    for (const cmd of cmds) commands.push(entry(cmd, null, declared, probes, rel, loopback));
  } else if (adapter === 'container') {
    const byPosture = isRecord(effects) && isRecord(effects.byPosture) ? effects.byPosture : {};
    for (const cmd of cmds) {
      const named = typeof cmd === 'string' ? [...new Set([...cmd.matchAll(/--posture\s+([a-z-]+)/g)].map((m) => m[1]))] : [];
      if (!named.length) { commands.push(entry(cmd, null, { executesRepoCode: repo.value }, null)); continue; }
      for (const n of named) {
        if (!Object.hasOwn(POSTURES, n)) { commands.push(entry(cmd, null, { executesRepoCode: repo.value }, null)); continue; }
        const measured = Object.hasOwn(byPosture, n) && isRecord(byPosture[n]) && Array.isArray(byPosture[n].probes) ? byPosture[n].probes : null;
        commands.push(entry(cmd, n, containerDeclared(POSTURES[n], repo.value), measured));
      }
    }
  } else {
    for (const cmd of cmds) commands.push(entry(cmd, null, { executesRepoCode: repo.value }, null));
  }
  const state = worst(commands.map((c) => c.state));
  const reason = adapter === null ? 'no-enforcement-adapter'
    : state === 'finding' ? 'violations-found' : state === 'pass' ? 'required-controls-held' : 'evidence-incomplete';
  const findingSource = state !== 'finding' ? null
    : commands.some((c) => c.violations.some((v) => v.source === 'measured')) ? 'measured' : 'declared';
  const probeSummary = (probes || []).filter((p) => isRecord(p) && BOUNDARY_PROBES.includes(p.probe))
    .map((p) => ({ probe: p.probe, outcome: PROBE_OUTCOMES.includes(p.outcome) ? p.outcome : 'error', reason: typeof p.reason === 'string' ? p.reason : null }));
  return { ...head, probes: probeSummary, state, reason, findingSource, commands };
}

const measuredPostures = new Map();
export function resetBoundaryProbes() { measuredPostures.clear(); controlCache = new WeakMap(); }

/**
 * The runner's entry: the threat model for a lane given the sandbox decision it ran under. Host
 * sandbox effects are measured once per distinct posture (probePosture) per process; a container lane
 * carries its posture declarations unmeasured; a lane with no enforcement adapter is unmeasured.
 * Never throws.
 */
export function laneBoundary(check, sb, { container = false, buildsTree = false, measure = measureHostEffects } = {}) {
  try {
    const spec = sb && isRecord(sb.wrap) ? sb.wrap : null;
    const adapter = container ? 'container' : spec ? 'host-sandbox' : null;
    let effects = null;
    if (adapter === 'host-sandbox') {
      const key = JSON.stringify(probePosture(spec));
      if (!measuredPostures.has(key)) measuredPostures.set(key, measure(spec));
      effects = measuredPostures.get(key);
    }
    return threatModel({ check, adapter, spec: adapter === 'host-sandbox' ? spec : null, effects, buildsTree });
  } catch {
    return { schemaVersion: 1, check: typeof check?.id === 'string' ? check.id : null, scanner: null, adapter: null,
      executesRepoCode: null, executesRepoCodeBasis: 'undeclared', probes: [], state: 'unmeasured', reason: 'boundary-error', findingSource: null, commands: [] };
  }
}

/**
 * scan.json form: each distinct model once at the top level, keyed by the digest of its JSON; a cell
 * keeps the reference with its state and findingSource. checks-status rows stay self-contained.
 */
export function compactBoundaries(repos) {
  const boundaries = new Map();
  const out = (Array.isArray(repos) ? repos : []).map((r) => ({
    ...r,
    cells: Object.fromEntries(Object.entries(isRecord(r?.cells) ? r.cells : {}).map(([id, c]) => {
      if (!isRecord(c) || !isRecord(c.boundary)) return [id, c];
      const ref = `sha256:${createHash('sha256').update(JSON.stringify(c.boundary)).digest('hex')}`;
      boundaries.set(ref, c.boundary);
      return [id, { ...c, boundary: { ref, state: c.boundary.state, findingSource: c.boundary.findingSource ?? null } }];
    })),
  }));
  return { boundaries: Object.fromEntries([...boundaries.keys()].sort().map((k) => [k, boundaries.get(k)])), repos: out };
}
