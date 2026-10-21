// Classify one authorization probe as pass, finding or unmeasured from the evidence it recorded.
import { types } from 'node:util';

export const AUTHZ_PROBE_STATES = Object.freeze(['pass', 'finding', 'unmeasured']);

export const AUTHZ_PROBE_REASONS = Object.freeze([
  'invalid-probe',
  'invalid-expected',
  'invalid-status',
  'invalid-method',
  'invalid-authenticated',
  'invalid-reached-handler',
  'invalid-resource-witness',
  'invalid-absence-witness',
  'invalid-baseline-witness',
  'invalid-body-complete',
  'invalid-location',
  'absence-contradicted',
  'witness-on-bodyless-response',
  'probe-error',
  'status-missing',
  'no-response',
  'informational-response',
  'not-modified',
  'login-redirect',
  'redirect',
  'server-error',
  'auth-rejected',
  'not-authenticated',
  'authentication-not-witnessed',
  'handler-not-reached',
  'handler-not-witnessed',
  'client-error',
  'resource-not-witnessed',
  'conflicting-evidence',
  'allow-refused',
  'success-without-resource',
  'absence-not-witnessed',
  'absence-unwitnessable',
  'body-not-complete',
  'baseline-not-witnessed',
  'method-not-witnessed',
  'object-not-read',
  'write-effect-not-witnessed',
  'access-witnessed',
  'refused-by-handler',
  'filtered-by-handler',
  'protected-resource-accessed',
]);

const MISSING = Symbol('missing');
const MALFORMED = Symbol('malformed');
const FIELDS = ['expected', 'status', 'method', 'error', 'err', 'location', 'authenticated', 'reachedHandler', 'resourceWitness',
  'absenceWitnessed', 'baselineWitnessed', 'bodyComplete'];
const LOGIN_PATH = /\b(?:log[-_]?[io]n|sign[-_]?(?:in|on)|auth|authenticate|authorize|oauth2?|sso|saml2?|openid-connect)\b/i;
// An RFC 9110 token with no lower-case letter.
const METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Z]+$/;

