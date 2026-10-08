// monitor/approach-taxonomy.json must describe every check the fleet runs. Nothing asserted that.
//
// The taxonomy's own note says "monitor/test/posture-taxonomy.test.mjs asserts this table covers
// every check in every bundled manifest". That file does not exist. The assertion that does exist,
// in monitor/test/posture.test.mjs, is:
//
//     for (const a of board().approaches) assert.ok(a.type, ...)
//
// — it iterates the entries THAT ARE PRESENT. A check with no entry is not in the loop, so the
// guard is structurally blind to every absence. It validates the rows that exist and can never
// notice a missing one. Measured 2026-09-01: 64 declared checks, 47 approaches, 28 undeclared.
//
// That gap is not this test's to close — writing a declaration for someone else's lane means
// guessing what it IS, and the taxonomy's first rule is that every entry is DECLARED, never
// inferred from a check id or a tool name. So this is a RATCHET, in the shape bin/bare-catch-ratchet
// already uses here: the current gap is banked, a NEW undeclared check fails, and a gap that closes
// must be banked or the floor is stale. It makes the hole visible and stops it growing, without
// filling it with invented content or breaking the suite for everyone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// The FLEET manifests. internal-b-dev.json is deliberately out of scope: it is a per-repo example
// whose checks are one project's CI steps (lint, test, api-lint), not fleet security lanes, and
// demanding taxonomy entries for them would be demanding declarations of another repo's pipeline.
const FLEET_MANIFESTS = ['security-baseline.json', 'runtime.json', 'quality-gates.json', 'build-health.json'];

// Env read at CALL time, never at module load — a const at import defeats any test that sets it.
const baselinePath = () => process.env.CW_APPROACH_TAXONOMY_BASELINE
  || join(ROOT, 'monitor/approach-taxonomy-baseline.json');
// TRACKED, deliberately. bin/bare-catch-baseline.json is tracked for the same reason: a ratchet
// whose floor lives under .claude/ (gitignored here) reports NOT SEEDED in every fresh clone and
// in CI, so the guard would be present and inert everywhere except the machine that seeded it.

const declaredChecks = () => {
  const ids = new Set();
  for (const f of FLEET_MANIFESTS) {
    const p = join(ROOT, 'manifests', f);
    if (!existsSync(p)) continue;
    for (const c of (JSON.parse(readFileSync(p, 'utf8')).checks || [])) if (c.id) ids.add(c.id);
  }
  return ids;
};
const taxonomyChecks = () =>
  new Set(JSON.parse(readFileSync(join(ROOT, 'monitor/approach-taxonomy.json'), 'utf8'))
    .approaches.map((a) => a.check));

describe('approach-taxonomy covers the checks the fleet runs', () => {
  const declared = declaredChecks();
  const described = taxonomyChecks();
  const undeclared = [...declared].filter((id) => !described.has(id)).sort();

  test('the populations are real — neither side is empty', () => {
    assert.ok(declared.size >= 20, `only ${declared.size} checks found across ${FLEET_MANIFESTS.join(', ')} — `
      + 'the coverage assertions below would be near-vacuous');
    assert.ok(described.size >= 10, `only ${described.size} approaches declared`);
  });

  // Banked like `undeclared`, and for the same reason: an approach can name a check whose manifest
  // change is simply unlanded, which is a transient rather than a defect. Seeded from HEAD — a floor
  // seeded from a dirty worktree bakes in another session's unlanded manifest and then describes a
  // state no other checkout has, which is the ratchet's own version of the stale-reading trap.
  test('no NEW orphan — an approach naming a check no manifest declares', () => {
    const p = baselinePath();
    if (!existsSync(p)) return;   // the NOT SEEDED assertion below owns that case
    const bankedOrphans = new Set(JSON.parse(readFileSync(p, 'utf8')).orphans || []);
    const orphans = [...described].filter((c) => !declared.has(c)).sort();
    const fresh = orphans.filter((c) => !bankedOrphans.has(c));
    assert.deepEqual(fresh, [],
      `the taxonomy describes checks no manifest declares: ${fresh.join(', ')}. A renamed or deleted `
      + 'check leaves its description behind, and posture.mjs will keep reporting an approach the fleet no longer runs.');
  });

  test('the orphan floor tightens too — a banked orphan that came back cannot stay banked', () => {
    const p = baselinePath();
    if (!existsSync(p)) return;
    const bankedOrphans = JSON.parse(readFileSync(p, 'utf8')).orphans || [];
    const resolved = bankedOrphans.filter((c) => declared.has(c)).sort();
    assert.deepEqual(resolved, [],
      `the baseline banks ${resolved.join(', ')} as an orphan, but a manifest now declares it. Remove it: `
      + 'a bank that never empties is permission, not a ratchet.');
  });

  test('no NEW check goes undescribed — the ratchet', () => {
    const p = baselinePath();
    // ENOENT is exit-3 territory in bin/bare-catch-ratchet: an absent baseline is never a silent
    // pass, because "we have not measured this yet" and "there is nothing to find" are different.
    assert.ok(existsSync(p), `NOT SEEDED: no baseline at ${p}. An absent baseline must not read as a `
      + 'clean gap. Seed it with the current undeclared set before relying on this test.');
    const banked = new Set(JSON.parse(readFileSync(p, 'utf8')).undeclared || []);
    const fresh = undeclared.filter((id) => !banked.has(id));
    assert.deepEqual(fresh, [],
      `these checks run in the fleet and monitor/approach-taxonomy.json does not say what they ARE: ${fresh.join(', ')}.\n`
      + 'Add an entry declaring each one\'s type, sourceKind and escalation — never inferred from the check id, '
      + 'which is the taxonomy\'s first rule. posture.mjs cannot report on a lane it has no description for.');
  });

  test('the floor tightens — a check described since the baseline cannot stay banked', () => {
    const p = baselinePath();
    if (!existsSync(p)) return;   // the ratchet test above already failed on this
    const banked = JSON.parse(readFileSync(p, 'utf8')).undeclared || [];
    const stale = banked.filter((id) => described.has(id) || !declared.has(id)).sort();
    assert.deepEqual(stale, [],
      `the baseline still banks ${stale.join(', ')}, which ${stale.length === 1 ? 'is' : 'are'} no longer undeclared `
      + '(now described, or no longer a check at all). Remove them: a floor that never falls stops being a ratchet '
      + 'and becomes permission.');
  });
});
