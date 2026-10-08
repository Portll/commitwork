// monitor/test/registry-no-silent-green.test.mjs — a malformed, truncated or unreadable
// monitor/projects.json must NEVER produce an empty-but-successful result. Pins the MECHANISM
// (loadRegistry throws, exercised on scratch files only) and the SITES (a source scan for the
// swallowing shape over monitor/, bin/, admin/, sitemap/).

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegistry } from '../registry.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ═══ 1. THE MECHANISM — loadRegistry() throws, it never returns a degraded {} ═══════════════════

let scratch;
function scratchFile(name, body) {
  scratch ??= mkdtempSync(join(tmpdir(), 'cw-no-silent-green-'));
  const p = join(scratch, name);
  writeFileSync(p, body);
  return p;
}
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

describe('loadRegistry() never returns a degraded {} for a broken registry — it throws', () => {
  const cases = [
    ['truncated JSON (the exact failure mode a killed write leaves behind)', '{ "areas": [ { "slug": "x"  '],
    ['not JSON at all', 'this is not json'],
    ['empty file', ''],
    ['valid JSON, wrong top-level shape (an array, not an object)', '[1,2,3]'],
    ['valid JSON, hand-validator-invalid (area slug fails SLUG_RE)', JSON.stringify({ areas: [{ slug: 'Not A Valid Slug!' }] })],
    ['valid JSON, schema-invalid (areas item is a string, not an object)', JSON.stringify({ areas: ['not-an-object'] })],
  ];
  for (const [label, body] of cases) {
    test(`${label} -> throws, never {}`, () => {
      const p = scratchFile(`${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.json`, body);
      let threw = null, result;
      try { result = loadRegistry({ path: p, quiet: true }); } catch (e) { threw = e; }
      assert.ok(threw, `loadRegistry() must throw for [${label}] — it returned ${JSON.stringify(result)} instead of failing closed`);
      assert.ok(threw instanceof Error, 'the failure must be a real Error, not a sentinel value');
      assert.ok(threw.message && threw.message.length > 0, 'the thrown error must carry a message naming the problem');
      // the specific empty-but-successful shape this whole remediation exists to close:
      assert.notDeepEqual(result, {}, `must never silently resolve to {} for [${label}]`);
    });
  }

  test('an unreadable path (file does not exist) also throws, never {}', () => {
    const missing = join(scratch || mkdtempSync(join(tmpdir(), 'cw-no-silent-green-')), 'does-not-exist.json');
    let threw = null;
    try { loadRegistry({ path: missing, quiet: true }); } catch (e) { threw = e; }
    assert.ok(threw, 'a missing registry file must throw, not silently become {}');
    assert.match(threw.message, /unreadable/);
  });

  test('a VALID registry still loads normally — the fix does not make loadRegistry over-eager', () => {
    // minimal-but-COMPLETE (reportsRoot is schema-required) so the fixture cannot drift from the loader
    const body = JSON.stringify({ reportsRoot: 'reports', areas: [{ slug: 'ok', label: 'OK' }], projects: [] });
    const p = scratchFile('valid.json', body);
    const reg = loadRegistry({ path: p, quiet: true });
    assert.equal(reg.areas[0].slug, 'ok', 'a well-formed registry must still load and be usable');
  });
});

// ═══ 2. THE SITES — no raw, silently-swallowed registry parse remains (except the one exception) ═

// narrow, high-precision scanner: flags catches that degrade a registry read to an empty value,
// where the nearby context shows that read actually happening.
//
// WIDENED 2026-09-07, after it missed a live site for as long as it had existed. monitor/discover.mjs
// held `catch { _reg = {} }` — an ASSIGNMENT to empty, not a `return` — and the shape test only knew
// the return forms, so a malformed registry became an empty fleet, returned as a success, in the
// module every sweep resolves its repos through. An assignment and a return differ by syntax and by
// nothing else that matters: both hand the caller a registry that parsed cleanly and holds nothing.
//
// The scan was also FLAT, so nothing under admin/routes/ was ever read — the directory holding the
// panel's route handlers, each of which reads the registry. Two blind spots, and neither was in the
// part of the check anyone looks at: the shape list and the walk, not the assertion.
//
// The context test accepts registryPath()/loadRegistry() as well as the literal path, because the
// consumers that were just repointed no longer spell `projects.json` anywhere near the read — the
// detector would otherwise have gone quiet on them for the same reason it was fixed.
const SWALLOW_VALUE = String.raw`(\{\s*\}|null|\[\s*\])`;
const RETURNS_EMPTY = new RegExp(String.raw`^return\s*${SWALLOW_VALUE}\s*;?$`);
const ASSIGNS_EMPTY = new RegExp(String.raw`^[A-Za-z_$][\w$.]*\s*=\s*${SWALLOW_VALUE}\s*;?$`);

