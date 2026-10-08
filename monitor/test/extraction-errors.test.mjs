// A file CodeQL could not parse is a coverage fact about that file, never a verdict about the run.
// Both measured shapes are here: javascript locates the file in the notification, go names it only
// in the message text. The negative controls are the point — this reader's job is to keep a failed
// run a void, and loosening it is the false-clean direction.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { laneCoverage } from '../../bin/commitwork.mjs';
import { readSarif } from '../sarif-read.mjs';
import { codeqlCoverage, coverageLicensesAZero } from '../codeql-coverage.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-extract-'));
let n = 0;
const write = (doc) => {
  const p = join(T, `s${n++}.sarif`);
  writeFileSync(p, JSON.stringify(doc));
  return p;
};

const located = (uri, line) => ({
  level: 'error',
  descriptor: { id: 'js/diagnostics/extraction-errors' },
  message: { text: `Extraction failed in /abs/${uri} with error Error: Unexpected token` },
  locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: line } } }],
});
const messageOnly = (uri) => ({
  level: 'error',
  descriptor: { id: 'go/diagnostics/extraction-errors' },
  message: { text: `Extraction failed in ${uri} with error expected ')', found '{'` },
});
const success = (uri, lang = 'js') => ({ level: 'none', descriptor: { id: `${lang}/diagnostics/successfully-extracted-files` }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });
const expected = (uri, lang = 'js') => ({ level: 'none', descriptor: { id: `${lang}/baseline/expected-extracted-files` }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });
const doc = (notifications, results = []) => ({ runs: [{ tool: { driver: { name: 'CodeQL' } }, results, invocations: [{ executionSuccessful: true, toolExecutionNotifications: notifications }] }] });

describe('per-file extraction failures', () => {
  test('a located failure beside other extracted files reads ok, and names the file', () => {
    const r = readSarif(write(doc([located('src/broken.mjs', 179), success('src/broken.mjs'), success('src/fine.mjs')])));
    assert.equal(r.state, 'ok', 'the rest of the tree was read — this is not a failed run');
    assert.deepEqual(r.extractionErrors, [{ uri: 'src/broken.mjs', line: 179, error: 'Error: Unexpected token' }]);
  });

  test('a message-only failure (the go shape) is read the same way', () => {
    const r = readSarif(write(doc([messageOnly('pkg/bad/bad.go'), success('pkg/bad/bad.go', 'go'), success('pkg/ok/ok.go', 'go')])));
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.extractionErrors.map((e) => e.uri), ['pkg/bad/bad.go']);
  });

  test('EVERY file failing is still a void — nothing was read', () => {
    const r = readSarif(write(doc([located('a.mjs', 1), located('b.mjs', 2), success('a.mjs'), success('b.mjs')])));
    assert.equal(r.state, 'tool-failed');
  });

  test('a run-level error alongside per-file ones keeps the void', () => {
    const r = readSarif(write(doc([located('a.mjs', 1), success('a.mjs'), success('b.mjs'),
      { level: 'error', descriptor: { id: 'cli/something-else' }, message: { text: 'the database could not be finalised' } }])));
    assert.equal(r.state, 'tool-failed');
  });

  test('executionSuccessful false keeps the void however the errors are shaped', () => {
    const d = doc([located('a.mjs', 1), success('a.mjs'), success('b.mjs')]);
    d.runs[0].invocations[0].executionSuccessful = false;
    assert.equal(readSarif(write(d)).state, 'tool-failed');
  });

  test('an extraction-error id this reader has never measured is not treated as per-file', () => {
    const odd = { level: 'error', descriptor: { id: 'xx/diagnostics/failed-extraction' }, message: { text: 'Extraction failed in a.xx with error boom' } };
    assert.equal(readSarif(write(doc([odd, success('a.xx'), success('b.xx')]))).state, 'tool-failed');
  });

  test('a clean run carries an empty extractionErrors, not undefined', () => {
    assert.deepEqual(readSarif(write(doc([success('a.mjs')]))).extractionErrors, []);
  });
});

