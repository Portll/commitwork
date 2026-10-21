// joern.txt now holds one section per language, so the question "did the scan run" has one answer
// per language and the artifact alone cannot give it: a ScanPass from the C section would otherwise
// certify a Java frontend that died. joern-lane.json is the witness; without it (a vintage artifact)
// the old whole-file reading stands.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCANNER_SPECS } from '../extractors.mjs';

const read = SCANNER_SPECS.find(([key]) => key === 'sastJoern')[2];
const _joernScanCounts = (d) => read(d);

const T = mkdtempSync(join(tmpdir(), 'cw-joern-x-'));
let n = 0;
const C_SECTION = '# joern-lane language=c exit=0 files=3\n[INFO] scanning\nResult: 8.0 : Dangerous function gets() used: a.c:3:main\nScanPass completed\n';
const JAVA_FAILED = '# joern-lane language=java exit=1 files=2\nWriting logs to: /tmp/joern-scan-log.txt\n';

const dir = (files) => {
  const d = join(T, `d${n++}`);
  mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), typeof body === 'string' ? body : JSON.stringify(body));
  return d;
};
const lane = (languages) => ({ tool: 'joern-lane', launcher: { stderrCaptured: true }, languages });

describe('a per-language artifact', () => {
  test('a language that failed is named, and the count says which languages it covers', () => {
    const d = dir({
      'joern.txt': C_SECTION + JAVA_FAILED,
      'joern.txt.exit': '1\n',
      'joern-lane.json': lane([
        { id: 'c', exit: 0, scanRan: true, results: 1 },
        { id: 'java', exit: 1, scanRan: false, results: 0, reason: 'value javasrc is not a member of ImportCode' },
      ]),
    });
    const c = _joernScanCounts(d);
    assert.equal(c.total, 1, 'the C findings are real and are still published');
    assert.equal(c.toolfailed, undefined);
    assert.equal(c.coverageIncomplete, true, 'the marker the CodeQL lanes raise for a run that read less than it claims');
    assert.equal(c.coverage.state, 'partial');
    assert.deepEqual(c.coverage.languagesFailed, [{ language: 'java', reason: 'value javasrc is not a member of ImportCode' }]);
    assert.deepEqual(c.coverage.languagesScanned, ['c']);
    assert.match(c.coverage.reason, /covers c only/);
  });

  test('no language reaching a scan pass is toolfailed, whatever the exit sidecar says', () => {
    const d = dir({
      'joern.txt': JAVA_FAILED,
      'joern.txt.exit': '0\n',
      'joern-lane.json': lane([{ id: 'java', exit: 0, scanRan: false, results: 0, reason: '[ERROR] Process exited with code 1.' }]),
    });
    const c = _joernScanCounts(d);
    assert.equal(c.toolfailed, true);
    assert.equal(c.total, 0);
  });

  test('every language scanning leaves no partial marker', () => {
    const d = dir({
      'joern.txt': C_SECTION,
      'joern.txt.exit': '0\n',
      'joern-lane.json': lane([{ id: 'c', exit: 0, scanRan: true, results: 1 }]),
    });
    const c = _joernScanCounts(d);
    assert.equal(c.total, 1);
    assert.equal(c.coverageIncomplete, undefined, 'nothing was unread, so nothing is marked incomplete');
    assert.equal(c.coverage, undefined);
  });

  test('the section headers are not mistaken for findings', () => {
    const d = dir({ 'joern.txt': C_SECTION, 'joern.txt.exit': '0\n', 'joern-lane.json': lane([{ id: 'c', exit: 0, scanRan: true, results: 1 }]) });
    assert.equal(_joernScanCounts(d).total, 1);
  });

  test('a vintage artifact with no sidecar still reads the whole file', () => {
    const d = dir({ 'joern.txt': 'Result: 8.0 : gets(): a.c:3:main\nScanPass completed\n', 'joern.txt.exit': '0\n' });
    const c = _joernScanCounts(d);
    assert.equal(c.total, 1);
    assert.equal(c.high, 1);
  });

  // Falling back to the whole-file reading here would re-enable the very defect the record removes:
  // the C section's ScanPass would certify the Java frontend that died. Only ENOENT is absence.
  test('a sidecar that exists and cannot be read is a void, never a fallback', () => {
    for (const body of ['{not json', '{"tool":"something-else","languages":[]}', '{"tool":"joern-lane","languages":[]}']) {
      const d = dir({ 'joern.txt': C_SECTION, 'joern.txt.exit': '0\n', 'joern-lane.json': body });
      const c = _joernScanCounts(d);
      assert.equal(c.unparseable, true, `read as a fallback instead of a void: ${body}`);
      assert.equal(c.total, 0, 'a count published from an unreadable record is a number nobody witnessed');
    }
  });
});