function findBareRegistryCatches(text) {
  const hits = [];
  // The body alternation must admit a NESTED `{}`, or the matcher cannot see its own advertised
  // cases: `[^{}]*` excludes braces, so `catch { return {}; }` and `catch { _reg = {}; }` never
  // matched at all. The comment above this function claimed `return {}` was covered from the day
  // it was written, and it was not — the empty-catch case passed, which was enough to look alive.
  const re = /catch\s*(\([^)]*\))?\s*\{((?:[^{}]|\{\s*\})*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2].trim();
    const isSwallow = body === '' || RETURNS_EMPTY.test(body) || ASSIGNS_EMPTY.test(body);
    if (!isSwallow) continue;
    const windowStart = Math.max(0, m.index - 260);
    const before = text.slice(windowStart, m.index);
    const readsRegistry = /projects\.json/.test(before)
      || /registryPath\s*\(/.test(before) || /loadRegistry\s*\(/.test(before);
    if (readsRegistry && /JSON\.parse|readFileSync/.test(before)) hits.push(m[0].replace(/\s+/g, ' '));
  }
  return hits;
}

const SCAN_DIRS = ['monitor', 'bin', 'admin', 'sitemap'];
// deliberately empty — any entry appearing here again is a regression, not an exception
const KNOWN_UNFIXED = new Set();

function scanRepoForSwallowingSites() {
  const bySite = {};
  for (const d of SCAN_DIRS) {
    // RECURSIVE. The flat readdirSync this replaces could not see admin/routes/, which is where
    // the panel keeps every handler that reads the registry.
    const walk = (dir, acc = []) => {
      let entries = [];
      try { entries = readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }); } catch { return acc; }
      for (const e of entries) {
        // Tests are not sites. Recursing found this very file, whose non-vacuity fixtures contain
        // the swallow shapes as STRING LITERALS — a detector that reports its own test data would
        // be permanently red for the one reason that proves it works. The flat scan never reached
        // test/ and so never had to decide this; the recursive one must.
        if (e.name === 'node_modules' || e.name === 'test' || e.name.startsWith('.')) continue;
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel, acc);
        else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) acc.push(rel);
      }
      return acc;
    };
    for (const rel of walk(d)) {
      const f = rel.slice(rel.lastIndexOf('/') + 1);
      if (!f.endsWith('.mjs')) continue;
      let text;
      try { text = readFileSync(join(REPO_ROOT, rel), 'utf8'); } catch { continue; }
      const hits = findBareRegistryCatches(text);
      if (hits.length) bySite[rel] = hits;
    }
  }
  return bySite;
}

// THE DETECTOR'S OWN SECOND WITNESS.
//
// Everything below asserts that a scan found nothing. A scan that CANNOT find anything also finds
// nothing, and reads identically — which is not a hypothetical here: the assignment form went
// undetected in monitor/discover.mjs for as long as the check existed, and the suite was green the
// whole time. Until 2026-09-07 nothing exercised findBareRegistryCatches against a known-bad input,
// so the site half of this file had no floor under it.
//
// Each case below is a shape that MUST be caught, asserted one at a time so a regression names the
// form it lost rather than just going quiet. The negative control matters as much: a detector that
// flags every empty catch in the codebase would pass all of these and be useless.
describe('THE DETECTOR CAN SEE — a known-bad shape is caught, an unrelated one is not', () => {
  const withCtx = (body) => `const p = registryPath();\nlet reg;\ntry { reg = JSON.parse(readFileSync(p, 'utf8')); } ${body}`;

  test('an EMPTY catch is caught', () => {
    assert.equal(findBareRegistryCatches(withCtx('catch {}')).length, 1);
  });

  test('`return {}` is caught', () => {
    assert.equal(findBareRegistryCatches(withCtx('catch (e) { return {}; }')).length, 1);
  });

  test('ASSIGNMENT to {} is caught — the exact shape that hid in monitor/discover.mjs', () => {
    // `catch { _reg = {} }`. It differs from `return {}` by syntax and by nothing that matters:
    // both hand back a registry that parsed cleanly and holds no fleet.
    assert.equal(findBareRegistryCatches(withCtx('catch { _reg = {}; }')).length, 1,
      'the assignment form is the one this detector was blind to — losing it re-opens the defect');
  });

  test('assignment to null and to [] are caught too', () => {
    assert.equal(findBareRegistryCatches(withCtx('catch { _reg = null; }')).length, 1);
    assert.equal(findBareRegistryCatches(withCtx('catch { rows = []; }')).length, 1);
  });

  test('the literal path is not required — a registryPath() read counts', () => {
    // The repointed consumers no longer spell projects.json near the read. A detector keyed only on
    // that string would have gone silent on them for the same reason it was widened.
    const t = "const p = registryPath();\ntry { r = JSON.parse(readFileSync(p)); } catch { r = {}; }";
    assert.equal(findBareRegistryCatches(t).length, 1);
  });

  test('NEGATIVE: an empty catch with no registry read nearby is NOT flagged', () => {
    assert.deepEqual(findBareRegistryCatches('try { rmSync(tmp, { recursive: true }); } catch {}'), [],
      'flagging every empty catch would make this check noise, and noise gets muted');
  });

  test('NEGATIVE: a catch that RE-THROWS is not a swallow', () => {
    assert.deepEqual(findBareRegistryCatches(withCtx('catch (e) { throw e; }')), []);
  });
});

