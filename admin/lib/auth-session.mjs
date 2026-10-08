import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadRegistry } from '../../monitor/registry.mjs';
import { resolveInto, reportMissing } from '../../lib/secrets.mjs';
import { sendMail } from '../../lib/mail.mjs';
import { listUsers, issueEmailCode, linkGithub, GITHUB_LINKED_ELSEWHERE } from '../auth.mjs';
import { loadSessions, persistSessions, sessionKey, sessionStorePath } from '../sessions.mjs';

// fact: bound once at boot by initAuthSession
let PORT = 0;
let LOCAL_PORT = 0;

// ── Admin OAuth login scaffold (feature e) ──────────────────────────────────────────────────────
// SCAFFOLD ONLY — real Authorization-Code-with-PKCE flow structure, secrets kept SERVER-SIDE, but
// no real credentials are shipped. The flow stays inert until BOTH the client id and secret for a
// provider are supplied via env; unconfigured providers answer 503 "not configured" (never crash).
//
// Env vars the operator MUST set to activate a provider:
//   Google:  GOOGLE_OAUTH_CLIENT_ID   GOOGLE_OAUTH_CLIENT_SECRET
//   GitHub:  GITHUB_OAUTH_CLIENT_ID   GITHUB_OAUTH_CLIENT_SECRET
// Optional:
//   CW_OAUTH_BASE_URL   public origin used to build redirect_uri (default http://127.0.0.1:PORT)
//
// The client SECRET is read here and used only in the server-side token exchange — it is NEVER sent
// to the browser, never embedded in any served HTML/JS, and never returned by /auth/session. The
// browser only ever sees the client id (public by design) and the PKCE code_challenge.
const oauthBaseUrl = () => process.env.CW_OAUTH_BASE_URL || `http://127.0.0.1:${PORT}`;

// Client secrets resolve from the macOS Keychain at BOOT, once, into this process only — never a
// `.env` file (a plaintext credential beside the code), and never a launchd plist (mode 644, and
// bin/test/no-argv-secrets.test.mjs records a real case on this box where a plist put a live key in
// ProgramArguments on a KeepAlive job, so the exposure window was permanent).
//
// An explicit environment variable still WINS — `GOOGLE_OAUTH_CLIENT_SECRET=… node admin/serve.mjs`
// keeps working, so adopting this cannot take away a credential that works today. Absence is not an
// error here: OAuth is optional, and a provider missing its secret already reports as unconfigured
// and answers 503 rather than pretending. What must not happen is a secret being *declared* and
// silently unreadable, so a declared-but-unresolvable ref is reported loudly at boot.
const OAUTH_SECRETS = ['GOOGLE_OAUTH_CLIENT_SECRET', 'GITHUB_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_ID'];
function resolveOauthEnv() {
  try {
    const r = resolveInto(OAUTH_SECRETS, { env: process.env });
    const declaredButBroken = r.missing.filter((m) => m.reason !== 'undeclared');
    if (declaredButBroken.length) reportMissing(declaredButBroken, { context: 'admin OAuth' });
    for (const x of r.resolved) if (x.source === 'keychain') console.log(`[admin] ${x.name} ← keychain`);
    return r.env;
  } catch (e) {
    // a malformed secrets table must not take the panel down — but it must be seen
    console.error(`[admin] secrets table unreadable: ${e.message}`);
    return process.env;
  }
}

