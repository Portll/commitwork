#!/usr/bin/env node
// worklist-reconcile.mjs — recompute program-worklist item status from MACHINE sources and surface
// disagreement. Never writes program-worklist.json; emits the derived sidecar
// worklist-reconciled.json. A source that did not run ⟹ 'unverifiable', never 'done'.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { findRepoPath } from './discover.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { imageAcceptancePathFor, programWorklistPathFor, privateDir } from './store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// verdict vocabulary — kept small and honest.
//   agree        : derivedStatus === authoredStatus (machine confirms the human)
//   mismatch     : derivedStatus !== authoredStatus (machine contradicts the human — the payload)
//   unverifiable : no machine source ran / evidence is prose-only (provenance floor — NOT a lie either way)
export const VERDICTS = ['agree', 'mismatch', 'unverifiable'];

// ---- per-program resolver registry ------------------------------------------------------------
// Each program key maps to a resolver that, given (item, ctx), returns either:
//   { derivedStatus: 'done'|'open'|'gated', source: '<machine cite>' }  when machine-checkable, or
//   null                                                                when this item is prose-only.
// A program with NO resolver entry is treated as entirely prose-only (all items 'unverifiable').
// verify-corrected asserts every program key is either resolvable-here OR in PROSE_ONLY_PROGRAMS.

// Prose-only programs — enumerated so a NEW program can't silently fall through as 'unverifiable'
export const PROSE_ONLY_PROGRAMS = new Set([
  'cve-2026-10532',        // all 'PLAN execution order #N' — no machine anchor
  'buildout-entrypoint',   // HANDOFF-PLAN.md §N (1 git-status item is soft, not resolved here)
  'consolidation-24-14',   // REMEDIATION-WORK.md:line / COMMITWORK-COVERAGE-REMEDIATION.md §4
]);

// grep-evidence: "grep: 0 com.fasterxml.jackson imports in gateway src/main" — parse the expected
// count + a target hint. If the target tree is present, re-run; done iff count matches expectation.
function resolveGrep(item, ctx) {
  const ev = item.evidence || '';
  const m = ev.match(/grep:\s*(\d+)\b/i);
  if (!m) return null;
  const expected = Number(m[1]);
  // ctx.grepRunner is injected by callers that HAVE the tree; absent ⟹ unverifiable, never guess
  if (typeof ctx.grepRunner !== 'function') return null;
  try {
    const actual = ctx.grepRunner(item);
    if (actual == null) return null;
    return { derivedStatus: actual === expected ? 'done' : 'open', source: `grep re-run: ${actual} vs expected ${expected}` };
  } catch { return null; }
}

// git-sha evidence. A reachable sha proves the commit EXISTS, not that the item is DONE:
//   - sha NOT reachable ⟹ 'open' (broken citation)
//   - reachable + authored 'done' ⟹ 'done' (corroborated)
//   - reachable + authored open/gated ⟹ null (existence ≠ completion)
const SHA_RE = /\b([0-9a-f]{7,40})\b/;
function resolveSha(item, ctx, whichRepoFor) {
  const ev = item.evidence || '';
  const m = ev.match(SHA_RE);
  if (!m) return null;
  const sha = m[1];
  const git = whichRepoFor(ev, ctx);
  if (!git) return null;                        // repo not wired ⟹ unverifiable (floor)
  const reachable = gitHasCommit(git, sha);
  if (reachable == null) return null;           // git errored ⟹ unverifiable, never false-done
  if (!reachable) return { derivedStatus: 'open', source: `${git.name}@${sha} NOT reachable (citation broken)` };
  // reachable: corroborate a done item, but refuse to upgrade open/gated (existence ≠ completion).
  if (item.status === 'done') return { derivedStatus: 'done', source: `${git.name}@${sha} reachable (corroborates done)` };
  return null;                                  // reachable but item open/gated ⟹ unverifiable by sha alone
}

function gitHasCommit(git, sha) {
  try {
    scannedGitOut(git.dir, ['cat-file', '-e', `${sha}^{commit}`]); // git.dir may be a client's repo
    return true;
  } catch (e) {
    // exit 1 = not found (a real 'open' signal); anything else (not a repo, git missing) = unknown.
    if (e && e.status === 1) return false;
    return null;
  }
}

// rollup.qualityGates membership: done iff the item's repo is ABSENT from the relevant red arrays
function resolveQualityGate(item, ctx, gateArrays) {
  const qg = ctx.rollup?.qualityGates;
  if (!qg) return null;                         // no rollup ⟹ unverifiable
  const repo = findRepoToken(item, ctx.knownRepos);
  if (!repo) return null;                       // can't bind item to a repo ⟹ unverifiable
  const inAnyRed = gateArrays.some((k) => Array.isArray(qg[k]) && qg[k].some((x) => (typeof x === 'string' ? x : x?.name) === repo));
  return { derivedStatus: inAnyRed ? 'open' : 'done', source: `rollup.qualityGates: ${repo} ${inAnyRed ? 'in' : 'absent from'} [${gateArrays.join(',')}]` };
}

