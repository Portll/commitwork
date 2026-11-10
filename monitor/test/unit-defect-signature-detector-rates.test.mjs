// Per-detector positive repo rates over each lane's scanned repo population (monitor/defect-signature.mjs detectorRates).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectorRates } from '../defect-signature.mjs';

test('Calling with no arguments returns an empty population, no detectors and no unkeyed counts', () => {
  const r = detectorRates();
  assert.deepEqual(r, { population: {}, detectors: [], unkeyed: {} });
});

test('Object repos count distinct names per enabled lane and skip null, scannerless and non-object scanners', () => {
  const repos = {
    a: null,
    b: { name: 'b' },
    c: { name: 'c', scanners: 'yes' },
    d: { name: 'd', scanners: { lint: true, deps: false } },
    e: { name: 'e', scanners: { lint: 1, sec: true } },
    f: { scanners: { sec: true } },
  };
  const r = detectorRates({ repos, scannerFindings: {} }, { schemas: {} });
  assert.deepEqual(r, { population: { lint: 2, sec: 2 }, detectors: [], unkeyed: {} });
});

test('Array repos with the same name twice are counted once and a null entry is skipped', () => {
  const repos = [
    null,
    { name: 'a', scanners: { lint: true } },
    { name: 'a', scanners: { lint: true } },
    { name: 'b', scanners: { lint: true } },
  ];
  const r = detectorRates({ repos }, { schemas: {} });
  assert.deepEqual(r, { population: { lint: 2 }, detectors: [], unkeyed: {} });
});

test('Rows without any identity value are counted as unkeyed per lane and add nothing to population', () => {
  const scannerFindings = {
    sec: [{ repo: 'a', rule: '' }, { repo: 'b', rule: null }],
    lint: [{ repo: 'a' }],
    deps: null,
  };
  const r = detectorRates({ repos: [], scannerFindings }, { schemas: {} });
  assert.deepEqual(r, { population: {}, detectors: [], unkeyed: { lint: 1, sec: 2 } });
});

test('Keyed rows count distinct positive repos and add their repos to the lane population', () => {
  const repos = [{ name: 'c', scanners: { lint: true } }, { name: 'd', scanners: { lint: true } }];
  const scannerFindings = {
    lint: [
      null,
      { rule: 'r1', repo: 'a' },
      { rule: 'r1', repo: 'a' },
      { rule: 'r1', repo: 'b' },
      { rule: 'r2', repo: 'b' },
    ],
  };
  const r = detectorRates({ repos, scannerFindings }, { schemas: {} });
  assert.deepEqual(r, {
    population: { lint: 4 },
    detectors: [
      { detector: 'lint/r1', lane: 'lint', id: 'r1', population: 4, positives: 2, rate: 0.5 },
      { detector: 'lint/r2', lane: 'lint', id: 'r2', population: 4, positives: 1, rate: 0.25 },
    ],
    unkeyed: {},
  });
});

test('Detectors use the schema identity field first, fall back otherwise, and are sorted by detector string', () => {
  const scannerFindings = {
    sec: [{ code: 'z9', rule: 'ignored', repo: 'a' }, { rule: 'm', repo: 'a' }],
    lint: [{ id: 7, repo: 'b' }, { rule: 0, repo: 'b' }],
  };
  const schemas = { sec: { identity: ['code', 'x'] } };
  const r = detectorRates({ repos: [], scannerFindings }, { schemas });
  assert.deepEqual(r, {
    population: { lint: 1, sec: 1 },
    detectors: [
      { detector: 'lint/0', lane: 'lint', id: '0', population: 1, positives: 1, rate: 1 },
      { detector: 'lint/7', lane: 'lint', id: '7', population: 1, positives: 1, rate: 1 },
      { detector: 'sec/m', lane: 'sec', id: 'm', population: 1, positives: 1, rate: 1 },
      { detector: 'sec/z9', lane: 'sec', id: 'z9', population: 1, positives: 1, rate: 1 },
    ],
    unkeyed: {},
  });
});

test('Rows with a null or missing repo count as the empty repo name and rates round to four decimals', () => {
  const repos = [{ name: 'y', scanners: { lint: true } }];
  const scannerFindings = {
    lint: [{ rule: 'r', repo: null }, { rule: 'q' }, { rule: 'q', repo: 'x' }],
  };
  const r = detectorRates({ repos, scannerFindings }, { schemas: {} });
  assert.deepEqual(r, {
    population: { lint: 3 },
    detectors: [
      { detector: 'lint/q', lane: 'lint', id: 'q', population: 3, positives: 2, rate: 0.6667 },
      { detector: 'lint/r', lane: 'lint', id: 'r', population: 3, positives: 1, rate: 0.3333 },
    ],
    unkeyed: {},
  });
});

test('Findings with no repos argument still build the population from the finding rows', () => {
  const scannerFindings = { lint: [{ rule: 'a', repo: 'p' }, { rule: 'a', repo: 'q' }] };
  const r = detectorRates({ scannerFindings }, { schemas: {} });
  assert.deepEqual(r, {
    population: { lint: 2 },
    detectors: [{ detector: 'lint/a', lane: 'lint', id: 'a', population: 2, positives: 2, rate: 1 }],
    unkeyed: {},
  });
});
