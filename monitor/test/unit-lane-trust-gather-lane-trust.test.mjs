// The lane-trust report and its registry, gathered from on-disk records (monitor/lane-trust.mjs gatherLaneTrust).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherLaneTrust } from '../lane-trust.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withFixtures = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'gatherLaneTrust-'));
  const saved = process.env.CW_LANE_FIXTURES;
  process.env.CW_LANE_FIXTURES = dir;
  try {
    return fn(dir);
  } finally {
    if (saved === undefined) delete process.env.CW_LANE_FIXTURES;
    else process.env.CW_LANE_FIXTURES = saved;
    rmSync(dir, { recursive: true, force: true });
  }
};

const captureOutput = (fn) => {
  const written = [];
  const record = (...args) => {
    written.push(args.map(String).join(' '));
    return true;
  };
  const targets = [
    [console, 'log'], [console, 'info'], [console, 'warn'], [console, 'error'], [console, 'debug'],
    [process.stdout, 'write'], [process.stderr, 'write'], [process, 'emitWarning'],
  ];
  const originals = targets.map(([owner, key]) => owner[key]);
  targets.forEach(([owner, key]) => { owner[key] = record; });
  try {
    fn();
  } finally {
    targets.forEach(([owner, key], i) => { owner[key] = originals[i]; });
  }
  return written;
};

const gather = () => {
  let r;
  assert.deepEqual(captureOutput(() => { r = gatherLaneTrust(); }), []);
  return r;
};

const laneNames = () => Object.keys(gather().result.lanes);

const addFixture = (dir, lane, name) => {
  mkdirSync(join(dir, lane), { recursive: true });
  writeFileSync(join(dir, lane, name), 'x');
};

const writeProvenance = (dir, value) => writeFileSync(join(dir, 'PROVENANCE.json'), JSON.stringify(value));

test('gathering the report prints nothing because the registry loads quietly', () => {
  withFixtures(() => {
    assert.deepEqual(captureOutput(() => gatherLaneTrust()), []);
  });
});

test('the registry is returned beside a report carrying every fixed summary and input field', () => {
  withFixtures(() => {
    const r = gather();
    assert.deepEqual(Object.keys(r), ['reg', 'result']);
    assert.deepEqual(Object.keys(r.result.summary), ['lanes', 'checks', 'fixtureSource', 'canary', 'undetermined', 'band', 'positiveControl', 'defectSignature']);
    assert.deepEqual(Object.keys(r.result.inputs), ['provenance', 'canary', 'fleet', 'manifests', 'positiveControls', 'defectSignatures']);
  });
});

test('an empty fixture root reads as absent provenance and leaves every lane without a fixture', () => {
  withFixtures(() => {
    const { result } = gather();
    const names = Object.keys(result.lanes);
    assert.equal(result.inputs.provenance, 'absent');
    assert.equal(names.length, result.summary.lanes);
    assert.deepEqual(result.summary.fixtureSource, { 'no-fixture': result.summary.lanes });
    assert.deepEqual(result.lanes[names[0]].fixture, { source: 'no-fixture' });
  });
});

test('a directory of dotfiles is no fixture while a visible file is an unrecorded one', () => {
  withFixtures((dir) => {
    const [first, second] = laneNames();
    writeProvenance(dir, {});
    addFixture(dir, first, '.keep');
    addFixture(dir, second, 'sample.txt');
    const { result } = gather();
    assert.equal(result.inputs.provenance, 'read');
    assert.deepEqual(result.lanes[first].fixture, { source: 'no-fixture' });
    assert.deepEqual(result.lanes[second].fixture, { source: 'unrecorded', why: 'fixture predates provenance records' });
    assert.deepEqual(result.summary.fixtureSource, { 'no-fixture': result.summary.lanes - 1, unrecorded: 1 });
  });
});

test('a fixture with no PROVENANCE.json is unrecorded and says the file is absent', () => {
  withFixtures((dir) => {
    const [first] = laneNames();
    addFixture(dir, first, 'sample.txt');
    const { result } = gather();
    assert.equal(result.inputs.provenance, 'absent');
    assert.deepEqual(result.lanes[first].fixture, { source: 'unrecorded', why: 'PROVENANCE.json is absent' });
  });
});

test('a record with an unknown or missing source stays unrecorded and echoes what it recorded', () => {
  withFixtures((dir) => {
    const [first, second] = laneNames();
    writeProvenance(dir, { lanes: { [first]: { source: 'bogus' }, [second]: { check: 'c1' } } });
    addFixture(dir, first, 'sample.txt');
    addFixture(dir, second, 'sample.txt');
    const { lanes } = gather().result;
    const why = 'provenance names no recognised source';
    assert.deepEqual(lanes[first].fixture, { source: 'unrecorded', recorded: 'bogus', why });
    assert.deepEqual(lanes[second].fixture, { source: 'unrecorded', recorded: null, why });
  });
});

test('a synthetic record keeps its check and acceptance and reports its reason or null', () => {
  withFixtures((dir) => {
    const [first, second] = laneNames();
    const full = { source: 'synthetic', check: 'c1', accepted: '2026-01-02', why: 'hand built' };
    writeProvenance(dir, { lanes: { [first]: full, [second]: { source: 'synthetic' } } });
    addFixture(dir, first, 'sample.txt');
    addFixture(dir, second, 'sample.txt');
    const { lanes } = gather().result;
    assert.deepEqual(lanes[first].fixture, { source: 'synthetic', check: 'c1', accepted: '2026-01-02', reason: 'hand built' });
    assert.deepEqual(lanes[second].fixture, { source: 'synthetic', reason: null });
  });
});

test('an unreadable PROVENANCE.json surfaces its error instead of counting as absent', () => {
  withFixtures((dir) => {
    let message;
    try { JSON.parse('{'); } catch (e) { message = e.message; }
    writeFileSync(join(dir, 'PROVENANCE.json'), '{');
    assert.throws(() => gatherLaneTrust(), { name: 'SyntaxError', message });
    writeFileSync(join(dir, 'PROVENANCE.json'), 'null');
    assert.throws(() => gatherLaneTrust(), { name: 'TypeError', message: "Cannot read properties of null (reading 'lanes')" });
  });
});

test('a plain file at a lane fixture path throws the directory read error', () => {
  withFixtures((dir) => {
    const [first] = laneNames();
    const path = join(dir, first);
    writeFileSync(path, 'x');
    assert.throws(() => gatherLaneTrust(), { name: 'Error', message: `ENOTDIR: not a directory, scandir '${path}'` });
  });
});
