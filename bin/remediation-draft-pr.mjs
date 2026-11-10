#!/usr/bin/env node
// bin/remediation-draft-pr.mjs — open draft remediation pull requests for the advisories a
// remediation plan proposes (monitor/remediation-draft-pr.mjs), or record what became of the ones
// already open. The remediation policy decides whether anything opens: mode draft-pr or above.
//
// usage: node bin/remediation-draft-pr.mjs <advisories.json> [--open]
//        node bin/remediation-draft-pr.mjs --reconcile
//   input: { advisories: [...], headStates: { <id>: { fixed, sha } } }, remediation-pr.mjs's input,
//   where each advisory also names `repo`, the scanned repository its finding was filed under.
//   Without --open it reports what each advisory would do and runs no gh, git or go command.
// exit: 0 ran · 2 usage, or the input could not be read · 3 the policy or the issue store could not be read, or a run threw
// env, read at call time: CW_REMEDIATION_POLICY, CW_ISSUES, CW_GH_BIN, GH_TOKEN, CW_GIT_HOST_URL, CW_NOW

import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { loadPolicy } from '../monitor/remediation-policy.mjs';
import { openDraftRemediationPR } from '../monitor/remediation-draft-pr.mjs';
import { reconcilePrOutcomes, withLedger } from '../monitor/draft-pr-ledger.mjs';
import { ghSeams } from '../monitor/draft-pr-live.mjs';

export const EXIT_USAGE = 2;
export const EXIT_UNREADABLE = 3;

export function main(argv, { env = process.env, out = (l) => console.log(l), err = (l) => console.error(l) } = {}) {
  if (argv.includes('--reconcile')) {
    try {
      const seen = withLedger((doc) => reconcilePrOutcomes(doc, { view: ghSeams(env).prView, at: nowISO(env) }));
      for (const r of seen) out(JSON.stringify(r));
      return 0;
    } catch (e) { err(`remediation-draft-pr: ${e.message}`); return EXIT_UNREADABLE; }
  }
  const inPath = argv.find((a) => !a.startsWith('--'));
  if (!inPath) { err('usage: remediation-draft-pr.mjs <advisories.json> [--open] | --reconcile'); return EXIT_USAGE; }
  let doc;
  try { doc = JSON.parse(readFileSync(inPath, 'utf8')); } catch (e) { err(`cannot read ${inPath}: ${e.message}`); return EXIT_USAGE; }
  let policy;
  try { policy = loadPolicy(); } catch (e) { err(e.message); return EXIT_UNREADABLE; }
  const dryRun = !argv.includes('--open');
  const counts = {};
  for (const adv of Array.isArray(doc.advisories) ? doc.advisories : []) {
    let r;
    try { r = openDraftRemediationPR(adv, { policy, headState: doc.headStates?.[adv?.id], env, dryRun }); }
    catch (e) { err(`remediation-draft-pr: ${e.message}`); return EXIT_UNREADABLE; }
    counts[r.state] = (counts[r.state] || 0) + 1;
    out(JSON.stringify({ id: adv?.id, package: adv?.package, ...r }));
  }
  err(`${dryRun ? 'dry run (pass --open to act): ' : ''}${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'no advisories'}`);
  return 0;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2));
