// monitor/draft-pr-body.mjs — the body of a remediation pull request, written for the upstream
// maintainer who reads it: the advisory, the reachability evidence, the versions, the verification
// commands and their results, the head probe, what is asked of a person, and who prepared it.
// Deterministic: a timestamp appears only when `now` (CW_NOW) is given. Nothing from the scanning fleet appears.

/** A public page for the advisory id. */
export function advisoryUrl(id) {
  const s = String(id || '');
  if (/^GO-/.test(s)) return `https://pkg.go.dev/vuln/${s}`;
  if (/^GHSA-/.test(s)) return `https://github.com/advisories/${s}`;
  return `https://osv.dev/vulnerability/${s}`;
}

const code = (s) => `\`${String(s ?? '').replace(/`/g, "'")}\``;
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/**
 * @param {object} r
 * @param {object} r.adv          the advisory (id, package, bump?)
 * @param {object} r.probe        { base, sha, reason, trace?: string[] } measured before the change
 * @param {Array}  r.versions     [{ module, before, after }]
 * @param {Array}  r.steps        [{ cmd, status, result }] apply and verification, in run order
 * @param {Array}  r.asks         sentences naming what a person must do before this leaves draft
 * @param {string|null} r.dcoWhy  where a DCO sign-off was asked for, when the commit carries one
 * @param {string} [r.now]        the pinned instant (CW_NOW); absent means no timestamp
 */
export function renderDraftPrBody({ adv, probe, versions = [], steps = [], asks = [], dcoWhy = null, now = null }) {
  const target = adv.bump?.module || adv.package;
  const L = [];
  L.push('### Summary', '');
  L.push(`This pull request moves ${code(target)} to ${code(adv.bump?.to || adv.fixed)} to clear [${adv.id}](${advisoryUrl(adv.id)})`
    + `${adv.bump?.module && adv.bump.module !== adv.package ? `, which reaches this repository through ${code(adv.package)}` : ` in ${code(adv.package)}`}.`, '');
  L.push('### Reachability', '');
  L.push(`\`govulncheck\` traced a call path from this repository's code to the vulnerable symbol (compiler call graph, symbol level) on ${code(probe.base)} at ${code(probe.sha || 'unknown')}.`);
  const trace = Array.isArray(probe.trace) ? probe.trace : [];
  if (trace.length) { L.push('', 'Call path, entry first:', ''); for (const f of trace) L.push(`- ${code(f)}`); }
  L.push('');
  if (versions.length) {
    L.push('### Versions', '', '| Module | Before | After |', '| --- | --- | --- |');
    for (const v of versions) L.push(`| ${code(v.module)} | ${cell(v.before) || 'not in the build'} | ${cell(v.after) || 'not in the build'} |`);
    L.push('');
  }
  L.push('### Head probe', '');
  L.push(`Before this change, ${code(probe.base)} at ${code(probe.sha || 'unknown')} still reported ${adv.id} (${cell(probe.reason)}).`, '');
  L.push('### Verification', '');
  L.push(`Run in a fresh clone of ${code(probe.base)} with this change applied:`, '', '| Command | Exit | Result |', '| --- | --- | --- |');
  for (const s of steps) L.push(`| ${code(s.cmd)} | ${s.status ?? 'none'} | ${cell(s.result)} |`);
  L.push('');
  if (dcoWhy) L.push(`The commit carries a \`Signed-off-by\` line for its author, as ${code(dcoWhy)} asks.`, '');
  if (asks.length) {
    L.push('### Before this leaves draft', '');
    for (const a of asks) L.push(`- [ ] ${a}`);
    L.push('');
  }
  L.push('---', '');
  L.push(`Prepared${now ? ` ${now}` : ''} by an automated tool (commitwork remediation-draft-pr). No person has reviewed it yet.`);
  return L.join('\n') + '\n';
}
