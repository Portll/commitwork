// node --test monitor/test/defect-signature.test.mjs — a detector positive on ~100% of the repos it
// scanned is a defect signature in the detector, not a fleet in crisis. The rate is a FIELD in its
// own artifact; it changes no severity and is never multiplied into anything.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { defectSignatures, detectorRates, thresholds, DEFAULT_RATE, DEFAULT_MIN_REPOS } from '../defect-signature.mjs';

afterEach(() => { delete process.env.CW_DEFECT_SIGNATURE_RATE; delete process.env.CW_DEFECT_SIGNATURE_MIN_REPOS; });

// n repos, every one scanned by secretsHistory; `firing` of them carry a Lob row; one carries AWS.
function fixture(n, firing = n) {
  const repos = [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const name = `team-a-repo-${String(i).padStart(2, '0')}`;
    repos.push({ name, scanners: { secretsHistory: { ran: true, total: i < firing ? 1 : 0 } } });
    if (i < firing) rows.push({ repo: name, detector: 'Lob', file: `src/${i}.js`, line: 1, sev: 'crit' });
  }
  rows.push({ repo: repos[0].name, detector: 'AWS', file: 'src/0.js', line: 2, sev: 'crit' });
  return { repos, scannerFindings: { secretsHistory: rows } };
}

test('one detector at 100% across 25 repos is a signature; its sibling at 4% is not', () => {
  const art = defectSignatures(fixture(25), {}, { at: '2026-10-11T00:00:00.000Z' });
  assert.deepEqual(art.thresholds, { rate: DEFAULT_RATE, minRepos: DEFAULT_MIN_REPOS });
  assert.deepEqual(art.signatures, [{ detector: 'secretsHistory/Lob', lane: 'secretsHistory', rate: 1, population: 25, positives: 25, signature: true }]);
  const aws = art.detectors.find((d) => d.detector === 'secretsHistory/AWS');
  assert.equal(aws.signature, false);
  assert.equal(aws.rate, 0.04);
  assert.equal(art.population.secretsHistory, 25);
});

test('the same 100% over 10 repos is NOT a signature — the population floor', () => {
  const art = defectSignatures(fixture(10));
  assert.deepEqual(art.signatures, []);
  const lob = art.detectors.find((d) => d.detector === 'secretsHistory/Lob');
  assert.equal(lob.rate, 1, 'the rate is still published; it is just not judged');
  assert.equal(lob.population, 10);
});

test('a rate of 0.5 over 40 repos is not a signature', () => {
  const art = defectSignatures(fixture(40, 20));
  assert.deepEqual(art.signatures, []);
  assert.equal(art.detectors.find((d) => d.detector === 'secretsHistory/Lob').rate, 0.5);
});

test('the thresholds come from the environment at CALL time — set after import', () => {
  assert.deepEqual(defectSignatures(fixture(10)).signatures, []);
  process.env.CW_DEFECT_SIGNATURE_MIN_REPOS = '10';
  assert.equal(defectSignatures(fixture(10)).signatures.length, 1, 'the floor moved');
  process.env.CW_DEFECT_SIGNATURE_RATE = '0.4';
  assert.equal(defectSignatures(fixture(40, 20)).signatures.length, 1, 'the rate moved');
  assert.deepEqual(thresholds(), { rate: 0.4, minRepos: 10 });
  process.env.CW_DEFECT_SIGNATURE_RATE = 'most';
  assert.throws(() => defectSignatures(fixture(25)), RangeError, 'an unusable threshold is an error, not a default');
  process.env.CW_DEFECT_SIGNATURE_RATE = '1.5';
  assert.throws(() => thresholds(), RangeError);
});

test('positives count REPOS, not rows; population counts repos the lane scanned, not repos with rows', () => {
  const fx = fixture(25, 25);
  fx.scannerFindings.secretsHistory.push({ repo: 'team-a-repo-00', detector: 'Lob', file: 'x', line: 9, sev: 'crit' });
  fx.repos.push({ name: 'unscanned', scanners: {} });
  fx.repos.push({ name: 'scanned-clean', scanners: { secretsHistory: { ran: true, total: 0 } } });
  const lob = detectorRates(fx).detectors.find((d) => d.detector === 'secretsHistory/Lob');
  assert.equal(lob.positives, 25, 'two rows in one repo are one positive');
  assert.equal(lob.population, 26, 'the clean repo is in the denominator; the unscanned one is not');
});

test('the detector id is the lane identity tuple\'s first field; a row without one is counted unkeyed, never invented', () => {
  const r = detectorRates({
    repos: [{ name: 'a', scanners: { cspm: {}, sastSemgrep: {}, depsJvm: {} } }],
    scannerFindings: {
      cspm: [{ repo: 'a', control: 'security_and_analysis', resource: 'repo', sev: 'high' }],
      sastSemgrep: [{ repo: 'a', rule: 'js.xss', file: 'f', line: 1 }, { repo: 'a', rule: '', file: 'g', line: 1 }],
      depsJvm: [{ repo: 'a', id: 'CVE-1', package: 'p' }],
    },
  });
  assert.deepEqual(r.detectors.map((d) => d.detector), ['cspm/security_and_analysis', 'depsJvm/CVE-1', 'sastSemgrep/js.xss']);
  assert.deepEqual(r.unkeyed, { sastSemgrep: 1 });
});

test('byte-identical output whatever order repos and rows arrive in', () => {
  const a = fixture(25, 20);
  const b = { repos: [...a.repos].reverse(), scannerFindings: { secretsHistory: [...a.scannerFindings.secretsHistory].reverse() } };
  assert.equal(JSON.stringify(defectSignatures(a)), JSON.stringify(defectSignatures(b)));
});

test('the artifact carries no severity and no finding location', () => {
  const blob = JSON.stringify(defectSignatures(fixture(25)));
  assert.ok(!/"sev"|"severity"|"crit"|"file"|"line"/.test(blob));
});

test('a repo carrying rows in a lane is in that lane\'s population even when its scanners entry is missing — never 1 of 0', () => {
  const r = detectorRates({
    repos: [{ name: 'a', scanners: { depsRustAudit: {} } }, { name: 'b', scanners: {} }],
    scannerFindings: { depsRustAudit: [{ repo: 'b', id: 'RUSTSEC-2026-0001', package: 'p' }] },
  });
  assert.equal(r.population.depsRustAudit, 2);
  const d = r.detectors[0];
  assert.equal(d.positives, 1);
  assert.equal(d.population, 2);
  assert.equal(d.rate, 0.5);
});
