// monitor/extractors/socket.mjs — everything that reads Socket's supply-chain artifact.
//
// Socket is the one lane whose artifact needs its own vocabulary to read: a refusal that parses
// (the {ok:false} husk, a quota message), an alert tree keyed ecosystem -> package -> version
// rather than a findings array, and alert types making three different kinds of claim — licence
// policy, integrity, vulnerability — that partitionByKind must not sum as one.
//
// The lane: _socketCounts, the regrade that joins it to advisory rows by place, and socketRefusal.
// The alert shape it walks: _socketAlertCount, SOCKET_TYPES and _socketAlertRows. The functions
// are called only after module load.
//
// This file holds bare catches; bin/bare-catch-ratchet.mjs watches it as a critical module.
//
// monitor/extractors.mjs re-exports every public name here.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markPlaceCorroboration } from '../corroborate.mjs'; // a lane with no advisory id joins on PLACE
import { _zero, _detailFor } from './core.mjs';

// Socket's CLI writes {ok:false, message} when it could NOT run — no org, no token, bad input. The
// artifact exists and parses, and a generic counter would read it as `ran:true, total:0`:
// byte-identical to a scan that completed and found nothing. cra/controls.mjs reads `v.ran === true`
// as "this category PROVABLY RAN on this repo" and credits it as evidence for SR-3 / SR-4 / SI-3,
// and bin/commitwork.mjs's own socket parser records the same file as noscan.
//
// The husk returns null — the same answer this file gives for an artifact that is absent, because
// "no scan happened" is what both states mean. The category does NOT vanish: scannerFleet still
// emits it from the checks-status ran/skipped/noscan provenance, where it reports the void honestly.
//
// ALLOWLIST, NOT DENYLIST. A refusal can take shapes other than {ok:false} — a quota-exhaustion
// message under an unfamiliar key, {error:...}, {} — and each would otherwise read as "ran, 0
// findings". Socket's free tier is 1,000 scans/month and this lane runs outside the nightly sweep
// for that reason, but an on-demand run (`sweep.mjs supply-chain`) can still exhaust the quota
// mid-run. So the gate is a positive list of the shapes a completed scan can take, MEASURED rather
// than assumed (see _socketAlertCount's header comment): the legacy array, or
// `{ok:true, data:{alerts:{…}}}`. `ok:false` still vetoes both outright, in case a refusal ever
// carries a legacy-looking array. Anything else returns null, the same "no scan happened" answer
// as the husk.
export function _socketCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return null;                       // a zero-byte husk is not a clean scan either
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (!_socketCompleted(j)) return null;              // not an affirmed completion — void, not zero
  const n = _socketAlertCount(j) || 0;
  // Graded from the alert TYPE, not `policy`; see SOCKET_TYPES. Rows are computed once and both
  // tallied and published, so the count and the list cannot disagree.
  const rows = _socketAlertRows(j);
  return { ..._zero(), ran: true, total: n, ..._socketTally(rows), ..._detailFor('supplyChain', rows) };
}

// Socket's five alert types are five different KINDS of claim, so the lane's counts partition too:
// `byKind` overrides the lane-level declaration in partitionByKind. Without it, licence alerts
// would land wherever `supplyChain` was declared, one answer for several questions.
/**
 * Grade `criticalCVE` once it is known whether a CVE lane already reported it.
 *
 * The type table withholds a severity from criticalCVE with reason `pending-dedup-against-cve-lanes`,
 * because a CVE lane may already count the same advisory. A row the CVE lanes ALSO report stays
 * undetermined and says who else saw it; a row NOBODY else reports is the lane's own witness of a
 * critical advisory, and grades `crit`.
 *
 * Called from rollup.mjs, where the repo's advisory rows exist beside the lane. Deliberately NOT
 * done inside _socketCounts by re-reading osv.sarif: parseOsv already parses that file, and two
 * parsers over one artifact can name different packages for the same finding.
 *
 * Re-tallies rather than adjusting counts by hand — the split must keep summing to `total`.
 */
