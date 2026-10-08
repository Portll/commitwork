// Who claimed a finding was handled — classifies an annotation's `who` so agent-written
// acceptances never render as a person's. Pure and clock-free: same string in, same class out.

// Two tiers: distinctive names match anywhere; short generic tokens must match a WHOLE token
// (bare `ci`/`bot` substrings misclassify lucia@…, cisco.com, robot.com as machines).
/** Distinctive enough that a substring hit is not a coincidence. */
const MACHINE_NAMES = Object.freeze([
  'claude-code', 'claude code', 'claude-opus', 'github-actions', 'renovate', 'dependabot',
  'automation',
]);
/** Too short/common for substring matching — must appear as a whole word. */
const MACHINE_TOKENS = Object.freeze(new Set(['ci', 'bot', 'bots', 'agent', 'sweep', 'cron', 'runner']));

/**
 * Classify `who` -> 'human' | 'machine' | 'unknown'.
 * "authorized by <person>" is MACHINE: a human name inside an agent-written string is the agent's
 * claim, not the person's signature.
 */
/**
 * Remediation-agent designation (bin/agent-tag.mjs): TYPE-NNN-context, e.g. OPUS5-007-secrets —
 * matches no marker word or token below, so it must be recognised explicitly.
 */
const AGENT_TAG_RE = /^[a-z0-9]{2,12}-\d{3,6}-[a-z0-9][a-z0-9-]{0,31}$/;

export function classifyWho(who) {
  const s = String(who || '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (AGENT_TAG_RE.test(s)) return 'machine';
  if (MACHINE_NAMES.some((m) => s.includes(m))) return 'machine';
  // Split on non-alphanumerics so `renovate[bot]` and `sam@agency.example.test` tokenize as read
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => MACHINE_TOKENS.has(t)) ? 'machine' : 'human';
}

/** Panel shape for an annotation. `who` is carried verbatim — a disputed acceptance needs the signature. */
export function annotationView(a) {
  if (!a) return null;
  return {
    action: a.action,
    at: a.at,
    reason: a.reason,
    who: a.who || '',
    whoKind: classifyWho(a.who),
  };
}

/**
 * The signature to stamp on a panel action — one resolver, one spelling. Takes the session object,
 * not a request (pure, no HTTP dependency). Returns '' for no session: the caller must refuse the
 * write, never treat it as anonymous. Known limit: trusts the session to mean a person — 'human'
 * means "a session belonging to this person did it".
 */
export function sessionWho(session) {
  const email = session && typeof session.user === 'string' ? session.user.trim() : '';
  if (!email) return '';
  // The provider travels with the identity — SSO is not the same evidence as a local password
  const via = session.provider ? ` (${session.provider})` : '';
  return `${email}${via}`;
}
