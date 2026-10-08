// node --test monitor/test/  — weaknessClass is advisory-backed or empty (never guessed from a
// package's name), and scanProvenance is a required, emitted field: undeterminable stays ABSENT,
// never stamped ran:false. Pure + hermetic: fixtures only, fixed `now`.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleLifecycle, npmAuditCweIndex, scanProvenanceFor, SCAN_CHECK_FOR_TOOL } from '../lifecycle.mjs';
import { validateLifecycleRecords, lifecycleSchema } from '../validate-authored-judgment.mjs';
import { createRegistry, weaknessClassForRule } from '../cwx-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-07-26T02:10:00.000Z';
const SCAN_AT = '2026-07-26T02:05:48.976Z';

// A finding in rollup's recOf shape. Defaults are a real npm dependency finding.
const rec = (o = {}) => ({
  repo: 'web-api-docs', tool: 'npm', id: 'brace-expansion', severity: 'high', cvss: 0,
  package: 'brace-expansion', version: '', path: 'package-lock.json', title: 'brace-expansion (high)',
  key: `web-api-docs|npm|${o.id || 'brace-expansion'}|${o.package || o.id || 'brace-expansion'}|package-lock.json`,
  state: 'born', bornSlice: 'sweep-20260726020421', kev: false, epss: null, ...o,
});

// rollup.mjs's toolRuns table: artifact presence per repo + the checks-status rows.
const toolRuns = (o = {}) => ({
  'web-api-docs': {
    checks: [{ check: 'npm-audit', status: 'pass', at: SCAN_AT }, { check: 'deps-osv', status: 'skip', at: SCAN_AT }],
    artifacts: { osv: false, npm: true },
    ...o,
  },
});

// The exact shape of the live web-api-docs npm-audit.json (2026-07-26 batch), trimmed: ONE real
// advisory carrying cwe[], reached by every other package through via-string edges.
const AUDIT = {
  vulnerabilities: {
    'brace-expansion': {
      severity: 'high',
      via: [{
        source: 1124334, name: 'brace-expansion', dependency: 'brace-expansion',
        title: 'brace-expansion: DoS via unbounded expansion length',
        url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
        severity: 'high', cwe: ['CWE-400', 'CWE-770'],
        cvss: { score: 7.5 }, range: '<=5.0.7',
      }],
    },
    minimatch: { severity: 'high', via: ['brace-expansion'] },
    glob: { severity: 'high', via: ['minimatch'] },
    '@rollup/plugin-commonjs': { severity: 'high', via: ['glob'] },
    // a package that appears in the audit with no advisory anywhere in its chain
    'lonely-pkg': { severity: 'low', via: [] },
  },
};

// ─────────────────────────────── npmAuditCweIndex (pure) ───────────────────────────────