export function regradeSocket(lane, advisoryRows, { repo = '' } = {}) {
  if (!lane || !Array.isArray(lane.findings) || !lane.findings.length) return lane;
  const rows = lane.findings.filter((r) => r && r.rule === 'criticalCVE');
  if (!rows.length) return lane;
  markPlaceCorroboration(rows, advisoryRows, { repo });
  for (const r of rows) {
    const twins = Array.isArray(r.corroboratedBy) ? r.corroboratedBy : [];
    if (twins.length) {
      r.sev = '';
      r.sevReason = `corroborated-by-${[...new Set(twins.map((t) => t.tool))].sort().join('+')}`;
    } else {
      // SOLE WITNESS. Socket holds the advisory and says critical; nothing else in this repo saw
      // it. Withholding a grade here is the mirror defect of publishing a duplicate one — a real
      // finding made unfindable by being dressed as noise.
      r.sev = 'crit';
      r.sevReason = '';
    }
  }
  return { ...lane, ..._socketTally(lane.findings) };
}

function _socketTally(rows) {
  const zero = () => ({ crit: 0, high: 0, med: 0, low: 0, undetermined: 0 });
  const flat = zero(); const byKind = {};
  for (const r of rows) {
    const s = ['crit', 'high', 'med', 'low'].includes(r.sev) ? r.sev : 'undetermined';
    flat[s] += 1;
    (byKind[r.claimKind || 'unclassified'] ||= zero())[s] += 1;
  }
  return { ...flat, byKind };
}

// The positive list of shapes a COMPLETED socket scan can take, measured rather than assumed. Split
// out of _socketCounts so the refusal probe below cannot drift from it: two functions deciding
// "did this scan complete" by separate expressions would let them disagree about the same file.
function _socketCompleted(j) {
  const legacy = j.issues || j.alerts || (j.results && j.results.issues);
  return j.ok !== false && (Array.isArray(legacy)
    || (j.ok === true && j.data && typeof j.data === 'object'
      && j.data.alerts && typeof j.data.alerts === 'object'));
}

// ── REFUSAL IS NOT ABSENCE ───────────────────────────────────────────────────────────────────────
// _socketCounts answers null for a refusal AND for an absent artifact, because for its purpose —
// "how many findings" — both mean "no scan happened". Correct there, and lossy: the fleet cannot
// tell "Socket refused us" from "Socket was never pointed at this repo", and those call for
// opposite actions. Socket's free tier is 1,000 scans/month and this lane is deliberately outside
// the nightly sweep for that reason; the day an on-demand run exhausts the quota, every repo after
// it would go quietly into the same bucket as a repo nobody ever scanned.
//
// A REFUSAL IS A SUBTYPE OF VOID, NEVER A SIBLING OF IT. The caller records these as
// `status:'noscan'` carrying a `refusal`, rather than a new status value, and the reason is
// mechanical: every existing consumer counts voids with `c.status === 'noscan'`, so a sibling status
// would make refusals invisible to all of them — a refusal would stop counting as a coverage void at
// all, which is a worse failure than a false green. Subtype keeps
// every void counter correct and lets the panel colour the distinction.
//
// QUOTA IS ONLY CLAIMED WHEN THE MESSAGE SAYS SO. A no-token or bad-input refusal reads
// `{ok:false, message:"Input error"}`; the quota flag is matched against the provider's own words
// and is false whenever they do not say it. Inventing the diagnosis would put a confident wrong cause on
// the exact state that exists to stop confident wrong readings.
const QUOTA_LANGUAGE = /\b(quota|rate.?limit|too many requests|payment required|upgrade your plan|exceeded)\b|\b(429|402)\b/i;
export function socketRefusal(dir, file = 'socket.json') {
  const p = join(dir, file);
  if (!existsSync(p)) return null;                    // absent: a void, but not a refusal
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return null;                       // husk: void, and it refuses nothing
  let j; try { j = JSON.parse(raw); } catch { return null; }   // unparseable has its own state already
  if (!j || typeof j !== 'object') return null;
  if (_socketCompleted(j)) return null;               // it ran; nothing was refused
  const message = typeof j.message === 'string' ? j.message : '';
  return {
    refused: true,
    // Verbatim, capped. The provider's own words are the evidence; a paraphrase would be this
    // module's opinion about someone else's error.
    message: message.slice(0, 200) || '(no message field on the refusal)',
    quota: QUOTA_LANGUAGE.test(message),
  };
}

