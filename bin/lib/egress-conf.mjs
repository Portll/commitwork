/**
 * Render a squid config from the declared egress allowlist. Pure — no I/O, no docker.
 *
 * WHY THIS IS A FILE AND NOT A `node -e` IN THE SHELL SCRIPT. It started as one, and an error
 * message containing 'quoted text' closed the shell's single-quoted string; bash then tried to
 * expand `${b.host}` and died with "bad substitution", the renderer never ran, squid.conf was
 * never written, and docker bind-mounted a directory over the config path. Three failures deep
 * from one apostrophe. A config generator that decides what a container may reach should not live
 * inside a quoting puzzle, and out here it is testable.
 *
 * THE ALLOWLIST IS THE CONTROL. bin/lib/sandbox.mjs's `build-resolve` posture runs repo-authored
 * build logic — arbitrary Groovy and Kotlin — with the network on, because resolution IS the
 * registry conversation. The only thing standing between that and the open internet is this list,
 * so every rule below refuses rather than repairs.
 */

/** A host that would swallow the list. `.com` is not a registry. */
const TOO_BROAD = new Set(['*', '.', '.com', '.org', '.net', '.io', '.dev']);

/**
 * The denial canary. bin/egress-proxy.sh proves the filter FILTERS by asking for a host that must
 * be refused — the assertion that matters, because a proxy allowing everything is up, healthy, and
 * passes every liveness check ever written.
 *
 * It used to be `github.com`, which was wrong in a way that only appeared when someone had a
 * reason to allow that host: the proxy then refused to start, reporting that the filter was not
 * filtering, when in fact the filter was doing exactly as told. A canary drawn from the same
 * namespace as real entries can always be allowlisted out from under the test.
 *
 * `.invalid` is reserved by RFC 2606 and can never be a real destination, so no allowlist will
 * ever legitimately contain it. squid evaluates http_access BEFORE resolving the name, so a denied
 * host returns 403 without a DNS lookup — the refusal is a policy decision, not a lookup failure,
 * and those two must not be confused. validateAllowlist refuses any entry that would shadow it.
 */
export const DENY_CANARY = 'cw-egress-canary.invalid';

/**
 * Validate the allowlist. Throws with the reason; never returns a partially-accepted list, because
 * a proxy started from a half-valid allowlist is a control nobody can state the shape of.
 */
export function validateAllowlist(manifest) {
  const allow = Array.isArray(manifest && manifest.allow) ? manifest.allow : null;
  if (!allow || !allow.length) {
    throw new Error('egress: the allowlist has no entries. An empty list would start a proxy that permits nothing, '
      + 'which reads as "resolution failed" for every repo rather than as a misconfiguration.');
  }

  for (const a of allow) {
    if (!a || typeof a.host !== 'string' || !a.host.trim()) {
      throw new Error(`egress: entry ${JSON.stringify(a)} has no host`);
    }
    if (typeof a.why !== 'string' || a.why.trim().length < 20) {
      throw new Error(`egress: ${a.host} has no usable reason. Widening what repo build logic can reach is the `
        + 'one decision this file exists to make reviewable, and an entry nobody justified is not reviewable.');
    }
    if (TOO_BROAD.has(a.host.trim().toLowerCase())) {
      throw new Error(`egress: '${a.host}' would make every other entry decoration`);
    }
    // Nothing may shadow the canary, or the proof that the filter filters stops proving anything.
    const h = a.host.trim().toLowerCase();
    if (DENY_CANARY === h || DENY_CANARY.endsWith(h.startsWith('.') ? h : `.${h}`)) {
      throw new Error(`egress: '${a.host}' would allow the denial canary ${DENY_CANARY}, which is what proves the `
        + 'filter refuses anything at all. Reserved by RFC 2606 and never a real destination.');
    }
  }

  // AN OVERLAP SILENTLY WIDENS THE LIST. `.gradle.org` beside `.services.gradle.org` reads as two
  // careful entries and is one broad one. squid rejects the pair outright, which is how this was
  // found; the reason to refuse it here is that a reviewer counting hosts would be counting wrong.
  for (const a of allow) {
    for (const b of allow) {
      if (a === b) continue;
      if (a.host.startsWith('.') && b.host !== a.host && b.host.endsWith(a.host)) {
        throw new Error(`egress: ${b.host} is inside ${a.host} — the narrower entry is decoration and the list is `
          + 'wider than it reads. Remove one.');
      }
    }
  }
  return allow;
}

/** The rendered config. Deterministic: same manifest, byte-identical output. */
export function renderSquidConf(manifest, { port = 3128 } = {}) {
  const allow = validateAllowlist(manifest);
  const lines = [
    '# GENERATED from manifests/jvm-egress-allowlist.json by bin/lib/egress-conf.mjs — do not edit.',
    `http_port ${port}`,
    '',
    '# No caching. A cached artifact makes a later run non-reproducible for reasons nothing records.',
    'cache deny all',
    // THE LOG GOES TO A BIND-MOUNTED HOST DIRECTORY, and both other options were tried first.
    //
    // The log is the evidence half of this lane: it says what a repo's build logic tried to reach
    // and could not. Written to the image's own /var/log/squid it was unreadable from outside —
    // `docker exec` was denied even as root under no-new-privileges — so every run reported
    // "0 denied" regardless of what squid had actually refused, a zero that cannot tell "nothing
    // was denied" from "the log could not be read". Redirecting to /dev/stdout for `docker logs`
    // then made squid refuse to start at all: it checks that the log's PARENT DIRECTORY is
    // writable by `proxy`, and /dev is not.
    //
    // A host directory mounted rw is readable by whoever needs it, survives the container, and
    // needs no exec. The path is fixed here and created by bin/egress-proxy.sh.
    'access_log stdio:/cw-logs/access.log',
    'cache_log /cw-logs/cache.log',
    '',
    '# CONNECT is how https reaches a proxy at all. Without these three lines the allowlist governs',
    '# plain http only, which in 2026 is to say it governs nothing.',
    'acl SSL_ports port 443',
    'acl CONNECT method CONNECT',
    'http_access deny CONNECT !SSL_ports',
    '',
  ];
  for (const a of allow) {
    // The reason goes on its OWN line. squid parses a trailing inline comment as part of the acl
    // value and dies with "Bungled ... line N".
    lines.push(`# ${a.why.replace(/\s+/g, ' ').slice(0, 140)}`);
    lines.push(`acl cw_allowed dstdomain ${a.host}`);
  }
  lines.push(
    '',
    'http_access allow cw_allowed',
    '# DEFAULT DENY. This line is the control; everything above it is scope.',
    'http_access deny all',
  );
  return `${lines.join('\n')}\n`;
}
