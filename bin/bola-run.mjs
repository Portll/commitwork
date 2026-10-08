#!/usr/bin/env node
/**
 * commitwork generic BOLA / IDOR / BFLA / tenant-isolation runner. Everything stack-specific lives
 * in a MANIFEST, so a second backend is a new JSON file, not a fork of the probe. Same evidence
 * contract as authz-bola.mjs (findings[], the {ran:false,skipped:true,reason} void shape).
 *
 * Classification falls out of an ACTOR MATRIX — anon/user/admin across two tenants — since each
 * attacker×owner cell maps to one class:
 *     anon    → any authed  = broken-auth
 *     user    → peer user   = bola
 *     user    → admin       = bfla
 *     authed  → other tenant = cross-tenant
 *
 * Ownership ground truth cannot be inferred, so the manifest declares it: `seed` (each owner POSTs
 * its own object; peers GET it) or `declared` (explicit { path, owner } pairs, no writes).
 *
 * Secrets NEVER live in the manifest — it names ENV VARS (…Env fields); values arrive at invocation.
 *
 * usage:  node bin/bola-run.mjs --manifest <path|name>   [--base URL]  [--trust-repo-manifest]
 *         node bin/bola-run.mjs                            (auto: ./bola.json, then ./commitwork.json #bola)
 * Emits JSON to stdout. Exit 0 always (a void is not a tool failure); exit 2 only on usage/parse error.
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInto } from '../lib/secrets.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { bolaManifestDirFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OK = (s) => s >= 200 && s < 300;
const CAP_ACTORS = 16;
const CAP_OBJECTS = 200;
const CAP_DISCOVER = 40;

// ── the fleet-wide void shape (identical to authz-bola.mjs / tls-headers-scan.mjs) ───────────────
// A run that could not happen emits a VOID with a full-sentence reason, never a clean verdict.
export function voidResult(reason, base = null, extra = {}) {
  return {
    tool: 'authz-bola', ran: false, skipped: true, reason,
    summary: { base, ran: false, skipped: true, reason, endpointsProbed: 0, findings: 0,
      verdict: `NOT RUN — ${reason}` },
    findings: [], tested: [], actors: [], ...extra,
  };
}

// ── tiny helpers ─────────────────────────────────────────────────────────────────────────────────
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

// Read a JSON value by dotted/bracketed path ("data.0.id"); returns undefined, never throws.
export function pluck(obj, path) {
  if (!path) return undefined;
  return String(path).split(/[.[\]]+/).filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Best-effort JWT `sub` so two actors resolving to the SAME identity are caught even when header
// strings differ; non-JWT credentials fall back to the raw material.
export function subjectOf(material) {
  const m = /^Bearer\s+([\w-]+\.([\w-]+)\.[\w-]+)/.exec(material || '');
  if (m) { try { return 'sub:' + (JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8')).sub || m[1]); } catch { /* fall through */ } }
  return material ? 'raw:' + material : null;
}

// ── where credential VALUES come from ────────────────────────────────────────────────────────────
// Defaults to process.env; run() swaps in a copy carrying values from the local secrets store
// (lib/secrets.mjs). Module-scoped so the recipes need no env parameter threaded through them.
let ENV = process.env;

// Every env-var name the manifest depends on: every *Env field value, every ${ENV:NAME}
// placeholder, and the per-recipe defaults — the list offered to the secrets store.
export function secretNames(m) {
  const names = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { for (const hit of v.matchAll(/\$\{ENV:([A-Z0-9_]+)\}/g)) names.add(hit[1]); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!isObj(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (/Env$/.test(k) && typeof x === 'string') names.add(x); // an *Env field's value IS a var name
      else walk(x);
    }
  };
  walk(m);
  for (const a of (Array.isArray(m && m.actors) ? m.actors : [])) {
    const c = a && a.credential;
    if (!isObj(c)) continue;
    if (c.type === 'static-bearer' && !c.tokenEnv) names.add('CW_BEARER');
    if (c.type === 'api-key' && !c.valueEnv) names.add('CW_API_KEY');
    if (c.type === 'supabase' && !c.apikeyEnv) names.add('SUPABASE_ANON_KEY');
    if (c.type === 'keycloak') { if (!c.realm) names.add('KC_REALM'); if (!c.client) names.add('KC_CLIENT'); }
  }
  return [...names].sort();
}

