// monitor/rollup.mjs — counting Socket supply-chain alerts. The REAL shape is measured from a live
// `socket scan create --json --report`: three levels, ecosystem → package → version (data.alerts is
// an OBJECT). Severity IS asserted from 2026-08-26 (D15): it comes from the alert TYPE, because
// `policy` is "warn" on every alert Socket has ever sent this fleet and graded none of them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { _socketAlertCount, _socketAlertRows, _socketCounts, _socketTypes, sumTotals, regradeSocket }
  from '../extractors.mjs';
import { join } from 'node:path';

// imported, not lifted — the old eval-a-slice harness tested a reconstruction that could drift
const count = _socketAlertCount;

// exactly what the CLI returned for a fleet repo at --report-level warn
const REAL = {
  ok: true,
  data: {
    healthy: true,
    alerts: {
      npm: {
        vitest: { '4.0.18': { type: 'criticalCVE', policy: 'warn', url: 'https://socket.dev/…' } },
        minimatch: { '9.0.6': { type: 'obfuscatedFile', policy: 'warn', url: 'https://socket.dev/…' } },
      },
    },
  },
};

describe('socket alert counting', () => {
  test('the MEASURED shape is counted — this is the case that read as zero', () => {
    assert.equal(count(REAL), 2, 'ecosystem -> package -> version, one alert per (package, version)');
  });

  test('multiple ecosystems and multiple versions of one package all count', () => {
    assert.equal(count({ data: { alerts: {
      npm: { lodash: { '4.17.20': { type: 'cve' }, '4.17.21': { type: 'cve' } } },
      pypi: { requests: { '2.0.0': { type: 'obfuscatedFile' } } },
    } } }), 3);
  });

  test('a genuinely clean scan is zero — the fix must not invent findings', () => {
    assert.equal(count({ ok: true, data: { healthy: true, alerts: {} } }), 0);
  });

  test('SCAN METADATA counts zero, which is correct but is NOT evidence of a clean repo', () => {
    // counting metadata as 0 is right — the defect was the check asking for this artifact at all
    assert.equal(count({ ok: true, data: { id: '2bc7dce8', organization_id: '369226', branch: 'main' } }), 0);
  });

  test('a legacy array artifact still counts — an old report must not start reading as zero', () => {
    assert.equal(count({ alerts: [{ x: 1 }, { x: 2 }, { x: 3 }] }), 3);
    assert.equal(count({ issues: [{ x: 1 }] }), 1);
    assert.equal(count({ results: { issues: [{ x: 1 }, { x: 2 }] } }), 2);
  });

  test('malformed input is zero, never a crash — a bad artifact must not kill the rollup', () => {
    for (const bad of [null, undefined, 'string', 42, [], { data: null }, { data: { alerts: 'nope' } },
      { data: { alerts: { npm: null } } }, { data: { alerts: { npm: { pkg: 'not-an-object' } } } }]) {
      assert.equal(count(bad), 0, `${JSON.stringify(bad)} must count zero without throwing`);
    }
  });
});

// ── THE HEADLINE SUM ────────────────────────────────────────────────────────────────────────────
// `totals` was dependency CVEs alone — scanner findings summed nowhere, so 88 leaked secrets read clean
const CVE = { repos: 1, crit: 1, high: 2, med: 3, low: 4, kev: 1, cves: 10 };
const sev = (crit, high, med, low) => ({ crit, high, med, low });

