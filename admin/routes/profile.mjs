// admin/routes/profile.mjs — the profile page's server half: who is logged in, TOTP, linked GitHub.
//
// Every route requires a session, loopback included — the dispatcher sits above the login gate,
// so the check below is the only gate these routes get.
// NEVER RETURNED: password hash, salt, totpSecret, recovery codes, or a GitHub access token.

import { requireSession } from '../lib/route-auth.mjs';
import { reissueTotp, confirmTotp, disableTotp, findByEmail, verifyTotp, linkGithub, unlinkGithub, setEmailFactor, reauthenticatePassword, GITHUB_LINKED_ELSEWHERE }
  from '../auth.mjs';

// Returns the session or null.

// Whether signing in with GitHub can link an account here. null means the server did not say,
// which the page renders as unavailable, never as available.
function githubLinkState(ctx) {
  if (typeof ctx.githubLinkBlocked !== 'function') return null;
  const reason = ctx.githubLinkBlocked();
  return { available: !reason, reason: reason || null };
}

export const routes = [
  // GET /api/me — the logged-in identity; nothing here is a secret
  { method: 'GET', path: '/api/me', handle: (ctx) => {
    const { send } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    const u = findByEmail(s.user);
    // a session can outlive its account (break-glass, hand-deleted) — refuse rather than fabricate
    if (!u) return send(401, { ok: false, error: 'session no longer matches an account' });
    return send(200, {
      ok: true,
      email: u.email,
      provider: s.provider,
      totpConfirmed: !!u.totpConfirmed,
      // ISSUED vs CONFIRMED are distinct states; the page needs both
      totpEnrolled: !!u.totpSecret,
      github: u.github ? { login: u.github.login } : null,   // id and linkedAt stay server-side
      githubLink: githubLinkState(ctx),
      sessionAgeMs: Date.now() - (s.createdAt || Date.now()),
    });
  } },

  // POST /api/me/totp/reissue — mint a fresh secret and hand back the otpauth URI + secret ONCE.
  // Nothing ever serves it back out; a missed scan means another reissue.
  // Reissuing resets totpConfirmed, so on an enforced account it would lower protection on a session
  // alone; disable (which needs a current code) comes first there.
  { method: 'POST', path: '/api/me/totp/reissue', handle: (ctx) => {
    const { send } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    const u = findByEmail(s.user);
    if (u && u.totpConfirmed) {
      return send(409, { ok: false, error: 'second-factor sign-in is enforced — disable it with a current code first, then issue a new secret' });
    }
    try {
      const out = reissueTotp(s.user);
      return send(200, { ok: true, totpSecret: out.totpSecret, otpauth: out.otpauth });
    } catch (e) { return send(400, { ok: false, error: e.message }); }
  } },

  // POST /api/me/totp/confirm {password, token} — proves enrolment and turns enforcement on.
  // Password required despite the session — a hijacked cookie must not flip 2FA enforcement on.
  { method: 'POST', path: '/api/me/totp/confirm', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const ok = confirmTotp(s.user, body && body.password, body && body.token);
      return send(ok ? 200 : 400, ok
        ? { ok: true, totpConfirmed: true }
        : { ok: false, error: 'could not confirm — check the password and the code on the authenticator' });
    });
  } },

  // POST /api/me/email-factor {enabled, password} — the password proves the switch, when one exists
  { method: 'POST', path: '/api/me/email-factor', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const acct = findByEmail(s.user);
      if (!acct) return send(401, { ok: false, error: 'no account' });
      if (acct.salt && acct.hash) {
        const pw = reauthenticatePassword(s.user, body && body.password);
        const ok = pw === true || (pw && pw.ok === true);
        if (!ok) return send(401, { ok: false, error: 'the current password is required to change the second factor' });
      }
      let out;
      try { out = setEmailFactor(s.user, !!(body && body.enabled)); } catch (e) { return send(400, { ok: false, error: e.message }); }
      return send(200, { ok: true, emailFactor: out.emailFactor });
    });
  } },

  // POST /api/me/totp/disable {token} — require a VALID current TOTP before disabling.
  // disableTotp() is the unverified break-glass primitive — the current code is checked here first.
  { method: 'POST', path: '/api/me/totp/disable', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const u = findByEmail(s.user);
      if (!u) return send(401, { ok: false, error: 'session no longer matches an account' });
      if (!u.totpSecret) return send(400, { ok: false, error: 'no second factor is enrolled' });
      const step = verifyTotp(u.totpSecret, body && body.token);
      if (step === null) return send(401, { ok: false, error: 'invalid or expired code — 2FA was not disabled' });
      // A code sign-in or confirm already consumed must not also disable the factor.
      if (u.lastTotpStep != null && step <= u.lastTotpStep) {
        return send(401, { ok: false, error: 'that code has already been used — 2FA was not disabled' });
      }
      const out = disableTotp(s.user);
      return send(200, { ok: true, email: out.email, totpConfirmed: false });
    });
  } },

  // POST /api/me/github {login, id} — the "enter manually" form. /auth/github/link (serve.mjs)
  // records the same pair as GitHub reports it. Display only, never a sign-in path.
  { method: 'POST', path: '/api/me/github', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      try {
        const out = linkGithub(s.user, { login: body && body.login, id: body && body.id });
        return send(200, { ok: true, github: { login: out.github.login } });
      } catch (e) { return send(e.code === GITHUB_LINKED_ELSEWHERE ? 409 : 400, { ok: false, error: e.message }); }
    });
  } },

  // POST /api/me/github/unlink — POST not DELETE: DELETE has no body and CSRF covers all non-GETs
  { method: 'POST', path: '/api/me/github/unlink', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    const s = requireSession(ctx);
    if (!s) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (_body, err) => {
      if (err) return send(400, { ok: false, error: err });
      try {
        const out = unlinkGithub(s.user);
        return send(200, { ok: true, email: out.email });
      } catch (e) { return send(400, { ok: false, error: e.message }); }
    });
  } },
];