// Resolve ${ENV:NAME} placeholders (deep-walk); missing env throws with the var name.
function subst(v, where) {
  if (typeof v === 'string') return v.replace(/\$\{ENV:([A-Z0-9_]+)\}/g, (_, n) => {
    const val = ENV[n];
    if (val === undefined || val === '') throw new Error(`${where}: ${n} is unset — it holds a value this run needs (declared in the manifest as \${ENV:${n}}). Store it once with \`node bin/secrets.mjs set ${n}\`, or export it for a one-off.`);
    return val;
  });
  if (Array.isArray(v)) return v.map((x) => subst(x, where));
  if (isObj(v)) { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = subst(x, where); return o; }
  return v;
}
function envReq(name, where) {
  const v = ENV[name];
  if (v === undefined || v === '') throw new Error(`${where}: ${name} is unset — the manifest deliberately holds only the var NAME, never the secret. Store it once in the keychain with \`node bin/secrets.mjs set ${name}\`, or export it for a one-off.`);
  return v;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────
export async function req(url, { method = 'GET', headers = {}, body } = {}) {
  try {
    const r = await fetch(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const text = await r.text().catch(() => '');
    return { status: r.status, len: text.length, ct: r.headers.get('content-type') || '', setCookie: r.headers.get('set-cookie') || '', text };
  } catch (e) { return { status: 0, len: 0, err: String(e && e.message || e).slice(0, 120) }; }
}

// ── credential recipes (minting) ───────────────────────────────────────────────────────────────────
// Each recipe returns { headers, subject } or throws — a throw makes the actor UNMINTABLE and every
// matrix cell needing it a VOID, never a silent pass with fewer actors.
export const RECIPES = {
  // no credential — the anonymous baseline.
  none: async () => ({ headers: {}, subject: null }),

  // a bearer already in the environment.
  'static-bearer': async (c) => {
    const t = envReq(c.tokenEnv || 'CW_BEARER', `recipe static-bearer[${c.tokenEnv}]`);
    return { headers: { Authorization: `Bearer ${t}` }, subject: subjectOf(`Bearer ${t}`) };
  },

  // an arbitrary API-key header.
  'api-key': async (c) => {
    const name = c.header || 'X-Api-Key';
    const val = envReq(c.valueEnv || 'CW_API_KEY', `recipe api-key[${name}]`);
    return { headers: { [name]: val }, subject: subjectOf(val) };
  },

  // Keycloak / any OIDC password (direct-access) grant.
  keycloak: async (c) => {
    const kc = trimSlash(subst(c.url, 'recipe keycloak.url') || process.env.KC_URL || 'http://localhost:8180');
    const realm = c.realm || envReq('KC_REALM', 'recipe keycloak.realm');
    const client = c.client || envReq('KC_CLIENT', 'recipe keycloak.client');
    const user = c.username ? subst(c.username, 'keycloak.username') : envReq(c.usernameEnv, 'recipe keycloak.usernameEnv');
    const pass = envReq(c.passwordEnv, 'recipe keycloak.passwordEnv');
    const url = `${kc}/realms/${realm}/protocol/openid-connect/token`;
    const r = await req(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: client, username: user, password: pass }).toString() });
    if (r.status === 0) throw new Error(`recipe keycloak: token endpoint ${url} unreachable (${r.err}). Check KC url/realm and that Keycloak is up.`);
    let tok; try { tok = JSON.parse(r.text).access_token; } catch { /* non-json */ }
    if (!tok) throw new Error(`recipe keycloak: no access_token from ${url} (HTTP ${r.status}) for user "${user}" in realm "${realm}" — verify the client "${client}" has direct-access grants enabled and the password env is correct.`);
    return { headers: { Authorization: `Bearer ${tok}` }, subject: subjectOf(`Bearer ${tok}`) };
  },

  // Supabase GoTrue password grant. apikey is the anon/public key, still named via env.
  supabase: async (c) => {
    const base = trimSlash(subst(c.url, 'recipe supabase.url'));
    const apikey = envReq(c.apikeyEnv || 'SUPABASE_ANON_KEY', 'recipe supabase.apikeyEnv');
    const email = c.email ? subst(c.email, 'supabase.email') : envReq(c.emailEnv, 'recipe supabase.emailEnv');
    const pass = envReq(c.passwordEnv, 'recipe supabase.passwordEnv');
    const url = `${base}/auth/v1/token?grant_type=password`;
    const r = await req(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ email, password: pass }) });
    if (r.status === 0) throw new Error(`recipe supabase: ${url} unreachable (${r.err}).`);
    let tok; try { tok = JSON.parse(r.text).access_token; } catch { /* non-json */ }
    if (!tok) throw new Error(`recipe supabase: no access_token from ${url} (HTTP ${r.status}) for "${email}" — check the email/password and that the anon apikey (env ${c.apikeyEnv || 'SUPABASE_ANON_KEY'}) is correct.`);
    return { headers: { Authorization: `Bearer ${tok}`, apikey }, subject: subjectOf(`Bearer ${tok}`) };
  },

  // A generic form/JSON login POST returning a Set-Cookie session or a body token; `capture` says which.
  'login-post': async (c) => {
    const url = subst(c.url, 'recipe login-post.url');
    const asForm = (c.contentType || 'json') === 'form';
    const fields = subst(c.fields || {}, 'recipe login-post.fields');
    const headers = { 'Content-Type': asForm ? 'application/x-www-form-urlencoded' : 'application/json' };
    const body = asForm ? new URLSearchParams(fields).toString() : JSON.stringify(fields);
    const r = await req(url, { method: c.method || 'POST', headers, body });
    if (r.status === 0) throw new Error(`recipe login-post: ${url} unreachable (${r.err}).`);
    if (!OK(r.status)) throw new Error(`recipe login-post: ${url} returned HTTP ${r.status} (expected 2xx) — check the login fields and endpoint.`);
    const cap = c.capture || { mode: 'cookie' };
    if (cap.mode === 'token') {
      let tok; try { tok = pluck(JSON.parse(r.text), cap.tokenPath); } catch { /* non-json */ }
      if (!tok) throw new Error(`recipe login-post: no token at body path "${cap.tokenPath}" in the ${url} response (HTTP ${r.status}) — fix capture.tokenPath.`);
      const scheme = cap.scheme || 'Bearer';
      return { headers: { Authorization: `${scheme} ${tok}` }, subject: subjectOf(`${scheme} ${tok}`) };
    }
    if (!r.setCookie) throw new Error(`recipe login-post: ${url} set no cookie (HTTP ${r.status}) and capture.mode is "cookie" — the login may return a token instead (set capture.mode:"token", tokenPath).`);
    const cookie = r.setCookie.split(',').map((c2) => c2.split(';')[0].trim()).filter(Boolean).join('; ');
    return { headers: { Cookie: cookie }, subject: 'cookie:' + cookie.slice(0, 24) };
  },
};

