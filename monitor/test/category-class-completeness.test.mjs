// A scanner category with no class is a LIVE BREAK, not a cosmetic gap: monitor/issue-store.mjs
// mints every id through classForIssue -> classForCategory, which THROWS by design rather than
// defaulting, because a silent default is how a vocabulary fragments.
//
// It has now happened twice. 2026-08-22: five categories added in one day had no class, ingest
// failed on 'supplyChainPosture', and a co-session found it — not a test. The fix added the
// entries and a comment saying "every new rollup category must land here in the same commit as the
// category". 2026-08-25: THIRTEEN categories had no class. The rule was written down and nothing
// enforced it, which is the only part of the story that matters — a convention with no gate is a
// convention that describes the past.
//
// This file is that gate. It is deliberately about the REGISTRIES and not about any one lane, so
// adding a lane cannot pass it by touching only the code the lane author was thinking about.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SCANNER_SPECS } from '../extractors.mjs';
import { SCANNER_CHECKS } from '../scanner-checks.mjs';
import { ROW_SCHEMAS } from '../detail-schema.mjs';
import { CLASS, CLASS_FOR_CATEGORY, classForCategory } from '../issue-key.mjs';

const categories = SCANNER_SPECS.map(([k]) => k);

// `source.tool` carries two vocabularies — rollup categories AND dependency tool names — so these
// four are entries with no matching category BY DESIGN. Declared here so the reverse check can be
// strict about everything else instead of being switched off.
const TOOL_NAME_KEYS = new Set(['osv', 'npm', 'sast', 'deps']);

describe('every scanner category can be turned into an issue', () => {
  test('CLASS_FOR_CATEGORY covers every category in SCANNER_SPECS', () => {
    const missing = categories.filter((c) => !Object.hasOwn(CLASS_FOR_CATEGORY, c));
    assert.deepEqual(missing, [],
      `these categories have no class, so issue ingest THROWS for every finding in them — `
      + `monitor/issue-store.mjs mints ids through classForIssue. Add each to CLASS_FOR_CATEGORY in `
      + `monitor/issue-key.mjs, in the same commit as the lane.`);
  });

  test('and classForCategory actually resolves each one — the registry is not consulted by hearsay', () => {
    for (const c of categories) {
      const cls = classForCategory(c);
      assert.ok(Object.hasOwn(CLASS, cls), `${c} maps to '${cls}', which is not a declared CLASS`);
    }
  });

  test('every CLASS_FOR_CATEGORY key is a real category or a declared tool name', () => {
    const orphans = Object.keys(CLASS_FOR_CATEGORY)
      .filter((k) => !categories.includes(k) && !TOOL_NAME_KEYS.has(k));
    assert.deepEqual(orphans, [],
      'an entry for a category that no longer exists is dead weight that reads as coverage — '
      + 'remove it, or add it to TOOL_NAME_KEYS here if it is a dependency tool name.');
  });

  test('the two directions disagree only where TOOL_NAME_KEYS says they may', () => {
    // Pins the exemption itself: if a tool-name key stops being needed, this fails rather than
    // leaving a permanent hole the first check can never see.
    for (const k of TOOL_NAME_KEYS) {
      assert.ok(Object.hasOwn(CLASS_FOR_CATEGORY, k),
        `${k} is declared exempt from the category check but is not in the registry at all — `
        + 'the exemption outlived its reason.');
    }
  });
});

describe('the registries a category must reach, together', () => {
  test('SCANNER_SPECS and SCANNER_CHECKS name the same set', () => {
    const checks = Object.keys(SCANNER_CHECKS);
    assert.deepEqual(categories.filter((c) => !checks.includes(c)), [],
      'a category with no check id cannot say which lane produced it');
    assert.deepEqual(checks.filter((c) => !categories.includes(c)), [],
      'a check id with no category produces rows nothing will read');
  });

  test('every category declares a row schema, so a drill-down is never silently shapeless', () => {
    const missing = categories.filter((c) => !Object.hasOwn(ROW_SCHEMAS, c));
    assert.deepEqual(missing, [],
      'ROW_SCHEMAS decides what a detail row may carry; a category without one publishes rows no '
      + 'consumer can validate. Add it in monitor/detail-schema.mjs.');
  });

  test('the count is stated, so a shrinking registry is visible rather than merely true', () => {
    assert.ok(categories.length >= 43,
      `SCANNER_SPECS holds ${categories.length} categories; it held 43 on 2026-08-25. A DROP is `
      + 'either a deliberate retirement — update this floor in the same commit — or a lane that '
      + 'stopped being registered, which is the failure this file exists to catch.');
  });
});