describe('npm audit -> CWE index', () => {
  test('an advisory object with cwe[] is indexed by advisory id AND by its package', () => {
    const idx = npmAuditCweIndex(AUDIT);
    assert.deepEqual(idx.byAdvisory['GHSA-mh99-v99m-4gvg'], ['CWE-400', 'CWE-770']);
    assert.deepEqual(idx.byPackage['brace-expansion'], { cwes: ['CWE-400', 'CWE-770'], source: 'advisory' });
  });

  test('the advisory key is derived exactly as rollup parseNpm derives the finding id (url tail)', () => {
    // if these two derivations ever diverge the index silently stops joining to any finding
    const idx = npmAuditCweIndex(AUDIT);
    const a = AUDIT.vulnerabilities['brace-expansion'].via[0];
    const idAsRollupBuildsIt = (a.url || '').split('/').pop() || String(a.source);
    assert.ok(idx.byAdvisory[idAsRollupBuildsIt], `no index entry for '${idAsRollupBuildsIt}'`);
  });

  test('via-string edges carry the class down the chain, marked advisory-transitive', () => {
    const idx = npmAuditCweIndex(AUDIT);
    for (const pkg of ['minimatch', 'glob', '@rollup/plugin-commonjs']) {
      assert.deepEqual(idx.byPackage[pkg], { cwes: ['CWE-400', 'CWE-770'], source: 'advisory-transitive' }, pkg);
    }
  });

  test('a package with no advisory in its chain is ABSENT from the index (never an empty guess)', () => {
    const idx = npmAuditCweIndex(AUDIT);
    assert.equal(idx.byPackage['lonely-pkg'], undefined);
  });

  test('an audit with no cwe anywhere yields an empty index, not a fabricated one', () => {
    const idx = npmAuditCweIndex({ vulnerabilities: { a: { via: [{ url: 'https://x/GHSA-aaaa-bbbb-cccc' }] }, b: { via: ['a'] } } });
    assert.deepEqual(Object.keys(idx.byAdvisory), []);
    assert.deepEqual(Object.keys(idx.byPackage), []);
  });

  test('the index maps are null-prototype (a package named __proto__ cannot poison the lookup)', () => {
    const idx = npmAuditCweIndex({ vulnerabilities: { __proto__: { via: [{ url: 'https://x/GHSA-1111-2222-3333', cwe: ['CWE-79'] }] } } });
    assert.equal(Object.getPrototypeOf(idx.byPackage), null);
    assert.equal(Object.getPrototypeOf(idx.byAdvisory), null);
  });

  test('a cyclic via graph terminates instead of hanging', () => {
    const cyc = { vulnerabilities: {
      a: { via: ['b', { url: 'https://x/GHSA-1111-2222-3333', cwe: ['CWE-79'] }] },
      b: { via: ['a'] },
    } };
    const idx = npmAuditCweIndex(cyc);
    assert.deepEqual(idx.byPackage.a, { cwes: ['CWE-79'], source: 'advisory' });
    assert.deepEqual(idx.byPackage.b, { cwes: ['CWE-79'], source: 'advisory-transitive' });
  });

  test('malformed cwe entries are dropped, not passed through', () => {
    const idx = npmAuditCweIndex({ vulnerabilities: { p: { via: [{ url: 'https://x/GHSA-1111-2222-3333', cwe: ['CWE-79', 'not-a-cwe', '', null, 'CWE-79'] }] } } });
    assert.deepEqual(idx.byPackage.p.cwes, ['CWE-79']);
  });

  test('garbage input yields empty maps rather than throwing', () => {
    for (const bad of [null, undefined, {}, { vulnerabilities: null }, 'nope']) {
      const idx = npmAuditCweIndex(bad);
      assert.deepEqual(Object.keys(idx.byPackage), []);
      assert.deepEqual(Object.keys(idx.byAdvisory), []);
    }
  });
});

// ─────────────────────────── weaknessClass through assembleLifecycle ───────────────────────────

const advisoryIndexFor = (repo, doc) => {
  const idx = npmAuditCweIndex(doc);
  const byRepoPackage = {};
  for (const [pkg, e] of Object.entries(idx.byPackage)) byRepoPackage[`${repo}|${pkg}`] = e;
  return { byAdvisory: idx.byAdvisory, byRepoPackage };
};