// ── THE PROVIDER-ENDPOINT SEAM ──────────────────────────────────────────────────────────────────
// CW_OAUTH_ENDPOINT_BASE rewrites the ORIGIN of every provider URL below, preserving path and
// query, so the whole OAuth flow can be driven against a local stub. Without it the callback is
// untestable: tokenUrl points at the real provider, so no test can reach the code that authorises
// an identity, mints a session, or parks a second-factor challenge.
//
// LOOPBACK ONLY, AND IT THROWS. This is the one place the CLIENT SECRET leaves the process, so the
// seam is constrained rather than trusted. Anyone who can set this variable already controls the
// process and could read the secret directly — the constraint is not a defence against them. It is
// there so the seam cannot become an exfiltration route by accident: a typo, a copied .env, a
// container inheriting a stale value. A non-loopback base is refused loudly at the moment it would
// be used, not silently ignored, because an ignored override sends the secret to the REAL provider
// while the operator believes it is going to a stub.
//
// Read at CALL time, like every other input path here — a module-load capture would pin the answer
// before a test could set it.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function oauthEndpointBase() {
  const raw = process.env.CW_OAUTH_ENDPOINT_BASE;
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch {
    // Not echoed: a value that is not a URL may be a secret pasted into the wrong variable.
    throw new Error('CW_OAUTH_ENDPOINT_BASE is not a URL (value withheld from the log)');
  }
  if (!LOOPBACK_HOSTS.has(u.hostname)) {
    throw new Error(`CW_OAUTH_ENDPOINT_BASE must be loopback (127.0.0.1, localhost or ::1) — got `
      + `${u.hostname}. This variable redirects where the OAuth CLIENT SECRET is sent; a remote `
      + `value is refused rather than honoured.`);
  }
  return u.origin;
}
/** A provider endpoint, with its origin redirected to the stub when the seam is set. */
const providerUrl = (url) => {
  const base = oauthEndpointBase();
  if (!base) return url;
  const real = new URL(url);
  return new URL(`${real.pathname}${real.search}`, base).href;
};

const OAUTH = {
  google: {
    label: 'Google',
    clientId: '',
    clientSecret: '',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    idEnv: 'GOOGLE_OAUTH_CLIENT_ID', secretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    // Identity endpoint. A token proves the flow completed; it does not say WHO completed it.
    // Without this call the panel cannot tell one Google account from another.
    userinfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  },
  github: {
    label: 'GitHub',
    clientId: '',
    clientSecret: '',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // user:email is required to read the VERIFIED primary address; /user alone returns null for
    // anyone whose email is private, and an unverified address is not an identity.
    scope: 'read:user user:email repo',
    idEnv: 'GITHUB_OAUTH_CLIENT_ID', secretEnv: 'GITHUB_OAUTH_CLIENT_SECRET',
    userinfoUrl: 'https://api.github.com/user',
    emailsUrl: 'https://api.github.com/user/emails',
  },
};