// _socketAlertRows once named the three levels off by one — the transposition preserved
// cardinality exactly, so only content assertions catch it
describe('socket alert ROWS carry the fields the panel and the suppression matcher name', () => {
  const rows = _socketAlertRows(REAL);

  test('rule is the ALERT TYPE — the field the whole real-gap/noise split depends on', () => {
    assert.deepEqual(rows.map((r) => r.rule).sort(), ['criticalCVE', 'obfuscatedFile']);
  });

  test('package is the PACKAGE, version is the VERSION, ecosystem is the ecosystem', () => {
    const vitest = rows.find((r) => r.package === 'vitest');
    assert.ok(vitest, 'the package name must be in `package` — it was in `version`');
    assert.equal(vitest.version, '4.0.18');
    assert.equal(vitest.ecosystem, 'npm', 'the ecosystem gets its own field — it was occupying `package`');
    assert.equal(vitest.rule, 'criticalCVE');
  });

  test('no field carries an ecosystem name where a package belongs', () => {
    for (const r of rows) {
      assert.notEqual(r.package, 'npm', 'an ecosystem in `package` is the transposition returning');
      assert.ok(!/^\d+\.\d+/.test(r.rule), `rule must not be a version string, got ${r.rule}`);
    }
  });

  test('the identity fields ROW_SCHEMAS.supplyChain keys on are distinct per finding', () => {
    // transposed, both alerts collapse to one identity — a fleet annotation would silence every npm alert at that version
    const ids = new Set(rows.map((r) => `${r.rule}|${r.package}`));
    assert.equal(ids.size, rows.length, 'two distinct alerts must not share a suppression identity');
  });

  test('rows and count agree on the real shape AND on the malformed ones', () => {
    assert.equal(rows.length, _socketAlertCount(REAL));
    for (const bad of [null, undefined, 'string', 42, [], { data: null }, { data: { alerts: 'nope' } },
      { data: { alerts: { npm: null } } }, { data: { alerts: { npm: { pkg: 'not-an-object' } } } }]) {
      assert.equal(_socketAlertRows(bad).length, _socketAlertCount(bad), `${JSON.stringify(bad)}`);
    }
  });
});

describe('the headline sums every security scanner, not just the CVE feed', () => {
  test('scanner findings are ADDED to the CVE feed', () => {
    const t = sumTotals(CVE, { secrets: sev(0, 88, 0, 0), sastCodeql: sev(1, 10, 5, 0) },
      ['maliciousPackages', 'stubs']);
    assert.equal(t.crit, 2, '1 CVE crit + 1 codeql crit');
    assert.equal(t.high, 100, '2 + 88 + 10');
    assert.equal(t.med, 8);
    assert.equal(t.low, 4);
  });

  test('the CVE-only numbers survive under cveTotals — nothing loses access to them', () => {
    const t = sumTotals(CVE, { secrets: sev(0, 88, 0, 0) }, ['maliciousPackages', 'stubs']);
    assert.deepEqual(t.cveTotals, CVE, 'the previous meaning of totals is preserved verbatim');
    assert.equal(t.cves, 10, '`cves` names the CVE feed and must NOT grow');
    assert.equal(t.kev, 1, '`kev` is a CISA-KEV fact about CVEs, not a count of everything');
  });

  test('maliciousPackages is EXCLUDED — it is parsed from the same osv.sarif as the CVE feed', () => {
    // _malCounts reads the same osv.sarif as the CVE feed — adding it would double-count
    const t = sumTotals(CVE, { maliciousPackages: sev(9, 9, 9, 9) }, ['maliciousPackages', 'stubs']);
    assert.equal(t.crit, CVE.crit, 'a double-counted category must contribute nothing');
    assert.equal(t.high, CVE.high);
  });

  test('stubs is EXCLUDED — TODO markers are hygiene, and would swamp the number', () => {
    // ~4019 fleet-wide, every one labelled `high` by _countArray's convention
    const t = sumTotals(CVE, { stubs: sev(0, 4019, 0, 0) }, ['maliciousPackages', 'stubs']);
    assert.equal(t.high, CVE.high, 'a TODO is not a vulnerability');
  });

  test('exclusions are RECORDED in the output — a silent cap is not a cap anyone can audit', () => {
    const t = sumTotals(CVE, {}, ['maliciousPackages', 'stubs']);
    assert.deepEqual(t.excludedFromTotals, ['maliciousPackages', 'stubs']);
  });

  test('missing/partial scanner entries do not corrupt the arithmetic', () => {
    const t = sumTotals(CVE, { a: null, b: undefined, c: {}, d: { high: 5 }, e: { high: 'x' } }, []);
    assert.equal(t.high, CVE.high + 5, 'absent keys count 0; a non-numeric count must not become NaN');
    assert.equal(Number.isFinite(t.crit), true);
  });
});

// ── D15: the type is the grade ───────────────────────────────────────────────────────────────────
// `total: n, high: n` asserted ~38,000 HIGHs on a field that is "warn" on every alert. These fix
// the number in place: nothing is dropped, everything moves to the kind where it is true.
const SEVS = ['crit', 'high', 'med', 'low', 'undetermined'];
const socketDir = (alerts) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-socket-'));
  writeFileSync(join(d, 'socket.json'), JSON.stringify({ ok: true, data: { alerts } }));
  return d;
};
const oneOf = (type) => ({ npm: { pkg: { '1.0.0': { type, policy: 'warn' } } } });