describe('no *.mjs under monitor/, bin/, admin/, sitemap/ silently swallows a registry parse failure', () => {
  const bySite = scanRepoForSwallowingSites();

  test('the only remaining swallowing site is the one documented exception', () => {
    const found = Object.keys(bySite).sort();
    const unexpected = found.filter((f) => !KNOWN_UNFIXED.has(f));
    assert.deepEqual(unexpected, [],
      `these file(s) still swallow a registry parse failure with a bare/empty catch (the exact ` +
      `defect this remediation closes): ${unexpected.map((f) => `${f} [${bySite[f].join(', ')}]`).join('; ')}`);
  });

  test('the exception list is not stale — every entry in it must still actually swallow', () => {
    // a stale allowlist entry must FAIL here rather than pass vacuously
    const stale = [...KNOWN_UNFIXED].filter((f) => !(f in bySite));
    assert.deepEqual(stale, [],
      `KNOWN_UNFIXED names file(s) that no longer swallow — remove them rather than leaving the ` +
      `exclusion to pass vacuously: ${stale.join(', ')}`);
  });

  test('ZERO swallowing sites remain — all thirteen the remediation named are closed', () => {
    // pinned as an absolute — catches both a reverted fix and a new site
    const found = Object.keys(bySite);
    assert.deepEqual(found, [], `expected no swallowing sites, found ${found.length}: ${found.join(', ')}`);
  });
});

// ═══ 3. every fixed site actually goes through the one correct loader, not just "no bare catch" ═
// proves the new code is not a no-op replacement: loadRegistry() for CLI tools,
// registry()/REGISTRY_BOOT for admin/serve.mjs
describe('every fixed site actually calls the validated loader, not a look-alike no-op', () => {
  const FAIL_LOUD_FILES = [
    'monitor/backfill-dimensions.mjs', // degrade-loudly, but still routes through loadRegistry()
    'monitor/timeline.mjs',
    'monitor/timeline2.mjs',
    'monitor/rollup.mjs',
    'monitor/verify-corrected.mjs',
    'monitor/sync-map-history.mjs',
    'monitor/runtime-report.mjs',
    'monitor/corrected-history.mjs',
    'monitor/retro-ledger.mjs', // degrade-loudly, but still routes through loadRegistry()
    'bin/races.mjs',
  ];
  for (const rel of FAIL_LOUD_FILES) {
    test(`${rel} imports and calls loadRegistry()`, () => {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
      assert.match(text, /import\s*\{[^}]*\bloadRegistry\b[^}]*\}\s*from\s*['"][^'"]*registry\.mjs['"]/,
        `${rel} must import loadRegistry from registry.mjs`);
      assert.match(text, /loadRegistry\s*\(/, `${rel} must actually call loadRegistry()`);
    });
  }

  test('the two DEGRADE-LOUDLY sites (backfill-dimensions.mjs, retro-ledger.mjs) thread a registryUnavailable marker into their written output', () => {
    for (const rel of ['monitor/backfill-dimensions.mjs', 'monitor/retro-ledger.mjs']) {
      const text = readFileSync(join(REPO_ROOT, rel), 'utf8');
      assert.match(text, /registryUnavailable/, `${rel} must carry a registryUnavailable marker into what it writes — a degrade must never be indistinguishable from a clean run`);
      assert.match(text, /console\.error/, `${rel} must console.error the failure, not just record it silently`);
    }
  });

  test('admin/serve.mjs has no raw PROJECTS registry read left — it reuses registry()/REGISTRY_BOOT', () => {
    const text = readFileSync(join(REPO_ROOT, 'admin/serve.mjs'), 'utf8');
    assert.doesNotMatch(text, /const\s+PROJECTS\s*=/, 'admin/serve.mjs must not re-introduce its own raw registry parse');
    assert.match(text, /\bREGISTRY_BOOT\b/, 'admin/serve.mjs must still use the boot-time validated registry');
    assert.match(text, /\bregistry\(\)/, 'admin/serve.mjs must still use its request-time-safe registry() accessor');
  });
});
