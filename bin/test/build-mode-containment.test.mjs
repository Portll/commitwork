// A lane that BUILDS the scanned repository executes code from a tree this fleet does not own.
// That is a containment question, not a coverage one, and until 2026-08-26 it was answered by a
// sentence in a manifest note rather than by anything that could refuse.
//
// WHAT HAPPENED. `sast-codeql-swift` carried the note "it sits in the deep group only and never in
// a default sweep" while declaring groups ["all","deep"]. Nothing joined the two. Three sweeps
// recorded `group: "all"` ran it against third-party repositories and executed their build tooling:
// MarkEdit-app_MarkEdit fetched SwiftLintBinary.artifactbundle.zip from a remote release and
// entered build-tool plugins; Instagram_IGListKit compiled Objective-C++; clientB ran
// xcodebuild against facebook-ios-sdk's workspace resolved inside
// node_modules/@capacitor-firebase/authentication/.build/checkouts.
//
// THE RULE IS DERIVED, NOT LISTED. A hardcoded [ 'sast-codeql-swift' ] here would pass forever and
// protect nothing the day a second building lane is added — the same defect one layer along. The
// predicate reads the COMMAND, so a new lane inherits the guard by being what it is.

// AND IT ASKS THE SELECTOR, NOT THE FIELD. A first version of this file read `check.groups`
// directly. That is not what decides whether a lane runs: bin/commitwork.mjs's `groupMembers()` is
// the UNION of the manifest's top-level `groups` map and each check's own `groups` tag, and the two
// have drifted before — measured 2026-08-20, three checks tagged themselves into `all`, appeared in
// no map, and were unreachable from every group. Reading the tag alone would let someone add
// `sast-codeql-swift` to `groups.all` in the map while this test went on passing, which is the
// guard certifying its own blind spot. Verified 2026-08-26 against the real selector: all n=49
// without swift, deep n=15 with it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { groupMembers, buildsScannedTree, containedVoids } from '../commitwork.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = () => process.env.CW_BASELINE_MANIFEST || join(CW, 'manifests', 'security-baseline.json');

/** Groups a sweep may select WITHOUT asking for heavy, code-executing analysis. `deep` is the
 *  opt-in; everything else is a default surface. */
const DEFAULT_GROUPS = new Set(['all', 'fast', 'quick', 'standard', 'supply-chain', 'runtime']);

// THE PREDICATE IS IMPORTED, NOT RE-DECLARED. It lives in bin/commitwork.mjs beside the code that
// ACTS on it (containedVoids), so the lane that gets confined and the lane that reports itself
// confined can never be two different sets. Its boundaries are documented there: an explicit
// --build-mode=autobuild only; --build-mode=none never matches; and a `database create` with no
// build-mode flag (javascript-typescript) is NOT building, because no compiler runs.
// This file takes a CHECK, so the call sites below pass the check object rather than a string.

const manifestOf = () => JSON.parse(readFileSync(manifestPath(), 'utf8'));
function checksOf() {
  return manifestOf().checks || [];
}
const cmdOf = (c) => (Array.isArray(c.local) ? c.local : []).join(' ');

/** The ids a sweep of `group` would ACTUALLY run — map ∪ tags, via the shipped selector. */
const idsInGroup = (m, group) => new Set(groupMembers(m, group).map((c) => c.id));

describe('a lane that builds the scanned tree is confined to the deep group', () => {
  test('no building lane is SELECTED by any default sweep group', () => {
    const m = manifestOf();
    const building = m.checks.filter((c) => buildsScannedTree(c)).map((c) => c.id);
    const offenders = [];
    for (const g of DEFAULT_GROUPS) {
      const selected = idsInGroup(m, g);
      for (const id of building) if (selected.has(id)) offenders.push(`${id} is selected by group '${g}'`);
    }
    assert.deepEqual(offenders, [],
      'a lane whose command compiles the scanned repository must be opt-in (deep) only — it runs '
      + 'third-party code, and a default sweep covers repositories this fleet does not own');
  });

  test('and `deep` DOES select it, so containment did not become deletion', () => {
    const m = manifestOf();
    const deep = idsInGroup(m, 'deep');
    for (const c of m.checks) {
      if (!buildsScannedTree(c)) continue;
      assert.ok(deep.has(c.id),
        `${c.id} builds the tree and is selected by NO group at all — that is removal, not containment`);
    }
  });

  test('at least one building lane EXISTS, so the assertion above is not vacuous', () => {
    const building = checksOf().filter((c) => buildsScannedTree(c)).map((c) => c.id);
    assert.ok(building.length > 0,
      'no lane matched the building predicate — either the predicate broke or the lane was removed; '
      + 'either way the containment test above is passing without testing anything');
    assert.ok(building.includes('sast-codeql-swift'),
      'sast-codeql-swift uses --build-mode=autobuild and must be recognised by the predicate');
  });

  test('a building lane still declares deep, so containment did not become non-execution', () => {
    for (const c of checksOf()) {
      if (!buildsScannedTree(c)) continue;
      assert.ok((c.groups || []).includes('deep'),
        `${c.id} builds the tree but is in no group at all — that is removal, not containment`);
    }
  });
});