describe('D15 — severity comes from the type, and says why when it cannot', () => {
  test('the regression: a warn-policy alert is no longer a HIGH', () => {
    const c = _socketCounts(socketDir(oneOf('licenseSpdxDisj')), 'socket.json');
    assert.equal(c.total, 1);
    assert.equal(c.high, 0, 'policy:"warn" is a constant, not a severity');
    assert.equal(c.undetermined, 1);
  });

  test('a licence disjunction is POLICY, kept and counted — not erased', () => {
    const c = _socketCounts(socketDir(oneOf('licenseSpdxDisj')), 'socket.json');
    assert.equal(c.byKind.policy.undetermined, 1);
    assert.equal(c.byKind.vulnerability, undefined, 'licence severity must not enter the vuln kind');
    assert.equal(c.findings[0].sevReason, 'no-licence-policy-configured',
      'an undetermined row with no reason is the blank this lane was cured of');
  });

  test('gitHubDependency grades LOW — the lane is not uniformly grey', () => {
    const c = _socketCounts(socketDir(oneOf('gitHubDependency')), 'socket.json');
    assert.equal(c.low, 1);
    assert.equal(c.byKind.integrity.low, 1);
    assert.equal(c.findings[0].sevReason, '', 'a graded row must not also carry an excuse');
  });

  test('gptMalware stays SUMMED as undetermined so a real one can still alarm', () => {
    const c = _socketCounts(socketDir(oneOf('gptMalware')), 'socket.json');
    assert.equal(c.undetermined, 1, 'a lane contributing 0 to every bucket can never raise an alarm');
    assert.equal(c.crit + c.high, 0, 'six numpy@2.5.1 rows are not six criticals');
    assert.equal(c.findings[0].sevReason, 'single-source-llm-unverified');
  });

  test('an unknown type is undetermined, keeps its name, and says the vocabulary grew', () => {
    const c = _socketCounts(socketDir(oneOf('somethingSocketAddedTonight')), 'socket.json');
    assert.equal(c.undetermined, 1);
    assert.equal(c.byKind.unclassified.undetermined, 1);
    assert.equal(c.findings[0].rule, 'somethingSocketAddedTonight', 'the claim must survive ungraded');
    assert.equal(c.findings[0].sevReason, 'type-not-in-vocabulary');
  });

  test('every alert lands in exactly one bucket, and byKind partitions the same total', () => {
    const d = socketDir({ npm: {
      a: { '1': { type: 'licenseSpdxDisj' }, '2': { type: 'obfuscatedFile' } },
      b: { '1': { type: 'criticalCVE' }, '2': { type: 'gitHubDependency' } },
      c: { '1': { type: 'gptMalware' }, '2': { type: 'brandNew' } },
    } });
    const c = _socketCounts(d, 'socket.json');
    assert.equal(c.total, 6);
    assert.equal(SEVS.reduce((n, s) => n + c[s], 0), 6, 'a bucket split that does not sum to total');
    const kinds = Object.values(c.byKind).reduce((n, b) => n + SEVS.reduce((m, s) => m + b[s], 0), 0);
    assert.equal(kinds, 6, 'byKind lost or duplicated a row');
    assert.equal(c.findings.length, 6, 'rows and tally disagree about what an alert is');
  });

  test('the tally reads the SAME rows it publishes — they cannot drift', () => {
    // `total` still comes from the counter; the buckets come from the rows. If those two ever
    // disagree the split is over a different population than the headline it splits.
    const alerts = oneOf('criticalCVE');
    const c = _socketCounts(socketDir(alerts), 'socket.json');
    assert.equal(c.total, _socketAlertCount({ ok: true, data: { alerts } }));
    assert.equal(c.total, c.findings.length);
  });

  test('non-vacuity: the vocabulary is real and every entry is well-formed', () => {
    const kinds = new Set(['policy', 'integrity', 'vulnerability']);
    assert.ok(Object.keys(_socketTypes).length >= 5, 'the type table is empty — the subject is absent');
    for (const [t, d] of Object.entries(_socketTypes)) {
      assert.ok(kinds.has(d.kind), `${t}: kind ${JSON.stringify(d.kind)}`);
      assert.ok(d.sev ? !d.why : !!d.why, `${t}: graded rows carry no reason, ungraded rows must`);
    }
    // At least one type grades, or "severity from type" is a promise the table does not keep.
    assert.ok(Object.values(_socketTypes).some((d) => d.sev), 'no type grades anything');
  });
});

