// Fixtures are real `cobolwork scan <tree> --out` reports (0.2.0, 2026-09-21), trimmed only of the
// rule maps the extractor never reads. Trees: kinds = bench/cases + an FTP job with a routable
// address + a credential case under tests/fixtures/; partial = a COPY not in the tree;
// partial-jcl = an INCLUDE not in the tree; nosrc = no COBOL; schema-v2 = partial at 5989d37.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS, stampUnknown } from '../extractors.mjs';
import { ROW_SCHEMAS } from '../detail-schema.mjs';
import { SCANNER_CHECKS } from '../scanner-checks.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cobolwork');

function extract() {
  const s = SCANNER_SPECS.find((x) => x[0] === 'sastCobol');
  assert.ok(s, 'sastCobol must be in SCANNER_SPECS');
  return s[2];
}
const dirWith = (content) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cobol-lane-'));
  if (content !== null) writeFileSync(join(dir, 'cobolwork.json'), content);
  return dir;
};
const fixture = (name) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cobol-lane-'));
  copyFileSync(join(FIXTURES, name), join(dir, 'cobolwork.json'));
  return extract()(dir);
};
const report = (name) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

test('the category is registered once, under the check the manifest declares', () => {
  const spec = SCANNER_SPECS.find((x) => x[0] === 'sastCobol');
  assert.equal(spec[1], 'sast-cobol-cobolwork');
  assert.equal(SCANNER_CHECKS.sastCobol, 'sast-cobol-cobolwork');
  assert.deepEqual(LANE_KINDS.sastCobol, { kind: 'vulnerability', additive: true, actionable: true, why: '' },
    'additive: no other lane reads COBOL, so its counts duplicate nothing');
});

test('defects count at cobolwork\'s own severity; coverage is undetermined; context sits beside', () => {
  const src = report('kinds.json');
  const r = fixture('kinds.json');
  assert.equal(r.ran, true);
  const byEv = src.summary.byEvidence;
  assert.equal(byEv.coverage, 6);
  assert.equal(byEv.context, 3);
  assert.equal(src.summary.bySeverity.info, byEv.coverage + byEv.context, 'info is exactly coverage and context');

  assert.equal(r.undetermined, 6, 'every place the analysis stopped following is undetermined, not low');
  assert.equal(r.context, 3, 'an entry point or a product in use describes the estate');
  assert.equal(r.crit, 10);
  assert.equal(r.high, 19);
  assert.equal(r.med, 5);
  assert.equal(r.low, 2);
  assert.equal(r.total, r.crit + r.high + r.med + r.low, 'total counts findings, and only findings');
  assert.equal(r.total + r.undetermined + r.context + r.fixtures.total, src.findings.length,
    'every finding in the report is accounted for exactly once');
});

test('a finding under a test-fixture path is set aside, counted and kept enumerable', () => {
  const r = fixture('kinds.json');
  assert.equal(r.fixtures.total, 2);
  assert.equal(r.fixtures.crit, 1, 'the planted credential under tests/fixtures/ is not a published critical');
  assert.ok(r.fixtures.rows.every((x) => x.file.startsWith('tests/fixtures/')));
  assert.match(r.fixtures.note, /2 of 38 findings/);
});

test('rows carry the evidence kind, and a row that is not a finding carries no severity', () => {
  const r = fixture('kinds.json');
  assert.ok(Array.isArray(r.findings) && r.findings.length === r.total + r.undetermined + r.context);
  const fields = ROW_SCHEMAS.sastCobol.fields.map((f) => f[0]);
  for (const row of r.findings) {
    assert.deepEqual(Object.keys(row).sort(), [...fields].sort(), 'rows are built from the schema, nothing else');
    if (row.evidence === 'coverage' || row.evidence === 'context') assert.equal(row.sev, '', `${row.rule} is not a finding`);
    else assert.ok(['crit', 'high', 'med', 'low'].includes(row.sev), `${row.rule} is ${row.sev}`);
  }
  const address = r.findings.find((x) => x.rule === 'recon-routable-address-committed');
  assert.equal(address.evidence, 'exposure');
  assert.equal(address.file, 'ops/FTPJOB.jcl');
  assert.ok(!r.findings.some((x) => 'trace' in x), 'a trace names every item on the route and never leaves the box');
});