describe('coverage subtracts what did not parse', () => {
  const exts = ['.mjs'];
  // CodeQL lists every file it attempted, the two failures included, so the success list and the
  // baseline are the same 10 files: the naive ratio is 1.00 and the corrected one is 0.80.
  const FILES = ['src/broken.mjs', 'src/other.mjs', ...Array.from({ length: 8 }, (_, i) => `src/f${i}.mjs`)];
  const sarif = () => doc([
    located('src/broken.mjs', 179), located('src/other.mjs', 3),
    ...FILES.map((f) => success(f)), ...FILES.map((f) => expected(f)),
  ]);

  test('a failed file is not counted as extracted, and the state follows the corrected ratio', () => {
    const v = codeqlCoverage(sarif(), exts);
    assert.equal(v.extracted, 8, 'broken.mjs and other.mjs are in the success list and must not be counted');
    assert.equal(v.expected, 10);
    assert.equal(v.state, 'partial');
    assert.equal(coverageLicensesAZero(v), false, 'a zero from a partial extraction is undetermined, never clean');
    assert.deepEqual(v.failed, ['src/broken.mjs', 'src/other.mjs']);
    assert.match(v.reason, /failed to parse: src\/broken\.mjs, src\/other\.mjs/);
  });

  test('without the subtraction the same document reads as fully covered, and licenses its zero', () => {
    const asIfListed = codeqlCoverage(doc([...FILES.map((f) => success(f)), ...FILES.map((f) => expected(f))]), exts);
    assert.equal(asIfListed.state, 'covered');
    assert.equal(coverageLicensesAZero(asIfListed), true, 'the guard is only meaningful because this reading passes');
  });

  test('a covered run still names any file that failed', () => {
    const many = doc([
      located('src/broken.mjs', 1), success('src/broken.mjs'),
      ...Array.from({ length: 20 }, (_, i) => success(`src/f${i}.mjs`)),
      expected('src/broken.mjs'), ...Array.from({ length: 20 }, (_, i) => expected(`src/f${i}.mjs`)),
    ]);
    const v = codeqlCoverage(many, exts);
    assert.equal(v.state, 'covered');
    assert.deepEqual(v.failed, ['src/broken.mjs']);
    assert.match(v.reason, /failed to parse/);
  });
});

describe('an ambiguous path match never voids a scan and never subtracts the wrong file', () => {
  const abs = '/abs/repo/cmd/tool/main.go';
  const goFiles = ['main.go', 'cmd/tool/main.go', 'a.go', 'b.go'];
  const goDoc = (files) => doc([messageOnly(abs), ...files.map((f) => success(f, 'go')), ...files.map((f) => expected(f, 'go'))]);

  test('a healthy root main.go beside a failed cmd/tool/main.go keeps the run ok', () => {
    const r = readSarif(write(doc([messageOnly(abs), success('main.go', 'go'), success('cmd/tool/main.go', 'go')])));
    assert.equal(r.state, 'ok', 'both uris suffix-match the absolute path: ambiguous, so nothing is subtracted and nothing voids');
    assert.deepEqual(r.extractionErrors.map((e) => e.uri), [abs]);
  });

  test('renaming the healthy file does not change the verdict', () => {
    const r = readSarif(write(doc([messageOnly(abs), success('server.go', 'go'), success('cmd/tool/main.go', 'go')])));
    assert.equal(r.state, 'ok');
  });

  test('a unique suffix match is still identity: the only file extracted, and it failed, is a void', () => {
    assert.equal(readSarif(write(doc([messageOnly(abs), success('cmd/tool/main.go', 'go')]))).state, 'tool-failed');
  });

  test('coverage does not subtract the healthy root main.go for an ambiguous failure', () => {
    const v = codeqlCoverage(goDoc(goFiles), ['.go']);
    assert.ok(v.extracted >= 3, `healthy main.go must not be subtracted wrongly (got ${v.extracted} of ${v.expected})`);
    assert.equal(v.expected, 4);
    assert.deepEqual(v.failed, [abs]);
    assert.equal(coverageLicensesAZero(v), false);
  });

  test('a unique suffix match is subtracted: 3 of 4', () => {
    const v = codeqlCoverage(goDoc(['cmd/tool/main.go', 'a.go', 'b.go', 'c.go']), ['.go']);
    assert.equal(v.extracted, 3);
    assert.equal(v.expected, 4);
    assert.equal(v.extractedIsCeiling, undefined, 'nothing was ambiguous, so the count is a measurement');
  });

  // Not subtracting is the safe resolution, and it leaves a file that was not read inside the
  // count. A number that cannot be checked must say so rather than read as measured.
  test('an ambiguous failure makes the extracted count a declared ceiling', () => {
    const v = codeqlCoverage(goDoc(goFiles), ['.go']);
    assert.equal(v.extractedIsCeiling, true);
    assert.deepEqual(v.ambiguous, [abs]);
    assert.match(v.reason, /at most/);
    assert.match(v.reason, /still counted here/);
  });
});

