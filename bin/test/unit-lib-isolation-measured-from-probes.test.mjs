// Maps raw probe records to a measured isolation summary (bin/lib/isolation.mjs measuredFromProbes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measuredFromProbes } from '../lib/isolation.mjs';

test('returns undefined when the input is not an array', () => {
  assert.equal(measuredFromProbes(null), undefined);
});

test('ignores non-record entries and records with invalid probe or outcome fields', () => {
  const probes = [
    'not-a-record',
    { probe: 'permitted-read', outcome: 'allowed' },
    { probe: 'bogus-probe', outcome: 'allowed' },
    { probe: 'permitted-read', outcome: 'bogus-outcome' },
  ];
  assert.deepEqual(measuredFromProbes(probes), { ran: true });
});

test('sets ran to true when permitted-read is allowed', () => {
  const probes = [{ probe: 'permitted-read', outcome: 'allowed' }];
  assert.deepEqual(measuredFromProbes(probes), { ran: true });
});

test('sets ran to false when permitted-read is denied', () => {
  const probes = [{ probe: 'permitted-read', outcome: 'denied' }];
  assert.deepEqual(measuredFromProbes(probes), { ran: false });
});

test('omits ran when permitted-read is an error', () => {
  const probes = [{ probe: 'permitted-read', outcome: 'error' }];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('marks credentialReadDenied true when credential-read is denied', () => {
  const probes = [{ probe: 'credential-read', outcome: 'denied' }];
  assert.deepEqual(measuredFromProbes(probes), { credentialReadDenied: true });
});

test('marks credentialReadDenied false when credential-read is allowed', () => {
  const probes = [{ probe: 'credential-read', outcome: 'allowed' }];
  assert.deepEqual(measuredFromProbes(probes), { credentialReadDenied: false });
});

test('omits credentialReadDenied when credential-read is an error', () => {
  const probes = [{ probe: 'credential-read', outcome: 'error' }];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('marks writeEscapeDenied true when write-escape is denied', () => {
  const probes = [{ probe: 'write-escape', outcome: 'denied' }];
  assert.deepEqual(measuredFromProbes(probes), { writeEscapeDenied: true });
});

test('marks writeEscapeDenied false when write-escape is allowed', () => {
  const probes = [{ probe: 'write-escape', outcome: 'allowed' }];
  assert.deepEqual(measuredFromProbes(probes), { writeEscapeDenied: false });
});

test('omits writeEscapeDenied when write-escape is an error', () => {
  const probes = [{ probe: 'write-escape', outcome: 'error' }];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('sets egressDenied to false when egress is allowed', () => {
  const probes = [{ probe: 'egress', outcome: 'allowed' }];
  assert.deepEqual(measuredFromProbes(probes), { egressDenied: false });
});

test('sets egressDenied to true when egress is denied and network-control is allowed', () => {
  const probes = [
    { probe: 'egress', outcome: 'denied' },
    { probe: 'network-control', outcome: 'allowed' },
  ];
  assert.deepEqual(measuredFromProbes(probes), { egressDenied: true });
});

test('omits egressDenied when egress is denied but network-control is denied', () => {
  const probes = [
    { probe: 'egress', outcome: 'denied' },
    { probe: 'network-control', outcome: 'denied' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is denied and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'denied' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is allowed', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'allowed' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is denied', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'denied' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is allowed', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'allowed' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is denied', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'denied' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is allowed and network-control is denied', () => {
  const probes = [
    { probe: 'egress', outcome: 'allowed' },
    { probe: 'network-control', outcome: 'denied' },
  ];
  assert.deepEqual(measuredFromProbes(probes), { egressDenied: false });
});

test('omits egressDenied when egress is allowed and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'allowed' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), { egressDenied: false });
});

test('omits egressDenied when egress is allowed and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'allowed' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), { egressDenied: false });
});

test('omits egressDenied when egress is denied and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'denied' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is an error and network-control is not-run', () => {
  const probes = [
    { probe: 'egress', outcome: 'error' },
    { probe: 'network-control', outcome: 'not-run' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});

test('omits egressDenied when egress is not-run and network-control is an error', () => {
  const probes = [
    { probe: 'egress', outcome: 'not-run' },
    { probe: 'network-control', outcome: 'error' },
  ];
  assert.deepEqual(measuredFromProbes(probes), {});
});
