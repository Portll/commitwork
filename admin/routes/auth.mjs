import { randomBytes } from 'node:crypto';
import { needsBootstrap, bootstrapRootAsync, authenticateAsync, confirmTotpAsync, findByEmail, bootstrapSsoRoot, externalSsoAllowed, setExternalSsoAllowed, beginPasskeyRegistrationAsync, finishPasskeyRegistration, beginPasskeyLogin, finishPasskeyLogin, listPasskeys, removePasskeyAsync, accountFactors, setPasswordAsync, reauthenticatePasswordAsync, verifySecondFactorAsync } from '../auth.mjs';
import { rpFor, declaredHosts } from '../rp-origin.mjs';
import { persistSessions, sessionKey } from '../sessions.mjs';
import { providerUrl, OAUTH, oauthIdentity, oauthConfigured, GITHUB_LINK_SCOPE, githubLinkBlocked, oauthRedirectUri, safeReturnPath, oauthNotConfigured, b64url, pkceVerifier, pkceChallenge, oauthFlows, SSO_TOTP_TTL_MS, ssoPending, OAUTH_SESSION_TTL_MS, REAUTH_TTL_MS, sameAccount, reauthFresh, oauthSessions, pruneOauth, takeOauthFlow, linkOutcome, completeGithubLink, authSlotEnter, authSlotTryEnter, authSlotLeave, emailCodeChallenge, authBudgetCheck, authBudgetSucceeded, sidFromReq, adminSession } from '../lib/auth-session.mjs';

export const AUTH_UNHANDLED = Symbol('auth-unhandled');

// The body reader catches synchronous throws; async handlers must consume their own rejections.
function readAsyncAuthBody(req, readJsonBody, send, handler) {
  return readJsonBody(req, (body, err) => {
    if (err) return send(400, { ok: false, error: err });
    return Promise.resolve().then(() => handler(body)).catch(e => {
      console.error('[admin] async authentication failed:', e && e.stack || e);
      return send(500, { ok: false, error: 'authentication could not be completed' });
    });
  });
}

function takeAuthSlot(res) {
  if (authSlotTryEnter()) return true;
  res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '2' });
  res.end(JSON.stringify({ ok: false, error: 'authentication is busy; retry shortly' }));
  return false;
}