// Socket's alert shape, MEASURED rather than assumed:
//   { ok, data: { healthy, alerts: { <ecosystem>: { <package>: { <version>: {type, policy, url} } } } } }
// `data.alerts` is an OBJECT, not an array, so reading it with `.length || 0` would report every
// completed scan as zero. The legacy array paths are KEPT: an artifact written by an older CLI must
// not start reading as zero just because the shape moved.
export function _socketAlertCount(j) {
  if (!j || typeof j !== 'object') return 0;
  const legacy = j.issues || j.alerts || (j.results && j.results.issues);
  if (Array.isArray(legacy)) return legacy.length;
  const alerts = j.data && j.data.alerts;
  if (!alerts || typeof alerts !== 'object') return 0;
  let n = 0;
  for (const byPkg of Object.values(alerts)) {
    if (!byPkg || typeof byPkg !== 'object') continue;
    for (const byVer of Object.values(byPkg)) {
      if (!byVer || typeof byVer !== 'object') continue;
      n += Object.keys(byVer).length;   // one alert per (package, version)
    }
  }
  return n;
}

// key → [manifest check id, extractor] (report filenames match manifests/security-baseline.json +
// bin/authz-bola.mjs). The check id ties each category back to its checks-status.json rows — the
// per-repo run provenance — and is chosen by which check WRITES the artifact the extractor reads,
// not by name similarity: `secrets` here reads gitleaks.json, which the `secrets-gitleaks` check
// produces, NOT the `secrets` (TruffleHog) check — crediting TruffleHog's run record to numbers
// gitleaks produced would misstate provenance.
// The same traversal _socketAlertCount walks, carrying the (package, version, alert) triple out as
// rows instead of only counting the leaves. Kept beside the counter so the two cannot disagree
// about what an alert IS — a divergence there would show as a row list that outnumbers its tally.
// ── what a Socket alert actually carries ─────────────────────────────────────────────────────────
// The alert is {type, policy, url, manifest} and nothing else. No severity field, and `policy` is
// "warn" on every alert observed, so `policy` is a constant, not a gradient.
//
// Severity therefore has to come from the TYPE, and the type says five different KINDS of thing.
// Three are undetermined, and each says why rather than leaving a blank a reader fills in:
//   obfuscatedFile   our own minifiedCode lane adjudicates this class with 11 rules and names the
//                    file; Socket names none, so there is nothing here to grade against it.
//   criticalCVE      a real verdict with real evidence, which a CVE lane may ALREADY count;
//                    regradeSocket grades it once dedup can say which are new.
//   gptMalware       one LLM, no second signal, and it flags current, real releases. A
//                    single-source detector is the shape that produces false criticals at
//                    scale. It stays SUMMED as undetermined so a real one alarms.
// gitHubDependency is the one that grades: a dependency resolved from a git URL bypasses registry
// immutability and its tag can move. Low, and genuinely low — not a hedge.
//
// licenseSpdxDisj was declared here (kind policy, undetermined, why no-licence-policy-configured)
// and is not any more. Measured 2026-08-26 it was 98.3% of the lane (34,898 of 35,488 alerts);
// measured 2026-10-18 it is in 0 of the 916 socket.json on disk, 469 of which carry alert rows,
// dated 2026-09-07 to 2026-10-10, all scanned with includeLicensePolicy:true. Socket still lists
// the type (socket.dev/alerts, "License Policy Violation", read 2026-10-18) and raises it against
// the org's licence policy, where a licence set to Allow raises nothing — so the type did not
// change, what the org's policy says about these licences did, and the org policy itself was not
// readable from this box (the CLI holds no token). A declaration whose reason no longer describes
// the alert is worse than none: undeclared, a returning row is still kept and counted (undetermined,
// type-not-in-vocabulary) and socket-vocabulary.test.mjs names it as a type to classify afresh.
const SOCKET_TYPES = Object.freeze({
  obfuscatedFile: { kind: 'integrity', sev: '', why: 'corroborates-minifiedCode-no-file-named' },
  criticalCVE: { kind: 'vulnerability', sev: '', why: 'pending-dedup-against-cve-lanes' },
  gptMalware: { kind: 'integrity', sev: '', why: 'single-source-llm-unverified' },
  gitHubDependency: { kind: 'integrity', sev: 'low', why: '' },
  // malware is Socket's confirmed verdict (an AI scan confirmed by their threat research team, or a
  // listing in a security database). A second signal exists, unlike gptMalware. Critical.
  malware: { kind: 'integrity', sev: 'crit', why: '' },
  // troll is Socket's protestware or hidden-behaviour alert, rated high by Socket and here. Behaviour
  // undocumented and unrelated to the package's purpose is a supply-chain finding whatever its motive.
  troll: { kind: 'integrity', sev: 'high', why: '' },
  // gitDependency is the gitHubDependency fact at any git host and takes the same grade. Socket rates
  // it high; the reasoning above for low holds for both.
  gitDependency: { kind: 'integrity', sev: 'low', why: '' },
});
// An unknown type is undetermined and keeps its name: Socket can add types.
const socketType = (t) => SOCKET_TYPES[t] || { kind: '', sev: '', why: 'type-not-in-vocabulary' };
export const _socketTypes = SOCKET_TYPES;