// Carried over from the retired cobolSecurity reader (sast-cobol, 2026-09-26), which read the same
// report: nothing it published may be lost by retiring it.
test('rows name the flow model and program, and a sink many sources reach says how many', () => {
  const src = report('kinds.json');
  const r = fixture('kinds.json');
  assert.equal(src.summary.flowModel, 'byte-range', 'the fixture states its flow model');
  assert.ok(r.findings.every((row) => row.model === 'byte-range'),
    'every row carries the model, which issue-store reads before calling a vanished row fixed');
  const named = src.findings.filter((f) => f.program && !f.path.startsWith('tests/fixtures/'));
  assert.ok(named.length > 0);
  for (const f of named) {
    assert.ok(r.findings.some((row) => row.rule === f.rule && row.file === f.path && row.program === f.program),
      `${f.rule} in ${f.path} names program ${f.program}`);
  }
  const many = src.findings.find((f) => f.sources > 1);
  const row = r.findings.find((x) => x.rule === many.rule && x.file === many.path && x.line === many.line);
  assert.match(row.message, new RegExp(`\\(${many.sources} sources reach this statement\\)$`));
  assert.equal(r.crossProgram, src.summary.crossProgram);
});

test('a report without nosrc that read nothing is still no-subject, never a clean zero', () => {
  const rep = { tool: 'cobolwork', schemaVersion: 2, summary: { findings: 0, filesScanned: 0 }, findings: [] };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.nosrc, true);
  assert.equal(stampUnknown(r).unknownReason, 'no-subject');
});

test('partial coverage names refused copies, unlistable directories and symlinks left unfollowed', () => {
  const rep = {
    tool: 'cobolwork', schemaVersion: 3,
    summary: { findings: 0, filesScanned: 3, coverageIncomplete: true, copiesMissing: 0 },
    inventory: { refusedCopies: [{ name: 'X' }, { name: 'Y' }], dirsUnreadable: 1, symlinks: { followed: 0, outside: 4, broken: 0 } },
    findings: [],
  };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.coverage.state, 'partial');
  assert.match(r.coverage.reason, /2 COPY statement\(s\) named a file outside the tree and were refused/);
  assert.match(r.coverage.reason, /1 director\(ies\) could not be listed/);
  assert.match(r.coverage.reason, /4 symlink\(s\) point outside the tree/);
});

test('a report that states impact and a fix carries both onto the defect row', () => {
  const rep = {
    tool: 'cobolwork', schemaVersion: 3,
    summary: { findings: 1, bySeverity: { crit: 1 }, byEvidence: { path: 1 }, filesScanned: 1, coverageIncomplete: false, toolVersion: '0.3.0' },
    findings: [{ rule: 'argv-or-env-to-os-command', path: 'src/A.cbl', line: 10, sev: 'crit', evidence: 'path', cwe: 'CWE-78', detail: 'input reaches SYSTEM', fingerprint: 'a'.repeat(32) }],
    ruleImpact: { 'argv-or-env-to-os-command': 'Whoever sets the command line runs an arbitrary operating-system command' },
    ruleRemedy: { 'argv-or-env-to-os-command': 'Build the command only from fixed literals' },
  };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.remediationRead, true);
  const row = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  assert.match(row.impact, /arbitrary operating-system command/);
  assert.match(row.remedy, /fixed literals/);
});

test('a report from before impact and fix is read, and says the tool did not answer rather than blank as none', () => {
  const rep = {
    tool: 'cobolwork', schemaVersion: 3,
    summary: { findings: 1, bySeverity: { crit: 1 }, byEvidence: { path: 1 }, filesScanned: 1, coverageIncomplete: false, toolVersion: '0.2.0' },
    findings: [{ rule: 'argv-or-env-to-os-command', path: 'src/A.cbl', line: 10, sev: 'crit', evidence: 'path', cwe: 'CWE-78', detail: 'x', fingerprint: 'b'.repeat(32) }],
  };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.remediationRead, false);
  assert.match(r.remediationNote, /did not answer/);
  const row = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  assert.equal(row.impact, '');
  assert.equal(row.remedy, '');
});

