// No I/O, no child processes, no dynamic evaluation, no network, no credentials.
// Every line here is boring on purpose: this file's job is to be scanned and found blameless.
export function add(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError('add expects two finite numbers');
  return a + b;
}