export function _socketAlertRows(j) {
  const out = [];
  if (!j || typeof j !== 'object') return out;
  const legacy = j.issues || j.alerts || (j.results && j.results.issues);
  if (Array.isArray(legacy)) {
    for (const a of legacy) {
      const t = socketType((a && (a.type || a.key)) || '');
      out.push({ rule: (a && (a.type || a.key)) || '', package: (a && (a.pkg || a.package)) || '',
        version: (a && a.version) || '', sev: t.sev, claimKind: t.kind, sevReason: t.why,
        message: (a && (a.description || a.title)) || '' });
    }
    return out;
  }
  const alerts = j.data && j.data.alerts;
  if (!alerts || typeof alerts !== 'object') return out;
  const map = { critical: 'crit', high: 'high', middle: 'med', medium: 'med', low: 'low' };
  // THE NESTING IS ecosystem -> package -> version. Every field is a string, so naming the levels
  // wrongly passes every schema check while publishing a version in `rule` and the ecosystem in
  // `package`. ROW_SCHEMAS.supplyChain keys suppression identity on ['rule','package'], so a
  // mislabelled row would let one annotation silence every alert at a version string across
  // every repo.
  for (const [eco, byEco] of Object.entries(alerts)) {
    if (!byEco || typeof byEco !== 'object') continue;
    for (const [pkg, byPkg] of Object.entries(byEco)) {
      if (!byPkg || typeof byPkg !== 'object') continue;
      for (const [ver, a] of Object.entries(byPkg)) {
        // `type` IS the rule, and it is also the only severity signal — see SOCKET_TYPES.
        const t = socketType((a && a.type) || '');
        out.push({ rule: (a && a.type) || '', package: pkg, version: ver, ecosystem: eco,
          sev: map[String((a && a.severity) || '').toLowerCase()] || t.sev,
          claimKind: t.kind, sevReason: t.why,
          message: (a && (a.description || a.title)) ? String(a.description || a.title) : '' });
      }
    }
  }
  return out;
}

