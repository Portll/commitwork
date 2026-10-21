// Two defects that each let the fleet claim more than it had measured. Extractors are IMPORTED
// from monitor/extractors.mjs; the regex literals below are still read from source because two
// parsers must be spelled alike.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _socketCounts, _sarifCounts, SCANNER_SPECS } from '../extractors.mjs';
import { SCANNER_CHECKS, CHECK_ALIASES, canonicalCheck } from '../scanner-checks.mjs';
import { extractorsSource } from './lib/extractors-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'rollup.mjs'), 'utf8');
// The osv message parse moved here from the rollup; the scoped-key bridge stayed in the rollup.
const DEP_SRC = readFileSync(join(HERE, '..', 'dep-findings.mjs'), 'utf8');

describe('the Socket husk is not evidence that Socket ran', () => {
  // {ok:false, message} once reported `ran, 0 alerts` — and cra/controls.mjs credits ran:true as
  // proof a scan happened
  test('the supplyChain SPEC — the one the rollup actually calls — refuses the husk', () => {
    // asserted through SCANNER_SPECS — runs the extractor the rollup will run
    const [, checkId, extract] = SCANNER_SPECS.find(([cat]) => cat === 'supplyChain');
    assert.equal(checkId, 'supply-chain-socket');
    const dir = mkdtempSync(join(tmpdir(), 'cw-spec-'));
    try {
      writeFileSync(join(dir, 'socket.json'), JSON.stringify({ ok: false, message: 'Input error' }));
      assert.equal(extract(dir), null,
        'the {ok:false} husk must not become a scanners entry — _countArray reported ran:true for any parseable file, and cra/controls.mjs credits ran:true as proof a scan happened');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('_socketCounts returns null for the husk and real counts for a real scan', () => {
    // imported, not lifted — the old eval harness never exercised the real absence path
    const fn = _socketCounts;
    const dir = mkdtempSync(join(tmpdir(), 'cw-husk-'));
    try {

      writeFileSync(join(dir, 'husk.json'), JSON.stringify({ ok: false, message: 'Input error', data: 'Org name … (missing)' }));
      assert.equal(fn(dir, 'husk.json'), null,
        'the husk must read as "no scan", the same as an absent artifact — never as a completed clean one');

      writeFileSync(join(dir, 'empty.json'), '');
      assert.equal(fn(dir, 'empty.json'), null, 'a zero-byte artifact is not a clean scan either');

      assert.equal(fn(dir, 'absent.json'), null, 'absent stays absent');

      writeFileSync(join(dir, 'real.json'), JSON.stringify({ ok: true, data: { alerts: {
        npm: { minimatch: { '9.0.6': { type: 'obfuscatedFile' } }, vitest: { '4.0.18': { type: 'criticalCVE' } } },
      } } }));
      const got = fn(dir, 'real.json');
      assert.equal(got.ran, true, 'a real scan reports that it ran');
      assert.equal(got.total, 2, 'and counts one alert per (package, version)');

      writeFileSync(join(dir, 'clean.json'), JSON.stringify({ ok: true, data: { alerts: {} } }));
      const clean = fn(dir, 'clean.json');
      assert.equal(clean.ran, true);
      assert.equal(clean.total, 0, 'a genuinely clean scan IS a zero — the point is only that the husk is not');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // allowlist, not denylist: a refusal that does not spell itself {ok:false} (quota exhaustion,
  // empty object, ok:true with no alerts tree) used to fall through into "ran, 0 findings"
  test('a quota refusal, an unknown-shaped error, and ok:true-with-no-alerts-tree all read as void, never a clean ran', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-husk-quota-'));
    try {
      writeFileSync(join(dir, 'quota.json'), JSON.stringify({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }));
      assert.equal(_socketCounts(dir, 'quota.json'), null,
        'a quota-shaped refusal with no `ok` field at all must not read as ran:true — this is the shape the old denylist could not name in advance');

      writeFileSync(join(dir, 'empty-obj.json'), JSON.stringify({}));
      assert.equal(_socketCounts(dir, 'empty-obj.json'), null, 'an empty object is not an affirmed completion');

      writeFileSync(join(dir, 'ok-no-data.json'), JSON.stringify({ ok: true }));
      assert.equal(_socketCounts(dir, 'ok-no-data.json'), null,
        'ok:true alone is not the measured success shape — data.alerts must also be present');

      writeFileSync(join(dir, 'ok-false-with-legacy.json'), JSON.stringify({ ok: false, issues: [{ type: 'x' }] }));
      assert.equal(_socketCounts(dir, 'ok-false-with-legacy.json'), null,
        'ok:false vetoes completion even if a legacy-looking array rides along beside it');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  // negative control — a gate hard-wired to "always void" must not pass
  test('negative control: both MEASURED completion shapes still read as a real ran, clean or not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-husk-quota-'));
    try {
      writeFileSync(join(dir, 'modern.json'),
        JSON.stringify({ ok: true, data: { alerts: { npm: { lodash: { '4.17.20': { type: 'obfuscatedFile' } } } } } }));
      const modern = _socketCounts(dir, 'modern.json');
      assert.equal(modern.ran, true);
      assert.equal(modern.total, 1);

      writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ issues: [{ type: 'obfuscatedFile' }] }));
      const legacy = _socketCounts(dir, 'legacy.json');
      assert.equal(legacy.ran, true, 'an artifact from an older CLI must not start reading as a void just because the shape moved');
      assert.equal(legacy.total, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ZERO RULES LOADED is the SARIF sibling of the Socket husk: parses perfectly, totals zero, and
// only the loaded-rule count tells a clean scan from one with no means to find anything
describe('a SARIF with zero loaded rules is not evidence the scan found nothing', () => {
  const zeroRuleRun = { runs: [{ tool: { driver: { name: 'semgrep', rules: [] } }, results: [] }] };
  const fullRuleCleanRun = { runs: [{ tool: { driver: { name: 'semgrep', rules: [{ id: 'r1' }] } }, results: [] }] };
  const noRunsAtAll = { runs: [] };

  test('zero rules + zero results + a run present -> norules, never a clean ran', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-norules-'));
    try {
      writeFileSync(join(d, 'semgrep.sarif'), JSON.stringify(zeroRuleRun));
      const c = _sarifCounts(d, 'semgrep.sarif');
      assert.equal(c.ran, true);
      assert.equal(c.norules, true, 'zero loaded rules must not read as a clean run');
      assert.equal(c.total, 0);
      assert.equal(c.nosrc, undefined, 'norules is its own state, distinct from nosrc');
      assert.equal(c.unparseable, undefined, 'norules is its own state, distinct from unparseable — the SARIF is valid');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('rules loaded, genuinely zero results -> a real clean scan, never norules', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-norules-'));
    try {
      writeFileSync(join(d, 'semgrep.sarif'), JSON.stringify(fullRuleCleanRun));
      const c = _sarifCounts(d, 'semgrep.sarif');
      assert.equal(c.ran, true);
      assert.equal(c.norules, undefined, 'a real ruleset earning a real zero must not be flagged as configuration-void');
      assert.equal(c.total, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('no run entries at all stays a plain zero, not norules — "runs present" is a real gate, not decoration', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-norules-'));
    try {
      writeFileSync(join(d, 'semgrep.sarif'), JSON.stringify(noRunsAtAll));
      const c = _sarifCounts(d, 'semgrep.sarif');
      assert.equal(c.ran, true);
      assert.equal(c.norules, undefined, 'zero run entries is a different, more basic void than a rules-empty run');
      assert.equal(c.total, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the SPEC the rollup actually calls short-circuits on norules — no findings key, same as nosrc/unparseable', () => {
    const [, checkId, extract] = SCANNER_SPECS.find(([cat]) => cat === 'sastSemgrep');
    assert.equal(checkId, 'sast');
    const d = mkdtempSync(join(tmpdir(), 'cw-norules-'));
    try {
      writeFileSync(join(d, 'semgrep.sarif'), JSON.stringify(zeroRuleRun));
      const c = extract(d);
      assert.equal(c.norules, true);
      assert.equal(c.findings, undefined, 'a rules-empty run has nothing to detail, same as a husk — _sarifDetail must short-circuit on norules too');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('the scoped-package parse, and the bridge that keeps it from faking fixes', () => {
  // lifted from source — a copy would keep passing after the real one changed. Sliced from
  // /Package to the line's last slash: the pattern itself contains parentheses.
  const literalOn = (needle) => {
    const line = DEP_SRC.split('\n').find((l) => l.includes(needle));
    assert.ok(line, `${needle} was not found in dep-findings.mjs — this test needs updating`);
    const src = line.slice(line.indexOf("/Package"), line.lastIndexOf('/') + 1);
    return { re: new RegExp(src.slice(1, -1)), src };
  };
  const messageRe = literalOn("const pm = m.match(/Package").re;

  test('a SCOPED package keeps its scope — the old class excluded the leading @ entirely', () => {
    const hit = "Package '@ctrl/tinycolor@4.1.1'".match(messageRe);
    assert.ok(hit, "'@ctrl/tinycolor@4.1.1' must match — it is the Shai-Hulud worm record this file cites");
    assert.equal(hit[1], '@ctrl/tinycolor');
    assert.equal(hit[2], '4.1.1');
  });

  test('an unscoped package is unchanged — the fix must not re-key the other 99%', () => {
    const hit = "Package 'lodash@4.17.20'".match(messageRe);
    assert.equal(hit[1], 'lodash');
    assert.equal(hit[2], '4.17.20');
  });

  test('both parsers of osv.sarif now agree — they disagreed about the same file', () => {
    // parseOsv (dep-findings.mjs) and _malCounts (the extractors, via the source seam) parse the same message — both files
    // are read, a same-file check would miss the drift
    const EXTRACTORS = extractorsSource();   // the barrel AND its part modules — _malCounts moved out
    const all = `${SRC}\n${DEP_SRC}\n${EXTRACTORS}`.split('\n').filter((l) => l.includes(".match(/Package '"))
      .map((l) => l.slice(l.indexOf('/Package'), l.lastIndexOf('/') + 1));
    assert.ok(all.length >= 2, `expected at least two Package-message parsers, found ${all.length}`);
    assert.equal(new Set(all).size, 1,
      `the parsers of osv.sarif's message must be identical, found: ${[...new Set(all)].join('  vs  ')}`);
  });

  test('the bridge exists, is match-only, and covers BOTH the born and the resolve side', () => {
    assert.match(SRC, /const scopedBridgeKeys = /, 'the migration bridge must exist');
    // born side: a scoped finding must find its predecessor under the old blank-package key
    assert.match(SRC, /prevByKey\.get\(_b\.key\)/, 'the born/persisting lookup must consult the bridge');
    // resolve side: without this, every scoped finding is written out as resolved-fixed-candidate
    assert.match(SRC, /nowKeys\.add\(_b\.key\)/,
      'the bridge key must be published as still-present, or the regex fix manufactures a verified fix for every scoped finding');
    // and the EMITTED identity is always the corrected one, never the bridge
    assert.match(SRC, /f\.key = keyOf\(/, 'the emitted key stays the corrected one');
  });

  test('the bridge only fires for scoped packages, so it cannot collide with ordinary findings', () => {
    const at = SRC.indexOf('const scopedBridgeKeys = ');
    const body = SRC.slice(at, SRC.indexOf(';\n', at));
    assert.match(body, /startsWith\('@'\)/,
      'an unscoped finding never had a broken parse, so it must not get a second identity');
  });
});
