// admin/local-access.mjs — which requests are local to the panel, and which tunnel routes would
// break that.
//
// The OPERATOR PORT is the locality proof (serve.mjs, R6b): cloudflared dials from 127.0.0.1, so
// only the port a connection landed on separates a tunnelled request from a local one. The Host
// names below only narrow that proof. They never widen it: a request on the published port is
// remote whatever name it carries.
//
// fact: commitwork.local is the panel's local name / bin/panel-local-name.mjs maps it to 127.0.0.1 and redirects loopback :80 to the operator port
// fact: loopback :80 therefore counts as the operator port / a tunnel rule to http://localhost would land on it

export const PANEL_LOCAL_NAME = 'commitwork.local';
export const PANEL_LOCAL_HTTP_PORT = 80;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export const LOCAL_NAMES = new Set([...LOOPBACK_HOSTS, PANEL_LOCAL_NAME]);

const DEFAULT_PORTS = { http: 80, https: 443 };

/**
 * Why a cloudflared config reaches the operator port, or null when it does not.
 * A coarse textual scan rather than a YAML parse, so it gains no dependency: a false positive
 * refuses to boot and the operator looks, while a false negative publishes privileged routes.
 * Commented-out rules are stripped first.
 */
export function operatorPortRoute(configText, localPort) {
  const live = String(configText).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const m of live.matchAll(/service:\s*([a-z][a-z0-9+.-]*):\/\/(\[[^\]\s]*\]|[^\s:/]+)(?::(\d+))?/gi)) {
    const scheme = m[1].toLowerCase();
    const port = m[3] ? +m[3] : DEFAULT_PORTS[scheme];
    if (port === localPort) return `cloudflared routes a hostname to port ${localPort}, which is the OPERATOR port`;
    if (port === PANEL_LOCAL_HTTP_PORT && LOOPBACK_HOSTS.has(m[2].toLowerCase())) {
      return `cloudflared routes a hostname to loopback port ${PANEL_LOCAL_HTTP_PORT}, which bin/panel-local-name.mjs redirects to the OPERATOR port`;
    }
  }
  return null;
}
