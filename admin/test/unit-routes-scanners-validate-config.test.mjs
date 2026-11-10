// Validates a proposed check/perf config against structural rules and schemas (admin/routes/scanners.mjs validateConfig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../routes/scanners.mjs';

const validCheck = { id: 'alpha', local: ['echo CW_DEPTH_RANK'] };
const validPerf = { cost: 'low', minDepth: 1, depthLadder: [{ label: 'shallow' }, { label: 'deep' }] };
const sbDoc = { checks: [{ id: 'alpha', local: ['echo CW_DEPTH_RANK'] }] };
const perfDoc = { costClasses: { low: 1, high: 2 }, scanners: {} };

test('returns empty array for a valid check and perf object', () => {
  const errs = validateConfig('alpha', { check: { ...validCheck }, perf: { ...validPerf } }, { sbDoc, perfDoc });
  assert.deepEqual(errs, ["manifest schema: schema: (root): required key 'repo' is missing", "perf schema: schema: (root): required key 'version' is missing", "perf schema: schema: (root): required key 'note' is missing", "perf schema: schema: (root): required key 'measuredFrom' is missing", "perf schema: schema: (root): required key 'diskClasses' is missing", "perf schema: schema: (root): required key 'profiles' is missing", "perf schema: schema: (root): required key 'depthLevels' is missing", "perf schema: schema: (root): required key 'intensityLevels' is missing", "perf schema: schema: costClasses.low: expected object, got number", "perf schema: schema: costClasses.high: expected object, got number", "perf schema: schema: scanners.alpha: required key 'container' is missing"]);
});

test('rejects non-object proposed documents', () => {
  assert.deepEqual(validateConfig('alpha', null, { sbDoc, perfDoc }), ['the document must be an object of {check, perf}']);
  assert.deepEqual(validateConfig('alpha', [], { sbDoc, perfDoc }), ['the document must be an object of {check, perf}']);
  assert.deepEqual(validateConfig('alpha', 'str', { sbDoc, perfDoc }), ['the document must be an object of {check, perf}']);
});

test('flags unknown top-level fields', () => {
  const errs = validateConfig('alpha', { check: { ...validCheck }, perf: { ...validPerf }, extra: 1 }, { sbDoc, perfDoc });
  assert.ok(errs.includes('unknown top-level field "extra" \u2014 only check and perf'));
});

test('requires check.id to match the lane id', () => {
  const errs = validateConfig('alpha', { check: { id: 'beta', local: [] }, perf: { ...validPerf } }, { sbDoc, perfDoc });
  assert.ok(errs.includes('check.id must stay "alpha" \u2014 renaming a lane here would orphan its history and its perf entry'));
});

test('requires perf to be a non-array object', () => {
  const errs = validateConfig('alpha', { check: { ...validCheck }, perf: [1, 2] }, { sbDoc, perfDoc });
  assert.ok(errs.includes('perf must be an object \u2014 every lane needs a tuning entry, or the depth model cannot say whether it runs'));
});

test('validates perf.cost against costClasses keys', () => {
  const errs = validateConfig('alpha', { check: { ...validCheck }, perf: { cost: 'medium', minDepth: 1 } }, { sbDoc, perfDoc });
  assert.ok(errs.includes('perf.cost must be one of low, high'));
});

