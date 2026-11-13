// SARIF exported from a run whose repository directory holds remediation.json: a verified candidate
// becomes fixes[], a rejected one only a property, and every row joins on (identity, occurrence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildRepoSarif, writeRunSarif, FINGERPRINT_KEY } from '../lib/sarif-export.mjs';
import { buildRemediation } from '../../lib/remediation-contract.mjs';
import { fixtureRun, write, AT } from './lib/sarif-export-fixtures.mjs';

const PATCH = '--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n';
const IDENTITY = 'sc|sastSemgrep|r.open|src/a.js';

const verified = (patch = PATCH) => ({
  tier: 'rule',
  provenance: { tool: 'semgrep', model: null, version: '1.2.3' },
  patch,
  cached: true,
  verification: {
    status: 'verified',
    witness: { lanes: ['sastSemgrep'], before: 1, after: 0, digest: null },
    newFindings: [],
    tests: { command: null, status: 'notDeclared' },
    reason: null,
  },
});

const failed = () => ({
  tier: 'deterministic',
  provenance: { tool: 'commitwork', model: null, version: '9.9.9' },
  patch: PATCH,
  cached: true,
  verification: {
    status: 'failed',
    witness: { lanes: ['sastSemgrep'], before: 1, after: 1, digest: 'sha256:bb' },
    newFindings: [],
    tests: { command: null, status: 'notRun' },
    reason: 'the rule still fires',
  },
});

const finding = (over = {}) => ({
  identity: IDENTITY,
  occurrence: 0,
  ruleId: 'sastSemgrep/r.open',
  lane: 'sastSemgrep',
  file: 'src/a.js',
  severity: 'high',
  candidates: [verified()],
  actions: [],
  ...over,
});

const remediationDoc = (findings = [finding()], over = {}) => buildRemediation({
  repository: 'app', commit: 'abc123', generatedAt: AT, toolVersion: '9.9.9', findings, notMeasured: [], ...over,
});

function exported(remediation) {
  const { run, rows } = fixtureRun();
  return buildRepoSarif({ row: rows[0], dir: join(run, 'app'), toolVersion: '9.9.9', generatedAt: AT, remediation });
}

const resultAt = (doc, occurrence) => doc.runs[0].results.find((r) =>
  r.ruleId === 'sastSemgrep/r.open' && r.partialFingerprints[FINGERPRINT_KEY].endsWith(`:${occurrence}`));

test('a verified candidate becomes the joined result\'s exact fixes[] entry', () => {
  const doc = exported(remediationDoc([finding({ occurrence: 0 })]));
  assert.deepEqual(resultAt(doc, 0).fixes, [{
    description: { text: 'rule fix (semgrep 1.2.3), verified by re-running sastSemgrep' },
    artifactChanges: [{
      artifactLocation: { uri: 'src/a.js', uriBaseId: '%SRCROOT%' },
      replacements: [{
        deletedRegion: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 1 },
        insertedContent: { text: 'c\n' },
      }],
    }],
  }]);
  assert.equal(resultAt(doc, 1).fixes, undefined, 'the other occurrence of the identity gets no fix');
});

test('the remediation property sits beside the existing severity and lane properties', () => {
  const doc = exported(remediationDoc([finding()]));
  assert.deepEqual(resultAt(doc, 0).properties, {
    severity: 'high',
    lane: 'sast',
    commitwork: {
      remediation: {
        tier: 'rule',
        fixStatus: 'verified',
        witness: { lanes: ['sastSemgrep'], before: 1, after: 0, digest: null },
        undeterminedReason: null,
      },
    },
  });
});

test('a failed candidate gives the property and no fixes[] entry', () => {
  const doc = exported(remediationDoc([finding({ candidates: [failed()] })]));
  const result = resultAt(doc, 0);
  assert.deepEqual(result.properties.commitwork, {
    remediation: {
      tier: 'deterministic',
      fixStatus: 'failed',
      witness: { lanes: ['sastSemgrep'], before: 1, after: 1, digest: 'sha256:bb' },
      undeterminedReason: null,
    },
  });
  assert.equal(result.fixes, undefined);
});

test('a verified candidate whose patch cannot be projected is recorded and yields no fixes', () => {
  const created = verified('--- /dev/null\n+++ b/new.js\n@@ -0,0 +1 @@\n+x\n');
  const doc = exported(remediationDoc([finding({ candidates: [created] })]));
  assert.equal(resultAt(doc, 0).fixes, undefined);
  assert.deepEqual(doc.runs[0].properties.commitwork.remediationUnprojectable, [
    { identity: IDENTITY, occurrence: 0, path: 'new.js', reason: 'the patch creates this file' },
  ]);
});

test('a remediation finding that joins no result is listed as unmatched', () => {
  const unmatched = { identity: 'sc|sastSemgrep|r.nope|src/z.js', occurrence: 0, ruleId: 'sastSemgrep/r.nope',
    lane: 'sastSemgrep', file: 'src/z.js', severity: 'med', candidates: [], actions: [] };
  const doc = exported(remediationDoc([finding(), unmatched]));
  assert.deepEqual(doc.runs[0].properties.commitwork.remediationUnmatched, [
    { identity: 'sc|sastSemgrep|r.nope|src/z.js', occurrence: 0 },
  ]);
});

test('an invalid remediation document throws, naming the repository', () => {
  assert.throws(() => exported({ schema: 'commitwork.remediation/1' }), /remediation\.json for app is invalid/);
});

test('a document naming another repository throws', () => {
  const doc = remediationDoc([finding()], { repository: 'other' });
  assert.throws(() => exported(doc), /remediation\.json for app names repository "other", not "app"/);
});

