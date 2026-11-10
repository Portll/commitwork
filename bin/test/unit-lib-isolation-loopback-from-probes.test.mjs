// Computes whether loopback is isolated based on boundary probe outcomes (bin/lib/isolation.mjs loopbackFromProbes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopbackFromProbes } from '../lib/isolation.mjs';

test('returns undefined when probes is not an array', () => {
  assert.equal(loopbackFromProbes(null), undefined);
});

test('returns undefined when permitted-read is not allowed', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'denied' },
    { probe: 'loopback', outcome: 'denied' },
    { probe: 'loopback-control', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns false when loopback is allowed', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), false);
});

test('returns true when loopback is denied and loopback-control is allowed', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'denied' },
    { probe: 'loopback-control', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), true);
});

test('returns undefined when loopback is denied but loopback-control is not allowed', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'denied' },
    { probe: 'loopback-control', outcome: 'denied' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns undefined when loopback is not present', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback-control', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns undefined when loopback is in error state', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'error' },
    { probe: 'loopback-control', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns undefined when loopback outcomes conflict', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'denied' },
    { probe: 'loopback', outcome: 'allowed' },
    { probe: 'loopback-control', outcome: 'allowed' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns undefined when loopback-control is in error state', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'denied' },
    { probe: 'loopback-control', outcome: 'error' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});

test('returns undefined when loopback-control is not present', () => {
  const probes = [
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'loopback', outcome: 'denied' }
  ];
  assert.equal(loopbackFromProbes(probes), undefined);
});
