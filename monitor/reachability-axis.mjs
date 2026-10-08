// monitor/reachability-axis.mjs — the seam between a call-graph proof and the defence vector.
//
// govulncheck has been running the whole time. Its verdict on ffuf (2026-08-23) put nine x/net
// advisories in the reachable bucket and GO-2023-2102 in the module-only bucket — the same answer a
// session later spent an investigation deriving by hand. The proof reached an artifact, a lane and
// a CRA document, and never reached `defenceVector.reachability`, so lifecycle recomputed a verdict
// with that axis blank every time.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. `unproven` must never become `blocks`.
//
// govulncheck can prove `reachable`; it cannot prove the negative. A module-level finding says it
// showed no path, NOT that no path exists (cra/reachability-evidence.mjs states this at length, and
// nothing in the fleet can currently assert `unreachable_static`). Mapping that to `blocks` would
// convert "we could not show a path" into "this is contained" — dep-scan's `in_triage` defect in
// mirror image, where 100 of 105 findings with a true proof count of zero read as REACHABLE. Same
// error, opposite sign, and this time it would flatter us rather than alarm us.
//
// So `unproven` maps to `partial`: real evidence that an analyser looked, carrying no containment.
// It cannot reach the quorum on its own, which is correct — one weak axis contains nothing.
//
// Worth naming because it looks like it is handled and is not: computeDefence's D-PROBE rule
// downgrades `reachability: blocks` to `partial` unless the ref cites a call graph. Our ref DOES
// cite one, so D-PROBE would wave a wrong `blocks` straight through. The guard that appears to
// protect this boundary does not. The test asserts the mapping directly for that reason.

/** What reachabilityFor() emits. Matched on the typed value, never on prose. */
const REACHABLE = 'reachable';
const UNPROVEN = 'reachability_unproven';

/**
 * Map one reachabilityFor() result onto a defenceVector axis cell.
 *
 * @param {object} res  the return of cra/reachability-evidence.mjs :: reachabilityFor
 * @returns {{axis:object, note:object}|null}  null when there is nothing to say, so the axis stays
 *          untouched and the record keeps reading `undetermined` rather than gaining a fake reading
 */
export function reachabilityAxis(res) {
  if (!res || typeof res !== 'object') return null;

  // An ambiguous alias is REFUSED upstream, and a refusal is not the same as no data. Returning
  // null for both would make "we declined to attribute a proof" indistinguishable from "nobody
  // looked" — the grey-vs-grey collapse. No axis reading, but the reason is carried out.
  if (res.refused) {
    return { axis: null, note: { reachabilityRefused: res.refused, claimedBy: res.claimedBy || [], why: res.why || '' } };
  }

  const ev = Array.isArray(res.evidence) ? res.evidence[0] : null;
  // Only a call-graph proof may write this axis. dep-scan rows arrive as `reachability_unknown`
  // with `method: 'scanner_default'`; admitting them here would launder a static slice into the
  // same field a compiler proof writes.
  if (!ev || ev.method !== 'call_graph') return null;

  const via = res.via ? String(res.via) : '';
  const ref = `call-graph:${ev.source || 'unknown'}${res.aliased && via ? ` via ${via}` : ''}`;
  const fan = Number.isFinite(res.fanOut) && res.fanOut > 1 ? ` [alias fan-out ${res.fanOut}]` : '';

  if (res.reachability === REACHABLE) {
    return {
      // A proven path is the ABSENCE of a defence on this axis. `open` with evidence is exactly
      // that: measured, and found to block nothing.
      axis: { state: 'open', evidence: `${ev.detail || 'call path traced'}${fan}`, ref },
      note: { reachabilityVia: via || null, reachabilityAliased: !!res.aliased, reachabilityFanOut: res.fanOut || null },
    };
  }

  if (res.reachability === UNPROVEN) {
    return {
      // NOT `blocks`. See the header — this is the whole point of the file.
      axis: { state: 'partial', evidence: `${ev.detail || 'no call path shown'}${fan}`, ref,
        rationale: 'govulncheck showed no call path; absence of proof is not proof of absence, so this never blocks' },
      note: { reachabilityVia: via || null, reachabilityAliased: !!res.aliased, reachabilityFanOut: res.fanOut || null },
    };
  }

  return null;
}

/**
 * Apply the axis onto a lifecycle record in place, without disturbing a reading somebody else made.
 * Returns 'set' | 'refused' | 'skipped' so a caller can count the join rate — a seam that silently
 * joins nothing looks identical to one that works.
 */
export function applyReachabilityAxis(rec, res) {
  const mapped = reachabilityAxis(res);
  if (!mapped) return 'skipped';
  if (mapped.note) Object.assign(rec, mapped.note);
  if (!mapped.axis) return 'refused';

  rec.defenceVector = rec.defenceVector || {};
  const existing = rec.defenceVector.reachability;
  // An authored judgement outranks a machine one: if a human already wrote evidence on this axis,
  // leave it. Overwriting it would silently delete the only kind of reading this file cannot make.
  if (existing && String(existing.evidence || '').trim()) return 'skipped';
  rec.defenceVector.reachability = mapped.axis;
  return 'set';
}
