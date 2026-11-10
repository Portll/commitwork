// Runners this dispatcher mints are named cw-<slot>-<job>-<minted epoch seconds>. GitHub's runner
// list carries no creation time, so the name does. A runner with any other name is never touched.

const NAME_RE = /^cw-([a-z0-9][a-z0-9-]*)-(\d+)-(\d+)$/;

/** The name a mint gives its runner. */
export const runnerName = (slotId, jobId, nowMs) => `cw-${slotId}-${jobId}-${Math.floor(nowMs / 1000)}`;

/** { slotId, jobId, mintedSec } for a dispatcher-minted name, else null. */
export function parseRunnerName(name) {
  const m = NAME_RE.exec(String(name));
  return m ? { slotId: m[1], jobId: Number(m[2]), mintedSec: Number(m[3]) } : null;
}

/**
 * Split this dispatcher's idle runners into stale (older than staleRunnerSec: delete) and pending
 * (minted, still within the timeout: each will take one queued job). A busy runner is neither; an
 * ephemeral runner deregisters after its job, so an idle one in the list never ran.
 */
export function classifyRunners(runners, { now, staleRunnerSec }) {
  const stale = [];
  const pending = [];
  for (const r of Array.isArray(runners) ? runners : []) {
    const minted = parseRunnerName(r?.name);
    if (!minted || r.busy) continue;
    const ageSec = now / 1000 - minted.mintedSec;
    (ageSec > staleRunnerSec ? stale : pending).push({ id: r.id, name: r.name, ...minted });
  }
  const order = (a, b) => a.mintedSec - b.mintedSec || a.id - b.id;
  return { stale: stale.sort(order), pending: pending.sort(order) };
}