describe('the guard bites through BOTH paths into a group', () => {
  // The two ways a check reaches a group, asserted separately. A guard that only closes one is the
  // shape that let three checks sit unreachable from every group for weeks.
  const offendersIn = (m) => {
    const building = m.checks.filter((c) => buildsScannedTree(c)).map((c) => c.id);
    const out = [];
    for (const g of DEFAULT_GROUPS) {
      const sel = idsInGroup(m, g);
      for (const id of building) if (sel.has(id)) out.push(`${id}@${g}`);
    }
    return out;
  };

  test('path 1 — the per-check `groups` tag', () => {
    const m = manifestOf();
    m.checks = m.checks.map((c) => (c.id === 'sast-codeql-swift' ? { ...c, groups: ['all', 'deep'] } : c));
    assert.deepEqual(offendersIn(m), ['sast-codeql-swift@all'],
      'the exact regression that shipped must be caught');
  });

  test('path 2 — the top-level `groups` map, which the first version of this test could not see', () => {
    const m = manifestOf();
    m.groups = { ...m.groups, all: [...(m.groups.all || []), 'sast-codeql-swift'] };
    assert.deepEqual(offendersIn(m), ['sast-codeql-swift@all'],
      'adding a building lane to the groups MAP runs it in a default sweep just as surely as tagging it');
  });

  test('the unmutated manifest has no offenders — so the two above are not vacuous', () => {
    assert.deepEqual(offendersIn(manifestOf()), []);
  });
});

describe('the guard bites', () => {
  test('putting a building lane back into `all` is detected', () => {
    // Same predicate, applied to a mutated copy — the manifest on disk is never touched.
    const checks = checksOf().map((c) => (c.id === 'sast-codeql-swift'
      ? { ...c, groups: ['all', 'deep'] } : c));
    const offenders = checks
      .filter((c) => buildsScannedTree(c))
      .filter((c) => (c.groups || []).some((g) => DEFAULT_GROUPS.has(g)))
      .map((c) => c.id);
    assert.deepEqual(offenders, ['sast-codeql-swift'],
      'the exact regression that shipped must be caught by this predicate');
  });

  test('build-mode none is NOT treated as building — the non-executing lanes stay in `all`', () => {
    for (const id of ['sast-codeql-python', 'sast-codeql-ruby', 'sast-codeql-csharp', 'sast-codeql-cpp']) {
      const c = checksOf().find((x) => x.id === id);
      assert.ok(c, `${id} missing from the manifest`);
      assert.equal(buildsScannedTree(c), false,
        `${id} runs --build-mode=none and must not be confined — over-containment costs real coverage`);
      assert.ok((c.groups || []).includes('all'),
        `${id} does not execute the tree and belongs in the default sweep`);
    }
  });
});