describe('weaknessClass is advisory-backed or empty — never guessed', () => {
  const advisoryCwe = advisoryIndexFor('web-api-docs', AUDIT);
  const run = (recs, ctx = {}) => assembleLifecycle(recs, { advisoryCwe, toolRuns: toolRuns(), nowIso: NOW, ...ctx });

  test('a finding whose id IS the advisory gets the advisory class', () => {
    const r = rec({ id: 'GHSA-mh99-v99m-4gvg', package: 'brace-expansion' });
    run([r]);
    assert.deepEqual(r.weaknessClass, ['CWE-400', 'CWE-770']);
    assert.equal(r.weaknessClassSource, 'advisory');
  });

  test('cweIds — the preferred branch that no producer used to write — is now populated', () => {
    const r = rec({ id: 'GHSA-mh99-v99m-4gvg', package: 'brace-expansion' });
    run([r]);
    assert.deepEqual(r.cweIds, ['CWE-400', 'CWE-770'], 'cweIds must be written, not just weaknessClass');
  });

  test('a transitively-vulnerable package gets the class, labelled advisory-transitive', () => {
    const r = rec({ id: '@rollup/plugin-commonjs', package: '@rollup/plugin-commonjs' });
    run([r]);
    assert.deepEqual(r.weaknessClass, ['CWE-400', 'CWE-770']);
    assert.equal(r.weaknessClassSource, 'advisory-transitive');
  });

  test('NO advisory CWE => weaknessClass stays [] and the source is explicitly null', () => {
    const r = rec({ repo: 'internal-d', tool: 'osv', id: 'CVE-2026-44575', package: 'openssl', path: 'Cargo.lock' });
    assembleLifecycle([r], { advisoryCwe, toolRuns: toolRuns(), nowIso: NOW });
    assert.deepEqual(r.weaknessClass, [], 'no advisory data must mean no class, not a plausible one');
    assert.equal(r.weaknessClassSource, null);
    assert.ok(!r.cweIds || !r.cweIds.length);
  });

  test('a package NAMED after a weakness is not classified by its name', () => {
    // a dependency finding puts a package name in the ruleId slot — `xss` must not earn CWE-79 on spelling
    for (const name of ['xss', 'multi-tenant', 'dotenv-secrets']) {
      const r = rec({ id: name, package: name });
      assembleLifecycle([r], { advisoryCwe: null, toolRuns: toolRuns(), nowIso: NOW });
      assert.deepEqual(r.weaknessClass, [], `package '${name}' must not be classified by its name`);
      assert.equal(r.weaknessClassSource, null);
    }
  });

  test('a real SAST ruleId still resolves through the ruleId->CWE table', () => {
    const r = rec({ tool: 'semgrep', id: 'java/sql-injection', package: '', path: 'src/Dao.java' });
    assembleLifecycle([r], { ruleCweTable: { 'java/sql-injection': ['CWE-89'] }, toolRuns: toolRuns(), nowIso: NOW });
    assert.deepEqual(r.weaknessClass, ['CWE-89']);
    assert.equal(r.weaknessClassSource, 'rule-map');
  });

  test('a class already on the finding wins over everything and keeps its provenance', () => {
    const r = rec({ id: 'GHSA-mh99-v99m-4gvg', cweIds: ['CWE-1321'] });
    run([r]);
    assert.deepEqual(r.weaknessClass, ['CWE-1321']);
    assert.equal(r.weaknessClassSource, 'advisory');
  });

  test('the minted CWX entry records the same class as the record (no file-to-file drift)', () => {
    const r = rec({ id: '@rollup/plugin-commonjs', package: '@rollup/plugin-commonjs' });
    const out = run([r]);
    assert.deepEqual(out.cwxState.entries[r.cwxRef].weaknessClass, ['CWE-400', 'CWE-770']);
  });
});

describe('weaknessClassForRule heuristic gate', () => {
  test('allowHeuristic:false kills the shape match but keeps exact table hits', () => {
    assert.deepEqual(weaknessClassForRule('xss', {}, { allowHeuristic: false }), []);
    assert.deepEqual(weaknessClassForRule('xss', {}), ['CWE-79'], 'default behaviour is unchanged');
    assert.deepEqual(weaknessClassForRule('java/sql-injection', { 'java/sql-injection': ['CWE-89'] }, { allowHeuristic: false }), ['CWE-89']);
  });
});

describe('CWX registry weaknessClass backfill', () => {
  test('an entry minted with no class takes one later; a real class is never overwritten', () => {
    const reg = createRegistry(null);
    const id = reg.mint('k1', NOW, []);
    assert.deepEqual(reg.state.entries[id].weaknessClass, []);
    assert.equal(reg.mint('k1', NOW, ['CWE-400']), id, 'the id must not change');
    assert.deepEqual(reg.state.entries[id].weaknessClass, ['CWE-400']);
    reg.mint('k1', NOW, ['CWE-79']);
    assert.deepEqual(reg.state.entries[id].weaknessClass, ['CWE-400'], 'existing class is not clobbered');
  });
});

// ───────────────────────────────── scanProvenance (F.5.3) ─────────────────────────────────