// ── actor resolution ───────────────────────────────────────────────────────────────────────────────
export async function resolveActors(actors) {
  const out = [];
  for (const a of actors.slice(0, CAP_ACTORS)) {
    const role = a.role || 'user';
    const tenant = a.tenant || 'default';
    const type = (a.credential && a.credential.type) || 'none';
    const recipe = RECIPES[type];
    if (!recipe) { out.push({ ...a, role, tenant, void: `unknown credential.type "${type}" — one of: ${Object.keys(RECIPES).join(', ')}` }); continue; }
    try {
      const { headers, subject } = await recipe(a.credential || {});
      // Custom headers merged LAST so an explicit declaration beats the recipe's (the escape hatch
      // for header-carried tenancy); values may embed ${ENV:NAME}.
      const extra = subst(a.headers || {}, `actors[${a.name}].headers`);
      // A custom header that replaced the credential material must carry the identity key too.
      const authKey = Object.keys(extra).find((k) => k.toLowerCase() === 'authorization');
      out.push({
        name: a.name, role, tenant,
        headers: { ...(headers || {}), ...extra },
        subject: authKey ? subjectOf(extra[authKey]) : subject,
      });
    } catch (e) { out.push({ name: a.name, role, tenant, void: String(e && e.message || e) }); }
  }
  return out;
}

// ── endpoint autodiscovery (for the anonymous exposure sweep) ────────────────────────────────────────
// Feeds only the UNAUTH slice. Tries well-known spec paths, else an explicit path list; never
// guesses nouns — a spec-less app with no declared paths records a coverage void, not a clean pass.
const SPEC_PATHS = ['/openapi.json', '/v3/api-docs', '/swagger.json', '/api-docs', '/v3/api-docs/swagger-config', '/swagger-resources'];
export async function autodiscover(base, disco = {}, anonHeaders = {}) {
  const tried = [];
  const specCandidates = disco.openapi === false ? [] : [...(Array.isArray(disco.openapi) ? disco.openapi : []), ...SPEC_PATHS];
  for (const p of specCandidates) {
    tried.push(p);
    const r = await req(base + p, { headers: anonHeaders });
    if (!OK(r.status)) continue;
    let spec; try { spec = JSON.parse(r.text); } catch { continue; }
    if (!spec || !isObj(spec.paths)) continue;
    const obj = [], coll = [];
    for (const [path, ops] of Object.entries(spec.paths)) {
      if (!ops || !ops.get) continue;
      const concrete = path.replace(/\{[^}]+\}/g, '1');
      (/\{[^}]+\}/.test(path) ? obj : coll).push(concrete);
    }
    return { specAt: p, tried, paths: [...obj, ...coll].slice(0, CAP_DISCOVER) };
  }
  const explicit = (Array.isArray(disco.paths) ? disco.paths : []).map((p) => p.replace(/\{[^}]+\}/g, '1'));
  return { specAt: null, tried, paths: explicit.slice(0, CAP_DISCOVER) };
}

