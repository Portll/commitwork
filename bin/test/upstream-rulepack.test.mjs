// Rulepack extraction, asserted by EFFECT: build a real .tar.gz fixture, run the extractor over
// it, and check the rule ids that come out — never a marker that extraction "ran".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractSemgrepRuleIds, extractRulepack } from '../upstream-fetch.mjs';
import { fileURLToPath } from 'node:url';

// The -f operand is always spelled relative to `dir` — see the note inside.
const ARCHIVE_NAME = 'rules.tar.gz';

function buildFixtureArchive() {
  const src = mkdtempSync(join(tmpdir(), 'cw-rulepack-fixture-'));
  mkdirSync(join(src, 'python'), { recursive: true });
  writeFileSync(join(src, 'python', 'sql.yaml'), [
    'rules:',
    '  - id: python.sql-injection',
    '    message: possible SQLi',
    '    languages: [python]',
    '  - id: python.hardcoded-secret',
    '    message: hardcoded secret',
    '    languages: [python]',
  ].join('\n'));
  mkdirSync(join(src, 'go'), { recursive: true });
  writeFileSync(join(src, 'go', 'cmd.yml'), [
    'rules:',
    '- id: go.command-injection',
    '  message: possible command injection',
  ].join('\n'));
  // A rule declaring `id` on a later key — deliberately MISSED by the line-based heuristic, so the
  // undercount-not-fabrication property has a fixture proving it, not just a comment claiming it.
  writeFileSync(join(src, 'go', 'odd-order.yml'), [
    'rules:',
    '- message: id declared after message, not detected',
    '  id: go.should-be-missed',
  ].join('\n'));
  writeFileSync(join(src, 'README.md'), 'not a rule file');

  const dir = mkdtempSync(join(tmpdir(), 'cw-rulepack-archive-'));
  const archive = join(dir, ARCHIVE_NAME);
  // The ARCHIVE argument is relative and tar runs from `dir`. GNU tar parses the -f operand as a
  // possible REMOTE spec (host:path), so an absolute Windows path made it try to connect to a host
  // named `C` and fail with "Cannot connect to C: resolve failed". Measured: -C is NOT parsed that
  // way and an absolute path there is fine, so only the -f operand needs this.
  execFileSync('tar', ['-czf', ARCHIVE_NAME, '-C', src, '.'], { stdio: 'ignore', cwd: dir });
  rmSync(src, { recursive: true, force: true });
  return { dir, archive };
}

test('extractSemgrepRuleIds finds every rule id, sorted and deduped, across nested yaml/yml files', () => {
  const { dir, archive } = buildFixtureArchive();
  try {
    const scratch = mkdtempSync(join(tmpdir(), 'cw-rulepack-extract-'));
    try {
      execFileSync('tar', ['-xzf', ARCHIVE_NAME, '-C', scratch], { stdio: 'ignore', cwd: dir });
      const ids = extractSemgrepRuleIds(scratch);
      assert.deepEqual(ids, ['go.command-injection', 'python.hardcoded-secret', 'python.sql-injection'].sort());
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a rule id declared on a non-first key is undercounted, never fabricated', () => {
  const { dir, archive } = buildFixtureArchive();
  try {
    const scratch = mkdtempSync(join(tmpdir(), 'cw-rulepack-extract-'));
    try {
      execFileSync('tar', ['-xzf', ARCHIVE_NAME, '-C', scratch], { stdio: 'ignore', cwd: dir });
      const ids = extractSemgrepRuleIds(scratch);
      assert.equal(ids.includes('go.should-be-missed'), false,
        'the extractor invented a rule id it cannot actually see — that is fabrication, not a floor');
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('extractRulepack writes a rule manifest sidecar with the exact count', () => {
  const { dir, archive } = buildFixtureArchive();
  try {
    const result = extractRulepack(archive, { id: 'fixture', ruleFormat: 'semgrep-yaml', asset: 'rules.tar.gz' });
    assert.equal(result.ruleCount, 3);
    assert.equal(result.path, `${archive}.rules.json`);
    const payload = JSON.parse(readFileSync(result.path, 'utf8'));
    assert.equal(payload.ruleCount, 3);
    assert.equal(payload.ruleFormat, 'semgrep-yaml');
    assert.deepEqual(payload.ruleIds, ['go.command-injection', 'python.hardcoded-secret', 'python.sql-injection'].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unknown ruleFormat is refused loudly, not skipped quietly', () => {
  const { dir, archive } = buildFixtureArchive();
  try {
    assert.throws(
      () => extractRulepack(archive, { id: 'fixture', ruleFormat: 'codeql-ql', asset: 'rules.tar.gz' }),
      /cannot extract/,
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a non-tar.gz asset is refused before extraction is attempted', () => {
  assert.throws(
    () => extractRulepack('/tmp/whatever.zip', { id: 'fixture', ruleFormat: 'semgrep-yaml', asset: 'whatever.zip' }),
    /only supports \.tar\.gz/,
  );
});

test('the schema declares kind and ruleFormat', () => {
  const schema = JSON.parse(readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'schema', 'upstream-sources.schema.json'), 'utf8'));
  const item = schema.properties.sources.items;
  assert.ok(item.properties.kind, 'schema has no kind property');
  assert.deepEqual(item.properties.kind.enum, ['binary', 'rulepack']);
  assert.ok(item.properties.ruleFormat, 'schema has no ruleFormat property');
  // The "required when kind is rulepack" rule is deliberately NOT expressed in this schema:
  // monitor/registry.mjs's checker is a small draft-07 subset that does not implement allOf/if/then,
  // and treats an unimplemented keyword as a hard error rather than a silent skip. The rule is
  // enforced at runtime instead — proven by the two tests below, not by a schema keyword this
  // validator cannot check.
  for (const unsupported of ['allOf', 'if', 'then', 'anyOf']) {
    assert.equal(item[unsupported], undefined, `schema uses '${unsupported}' — monitor/registry.mjs's checker does not implement it and treats that as a hard error, not a skip (this regressed the "schema canon" test once already)`);
  }
});

test('extractRulepack refuses a rulepack source with no ruleFormat at all (the runtime enforcement the schema defers to)', () => {
  assert.throws(
    () => extractRulepack('/tmp/whatever.tar.gz', { id: 'fixture', asset: 'whatever.tar.gz' }),
    /cannot extract/,
  );
});