describe('scanProvenance is emitted from real tool-run evidence', () => {
  test('artifact present => ran:true, the producing scanner, and the checks-status timestamp', () => {
    assert.deepEqual(scanProvenanceFor('web-api-docs', 'npm', toolRuns()), { ran: true, scanner: 'npm', at: SCAN_AT });
  });

  test('artifact absent => ran:false (a genuine did-not-run, from the artifacts table)', () => {
    const p = scanProvenanceFor('web-api-docs', 'osv', toolRuns());
    assert.equal(p.ran, false);
    assert.equal(p.scanner, 'osv');
  });

  test('UNKNOWN is not false: an unmapped tool or repo yields null, never ran:false', () => {
    // an unmapped tool/repo must not force real findings to unknown-not-scanned
    assert.equal(scanProvenanceFor('web-api-docs', 'trivy', toolRuns()), null);
    assert.equal(scanProvenanceFor('no-such-repo', 'npm', toolRuns()), null);
    assert.equal(scanProvenanceFor('web-api-docs', 'npm', null), null);
  });

  test('a non-ISO checks timestamp is dropped rather than emitted', () => {
    const tr = toolRuns({ checks: [{ check: 'npm-audit', status: 'pass', at: 'whenever' }] });
    assert.deepEqual(scanProvenanceFor('web-api-docs', 'npm', tr), { ran: true, scanner: 'npm' });
  });

  test('the tool->check mapping covers exactly the two scanners rollup parses', () => {
    assert.deepEqual(Object.keys(SCAN_CHECK_FOR_TOOL).sort(), ['npm', 'osv']);
  });

  test('assembleLifecycle stamps every record it can, and ran:false floors the status', () => {
    const ok = rec({ id: 'GHSA-mh99-v99m-4gvg' });
    assembleLifecycle([ok], { toolRuns: toolRuns(), nowIso: NOW });
    assert.deepEqual(ok.scanProvenance, { ran: true, scanner: 'npm', at: SCAN_AT });
    assert.equal(ok.lifecycleStatus, 'born');

    const notScanned = rec({ tool: 'osv', id: 'CVE-2026-1' });
    assembleLifecycle([notScanned], { toolRuns: toolRuns(), nowIso: NOW });
    assert.equal(notScanned.scanProvenance.ran, false);
    assert.equal(notScanned.lifecycleStatus, 'unknown-not-scanned', 'ran:false must never read as clean');
  });

  test('with no toolRuns the field is left ABSENT — and the assembler reports it as a violation', () => {
    const r = rec({ id: 'GHSA-mh99-v99m-4gvg' });
    const out = assembleLifecycle([r], { nowIso: NOW });
    assert.equal(r.scanProvenance, undefined, 'provenance we do not have must not be invented');
    assert.ok(out.schemaViolations.some((m) => /missing required 'scanProvenance'/.test(m)),
      `expected the assembler to report it; got ${JSON.stringify(out.schemaViolations)}`);
  });
});

// ─────────────────────── the schema now has a consumer (F.5.3 enforcement) ───────────────────────

const conforming = () => {
  const r = rec({ id: 'GHSA-mh99-v99m-4gvg' });
  assembleLifecycle([r], { advisoryCwe: advisoryIndexFor('web-api-docs', AUDIT), toolRuns: toolRuns(), nowIso: NOW });
  return r;
};

describe('lifecycle-record schema is enforced', () => {
  test('an assembled record conforms', () => {
    assert.deepEqual(validateLifecycleRecords([conforming()]), []);
  });

  test('a record missing the required scanProvenance FAILS', () => {
    const r = conforming();
    delete r.scanProvenance;
    const v = validateLifecycleRecords([r]);
    assert.ok(v.some((m) => /missing required 'scanProvenance'/.test(m)), JSON.stringify(v));
  });

  test('every other field in the schema required list is enforced too', () => {
    for (const field of lifecycleSchema().required) {
      const r = conforming();
      delete r[field];
      const v = validateLifecycleRecords([r]);
      assert.ok(v.some((m) => m.includes(`missing required '${field}'`)), `${field} not enforced: ${JSON.stringify(v)}`);
    }
  });

  test('scanProvenance stays in the schema required list (it is emitted now, not aspirational)', () => {
    assert.ok(lifecycleSchema().required.includes('scanProvenance'));
  });

  test('the never-imply-clean invariant is checked: ran:false with any other status FAILS', () => {
    const r = conforming();
    r.scanProvenance = { ran: false, scanner: 'npm' };
    r.lifecycleStatus = 'born';
    const v = validateLifecycleRecords([r]);
    assert.ok(v.some((m) => /never imply clean/.test(m)), JSON.stringify(v));
  });

  test('a malformed CWE id FAILS (a fabricated class is not a typo)', () => {
    const r = conforming();
    r.weaknessClass = ['CWE-400', 'resource exhaustion'];
    assert.ok(validateLifecycleRecords([r]).some((m) => /not a CWE id/.test(m)));
  });

  test('a class with no stated provenance FAILS', () => {
    const r = conforming();
    r.weaknessClassSource = null;
    assert.ok(validateLifecycleRecords([r]).some((m) => /no stated provenance/.test(m)));
  });

  test('out-of-vocabulary values FAIL', () => {
    const bad = (mut, re) => {
      const r = conforming(); mut(r);
      assert.ok(validateLifecycleRecords([r]).some((m) => re.test(m)), `${re} not raised`);
    };
    bad((r) => { r.severity = 'severe'; }, /severity 'severe' not in enum/);
    bad((r) => { r.residualVerdict = 'probably-fine'; }, /residualVerdict/);
    bad((r) => { r.bugVisibleTo = 'everyone'; }, /bugVisibleTo/);
    bad((r) => { r.weaknessClassSource = 'vibes'; }, /weaknessClassSource/);
    bad((r) => { r.cwxRef = 'CWX-abc'; }, /cwxRef .* malformed/);
  });

  test("severity 'unknown' is accepted — the producer emits it and it is not 'low'", () => {
    const r = conforming();
    r.severity = 'unknown';
    assert.deepEqual(validateLifecycleRecords([r]), []);
  });

  test('the checker reads its vocabulary out of the schema file, so the two cannot drift', () => {
    const raw = JSON.parse(readFileSync(join(HERE, '..', 'schema', 'lifecycle-record.schema.json'), 'utf8'));
    assert.deepEqual(lifecycleSchema().required, raw.required);
    assert.deepEqual(lifecycleSchema().properties.severity.enum, raw.properties.severity.enum);
  });
});

