// Renders a finding item to an untrusted artifact block (monitor/detection-reducer.mjs renderFinding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderFinding } from '../detection-reducer.mjs';

test('renders scanner and detector names when both are present', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd', finding: { rule: 'r' } });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified\nrule: r");
});

test('falls back to detector for scanner when artifact is missing', () => {
  const r = renderFinding({ detector: 'd', finding: { rule: 'r' } });
  assert.equal(r, "Scanner: d    Detector/rule: d    Reported severity: unspecified\nrule: r");
});

test('falls back to unknown for scanner when artifact and detector are missing', () => {
  const r = renderFinding({ finding: { rule: 'r' } });
  assert.equal(r, "Scanner: unknown    Detector/rule: r    Reported severity: unspecified\nrule: r");
});

test('falls back to finding rule for detector when detector is missing', () => {
  const r = renderFinding({ artifact: 'a', finding: { rule: 'r' } });
  assert.equal(r, "Scanner: a    Detector/rule: r    Reported severity: unspecified\nrule: r");
});

test('falls back to unknown for detector when detector and rule are missing', () => {
  const r = renderFinding({ artifact: 'a', finding: {} });
  assert.equal(r, "Scanner: a    Detector/rule: unknown    Reported severity: unspecified");
});

test('renders string finding values without JSON quoting', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd', finding: { msg: 'hello' } });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified\nmsg: hello");
});

test('renders non-string finding values with JSON quoting', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd', finding: { count: 42 } });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified\ncount: 42");
});

test('skips null finding values', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd', finding: { a: null, b: 'x' } });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified\nb: x");
});

test('skips undefined finding values', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd', finding: { a: undefined, b: 'x' } });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified\nb: x");
});

test('handles missing finding object by treating it as empty', () => {
  const r = renderFinding({ artifact: 'a', detector: 'd' });
  assert.equal(r, "Scanner: a    Detector/rule: d    Reported severity: unspecified");
});