// image-acceptance membership. Image name alone cannot bind an item (an image can be in fixed[]
// and fixableViaRebuild[] at once) — require a SPECIFIC CVE, else null, never a manufactured mismatch.
function resolveImageAcceptance(item, ctx) {
  const ia = ctx.imageAcceptance;
  if (!ia) return null;
  const hay = `${item.title} ${item.evidence}`;
  const cve = (hay.match(/\bCVE-\d{4}-\d{4,}\b/) || [])[0];
  if (!cve) return null;                          // no specific CVE to bind ⟹ unverifiable (floor)
  const inFixed = (ia.fixed || []).some((f) => (f.cve || '').includes(cve));
  const inAccepted = (ia.accepted || []).some((a) => (a.cve || '').includes(cve));
  const inFixable = (ia.fixableViaRebuild || []).some((f) => (f.cve || '').includes(cve));
  if (inFixed) return { derivedStatus: 'done', source: `image-acceptance: ${cve} in fixed[]` };
  if (inAccepted) return { derivedStatus: 'done', source: `image-acceptance: ${cve} accepted[]+containment` };
  if (inFixable) return { derivedStatus: 'open', source: `image-acceptance: ${cve} only in fixableViaRebuild[]` };
  return null;                                    // CVE named but not in the ledger ⟹ unverifiable
}

// migration-state roster: modernization items done iff the named service reached its target era.
function resolveMigrationState(item, ctx) {
  const roster = ctx.migrationRoster;
  if (!Array.isArray(roster) || !roster.length) return null;
  const hay = `${item.title} ${item.evidence}`.toLowerCase();
  const svc = roster.find((r) => r.id && hay.includes(String(r.id).toLowerCase()));
  if (!svc) return null;
  const done = svc.reachedEra && svc.targetEra && svc.reachedEra === svc.targetEra && !svc.blocked;
  return { derivedStatus: done ? 'done' : (svc.blocked ? 'gated' : 'open'), source: `migration-state: ${svc.id} reached=${svc.reachedEra} target=${svc.targetEra} blocked=${!!svc.blocked}` };
}

// --- helpers ---
function findRepoToken(item, knownRepos) {
  if (!Array.isArray(knownRepos)) return null;
  const hay = `${item.title} ${item.evidence}`;
  return knownRepos.find((r) => hay.includes(r)) || null;
}
function clientAOrSelf(ev, ctx) {
  if (/clientA/i.test(ev)) return ctx.clientAGit || null;
  return ctx.selfGit || null;   // 'commit <sha>' / 'commitwork <sha>' ⟹ this repo
}

const RESOLVERS = {
  'cve-2026-54515-dropgateway': (item, ctx) => resolveGrep(item, ctx) || resolveSha(item, ctx, clientAOrSelf),
  'commitwork-coverage':        (item, ctx) => resolveSha(item, ctx, clientAOrSelf) || resolveQualityGate(item, ctx, ['ciMissing', 'bootTestMissing', 'contractsMissing', 'openapiNotWired', 'bootTestPassNotGreen']),
  'boot-contract-enforcement':  (item, ctx) => resolveSha(item, ctx, clientAOrSelf) || resolveQualityGate(item, ctx, ['ciMissing', 'bootTestMissing', 'contractsMissing', 'openapiNotWired', 'bootTestPassNotGreen']),
  'infra-images':               (item, ctx) => resolveImageAcceptance(item, ctx),
  'modernization':              (item, ctx) => resolveMigrationState(item, ctx),
  'infra-hardening':            (item, ctx) => resolveSha(item, ctx, clientAOrSelf), // most items prose (runbook), sha ones resolve
};

// exported for verify-corrected's coverage check (9b): a program must be resolver-backed or prose-only.
export const RESOLVER_KEYS = Object.keys(RESOLVERS);

/**
 * Pure reconcile. @param worklist {programs:[{key,items:[{id,status,evidence,title}]}]}
 * @param ctx { rollup, imageAcceptance, migrationRoster, knownRepos, selfGit, clientAGit, grepRunner }
 * @returns { generated?, programs:[{key, items:[{id, authoredStatus, derivedStatus, verdict, source}]}], summary }
 */
