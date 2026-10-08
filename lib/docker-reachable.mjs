// lib/docker-reachable.mjs — is the docker daemon answering, asked once per minute rather than per process.
//
// A wedged daemon blocks `docker info` until the probe's 10s bound. Every commitwork process paid
// that separately, and the suite spawns commitwork dozens of times: cra.test.mjs took 150s against a
// wedged daemon and 49s against a docker that failed at once (measured 2026-09-15), and full gate
// runs overran their 1800s timeout on it. So the answer is shared between processes for a short TTL.
//
// The cache is keyed by the docker binary PATH resolves to and the daemon it would address, so a
// test that puts a fake docker first on PATH is never answered from the real one's result.
// It is a cache, not a record: an unreadable or malformed entry means probe again, never an answer.
// env, read at call time: CW_DOCKER_PROBE_CACHE, CW_DOCKER_PROBE_TTL_MS, PATH, DOCKER_HOST, DOCKER_CONTEXT

import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, delimiter } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { writeAtomic } from '../monitor/lockfile.mjs';

const PROBE_TIMEOUT_MS = 10_000;

export function resolveDocker(env = process.env) {
  for (const dir of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    const p = join(dir, 'docker');
    try { if (existsSync(p) && statSync(p).isFile()) return p; } catch { /* unreadable dir entry is not docker */ }
  }
  return null;
}

const cachePath = (env) => env.CW_DOCKER_PROBE_CACHE || join(tmpdir(), `cw-docker-reachable-${userInfo().uid}.json`);
const ttl = (env) => { const n = Number(env.CW_DOCKER_PROBE_TTL_MS); return Number.isFinite(n) && n >= 0 ? n : 60_000; };

function defaultProbe(bin, env) {
  return spawnSync(bin, ['info'], { stdio: 'ignore', timeout: PROBE_TIMEOUT_MS, env }).status === 0;
}

/** -> true when `docker info` answered successfully within the bound, now or within the TTL. */
export function dockerReachable({ env = process.env, now = Date.now(), probe = defaultProbe } = {}) {
  const bin = resolveDocker(env);
  if (!bin) return false;
  const key = createHash('sha256').update(JSON.stringify([bin, env.DOCKER_HOST || '', env.DOCKER_CONTEXT || ''])).digest('hex').slice(0, 16);
  const path = cachePath(env);
  let entries = {};
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) entries = doc;
  } catch { entries = {}; }
  const hit = entries[key];
  if (hit && typeof hit.up === 'boolean' && Number.isFinite(hit.at) && now - hit.at >= 0 && now - hit.at < ttl(env)) return hit.up;

  const up = probe(bin, env);
  try { writeAtomic(path, JSON.stringify({ ...entries, [key]: { at: now, up } })); } catch { /* a cache that cannot be written costs the next process a probe */ }
  return up;
}
