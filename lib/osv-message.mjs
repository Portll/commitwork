/** `{ name, version }` from osv-scanner's `Package '<name>@<version>'` message, split at the LAST `@` so an npm scope keeps its own; null when there is no segment or either side is empty. */
export function packageFromOsvMessage(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/Package '([^']*)'/);
  if (!m) return null;
  const quoted = m[1];
  const at = quoted.lastIndexOf('@');
  if (at <= 0) return null;
  const name = quoted.slice(0, at);
  const version = quoted.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}
