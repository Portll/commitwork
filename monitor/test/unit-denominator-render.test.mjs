// Renders a human-readable summary of commit coverage (monitor/denominator.mjs render).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../denominator.mjs';

test('complete with singular unit and count', () => {
  const r = render({ of: 'commit', count: 1, complete: true, population: 1, unit: 'repo' });
  assert.equal(r, "1 commit across all 1 repo");
});

test('complete with plural unit and count', () => {
  const r = render({ of: 'commit', count: 2, complete: true, population: 2, unit: 'repo' });
  assert.equal(r, "2 commits across all 2 repos");
});

test('incomplete with null population and zero count', () => {
  const r = render({ of: 'commit', count: 0, complete: false, population: null, unit: 'repo', observed: 5 });
  assert.equal(r, "no commit found in 5 repo(s) of an unknown population \u2014 this is silence over a partial population, NOT a population zero");
});

test('incomplete with null population and non-zero count', () => {
  const r = render({ of: 'commit', count: 3, complete: false, population: null, unit: 'repo', observed: 10 });
  assert.equal(r, "at least 3 commits in 10 repo(s) of an unknown population \u2014 a floor, not a total");
});

test('incomplete with defined population and zero count', () => {
  const r = render({ of: 'commit', count: 0, complete: false, population: 10, unit: 'repo', observed: 5, determinedCoverage: 0.5 });
  assert.equal(r, "no commit found in 5 of 10 repo(s) (50.0% determined) \u2014 this is silence over a partial population, NOT a population zero");
});

test('incomplete with defined population and non-zero count', () => {
  const r = render({ of: 'commit', count: 2, complete: false, population: 10, unit: 'repo', observed: 5, determinedCoverage: 0.5 });
  assert.equal(r, "at least 2 commits in 5 of 10 repo(s) (50.0% determined) \u2014 a floor, not a total");
});

test('incomplete with defined population and null determinedCoverage', () => {
  const r = render({ of: 'commit', count: 1, complete: false, population: 10, unit: 'repo', observed: 5, determinedCoverage: null });
  assert.equal(r, "at least 1 commit in 5 of 10 repo(s) \u2014 a floor, not a total");
});

test('incomplete with null population and undefined observed', () => {
  const r = render({ of: 'commit', count: 1, complete: false, population: null, unit: 'repo' });
  assert.equal(r, "at least 1 commit in an unstated number of repo(s) of an unknown population \u2014 a floor, not a total");
});