// ── object ownership (seed | declared) ───────────────────────────────────────────────────────────────
// Returns [{ type, path, owner }]. Fail-closed: a create with no usable id is a void object, never
// silently dropped.
export async function resolveObjects(base, objects, actorsByName) {
  if (!objects) return { items: [], voids: [] };
  const items = [], voids = [];
  if (objects.model === 'declared') {
    for (const it of (objects.items || [])) {
      const owner = actorsByName.get(it.owner);
      if (!owner) { voids.push(`declared object ${it.path}: owner "${it.owner}" is not a declared actor`); continue; }
      if (owner.void) { voids.push(`declared object ${it.path}: owner "${it.owner}" is unmintable (${owner.void})`); continue; }
      items.push({ type: 'declared', path: it.path.replace(/\{[^}]+\}/g, '1'), owner: owner.name });
    }
    return { items: items.slice(0, CAP_OBJECTS), voids };
  }
  // seed
  const ownerNames = objects.owners && objects.owners.length ? objects.owners
    : [...actorsByName.values()].filter((a) => a.role !== 'anon' && !a.void).map((a) => a.name);
  for (const t of (objects.types || [])) {
    for (const name of ownerNames) {
      const owner = actorsByName.get(name);
      if (!owner || owner.void) { voids.push(`seed ${t.name} for ${name}: owner ${owner ? 'unmintable (' + owner.void + ')' : 'is not a declared actor'}`); continue; }
      const c = t.create || {};
      let payload;
      try { payload = c.body != null ? (typeof c.body === 'string' ? subst(c.body, `seed ${t.name}.body`) : JSON.stringify(subst(c.body, `seed ${t.name}.body`))) : undefined; }
      catch (e) { voids.push(`seed ${t.name} for ${name}: ${e.message}`); continue; }
      const headers = { ...(owner.headers || {}), ...(c.contentType === 'form' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : payload ? { 'Content-Type': 'application/json' } : {}) };
      const r = await req(base + c.path, { method: c.method || 'POST', headers, body: payload });
      if (!OK(r.status)) { voids.push(`seed ${t.name} for ${name}: create POST ${c.path} returned HTTP ${r.status || 'unreachable'} (${r.err || 'expected 2xx'}) — cannot obtain an owned object to test.`); continue; }
      let id; try { id = pluck(JSON.parse(r.text), t.idPath); } catch { /* non-json */ }
      if (id == null) { voids.push(`seed ${t.name} for ${name}: created object but no id at body path "${t.idPath}" (HTTP ${r.status}) — fix types[].idPath.`); continue; }
      items.push({ type: t.name, path: t.getPath.replace('{id}', encodeURIComponent(id)), owner: owner.name });
      if (items.length >= CAP_OBJECTS) return { items, voids };
    }
  }
  return { items, voids };
}

// ── did this response actually hand over an object? ──────────────────────────────────────────────────
// Body LENGTH is the wrong test: a filtering backend denies with 200 + `[]`. Only an unambiguously
// empty payload ('' / null / [] / {} / "") counts as empty; a wrapped empty collection still counts
// as disclosure. Deliberately over-reports — a false clean is invisible in review, an over-report is not.
export function disclosesObject(res) {
  if (!OK(res.status)) return false;
  const body = String(res.text ?? '').trim();
  if (!body) return false;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return true; } // non-JSON but non-empty is a body
  if (parsed === null) return false;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (isObj(parsed)) return Object.keys(parsed).length > 0;
  if (typeof parsed === 'string') return parsed.trim().length > 0;
  return true; // a bare number/boolean is still content
}

// Normalised body for identity comparison (whitespace collapsed); null when the body is unknown,
// which switches the classifier to disclosure-only.
export function normBody(res) {
  const t = res && res.text;
  return typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : null;
}

