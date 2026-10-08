// history-guards — D1 and G13, the two B3 predicates that can only be asked of HISTORY.
//
// Built 2026-09-06 from the ed.15 remediation audit (its spine plan,
// task 2.3). Both classes were RULE-mode with no detector, no canary and no register row.
//
//   D1  Orphaned by history rewrite   a ref that shares NO ancestor with main. Its commits are
//                                     reachable only from that ref and vanish at the next gc — the
//                                     2026-08-11 filter-repo rewrite is what makes this live here.
//   G13 Catalogue substitutes for     a commit that RAISES a class's closure in the registry while
//       repair                        changing nothing outside the taxonomy and citing no commit
//                                     that did. The score moved; the world did not.
//
// WHY THE PREDICATES ARE EXPORTED AND PURE. A guard that can only be run against the real repository
// has no negative fixture — nothing proves it would still fire if it stopped working, which is the
// floor this repo requires of every guard. Each predicate below is a function over supplied data,
// asserted in both directions on fixtures, and THEN run against the live repo. The live half is the
// measurement; the fixture half is the reason to believe the measurement.
//
// Env, read at CALL time: CW_REPO (default: this repo), CW_HISTORY_WINDOW (default 14 commits).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = () => process.env.CW_REPO || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WINDOW = () => Number(process.env.CW_HISTORY_WINDOW || 14);
const git = (args, opts = {}) => execFileSync('git', ['-C', REPO(), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

// ── D1 ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The one ref that legitimately shares no history with main, and WHY — an exemption with no reason
 * is the class next door (R12, exemption outliving its reason). This branch predates the 2026-08-11
 * filter-repo rewrite that replaced every SHA on main; CLAUDE.md already records that a few local
 * side branches carry old-history commits and must be rebased onto the rewritten main when they
 * land. It is declared here so that a SECOND orphan appearing is a failure rather than noise.
 */
export const DECLARED_ORPHANS = Object.freeze({
  'codex/pre-rebase-20260831/fix-yarn-audit-enolock':
    'Cut before the 2026-08-11 filter-repo rewrite of main; carries pre-rewrite objects by construction. Rebase onto rewritten main when it lands, or delete it.',
  'backup/main-before-origin-sync-20260813':
    'Cut 2026-08-13 as a pre-sync snapshot of main — 113 commits, tip dated 2026-07-28. It shares no merge base because main has been rewritten twice since: the 2026-08-11 filter-repo pass and the 2026-09-06 author normalisation, which replaced every object below it. It cannot be rebased usefully, so it is a recovery point or it is nothing; delete it once the pre-rewrite history is confirmed unneeded.',
});

/** D1 — refs that share no merge base with the trunk. `sharesHistory` is supplied, never inferred. */
export function orphanedRefs(refs, sharesHistory) {
  return refs.filter((r) => !sharesHistory(r)).filter((r) => !DECLARED_ORPHANS[r]);
}

test('D1: a ref sharing no history with the trunk is an orphan', () => {
  const found = orphanedRefs(['a', 'b'], (r) => r === 'a');
  assert.deepEqual(found, ['b']);
});

test('D1: a declared orphan is exempt, and the exemption carries a reason', () => {
  const name = Object.keys(DECLARED_ORPHANS)[0];
  assert.deepEqual(orphanedRefs([name], () => false), []);
  for (const [ref, why] of Object.entries(DECLARED_ORPHANS)) {
    assert.ok(why.split(/\s+/).length >= 8, `${ref}: a one-word exemption reason is not a reason`);
  }
});

test('D1: NEGATIVE — an undeclared orphan is NOT exempted by a declared one existing', () => {
  const found = orphanedRefs([Object.keys(DECLARED_ORPHANS)[0], 'feat/new'], () => false);
  assert.deepEqual(found, ['feat/new'], 'the allowlist must not become a blanket');
});

test('D1: every local branch shares history with main, or is declared', (t) => {
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).trim().split('\n').filter(Boolean);
  // A tag or pull-request build checks out a detached HEAD with no local branches and no main.
  if (!refs.includes('main')) {
    t.skip(`no local main in this checkout (${refs.length} local branch(es)), so there is no trunk to compare against`);
    return;
  }
  const sharesHistory = (r) => {
    try { git(['merge-base', 'main', r], { stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; }
  };
  const orphans = orphanedRefs(refs, sharesHistory);
  assert.deepEqual(orphans, [], `refs sharing no ancestor with main: ${orphans.join(', ')}`);
});

// ── G13 ─────────────────────────────────────────────────────────────────────────────────────────

// The taxonomy's OWN surfaces. A commit that raises a closure score and touches only these has moved
// the catalogue and nothing else. `bin/taxonomy-*` is in the list deliberately: editing the renderer
// is not repairing the defect the class names.
const TAXONOMY_SURFACE = /^(monitor\/failure-taxonomy\.json|monitor\/taxonomy-|monitor\/FAILURE-TAXONOMY|monitor\/FALSE-CLEAN|bin\/taxonomy-|bin\/remediation-web|docsite\/|reports\/|evaluations\/|schema\/failure-taxonomy|schema\/taxonomy-)/;

/** Closure by class id, from a parsed registry. */
export const closureMap = (registry) => Object.fromEntries((registry.classes || []).map((c) => [c.id, c.closure]));

/** Which ids rose between two closure maps. Falls silent on ids absent from either side. */
export const raisedClosures = (prev, cur) =>
  Object.keys(cur).filter((id) => prev[id] !== undefined && cur[id] > prev[id]).sort();

/**
 * G13 — a closure raise with nothing behind it.
 *
 * The escape hatch is deliberate and is what makes this mechanical rather than a judgement: a
 * RE-SCORING pass legitimately raises closure without touching code, because the code already
 * existed and the score was stale. What it must then do is CITE the commit that did the work. A
 * raise that neither changes anything outside the catalogue nor cites a sha is the class.
 */
export function catalogueOnlyRaise({ raised, files, message }) {
  if (!raised.length) return null;
  const outside = files.filter((f) => !TAXONOMY_SURFACE.test(f));
  if (outside.length) return null;
  if (/\b[0-9a-f]{7,40}\b/.test(message)) return null;
  return { raised, why: 'closure rose with no change outside the taxonomy and no cited commit' };
}

test('G13: a raise touching only the catalogue, citing nothing, is the class', () => {
  const r = catalogueOnlyRaise({ raised: ['C1'], files: ['monitor/failure-taxonomy.json'], message: 'taxonomy: C1 is closed now' });
  assert.ok(r);
  assert.deepEqual(r.raised, ['C1']);
});

test('G13: a raise alongside real code is not the class', () => {
  assert.equal(catalogueOnlyRaise({ raised: ['C1'], files: ['monitor/failure-taxonomy.json', 'bin/gate-tests.mjs'], message: 'x' }), null);
});

test('G13: a re-score CITING the commit that did the work is not the class', () => {
  assert.equal(catalogueOnlyRaise({ raised: ['C1'], files: ['monitor/failure-taxonomy.json'], message: 'taxonomy: C1 re-scored — closed by a7c4e19' }), null);
});

test('G13: touching only the RENDERER is still catalogue-only — editing the page is not the repair', () => {
  const r = catalogueOnlyRaise({ raised: ['C1'], files: ['monitor/failure-taxonomy.json', 'bin/taxonomy-render.mjs'], message: 'restyle' });
  assert.ok(r, 'bin/taxonomy-* is a taxonomy surface, not a repair');
});

test('G13: no raise, no finding — a closure DROP is a different thing entirely', () => {
  assert.equal(catalogueOnlyRaise({ raised: [], files: ['monitor/failure-taxonomy.json'], message: 'x' }), null);
  assert.deepEqual(raisedClosures({ C1: 4 }, { C1: 2 }), []);
  assert.deepEqual(raisedClosures({ C1: 2 }, { C1: 4 }), ['C1']);
  assert.deepEqual(raisedClosures({}, { C9: 3 }), [], 'a NEW class has nothing to have risen from');
});

// fact: a shallow clone or a one-commit repository carries no history to read; that is a skip with its reason, not a pass
const historyAbsent = () => {
  const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const commits = Number(git(['rev-list', '--count', 'HEAD']).trim());
  return (shallow || commits < 2) ? { skip: `this clone carries ${commits} commit(s)${shallow ? ' (shallow)' : ''} — a history guard has no history to read` } : {};
};

test('G13: no recent closure raise moved the catalogue without moving the world', historyAbsent(), (t) => {
  const shas = git(['log', '-n', String(WINDOW()), '--format=%H', '--', 'monitor/failure-taxonomy.json'])
    .trim().split('\n').filter(Boolean);
  // A published history can hold the registry in one commit: there is no earlier version to compare.
  if (shas.length < 2) {
    t.skip(`${shas.length} registry commit(s) in this history, so no raise can be compared`);
    return;
  }
  const at = (sha) => {
    try { return closureMap(JSON.parse(git(['show', `${sha}:monitor/failure-taxonomy.json`]))); } catch { return null; }
  };
  const offenders = [];
  let compared = 0;
  for (let i = 0; i < shas.length - 1; i++) {
    const cur = at(shas[i]);
    const prev = at(shas[i + 1]);
    if (!cur || !prev) continue;                       // unreadable at that revision: not a pass
    compared++;
    const files = git(['show', '--name-only', '--format=', '--first-parent', shas[i]]).trim().split('\n').filter(Boolean);
    const message = git(['log', '-1', '--format=%B', shas[i]]);
    const hit = catalogueOnlyRaise({ raised: raisedClosures(prev, cur), files, message });
    if (hit) offenders.push(`${shas[i].slice(0, 8)} raised ${hit.raised.join(',')}`);
  }
  assert.ok(compared > 0, 'zero comparable pairs — an empty population is not a clean one');
  assert.deepEqual(offenders, [], `closure raised with nothing behind it: ${offenders.join(' | ')}`);
});
