// node --test monitor/test/  — the artifact parsers refuse a hostile SHAPE, and an unreadable
// secret scan never reads as a clean one.
//
// WHY. A scanned repository controls the JSON its scanner emits. Until this landed, every artifact
// reached extractors.mjs through a bare `JSON.parse(readFileSync(...))` — eight of them — so a
// crafted SARIF could carry a `__proto__` key, nest to exhaustion, or arrive unbounded. safe-parse
// (2026-08-27) was built for exactly this and was adopted by nothing; item 10 of
// EXECUTION-PLAN-detection-and-selfsec-2026-08-27 is the adoption.
//
// THE HALF THAT IS NOT MECHANICAL. `safeParseFile` throws on strictly MORE inputs than `JSON.parse`
// did. `_gitleaksCounts` caught a parse failure into `{..._zero(), ran: true}` — "ran, zero
// findings", i.e. a clean secret scan. That was already wrong at HEAD (a torn file read as clean),
// and adopting the stricter parser under the same catch would have WIDENED it: every newly-refused
// hostile shape would also have reported clean. So the catch is split, following the trufflehog
// idiom already in that file — no bytes means clean, bytes we cannot trust means a named void.
// A guard that makes the thing it guards report clean more often is not a guard.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _gitleaksCounts, SCANNER_SPECS } from '../extractors.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'cw-safeparse-'));

describe('the gitleaks lane distinguishes clean from unreadable', () => {
  test('NO BYTES is clean — gitleaks writes nothing on a clean tree', () => {
    const d = scratch();
    try {
      writeFileSync(join(d, 'gitleaks.json'), '');
      const r = _gitleaksCounts(d, 'gitleaks.json');
      assert.equal(r.ran, true, 'an empty artifact is a completed scan that found nothing');
      assert.equal(r.total, 0);
      assert.ok(!r.unreadable, 'a clean scan must not be flagged unreadable');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('UNPARSEABLE BYTES are a void — never ran:true, never a clean secret scan', () => {
    const d = scratch();
    try {
      writeFileSync(join(d, 'gitleaks.json'), '{"findings": [ truncated mid-writ');
      const r = _gitleaksCounts(d, 'gitleaks.json');
      assert.equal(r.ran, false, 'a torn artifact did not complete a scan');
      assert.equal(r.unreadable, true);
      assert.match(r.reason, /refused/, 'the row must carry WHY it is unreadable, not just that it is');
      assert.notDeepEqual(
        { ran: r.ran, total: r.total },
        { ran: true, total: 0 },
        'an unreadable secret scan reading as "ran, 0 findings" is the exact defect this split exists to prevent',
      );
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('ABSENT stays null — absence is the caller\'s to interpret, distinct from both', () => {
    const d = scratch();
    try {
      assert.equal(_gitleaksCounts(d, 'gitleaks.json'), null);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('a hostile artifact shape is refused, not parsed', () => {
  test('a prototype-pollution key is refused rather than parsed into the counts', () => {
    const d = scratch();
    try {
      // Valid JSON. JSON.parse accepts it; the danger is a downstream merge copying the key onto a
      // live prototype. safeParse refuses it at the source.
      writeFileSync(join(d, 'gitleaks.json'), '[{"RuleID":"x","File":"a.js","StartLine":1,"__proto__":{"polluted":true}}]');
      const r = _gitleaksCounts(d, 'gitleaks.json');
      assert.equal(r.unreadable, true, 'a pollution-shaped artifact must be refused, not counted');
      assert.equal({}.polluted, undefined, 'Object.prototype was polluted — the guard did not hold');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('unbounded nesting is refused before it reaches JSON.parse', () => {
    const d = scratch();
    try {
      writeFileSync(join(d, 'gitleaks.json'), '['.repeat(500) + ']'.repeat(500));
      const r = _gitleaksCounts(d, 'gitleaks.json');
      assert.equal(r.unreadable, true, 'a nesting bomb must be refused with a reason');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the adoption is complete and stays complete', () => {
  test('no extractor still parses an artifact with a bare JSON.parse(readFileSync(...))', async () => {
    // Through the seam, not the barrel: as monitor/extractors.mjs split into part modules this read
    // kept passing on a shrinking population — a bare parse added to any part would have passed too.
    const { extractorsSource } = await import('./lib/extractors-source.mjs');
    const src = extractorsSource();
    const bare = (src.match(/JSON\.parse\(readFileSync/g) || []).length;
    assert.equal(bare, 0,
      `${bare} artifact parse site(s) bypass safeParseFile — a scanned repo shapes this input, so every site must go through the guard`);
  });

  test('every SCANNER_SPECS extractor survives a hostile artifact without throwing out of the lane', () => {
    // The lane contract: an extractor returns null / a void row. It must never propagate a parser
    // exception, which would abort the whole rollup for one malformed file in one repo.
    const d = scratch();
    try {
      for (const name of ['gitleaks.json', 'semgrep.sarif', 'codeql.sarif', 'trivy-jvm.json',
        'osv.sarif', 'socket.json', 'hadolint.json', 'a11y.json', 'stub.json', 'retire.json']) {
        writeFileSync(join(d, name), '{"__proto__":{"x":1},"deeply":' + '['.repeat(400) + ']'.repeat(400) + '}');
      }
      for (const [key, , fn] of SCANNER_SPECS) {
        assert.doesNotThrow(() => fn(d), `${key} threw on a hostile artifact instead of reporting a void`);
      }
      assert.equal({}.x, undefined, 'Object.prototype was polluted by a lane extractor');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