// Resolve the provider identity behind an access token → { email, verified } or null.
// UNVERIFIED ADDRESSES ARE REJECTED: on a provider that lets a user claim an arbitrary unverified
// address, accepting one would let anybody assert the operator's email and walk in.
async function oauthIdentity(provider, accessToken) {
  const c = OAUTH[provider];
  if (!c || !c.userinfoUrl) return null;
  const get = async (url) => {
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': 'commitwork-admin' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  };
  const me = await get(providerUrl(c.userinfoUrl));
  if (provider === 'google') {
    return { email: me.email || null, verified: me.email_verified === true };
  }
  // GitHub: /user.email is null when the address is private, so ask the emails endpoint and take
  // the primary verified one.
  if (me.email) {
    const list = await get(providerUrl(c.emailsUrl)).catch(() => []);
    const hit = (Array.isArray(list) ? list : []).find((e) => e.email === me.email);
    if (hit) return { email: hit.email, verified: hit.verified === true };
  }
  const list = await get(providerUrl(c.emailsUrl)).catch(() => []);
  const primary = (Array.isArray(list) ? list : []).find((e) => e.primary && e.verified);
  return primary ? { email: primary.email, verified: true } : { email: me.email || null, verified: false };
}
// a provider is only live when BOTH halves are present — a lone id or lone secret is treated as
// unconfigured so we never start a flow we cannot complete (the callback would 503 anyway).
const oauthConfigured = (p) => !!(OAUTH[p] && OAUTH[p].clientId && OAUTH[p].clientSecret);
// Linking records a login and an id, so it asks for the public profile and nothing else. The
// sign-in scope above (user:email, repo) is audit finding 0075 and must not ride along.
const GITHUB_LINK_SCOPE = 'read:user';
// Why a GitHub link cannot start on this box, or null when it can. The profile page shows this on
// a disabled button, so a link that would fail after GitHub's consent screen is never offered.
function githubLinkBlocked() {
  const c = OAUTH.github;
  if (!c.clientId) return `GitHub sign-in is not configured on this box (${c.idEnv})`;
  if (!c.clientSecret) return `GitHub sign-in is not configured on this box (${c.secretEnv})`;
  if (process.env.CW_OAUTH_LIVE_EXCHANGE !== '1') {
    return 'GitHub linking needs CW_OAUTH_LIVE_EXCHANGE=1 on this box — without it the code GitHub returns is never exchanged';
  }
  return null;
}
// THE REDIRECT MUST COME BACK TO THE ORIGIN THE USER STARTED FROM.
//
// This was a single static base (CW_OAUTH_BASE_URL, defaulting to http://127.0.0.1:PORT), which
// can only ever be right for ONE origin. Signing in at https://commitwork.portll.net therefore
// handed Google a loopback redirect_uri, and the browser came back to http://127.0.0.1:7878 —
// where the session cookie was then set. The user ended up authenticated on loopback and still
// logged out on the public host, having apparently "logged in". The visible symptom was landing on
// 127.0.0.1:7878/?login=google; the real damage was a cookie on the wrong origin.
//
// The origin is now taken from the REQUEST, but only from an ALLOWLIST — Host is caller-controlled,
// and an unchecked one lets an attacker point the redirect at a host they own and collect the
// authorisation code. Two sources, both declarations rather than inferences:
//   · the hostnames this area DECLARES in monitor/projects.json (deploy.hostnames), served over
//     https because the tunnel terminates TLS in front of them — never read x-forwarded-proto,
//     which the caller can also set;
//   · loopback on either of this process's own ports.
// Anything else falls back to the configured base, so an unrecognised Host cannot redirect anywhere
// new. CW_OAUTH_BASE_URL still wins outright when set, for a deployment that fronts this panel
// under a name the registry does not know.
let DECLARED_HOSTS = new Set();
function readDeclaredHosts() {
  try {
    const reg = loadRegistry({ quiet: true });
    const own = (reg.areas || []).find((a) => a.slug === 'commitwork-admin');
    return new Set(((own && own.deploy && own.deploy.hostnames) || []).map((h) => h.toLowerCase()));
  } catch { return new Set(); }   // a broken registry must not take OAuth down; it degrades to the base
}

function oauthOrigin(req) {
  if (process.env.CW_OAUTH_BASE_URL) return process.env.CW_OAUTH_BASE_URL;
  const raw = String((req && req.headers && req.headers.host) || '').toLowerCase();
  const bare = raw.replace(/:\d+$/, '');
  if (DECLARED_HOSTS.has(bare)) return `https://${bare}`;
  if ((bare === '127.0.0.1' || bare === 'localhost' || bare === '[::1]')
      && (raw.endsWith(`:${PORT}`) || raw.endsWith(`:${LOCAL_PORT}`))) return `http://${raw}`;
  return oauthBaseUrl();
}
const oauthRedirectUri = (p, req) => `${oauthOrigin(req)}/auth/callback/${p}`;

// A same-origin path, or null. Anything with a scheme, an authority ('//host'), a backslash or a
// control character is rejected rather than sanitised.
function safeReturnPath(v) {
  if (typeof v !== 'string' || !v || v.length > 512) return null;
  if (v[0] !== '/' || v[1] === '/' || v[1] === '\\') return null;
  if (/[\x00-\x1f\x7f\\]/.test(v)) return null;
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return v;
}
// the "not configured" 503 body names exactly which env vars are missing for that provider.
function oauthNotConfigured(res, p, send) {
  const c = OAUTH[p];
  return send(503, {
    ok: false, provider: p, error: 'OAuth not configured',
    detail: `Set ${c.idEnv} and ${c.secretEnv} env vars to activate ${c.label} login`,
    setEnv: [c.idEnv, c.secretEnv],
  });
}
// PKCE (RFC 7636, S256): high-entropy verifier + its SHA-256 base64url challenge. Base64url per
// RFC 4648 §5 (no padding). The verifier stays server-side, bound to the flow's `state`; only the
// challenge is put on the authorize URL.
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pkceVerifier = () => b64url(randomBytes(32));                 // 43-char verifier
const pkceChallenge = (verifier) => b64url(createHash('sha256').update(verifier).digest());
// In-memory transient flow store (state -> {provider, verifier, createdAt}). Single-process, like
// the sweep `jobs`/`running` maps; entries expire after 10 min and are one-shot (deleted on use).
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const oauthFlows = new Map();
// SSO SECOND-FACTOR CHALLENGES. An OAuth flow that proved an identity for an account with a
// CONFIRMED authenticator parks here instead of minting a session. Short-lived on purpose — this
// holds a live provider access token, and five minutes is longer than anyone takes to read a code
// off a phone. Pruned by pruneOauth() alongside the flows.
const SSO_TOTP_TTL_MS = 5 * 60 * 1000;
const ssoPending = new Map();
// In-memory session store (sid -> {provider, createdAt, lastSeenAt, token?}). The access token, when
// a real exchange runs, is held here server-side and referenced by the opaque cookie sid — it is
// never exposed to client JS.
//
// The TTL is IDLE time, not age: adminSession() stamps lastSeenAt on every authenticated request, so
// a session in use keeps extending and one left alone expires 8h after the last request. Absolute
// age was the previous rule and it logged the operator out mid-task at the 8h mark with work open.
// CONSEQUENCE, stated because it is a real trade: the panel polls while a tab is open, so an
// unattended open tab holds a session indefinitely. Extending on activity is what was asked for, and
// an idle timeout cannot also be a maximum lifetime.
const OAUTH_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const REAUTH_TTL_MS = 5 * 60 * 1000;
const sameAccount = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const reauthFresh = (session) => Boolean(session && Number.isFinite(session.reauthAt)
  && Date.now() - session.reauthAt >= 0 && Date.now() - session.reauthAt <= REAUTH_TTL_MS);
// KEYED BY sha256(sid), NOT BY THE SID. The map used to be keyed by the raw cookie value; it is
// keyed by the hash now so that the in-memory table and the on-disk one are the SAME table rather
// than two representations somebody has to keep in step. See admin/sessions.mjs for why the raw id
// must never reach the file. sessionKey() is the only place the conversion happens.
const oauthSessions = new Map();
// Restored from disk at boot, which is what makes the panel's own "update" button stop logging the
// operator out. Expiry is applied by loadSessions(), so a restart cannot refresh an idle session.
// The count is printed rather than assumed: sessions surviving a restart is a change in this
// panel's security posture, and a change like that should be visible in the log, not inferred.
function pruneOauth() {
  const now = Date.now();
  for (const [k, v] of oauthFlows) if (now - v.createdAt > OAUTH_FLOW_TTL_MS) oauthFlows.delete(k);
  for (const [k, v] of ssoPending) if (now - v.createdAt > SSO_TOTP_TTL_MS) ssoPending.delete(k);
  // `?? v.createdAt` so a session minted before this change is not treated as idle since the epoch
  // and pruned on the first request after a restart.
  let evicted = 0;
  for (const [k, v] of oauthSessions) {
    if (now - (v.lastSeenAt ?? v.createdAt) > OAUTH_SESSION_TTL_MS) { oauthSessions.delete(k); evicted++; }
  }
  // An expiry that is only in memory would come back on the next boot from a file that still holds
  // it — the prune has to reach the store it was loaded from, or the timeout is decorative.
  if (evicted) persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
}
// One-shot: a matching flow is removed on lookup, whatever the caller then does with it.
function takeOauthFlow(state, provider) {
  pruneOauth();
  for (const [k, v] of oauthFlows) {
    if (safeStrEq(k, state) && v.provider === provider) { oauthFlows.delete(k); return v; }
  }
  return null;
}
// A link attempt always lands on the profile page with an outcome CODE; the page owns the
// sentences, so nothing a provider sends is reflected into it.
function linkOutcome(res, outcome) {
  res.writeHead(302, { location: `/profile/?github=${outcome}` });
  return res.end();
}
// The callback half of link mode. It never mints a session and never keeps the access token,
// which lives in this function's scope for two requests and is dropped.
async function completeGithubLink(req, res, flow, code) {
  const s = adminSession(req);
  const sid = sidFromReq(req);
  // THE BINDING. Without it, an attacker's code and state delivered to a victim's browser would
  // record the attacker's GitHub identity on the victim's account.
  if (!s || !s.user || !sid || !safeStrEq(sessionKey(sid), flow.sessionKey) || !sameAccount(s.user, flow.user)) {
    return linkOutcome(res, 'session');
  }
  if (githubLinkBlocked()) return linkOutcome(res, 'unavailable');
  const c = OAUTH.github;
  let account;
  try {
    const tok = await fetch(providerUrl(c.tokenUrl), { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri('github', req),
        client_id: c.clientId, client_secret: c.clientSecret, code_verifier: flow.verifier }).toString(),
      signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const access = tok && tok.access_token;
    if (!access) throw new Error(`token exchange returned no access_token (${(tok && tok.error) || 'no error given'})`);
    const r = await fetch(providerUrl(c.userinfoUrl), {
      headers: { authorization: `Bearer ${access}`, accept: 'application/json', 'user-agent': 'commitwork-admin' },
      signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`GitHub userinfo → HTTP ${r.status}`);
    account = await r.json();
  } catch (e) {
    console.error(`[admin] GitHub link for ${s.user} failed: ${e.message}`);
    return linkOutcome(res, 'failed');
  }
  try { linkGithub(s.user, { login: account && account.login, id: account && account.id }); }
  catch (e) {
    console.error(`[admin] GitHub link for ${s.user} refused: ${e.message}`);
    if (e.code === GITHUB_LINKED_ELSEWHERE) return linkOutcome(res, 'taken');
    return linkOutcome(res, 'refused');
  }
  console.log(`[admin] ${s.user} linked GitHub @${account.login}`);
  return linkOutcome(res, 'linked');
}
// ── AUTH COST GOVERNOR (R8b) ────────────────────────────────────────────────────────────────────
// Every credential route costs one scrypt at N=2^15 — ~100ms of SYNCHRONOUS single-threaded CPU.
// Unthrottled, that is both an unlimited-guess oracle and a trivial denial of service: a few
// hundred POSTs and the panel serves nothing else, because the thread doing the hashing is the
// thread that would answer anything.
//
// The budget lives HERE, not in auth.mjs, and it is checked BEFORE the auth module is entered.
// That ordering is the point: auth.mjs's critical section must never be reachable often enough to
// matter, and a limiter that only bites after the KDF has run has already paid the cost it exists
// to avoid.
//
// KEYING. Everything arrives from 127.0.0.1 (cloudflared dials the loopback origin), so the socket
// address carries no information. `cf-connecting-ip` is the real client for tunnelled requests and
// is absent for genuinely local ones, which is exactly the partition we want: the public internet
// is bucketed per source IP, the box itself shares one generous local bucket.
//
// Deliberately NOT keyed on the submitted email: that would let anyone lock the operator out of
// their own panel by spraying their address. Source-keyed throttling cannot be weaponised that way.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;          // per source, per window
const AUTH_LOCKOUT_MS = 15 * 60 * 1000;
const AUTH_MAX_INFLIGHT = 2;           // concurrent credential operations, process-wide
const authBuckets = new Map();         // key -> { count, windowStart, lockedUntil, strikes }
let authInflight = 0;
const authSlotEnter = () => { authInflight += 1; };
// Reserve at execution time too: requests can finish reading their bodies after a budget check.
const authSlotTryEnter = () => {
  if (authInflight >= AUTH_MAX_INFLIGHT) return false;
  authInflight += 1;
  return true;
};
const authSlotLeave = () => { authInflight -= 1; };

const authKey = (req) => String(req.headers['cf-connecting-ip'] || '').trim() || 'local';

// Bound the map so a spray across forged CF-Connecting-IP values cannot grow it without limit.
function pruneAuthBuckets(now) {
  if (authBuckets.size < 4096) return;
  for (const [k, b] of authBuckets) {
    if (now > b.windowStart + AUTH_WINDOW_MS && now > (b.lockedUntil || 0)) authBuckets.delete(k);
  }
}

// -> null when the attempt may proceed, or { code, body, retryAfter } describing the refusal.
// Mints and mails a sign-in code; reports whether it was sent
async function emailCodeChallenge(email) {
  const issued = issueEmailCode(email);
  if (!issued.ok) return { sent: false, detail: issued.reason };
  let r;
  try {
    r = await sendMail({ to: issued.email, subject: 'commitwork sign-in code',
      text: `Your commitwork sign-in code is ${issued.code}. It expires in 10 minutes. If you did not request it, ignore this message.` });
  } catch (e) { return { sent: false, detail: `mail threw (${e && e.message})` }; }
  return { sent: !!(r && r.sent), detail: r && r.sent ? null : `mail ${(r && r.status) || 'error'}${r && r.reason ? ` (${r.reason})` : ''}` };
}

function authBudgetCheck(req) {
  const now = Date.now();
  pruneAuthBuckets(now);
  if (authInflight >= AUTH_MAX_INFLIGHT) {
    // Shed rather than queue. A queued credential request still costs a scrypt when it lands, so
    // queueing converts a burst into a longer outage instead of a shorter one.
    return { code: 503, retryAfter: 2, body: { ok: false, error: 'authentication is busy; retry shortly' } };
  }
  const key = authKey(req);
  let b = authBuckets.get(key);
  if (!b) { b = { count: 0, windowStart: now, lockedUntil: 0, strikes: 0 }; authBuckets.set(key, b); }
  if (b.lockedUntil > now) {
    return { code: 429, retryAfter: Math.ceil((b.lockedUntil - now) / 1000),
      body: { ok: false, error: 'too many authentication attempts; try again later' } };
  }
  if (now - b.windowStart > AUTH_WINDOW_MS) { b.windowStart = now; b.count = 0; }
  if (b.count >= AUTH_MAX_ATTEMPTS) {
    // Exponential backoff on repeat offenders, capped: a sustained guesser gets slower without
    // the operator's own bucket ever being locked longer than they would wait to notice.
    b.strikes = Math.min(b.strikes + 1, 5);
    b.lockedUntil = now + AUTH_LOCKOUT_MS * 2 ** (b.strikes - 1);
    b.windowStart = now; b.count = 0;
    return { code: 429, retryAfter: Math.ceil((b.lockedUntil - now) / 1000),
      body: { ok: false, error: 'too many authentication attempts; try again later' } };
  }
  b.count += 1;
  return null;
}

// A SUCCESSFUL credential check clears the bucket: the limiter exists to bound guessing, and an
// operator who typed one password wrong should not carry that toward a lockout for a quarter hour.
function authBudgetSucceeded(req) {
  const b = authBuckets.get(authKey(req));
  if (b) { b.count = 0; b.strikes = 0; b.lockedUntil = 0; }
}

// parse the opaque session id out of the Cookie header (cookie name: cw_admin_sid).
function sidFromReq(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'cw_admin_sid') return decodeURIComponent(rest.join('='));
  }
  return null;
}
// the admin-login gate: resolve the request's session, or null. Constant-time sid compare against
// the store's keys is unnecessary (Map lookup is by exact key), but we prune first so an expired
// cookie never validates.
// TWO CLOCKS, deliberately. The session WINDOW is extended by the operator doing something; the
// polls that run INSIDE that window are timers, not people. /api/status fires every 1.2s and
// /api/state every 8s while a tab is open, so if a heartbeat slid the window an unattended tab would
// hold a session open forever and the idle timeout would never once fire.
//
// Authentication is unaffected — a heartbeat still requires a valid session. It just does not
// count as evidence that anyone is there.
const HEARTBEAT_PATHS = new Set(['/api/status', '/api/state', '/api/panel/health']);

