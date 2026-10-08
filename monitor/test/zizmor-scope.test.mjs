// The zizmor check scans a BOUNDED set of paths rather than the whole tree. Unbounded, zizmor
// walked .git/ worktrees and vendored copies and inflated the count ~350x — so the bound is load
// bearing, and this file exists to stop it going quietly out of date.
//
// The scanned paths are read out of the command in manifests/security-baseline.json, never
// restated here. A workflow outside that set fails unless scopeNotes declares it with
// `MINUS <path> — <why>`, and a declaration whose path has since vanished fails too. The three
// states are kept apart deliberately: SCANNED, EXCLUDED-AND-SAID-SO, and an undeclared gap. Only
// the last is a defect, and collapsing it into either of the others is how a bound rots.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// directories that are not this repo's own source — never attributed to it
//
// fixtures/ is NOT skipped. Skipping it was the previous design and it collapsed two different
// things into one: a workflow nobody scans because it is excluded, and a workflow nobody scans
// because this bound cannot see it. Those need to stay apart, so the canary's workflows are visible
// here and something has to account for each of them.
const SKIP = new Set(['.git', 'node_modules', 'reference', 'reports', '.claude', 'coverage']);

function walk(dir, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.github') { if (SKIP.has(e.name)) continue; }
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1, out);
    else if (/^action\.ya?ml$/.test(e.name) || /\/workflows\/[^/]+\.ya?ml$/.test(p)) out.push(relative(CW, p));
  }
  return out;
}

// THE BOUND IS DERIVED FROM THE MANIFEST, NOT RESTATED HERE. It used to hardcode '.github/', which
// meant the command and the test could disagree in one direction silently: widen the command and
// the test still passed, because it was asserting its own copy of the answer. Reading the scanned
// paths out of the command that actually runs closes that, and makes widening the scope require
// widening the notes — which is the behaviour the old failure message asked for but could not enforce.
const CHECK = (() => {
  const m = JSON.parse(readFileSync(join(CW, 'manifests', 'security-baseline.json'), 'utf8'));
  const c = m.checks.find((x) => x.id === 'actions-zizmor');
  assert.ok(c, 'actions-zizmor is not in the manifest — this test is asserting a bound on nothing');
  return c;
})();
// paths the command hands to zizmor: everything after the flags, before the first redirect
const SCANNED = (CHECK.local[0].split('>')[0].match(/(?:^|\s)((?:[\w.-]+\/)+)/g) || [])
  .map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
// a deliberate omission must SAY SO: `MINUS <path>` in scopeNotes, with a reason after it
const EXCLUDED = (CHECK.scopeNotes || []).flatMap((n) => {
  const m = /MINUS\s+(\S+?)\s+—\s+(.+)/.exec(n);
  return m ? [{ path: m[1], reason: m[2] }] : [];
});

// A THIRD STATE, AND IT IS THE HONEST ONE HERE. A path can be outside the scan for two unrelated
// reasons: someone decided it should be (EXCLUDED, above), or the scope has not caught up with the
// tree yet (a GAP). Collapsing them loses the only thing that distinguishes a settled decision from
// an outstanding one, and a gap silently becomes a policy the moment nobody remembers which it was.
//
// Gaps are declared in fixtures/scan-canary/EXPECTED.json rather than in the manifest, deliberately.
// The manifest is the right home for the scope itself, but it is held by many sessions at once —
// this declaration was written into it twice on 2026-09-02 and swept both times before it could be
// committed with the test that depends on it. A gap recorded in a file its owner can actually land
// is worth more than a correct scope that never survives to be committed.
const GAPS = (() => {
  try {
    const e = JSON.parse(readFileSync(join(CW, 'fixtures', 'scan-canary', 'EXPECTED.json'), 'utf8'));
    return (e.selfScanExclusions?.knownScopeGaps || []).filter((g) => g.lane === 'zizmor');
  } catch { return []; }   // absent canary = no gaps claimed; a stray then simply fails, which is right
})();

describe('the zizmor scan bound holds', () => {
  test('every workflow this repo owns is either scanned or explicitly excluded with a reason', () => {
    const found = walk(CW);
    const stray = found.filter((p) =>
      !SCANNED.some((s) => p.startsWith(s))
      && !EXCLUDED.some((e) => p.startsWith(e.path))
      && !GAPS.some((g) => p.startsWith(g.path)));
    assert.deepEqual(stray, [],
      `zizmor scans [${SCANNED.join(', ')}] per manifests/security-baseline.json. These files are `
      + 'in none of the three states this bound recognises — scanned, excluded, or a declared gap:\n  '
      + stray.join('\n  ')
      + '\nWiden the command, add a scopeNotes entry "MINUS <path> — <why>", or record a gap in '
      + 'fixtures/scan-canary/EXPECTED.json under selfScanExclusions.knownScopeGaps. '
      + 'An undeclared gap and a declared one are not the same thing.');
  });

  test('every declared exclusion still exists and still carries a reason', () => {
    // A stale MINUS is worse than none: it documents a gap that closed, and the next reader
    // trusts the note instead of the tree. Same defect as an inert .gitignore rule.
    for (const e of EXCLUDED) {
      assert.ok(walk(CW).some((p) => p.startsWith(e.path)),
        `scopeNotes excludes ${e.path} but nothing there matches — remove the note or restore the path`);
      assert.ok(e.reason.length > 40,
        `the exclusion for ${e.path} has no real reason: ${JSON.stringify(e.reason)}`);
    }
  });

  test('NOT VACUOUS: the derived scope is non-empty and includes .github/', () => {
    // If the path extraction ever silently returns [], every file becomes "stray" or every file
    // becomes fine depending on which way the filter falls — so pin the extraction itself.
    assert.ok(SCANNED.length > 0, 'no scanned paths parsed out of the zizmor command');
    assert.ok(SCANNED.includes('.github/'), `.github/ missing from parsed scope: ${JSON.stringify(SCANNED)}`);
  });

  test('and there IS something under .github/ to scan — a bound over nothing is not a pass', () => {
    // mirror assertion — an empty .github/ would let the first test pass on nothing
    const found = walk(CW).filter((p) => p.startsWith('.github/'));
    assert.ok(found.length > 0, 'no workflows found under .github/ — the bound would be scanning nothing');
  });
});