// ── THE VOID ROW ────────────────────────────────────────────────────────────────────────────────
// Containment without a signal is the fix creating its own false clean: a Swift-heavy repo under a
// default sweep produces no Swift row at all, which is byte-identical to a repo with no Swift.
describe('a contained lane that APPLIES here records a void, not nothing', () => {
  const swiftRepo = () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-contain-sw-'));
    mkdirSync(join(d, '.git'), { recursive: true });
    writeFileSync(join(d, 'App.swift'), 'import Foundation\n');
    return d;
  };
  // The control needs a language NO contained lane applies to. It was Go until sast-codeql-go
  // landed and made this fixture a true positive — a control that stops controlling reads exactly
  // like a passing test. Ruby's lane is buildless, so it is contained by nothing.
  const rubyRepo = () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-contain-rb-'));
    mkdirSync(join(d, '.git'), { recursive: true });
    writeFileSync(join(d, 'app.rb'), "puts 'hi'\n");
    return d;
  };
  const selectedAll = (m) => groupMembers(m, 'all');

  test('a repo WITH swift gets a noscan naming containment', () => {
    const m = manifestOf();
    const rows = containedVoids(m, selectedAll(m), swiftRepo(), {});
    const swift = rows.find((r) => r.id === 'sast-codeql-swift');
    assert.ok(swift, 'a repo carrying .swift sources must not silently lose the Swift lane');
    assert.equal(swift.status, 'noscan', 'a deliberate gap is a void, never a pass and never a skip');
    assert.equal(swift.coverage, 'unknown', 'a lane that did not run established no coverage');
    assert.match(swift.reason, /contained/i);
    assert.match(swift.reason, /not a clean result/i);
  });

  test('a repo in a language no contained lane reads gets no row — a manufactured gap is over-reporting', () => {
    const m = manifestOf();
    const rows = containedVoids(m, selectedAll(m), rubyRepo(), {});
    assert.deepEqual(rows.map((r) => r.id), [],
      'a repo with none of the contained languages in it is not missing their scans');
  });

  test('under `deep`, where the lane IS selected, there is no void', () => {
    const m = manifestOf();
    const rows = containedVoids(m, groupMembers(m, 'deep'), swiftRepo(), {});
    assert.deepEqual(rows.map((r) => r.id), [],
      'the lane runs in deep, so reporting it as a gap there would be false');
  });
});

// ── DECLARED vs DERIVED ─────────────────────────────────────────────────────────────────────────
// The containment above is derived from the command. `containment` on the check is the DECLARED
// half — a reason and a review date, as data rather than as prose in formatNotes. The whole reason
// this key exists is that a sentence in formatNotes claimed deep-only containment while the groups
// said otherwise, and nothing joined the two. So both directions must fail:
//   declared-but-not-derived  — a lane says it is contained and its command does not build
//   derived-but-not-declared  — a lane builds and never says why it is held back
// This is the same two-witness shape as scopeNotes in monitor/scan-scope.mjs, for the same reason.
describe('containment is declared as data and cross-checked against the command', () => {
  test('every building lane DECLARES its containment, with a reason and a review date', () => {
    for (const c of checksOf()) {
      if (!buildsScannedTree(c)) continue;
      const d = c.containment;
      assert.ok(d, `${c.id} builds the scanned tree and declares no containment — the reason would live only in prose`);
      assert.ok(Array.isArray(d.excludedFrom) && d.excludedFrom.length,
        `${c.id}: containment.excludedFrom must name the groups it is held out of`);
      assert.ok(typeof d.reason === 'string' && d.reason.length > 60,
        `${c.id}: a containment without a substantive reason is a gap wearing a label`);
      assert.ok(typeof d.reviewBy === 'string' && !Number.isNaN(Date.parse(d.reviewBy)),
        `${c.id}: containment needs a review date — one nobody revisits is class E2, a suppression `
        + 'outliving its judgement, applied to coverage');
    }
  });

  test('nothing declares containment it does not need — declared-but-not-derived fails', () => {
    const offenders = checksOf()
      .filter((c) => c.containment && !buildsScannedTree(c))
      .map((c) => c.id);
    assert.deepEqual(offenders, [],
      'a lane claiming containment whose command does not build is a bound nobody is paying — it '
      + 'reads as caution and costs real coverage');
  });

  test('the declared exclusions AGREE with the selector', () => {
    const m = manifestOf();
    for (const c of m.checks) {
      if (!c.containment) continue;
      for (const g of c.containment.excludedFrom) {
        assert.ok(!idsInGroup(m, g).has(c.id),
          `${c.id} declares it is excluded from '${g}' and the selector puts it there anyway — `
          + 'exactly the shape that shipped: the claim and the enforcement were two different objects');
      }
    }
  });

  test('and the guard bites when the declaration goes stale', () => {
    const m = manifestOf();
    const sw = m.checks.find((x) => x.id === 'sast-codeql-swift');
    // Put it back in `all` while it still declares it is excluded from `all`.
    m.groups = { ...m.groups, all: [...(m.groups.all || []), 'sast-codeql-swift'] };
    const stale = [];
    for (const c of m.checks) {
      if (!c.containment) continue;
      for (const g of c.containment.excludedFrom) if (idsInGroup(m, g).has(c.id)) stale.push(`${c.id}@${g}`);
    }
    assert.deepEqual(stale, ['sast-codeql-swift@all'], `precondition: ${sw?.id} declares excludedFrom all`);
  });
});
