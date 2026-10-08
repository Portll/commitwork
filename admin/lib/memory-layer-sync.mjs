// admin/lib/memory-layer-sync.mjs — is the spine in sync with the memory layer at the declared points?
//
// THE POINTS ARE NOT DECLARED HERE. They are read from lib/memory-layer-contract.json, which is the
// binding contract both client implementations are tested against. A second declaration in this
// file would drift from it, and the drift would show up as a panel disagreeing with the contract
// about what the fleet owes — which is worse than no column.
//
// WHY `missing` IS ALMOST NEVER EMITTED, and why that is the correct behaviour rather than a
// weakness. The contract's rule is that `missing` may only be emitted for a point whose WRITER
// EXISTS. Today: P1 (session close) is `partially-wired` — the shape exists in the wild and is
// applied voluntarily, with no hook producing it — and P2/P3 are wired by nothing at all. So a zero
// means "nobody wrote one", not "the write failed". Reporting those 1,036 completed tasks as
// `missing` would paint a red wall that is a property of this checker, which is the unsupported finding
// half of the house invariant.
//
// THE STRICT PATH IS BUILT AND WAITING. `/api/recall/tags` is the contract's ENUMERATION endpoint
// (measured: 1 returned for a 1-match tag, 0 for a tag that exists nowhere), unlike `/api/recall`,
// which the contract forbids because it accepts a tags filter and silently ignores it. So the moment
// a close hook tags its write `spine-session:<id>`, this reader becomes exact and P1 can legitimately
// emit `missing`. Nothing here changes on that day except the point's `status` in the contract.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recallByTags, credential } from '../../lib/memory-layer-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const contractPath = () => process.env.CW_INTERNAL_C_CONTRACT
  || join(HERE, '..', '..', 'lib', 'memory-layer-contract.json');

/**
 * The declared points, read from the contract.
 *
 * A contract we cannot read is NOT "no points declared" — that would render as a fleet owing
 * nothing, which is the exact inversion of the truth. It raises, and the caller reports it.
 */
export function syncPoints({ path = contractPath() } = {}) {
  const raw = readFileSync(path, 'utf8');
  const c = JSON.parse(raw);
  const sp = c && c.syncPoints;
  if (!sp || !Array.isArray(sp.points)) {
    throw new Error('memory-layer contract declares no syncPoints — refusing to report a fleet that owes nothing');
  }
  return { points: sp.points, verdicts: sp.verdicts || null, key: sp.key || null };
}

/** The tag a write must carry for this reader to find it. Mirrors the contract's key field. */
export const sessionTag = (spineSessionId) => `spine-session:${spineSessionId}`;

/**
 * The verdict for one point, given whether a record was found.
 *
 * `status` comes from the contract, not from this function's opinion, and it is what decides whether
 * a zero may be called `missing`.
 */
export function verdictFor(point, { found = null, reachable = true } = {}) {
  if (!reachable) return { verdict: 'unverifiable', why: 'the memory layer could not be reached, or no credential is held here' };
  if (found > 0) return { verdict: 'synced', why: `${found} record(s) carry this session` };
  // NOT PROBED IS NOT ABSENT, and this module existed for a whole commit without honouring its own
  // rule. `found === null` means nothing was asked — no sessions were handed in, or this point is
  // not answerable by a session tag. `found === 0` means asked and none. Falling through to the
  // status check treated them alike, which is harmless only while every point is unwired: the day a
  // close hook lands and P1 becomes `wired`, every unprobed session would have reported `missing`.
  // A latent unsupported finding, in the module written to prevent unsupported finding.
  // ORDER MATTERS. `not-wired` is knowable from the CONTRACT and needs no probe at all — a point
  // nothing writes is unwired whether or not anyone looked. So the status check comes first, and
  // the not-probed case below applies only to a point that DOES have a writer.
  if (point.status !== 'wired') {
    return {
      verdict: 'not-wired',
      why: `${point.point} is ${point.status} — ${point.note || 'no writer produces this point'}, so an absent record is not a fault of the work`,
    };
  }
  if (found === null) {
    return { verdict: 'unverifiable', why: `${point.point} is wired but was not probed — no evidence either way was gathered` };
  }
  return { verdict: 'missing', why: `${point.point} is wired and no record carries this session` };
}

/**
 * A summary for the panel: one row per declared point.
 *
 * Deliberately NOT per task. A per-row verdict would imply this reader can answer for each of 1,036
 * tasks, and it cannot — two of the three points have no writer and the third has no enumeration
 * until writes carry the tag. Promising a column it cannot fill is how the unsupported finding failure
 * starts.
 *
 * `probeSessions` is bounded and opt-in. A panel render must not fan out one network call per
 * session; when nothing is probed the rows say `not-wired`/`unverifiable` on the contract's word
 * alone, which is exactly as much as is known.
 */
export async function syncSummary({
  probeSessions = [], env = process.env, fetchImpl = fetch, cap = 20, points = null,
} = {}) {
  let declared;
  try { declared = points || syncPoints().points; }
  catch (e) { return { ok: false, why: e.message, rows: [] }; }

  const cred = credential({ env, report: false });
  const reachable = cred.ok;

  // Only P1 is checkable at all today, and only for sessions we were handed.
  const targets = probeSessions.slice(0, cap);
  let found = null;
  let probeWhy = null;
  if (reachable && targets.length) {
    found = 0;
    for (const id of targets) {
      try {
        const r = await recallByTags([sessionTag(id)], { limit: 1, env, fetchImpl });
        // A transport failure is NOT a zero. Zero means "asked and none"; a failure means "did not
        // ask", and folding them makes an outage look like an empty store.
        if (r && r.ok === false) { probeWhy = r.reason || 'tag recall failed'; found = null; break; }
        const n = Array.isArray(r?.memories) ? r.memories.length : (r?.count ?? 0);
        if (n > 0) found += 1;
      } catch (e) {
        probeWhy = e && e.message ? e.message : 'tag recall threw';
        found = null;
        break;
      }
    }
  }

  const rows = declared.map((p) => {
    // Only the session-close point is answerable by a session-id tag.
    const probed = p.id === 'P1' ? found : null;
    const v = verdictFor(p, { found: probed, reachable: reachable && probeWhy == null });
    return {
      id: p.id, point: p.point, firesOn: p.firesOn, status: p.status,
      fields: p.fields || [],
      probed: probed,
      probedOf: p.id === 'P1' ? targets.length : 0,
      ...v,
    };
  });

  return {
    ok: true,
    rows,
    credential: reachable ? cred.source : null,
    // Stated, not implied: a sample is not a rate, and this reader has no denominator.
    caveat: 'the memory layer offers no enumeration by session, so coverage here is a SAMPLE of the sessions handed to it — never a rate over the store',
    ...(probeWhy ? { probeWhy } : {}),
  };
}
