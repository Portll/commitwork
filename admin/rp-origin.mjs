// admin/rp-origin.mjs — the panel's own identity, resolved from DECLARATIONS rather than from the
// request that is asking.
//
// WebAuthn binds a credential to a relying-party ID and refuses any assertion signed for a
// different one. That makes "what am I called?" a security question rather than a cosmetic one: if
// the RP ID were taken from the `Host` header, an attacker who can reach the panel under a name
// they control gets the browser to sign for THEIR relying party, and a verifier that then compares
// against the same attacker-supplied value accepts it. The check would be present, wired, and
// incapable of failing.
//
// serve.mjs already learned this on the OAuth redirect (`oauthOrigin`, with the note "Host is
// caller-controlled, and an unchecked one lets an attacker point the redirect at a host they own
// and collect the authorisation code"). The sources here are deliberately the SAME two, so the two
// features cannot disagree about what this panel is called:
//   · the hostnames this area DECLARES in monitor/projects.json (deploy.hostnames), over https —
//     the tunnel terminates TLS in front of them, and x-forwarded-proto is caller-settable too;
//   · loopback, for local sign-in.
//
// A registry that will not load yields an EMPTY allowlist, and an empty allowlist means no
// non-loopback origin is accepted. That is the fail-closed direction: a broken registry costs
// remote passkey login, never a credential accepted for the wrong site.
import { loadRegistry } from '../monitor/registry.mjs';

const AREA_SLUG = 'commitwork-admin';

/** Hostnames this panel is DECLARED to answer to. Lower-cased, no ports. */
export function declaredHosts({ quiet = true } = {}) {
  try {
    const reg = loadRegistry({ quiet });
    const own = (reg.areas || []).find((a) => a.slug === AREA_SLUG);
    return new Set(((own && own.deploy && own.deploy.hostnames) || []).map((h) => String(h).toLowerCase()));
  } catch { return new Set(); }
}

/**
 * The relying-party policy for a request: { rpId, origins }.
 *
 * `rpId` is a BARE HOSTNAME — never a URL and never a port. A WebAuthn RP ID is a domain, and
 * passing an origin where a domain belongs makes every ceremony fail with a message about the
 * relying party that reads like a code bug rather than a configuration one.
 *
 * `origins` is the full list this panel will accept a ceremony from, so a credential enrolled on
 * loopback still works over the tunnel and vice versa. Both entries are OURS: nothing derived from
 * the caller reaches this list unless the caller's Host is one we already declared.
 *
 * CW_PANEL_ORIGIN overrides outright, for a deployment fronted under a name the registry does not
 * know — the same escape hatch CW_OAUTH_BASE_URL is for the redirect, and the same trade: an
 * operator who sets it has declared that name themselves.
 */
export function rpFor(req, { ports = [] } = {}) {
  const override = process.env.CW_PANEL_ORIGIN;
  if (override) {
    let u;
    try { u = new URL(override); } catch { u = null; }
    if (u) return { rpId: u.hostname, origins: [u.origin] };
  }
  const raw = String((req && req.headers && req.headers.host) || '').toLowerCase();
  const bare = raw.replace(/:\d+$/, '');
  const hosts = declaredHosts();
  if (hosts.has(bare)) return { rpId: bare, origins: [`https://${bare}`] };

  // Loopback. The RP ID is the bare host WITHOUT the port — 'localhost' and '127.0.0.1' are
  // distinct RP IDs to a browser, and a credential enrolled against one will not assert against
  // the other, so both origins this process actually listens on are offered for the matching host.
  if (bare === 'localhost' || bare === '127.0.0.1' || bare === '[::1]') {
    const origins = ports.length ? ports.map((p) => `http://${bare}:${p}`) : [`http://${raw}`];
    return { rpId: bare === '[::1]' ? '::1' : bare, origins };
  }
  // An UNDECLARED Host reaches here. Return no usable policy rather than guessing: the caller
  // turns this into a refusal, which is the only safe answer to "who are you?" from a stranger.
  return { rpId: null, origins: [] };
}
