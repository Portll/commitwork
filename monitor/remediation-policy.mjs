// monitor/remediation-policy.mjs — the org's remediation posture as DECLARED DATA: mode,
// verification, learning, a shared cadence enum, and a compute-budget cap. Loaded FAIL-CLOSED
// (corrupt/invalid throws); only a genuinely absent file resolves to the safe baseline, which is
// mode=report — every new lane enters there. The two agentic modes additionally need a fresh
// prompt-envelope corpus witness (the one stpa-sweep reads), or the load refuses.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from './registry.mjs';
import { readEnvelopeWitness, witnessPath } from './stpa-sweep.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Env-overridable store path; an absent file means safe defaults — nothing pre-creates it
export const policyPath = () => process.env.CW_REMEDIATION_POLICY || join(HERE, 'remediation-policy.json');
// fix: schema path resolved at CALL time - a const read at import defeats any test override.
export const policySchemaPath = () => process.env.CW_REMEDIATION_POLICY_SCHEMA || join(HERE, '..', 'schema', 'remediation-policy.schema.json');

export const MODES = ['report', 'hitl-item', 'hitl-agentic', 'full-agentic'];
export const AGENTIC_MODES = ['hitl-agentic', 'full-agentic'];
export const VERIFICATION = ['single', 'double-arbitrate'];
export const LEARNING = ['off', 'on'];
// One enum shared by re-investigation, reviewer rotation, and every periodic plane job.
export const CADENCE = ['daily', '72h', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'biannual', 'annual'];

export const DEFAULT_POLICY = Object.freeze({
  mode: 'report',
  verification: 'single',
  learning: 'off',
  cadence: 'quarterly',
  remediationBudgetPctOfCompute: 0,       // 0 = no automated spend until explicitly raised
  m3: Object.freeze({
    autoMerge: false,                     // declaration split from authority: authoring != merging
    owner: null,                          // suggested-default accountable owner for full-agentic
    scope: Object.freeze({ minSeverity: 'high', pathAllowlist: [], ruleAllowlist: [] }),
  }),
});

export function validatePolicy(doc) {
  const errors = [];
  const advisories = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push('remediation policy is not an object');
    return { errors, advisories };
  }
  // fix: shape FIRST - the enum checks below only look at four scalars, so every m3 field reached
  // the store unchecked. m3.autoMerge is the one that mattered: the API route refuses it with
  // `=== true`, so a truthy non-boolean was refused by nothing and read as authorisation by
  // anything testing it for truth. An unreadable schema is an error here, never a pass.
  errors.push(...validateAgainstSchema(doc, { path: policySchemaPath() }).errors);
  const enumField = (k, allowed) => {
    if (doc[k] !== undefined && !allowed.includes(doc[k])) errors.push(`${k} must be one of ${allowed.join('|')} (got ${JSON.stringify(doc[k])})`);
  };
  enumField('mode', MODES);
  enumField('verification', VERIFICATION);
  enumField('learning', LEARNING);
  enumField('cadence', CADENCE);
  const b = doc.remediationBudgetPctOfCompute;
  if (b !== undefined && (typeof b !== 'number' || Number.isNaN(b) || b < 0 || b > 100)) {
    errors.push('remediationBudgetPctOfCompute must be a number in [0,100]');
  }
  // Advisory, not forced — an informed operator can opt out on record
  if (doc.mode === 'full-agentic' && doc.m3?.autoMerge && !doc.m3?.owner) {
    advisories.push('mode=full-agentic with m3.autoMerge and no m3.owner — name an accountable owner (best practice; not forced)');
  }
  if ((doc.mode === 'hitl-agentic' || doc.mode === 'full-agentic') && doc.verification === 'single') {
    advisories.push(`mode=${doc.mode} with verification=single — agentic remediation on a single check; double-arbitrate is recommended`);
  }
  return { errors, advisories };
}

// An agentic mode is refused — an ERROR, not an advisory — unless the live corpus-replay witness is
// fresh; the error names the witness state (absent, unreadable, failed, stale) and where it was read.
export function checkAgenticPreconditions({ policy, witnessPath: wp = witnessPath(), now } = {}) {
  const mode = policy && policy.mode;
  if (!AGENTIC_MODES.includes(mode)) return { ok: true, mode: mode ?? null, witness: null, errors: [] };
  const w = now ? readEnvelopeWitness(wp, now) : readEnvelopeWitness(wp);
  const witness = { ...w, path: wp };
  const errors = w.state === 'fresh' ? [] : [
    `mode=${mode} is refused: the prompt-envelope live corpus witness for this run is ${w.state}`
    + `${w.at ? ` (${w.at})` : ''}${w.why ? ` — ${w.why}` : ''} at ${wp}`,
  ];
  return { ok: errors.length === 0, mode, witness, errors };
}

// Deep-merge a stored policy over the defaults so a partial file is complete and valid. Fail closed:
// a present-but-broken file throws; only an absent file resolves to the safe baseline. The agentic
// gate is on by default; a reader that must see the DECLARED mode (the panel's GET) turns it off
// and reports checkAgenticPreconditions() beside it.
export function loadPolicy(path = policyPath(), { agenticGate = true, witnessPath: wp, now } = {}) {
  const base = () => ({ ...DEFAULT_POLICY, m3: { ...DEFAULT_POLICY.m3, scope: { ...DEFAULT_POLICY.m3.scope } } });
  if (!path || !existsSync(path)) return { ...base(), source: 'default' };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`remediation policy unreadable at ${path}: ${e.code || e.message}`); }
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new Error(`remediation policy at ${path} is corrupt (unparseable JSON)`); }
  const { errors } = validatePolicy(doc);
  if (errors.length) throw new Error(`remediation policy at ${path} is invalid: ${errors.join('; ')}`);
  const b = base();
  const policy = {
    ...b, ...doc,
    m3: { ...b.m3, ...(doc.m3 || {}), scope: { ...b.m3.scope, ...(doc.m3?.scope || {}) } },
    source: 'file',
  };
  if (agenticGate) {
    const pre = checkAgenticPreconditions({ policy, ...(wp ? { witnessPath: wp } : {}), now });
    if (!pre.ok) throw new Error(`remediation policy at ${path} is refused for this run: ${pre.errors.join('; ')}`);
  }
  return policy;
}
