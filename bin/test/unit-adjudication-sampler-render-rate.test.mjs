// Renders a rate object as a human-readable line with CI, population, and flags (bin/adjudication-sampler.mjs renderRate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRate } from '../adjudication-sampler.mjs';

test('returns REFUSED message when impossible is true', () => {
  const r = { impossible: true, basis: 'test-basis' };
  assert.equal(renderRate(r, 'my-label'), 'my-label: REFUSED \u2014 the counts given cannot be a rate (test-basis); this is a data-integrity fault, not an empty stratum');
});

test('returns undefined message when r is null', () => {
  assert.equal(renderRate(null, 'lbl'), 'lbl: undefined (no observable records)');
});

test('returns undefined message when observable is false with basis', () => {
  const r = { observable: false, basis: 'my-basis' };
  assert.equal(renderRate(r, 'lbl'), 'lbl: undefined (my-basis)');
});

test('returns undefined message when observable is false without basis', () => {
  const r = { observable: false };
  assert.equal(renderRate(r, 'lbl'), 'lbl: undefined (no observable records)');
});

test('renders full line with CI, composition, and uninformative flag', () => {
  const r = {
    observable: true,
    value: 0.5,
    k: 1,
    n: 2,
    ci95: [0.05, 0.95],
    uninformative: true,
    composition: { total: 10, label: 'clean 5/10, alarm 5/10' },
    basis: 'stratum-basis',
  };
  assert.equal(renderRate(r, 'lbl'), 'lbl: 50.0% (1/2) [5.0%, 95.0%] \u00b7 population: clean 5/10, alarm 5/10 \u00b7 uninformative \u2014 stratum-basis');
});

test('renders without uninformative flag when false', () => {
  const r = {
    observable: true,
    value: 0.5,
    k: 1,
    n: 2,
    ci95: [0.4, 0.6],
    uninformative: false,
    composition: { total: 10, label: 'clean 5/10' },
    basis: 'b',
  };
  assert.equal(renderRate(r, 'lbl'), 'lbl: 50.0% (1/2) [40.0%, 60.0%] \u00b7 population: clean 5/10 \u2014 b');
});

test('renders NOT SUPPLIED composition when composition is null', () => {
  const r = {
    observable: true,
    value: 0.5,
    k: 1,
    n: 2,
    ci95: [0.4, 0.6],
    uninformative: false,
    composition: null,
    basis: 'b',
  };
  assert.equal(renderRate(r, 'lbl'), 'lbl: 50.0% (1/2) [40.0%, 60.0%] \u00b7 population composition NOT SUPPLIED, so whether this interval is tight because the evidence is good or because one stratum swallowed the records cannot be told apart \u2014 b');
});

test('renders NOT SUPPLIED composition when composition total is 0', () => {
  const r = {
    observable: true,
    value: 0.5,
    k: 1,
    n: 2,
    ci95: [0.4, 0.6],
    uninformative: false,
    composition: { total: 0, label: 'no records' },
    basis: 'b',
  };
  assert.equal(renderRate(r, 'lbl'), 'lbl: 50.0% (1/2) [40.0%, 60.0%] \u00b7 population composition NOT SUPPLIED, so whether this interval is tight because the evidence is good or because one stratum swallowed the records cannot be told apart \u2014 b');
});

test('renders without CI when ci95 is null', () => {
  const r = {
    observable: true,
    value: 0.5,
    k: 1,
    n: 2,
    ci95: null,
    uninformative: true,
    composition: { total: 5, label: 'clean 5/5' },
    basis: 'b',
  };
  assert.equal(renderRate(r, 'lbl'), 'lbl: 50.0% (1/2) \u00b7 population: clean 5/5 \u00b7 uninformative \u2014 b');
});
