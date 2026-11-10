// lib/remediation-contract.mjs — the frozen contract of remediation.json: for each finding of one
// repository's scan, the fix candidates proposed for it and whether each held when the lane that
// raised the finding re-ran over a patched copy. A library only: it builds, sorts and validates the
// document; nothing here runs a scanner, reads the clock or opens a file other than its schema.
// The finding's identity and occurrence are the line-free pair sarif-export hashes into
// partialFingerprints, so a remediation row joins its SARIF result — and later its fixes[] entry —
// without a line number.

import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './json-schema.mjs';

export const REMEDIATION_SCHEMA = 'commitwork.remediation/1';
export const TIERS = Object.freeze(['deterministic', 'rule', 'codemod', 'llm']);
export const VERIFICATION_STATUSES = Object.freeze(['verified', 'failed', 'unverified', 'undetermined']);

// Not env-overridable: a validator pointed at another schema would pass documents against another contract.
const SCHEMA_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'remediation.schema.json');

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpStr = (a, b) => cmp(String(a), String(b));
// An unknown tier sorts after the known ones, alphabetically, instead of collapsing to index -1.
const tierRank = (t) => (TIERS.includes(t) ? TIERS.indexOf(t) : TIERS.length);
const hasText = (v) => typeof v === 'string' && v.length > 0;

/** First 16 hex of sha256 over the identity, the tier and the patch ('' when the patch is null), NUL-joined:
 *  the id names what a candidate proposes, so two runs proposing the same fix agree without a line. */
export function candidateId({ identity, tier, patch }) {
  return createHash('sha256').update(`${identity ?? ''}\0${tier ?? ''}\0${patch ?? ''}`).digest('hex').slice(0, 16);
}

const byIdentityThenOccurrence = (a, b) => cmpStr(a.identity, b.identity)
  || (Number(a.occurrence) || 0) - (Number(b.occurrence) || 0);
const byTierThenId = (a, b) => tierRank(a.tier) - tierRank(b.tier) || cmpStr(a.tier, b.tier) || cmpStr(a.id, b.id);
const byKindThenText = (a, b) => cmpStr(a.kind, b.kind) || cmpStr(a.text, b.text);

// Every object is rebuilt in the schema's key order and every array canonically ordered, so the same
// input yields the same bytes whatever order its keys and arrays arrived in. Only `id` and `patch`
// are filled in (patch: null is the documented spelling of "no code change"); anything else a caller
// omits is left out for validateRemediation to refuse, not papered over with a default.
function buildCandidate(finding, c) {
  const v = c.verification;
  return {
    id: c.id ?? candidateId({ identity: finding.identity, tier: c.tier, patch: c.patch ?? null }),
    tier: c.tier,
    provenance: c.provenance && { tool: c.provenance.tool, model: c.provenance.model, version: c.provenance.version },
    patch: c.patch ?? null,
    cached: c.cached,
    verification: v && {
      status: v.status,
      witness: v.witness && {
        lanes: [...(v.witness.lanes || [])].sort(cmpStr),
        before: v.witness.before,
        after: v.witness.after,
        digest: v.witness.digest,
      },
      newFindings: [...(v.newFindings || [])].sort(cmpStr),
      tests: v.tests && { command: v.tests.command, status: v.tests.status },
      reason: v.reason,
    },
  };
}

function buildFinding(f) {
  return {
    identity: f.identity,
    occurrence: f.occurrence,
    ruleId: f.ruleId,
    lane: f.lane,
    file: f.file ?? null,
    severity: f.severity,
    candidates: (f.candidates || []).map((c) => buildCandidate(f, c)).sort(byTierThenId),
    actions: (f.actions || []).map((a) => ({ kind: a.kind, text: a.text })).sort(byKindThenText),
  };
}

/** A new commitwork.remediation/1 document: arrays sorted, candidate ids computed when absent,
 *  input untouched. Same input, same JSON.stringify bytes, whatever its key or array order. */
export function buildRemediation({ repository, commit, generatedAt, toolVersion, findings = [], undetermined = [], notMeasured = [] }) {
  return {
    schema: REMEDIATION_SCHEMA,
    generatedAt,
    tool: { name: 'commitwork', version: toolVersion },
    repository,
    commit: commit ?? null,
    findings: findings.map(buildFinding).sort(byIdentityThenOccurrence),
    undetermined: undetermined
      .map((u) => ({ identity: u.identity, ruleId: u.ruleId, lane: u.lane, claimedSeverity: u.claimedSeverity ?? null, reason: u.reason }))
      .sort((a, b) => cmpStr(a.identity, b.identity) || cmpStr(a.ruleId, b.ruleId) || cmpStr(a.lane, b.lane)
        || cmpStr(a.claimedSeverity ?? '', b.claimedSeverity ?? '') || cmpStr(a.reason, b.reason)),
    notMeasured: notMeasured
      .map((n) => ({ lane: n.lane, reason: n.reason }))
      .sort((a, b) => cmpStr(a.lane, b.lane) || cmpStr(a.reason, b.reason)),
  };
}