// ── classification ───────────────────────────────────────────────────────────────────────────────────
// Pure so the matrix ↔ vuln-class mapping is testable. `bodies` carries the identity discriminator:
// a cross-identity 2xx is a leak only when the attacker got the OWNER'S body, not its own.
// Byte-identical bodies are an indeterminate VOID; unknown bodies fall back to disclosure-only.
export function classify(owner, attacker, baselineOk, res, bodies = {}) {
  if (!baselineOk) return { void: `owner "${owner.name}" could not read its own object — baseline failed, so any attacker result here is meaningless (not a clean pass).` };
  if (attacker.name === owner.name) return null; // the baseline itself
  if (attacker.role !== 'anon' && owner.role !== 'anon' && attacker.subject && attacker.subject === owner.subject)
    return { void: `actors "${attacker.name}" and "${owner.name}" resolved to the SAME identity (${attacker.subject}) — a cross-identity test needs two DISTINCT accounts; fix the credentials.` };
  const got = disclosesObject(res);
  if (!got) return null; // properly denied
  const at = `${attacker.role}/${attacker.tenant} "${attacker.name}"`, ow = `${owner.role}/${owner.tenant} "${owner.name}"`;
  // Identity discrimination — only when both bodies are known.
  const { ownerBody = null, attackerOwnBody = null } = bodies;
  const attackerBody = normBody(res);
  if (ownerBody != null && attackerBody != null) {
    if (attackerBody !== ownerBody)
      return null; // attacker got a DIFFERENT object — correct isolation
    if (attackerOwnBody != null && attackerOwnBody === ownerBody)
      return { void: `${at} and ${ow} have BYTE-IDENTICAL object bodies at ${res.path || 'this path'}, so a real cross-read cannot be told from the attacker seeing its OWN object — a coverage void, not a pass. Seed distinguishable content per owner (embed the owner name in the create body) to make this cell decisive.` };
    // else: attacker got the owner's body and it is not its own → confirmed leak. Fall through.
  }
  if (attacker.role === 'anon')
    return { type: 'broken-auth', severity: 'high', detail: `anonymous request read ${ow}'s object (${res.len}B, HTTP ${res.status}) — object exposed with no authentication` };
  if (owner.role === 'admin' && attacker.role === 'user')
    return { type: 'bfla', severity: 'critical', detail: `${at} (a user) read an admin-owned object of ${ow} (${res.len}B, HTTP ${res.status}) — vertical privilege escalation` };
  if (attacker.tenant !== owner.tenant)
    return { type: 'cross-tenant', severity: 'critical', detail: `${at} read ${ow}'s object across the tenant boundary (${res.len}B, HTTP ${res.status}) — tenant isolation break` };
  return { type: 'bola', severity: 'critical', detail: `${at} read a peer ${ow}'s object (${res.len}B, HTTP ${res.status}) — horizontal object-level authorization break` };
}

