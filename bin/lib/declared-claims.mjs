// Declared file claims, read from the spine's own store — the "declared before inferred" half of
// registry WP1 (b) / class C9.
//
// The touch ledger INFERS ownership from contact; the spine RECORDS it, because a session that
// calls claim_files has said in so many words which paths it is working on. That statement
// outranks any inference, so gates read it first and fall back to the ledger, and every claim they
// print says which basis produced it.
//
// READ-ONLY, THROUGH THE sqlite3 CLI, ZERO DEPENDENCIES. The store is ~/.substrate/tasks.db
// (SUBSTRATE_TASKS_DB overrides — the same seam the server honours). `-readonly` so a gate can
// never write it, and a query that cannot run returns NULL, never []: "no claims" and "could not
// look" are different facts, and the second must not read as the first (fail closed, house rule).
//
// A claim is LIVE while released_at is null. The spine reaps claims whose task has ended, but the
// documented claim-lifetime gap (b51bdb0) means an unreaped claim from a dead session can outrank a
// live ledger row — so a caller printing "declared" prints the claim's age beside it, and treats a
// claim older than `staleAfterMs` as stale rather than as authority.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { spineStorePath } from '../../lib/spine-store-path.mjs';

export const tasksDb = spineStorePath;
const staleAfterMs = () => Number(process.env.CW_CLAIM_STALE_MS) || 24 * 60 * 60 * 1000;

/**
 * Live claims, or null when they could not be read.
 * @returns {Array<{path, planId, taskId, claimedAt, note}> | null}
 */
export function readDeclaredClaims({ db = tasksDb(), sqlite = 'sqlite3' } = {}) {
  if (!existsSync(db)) return null;
  const r = spawnSync(sqlite, ['-readonly', '-json', db,
    'select path, plan_id as planId, task_id as taskId, claimed_at as claimedAt, note from file_claims where released_at is null'],
  { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  if (!out) return [];
  try {
    const rows = JSON.parse(out);
    return Array.isArray(rows) ? rows : null;
  } catch { return null; }
}

/**
 * Index live claims by path, with freshness. `claims === null` (unmeasured) yields `measured:false`
 * and an empty map, and a caller must say so rather than print "no declared claims".
 */
export function declaredIndex(claims, { now = Date.now(), stale = staleAfterMs() } = {}) {
  const byPath = new Map();
  if (claims === null) return { measured: false, byPath };
  for (const c of claims) {
    const at = Date.parse(c.claimedAt);
    const ageMs = Number.isFinite(at) ? now - at : null;
    const entry = { ...c, ageMs, fresh: ageMs !== null && ageMs >= 0 && ageMs <= stale };
    if (!byPath.has(c.path)) byPath.set(c.path, []);
    byPath.get(c.path).push(entry);
  }
  return { measured: true, byPath };
}