test('a document verified against another commit throws', () => {
  const doc = remediationDoc([finding()], { commit: 'def456' });
  assert.throws(() => exported(doc), /remediation\.json for app names commit "def456", not "abc123"/);
});

test('a document with a null commit is not refused', () => {
  const doc = exported(remediationDoc([finding()], { commit: null }));
  assert.equal(resultAt(doc, 0).fixes.length, 1);
});

test('a lane remediation did not measure becomes a note notification', () => {
  const doc = exported(remediationDoc([finding()], { notMeasured: [{ lane: 'dast-nuclei', reason: 'no live URL' }] }));
  const notes = doc.runs[0].invocations[0].toolExecutionNotifications;
  assert.deepEqual(notes.find((n) => n.descriptor.id === 'dast-nuclei' && n.message.text.startsWith('dast-nuclei: remediation')), {
    descriptor: { id: 'dast-nuclei' },
    level: 'note',
    message: { text: 'dast-nuclei: remediation did not measure — no live URL' },
  });
});

test('writeRunSarif without remediation.json writes the same bytes and reports no fix count at all', () => {
  const { run, rows } = fixtureRun();
  const [written] = writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT });
  const expected = buildRepoSarif({ row: rows[0], dir: join(run, 'app'), toolVersion: '9.9.9', generatedAt: AT });
  assert.equal(readFileSync(written.path, 'utf8'), `${JSON.stringify(expected, null, 2)}\n`);
  assert.equal(written.fixes, null, 'nothing was measured, so the count is null, not zero');
  assert.equal(written.remediationUnmatched, null);
});

test('writeRunSarif counts results with fixes and unmatched findings from remediation.json', () => {
  const { run, rows } = fixtureRun();
  const unmatched = { identity: 'sc|sastSemgrep|r.nope|src/z.js', occurrence: 0, ruleId: 'sastSemgrep/r.nope',
    lane: 'sastSemgrep', file: 'src/z.js', severity: 'med', candidates: [], actions: [] };
  write(join(run, 'app', 'remediation.json'), remediationDoc([finding(), unmatched]));
  const [written] = writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT });
  assert.deepEqual([written.fixes, written.remediationUnmatched], [1, 1]);
});

test('a corrupt remediation.json is refused, never read as no remediation', () => {
  const { run, rows } = fixtureRun();
  write(join(run, 'app', 'remediation.json'), '{ not json');
  assert.throws(() => writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT }),
    (e) => e.message.startsWith(`remediation.json is not JSON: ${join(run, 'app', 'remediation.json')}`));
  assert.equal(existsSync(join(run, 'app', 'commitwork.sarif')), false, 'a refused run must not leave a SARIF log behind');
});

test('a remediation.json holding a non-document is refused', () => {
  for (const body of ['null', '[]', '"text"', '7']) {
    const { run, rows } = fixtureRun();
    write(join(run, 'app', 'remediation.json'), body);
    assert.throws(() => writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT }), /remediation\.json/, body);
  }
});

test('two findings claiming one identity and occurrence are refused, so no result takes two remediations', () => {
  const doc = remediationDoc();
  doc.findings.push(structuredClone(doc.findings[0]));
  assert.throws(() => exported(doc), /remediation\.json for app is invalid/);
});

test('a finding joins the occurrence it names and no other', () => {
  const doc = exported(remediationDoc([finding({ occurrence: 1 })]));
  const sameIdentity = doc.runs[0].results.filter((r) => r.ruleId === 'sastSemgrep/r.open');
  assert.equal(sameIdentity.length, 2);
  assert.deepEqual(sameIdentity.map((r) => Boolean(r.fixes)), [false, true]);
  assert.deepEqual(sameIdentity.map((r) => r.partialFingerprints[FINGERPRINT_KEY].split(':')[1]), ['0', '1']);
});

test('an unverified candidate never produces fixes[], only its property', () => {
  const unverified = { ...verified(), verification: { status: 'unverified', witness: { lanes: [], before: 1, after: null, digest: null }, newFindings: [], tests: { command: null, status: 'notRun' }, reason: null } };
  const doc = exported(remediationDoc([finding({ candidates: [unverified] })]));
  const withFixes = doc.runs[0].results.filter((r) => r.fixes);
  assert.equal(withFixes.length, 0);
  const joined = doc.runs[0].results.find((r) => r.properties.commitwork);
  assert.equal(joined.properties.commitwork.remediation.fixStatus, 'unverified');
});

test('an unreadable remediation.json is refused', () => {
  const { run, rows } = fixtureRun();
  mkdirSync(join(run, 'app', 'remediation.json'));
  assert.throws(() => writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT }),
    (e) => e.code === 'EISDIR');
});

test('a refused repository leaves no log for any repository of the run', () => {
  const { run, rows } = fixtureRun();
  const second = { ...rows[0], slug: 'zeta', repo: '/src/zeta' };
  write(join(run, 'zeta', 'summary.md'), '# Security report\n');
  write(join(run, 'zeta', 'remediation.json'), '{ not json');
  assert.throws(() => writeRunSarif({ runDir: run, rows: [rows[0], second], toolVersion: '9.9.9', generatedAt: AT }), /zeta/);
  assert.equal(existsSync(join(run, 'app', 'commitwork.sarif')), false);
  assert.equal(existsSync(join(run, 'zeta', 'commitwork.sarif')), false);
});

test('a remediation document with nothing verified reports a measured zero, not null', () => {
  const { run, rows } = fixtureRun();
  write(join(run, 'app', 'remediation.json'), remediationDoc([finding({ candidates: [failed()] })]));
  const [written] = writeRunSarif({ runDir: run, rows, toolVersion: '9.9.9', generatedAt: AT });
  assert.deepEqual([written.fixes, written.remediationUnmatched], [0, 0]);
});