// ── D15 close-out: criticalCVE grades once dedup can answer ──────────────────────────────────────
// The type table withheld a severity with reason `pending-dedup-against-cve-lanes` — the honest
// holding position, because 4 of 8 sampled were already counted by a CVE lane and 59 extra crits
// on top of them is over-reporting. This is the answer to it, and it must cut BOTH ways: a
// duplicate must not be published, and a sole witness must not be buried.
const adv = (pkg, over = {}) => ({ tool: 'osv', id: 'CVE-2026-1', package: pkg, severity: 'high', ...over });
const cveAlert = (pkg, ver = '1.0.0') => ({ npm: { [pkg]: { [ver]: { type: 'criticalCVE', policy: 'warn' } } } });

describe('D15 — a criticalCVE grades when nothing else saw it, and defers when something did', () => {
  test('a package a CVE lane ALSO reports stays undetermined and names the witness', () => {
    const lane = _socketCounts(socketDir(cveAlert('form-data', '2.3.3')), 'socket.json');
    assert.equal(lane.undetermined, 1, 'ungraded before the regrade — the holding position');
    const out = regradeSocket(lane, [adv('form-data')], { repo: 'r' });
    assert.equal(out.crit, 0, 'publishing it too would report one dependency twice');
    assert.equal(out.undetermined, 1);
    assert.equal(out.findings[0].sevReason, 'corroborated-by-osv');
    assert.equal(out.findings[0].corroborationBasis, 'place',
      'the join is by package, not by advisory — a weaker claim, and it must say so');
  });

  test('a package NOBODY else reports grades crit — the mirror defect is burying a real one', () => {
    const lane = _socketCounts(socketDir(cveAlert('lonely-pkg')), 'socket.json');
    const out = regradeSocket(lane, [adv('something-else')], { repo: 'r' });
    assert.equal(out.crit, 1);
    assert.equal(out.undetermined, 0);
    assert.equal(out.findings[0].sev, 'crit');
    assert.equal(out.findings[0].sevReason, '', 'a graded row carries no excuse');
    assert.equal(out.byKind.vulnerability.crit, 1, 'and it lands in the vulnerability kind');
  });

  test('no advisory rows at all is SOLE WITNESS, not "unknown" — a repo with no CVE lane output', () => {
    const out = regradeSocket(_socketCounts(socketDir(cveAlert('p')), 'socket.json'), [], { repo: 'r' });
    assert.equal(out.crit, 1);
  });

  test('the regrade touches only criticalCVE — the other four types are unchanged', () => {
    const before = _socketCounts(socketDir(oneOf('licenseSpdxDisj')), 'socket.json');
    const after = regradeSocket(before, [adv('pkg')], { repo: 'r' });
    assert.equal(after.undetermined, 1);
    assert.equal(after.findings[0].sevReason, 'no-licence-policy-configured');
    assert.equal(after.findings[0].corroboratedBy, undefined, 'a licence row is not a CVE claim');
  });

  test('conservation survives the regrade — the split still sums to total', () => {
    const d = socketDir({ npm: {
      a: { '1': { type: 'criticalCVE' } }, b: { '1': { type: 'criticalCVE' } },
      c: { '1': { type: 'licenseSpdxDisj' } }, e: { '1': { type: 'gitHubDependency' } },
    } });
    const out = regradeSocket(_socketCounts(d, 'socket.json'), [adv('a')], { repo: 'r' });
    assert.equal(out.total, 4);
    assert.equal(SEVS.reduce((n, s) => n + out[s], 0), 4, 'a bucket split that does not sum to total');
    const kinds = Object.values(out.byKind).reduce((n, b) => n + SEVS.reduce((m, s) => m + b[s], 0), 0);
    assert.equal(kinds, 4, 'byKind lost or duplicated a row after the regrade');
    assert.equal(out.crit, 1, 'b is the sole witness; a is corroborated');
    assert.equal(out.byKind.vulnerability.undetermined, 1, 'the corroborated one stays visible as undetermined');
  });

  test('a lane with nothing to regrade is returned untouched, not rebuilt', () => {
    const lane = _socketCounts(socketDir(oneOf('obfuscatedFile')), 'socket.json');
    assert.equal(regradeSocket(lane, [adv('x')], { repo: 'r' }), lane, 'no criticalCVE ⇒ same object');
    assert.equal(regradeSocket(null, [], {}), null);
  });
});
