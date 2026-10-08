// monitor/test/sarif-ingest.test.mjs — third-party SARIF 2.1.0 import: normalised rows, line-free
// identity, kind routing, and refusal (never zero findings) for anything that is not a readable
// SARIF 2.1.0 document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ingestSarif, SarifIngestError } from '../sarif-ingest.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'sarif-ingest.mjs');
const dir = mkdtempSync(join(tmpdir(), 'cw-sarif-ingest-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
let seq = 0;
const put = (doc) => {
  const p = join(dir, `in-${seq++}.sarif`);
  writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return p;
};
const loc = (uri, line) => [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }];
const sarif = (results, rules = [], extra = {}) => ({
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'ExampleLint', rules } },
    invocations: [{ executionSuccessful: true }],
    results,
    ...extra,
  }],
});
const RULES = [
  { id: 'EX001', defaultConfiguration: { level: 'error' }, properties: { tags: ['external/cwe/cwe-079'] } },
  { id: 'EX002', properties: { 'security-severity': '9.1' } },
];

test('results become normalised findings with severity, CWE and a line-free identity', () => {
  const p = put(sarif([
    { ruleId: 'EX001', message: { text: 'reflected value' }, locations: loc('file:///src/a.js', 12) },
    { ruleId: 'EX002', level: 'note', message: { text: 'weak' }, locations: loc('./src/b.js', 3),
      partialFingerprints: { primaryLocationLineHash: 'abc:1' } },
    { ruleId: 'EX003', level: 'warning', message: { text: 'style' }, locations: loc('src/c.js', 1) },
  ], RULES));
  const out = ingestSarif(p, { repo: 'example-repo' });
  assert.equal(out.version, '2.1.0');
  assert.deepEqual(out.tools, ['ExampleLint']);
  assert.deepEqual(out.counts, { crit: 1, high: 1, med: 1, low: 0, total: 3 });
  const a = out.findings.find((f) => f.rule === 'EX001');
  assert.equal(a.file, 'src/a.js');
  assert.equal(a.line, 12);
  assert.equal(a.sev, 'high');
  assert.deepEqual(a.cwe, ['CWE-79']);
  assert.equal(a.identity, 'sarif|ExampleLint|example-repo|EX001|src/a.js|');
  assert.equal(a.identityBasis, 'rule+file');
  const b = out.findings.find((f) => f.rule === 'EX002');
  assert.equal(b.sev, 'crit', 'security-severity outranks level');
  assert.equal(b.identityBasis, 'partialFingerprints');
  assert.match(b.identity, /\|primaryLocationLineHash=abc:1$/);
});

test('identity does not move when the finding moves lines', () => {
  const at = (line) => ingestSarif(put(sarif([{ ruleId: 'EX001', message: { text: 'm' }, locations: loc('src/a.js', line) }], RULES)));
  assert.equal(at(10).findings[0].identity, at(40).findings[0].identity);
});

test('output is deterministic: result order in the document does not change it', () => {
  const rs = [
    { ruleId: 'EX002', message: { text: 'x' }, locations: loc('src/z.js', 1) },
    { ruleId: 'EX001', message: { text: 'y' }, locations: loc('src/a.js', 9) },
  ];
  const one = ingestSarif(put(sarif(rs, RULES)));
  const two = ingestSarif(put(sarif([...rs].reverse(), RULES)));
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});

test('kind routes results: review/open are undetermined, pass/notApplicable/informational are not findings', () => {
  const out = ingestSarif(put(sarif([
    { ruleId: 'EX001', kind: 'review', message: { text: 'needs a human' }, locations: loc('a.js', 1) },
    { ruleId: 'EX001', kind: 'open', message: { text: 'inconclusive' }, locations: loc('b.js', 1) },
    { ruleId: 'EX001', kind: 'pass', message: { text: 'ok' } },
    { ruleId: 'EX001', kind: 'notApplicable', message: { text: 'n/a' } },
    { ruleId: 'EX001', kind: 'informational', message: { text: 'fyi' } },
    { ruleId: 'EX001', baselineState: 'absent', message: { text: 'gone' }, locations: loc('c.js', 1) },
  ], RULES)));
  assert.equal(out.counts.total, 0);
  assert.equal(out.findings.length, 0);
  assert.deepEqual(out.undetermined.map((u) => u.kind).sort(), ['open', 'review']);
  assert.ok(out.undetermined.every((u) => !('sev' in u)), 'undetermined rows carry no crit/high/med/low band');
  assert.equal(out.undetermined[0].level, 'error', 'the original claimed level is preserved');
  assert.deepEqual(out.nonFindings, { pass: 1, notApplicable: 1, informational: 1, absent: 1 });
});

