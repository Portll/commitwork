// monitor/containers.mjs — a container the runner started is a container the runner can stop.
//
// `docker run` is a CLIENT: killing the `sh -c` that launched it leaves the container running on
// the daemon with the source mounted and the report dir writable. A timed-out lane therefore
// needs a name it can kill BY, not a pid. Names are deterministic — cw-<slice>-<repo>-<check> —
// so the runner kills on timeout, kills before a retry, and the sweep preamble reaps whatever an
// earlier slice left behind. The manifest commands and lane scripts take the name from
// CW_CONTAINER_NAME and may suffix it (-warm, -scan) — the kill is a prefix match.
//
// A CLI run's containers are cw-cli-*, a slice no sweep counts as live, so the name alone made a
// running `commitwork scan` look orphaned to a sweep's preamble. Each CLI process therefore stamps
// its containers with OWNER_LABEL = <pid>.<start ms>, and the reaper spares a container whose owner
// is provably the same live process. Pid AND start, as in bin/lib/single-flight.mjs: pids wrap.
import { spawnSync } from 'node:child_process';
import { processState } from '../lib/pid-alive.mjs';

// CW_DOCKER read at CALL time so tests can point it at a fake (CLAUDE.md: never at module load).
const dockerBin = () => process.env.CW_DOCKER || 'docker';
const safe = (s) => String(s == null ? '' : s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);

function run(args, timeoutMs = 30_000) {
  const r = spawnSync(dockerBin(), args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') return { ok: false, absent: true, out: '' };
  return { ok: r.status === 0, status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

export const OWNER_LABEL = 'cw.owner';
export const OWNER_RE = /^([1-9]\d*)\.(\d+)$/;

/** <pid>.<start epoch ms> for a process. The default is this process, from its own clock. */
export const ownerToken = (pid = process.pid, startMs = Date.now() - Math.round(process.uptime() * 1000)) => `${pid}.${startMs}`;
let self = null;
/** This process's token, minted once: two readings of the uptime clock can differ by a millisecond. */
export const selfOwner = () => (self ||= ownerToken());

export function parseOwner(token) {
  const m = OWNER_RE.exec(String(token ?? ''));
  return m && Number.isSafeInteger(Number(m[1])) ? { pid: Number(m[1]), startMs: Number(m[2]) } : null;
}

// exists: true | false (only ESRCH) | null. startedAt: epoch seconds from ps, or null.
export const procIo = {
  exists: (pid) => {
    // A zombie exists but has exited; where nothing reaps it, kill(0) alone reads it alive forever.
    try { process.kill(pid, 0); return processState(pid) !== 'Z'; }
    catch (e) { return e && e.code === 'EPERM' ? true : e && e.code === 'ESRCH' ? false : null; }
  },
  // ps prints LOCAL time and Date.parse reads it as local, so the epoch is right in any TZ.
  startedAt: (pid) => {
    const r = spawnSync(process.env.CW_PS || 'ps', ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } });
    const t = r.status === 0 ? Date.parse(String(r.stdout || '').trim()) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  },
};

/**
 * 'alive' | 'dead' | 'undetermined'. Dead needs proof: the pid is gone (ESRCH) or it now belongs to
 * a process that started more than a second away from the token (single-flight's tolerance).
 * Anything unreadable is undetermined, and the reaper spares it.
 */
export function ownerState(token, io = procIo) {
  const o = parseOwner(token);
  if (!o) return 'undetermined';
  const exists = io.exists(o.pid);
  if (exists === false) return 'dead';
  if (exists !== true) return 'undetermined';
  const started = io.startedAt(o.pid);
  if (started == null) return 'undetermined';
  return sameStart(o.startMs, started) ? 'alive' : 'dead';
}

const sameStart = (startMs, startSec) => Math.abs(Math.floor(startMs / 1000) - startSec) <= 1;

/** [{name, owner}] for every cw-* container, or null when docker could not be read. */
function listOwners(docker) {
  const r = docker(['ps', '-a', '--filter', 'name=^cw-', '--format', `{{.Names}}\t{{.Label "${OWNER_LABEL}"}}`]);
  if (!r.ok) return null;
  return r.out.split('\n').map((l) => l.trim().split('\t'))
    .filter(([n]) => n && n.startsWith('cw-')).map(([name, owner]) => ({ name, owner: (owner || '').trim() }));
}

/**
 * Remove the containers ONE process started: its pid, and a start within a second of `startSec`
 * (read from ps while it was alive). A stopped scan-path job uses this, never a cw-cli-* prefix,
 * which would take a terminal scan's containers with it. `unread` when docker could not be listed.
 */
export function killOwned({ pid, startSec }, { docker = run } = {}) {
  const all = listOwners(docker);
  if (!all) return { names: [], killed: [], failed: [], unread: true };
  const names = all.filter(({ owner }) => { const o = parseOwner(owner); return o && o.pid === pid && sameStart(o.startMs, startSec); })
    .map((c) => c.name);
  const killed = [], failed = [];
  for (const n of names) (docker(['rm', '-f', n]).ok ? killed : failed).push(n);
  return { names, killed, failed, unread: false };
}

/** cw-<slice>-<repo>-<check>; slice defaults to `cli` outside a sweep. */
export function containerName(check, { slice, repo } = {}) {
  return `cw-${safe(slice || process.env.CW_SLICE || 'cli')}-${safe(repo || process.env.CW_REPO_SLUG || 'repo')}-${safe(check)}`;
}

/** Names of containers (running OR exited — a stopped one still owns its name) under `prefix`. [] when docker is absent/down. */
export function listByPrefix(prefix) {
  const r = run(['ps', '-a', '--filter', `name=^${prefix}`, '--format', '{{.Names}}']);
  if (!r.ok) return [];
  return r.out.split('\n').map((s) => s.trim()).filter((n) => n.startsWith(prefix));
}

/** Kill AND remove every container under `prefix` (`rm -f`): a stopped leftover would make the next `--name` refuse. */
export function killByPrefix(prefix) {
  const names = listByPrefix(prefix);
  const killed = [], failed = [];
  for (const n of names) (run(['rm', '-f', n]).ok ? killed : failed).push(n);
  return { names, killed, failed };
}

/**
 * Sweep preamble: remove cw-* containers belonging to no LIVE slice and no live owner. Several
 * areas sweep concurrently under different slice ids, so "not mine" is not "orphan": the caller
 * passes every slice whose inflight marker names a running pid. Outside those slices a container is
 * removed only when it has no owner label or its owner is proven dead; an owner that cannot be
 * checked is left alone and reported as undetermined.
 */
export function reapOrphans(liveSlices, { docker = run, proc = procIo } = {}) {
  const keep = [...new Set((liveSlices || []).filter(Boolean))].map((s) => `cw-${safe(s)}-`);
  const all = listOwners(docker) || [];
  const states = new Map();
  const orphans = [], spared = [], undetermined = [];
  for (const { name, owner } of all) {
    if (keep.some((k) => name.startsWith(k))) continue;
    if (!owner) { orphans.push(name); continue; }
    if (!states.has(owner)) states.set(owner, ownerState(owner, proc));
    ({ dead: orphans, alive: spared, undetermined })[states.get(owner)].push(name);
  }
  const killed = [], failed = [];
  for (const n of orphans) (docker(['rm', '-f', n]).ok ? killed : failed).push(n);
  return { seen: all.length, live: keep.length, orphans, killed, failed, spared, undetermined };
}