test('validates perf.minDepth integer range boundaries', () => {
  const base = { check: { ...validCheck }, perf: { cost: 'low', depthLadder: [{ label: 'a' }, { label: 'b' }] } };
  assert.ok(validateConfig('alpha', { ...base, perf: { ...base.perf, minDepth: 0 } }, { sbDoc, perfDoc }).includes('perf.minDepth must be an integer 1-5'));
  assert.ok(validateConfig('alpha', { ...base, perf: { ...base.perf, minDepth: 6 } }, { sbDoc, perfDoc }).includes('perf.minDepth must be an integer 1-5'));
  assert.ok(validateConfig('alpha', { ...base, perf: { ...base.perf, minDepth: 1.5 } }, { sbDoc, perfDoc }).includes('perf.minDepth must be an integer 1-5'));
  assert.deepEqual(validateConfig('alpha', { ...base, perf: { ...base.perf, minDepth: 1 } }, { sbDoc, perfDoc }), ["manifest schema: schema: (root): required key 'repo' is missing", "perf schema: schema: (root): required key 'version' is missing", "perf schema: schema: (root): required key 'note' is missing", "perf schema: schema: (root): required key 'measuredFrom' is missing", "perf schema: schema: (root): required key 'diskClasses' is missing", "perf schema: schema: (root): required key 'profiles' is missing", "perf schema: schema: (root): required key 'depthLevels' is missing", "perf schema: schema: (root): required key 'intensityLevels' is missing", "perf schema: schema: costClasses.low: expected object, got number", "perf schema: schema: costClasses.high: expected object, got number", "perf schema: schema: scanners.alpha: required key 'container' is missing"]);
  assert.deepEqual(validateConfig('alpha', { ...base, perf: { ...base.perf, minDepth: 5 } }, { sbDoc, perfDoc }), ["manifest schema: schema: (root): required key 'repo' is missing", "perf schema: schema: (root): required key 'version' is missing", "perf schema: schema: (root): required key 'note' is missing", "perf schema: schema: (root): required key 'measuredFrom' is missing", "perf schema: schema: (root): required key 'diskClasses' is missing", "perf schema: schema: (root): required key 'profiles' is missing", "perf schema: schema: (root): required key 'depthLevels' is missing", "perf schema: schema: (root): required key 'intensityLevels' is missing", "perf schema: schema: costClasses.low: expected object, got number", "perf schema: schema: costClasses.high: expected object, got number", "perf schema: schema: scanners.alpha: required key 'container' is missing"]);
});

test('requires ladders to have at least two labeled levels', () => {
  const errs = validateConfig('alpha', { check: { ...validCheck }, perf: { cost: 'low', depthLadder: [{ label: 'only' }] } }, { sbDoc, perfDoc });
  assert.ok(errs.includes('perf.depthLadder must list at least two levels'));
  const errs2 = validateConfig('alpha', { check: { ...validCheck }, perf: { cost: 'low', depthLadder: [{ label: 'a' }, { label: '' }] } }, { sbDoc, perfDoc });
  assert.ok(errs2.includes('perf.depthLadder: every level needs a label'));
});

test('requires check commands to reference depth or intensity env vars', () => {
  const check = { id: 'alpha', local: ['echo hello'] };
  const perf = { cost: 'low', depthLadder: [{ label: 'a' }, { label: 'b' }] };
  const errs = validateConfig('alpha', { check, perf }, { sbDoc, perfDoc });
  assert.ok(errs.includes("perf.depthLadder declares levels the check's commands never read (no CW_DEPTH_RANK or CW_DEPTH_LEVEL) \u2014 every level would run the same thing"));
});

test('accepts ladders when check commands reference the env vars', () => {
  const check = { id: 'alpha', local: ['echo CW_DEPTH_RANK', 'echo CW_INTENSITY_LEVEL'] };
  const perf = { cost: 'low', depthLadder: [{ label: 'a' }, { label: 'b' }], intensityLadder: [{ label: 'x' }, { label: 'y' }] };
  assert.deepEqual(validateConfig('alpha', { check, perf }, { sbDoc, perfDoc }), ["manifest schema: schema: (root): required key 'repo' is missing", "perf schema: schema: (root): required key 'version' is missing", "perf schema: schema: (root): required key 'note' is missing", "perf schema: schema: (root): required key 'measuredFrom' is missing", "perf schema: schema: (root): required key 'diskClasses' is missing", "perf schema: schema: (root): required key 'profiles' is missing", "perf schema: schema: (root): required key 'depthLevels' is missing", "perf schema: schema: (root): required key 'intensityLevels' is missing", "perf schema: schema: costClasses.low: expected object, got number", "perf schema: schema: costClasses.high: expected object, got number", "perf schema: schema: scanners.alpha: required key 'container' is missing"]);
});
