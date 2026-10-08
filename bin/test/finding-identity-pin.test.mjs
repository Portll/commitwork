// Finding identity, pinned (docs/STABILITY.md, public interface 6). Fixed synthetic inputs, fixed
// expected ids: a change to any identity function fails here, because a changed identity reopens
// closed issues, un-suppresses annotations and splits SARIF alerts. A deliberate change updates
// these values in the same commit as the migration that re-keys stored records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { scannerIdentityParts } from '../../monitor/issue-store.mjs';
import { scannerSourceKey, depSourceKey } from '../../monitor/issue-ingest.mjs';
import { buildFindingKey, findingKeyForScanner, findingKeyForDependency } from '../lib/verdict-journal-core.mjs';
import { buildRepoSarif, FINGERPRINT_KEY } from '../lib/sarif-export.mjs';
import { ingestSarif } from '../../monitor/sarif-ingest.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');

const SEMGREP = { repo: 'example-repo', rule: 'js/xss', file: 'src/a.js', line: 12 };
const CSPM = { repo: 'example-repo', control: 'Require signed commits', resource: 'example-org/example-repo' };
const COBOL = { repo: 'example-repo', rule: 'CBL001', file: 'src/PAY.cbl', line: 40, fingerprint: 'PAY:MAIN:abc123' };

test('issue store: scanner-row source keys', () => {
  assert.deepEqual(scannerIdentityParts(SEMGREP, 'sastSemgrep'), { parts: ['js/xss', 'src/a.js'], from: 'rule-file' });
  assert.equal(scannerSourceKey(SEMGREP, 'sastSemgrep'), 'sc:example-repo|sastSemgrep|js/xss|src/a.js');
  assert.equal(scannerSourceKey(CSPM, 'cspm'), 'sc:example-repo|cspm|control=Require signed commits|resource=example-org/example-repo');
  assert.equal(scannerSourceKey(COBOL, 'sastCobol'), 'sc:example-repo|sastCobol|fingerprint=PAY:MAIN:abc123');
  assert.equal(scannerSourceKey({ repo: 'example-repo', message: 'x' }, 'cspm'), null, 'unkeyable, never a colliding key');
});

test('issue store: a moved line keeps the key', () => {
  assert.equal(scannerSourceKey({ ...SEMGREP, line: 400 }, 'sastSemgrep'), scannerSourceKey(SEMGREP, 'sastSemgrep'));
  assert.equal(scannerSourceKey({ ...COBOL, line: 1, file: 'moved/PAY.cbl' }, 'sastCobol'), scannerSourceKey(COBOL, 'sastCobol'),
    'a fingerprint-keyed lane keeps its key when the file moves too');
});

test('issue store: dependency source key', () => {
  assert.equal(depSourceKey({ key: 'example-repo|osv|CVE-2020-0001|left-pad|package-lock.json' }),
    'f:example-repo|osv|CVE-2020-0001|left-pad|package-lock.json');
});

test('verdict journal: finding keys, and a line component is refused', () => {
  assert.equal(findingKeyForScanner('sastSemgrep', 'example-repo', SEMGREP), 'sastSemgrep|example-repo|js/xss|src/a.js');
  assert.equal(findingKeyForScanner('cspm', 'example-repo', CSPM), 'cspm|example-repo|Require signed commits|example-org/example-repo');
  assert.equal(findingKeyForDependency('example-repo', 'CVE-2020-0001', 'left-pad'), 'example-repo|CVE-2020-0001|left-pad');
  assert.throws(() => buildFindingKey([['rule', 'r'], ['line', 3]]), /forbidden identity component 'line'/);
});

const write = (p, body) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(body)); };
const semgrepSarif = (line) => ({ version: '2.1.0', runs: [{ tool: { driver: { name: 'semgrep', rules: [{ id: 'r.open' }] } },
  invocations: [{ executionSuccessful: true }], results: [
    { ruleId: 'r.open', level: 'error', message: { text: 'tainted value reaches eval' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: line } } }] },
    { ruleId: 'r.open', level: 'error', message: { text: 'tainted value reaches eval again' },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: line + 20 } } }] }] }] });

