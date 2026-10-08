// monitor/test/ruby-lanes-extractor.test.mjs — sastBrakeman and depsBundlerAudit's first real
// readers.
//
// Both fixtures below are REAL captured output, not hand-written: brakeman.json is Brakeman 5.4.1
// (installed 5.4.1 specifically — >=5.5 requires Ruby >=3.2, and this box's system ruby is 2.6.10)
// run against a scratch Rails fixture (SQL injection, dangerous eval, XSS, CSRF, EOL-Rails);
// bundler-audit.json is bundler-audit 0.9.3 run against a scratch Gemfile.lock pinning a vulnerable
// nokogiri, trimmed to 3 of the 40 real results (long `description` fields stripped — the extractor
// never reads them). Pasted verbatim rather than invented, per this repo's rule for every parser
// here: the documented shape differed from the real one for every tool checked this way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCANNER_SPECS, LANE_KINDS } from '../extractors.mjs';

function specFor(key) {
  const s = SCANNER_SPECS.find((x) => x[0] === key);
  assert.ok(s, `${key} must be in SCANNER_SPECS`);
  return s[2];
}

function readInto(file, content) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ruby-lane-'));
  if (content !== null) writeFileSync(join(dir, file), content);
  return dir;
}

// REAL, captured 2026-09-01 (brakeman -f json against a scratch Rails app: SQL injection,
// dangerous eval, XSS via content_tag, CSRF, EOL-Rails).
// Shared with monitor/lane-capability.mjs, which credits the lane from it as in-test evidence.
const REAL_OUTPUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extractor-real');
const BRAKEMAN_JSON = readFileSync(join(REAL_OUTPUT, 'sastBrakeman', 'brakeman.json'), 'utf8');

// REAL, captured 2026-09-01 (bundler-audit 0.9.3 against a fixture Gemfile.lock: rails 5.0.0,
// nokogiri 1.10.0 — trimmed to 3 of the real 40 results, including one with criticality:null).
const BUNDLER_AUDIT_JSON = readFileSync(join(REAL_OUTPUT, 'depsBundlerAudit', 'bundler-audit.json'), 'utf8');

test('sastBrakeman: confidence maps directly to severity (Brakeman has no separate severity axis)', () => {
  const fn = specFor('sastBrakeman');
  const dir = readInto('brakeman.json', BRAKEMAN_JSON);
  const r = fn(dir);
  assert.equal(r.ran, true);
  assert.equal(r.total, 5);
  assert.equal(r.high, 2, 'Evaluation + EOLRails are confidence:High');
  assert.equal(r.med, 3, 'ContentTag + SQL + CSRFTokenForgeryCVE are confidence:Medium');
  assert.equal(r.low, 0, 'no Weak-confidence rows in this fixture');
});

test('sastBrakeman: cwe comes from Brakeman\'s own cwe_id, joined when a warning asserts several', () => {
  const fn = specFor('sastBrakeman');
  const dir = readInto('brakeman.json', BRAKEMAN_JSON);
  const rows = fn(dir).findings;
  const sqli = rows.find((r) => r.rule === 'SQL');
  assert.equal(sqli.cwe, 'CWE-89');
  const evalRow = rows.find((r) => r.rule === 'Evaluation');
  assert.equal(evalRow.cwe, 'CWE-913, CWE-95', 'a warning asserting two CWEs joins both, in the order Brakeman gave them');
});

test('sastBrakeman: confidence rides in the message as readable context', () => {
  const fn = specFor('sastBrakeman');
  const dir = readInto('brakeman.json', BRAKEMAN_JSON);
  const row = fn(dir).findings.find((r) => r.rule === 'Evaluation');
  assert.match(row.message, /confidence: High/);
});

test('sastBrakeman: file/line/rule identity — never keyed on line', () => {
  const fn = specFor('sastBrakeman');
  const dir = readInto('brakeman.json', BRAKEMAN_JSON);
  const row = fn(dir).findings.find((r) => r.rule === 'SQL');
  assert.equal(row.file, 'app/controllers/users_controller.rb');
  assert.equal(row.line, 3);
  assert.equal(LANE_KINDS.sastBrakeman.kind, 'vulnerability', 'a real vulnerability lane, not a linter');
  assert.equal(LANE_KINDS.sastBrakeman.additive, true);
});

test('sastBrakeman: absent artifact is null, malformed JSON is unparseable — never a clean zero', () => {
  const fn = specFor('sastBrakeman');
  assert.equal(fn(readInto('brakeman.json', null)), null);
  const bad = fn(readInto('brakeman.json', '{"not":"the right shape"}'));
  assert.equal(bad.unparseable, true);
  assert.equal(bad.total, 0);
});

test('depsBundlerAudit: criticality maps to severity, and a null criticality is undetermined, never guessed', () => {
  const fn = specFor('depsBundlerAudit');
  const dir = readInto('bundler-audit.json', BUNDLER_AUDIT_JSON);
  const r = fn(dir);
  assert.equal(r.ran, true);
  assert.equal(r.total, 3);
  assert.equal(r.high, 2);
  assert.equal(r.undetermined, 1, 'the GHSA row with criticality:null lands in undetermined, not a defaulted bucket');
  const nullRow = r.findings.find((f) => f.rule === 'GHSA-wfpw-mmfh-qq69');
  assert.equal(nullRow.sev, '', 'sev is empty, matching depsRustAudit\'s convention for an ungraded row');
});

test('depsBundlerAudit: rule/package/version identity, message carries title and patched range', () => {
  const fn = specFor('depsBundlerAudit');
  const dir = readInto('bundler-audit.json', BUNDLER_AUDIT_JSON);
  const row = fn(dir).findings.find((f) => f.rule === 'CVE-2019-13118');
  assert.equal(row.package, 'nokogiri');
  assert.equal(row.version, '1.10.0');
  assert.match(row.message, /libxslt Type Confusion/);
  assert.match(row.message, /patched: >= 1\.10\.5/);
});

test('depsBundlerAudit: lane(V,\'duplicate\') — additive:false, actionable:true, same shape as depsRustAudit', () => {
  assert.equal(LANE_KINDS.depsBundlerAudit.kind, 'vulnerability');
  assert.equal(LANE_KINDS.depsBundlerAudit.additive, false);
  assert.equal(LANE_KINDS.depsBundlerAudit.actionable, true, 'a duplicate lane is still real work, only excluded from the summed headline');
});

test('depsBundlerAudit: only type:unpatched_gem is parsed — an unseen result type is not guessed at', () => {
  const fn = specFor('depsBundlerAudit');
  const dir = readInto('bundler-audit.json', JSON.stringify({
    version: '0.9.3', created_at: 'now',
    results: [{ type: 'insecure_source', source: 'http://rubygems.org/' }],
  }));
  const r = fn(dir);
  assert.equal(r.total, 0, 'an unhandled result type is skipped, not fabricated into a row');
});

test('depsBundlerAudit: absent artifact is null, malformed JSON is unparseable', () => {
  const fn = specFor('depsBundlerAudit');
  assert.equal(fn(readInto('bundler-audit.json', null)), null);
  const bad = fn(readInto('bundler-audit.json', '{"not":"the right shape"}'));
  assert.equal(bad.unparseable, true);
});
