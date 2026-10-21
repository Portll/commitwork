#!/usr/bin/env node
// bin/dependency-policy-check.mjs — may this Dependabot pull request merge itself? Reads the
// repository's committed .github/dependency-updates.json and the update list
// dependabot/fetch-metadata reports, and allows the merge only when the policy's `automerge`
// permits EVERY dependency in the pull request (a grouped update is as permitted as its least
// permitted member).
//
// In CI the repository's own policy is the whole policy: there is no operator settings store on a
// runner, and the policy file is what the repository's reviewers approved.
//
// Kinds: a direct npm dependency is judged by its semver update type under `prod` or `dev`; an
// indirect one by `lockfile` (as dev when the policy declares zeroRuntimeDependencies, else under
// both); a GitHub Actions update by its type under `actions`. A security update (fetch-metadata
// reports a GHSA id) also qualifies through `advisories`.
//
// usage: node bin/dependency-policy-check.mjs [--policy <file>] [--github-output]
//   input: DEP_UPDATES_JSON (fetch-metadata's updated-dependencies-json), DEP_GHSA_ID (its ghsa-id)
//   --github-output   append allowed=true|false to $GITHUB_OUTPUT, and exit 0 either way
//
// exit: 0 allowed (or decided, under --github-output) · 2 usage · 20 not allowed · 23 the policy or
// the update list could not be read — never read as "allowed"
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRepoPolicy, POLICY_FILE } from './lib/update-policy.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const TYPE = { 'version-update:semver-patch': 'patch', 'version-update:semver-minor': 'minor', 'version-update:semver-major': 'major' };

/** One verdict per dependency: { name, allowed, why }. */
export function judge(policy, updates, { ghsa = '' } = {}) {
  const am = policy.automerge || {};
  const has = (side, kind) => Array.isArray(am[side]) && am[side].includes(kind);
  const security = !!String(ghsa || '').trim();
  return updates.map((u) => {
    const name = u.dependencyName || '(unnamed)';
    const type = TYPE[u.updateType];
    if (u.packageEcosystem === 'github_actions' || u.packageEcosystem === 'github-actions') {
      return type && has('actions', type) ? { name, allowed: true, why: `actions ${type}` } : { name, allowed: false, why: `actions ${type || u.updateType || 'unknown type'} is not in automerge.actions` };
    }
    if (u.packageEcosystem !== 'npm_and_yarn' && u.packageEcosystem !== 'npm') return { name, allowed: false, why: `ecosystem ${u.packageEcosystem || 'unknown'} has no policy here` };
    const dep = String(u.dependencyType || '');
    const sides = dep === 'direct:production' ? ['prod'] : dep === 'direct:development' ? ['dev']
      : dep === 'indirect' ? (policy.zeroRuntimeDependencies ? ['dev'] : ['prod', 'dev']) : null;
    if (!sides) return { name, allowed: false, why: `dependency type ${dep || 'unknown'}` };
    const kind = dep === 'indirect' ? 'lockfile' : type;
    if (!kind) return { name, allowed: false, why: `update type ${u.updateType || 'unknown'}` };
    if (sides.every((s) => has(s, kind))) return { name, allowed: true, why: `${sides.join('+')} ${kind}` };
    if (security && sides.every((s) => has(s, 'advisories'))) return { name, allowed: true, why: `${sides.join('+')} advisories (security update ${ghsa})` };
    return { name, allowed: false, why: `${sides.join('+')} ${kind} is not in automerge` };
  });
}

function main(argv, env) {
  let policyPath = resolve(process.cwd(), POLICY_FILE);
  const ghOut = argv.includes('--github-output');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--policy') { if (!argv[i + 1]) { console.error('--policy needs a file'); return 2; } policyPath = resolve(argv[++i]); }
    else if (argv[i] !== '--github-output') { console.error(`unknown argument ${argv[i]}`); return 2; }
  }
  let text;
  try { text = readFileSync(policyPath, 'utf8'); } catch (e) { console.error(`dependency policy: ${policyPath} could not be read (${e.code || e.message}) — not merging`); return 23; }
  const p = parseRepoPolicy(text, policyPath);
  if (p.error) { console.error(`dependency policy: ${p.error} — not merging`); return 23; }
  let updates;
  try { updates = JSON.parse(env.DEP_UPDATES_JSON || ''); } catch (e) { console.error(`dependency policy: DEP_UPDATES_JSON is not JSON (${e.message}) — not merging`); return 23; }
  if (!Array.isArray(updates) || !updates.length) { console.error('dependency policy: DEP_UPDATES_JSON names no dependency — not merging'); return 23; }
  const verdicts = judge(p.policy, updates, { ghsa: env.DEP_GHSA_ID });
  for (const v of verdicts) console.log(`${v.allowed ? 'allow' : 'deny '}  ${v.name}: ${v.why}`);
  const allowed = verdicts.every((v) => v.allowed);
  console.log(allowed ? 'merge: allowed by the policy' : 'merge: not allowed — the pull request stays open for review');
  if (ghOut) {
    if (!env.GITHUB_OUTPUT) { console.error('--github-output: GITHUB_OUTPUT is not set'); return 23; }
    appendFileSync(env.GITHUB_OUTPUT, `allowed=${allowed}\n`);
    return 0;
  }
  return allowed ? 0 : 20;
}

if (isMainModule(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.env);
