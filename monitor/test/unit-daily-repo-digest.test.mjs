// repoDigest computes a digest of current and previous scan results per repository (monitor/daily.mjs repoDigest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoDigest, itemId, kindOf, severityOf, pathClassOf, SECRET_CATEGORIES } from '../daily.mjs';

const makeGroup = (overrides = {}) => {
  const category = overrides.category || 'lint';
  const rule = overrides.rule || 'rule1';
  const file = overrides.file || 'src/a.js';
  const id = overrides.id || itemId('repo', category, rule, file);
  return {
    id,
    category,
    rule,
    file,
    lines: overrides.lines || [1],
    rows: overrides.rows || [{ message: 'msg', sev: 'low' }],
    ...overrides,
  };
};

const makeLane = (state = 'ran', toolVersion = '1.0', note) => {
  const lane = { state, toolVersion };
  if (note) lane.note = note;
  return lane;
};

test('repoDigest returns empty result when cur and prev are empty', () => {
  const input = {
    repo: 'repo',
    cur: new Map(),
    prev: new Map(),
    lanes: new Map(),
    prevLanes: new Map(),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [] });
});

test('repoDigest marks new items for baseline scan with non-data path', () => {
  const g = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js' });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[g.id, g]]),
    prev: new Map(),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map(),
    baseline: true,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "376458e79f624e1b", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: null, context: null }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 1, toolVersion: "1.0", previousToolVersion: null, toolChanged: false }] });
});

test('repoDigest marks persisting items when not baseline and previous exists', () => {
  const g = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js' });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[g.id, g]]),
    prev: new Map([[g.id, g]]),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map([[lane, makeLane()]]),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 2,
    firstSeenOf: () => 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "376458e79f624e1b", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 1, message: "msg", state: "persisting", firstSeenBatch: 1, context: null }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 1, toolVersion: "1.0", previousToolVersion: "1.0", toolChanged: false }] });
});

test('repoDigest handles renamed files by matching previous group', () => {
  const oldFile = 'src/old.js';
  const newFile = 'src/new.js';
  const category = 'lint';
  const rule = 'rule1';
  const oldId = itemId('repo', category, rule, oldFile);
  const newId = itemId('repo', category, rule, newFile);
  const oldGroup = makeGroup({ id: oldId, file: oldFile });
  const newGroup = makeGroup({ id: newId, file: newFile });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[newId, newGroup]]),
    prev: new Map([[oldId, oldGroup]]),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map([[lane, makeLane()]]),
    baseline: false,
    dataPaths: [],
    renames: new Map([[newFile, oldFile]]),
    currentBatch: 2,
    firstSeenOf: () => 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "a4351ac1e4afbef6", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/new.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 1, message: "msg", state: "persisting", firstSeenBatch: 1, context: null, renamedFrom: "src/old.js" }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 1, toolVersion: "1.0", previousToolVersion: "1.0", toolChanged: false }] });
});

test('repoDigest skips data paths in baseline or non-new state', () => {
  const g = makeGroup({ category: 'secrets', rule: 'rule1', file: 'data/secrets.txt' });
  const lane = 'secrets';
  const input = {
    repo: 'repo',
    cur: new Map([[g.id, g]]),
    prev: new Map(),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map(),
    baseline: true,
    dataPaths: ['data/'],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [], omittedIds: [], fixed: [], carried: [], aggregates: [{ category: "secrets", rule: "rule1", count: 1, new: 1, fixed: 0, paths: ["data/"] }], lanes: [{ lane: "secrets", state: "ran", findings: 0, toolVersion: "1.0", previousToolVersion: null, toolChanged: false }] });
});

test('repoDigest adds context for non-redacted categories with lines and contextLines > 0', () => {
  const g = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js', lines: [10, 11] });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[g.id, g]]),
    prev: new Map(),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map(),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 3,
    readContext: (file, line, ctx) => `context for ${file}:${line}\u00b1${ctx}`,
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "376458e79f624e1b", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a.js", pathClass: "code", lines: [10, 11], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: "context for src/a.js:10\u00b13" }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 1, toolVersion: "1.0", previousToolVersion: null, toolChanged: false }] });
});

test('repoDigest computes fixed and carried items from previous run with laneOk ran true', () => {
  const g = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js' });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map(),
    prev: new Map([[g.id, g]]),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map([[lane, makeLane()]]),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 2,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [], omittedIds: [], fixed: [{ id: "376458e79f624e1b", rule: "rule1", file: "src/a.js" }], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 0, toolVersion: "1.0", previousToolVersion: "1.0", toolChanged: false }] });
});

test('repoDigest builds lane list with toolChanged and findings for non-skipped lanes', () => {
  const g = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js' });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[g.id, g]]),
    prev: new Map(),
    lanes: new Map([[lane, makeLane('ran', '2.0')]]),
    prevLanes: new Map([[lane, makeLane('ran', '1.0')]]),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "376458e79f624e1b", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 1, toolVersion: "2.0", previousToolVersion: "1.0", toolChanged: true }] });
});

test('repoDigest respects maxItems limit and omits excess items', () => {
  const groups = Array.from({ length: 5 }, (_, i) =>
    makeGroup({ category: 'lint', rule: `rule${i}`, file: `src/a${i}.js` })
  );
  const cur = new Map(groups.map(g => [g.id, g]));
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur,
    prev: new Map(),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map(),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 3,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "12789241695af917", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a1.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }, { id: "47d33821cfebed66", category: "lint", lane: "lint", kind: "security", rule: "rule0", severity: "low", severitySource: "row", file: "src/a0.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }, { id: "8259e674c024fe72", category: "lint", lane: "lint", kind: "security", rule: "rule4", severity: "low", severitySource: "row", file: "src/a4.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }], omittedIds: ["a08b7b5793f22f80", "d4061485bece45b4"], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 5, toolVersion: "1.0", previousToolVersion: null, toolChanged: false }] });
});

test('repoDigest aggregates counts for same category and rule', () => {
  const g1 = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/a.js' });
  const g2 = makeGroup({ category: 'lint', rule: 'rule1', file: 'src/b.js' });
  const lane = 'lint';
  const input = {
    repo: 'repo',
    cur: new Map([[g1.id, g1], [g2.id, g2]]),
    prev: new Map(),
    lanes: new Map([[lane, makeLane()]]),
    prevLanes: new Map(),
    baseline: false,
    dataPaths: [],
    renames: new Map(),
    currentBatch: 1,
    maxItems: 10,
    contextLines: 0,
    readContext: () => '',
  };
  const result = repoDigest(input);
  assert.deepEqual(result, { items: [{ id: "0e0d908fdc18e214", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/b.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }, { id: "376458e79f624e1b", category: "lint", lane: "lint", kind: "security", rule: "rule1", severity: "low", severitySource: "row", file: "src/a.js", pathClass: "code", lines: [1], occurrences: 1, previousOccurrences: 0, message: "msg", state: "new", firstSeenBatch: 1, context: null }], omittedIds: [], fixed: [], carried: [], aggregates: [], lanes: [{ lane: "lint", state: "ran", findings: 2, toolVersion: "1.0", previousToolVersion: null, toolChanged: false }] });
});
