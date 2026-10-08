// The tripwire for advisory-reach.mjs's ONE empirical assumption.
//
// The reachability rule is analytic — npm requires semver, so a non-semver version was never
// resolved from the registry — and nothing about the fleet can make that false. What CAN change is
// the INPUT: the rule only ever fires because osv-scanner reports a git-pinned dependency as a
// commit-ish (`Package 'closure-net@6f48f578' is vulnerable to ...`). If a future osv-scanner
// resolves git dependencies to the version in their package.json instead, every demotion silently
// stops happening — and an absent demotion is byte-indistinguishable from a correct one.
//
// advisory-reach.test.mjs pins the two version strings as CONSTANTS, which proves the rule and
// proves nothing about the tool. This file reads the LIVE sweep artifact and asserts the grammar
// still produces what the rule needs. Its whole value is that it is grounded in a file this repo
// did not write.
//
// It is SKIPPED, loudly, when no sweep is on disk: reports/ is gitignored (untracked 2026-08-24),
// so a clean checkout and CI legitimately have nothing to read. A skip here is "not measured",
// never "measured and fine" — the same rule the code under test exists to enforce.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, isSemver } from '../advisory-reach.mjs';
import { classifyPath } from '../fixture-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Env at CALL time, never at module load — a const here would defeat any test that sets it after.
const reportsRoot = () => resolve(process.env.CW_REPORTS_ROOT || join(HERE, '..', '..', 'reports'));

/** Every sweep directory holding a per-repo osv.sarif, newest first.
 *
 *  ALL of them, not just the newest. The newest sweep is routinely a single-repo scan of one of the
 *  operator's own projects, and every one of those carries zero MAL- rows — correctly, they have no
 *  malicious dependencies. Reading only the newest made a legitimate clean result look like a broken
 *  tripwire, which is this repository's own named defect wearing the other hat. */
function sweepsWithOsv() {
  const root = reportsRoot();
  if (!existsSync(root)) return [];
  const out = [];
  for (const s of readdirSync(root).filter((d) => d.startsWith('sweep-')).sort().reverse()) {
    const dir = join(root, s);
    try {
      // `sweep-latest.log` and `sweep-refusals.jsonl` match the prefix and are files, not sweeps.
      if (readdirSync(dir).some((repo) => existsSync(join(dir, repo, 'osv.sarif')))) out.push(dir);
    } catch { /* not a directory */ }
  }
  return out;
}

/** Every `Package 'name@version'` MAL- row across a sweep, read the way parseOsv reads them. */
function malRows(sweep) {
  const out = [];
  for (const repo of readdirSync(sweep)) {
    const f = join(sweep, repo, 'osv.sarif');
    if (!existsSync(f)) continue;
    let doc;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const run of doc.runs || []) {
      const rules = Object.fromEntries((run.tool?.driver?.rules || []).map((r) => [r.id, r]));
      for (const res of run.results || []) {
        const rule = rules[res.ruleId] || {};
        const hay = [res.ruleId, rule.id, rule.shortDescription?.text, res.message?.text]
          .filter((s) => typeof s === 'string').join('\n');
        const mal = hay.match(/\bMAL-\d{4}-\d+\b/);
        if (!mal) continue;
        const pm = (res.message?.text || '').match(/Package '([^']+)@([^']+)'/);
        out.push({ repo, id: mal[0], package: pm ? pm[1] : '', version: pm ? pm[2] : '',
          path: res.locations?.[0]?.physicalLocation?.artifactLocation?.uri || '' });
      }
    }
  }
  return out;
}

describe('advisory-reach — the input assumption, read from the live artifact', () => {
  const sweeps = sweepsWithOsv();
  const rows = sweeps.flatMap((s) => malRows(s).map((r) => ({ ...r, sweep: s })));

  test('some sweep on disk carries a MAL- row, or this file is NOT MEASURED', (t) => {
    if (!sweeps.length) {
      return t.skip(`no sweep under ${reportsRoot()} — the drift tripwire did NOT run. This is `
        + '"unmeasured", not "passing": reports/ is gitignored, so a clean checkout has nothing to '
        + 'read. Point CW_REPORTS_ROOT at a sweep to exercise it.');
    }
    if (!rows.length) {
      return t.skip(`${sweeps.length} sweep(s) on disk and no MAL- row in any of them. A fleet with `
        + 'no malicious-package findings is a legitimate state, not a broken tripwire — but the rule '
        + 'is unexercised by real data until one appears.');
    }
    assert.ok(rows.length);
  });

  test('osv-scanner still reports a git-pinned dependency as a COMMIT-ISH, not a semver', (t) => {
    if (!rows.length) return t.skip('no MAL- rows on disk — see above');

    const nonSemver = rows.filter((r) => r.version && !isSemver(r.version));
    if (!nonSemver.length) {
      // Either osv-scanner changed how it resolves git dependencies — in which case the rule has
      // silently stopped firing and its absence looks exactly like correctness — or the corpus no
      // longer holds a git-pinned name collision. Do not assume the second.
      return t.skip(`${rows.length} MAL- row(s) across ${sweeps.length} sweep(s) and NONE carries a `
        + 'non-semver version. Either osv-scanner changed how it resolves git dependencies (the rule '
        + 'has silently stopped firing), or the corpus no longer contains one. Check, do not assume.');
    }
    for (const r of nonSemver) {
      const c = classify(r);
      assert.equal(c.reachable, false, `${r.repo}: ${r.package}@${r.version} should demote`);
      assert.equal(c.unknownReason, 'subject-mismatch');
    }
  });

  test('no MAL- row survives to crit without a reason we can state', (t) => {
    if (!rows.length) return t.skip('no MAL- rows on disk — see above');
    // Fixture rows are a different population and _malCounts already sets them aside; counting
    // them here would report a residue of 60 that no published number contains.
    const survivors = rows.filter((r) => classify(r).reachable && !classifyPath(r.path).fixture);
    // Every survivor is either real malware or a THIRD shape of unreachable advisory that neither
    // detector knows. Both want a human; the count read 0 non-fixture on 2026-08-24. This does not
    // fail on a survivor — a real worm SHOULD survive — it reports them so the residue is measured
    // rather than assumed empty.
    if (survivors.length) {
      const byPkg = [...new Set(survivors.map((s) => `${s.repo}: ${s.package}@${s.version}`))];
      t.diagnostic(`${survivors.length} non-fixture MAL- row(s) published as crit: ${byPkg.join(', ')}. `
        + 'Each is real malware or an unreachable shape neither detector knows.');
    }
    for (const s of survivors) {
      assert.ok(s.version, `${s.repo}: ${s.package} survived with NO version — the message grammar `
        + 'may have changed, and an unparsed row is being published as a critical');
    }
  });
});