// contract: answers an /auth/* request, else AUTH_UNHANDLED
export function authHandle({ req, res, send, pathname, isLoopbackReq, readJsonBody, sendErr, port, localPort }) {
  const PORT = port;
  const LOCAL_PORT = localPort;
  // ── Admin OAuth login scaffold (feature e) ────────────────────────────────────────────────────
  // Feature-status probe the client uses to decide whether to SHOW the login buttons at all, and to
  // ── password + TOTP auth ──────────────────────────────────────────────────────────────────
  // The OAuth flow below stays as the optional SSO front-end; this is the one that works today.
  // Both converge on the same session store, so downstream code cares only that a session exists.

  // POST /auth/bootstrap {email,password} — ONLY while zero users exist AND from loopback.
  if (req.method === 'POST' && pathname === '/auth/bootstrap') {
    if (!isLoopbackReq) return send(403, { ok: false, error: `the root user can only be created from the operator port, http://127.0.0.1:${LOCAL_PORT} — not from the published port ${PORT}, which is external even when you are sitting at the box` });
    if (!needsBootstrap()) return send(409, { ok: false, error: 'bootstrap window is closed: a user already exists' });
    // Loopback-only already, but bootstrapRootAsync() runs nine scrypts (password + eight recovery
    // hashes), so an unbudgeted local loop could saturate the hashing workers.
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (!takeAuthSlot(res)) return;
      try {
        let out;
        try { out = await bootstrapRootAsync({ email: body.email, password: body.password }); }
        finally { authSlotLeave(); }
        authBudgetSucceeded(req);
        // secret + recovery codes are returned EXACTLY ONCE — we never store them in plaintext
        return send(200, { ok: true, ...out, next: 'add the otpauth URI to your authenticator, then POST /auth/totp/confirm with a code' });
      } catch (e) { return send(400, { ok: false, error: e.message }); }
    });
  }

  // POST /auth/totp/confirm {email,password,token} — proves enrolment before 2FA is enforced.
  // The PASSWORD is required because this route sits under /auth/, which the login gate exempts, and
  // it mutates credential state (flips totpConfirmed, burns lastTotpStep). Without proof of ownership
  // an unauthenticated caller who lands a code advances the replay guard past the operator's own.
  // The failure message is deliberately identical for a wrong password and a wrong code: telling the
  // two apart would make this route a password oracle that bypasses the login form's own answer.
  if (req.method === 'POST' && pathname === '/auth/totp/confirm') {
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (!takeAuthSlot(res)) return;
      let ok;
      try { ok = await confirmTotpAsync(body.email, body.password, body.token); } finally { authSlotLeave(); }
      if (ok) authBudgetSucceeded(req);
      return send(ok ? 200 : 400, ok ? { ok: true, totpConfirmed: true } : { ok: false, error: 'could not confirm — check the password and the code on the authenticator' });
    });
  }

  // POST /auth/login {username,password,token}
  if (req.method === 'POST' && pathname === '/auth/login') {
    // Budget checked BEFORE the body is read and long before authenticate() is entered, so a
    // refused attempt costs no scrypt at all.
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (!takeAuthSlot(res)) return;
      let r;
      try { r = await authenticateAsync({ email: body.email, password: body.password, token: body.token }); }
      finally { authSlotLeave(); }
      // fact: first token-less attempt mails the code
      if (!r.ok && r.factor === 'email' && !(body && body.token)) {
        return emailCodeChallenge(body.email).then((c) => send(401, { ok: false, error: r.reason, factor: 'email', ...c }));
      }
      if (!r.ok) return send(401, { ok: false, error: r.reason, ...(r.factor ? { factor: r.factor } : {}) });
      authBudgetSucceeded(req);
      const sid = b64url(randomBytes(24));
      oauthSessions.set(sessionKey(sid), { provider: 'password', createdAt: Date.now(), lastSeenAt: Date.now(), user: r.user.email });
      persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': `cw_admin_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SESSION_TTL_MS / 1000}`,
      });
      return res.end(JSON.stringify({ ok: true, user: r.user.email, usedRecovery: !!r.usedRecovery }));
    });
  }

  // Re-authentication grants a short, in-memory permission to mutate credentials. It belongs to
  // one account, expires independently of the session, and is deliberately omitted by
  // sessions.mjs's persistence allowlist.
  if (req.method === 'POST' && pathname === '/auth/reauth/password') {
    const sess = adminSession(req);
    if (!sess || !sess.user) return send(401, { ok: false, error: 'sign in before re-authenticating' });
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (!takeAuthSlot(res)) return;
      const account = sess.user;
      let ok;
      try { ok = await reauthenticatePasswordAsync(account, body.password); } finally { authSlotLeave(); }
      if (adminSession(req) !== sess || !sameAccount(sess.user, account)) return send(401, { ok: false, error: 'sign in before re-authenticating' });
      if (!ok) return send(401, { ok: false, error: 'password was not accepted' });
      authBudgetSucceeded(req);
      sess.reauthAt = Date.now();
      return send(200, { ok: true, reauthFresh: true, reauthTtlSecs: REAUTH_TTL_MS / 1000 });
    });
  }

  // Completes an SSO sign-in that stopped for the account's authenticator. The challenge id comes
  // from the HttpOnly cookie the callback set, never from the body — a caller must have completed
  // the provider flow in THIS browser, so a stolen code alone is not a login.
  //
  // The rate budget is the same one the password routes use, because this is a code-guessing
  // surface with a six-digit answer.
  if (req.method === 'POST' && pathname === '/auth/sso/totp') {
    pruneOauth();
    const cid = /(^|;\s*)cw_sso_totp=([^;]+)/.exec(String(req.headers.cookie || ''));
    const challengeId = cid ? decodeURIComponent(cid[2]) : null;
    const pending = challengeId ? ssoPending.get(challengeId) : null;
    // One message for "no challenge" and "expired challenge": which of the two it is tells a
    // caller whether the id they hold was ever real.
    if (!pending) return send(401, { ok: false, error: 'no sign-in is waiting for a second factor (start again)' });
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify({ ok: false, error: budget.error })); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (ssoPending.get(challengeId) !== pending) return send(401, { ok: false, error: 'no sign-in is waiting for a second factor (start again)' });
      const acct = findByEmail(pending.email);
      if (!takeAuthSlot(res)) return;
      let out;
      try { out = await verifySecondFactorAsync(acct, body && body.token); } finally { authSlotLeave(); }
      if (!out.ok) return send(401, { ok: false, error: out.reason || 'invalid second factor' });
      // ONE-SHOT: burn the challenge whether or not what follows succeeds. A challenge that
      // survives its own use is a replayable login.
      if (ssoPending.get(challengeId) !== pending || Date.now() - pending.createdAt > SSO_TOTP_TTL_MS) {
        return send(401, { ok: false, error: 'no sign-in is waiting for a second factor (start again)' });
      }
      ssoPending.delete(challengeId);
      authBudgetSucceeded(req);
      const sid = b64url(randomBytes(24));
      oauthSessions.set(sessionKey(sid), { provider: pending.provider, createdAt: Date.now(),
        lastSeenAt: Date.now(), token: pending.token || null, user: pending.email });
      persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
      res.writeHead(200, {
        'content-type': 'application/json',
        // clear the challenge cookie in the same response that replaces it with a session
        'set-cookie': [
          'cw_sso_totp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
          `cw_admin_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SESSION_TTL_MS / 1000}`,
        ],
      });
      return res.end(JSON.stringify({ ok: true, returnTo: pending.returnTo || '/', usedRecovery: !!out.usedRecovery }));
    });
  }

  if (req.method === 'POST' && pathname === '/auth/password/set') {
    const sess = adminSession(req);
    if (!sess || !sess.user) return send(401, { ok: false, error: 'sign in before changing credentials' });
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      if (!takeAuthSlot(res)) return;
      const account = sess.user;
      const freshProof = reauthFresh(sess);
      let out;
      try {
        out = await setPasswordAsync({ email: account, current: body.current, newPassword: body.newPassword,
          reauthenticated: freshProof }, () =>
          adminSession(req) === sess && sameAccount(sess.user, account)
          && (!freshProof || reauthFresh(sess)));
      } finally { authSlotLeave(); }
      if (!out.ok) return send(401, { ok: false, error: out.reason });
      authBudgetSucceeded(req);
      sess.reauthAt = Date.now();
      return send(200, out);
    });
  }

  // ── PASSKEYS (WebAuthn) ─────────────────────────────────────────────────────────────────────
  // Here rather than in a routes/ module for one reason: finishing a passkey login MINTS A SESSION,
  // and `oauthSessions` + the cookie live in this file. Verification and storage are not here —
  // lib/webauthn.mjs does the crypto and admin/auth.mjs owns the store, so what follows is only
  // the HTTP shape and the session.
  //
  // THE RP POLICY IS RESOLVED, NEVER ACCEPTED. rpFor() reads the declared-hostname allowlist (the
  // same source oauthOrigin uses) and returns rpId:null for a Host nobody declared. Taking it from
  // the request instead would let an attacker have the browser sign for a relying party they own
  // and then be verified against that same value — a check that cannot fail.
  //
  // Rate limited with the SAME budget as /auth/login. A passkey login is a login: leaving it off
  // the budget would move the cheap-guess surface rather than remove it, and the assertion path
  // does public-key verification per attempt.
  if (req.method === 'POST' && pathname.startsWith('/auth/passkey/')) {
    const rp = rpFor(req, { ports: [PORT, LOCAL_PORT] });
    const stage = pathname.slice('/auth/passkey/'.length);
    const budget = authBudgetCheck(req);
    if (budget) { res.writeHead(budget.code, { 'content-type': 'application/json', 'retry-after': String(budget.retryAfter) }); return res.end(JSON.stringify(budget.body)); }
    // An undeclared Host gets no ceremony at all. Refusing here — before any store read — means the
    // panel never issues a challenge it would be unable to honestly verify.
    if (!rp.rpId && stage !== 'login/begin') {
      return send(400, { ok: false, error: `this panel does not answer to '${String(req.headers.host || '')}' — passkeys are bound to a declared hostname (monitor/projects.json deploy.hostnames, or CW_PANEL_ORIGIN)` });
    }
    return readAsyncAuthBody(req, readJsonBody, send, async body => {
      const b = body || {};
      if (stage === 'register/begin') {
        const sess = adminSession(req);
        const fresh = reauthFresh(sess) && sameAccount(sess.user, b.email);
        if (!takeAuthSlot(res)) return;
        try {
          const r = await beginPasskeyRegistrationAsync({ email: b.email, password: b.password, reauthenticated: fresh },
            () => adminSession(req) === sess && sameAccount(sess.user, b.email) && reauthFresh(sess));
          if (!r.ok) return send(401, { ok: false, error: r.reason });
          return send(200, { ...r, rpId: rp.rpId });
        } finally { authSlotLeave(); }
      }
      if (stage === 'register/finish') {
        const r = finishPasskeyRegistration({
          challengeId: b.challengeId, label: b.label, rp,
          clientDataJSON: Buffer.from(String(b.clientDataJSON || ''), 'base64'),
          attestationObject: Buffer.from(String(b.attestationObject || ''), 'base64'),
        });
        return send(r.ok ? 200 : 400, r);
      }
      // Revocation accepts a password or fresh reauthentication for the same account.
      // Both proofs are checked again after hashing, before the locked mutation.
      if (stage === 'revoke') {
        const sessR = adminSession(req);
        const freshR = reauthFresh(sessR) && sameAccount(sessR.user, b.email);
        if (!takeAuthSlot(res)) return;
        try {
          const r = await removePasskeyAsync({ email: b.email, credentialId: b.credentialId, password: b.password, reauthenticated: freshR },
            () => adminSession(req) === sessR && sameAccount(sessR.user, b.email) && reauthFresh(sessR));
          return send(r.ok ? 200 : 400, r.ok ? r : { ok: false, error: r.reason });
        } finally { authSlotLeave(); }
      }
      if (stage === 'login/begin') {
        return send(200, { ...beginPasskeyLogin({ email: b.email }), rpId: rp.rpId });
      }
      if (stage === 'login/finish') {
        const r = finishPasskeyLogin({
          challengeId: b.challengeId, credentialId: b.credentialId, rp,
          clientDataJSON: Buffer.from(String(b.clientDataJSON || ''), 'base64'),
          authenticatorData: Buffer.from(String(b.authenticatorData || ''), 'base64'),
          signature: Buffer.from(String(b.signature || ''), 'base64'),
        });
        if (!r.ok) return send(401, { ok: false, error: r.reason });
        authBudgetSucceeded(req);
        const sid = b64url(randomBytes(24));
        oauthSessions.set(sessionKey(sid), { provider: 'passkey', createdAt: Date.now(), lastSeenAt: Date.now(), user: r.user.email });
        persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `cw_admin_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SESSION_TTL_MS / 1000}`,
        });
        return res.end(JSON.stringify({ ok: true, user: r.user.email, userVerified: r.userVerified }));
      }
      return send(404, { ok: false, error: `unknown passkey stage '${stage}'` });
    });
  }

  // reflect the current session. Never returns secrets — only the public "configured" flag + id.
  if (req.method === 'GET' && pathname === '/auth/session') {
    const s = adminSession(req);
    // fact: this answered with no passkey or TOTP state at all, and admin/index.html reads
    // s.passkeys from it / the menu's three-way passkey state could therefore only ever
    // resolve to UNKNOWN — a grey that no action could clear, because the field it tested was
    // never sent. An unknown must be a determination, not a structural dead end; this one was
    // indistinguishable from a real read failure and so hid one for as long as it existed
    // (expiry: never, prev: missing)
    //
    // FAIL CLOSED, and this is the whole subtlety: the fields are attached ONLY when the
    // account was actually read. If the lookup returns nothing, they are OMITTED rather than
    // sent empty — `passkeys: []` would be the panel's word for "signed in with none", which
    // is a claim, where absence is correctly read back as unknown.
    // Unauthenticated callers get none of it: the login page fetches this route too.
    const su = s && s.user ? findByEmail(s.user) : null;
    const acct = su ? {
      // ISSUED and CONFIRMED are different answers, exactly as /api/me keeps them
      totpEnrolled: !!su.totpSecret,
      totpConfirmed: !!su.totpConfirmed,
    } : {};
    return send(200, {
      providers: Object.fromEntries(Object.entries(OAUTH).map(([k, c]) => [k, {
        label: c.label, configured: oauthConfigured(k),
      }])),
      anyConfigured: Object.keys(OAUTH).some(oauthConfigured),
      authed: !!s, provider: s ? s.provider : null, user: s ? (s.user || null) : null,
      // operator-binding state, so the UI can say which of the three situations it is in rather
      // than showing a login that cannot succeed
      operatorBound: !needsBootstrap(),
      externalSso: externalSsoAllowed(),
      // the OTHER gate on remote sign-in: the switch above is store truth (users.json settings,
      // the single SOT), but the login page offers Google only when the server also runs with
      // CW_OAUTH_LIVE_EXCHANGE=1. Surfacing it here lets the menu SAY "on, but the server can't
      // exchange tokens" instead of a ticked box that silently does nothing remotely.
      liveExchange: process.env.CW_OAUTH_LIVE_EXCHANGE === '1',
      // the toggle is only offered where it can be used: on the box itself
      canSetExternalSso: isLoopbackReq,
      local: isLoopbackReq,
      ...acct,
      // Redacted accessors own these shapes. null means the account/store was not established;
      // [] means it was measured and has none.
      passkeys: s ? listPasskeys(s.user) : null,
      factors: s ? accountFactors(s.user) : null,
      reauthFresh: reauthFresh(s),
      reauthTtlSecs: REAUTH_TTL_MS / 1000,
      // THE RELYING-PARTY POLICY FOR THIS EXACT REQUEST, which is what decides whether enrolment
      // can succeed at all — and which the panel previously could not see until it had already
      // asked the operator for their password and put a system prompt in front of them. A WebAuthn
      // RP ID is a DOMAIN: opened at http://127.0.0.1:7878 this resolves to the IP literal
      // '127.0.0.1', and an IP is not a domain. Sent here so the control can refuse in advance and
      // name the origin that works, rather than failing at the last step with a DOMException.
      rpId: rpFor(req, { ports: [PORT, LOCAL_PORT] }).rpId,
      declaredHosts: [...declaredHosts()],
      localPort: LOCAL_PORT,
      port: PORT,
    });
  }
  // Tick/untick remote sign-in. LOOPBACK ONLY, deliberately: this is the switch that decides
  // whether the outside world may authenticate at all, so it must not be reachable by the outside
  // world — including by an already-authenticated remote session, which would otherwise be able to
  // hold the door open for itself. CSRF is already enforced blanket-wide for non-GET above.
  if (req.method === 'POST' && pathname === '/auth/sso/external') {
    if (!isLoopbackReq) return send(403, { ok: false, error: `external sign-in can only be changed from the operator port, http://127.0.0.1:${LOCAL_PORT} — not from the published port ${PORT}, which is external even when you are sitting at the box` });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      if (typeof body.enabled !== 'boolean') return send(400, { ok: false, error: 'enabled must be true or false' });
      const now = setExternalSsoAllowed(body.enabled);
      console.log(`[admin] external SSO ${now ? 'ENABLED' : 'disabled'}`);
      return send(200, { ok: true, externalSso: now });
    });
  }
  // logout — drop the session server-side and expire the cookie. Never unlinks anything on disk.
  if (req.method === 'POST' && pathname === '/auth/logout') {
    const sid = sidFromReq(req);
    if (sid) {
      oauthSessions.delete(sessionKey(sid));
      // FORCED. A logout that only cleared memory would be undone by the next restart reloading
      // the very session it just ended — persistence turning the one control that must always
      // work into one that works until the panel bounces.
      persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
    }
    res.writeHead(200, { 'content-type': 'application/json',
      'set-cookie': 'cw_admin_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    return res.end(JSON.stringify({ ok: true }));
  }
  // LINK MODE — /auth/github/link : a signed-in operator proves which GitHub account is theirs.
  // Same provider config and callback as sign-in; the flow is marked `link` and bound to the
  // session that started it, so the callback cannot turn it into a sign-in.
  if (req.method === 'GET' && pathname === '/auth/github/link') {
    const s = adminSession(req);
    if (!s || !s.user) return sendErr({ req, send }, 401, 'Sign in first', 'Linking records a GitHub account on the account you are signed in as, so it needs a session.');
    const blocked = githubLinkBlocked();
    if (blocked) return sendErr({ req, send }, 503, 'GitHub linking is unavailable', blocked, { back: '/profile/' });
    pruneOauth();
    const c = OAUTH.github;
    const state = b64url(randomBytes(24));
    const verifier = pkceVerifier();
    oauthFlows.set(state, { provider: 'github', purpose: 'link', verifier, createdAt: Date.now(),
      sessionKey: sessionKey(sidFromReq(req)), user: s.user });
    const u = new URL(providerUrl(c.authorizeUrl));
    u.searchParams.set('client_id', c.clientId);
    u.searchParams.set('redirect_uri', oauthRedirectUri('github', req));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', GITHUB_LINK_SCOPE);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', pkceChallenge(verifier));
    u.searchParams.set('code_challenge_method', 'S256');
    res.writeHead(302, { location: u.toString() });
    return res.end();
  }
  // STEP 1 — /auth/login/:provider : build the provider authorize URL from env (client id + PKCE)
  // and 302 to it. 503 (never crash) when the provider's env vars are unset.
  {
    const lm = req.method === 'GET' && req.url.match(/^\/auth\/login\/([a-z]+)(?:\?.*)?$/);
    if (lm) {
      const p = lm[1];
      if (!OAUTH[p]) return send(404, { ok: false, error: `unknown provider '${p}' (google|github)` });
      if (!oauthConfigured(p)) return oauthNotConfigured(res, p, send);
      pruneOauth();
      const c = OAUTH[p];
      const state = b64url(randomBytes(24));
      const verifier = pkceVerifier();
      const query = new URL(req.url, 'http://x').searchParams;
      const wantsReauth = query.get('reauth') === '1';
      const reauthSession = wantsReauth ? adminSession(req) : null;
      if (wantsReauth && (!reauthSession || !reauthSession.user)) {
        return send(401, { ok: false, error: 'sign in before asking the provider to re-authenticate you' });
      }
      // The return path is held SERVER-side against the one-shot state, never echoed through the
      // provider, so nothing the provider returns can redirect the browser.
      const returnTo = safeReturnPath(query.get('return'));
      oauthFlows.set(state, { provider: p, purpose: 'signin', verifier, returnTo, createdAt: Date.now(),
        reauthUser: wantsReauth ? reauthSession.user : null });
      const u = new URL(providerUrl(c.authorizeUrl));
      u.searchParams.set('client_id', c.clientId);        // public id only — the SECRET is not here
      u.searchParams.set('redirect_uri', oauthRedirectUri(p, req));
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', c.scope);
      u.searchParams.set('state', state);
      u.searchParams.set('code_challenge', pkceChallenge(verifier)); // PKCE S256 client-side portion
      u.searchParams.set('code_challenge_method', 'S256');
      if (wantsReauth) u.searchParams.set('prompt', 'login');
      if (p === 'google') u.searchParams.set('access_type', 'offline');
      res.writeHead(302, { location: u.toString() });
      return res.end();
    }
  }
  // STEP 2 — /auth/callback/:provider : validate state, exchange the code SERVER-SIDE using the
  // client SECRET (from env, never in client JS) + the PKCE verifier, mint a session cookie, and
  // redirect back to the panel. 503 when unconfigured. NOTE: the actual token POST is stubbed off
  // by default (this is a scaffold — no live exchange). Set CW_OAUTH_LIVE_EXCHANGE=1 to perform the
  // real fetch to the provider's token endpoint once real credentials exist.
  {
    const cm = req.method === 'GET' && req.url.match(/^\/auth\/callback\/([a-z]+)(?:\?(.*))?$/);
    if (cm) {
      const p = cm[1];
      if (!OAUTH[p]) return send(404, { ok: false, error: `unknown provider '${p}' (google|github)` });
      if (!oauthConfigured(p)) return oauthNotConfigured(res, p, send);
      const q = new URLSearchParams(cm[2] || '');
      const code = q.get('code'); const state = q.get('state'); const errParam = q.get('error');
      if (errParam) {
        // a declined link returns to the profile page it started from; the state dies either way
        const declined = state ? takeOauthFlow(state, p) : null;
        if (declined && declined.purpose === 'link') return linkOutcome(res, 'denied');
        return send(400, { ok: false, error: `provider returned error: ${errParam}` });
      }
      if (!code || !state) return sendErr({ req, send }, 400, 'Sign-in did not complete', 'The provider returned no code or state. Start the sign-in again.');
      // one-shot state → verifier lookup (CSRF + PKCE binding). Deleted on lookup (replay guard).
      const flow = takeOauthFlow(state, p);
      if (!flow) return sendErr({ req, send }, 400, 'Sign-in expired', 'That sign-in link was already used or has expired. Start again.');
      // Dispatch on the purpose recorded with the state, never on what the request carries: a link
      // state cannot mint a session, and a sign-in state cannot link.
      if (flow.purpose === 'link') {
        completeGithubLink(req, res, flow, code).catch((e) => {
          console.error(`[admin] GitHub link callback failed: ${e && e.stack ? e.stack : e}`);
          if (!res.headersSent) linkOutcome(res, 'failed');
        });
        return;
      }
      if (flow.purpose !== 'signin') return sendErr({ req, send }, 400, 'Sign-in expired', 'That sign-in link was already used or has expired. Start again.');
      const c = OAUTH[p];
      const finishSession = (token, user) => {
        const sid = b64url(randomBytes(24));
        // `token` stays in the in-memory record and is stripped on the way to disk by
        // sessions.mjs's PERSISTED allowlist — a live provider credential is the one thing here
        // that must never be written down.
        const reauthAt = flow.reauthUser && sameAccount(flow.reauthUser, user) ? Date.now() : null;
        oauthSessions.set(sessionKey(sid), { provider: p, createdAt: Date.now(), lastSeenAt: Date.now(), token: token || null,
          user: user || null, ...(reauthAt ? { reauthAt } : {}) });
        persistSessions(oauthSessions, { force: true, onNote: (m) => console.error(`[admin] ${m}`) });
        res.writeHead(302, {
          // '/', not '/?login=<provider>'. Nothing reads that param — a marker with no consumer —
          // and it outlives the moment it describes: it stays in the address bar, in history, and
          // in any link the operator copies, long after the login it referred to.
          location: flow.returnTo || '/',
          // HttpOnly ⇒ unreadable by client JS; SameSite=Lax; not Secure on localhost http.
          'set-cookie': `cw_admin_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_SESSION_TTL_MS / 1000}`,
        });
        return res.end();
      };
      // THE AUTHORISATION GATE. Completing an OAuth flow proves an identity; it does not grant
      // access. Three rules, in order:
      //   1. The address must be one the provider has VERIFIED, or it is not an identity at all.
      //   2. First-run trust-on-first-use: while ZERO users exist AND the request is loopback, the
      //      first identity to arrive BECOMES the operator. That window is the same one
      //      bootstrapRoot() uses — it closes permanently on first write, so a published panel can
      //      never bind itself an admin. Off-box, an unknown identity is refused instead.
      //   3. Thereafter only a KNOWN account may sign in, and a remote one only while the operator
      //      has ticked "allow external sign-in" (default off).
      const authorise = (ident) => {
        if (!ident || !ident.email || !ident.verified) {
          return { ok: false, code: 403, error: 'the provider returned no verified email address — cannot establish an identity' };
        }
        let user = findByEmail(ident.email);
        if (!user) {
          if (!needsBootstrap()) {
            return { ok: false, code: 403, error: `${ident.email} is not an operator account on this panel` };
          }
          if (!isLoopbackReq) {
            return { ok: false, code: 403, error: `this panel has no operator yet — the first account must be bound from the operator port, http://127.0.0.1:${LOCAL_PORT} (the published port ${PORT} is external by definition and cannot mint the first account)` };
          }
          bootstrapSsoRoot({ email: ident.email, provider: p });
          console.log(`[admin] operator bound via ${p}: ${ident.email}`);
          user = findByEmail(ident.email);
        }
        if (!isLoopbackReq && !externalSsoAllowed()) {
          return { ok: false, code: 403, error: `external sign-in is disabled. Locality here means the OPERATOR PORT, not the address: every request to the published port ${PORT} counts as external even from this box, because cloudflared connects from 127.0.0.1 too. Open http://127.0.0.1:${LOCAL_PORT} and turn on "Allow external sign-in".` };
        }
        return { ok: true, user };
      };
      // SCAFFOLD default: do NOT hit the provider — and therefore do NOT mint a session. Minting
      // here would hand a valid cw_admin_sid to anyone who can reach this route: the `state` is
      // one-shot and PKCE-bound, but a caller obtains one simply by starting the flow itself, so
      // nothing about the user is verified. An operator who configures client credentials but
      // leaves CW_OAUTH_LIVE_EXCHANGE unset would believe the panel is authenticated when it is
      // not. Refuse loudly instead; a session must never be cheaper to obtain than a real login.
      if (process.env.CW_OAUTH_LIVE_EXCHANGE !== '1') {
        return send(503, { ok: false, error: 'oauth is in scaffold mode: no session issued. Set CW_OAUTH_LIVE_EXCHANGE=1 (with real client credentials) to perform the real token exchange.' });
      }
      // LIVE path (only when explicitly opted in AND real creds exist): server-side token exchange.
      // The client SECRET is sent here, host→provider, never to the browser.
      const body = new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri(p, req),
        client_id: c.clientId, client_secret: c.clientSecret, code_verifier: flow.verifier,
      });
      fetch(providerUrl(c.tokenUrl), { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString() })
        .then((r) => r.json().catch(() => ({})))
        .then(async (tok) => {
          const access = tok && (tok.access_token || tok.id_token);
          if (!access) return send(502, { ok: false, error: 'token exchange returned no access_token', providerError: tok && tok.error });
          // A token is not an identity. Ask the provider WHO this is, then authorise — a failure
          // to resolve the identity must deny, never fall through to a session.
          let ident;
          try { ident = await oauthIdentity(p, access); }
          catch (e) { return send(502, { ok: false, error: 'could not read the account identity from the provider: ' + e.message }); }
          const verdict = authorise(ident);
          if (!verdict.ok) return send(verdict.code, { ok: false, error: verdict.error });
          // THE SECOND FACTOR, OVER SSO. Completing a Google flow proves an identity and nothing
          // more, so an account with a confirmed authenticator was two-factor through its own
          // password form and SINGLE-factor through this route — and the weaker path is the one
          // that decides. Whoever held the Google account held the panel.
          //
          // The challenge id goes in a short-lived HttpOnly cookie rather than the redirect URL,
          // for the reason finishSession gives about `?login=<provider>`: a marker in the address
          // bar outlives the moment it describes, and stays in history and in any copied link.
          // This one is a bearer of a pending login, so that would be worse than untidy.
          const acct = findByEmail(verdict.user.email);
          if (acct && (acct.totpConfirmed || acct.emailFactor)) {
            const cid = b64url(randomBytes(24));
            // fact: email-only accounts get their code mailed here
            const factor = acct.totpConfirmed ? 'totp' : 'email';
            const mailed = factor === 'email' ? await emailCodeChallenge(acct.email) : null;
            ssoPending.set(cid, { email: verdict.user.email, provider: p, token: access,
              createdAt: Date.now(), returnTo: flow.returnTo || '/', factor, mailed });
            res.writeHead(302, {
              location: '/',
              'set-cookie': `cw_sso_totp=${encodeURIComponent(cid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SSO_TOTP_TTL_MS / 1000}`,
            });
            return res.end();
          }
          return finishSession(access, verdict.user.email);
        })
        .catch((e) => send(502, { ok: false, error: 'token exchange failed: ' + e.message }));
      return;
    }
  }
  // Gated example — GitHub project listing. Behind the admin-login gate: a valid session cookie is
  // required. The real GitHub API call is STUBBED (this is a scaffold). With a live session that
  // carries a token, this is where a server-side `fetch('https://api.github.com/user/repos', {
  // headers: { authorization: 'Bearer '+session.token } })` would run — the token never leaves here.
  return AUTH_UNHANDLED;
}
