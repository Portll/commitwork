import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostOnSubnet, parseCidr } from '../net-host.mjs';

// Shaped like os.networkInterfaces() inside a container on the control network and two job networks.
const TABLE = {
  lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }, { address: '::1', family: 'IPv6', internal: true }],
  eth0: [{ address: '172.30.0.5', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
  eth1: [{ address: '172.31.1.2', family: 'IPv4', internal: false }],
  eth2: [{ address: '172.31.2.2', family: 4, internal: false }],
};

test('picks the one address on the control subnet', () => {
  assert.equal(hostOnSubnet('172.30.0.0/24', TABLE), '172.30.0.5');
  assert.equal(hostOnSubnet('172.31.2.0/24', TABLE), '172.31.2.2', 'numeric family from older Node');
  assert.equal(hostOnSubnet('127.0.0.0/8', TABLE), '127.0.0.1');
});

test('no address, or several, throws rather than falling back', () => {
  assert.throws(() => hostOnSubnet('10.9.0.0/16', TABLE), /no interface address on 10\.9\.0\.0\/16/);
  assert.throws(() => hostOnSubnet('172.31.0.0/16', TABLE), /2 addresses on 172\.31\.0\.0\/16: eth1 172\.31\.1\.2, eth2 172\.31\.2\.2/);
  assert.throws(() => hostOnSubnet('172.30.0.0/24', {}), /no interface address/);
});

test('only IPv4 CIDRs parse', () => {
  assert.deepEqual(parseCidr('172.30.0.9/24'), { start: 2887647232, size: 256 });
  assert.deepEqual(parseCidr('0.0.0.0/0'), { start: 0, size: 2 ** 32 });
  for (const bad of ['fd00::/8', '172.30.0.0', '172.30.0.0/33', '300.1.1.1/8', '', null]) {
    assert.throws(() => parseCidr(bad), RangeError, String(bad));
  }
});
