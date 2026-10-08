// oracle-constructor.mjs — D2. The model does NOT emit a verdict; it emits an ARTIFACT (a BOLA-probe
// manifest, a B invariant, a property test), and a deterministic machine executes it. A hallucination
// becomes a validation failure or a test that will not compile — NEVER a published critical. Generation
// and execution are SEPARATE acts: this validates + gates; it never runs model output directly.
//
// fact: an invalid artifact is REJECTED (explicit uncertainty — a malformed generation is not a finding); a valid
// one is STAGED for human review, then deterministic execution. The output is deterministic even though
// its author was not.

function shape(a, spec) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, errors: ['artifact is not an object'] };
  const errors = [];
  for (const [k, t] of Object.entries(spec)) {
    const v = a[k];
    const ok = t === 'array' ? Array.isArray(v) : typeof v === t;
    if (!ok) errors.push(`field ${k} must be ${t}, got ${Array.isArray(v) ? 'array' : typeof v}`);
  }
  return { ok: errors.length === 0, errors };
}

// kind -> a validator for the SHAPE of that artifact. A kind must be DECLARED here, never guessed.
export const VALIDATORS = Object.freeze({
  'bola-manifest': (a) => shape(a, { base: 'string', paths: 'array' }),
  invariant: (a) => shape(a, { set: 'string', must: 'string' }), // B2 add-only invariant
  'property-test': (a) => shape(a, { name: 'string', body: 'string' }),
});

// gateArtifact({ kind, artifact }) -> { state: 'rejected'|'staged', kind, errors, why }.
// 'staged' = valid + awaiting HUMAN REVIEW before deterministic execution — never executed here.
export function gateArtifact({ kind, artifact } = {}) {
  const validator = VALIDATORS[kind];
  if (!validator) return { state: 'rejected', kind, errors: [`unknown artifact kind ${JSON.stringify(kind)}`], why: 'no validator — a kind must be declared, never guessed' };
  const { ok, errors } = validator(artifact);
  if (!ok) return { state: 'rejected', kind, errors, why: 'malformed generation — rejected, never executed (a hallucination is a validation failure, not a critical)' };
  // B2 add-only: a well-formed invariant that would EXEMPT/narrow is still refused.
  if (kind === 'invariant' && /^(no|none|nothing|any|\*)$/i.test(String(artifact.must).trim())) {
    return { state: 'rejected', kind, errors: ['invariant must ADD a check, never exempt'], why: 'a repo-local invariant may only add coverage, never subtract' };
  }
  return { state: 'staged', kind, errors: [], why: 'well-formed — staged for human review, then deterministic execution (generation and execution stay separate)' };
}