test('a report that states reach and effect carries both onto the row', () => {
  const rep = {
    tool: 'cobolwork', schemaVersion: 3,
    summary: { findings: 1, bySeverity: { crit: 1 }, byEvidence: { path: 1 }, filesScanned: 1, coverageIncomplete: false, toolVersion: '0.3.0', byReach: { open: 1, restricted: 0, undeclared: 0 } },
    findings: [{ rule: 'argv-or-env-to-os-command', path: 'src/A.cbl', line: 10, sev: 'crit', evidence: 'path', cwe: 'CWE-78', detail: 'x', fingerprint: 'c'.repeat(32), reach: 'open', effect: 'privileged' }],
  };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.reachRead, true);
  const row = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  assert.equal(row.reach, 'open');
  assert.equal(row.effect, 'privileged');
});

test('a report from before reach and effect is read as unanswered, not unreachable', () => {
  const rep = {
    tool: 'cobolwork', schemaVersion: 3,
    summary: { findings: 1, bySeverity: { crit: 1 }, byEvidence: { path: 1 }, filesScanned: 1, coverageIncomplete: false, toolVersion: '0.2.0' },
    findings: [{ rule: 'argv-or-env-to-os-command', path: 'src/A.cbl', line: 10, sev: 'crit', evidence: 'path', cwe: 'CWE-78', detail: 'x', fingerprint: 'd'.repeat(32) }],
  };
  const r = extract()(dirWith(JSON.stringify(rep)));
  assert.equal(r.reachRead, false);
  assert.match(r.reachEffectNote, /did not answer/);
  const row = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  assert.equal(row.reach, '');
  assert.equal(row.effect, '');
});

test('a configuration gap is carried, and does not make the lane partial', () => {
  const r = fixture('kinds.json');
  assert.equal(r.coverage.state, 'covered');
  assert.equal(r.coverageIncomplete, undefined);
  assert.deepEqual(r.setsIncomplete.map((x) => `${x.set}:${x.kind}`), ['recon:configuration']);
  assert.match(r.setsIncomplete[0].why, /cobolwork\.site\.json/);
});

test('a JCL file read in part is partial, and says which file and why', () => {
  const r = fixture('partial-jcl.json');
  assert.equal(r.coverage.state, 'partial');
  assert.match(r.coverage.reason, /jcl\/NIGHTLY\.jcl:2: INCLUDE MEMBER=STDPARMS was not resolved/);
  assert.doesNotMatch(r.coverage.reason, /site\.json/, 'a configuration gap is not a coverage reason');
  assert.deepEqual(r.setsIncomplete.map((x) => `${x.set}:${x.kind}`), ['jcl:coverage', 'recon:configuration']);
});

test('coverage cobolwork reports incomplete is partial, with the reason, never clean', () => {
  const r = fixture('partial.json');
  assert.equal(r.ran, true);
  assert.equal(r.total, 0);
  assert.equal(r.coverageIncomplete, true);
  assert.equal(r.coverage.state, 'partial', 'the rollup maps partial to reduced coverage');
  assert.match(r.coverage.reason, /1 COPY statement\(s\) name a copybook not in the tree/);
  assert.match(r.coverage.reason, /not evidence of absence/);
});

test('a tree with nothing cobolwork reads is no-subject, not a clean zero', () => {
  const r = fixture('nosrc.json');
  assert.equal(r.nosrc, true);
  assert.equal(stampUnknown(r).unknownReason, 'no-subject');
});