test('in-source suppressions are listed apart from findings and out of the counts', () => {
  const out = ingestSarif(put(sarif([
    { ruleId: 'EX001', message: { text: 'm' }, locations: loc('a.js', 1), suppressions: [{ kind: 'inSource' }] },
    { ruleId: 'EX001', message: { text: 'm' }, locations: loc('b.js', 1), suppressions: [{ kind: 'external', status: 'rejected' }] },
  ], RULES)));
  assert.equal(out.suppressed.length, 1);
  assert.equal(out.suppressed[0].file, 'a.js');
  assert.equal(out.counts.total, 1);
  assert.equal(out.findings[0].file, 'b.js');
});

test('rule.index resolves a rule when ruleId is absent', () => {
  const out = ingestSarif(put(sarif([{ rule: { index: 1 }, message: { text: 'm' }, locations: loc('a.js', 1) }], RULES)));
  assert.equal(out.findings[0].rule, 'EX002');
});

test('a clean, witnessed run imports as zero findings; an unwitnessed zero says so', () => {
  const clean = ingestSarif(put(sarif([], RULES)));
  assert.equal(clean.counts.total, 0);
  assert.equal(clean.unwitnessedZero, false);
  const bare = ingestSarif(put({ version: '2.1.0', runs: [{ tool: { driver: { name: 'ExampleLint' } }, results: [] }] }));
  assert.equal(bare.unwitnessedZero, true);
});

test('malformed or unreadable input is refused, never imported as zero findings', () => {
  const cases = {
    absent: join(dir, 'does-not-exist.sarif'),
    empty: put(''),
    unparseable: put('{"version":"2.1.0","runs":[{"tool":'),
    'never-ran': put({ version: '2.1.0' }),
    'tool-failed': put({ version: '2.1.0', runs: [{ tool: { driver: { name: 'X' } }, invocations: [{ executionSuccessful: false }], results: [] }] }),
    'unsupported-version': put({ version: '2.0.0', runs: [{ tool: { driver: { name: 'X' } }, results: [] }] }),
  };
  for (const [code, p] of Object.entries(cases)) {
    assert.throws(() => ingestSarif(p), (e) => e instanceof SarifIngestError && e.code === code, code);
  }
  const malformed = [
    sarif([{ message: { text: 'no rule' }, locations: loc('a.js', 1) }]),
    sarif([{ ruleId: 'EX001', kind: 'bogus', message: { text: 'm' } }], RULES),
    { version: '2.1.0', runs: [{ tool: { driver: {} }, results: [] }] },
    sarif(['not an object']),
  ];
  for (const doc of malformed) {
    assert.throws(() => ingestSarif(put(doc)), (e) => e instanceof SarifIngestError && e.code === 'malformed');
  }
});

test('CLI writes the import atomically, and refuses with exit 20 and no output file', () => {
  const ok = put(sarif([{ ruleId: 'EX001', message: { text: 'm' }, locations: loc('a.js', 1) }], RULES));
  const out = join(dir, 'out', 'findings.json');
  const r = spawnSync(process.execPath, [CLI, ok, '--repo', 'example-repo', '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).findings[0].identity, 'sarif|ExampleLint|example-repo|EX001|a.js|');
  const refusedOut = join(dir, 'out', 'refused.json');
  const bad = spawnSync(process.execPath, [CLI, put('not json'), '--out', refusedOut], { encoding: 'utf8' });
  assert.equal(bad.status, 20);
  assert.match(bad.stderr, /unparseable/);
  assert.equal(existsSync(refusedOut), false);
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
});