const isRecord = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const result = (state, reason) => Object.freeze({ state, reason });
const unmeasured = (reason) => result('unmeasured', reason);
const optionalBoolean = (v) => v === MISSING || v === true || v === false;
const validStatus = (s) => Number.isInteger(s) && (s === 0 || (s >= 100 && s <= 599));
const validMethod = (m) => m === MISSING || (typeof m === 'string' && METHOD_TOKEN.test(m));
const bodyless = (s, method) => method === 'HEAD' || s < 200 || s === 204 || s === 205 || s === 304;
const SAFE_NON_GET = ['HEAD', 'OPTIONS', 'TRACE', 'QUERY', 'PROPFIND', 'REPORT', 'SEARCH'];
const safeNonGet = (method) => SAFE_NON_GET.includes(method);
const isLoginLocation = (loc) => typeof loc === 'string' && LOGIN_PATH.test(loc.split(/[?#]/, 1)[0]);

// Own enumerable data properties only: inherited values and anything JSON would drop are not evidence, and no getter runs.
function readProbe(probe) {
  if (types.isProxy(probe) || !isRecord(probe)) return null;
  const out = Object.create(null);
  for (const key of FIELDS) {
    const d = Object.getOwnPropertyDescriptor(probe, key);
    if (d === undefined) out[key] = MISSING;
    else if (!Object.hasOwn(d, 'value') || d.enumerable !== true) out[key] = MALFORMED;
    else out[key] = d.value === undefined || d.value === null ? MISSING : d.value;
  }
  return out;
}

function denyPass(p, reason) {
  if (p.baselineWitnessed !== true) return unmeasured('baseline-not-witnessed');
  if (p.method === MISSING) return unmeasured('method-not-witnessed');
  if (p.method === 'GET') return result('pass', reason);
  return unmeasured(safeNonGet(p.method) ? 'object-not-read' : 'write-effect-not-witnessed');
}

// Caller contract: set a field only from the witness named here, else leave it unset and the cell stays unmeasured; derive none from bola-run's disclosesObject or normBody.
// Classify a cross-actor probe only when both actors' subjects (bola-run's subjectOf) are known and differ; leave same-subject pairs unclassified.
// expected: 'allow' when policy grants this actor the owner's object, 'deny' when it does not.
// method: the request method exactly as sent.
// status: req()'s status, 0 when no response arrived.
// error, err: req()'s err or any failure reading the body; req() must surface a body-read failure here instead of returning ''.
// location: the response's Location header, which req() must return.
// authenticated: on an actor's read of its own object, true when its minted credential was sent and the response holds that object's marker; on any other probe, true only when that actor's own-object read made after this probe was pass/access-witnessed; unset for an actor with no seeded object.
// reachedHandler: true when the response carries the handler signature the owner baseline carried (the manifest's declared response header, else the baseline's media type) and is no auth redirect, false when it lacks it, so a 403/404 without it is handler-not-reached.
// resourceWitness: whether the raw response text holds the seeded object's own marker (never its id), an unguessable value of at least 128 bits that authz-wire puts in a seed field that never feeds an id or slug; unset when the marker appears anywhere in the probe's own request (URL, headers, body).
// bodyComplete: true only when the whole body was read without error, is non-empty and has the owner baseline's media type; a 403/404 refusal does not need it.
// absenceWitnessed: true only when bodyComplete is true and the marker is absent from that body.
// baselineWitnessed: true only when the owner's read of the same object, made after this deny probe, was pass/access-witnessed.
// Write side-effect witnessing is not supported yet: a deny probe sent with an unsafe method stays unmeasured.
// Anonymous exposure is out of scope: bola-run reports it as broken-auth from its actor matrix or unauth-exposure from its discovery sweep.
export function classifyAuthzProbe(probe) {
  let p;
  try { p = readProbe(probe); } catch (unreadable) { p = null; }
  if (p === null) return unmeasured('invalid-probe');
  if (p.expected !== 'allow' && p.expected !== 'deny') return unmeasured('invalid-expected');
  if (p.status !== MISSING && !validStatus(p.status)) return unmeasured('invalid-status');
  if (!validMethod(p.method)) return unmeasured('invalid-method');
  if (!optionalBoolean(p.authenticated)) return unmeasured('invalid-authenticated');
  if (!optionalBoolean(p.reachedHandler)) return unmeasured('invalid-reached-handler');
  if (!optionalBoolean(p.resourceWitness)) return unmeasured('invalid-resource-witness');
  if (!optionalBoolean(p.absenceWitnessed)) return unmeasured('invalid-absence-witness');
  if (!optionalBoolean(p.baselineWitnessed)) return unmeasured('invalid-baseline-witness');
  if (!optionalBoolean(p.bodyComplete)) return unmeasured('invalid-body-complete');
  if (p.location !== MISSING && typeof p.location !== 'string') return unmeasured('invalid-location');

  const s = p.status;
  // A malformed field is a caller bug and outranks a witnessed leak; past validation, an authenticated deny carrying the marker is a finding at any status.
  if (p.resourceWitness === true && s !== MISSING && s !== 0) {
    if (p.absenceWitnessed === true) return unmeasured('absence-contradicted');
    if (bodyless(s, p.method)) return unmeasured('witness-on-bodyless-response');
    if (p.expected === 'deny' && p.authenticated === true) return result('finding', 'protected-resource-accessed');
  }
  if (p.error !== MISSING || p.err !== MISSING) return unmeasured('probe-error');
  if (s === MISSING) return unmeasured('status-missing');
  if (s === 0) return unmeasured('no-response');
  if (s < 200) return unmeasured('informational-response');
  if (s === 304) return unmeasured('not-modified');
  if (s >= 300 && s < 400) return unmeasured(isLoginLocation(p.location) ? 'login-redirect' : 'redirect');
  if (s >= 500) return unmeasured('server-error');
  if (s === 401 || s === 407) return unmeasured('auth-rejected');
  if (p.authenticated !== true) return unmeasured(p.authenticated === false ? 'not-authenticated' : 'authentication-not-witnessed');
  if (p.reachedHandler !== true) return unmeasured(p.reachedHandler === false ? 'handler-not-reached' : 'handler-not-witnessed');

  const refused = s === 403 || s === 404;
  if (s >= 400 && !refused) return unmeasured('client-error');
  if (p.resourceWitness === MISSING) return unmeasured('resource-not-witnessed');
  if (p.resourceWitness === true) return refused ? unmeasured('conflicting-evidence') : result('pass', 'access-witnessed');
  if (p.expected === 'allow') return unmeasured(refused ? 'allow-refused' : 'success-without-resource');
  if (refused) return p.absenceWitnessed === false ? unmeasured('conflicting-evidence') : denyPass(p, 'refused-by-handler');
  if (p.method !== MISSING && p.method !== 'GET' && !safeNonGet(p.method)) return unmeasured('write-effect-not-witnessed');
  if (p.absenceWitnessed !== true) return unmeasured('absence-not-witnessed');
  if (s !== 200) return unmeasured('absence-unwitnessable');
  if (p.bodyComplete !== true) return unmeasured('body-not-complete');
  return denyPass(p, 'filtered-by-handler');
}