function adminSession(req) {
  pruneOauth();
  const sid = sidFromReq(req);
  if (!sid) return null;
  const s = oauthSessions.get(sessionKey(sid));
  if (s) {
    let path = '';
    try { path = new URL(req.url, 'http://127.0.0.1').pathname; } catch { /* unparseable url slides, as any other request would */ }
    // Stamped AFTER the prune, so an already-idle-out session is gone before it can refresh itself.
    if (!HEARTBEAT_PATHS.has(path)) {
      s.lastSeenAt = Date.now();
      // Throttled inside persistSessions (once a minute at most), and traffic-driven rather than on
      // a timer — a syscall per request for a field nothing reads until the next boot would be a
      // poor trade, and an interval would keep the event loop alive for no other reason.
      // Not forced: losing up to a minute of lastSeenAt across a crash makes a session look a
      // minute more idle than it was, which costs nothing.
      persistSessions(oauthSessions);
    }
  }
  return s || null;
}

function restoreSessions() {
  // The account store is read FIRST and passed in: a restored session is only as good as the
  // account it names, and this is the one moment that can be checked without a store read per
  // request. An unreadable users.json yields an empty set and therefore no sessions — which is
  // right, because a store you cannot read is not one you can authenticate against.
  let known = new Set();
  try { known = new Set(listUsers().map((u) => String(u.email || '').trim().toLowerCase())); }
  catch (e) { console.error(`[admin] cannot read the account store to validate sessions (${e.message}); restoring none`); }
  const { sessions, restored, dropped } = loadSessions({
    ttlMs: OAUTH_SESSION_TTL_MS,
    knownUsers: known,
    onNote: (m) => console.error(`[admin] ${m}`),
  });
  for (const [k, v] of sessions) oauthSessions.set(k, v);
  if (restored || dropped) {
    console.error(`[admin] restored ${restored} session(s) from ${sessionStorePath()}`
      + (dropped ? `, dropped ${dropped} expired or unreadable` : '')
      + ' — delete that file to sign everybody out');
  }
}