function exportFingerprints(line) {
  const run = mkdtempSync(join(tmpdir(), 'cw-identity-pin-'));
  try {
    const dir = join(run, 'app');
    write(join(dir, 'osv.sarif'), { version: '2.1.0', runs: [{ tool: { driver: { name: 'osv-scanner', rules: [{ id: 'CVE-2020-0001',
      shortDescription: { text: 'CVE-2020-0001: a flaw in left-pad' }, properties: { 'security-severity': '9.8' } }] } },
    invocations: [{ executionSuccessful: true }], results: [{ ruleId: 'CVE-2020-0001',
      message: { text: "Package 'left-pad@1.0.0' is vulnerable to 'CVE-2020-0001'." },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'package-lock.json' } } }] }] }] });
    write(join(dir, 'semgrep.sarif'), semgrepSarif(line));
    const row = { repo: '/src/app', slug: 'app', cells: { 'deps-osv': { sev: 'high', summary: '1' }, sast: { sev: 'high', summary: '2' } } };
    const doc = buildRepoSarif({ row, dir, toolVersion: '9.9.9', generatedAt: '2026-10-08T00:00:00.000Z' });
    return doc.runs[0].results.map((r) => [r.ruleId, r.partialFingerprints]);
  } finally { rmSync(run, { recursive: true, force: true }); }
}

test('SARIF export: partialFingerprints', () => {
  assert.equal(FINGERPRINT_KEY, 'commitworkIdentity/v1');
  const dep = 'fa4781e8b82c37a26e52721ddede78a0271bb2c3ba40cb12b48c2ab740e61142';
  const sem = '5d9fb3308494b776adf09e05b114f4ff12d9a06a0b3fdb824ec90356fefe72ad';
  // The preimages are the issue store's place keys without the repository, which the log itself names.
  assert.equal(sha('f|osv|CVE-2020-0001|left-pad|package-lock.json'), dep);
  assert.equal(sha('sc|sastSemgrep|r.open|src/a.js'), sem);
  assert.deepEqual(exportFingerprints(3), [
    ['deps/CVE-2020-0001', { [FINGERPRINT_KEY]: `${dep}:0` }],
    ['sastSemgrep/r.open', { [FINGERPRINT_KEY]: `${sem}:0` }],
    ['sastSemgrep/r.open', { [FINGERPRINT_KEY]: `${sem}:1` }],
  ]);
  assert.deepEqual(exportFingerprints(90), exportFingerprints(3), 'moving every line changes no fingerprint');
});

test('SARIF ingest: identities with and without partialFingerprints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-identity-pin-in-'));
  try {
    const p = join(dir, 'in.sarif');
    const result = (uri, line, extra = {}) => ({ ruleId: 'EX001', message: { text: 'm' }, ...extra,
      locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }] });
    const read = (line) => {
      write(p, { version: '2.1.0', runs: [{ tool: { driver: { name: 'ExampleLint', rules: [{ id: 'EX001' }] } }, results: [
        result('src/a.js', line), result('src/b.js', line + 4, { partialFingerprints: { primaryLocationLineHash: 'abc:1' } })] }] });
      return ingestSarif(p, { repo: 'example-repo' }).findings.map((f) => [f.identity, f.identityBasis]);
    };
    assert.deepEqual(read(5), [
      ['sarif|ExampleLint|example-repo|EX001|src/a.js|', 'rule+file'],
      ['sarif|ExampleLint|example-repo|EX001|src/b.js|primaryLocationLineHash=abc:1', 'partialFingerprints'],
    ]);
    assert.deepEqual(read(70), read(5), 'moving every line changes no identity');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