// The status rules the schema cannot state. Each message names the finding's identity and the
// candidate's id, so a reader can find the row the complaint is about without a path or index.
function candidateRuleErrors(f, c) {
  const at = `finding ${f.identity} candidate ${c.id ?? '(no id)'}: `;
  const v = c.verification || {};
  const w = v.witness || {};
  const status = v.status;
  if (!VERIFICATION_STATUSES.includes(status)) return [];
  const patch = c.patch ?? null;
  const out = [];
  const not = (ok, msg) => { if (!ok) out.push(at + msg); };

  if (status === 'verified') {
    not(patch !== null, 'status "verified" requires a non-null patch');
    not(Array.isArray(w.lanes) && w.lanes.length > 0, 'status "verified" requires witness.lanes to name the lane(s) that re-ran');
    not(w.before > 0, 'status "verified" requires witness.before > 0');
    not(w.after === 0, 'status "verified" requires witness.after to be 0');
    not(Array.isArray(v.newFindings) && v.newFindings.length === 0, 'status "verified" requires newFindings to be empty');
    not(v.tests?.status === 'passed' || v.tests?.status === 'notDeclared',
      `status "verified" requires tests.status "passed" or "notDeclared", not ${JSON.stringify(v.tests?.status)}`);
  }
  if (status === 'failed') {
    not(hasText(v.reason), 'status "failed" requires a non-empty reason');
    not((w.after ?? 0) > 0 || (Array.isArray(v.newFindings) && v.newFindings.length > 0) || v.tests?.status === 'failed',
      'status "failed" needs evidence: witness.after > 0, a non-empty newFindings, or tests.status "failed"');
  }
  if (status === 'undetermined') {
    not(hasText(v.reason), 'status "undetermined" requires a non-empty reason');
    not(w.after === null, 'status "undetermined" requires witness.after to be null');
  }
  if (status === 'unverified') {
    not((Array.isArray(w.lanes) ? w.lanes.length : 0) === 0 && w.after === null,
      'status "unverified" means verification was never attempted: witness.lanes must be empty and witness.after null');
  }
  if (patch === null && status !== 'unverified' && status !== 'undetermined') {
    out.push(at + `a candidate with a null patch can only be "unverified" or "undetermined", not ${JSON.stringify(status)}`);
  }
  const expected = candidateId({ identity: f.identity, tier: c.tier, patch });
  if (typeof c.id === 'string' && c.id !== expected) {
    out.push(at + `id is ${c.id}, but sha256 over identity, tier and patch gives ${expected}`);
  }
  return out;
}

/** -> { errors: string[] }. The schema first, then the status rules; empty means the document holds. */
export function validateRemediation(doc) {
  const errors = validateAgainstSchema(doc, { path: SCHEMA_PATH })
    .errors.map((e) => e.replace(/^schema: /, ''));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !Array.isArray(doc.findings)) return { errors };
  const seen = new Map();
  for (const [i, f] of doc.findings.entries()) {
    if (typeof f !== 'object' || f === null) continue;
    if (!(String(f.identity).startsWith('sc|') || String(f.identity).startsWith('f|'))) {
      errors.push(`finding ${f.identity}: identity must start with "sc|" or "f|"`);
    }
    const key = `${f.identity}\u0000${f.occurrence}`;
    if (seen.has(key)) {
      errors.push(`finding ${f.identity} occurrence ${f.occurrence}: identity and occurrence are already used by findings[${seen.get(key)}]`);
    } else {
      seen.set(key, i);
    }
    for (const c of Array.isArray(f.candidates) ? f.candidates : []) {
      if (c && typeof c === 'object') errors.push(...candidateRuleErrors(f, c));
    }
  }
  return { errors };
}

/** The first verified candidate in tier order, or null: what SARIF fixes[] will carry for a finding. */
export function chosenCandidate(finding) {
  const candidates = Array.isArray(finding?.candidates) ? finding.candidates : [];
  let best = null;
  for (const c of candidates) {
    if (!c || c.verification?.status !== 'verified' || !TIERS.includes(c.tier)) continue;
    if (!best || TIERS.indexOf(c.tier) < TIERS.indexOf(best.tier)) best = c;
  }
  return best;
}