// constant-time string compare for the `state` round-trip check (defence-in-depth; the Map delete
// is the real one-shot guard).
function safeStrEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return timingSafeEqual(ba, bb); } catch { return false; }
}

// contract: run once at boot, before the first request
function initAuthSession({ port, localPort }) {
  PORT = port;
  LOCAL_PORT = localPort;
  const env = resolveOauthEnv();
  OAUTH.google.clientId = env.GOOGLE_OAUTH_CLIENT_ID || '';
  OAUTH.google.clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  OAUTH.github.clientId = env.GITHUB_OAUTH_CLIENT_ID || '';
  OAUTH.github.clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET || '';
  DECLARED_HOSTS = readDeclaredHosts();
  restoreSessions();
}

export {
  initAuthSession,
  providerUrl,
  OAUTH,
  oauthIdentity,
  oauthConfigured,
  GITHUB_LINK_SCOPE,
  githubLinkBlocked,
  oauthOrigin,
  oauthRedirectUri,
  safeReturnPath,
  oauthNotConfigured,
  b64url,
  pkceVerifier,
  pkceChallenge,
  oauthFlows,
  SSO_TOTP_TTL_MS,
  ssoPending,
  OAUTH_SESSION_TTL_MS,
  REAUTH_TTL_MS,
  sameAccount,
  reauthFresh,
  oauthSessions,
  pruneOauth,
  takeOauthFlow,
  linkOutcome,
  completeGithubLink,
  authSlotEnter,
  authSlotTryEnter,
  authSlotLeave,
  emailCodeChallenge,
  authBudgetCheck,
  authBudgetSucceeded,
  sidFromReq,
  adminSession,
  safeStrEq,
};