// ─────────────────────── SLA tier for an UNSCORED finding (severity: 'unknown') ───────────────────
// the fallback was `?? 180` — the laxest deadline, granted precisely because nobody could score it
describe('SLA tier: an unscored severity is not a lenient one', () => {
  // only the SLA fallback is exercised — the CWE index is irrelevant, pass null
  const slaOf = (severity, knowableExposureDays) => {
    const [r] = assembleLifecycle(
      [rec({ severity, dwell: { knowableExposureDays } })],
      { advisoryCwe: null, toolRuns: toolRuns(), nowIso: NOW },
    ).records;
    return r.escalation;
  };

  test("'unknown' takes the MEDIAN tier, not the 180-day low tier", () => {
    assert.equal(slaOf('unknown', 0).slaTier, 90, 'an unscored finding must not inherit the laxest deadline');
    assert.notEqual(slaOf('unknown', 0).slaTier, 180);
  });

  test('a scored severity is unaffected — this changes the unscored case only', () => {
    assert.equal(slaOf('crit', 0).slaTier, 7);
    assert.equal(slaOf('high', 0).slaTier, 30);
    assert.equal(slaOf('med', 0).slaTier, 90);
    assert.equal(slaOf('low', 0).slaTier, 180);
  });

  test('slaTierBasis says WHY the tier was chosen, so unscored is legible', () => {
    assert.equal(slaOf('high', 0).slaTierBasis, 'severity');
    assert.match(slaOf('unknown', 0).slaTierBasis, /unscored \(unknown\)/);
    assert.match(slaOf('unknown', 0).slaTierBasis, /not lenient/);
    // a scored 'med' and an unscored default share a tier of 90 — the basis is what tells them apart
    assert.equal(slaOf('med', 0).slaTier, slaOf('unknown', 0).slaTier);
    assert.notEqual(slaOf('med', 0).slaTierBasis, slaOf('unknown', 0).slaTierBasis);
  });

  test('an unscored finding now breaches between 90 and 180 days, where it previously did not', () => {
    // dwell is derived, not injected — drive it through bugInitialReport
    const daysBefore = (n) => new Date(Date.parse(NOW) - n * 864e5).toISOString();
    const breachOf = (severity, days) => assembleLifecycle(
      [rec({ severity, bugInitialReport: daysBefore(days) })],
      { advisoryCwe: null, toolRuns: toolRuns(), nowIso: NOW },
    ).records[0].escalation.slaBreached;

    assert.equal(breachOf('unknown', 120), true, '120 days exceeds the 90-day median tier');
    assert.equal(breachOf('unknown', 60), false, '60 days does not');
    assert.equal(breachOf('low', 120), false, 'a genuinely LOW finding still has its 180 days');
    assert.equal(breachOf('crit', 10), true, 'and a critical still breaches at 7');
  });
});