export function assembleReconcile(worklist, ctx = {}) {
  const out = { programs: [], summary: { agree: 0, mismatch: 0, unverifiable: 0, byProgram: {} } };
  for (const p of worklist.programs || []) {
    const resolver = RESOLVERS[p.key];
    const items = [];
    const pc = { agree: 0, mismatch: 0, unverifiable: 0 };
    for (const it of p.items || []) {
      const authoredStatus = it.status;
      let derived = null;
      if (resolver && !PROSE_ONLY_PROGRAMS.has(p.key)) {
        try { derived = resolver(it, ctx); } catch { derived = null; }
      }
      let verdict, derivedStatus = null, source = null;
      if (!derived) {
        verdict = 'unverifiable';               // provenance floor: no machine source ⟹ keep authored, flag
        source = PROSE_ONLY_PROGRAMS.has(p.key) ? 'prose-only program (no machine anchor)' : 'no machine source resolved this item';
      } else {
        derivedStatus = derived.derivedStatus;
        source = derived.source;
        verdict = derivedStatus === authoredStatus ? 'agree' : 'mismatch';
      }
      pc[verdict]++;
      items.push({ id: it.id, authoredStatus, derivedStatus, verdict, source });
    }
    out.summary.byProgram[p.key] = pc;
    out.summary.agree += pc.agree; out.summary.mismatch += pc.mismatch; out.summary.unverifiable += pc.unverifiable;
    out.programs.push({ key: p.key, items });
  }
  return out;
}

// ---- IO wrapper (used by CLI + rollup) --------------------------------------------------------
export function reconcileFromDisk({ outDir, worklistPath, nowIso } = {}) {
  // The worklist is a private record (monitor/private/program-worklist.json, CW_PROGRAM_WORKLIST). An
  // absent one throws ENOENT to the caller, which states it; there is nothing to reconcile.
  const worklist = JSON.parse(readFileSync(worklistPath || programWorklistPathFor(resolve(HERE, '..')), 'utf8'));
  const load = (p, dflt) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return dflt; } };
  const loadRecord = (p, absent) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { if (e && e.code === 'ENOENT') return absent; throw e; }
  };
  const rollup = outDir ? load(join(outDir, 'rollup.json'), null) : null;
  // A private record: ENOENT is "no ledger" (null); anything else is a failure, not a missing ledger.
  const imageAcceptance = loadRecord(imageAcceptancePathFor(resolve(HERE, '..')), null);
  // The 'clientA' literal STAYS: the SUBJECT is clientA's programme — resolving the ambient
  // area's map would reconcile it against a different project. CW_MODMAP overrides.
  const modmap = process.env.CW_MODMAP || join(HERE, '..', 'map', 'data', 'clientA', 'migration-state.json');
  const msDoc = load(modmap, null);
  const migrationRoster = msDoc?.roster || [];
  const knownRepos = rollup?.repos ? rollup.repos.map((r) => r.name) : [];
  // git wiring: THIS repo always; clientA if findable (CW_CLIENTA overrides — never hardcode a path)
  const selfGit = { name: 'commitwork', dir: resolve(HERE, '..') };
  const clientACandidates = [process.env.CW_CLIENTA, findRepoPath('clientA')].filter(Boolean);
  const clientADir = clientACandidates.find((d) => existsSync(join(d, '.git')));
  const clientAGit = clientADir ? { name: 'clientA', dir: clientADir } : null;
  const ctx = { rollup, imageAcceptance, migrationRoster, knownRepos, selfGit, clientAGit, nowIso };
  const result = assembleReconcile(worklist, ctx);
  result.generated = nowIso || null;
  result.sources = {
    rollup: !!rollup, imageAcceptance: !!imageAcceptance,
    migrationRoster: migrationRoster.length, clientAGit: !!clientAGit,
  };
  return result;
}

// CLI
if (isMainModule(import.meta.url)) {
  const outDir = process.argv[2] || null;    // reports dir with rollup.json (optional)
  let res;
  try { res = reconcileFromDisk({ outDir, nowIso: new Date().toISOString() }); } catch (e) {
    if (e && e.code === 'ENOENT' && e.path === programWorklistPathFor(resolve(HERE, '..'))) {
      console.error(`worklist-reconcile: no programme worklist at ${e.path} (ENOENT) — nothing to reconcile`);
      process.exit(2);
    }
    throw e;
  }
  // Derived from a private record, so with no outDir it is written beside that record, never into the tree.
  const dest = outDir ? join(outDir, 'worklist-reconciled.json') : join(privateDir(resolve(HERE, '..')), 'worklist-reconciled.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(res, null, 1));
  const s = res.summary;
  console.log(`worklist-reconcile -> ${dest}`);
  console.log(`  agree=${s.agree}  mismatch=${s.mismatch}  unverifiable=${s.unverifiable}  (sources: ${JSON.stringify(res.sources)})`);
  const mism = res.programs.flatMap((p) => p.items.filter((i) => i.verdict === 'mismatch').map((i) => `${p.key}/${i.id}: authored=${i.authoredStatus} derived=${i.derivedStatus} (${i.source})`));
  if (mism.length) { console.log('  MISMATCHES (authored status contradicted by machine state):'); for (const m of mism) console.log('    ' + m); }
}