test('a cobolwork from before evidence is still read, with its info rows undetermined', () => {
  const src = report('schema-v2.json');
  assert.equal(src.schemaVersion, 2, 'the fixture really is a version 2 report');
  assert.equal(src.findings.filter((f) => f.evidence).length, 0, 'and really carries no evidence');
  const r = fixture('schema-v2.json');
  assert.equal(r.ran, true);
  assert.equal(r.unparseable, undefined, 'a version this lane predates is not a corrupt artifact');
  assert.equal(r.evidenceRead, false);
  assert.match(r.evidenceNote, /severity alone decided the buckets/);

  const outside = src.findings.filter((f) => !f.path.startsWith('tests/fixtures/'));
  const info = outside.filter((f) => f.sev === 'info').length;
  assert.ok(info > 0 && outside.length > info, 'the fixture has both defects and info rows to tell apart');
  assert.equal(r.undetermined, info, 'info has never been a defect severity, so those rows are undetermined');
  assert.equal(r.total, outside.length - info);
  assert.equal(r.crit + r.high + r.med + r.low, r.total);
  for (const row of r.findings) {
    if (row.sev === '') continue;
    assert.ok(['crit', 'high', 'med', 'low'].includes(row.sev));
  }
});

test('a fingerprint travels onto the row when the report carries one, and its scheme is named', () => {
  const src = report('fingerprints.json');
  assert.equal(src.summary.identity.version, 'cobolwork/v1');
  const r = fixture('fingerprints.json');
  assert.equal(r.fingerprintVersion, 'cobolwork/v1');
  assert.equal(r.evidenceRead, true);
  const byRule = new Map(src.findings.map((f) => [`${f.rule}|${f.path}|${f.line}`, f.fingerprint]));
  assert.ok(r.findings.length > 0);
  for (const row of r.findings) {
    assert.match(row.fingerprint, /^[0-9a-f]{32}$/, `${row.rule} carries its fingerprint`);
  }
  assert.ok([...byRule.values()].every((x) => /^[0-9a-f]{32}$/.test(x)));
});

test('a report with no fingerprints is read without one, and claims no scheme', () => {
  const r = fixture('kinds.json');
  assert.equal(r.fingerprintVersion, undefined, 'a scheme is claimed only where the report states one');
  assert.ok(r.findings.every((row) => row.fingerprint === ''));
  assert.equal(r.total > 0, true, 'and the counts are unaffected');
});

test('a kind this reader does not know is undetermined, whatever severity it carries', () => {
  const src = report('kinds.json');
  const one = src.findings.find((f) => f.evidence === 'path' && f.sev === 'crit');
  const r = extract()(dirWith(JSON.stringify({ ...src, findings: [{ ...one, evidence: 'exploitable' }] })));
  assert.equal(r.crit, 0);
  assert.equal(r.undetermined, 1);
});

test('absent, empty, not JSON, and not a cobolwork report are each their own state', () => {
  assert.equal(extract()(dirWith(null)), null, 'no artifact reads through run provenance, never as counts');
  const empty = extract()(dirWith(''));
  assert.equal(empty.nosrc, true);
  assert.equal(empty.emptyArtifact, true);
  assert.equal(extract()(dirWith('cobolwork: something went wrong\n')).unparseable, true);
  const other = extract()(dirWith(JSON.stringify({ tool: 'brakeman', findings: [], summary: {} })));
  assert.equal(other.unparseable, true);
  assert.equal(other.unparseableWhy, 'not a cobolwork scan report');
});

test('the block carries the commit the reporting cobolwork ran from, and nothing it cannot read as one', () => {
  const rep = (toolRevision) => ({ tool: 'cobolwork', schemaVersion: 3, summary: { findings: 0, filesScanned: 1, coverageIncomplete: false, toolRevision }, findings: [] });
  const release = extract()(dirWith(JSON.stringify(rep({ commit: 'a'.repeat(40), dirty: false, tag: 'v0.2.17', from: 'release', extra: 'dropped' }))));
  assert.deepEqual(release.toolRevision, { commit: 'a'.repeat(40), dirty: false, tag: 'v0.2.17', from: 'release' });
  const checkout = extract()(dirWith(JSON.stringify(rep({ commit: 'b'.repeat(40), dirty: true, from: 'checkout' }))));
  assert.deepEqual(checkout.toolRevision, { commit: 'b'.repeat(40), dirty: true, from: 'checkout' }, 'a dirty working tree says so');
  for (const bad of [undefined, null, { commit: 'HEAD' }, { dirty: false }]) {
    assert.equal('toolRevision' in extract()(dirWith(JSON.stringify(rep(bad)))), false, JSON.stringify(bad));
  }
});