describe('an extraction failure does not license a zero', () => {
  test('a ratio above the floor with a parse failure is not a clean zero', () => {
    const many = doc([
      located('src/broken.mjs', 1), success('src/broken.mjs'),
      ...Array.from({ length: 30 }, (_, i) => success(`src/f${i}.mjs`)),
      expected('src/broken.mjs'), ...Array.from({ length: 30 }, (_, i) => expected(`src/f${i}.mjs`)),
    ]);
    const v = codeqlCoverage(many, ['.mjs']);
    assert.ok(v.ratio >= 0.9, 'the ratio alone would have cleared the floor');
    assert.deepEqual(v.failed, ['src/broken.mjs']);
    assert.equal(coverageLicensesAZero(v), false);
  });
});

describe('laneCoverage reports the extraction failure and a declared signal together', () => {
  test('both reasons survive', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-extract-lc-'));
    writeFileSync(join(d, 'cq.sarif'), JSON.stringify(doc([located('src/broken.mjs', 4), success('src/broken.mjs'), success('src/ok.mjs')])));
    writeFileSync(join(d, 'cq.log'), 'Skipping call analysis on Go code\n');
    const check = { id: 'x', report: { file: 'cq.sarif', format: 'sarif', log: 'cq.log' },
      coverageSignals: [{ pattern: 'Skipping call analysis on Go code', lane: 'Go call analysis' }] };
    const r = laneCoverage(check, d);
    assert.equal(r.coverage, 'reduced');
    assert.match(r.coverageReason, /failed extraction.*src\/broken\.mjs/);
    assert.match(r.coverageReason, /Go call analysis did not run/);
  });
});

// The runner's row and the monitor's reader must answer the same question the same way. Measured
// 2026-10-04 on a 1,818-file Go repository: CodeQL's log said it scanned 1,441, codeql-coverage
// derived 79% and withheld the zero-licence, and the lane's row said `pass, coverage full`. The
// gap was silent because nothing errored — those files were simply never extracted.
describe('the runner reports the unread remainder, not only the files that errored', () => {
  const T2 = mkdtempSync(join(tmpdir(), 'cw-lanecov-'));
  const CHECK = { id: 'sast-codeql-go', report: { file: 'codeql-go.sarif', format: 'sarif' } };
  const dirWith = (notifications) => {
    const d = mkdtempSync(join(T2, 'r'));
    writeFileSync(join(d, 'codeql-go.sarif'), JSON.stringify(doc(notifications)));
    writeFileSync(join(d, 'codeql-go.sarif.exit'), '0\n');
    return d;
  };
  const okGo = (uri) => ({ level: 'none', descriptor: { id: 'go/diagnostics/successfully-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });
  const expGo = (uri) => ({ level: 'none', descriptor: { id: 'go/baseline/expected-extracted-files' }, locations: [{ physicalLocation: { artifactLocation: { uri } } }] });

  test('a silent shortfall with zero extraction errors is still reduced coverage', () => {
    const files = Array.from({ length: 10 }, (_, i) => `pkg/f${i}.go`);
    const v = laneCoverage(CHECK, dirWith([...files.map(expGo), ...files.slice(0, 7).map(okGo)]));
    assert.equal(v.coverage, 'reduced', 'three files were never extracted and nothing errored');
    assert.match(v.coverageReason, /7 of 10/);
    assert.equal(v.coverageBasis, 'per-file');
  });

  test('a run that extracted everything keeps full coverage', () => {
    const files = Array.from({ length: 10 }, (_, i) => `pkg/f${i}.go`);
    const v = laneCoverage(CHECK, dirWith([...files.map(expGo), ...files.map(okGo)]));
    assert.equal(v.coverage, 'full', 'a complete extraction must not be reported as a gap');
  });

  test('both facts ride together when files errored AND others went unread', () => {
    const files = Array.from({ length: 10 }, (_, i) => `pkg/f${i}.go`);
    const v = laneCoverage(CHECK, dirWith([
      ...files.map(expGo), ...files.slice(0, 7).map(okGo), messageOnly('pkg/f0.go'),
    ]));
    assert.equal(v.coverage, 'reduced');
    assert.match(v.coverageReason, /failed extraction/);
    assert.match(v.coverageReason, /of 10/);
  });
});
