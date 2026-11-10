// Whether every axis is unmeasured (monitor/defence-vector.mjs isUnmeasured).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnmeasured } from '../defence-vector.mjs';

test('returns true when all axes are undefined', () => {
  const v = {};
  assert.equal(isUnmeasured(v), true);
});

test('returns true when all axes have open state and empty evidence', () => {
  const v = {
    reachability: { state: 'open', evidence: '' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), true);
});

test('returns false when one axis has closed state', () => {
  const v = {
    reachability: { state: 'closed', evidence: '' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), false);
});

test('returns false when one axis has non-empty evidence', () => {
  const v = {
    reachability: { state: 'open', evidence: 'some evidence' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), false);
});

test('returns false when one axis has closed state and evidence', () => {
  const v = {
    reachability: { state: 'closed', evidence: 'some evidence' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), false);
});

test('returns false when one axis has null value', () => {
  const v = {
    reachability: null,
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), true);
});

test('returns false when one axis has whitespace-only evidence', () => {
  const v = {
    reachability: { state: 'open', evidence: '   ' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), true);
});

test('returns false when one axis has measured state', () => {
  const v = {
    reachability: { state: 'measured', evidence: '' },
    networkExposure: { state: 'open', evidence: '' },
    authnAuthz: { state: 'open', evidence: '' },
    inputMediation: { state: 'open', evidence: '' },
    privilegeBlast: { state: 'open', evidence: '' },
    dataAtRisk: { state: 'open', evidence: '' },
    detectability: { state: 'open', evidence: '' },
    patchAvailability: { state: 'open', evidence: '' },
  };
  assert.equal(isUnmeasured(v), false);
});
