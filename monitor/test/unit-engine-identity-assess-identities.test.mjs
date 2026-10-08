// Computes identity assessment rows and overall state (monitor/engine-identity.mjs assessIdentities).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessIdentities } from '../engine-identity.mjs';

test('returns no-baseline state when baseline is null and no findings exist', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', owner: 'o2', ownerOk: true, fingerprint: 'f2', modelCount: 2, portIsShared: false }
  ];
  const result = assessIdentities(observed, null);
  assert.equal(result.state, 'no-baseline');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 0);
  assert.equal(result.rows[0].state, 'unbaselined');
  assert.equal(result.rows[1].state, 'unbaselined');
});

test('returns ok state when all endpoints match baseline exactly', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', owner: 'o2', ownerOk: true, fingerprint: 'f2', modelCount: 2, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' },
      b: { fingerprint: 'f2' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'ok');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 0);
  assert.equal(result.rows[0].state, 'ok');
  assert.equal(result.rows[1].state, 'ok');
});

test('returns findings state when owner is changed', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: false, fingerprint: 'f1', modelCount: 1, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'findings');
  assert.equal(result.rows.length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.rows[0].state, 'owner-changed');
  assert.equal(result.findings[0].state, 'owner-changed');
});

test('returns findings state when fingerprint differs from baseline', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1-new', modelCount: 1, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1-old' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'findings');
  assert.equal(result.rows.length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.rows[0].state, 'fingerprint-changed');
  assert.equal(result.findings[0].state, 'fingerprint-changed');
  assert.deepEqual(result.rows[0].baseline, { fingerprint: 'f1-old' });
});

test('returns partial state when an endpoint is unbaselined but no findings exist', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', owner: 'o2', ownerOk: true, fingerprint: 'f2', modelCount: 2, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'partial');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 0);
  assert.equal(result.rows[0].state, 'ok');
  assert.equal(result.rows[1].state, 'unbaselined');
});

test('returns partial state when an endpoint is unknown but no findings exist', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', unknown: true, unknownReason: 'timeout', unknownDetail: 'no response' }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'partial');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 0);
  assert.equal(result.rows[0].state, 'ok');
  assert.equal(result.rows[1].state, 'unknown');
  assert.equal(result.rows[1].unknownReason, 'timeout');
  assert.equal(result.rows[1].unknownDetail, 'no response');
});

test('returns findings state when both owner-changed and fingerprint-changed exist', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: false, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', owner: 'o2', ownerOk: true, fingerprint: 'f2-new', modelCount: 2, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' },
      b: { fingerprint: 'f2-old' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'findings');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 2);
  assert.equal(result.rows[0].state, 'owner-changed');
  assert.equal(result.rows[1].state, 'fingerprint-changed');
});

test('handles absent endpoints with and without baseline entries', () => {
  const observed = [
    { id: 'a', absent: true },
    { id: 'b', absent: true }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'ok');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 0);
  assert.equal(result.rows[0].state, 'absent');
  assert.equal(result.rows[0].pinned, true);
  assert.equal(result.rows[1].state, 'absent');
  assert.equal(result.rows[1].pinned, false);
});

test('sorts rows by id in ascending order', () => {
  const observed = [
    { id: 'c', owner: 'o3', ownerOk: true, fingerprint: 'f3', modelCount: 3, portIsShared: false },
    { id: 'a', owner: 'o1', ownerOk: true, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', owner: 'o2', ownerOk: true, fingerprint: 'f2', modelCount: 2, portIsShared: false }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' },
      b: { fingerprint: 'f2' },
      c: { fingerprint: 'f3' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'ok');
  assert.equal(result.rows[0].id, 'a');
  assert.equal(result.rows[1].id, 'b');
  assert.equal(result.rows[2].id, 'c');
});

test('returns findings state when findings exist even if grey states also exist', () => {
  const observed = [
    { id: 'a', owner: 'o1', ownerOk: false, fingerprint: 'f1', modelCount: 1, portIsShared: false },
    { id: 'b', unknown: true, unknownReason: 'error', unknownDetail: 'details' }
  ];
  const baseline = {
    endpoints: {
      a: { fingerprint: 'f1' }
    }
  };
  const result = assessIdentities(observed, baseline);
  assert.equal(result.state, 'findings');
  assert.equal(result.rows.length, 2);
  assert.equal(result.findings.length, 1);
  assert.equal(result.rows[0].state, 'owner-changed');
  assert.equal(result.rows[1].state, 'unknown');
});
