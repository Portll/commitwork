// commitwork — one vulnerability-database update per scanner at a time, and none while the last is fresh.
//
// Every sweep runs `scanner-preflight --update`, and sweeps overlap. Concurrent `grype db update`
// runs, and runs killed at their timeout on a contended host, each leave a grype-db-download*
// staging copy in grype's cache; left alone, they once filled a scan host's disk with 67 GB.
// The lock is a directory (mkdir is atomic) holding the updater's pid; a dead holder's lock is
// reclaimed. The holder clears staging copies older than an hour, which no live update can own.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOUR = 3600_000;

export const updateDir = (env = process.env) => env.CW_DB_UPDATE_DIR || join(homedir(), '.commitwork', 'db-updates');
export const freshMs = (env = process.env) => Number(env.CW_DB_FRESH_HOURS ?? 6) * HOUR;

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/**
 * Runs `update()` (a spawnSync-shaped result) unless another process holds this scanner's lock or the
 * last success is fresh. Returns { ran, why?, status? }.
 */
export function updateOnce(id, update, { dir = updateDir(), fresh = freshMs(), now = Date.now(), alive = pidAlive, after = null } = {}) {
  mkdirSync(dir, { recursive: true });
  const stamp = join(dir, `${id}.ok`);
  const last = existsSync(stamp) ? Date.parse(readFileSync(stamp, 'utf8').trim()) : NaN;
  if (now - last < fresh) return { ran: false, why: `updated ${Math.round((now - last) / 60000)} min ago` };
  const lock = join(dir, `${id}.lock`);
  for (let attempt = 0; ; attempt++) {
    try {
      mkdirSync(lock);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = Number(existsSync(join(lock, 'pid')) ? readFileSync(join(lock, 'pid'), 'utf8') : NaN);
      if (attempt === 0 && !(holder && alive(holder))) { rmSync(lock, { recursive: true, force: true }); continue; }
      return { ran: false, why: `another update holds the lock${holder ? ` (pid ${holder})` : ''}` };
    }
  }
  try {
    writeFileSync(join(lock, 'pid'), String(process.pid));
    const r = update();
    if (r.status === 0) writeFileSync(stamp, new Date(now).toISOString());
    if (after) after({ now });
    return { ran: true, status: r.status };
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function grypeCacheDir(env = process.env, platform = process.platform) {
  if (env.GRYPE_DB_CACHE_DIR) return env.GRYPE_DB_CACHE_DIR;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'grype', 'db');
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'grype', 'db');
}

/** Removes grype-db-download* staging copies older than an hour; returns the names removed. */
export function clearGrypeStaging({ cacheDir = grypeCacheDir(), now = Date.now() } = {}) {
  if (!existsSync(cacheDir)) return [];
  const gone = [];
  for (const name of readdirSync(cacheDir)) {
    if (!name.startsWith('grype-db-download')) continue;
    const p = join(cacheDir, name);
    if (now - statSync(p).mtimeMs < HOUR) continue;
    rmSync(p, { recursive: true, force: true });
    gone.push(name);
  }
  return gone;
}
