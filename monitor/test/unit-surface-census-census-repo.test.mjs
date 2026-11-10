// Per-language surface coverage rows joining file enumeration with security-lane results (monitor/surface-census.mjs censusRepo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { censusRepo } from '../surface-census.mjs';

const any = (value) => new Proxy({}, { get: () => value });
const strip = (rows) => rows.map(({ lanes, ...row }) => ({ ...row, lanes: lanes.map(({ category, ...lane }) => lane) }));
const counting = any({ witness: 'counting' });
const D = '\u2014';

test('a single counting lane that read every file covers the language as a single witness', () => {
  const scanners = any({ ran: true, coverage: { state: 'full', ratio: 1 } });
  const result = censusRepo({ php: { files: 1, bytes: 10 } }, { php: 1 }, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 1, bytes: 10, gitFiles: 1, enumeration: 'agree', state: 'covered',
    readRatios: [{ check: 'sast', ratio: 1, coverageState: 'full' }],
    lanes: [{ check: 'sast', capability: 'counting', ran: true, coverage: { state: 'full', ratio: 1 } }],
    witnessCount: 1, witnessMeasured: 1, singleWitness: true,
  }]);
});

test('without git the row is walk-only and a no-language claim over zero walked files is no dispute', () => {
  const scanners = any({ ran: true, coverage: { state: 'no-language', ratio: 0 } });
  const result = censusRepo({ php: { files: 0, bytes: 0 } }, null, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 0, bytes: 0, gitFiles: null, enumeration: 'walk-only', state: 'covered',
    readRatios: [{ check: 'sast', ratio: 0, coverageState: 'no-language' }],
    lanes: [{ check: 'sast', capability: 'counting', ran: true, coverage: { state: 'no-language', ratio: 0 } }],
    witnessCount: 1, witnessMeasured: 1, singleWitness: true,
  }]);
});

test('a language only git sees is disputed and its covered state is downgraded to grey-unread', () => {
  const scanners = any({ ran: true, coverage: { state: 'full', ratio: 1 } });
  const result = censusRepo({}, { php: 2 }, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 0, bytes: 0, gitFiles: 2, enumeration: 'disputed', state: 'grey-unread',
    note: `enumerators dispute: walk sees 0 file(s), git ls-files sees 2 ${D} coverage cannot be claimed over a surface the enumerators cannot agree exists`,
    readRatios: [{ check: 'sast', ratio: 1, coverageState: 'full' }],
    lanes: [{ check: 'sast', capability: 'counting', ran: true, coverage: { state: 'full', ratio: 1 } }],
    witnessCount: 1, witnessMeasured: 1,
  }]);
});

test('a repo with no rollup is grey-unscanned and counts no witnesses', () => {
  const result = censusRepo({ php: { files: 3, bytes: 30 } }, { php: 3 }, null, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 3, bytes: 30, gitFiles: 3, enumeration: 'agree', state: 'grey-unscanned',
    note: `no rollup for this repo ${D} no lane has ever been recorded running here`,
    lanes: [{ check: 'sast', capability: 'counting', ran: false, coverage: null }],
    witnessCount: 0, witnessMeasured: 0,
  }]);
});

test('a lane recorded with ran zero did not run and its coverage is dropped', () => {
  const scanners = any({ ran: 0, coverage: { state: 'partial', ratio: 0.5 } });
  const result = censusRepo({ php: { files: 2, bytes: 20 } }, { php: 2 }, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 2, bytes: 20, gitFiles: 2, enumeration: 'agree', state: 'grey-unscanned',
    note: 'capable lanes exist and none ran',
    lanes: [{ check: 'sast', capability: 'counting', ran: false, coverage: null }],
    witnessCount: 0, witnessMeasured: 0,
  }]);
});

test('a lane that ran but was measured shape-only leaves the language grey-shape-only', () => {
  const scanners = any({ ran: 2, coverage: { state: 'full', ratio: 1 } });
  const result = censusRepo({ php: { files: 4, bytes: 40 } }, { php: 4 }, scanners, any({ witness: 'shape-only' }));
  assert.deepEqual(strip(result), [{
    language: 'php', files: 4, bytes: 40, gitFiles: 4, enumeration: 'agree', state: 'grey-shape-only',
    note: `every capable lane that ran was MEASURED unable to count (shape-only extractor) ${D} presence was attested, coverage was not`,
    readRatios: [{ check: 'sast', ratio: 1, coverageState: 'full' }],
    lanes: [{ check: 'sast', capability: 'shape-only', ran: true, coverage: { state: 'full', ratio: 1 } }],
    witnessCount: 0, witnessMeasured: 0,
  }]);
});

test('a partial read ratio makes the language grey-unread with the rounded percentage', () => {
  const scanners = any({ ran: true, coverage: { state: 'partial', ratio: 0.375 } });
  const result = censusRepo({ php: { files: 5, bytes: 50 } }, { php: 5 }, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 5, bytes: 50, gitFiles: 5, enumeration: 'agree', state: 'grey-unread',
    note: 'read-ratio below floor: sast 38%',
    readRatios: [{ check: 'sast', ratio: 0.375, coverageState: 'partial' }],
    lanes: [{ check: 'sast', capability: 'counting', ran: true, coverage: { state: 'partial', ratio: 0.375 } }],
    witnessCount: 1, witnessMeasured: 1,
  }]);
});

test('declared-void languages stay void-declared even when disputed and unknown languages are skipped', () => {
  const walk = { haskell: { files: 2, bytes: 20 }, cobol: { files: 1, bytes: 5 } };
  const result = censusRepo(walk, { dart: 1, haskell: 0 }, {}, {});
  assert.deepEqual(strip(result), [
    {
      language: 'dart', files: 0, bytes: 0, gitFiles: 1, enumeration: 'disputed', state: 'void-declared',
      note: 'no security lane of any kind reads Dart source.', lanes: [], witnessCount: 0, witnessMeasured: 0,
    },
    {
      language: 'haskell', files: 2, bytes: 20, gitFiles: 0, enumeration: 'disputed', state: 'void-declared',
      note: 'no security lane reads Haskell source: no CodeQL pack exists, hlint is a style linter.',
      lanes: [], witnessCount: 0, witnessMeasured: 0,
    },
  ]);
});

test('a no-language claim while the walk sees one file is a witness dispute', () => {
  const scanners = any({ ran: true, coverage: { state: 'no-language' } });
  const result = censusRepo({ php: { files: 1, bytes: 7 } }, { php: 1 }, scanners, counting);
  assert.deepEqual(strip(result), [{
    language: 'php', files: 1, bytes: 7, gitFiles: 1, enumeration: 'agree', state: 'grey-unread',
    note: `the lane's SARIF claims no php files while the walk sees 1 ${D} the witnesses dispute`,
    lanes: [{ check: 'sast', capability: 'counting', ran: true, coverage: { state: 'no-language' } }],
    witnessCount: 1, witnessMeasured: 1,
  }]);
});

test('an unmeasured lane that ran without coverage is voiced but not a measured witness', () => {
  const result = censusRepo({ php: { files: 1, bytes: 1 } }, null, any({ ran: true }), {});
  assert.deepEqual(strip(result), [{
    language: 'php', files: 1, bytes: 1, gitFiles: null, enumeration: 'walk-only', state: 'covered',
    lanes: [{ check: 'sast', capability: 'no-fixture', ran: true, coverage: null }],
    witnessCount: 1, witnessMeasured: 0, singleWitness: true,
  }]);
});
