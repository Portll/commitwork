import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSuppressed } from '../sarif-read.mjs';
import { _sarifCounts, _sarifDetail } from '../extractors/sarif.mjs';
import { parseSarif } from '../../bin/lib/report-parsers/sarif.mjs';

const result = (ruleId, line, suppressions) => ({
  ruleId, level: 'warning', message: { text: ruleId },
  locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.mjs' }, region: { startLine: line } } }],
  ...(suppressions ? { suppressions } : {}),
});

const withSarif = (results, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-sarif-sup-'));
  try {
    writeFileSync(join(dir, 'semgrep.sarif'), JSON.stringify({
      version: '2.1.0',
      runs: [{ tool: { driver: { name: 'Opengrep OSS', rules: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }, invocations: [{ executionSuccessful: true }], results }],
    }));
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const SAMPLE = [
  result('a', 1),
  result('b', 2, [{ kind: 'inSource' }]),
  result('c', 3, [{ kind: 'inSource', status: 'rejected' }]),
];

test('a suppression holds unless a reviewer rejected it', () => {
  assert.equal(isSuppressed(SAMPLE[0]), false);
  assert.equal(isSuppressed(SAMPLE[1]), true);
  assert.equal(isSuppressed(SAMPLE[2]), false);
});

test('the extractor counts a suppressed result apart, and keeps it enumerable', () => withSarif(SAMPLE, (dir) => {
  const c = _sarifCounts(dir, 'semgrep.sarif');
  assert.equal(c.total, 2);
  assert.equal(c.suppressed.total, 1);
  assert.deepEqual(c.suppressed.rows, [{ rule: 'b', file: 'src/app.mjs', line: 2, sev: 'med' }]);
  const d = _sarifDetail(dir, 'semgrep.sarif', 'sastSemgrep');
  assert.deepEqual(d.findings.map((f) => f.rule).sort(), ['a', 'c']);
  assert.equal(d.suppressed.total, 1);
}));

test('the CLI parser does not publish a suppressed result as a finding', () => withSarif(SAMPLE, (dir) => {
  const p = parseSarif(join(dir, 'semgrep.sarif'));
  assert.equal(p.total, 2);
  assert.equal(p.suppressed, 1);
  assert.match(p.summary, /^2 \(0e\/2w\) · 1 suppressed in source$/);
}));

test('every result suppressed reads as zero live findings, not as a clean void', () => withSarif([result('b', 2, [{ kind: 'inSource' }])], (dir) => {
  const p = parseSarif(join(dir, 'semgrep.sarif'));
  assert.equal(p.ok, true);
  assert.equal(p.sev, 'ok');
  assert.equal(p.total, 0);
  assert.equal(p.suppressed, 1);
}));