// ── the run ────────────────────────────────────────────────────────────────────────────────────────
export async function run(manifest, opts = {}) {
  // Optional progress sink (no-op by default); the CLI / bola-sweep wrapper passes one.
  const say = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const base = trimSlash(opts.base || process.env.CW_TARGET_URL || manifest.base);
  if (!base) return voidResult('no target: set manifest.base, pass --base, or export CW_TARGET_URL (there is no default — probing localhost would attack an unrelated service and file its posture under this repo).');

  // Pull manifest-named secrets from the local store before probing; an already-set env var wins.
  // A name missing from both is not an error here — the recipe that needs it voids at mint time.
  const needed = secretNames(manifest).filter((n) => !process.env[n]);
  if (needed.length) {
    // A malformed ref table throws (lib/secrets.mjs); turn it into a loud void, not a crash.
    try { ENV = resolveInto(needed).env; }
    catch (e) { return voidResult(`the local secrets store could not be read, so credentials cannot be resolved: ${e.message}`, base); }
  } else ENV = process.env;

  const actors = await resolveActors(manifest.actors || []);
  if (!actors.length) return voidResult('manifest declares no actors[] — at minimum an anonymous baseline plus two peer accounts are needed to test object-level authorization.', base);
  const byName = new Map(actors.map((a) => [a.name, a]));
  const mintable = actors.filter((a) => !a.void);
  say(`minted ${mintable.length}/${actors.length} actor(s): ${actors.map((a) => a.void ? `${a.name}✗` : a.name).join(' ')}`);
  if (mintable.length < 2 && (manifest.objects || {}).model !== 'declared')
    return voidResult(`only ${mintable.length} of ${actors.length} actors could be minted, so no cross-identity test can run. Unmintable: ${actors.filter((a) => a.void).map((a) => `${a.name} (${a.void})`).join('; ') || 'none'}`, base, { actors: actors.map(publicActor) });

  const findings = [], tested = [], voids = [];

  // 1) ownership + the authenticated matrix
  const { items, voids: objVoids } = await resolveObjects(base, manifest.objects, byName);
  voids.push(...objVoids);
  say(`${items.length} owned object(s) to probe across ${mintable.length} actor(s)`);

  // Pass 1 — every owner reads its OWN object once: the baseline AND the discriminator's reference
  // body. Keyed by owner+type so an attacker's own-object body is a lookup, not another request.
  const ownKey = (name, type) => `${name}\0${type}`;
  const ownBody = new Map();
  const baselines = [];
  for (const o of items) {
    const owner = byName.get(o.owner);
    const ownerRes = await req(base + o.path, { headers: owner.headers || {} });
    const body = normBody(ownerRes);
    ownBody.set(ownKey(owner.name, o.type), body);
    baselines.push({ o, owner, ownerRes, ownerBody: body, baselineOk: disclosesObject(ownerRes) });
  }

  // Pass 2 — the attacker matrix, with owner/attacker bodies so a filtering backend is not scored a leak.
  for (const { o, owner, ownerRes, ownerBody, baselineOk } of baselines) {
    say(`probing ${o.type} ${o.path} (owner ${o.owner}) against every actor`);
    for (const attacker of actors) {
      if (attacker.void) { voids.push(`skipped attacker "${attacker.name}" on ${o.path}: ${attacker.void}`); continue; }
      const res = attacker.name === owner.name ? ownerRes : await req(base + o.path, { headers: attacker.headers || {} });
      const attackerOwnBody = ownBody.has(ownKey(attacker.name, o.type)) ? ownBody.get(ownKey(attacker.name, o.type)) : null;
      const verdict = classify(owner, attacker, baselineOk, res, { ownerBody, attackerOwnBody });
      tested.push({ path: o.path, type: o.type, owner: owner.name, attacker: attacker.name, ownerStatus: ownerRes.status, attackerStatus: res.status, attackerLen: res.len });
      if (verdict && verdict.void) { voids.push(verdict.void); continue; }
      if (verdict) findings.push({ ...verdict, path: o.path, objectType: o.type, owner: owner.name, attacker: attacker.name });
    }
  }

  // 2) the anonymous exposure sweep over discovered endpoints (ownership-free)
  const anon = actors.find((a) => a.role === 'anon' && !a.void);
  say('anonymous exposure sweep over discovered endpoints');
  const disco = await autodiscover(base, manifest.discovery || {}, anon ? anon.headers : {});
  const seenPaths = new Set(items.map((i) => i.path));
  for (const p of disco.paths) {
    if (seenPaths.has(p)) continue;
    const r = await req(base + p, { headers: anon ? anon.headers : {} });
    tested.push({ path: p, type: 'discovered', attacker: anon ? anon.name : 'anon', attackerStatus: r.status, attackerLen: r.len });
    if (disclosesObject(r))
      findings.push({ type: 'unauth-exposure', severity: 'high', path: p, detail: `object-level endpoint ${p} returned 2xx (${r.len}B) with no authentication — missing authorization`, source: disco.specAt ? `openapi ${disco.specAt}` : 'discovery.paths' });
  }

  return finalize({ base, actors, items, disco, findings, tested, voids });
}

const publicActor = (a) => ({ name: a.name, role: a.role, tenant: a.tenant, minted: !a.void, ...(a.void && { void: a.void }) });

function finalize({ base, actors, items, disco, findings, tested, voids }) {
  const bySeverity = ['critical', 'high', 'medium'].reduce((m, s) => (m[s] = findings.filter((f) => f.severity === s).length, m), {});
  const ranAny = tested.length > 0;
  // explicit uncertainty: nothing probed is a VOID, not "no findings".
  if (!ranAny) return voidResult(`nothing was probed: no owned objects could be seeded/declared and endpoint discovery found none (tried ${disco.tried.join(', ') || 'no spec paths'}). Declare objects[] or discovery.paths[], or check the target is up.`, base, { actors: actors.map(publicActor), voids });
  const summary = {
    base, ran: true, specAt: disco.specAt, pathSource: disco.specAt ? 'openapi' : (disco.paths.length ? 'discovery.paths' : items.length ? 'seed/declared' : 'none'),
    actors: actors.length, mintedActors: actors.filter((a) => !a.void).length,
    ownedObjects: items.length, endpointsProbed: tested.length, findings: findings.length, bySeverity,
    voids: voids.length,
    verdict: findings.length
      ? `POTENTIAL ${[...new Set(findings.map((f) => f.type))].join('/').toUpperCase()} — ${findings.length} finding(s) across ${tested.length} probe(s); review.`
      : `no object-level authorization break across ${tested.length} probe(s) over ${items.length} owned object(s) and ${actors.filter((a) => !a.void).length} minted actor(s)${voids.length ? ` — but ${voids.length} coverage void(s): ${voids.slice(0, 3).join(' | ')}${voids.length > 3 ? ' | …' : ''}` : ''}.`,
  };
  return { tool: 'authz-bola', summary, findings, tested, actors: actors.map(publicActor), voids };
}

