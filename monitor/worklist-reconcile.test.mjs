#!/usr/bin/env node
// worklist-reconcile.test.mjs — pins resolver claim-strength semantics: CVE-specific binding,
// no-CVE ⟹ unverifiable, sha corroborates-never-upgrades, prose-only ⟹ unverifiable.
// Run: node monitor/worklist-reconcile.test.mjs   (wired as a check in verify-corrected.mjs)
import { assembleReconcile } from './worklist-reconcile.mjs';

let pass = 0, fail = 0;
const t = (name, got, want) => { if (got === want) pass++; else { fail++; console.error(`FAIL ${name}: got ${got} want ${want}`); } };

const ctx = {
  selfGit: { name: 'self', dir: '/x' }, clientAGit: null,
  imageAcceptance: { fixed: [{ cve: 'CVE-2026-1111' }], accepted: [{ cve: 'CVE-2026-2222', image: 'pg' }], fixableViaRebuild: [{ cve: 'CVE-2026-3333' }] },
  migrationRoster: [
    { id: 'svc-a', reachedEra: 'boot41', targetEra: 'boot41', blocked: false },
    { id: 'svc-b', reachedEra: 'boot2', targetEra: 'boot41', blocked: true },
  ],
  rollup: { qualityGates: { ciMissing: ['repo-red'], bootTestMissing: [], contractsMissing: [], openapiNotWired: [], bootTestPassNotGreen: [] } },
  knownRepos: ['repo-red', 'repo-green'],
};
const run = (key, item) => assembleReconcile({ programs: [{ key, items: [item] }] }, ctx).programs[0].items[0];

t('img fixed=>done', run('infra-images', { id: '1', status: 'open', title: 'x', evidence: 'CVE-2026-1111' }).derivedStatus, 'done');
t('img fixable=>open', run('infra-images', { id: '1', status: 'done', title: 'x', evidence: 'CVE-2026-3333' }).derivedStatus, 'open');
t('img no-cve=>unverifiable', run('infra-images', { id: '1', status: 'done', title: 'consul work', evidence: 'PLAN §PG-4' }).verdict, 'unverifiable');
t('mig reached=>done', run('modernization', { id: '1', status: 'open', title: 'svc-a modern', evidence: 'x' }).derivedStatus, 'done');
t('mig blocked=>gated', run('modernization', { id: '1', status: 'open', title: 'svc-b work', evidence: 'x' }).derivedStatus, 'gated');
t('qg red=>open', run('commitwork-coverage', { id: '1', status: 'done', title: 'repo-red ci', evidence: 'fix' }).derivedStatus, 'open');
t('qg green=>done', run('commitwork-coverage', { id: '1', status: 'open', title: 'repo-green ci', evidence: 'fix' }).derivedStatus, 'done');
t('prose-only=>unverifiable', run('cve-2026-10532', { id: '1', status: 'open', title: 'x', evidence: 'CVE-2026-1111 PLAN #1' }).verdict, 'unverifiable');
t('qg mismatch', run('commitwork-coverage', { id: '1', status: 'done', title: 'repo-red ci', evidence: 'fix' }).verdict, 'mismatch');
t('qg agree', run('commitwork-coverage', { id: '1', status: 'done', title: 'repo-green ci', evidence: 'fix' }).verdict, 'agree');

if (fail) { console.error(`\n${pass} passed, ${fail} FAILED`); process.exit(1); }
console.log(`worklist-reconcile: ${pass} resolver-semantics tests passed`);