// ── manifest loading + trust gate (mirrors bin/commitwork.mjs resolveManifestPath) ───────────────────
// Bundled means operator-held (the private dir, monitor/private/bola, CW_BOLA_MANIFEST_DIR) or shipped
// (manifests/bola, which holds only the synthetic example). Both are trusted: neither comes from the
// repository under test. The private dir wins a name clash.
const bundledDirs = () => [bolaManifestDirFor(ROOT), join(ROOT, 'manifests', 'bola')];
function listBundled() {
  const names = new Set();
  for (const d of bundledDirs()) {
    try { for (const f of readdirSync(d)) if (f.endsWith('.json')) names.add(f.replace(/\.json$/, '')); }
    catch { /* a directory that is not there bundles nothing */ }
  }
  return [...names].sort();
}
export function resolveManifestPath(flag) {
  const explicit = flag || process.env.CW_BOLA_MANIFEST;
  if (explicit) {
    for (const d of bundledDirs()) {
      const named = join(d, `${explicit}.json`);
      if (existsSync(named)) return { path: named, source: 'bundled' };
    }
    if (existsSync(explicit)) return { path: resolve(explicit), source: 'explicit' };
    throw new Error(`BOLA manifest not found: "${explicit}". Bundled: ${listBundled().join(', ') || '(none)'}; or pass a path.`);
  }
  for (const cand of ['bola.json', 'commitwork.json']) {
    const p = resolve(process.cwd(), cand);
    if (existsSync(p)) return { path: p, source: 'repo-local' };
  }
  throw new Error(`no BOLA manifest. Use --manifest <path|name>, set CW_BOLA_MANIFEST, or add bola.json to the cwd. Bundled: ${listBundled().join(', ') || '(none)'}.`);
}
// A repo-local manifest carries executable intent (login POSTs, seed creates), so it needs an
// explicit opt-in; bundled manifests are trusted. Same rule as bin/commitwork.mjs.
export function assertTrusted(source, path, opts) {
  if (source === 'bundled') return;
  if (opts.trustRepoManifest || process.env.COMMITWORK_TRUST_REPO_MANIFEST === '1') return;
  throw new Error(`refusing to run a ${source} BOLA manifest (${path}) without opt-in.\n` +
    `  It can mint credentials and POST seed objects using your env secrets against manifest.base.\n` +
    `  Review it, then opt in with:  --trust-repo-manifest   (or COMMITWORK_TRUST_REPO_MANIFEST=1)`);
}

export function loadManifest(path) {
  let raw; try { raw = readFileSync(path, 'utf8'); } catch (e) { throw new Error(`cannot read manifest ${path}: ${e.message}`); }
  let m; try { m = JSON.parse(raw); } catch (e) { throw new Error(`manifest ${path} is not valid JSON: ${e.message}`); }
  // a #bola block inside a commitwork.json, or a standalone bola manifest
  if (m.bola && isObj(m.bola)) m = m.bola;
  const { errors } = validateManifest(m);
  if (errors.length) throw new Error(`manifest ${path} is invalid:\n  - ${errors.join('\n  - ')}`);
  return m;
}

// ── zero-dep structural validation (mirrors schema/bola-manifest.schema.json) ────────────────────────
// Which fields each recipe reads. Checked at load time so a missing/typo'd env field is a manifest
// error before any request, not an unmintable-actor void halfway through a probe.
export const CRED_SPEC = {
  none: { required: [], optional: [] },
  'static-bearer': { required: [], optional: ['tokenEnv'] },
  'api-key': { required: [], optional: ['header', 'valueEnv'] },
  keycloak: { required: ['passwordEnv'], optional: ['url', 'realm', 'client', 'username', 'usernameEnv'] },
  supabase: { required: ['url', 'passwordEnv'], optional: ['apikeyEnv', 'email', 'emailEnv'] },
  'login-post': { required: ['url'], optional: ['method', 'contentType', 'fields', 'capture'] },
};

export function validateManifest(m) {
  const errors = [];
  if (!isObj(m)) return { errors: ['manifest is not an object'] };
  if (!Array.isArray(m.actors) || !m.actors.length) errors.push('actors[] (non-empty array) is required');
  else m.actors.forEach((a, i) => {
    if (!isObj(a)) { errors.push(`actors[${i}] is not an object`); return; }
    if (!a.name || typeof a.name !== 'string') errors.push(`actors[${i}].name (string) is required`);
    if (a.role && !['anon', 'user', 'admin'].includes(a.role)) errors.push(`actors[${i}].role must be anon|user|admin (got "${a.role}")`);
    if (a.headers !== undefined) {
      if (!isObj(a.headers)) errors.push(`actors[${i}].headers must be an object of name:value pairs`);
      else for (const [k, v] of Object.entries(a.headers)) {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) errors.push(`actors[${i}].headers["${k}"] is not a valid HTTP header name`);
        if (typeof v !== 'string') errors.push(`actors[${i}].headers["${k}"] must be a string (it may embed \${ENV:NAME}); got ${typeof v}`);
      }
    }
    if (a.credential !== undefined) {
      if (!isObj(a.credential)) errors.push(`actors[${i}].credential must be an object`);
      else if (a.credential.type && !RECIPES[a.credential.type]) errors.push(`actors[${i}].credential.type "${a.credential.type}" is unknown — one of: ${Object.keys(RECIPES).join(', ')}`);
      else {
        const spec = CRED_SPEC[a.credential.type || 'none'];
        const known = new Set(['type', ...spec.required, ...spec.optional]);
        for (const f of spec.required) {
          if (!a.credential[f]) errors.push(`actors[${i}].credential.${f} is required for type "${a.credential.type}" — without it this actor cannot be minted, and every matrix cell needing it would be a void.`);
        }
        for (const k of Object.keys(a.credential)) {
          if (!known.has(k)) errors.push(`actors[${i}].credential.${k} is not a field of type "${a.credential.type || 'none'}" — it would be silently ignored. Valid: ${[...known].join(', ')}.`);
        }
      }
    }
  });
  if (m.objects !== undefined) {
    const o = m.objects;
    if (!isObj(o)) errors.push('objects must be an object');
    else if (o.model && !['seed', 'declared'].includes(o.model)) errors.push(`objects.model must be seed|declared (got "${o.model}")`);
    else if (o.model === 'declared' && !Array.isArray(o.items)) errors.push('objects.items[] is required when objects.model is "declared"');
    else if ((o.model === 'seed' || o.model === undefined) && o.types !== undefined) {
      if (!Array.isArray(o.types)) errors.push('objects.types must be an array');
      else o.types.forEach((t, i) => {
        if (!t.create || !t.create.path) errors.push(`objects.types[${i}].create.path is required`);
        if (!t.idPath) errors.push(`objects.types[${i}].idPath is required (where to read the created id from the response)`);
        if (!t.getPath || !t.getPath.includes('{id}')) errors.push(`objects.types[${i}].getPath must contain {id}`);
      });
    }
  }
  if (m.discovery !== undefined && !isObj(m.discovery)) errors.push('discovery must be an object');
  if (m.objects === undefined && m.discovery === undefined) errors.push('nothing to probe: declare objects (seed/declared) or a discovery block — a manifest with neither can only ever record a void.');
  return { errors };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const opts = { manifest: null, base: null, trustRepoManifest: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest' || a === '-m') opts.manifest = argv[++i];
    else if (a === '--base' || a === '--url') opts.base = argv[++i];
    else if (a === '--out' || a === '-o') opts.out = argv[++i];
    else if (a === '--trust-repo-manifest') opts.trustRepoManifest = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (!opts.manifest && !a.startsWith('-')) opts.manifest = a;
    else { console.error(`bola-run: unknown argument "${a}"`); process.exit(2); }
  }
  let manifest;
  try {
    const { path, source } = resolveManifestPath(opts.manifest);
    assertTrusted(source, path, opts);
    manifest = loadManifest(path);
  } catch (e) { console.error(`bola-run: ${e.message}`); process.exit(2); }
  // Progress rides stderr so stdout stays a single clean JSON document; --out persists atomically.
  opts.onProgress = (line) => process.stderr.write(`[bola] ${line}\n`);
  const result = await run(manifest, opts);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.out) {
    const tmp = `${opts.out}.tmp-${process.pid}`;
    try { writeFileSync(tmp, json); renameSync(tmp, opts.out); process.stderr.write(`[bola] wrote ${opts.out}\n`); }
    catch (e) { console.error(`bola-run: could not write --out ${opts.out}: ${e.message}`); process.exit(2); }
  }
  process.stdout.write(json);
}
function printHelp() {
  process.stdout.write(`commitwork BOLA runner — manifest-driven object-level authorization testing.

usage:
  node bin/bola-run.mjs --manifest <path|name> [--base URL] [--trust-repo-manifest]
  node bin/bola-run.mjs                          (auto-discovers ./bola.json or ./commitwork.json #bola)

  --manifest, -m   bundled name (${listBundled().join(', ') || 'none yet'}) or a path
  --base, --url    override manifest.base / CW_TARGET_URL (the running target to probe)
  --out, -o        also persist the JSON result to this path (atomic tmp+rename); progress → stderr
  --trust-repo-manifest   execute a repo-local manifest (it can mint creds + POST seed objects)

Secrets are read from the env vars the manifest NAMES (…Env fields), never from the manifest itself.
Emits authz-bola.json to stdout — the same evidence the sweep rollup already ingests.
`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
