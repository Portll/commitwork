// IPv4 and IPv6 default-route interface names parsed from /proc route tables (bin/lib/sandbox-net.mjs defaultRouteIfaces).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRouteIfaces } from '../lib/sandbox-net.mjs';

const HDR = 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT';
const Z = '0'.repeat(32);
const r4 = (iface, dest, flags, mask) => [iface, dest, '0101A8C0', flags, '0', '0', '100', mask, '0', '0', '0'].join('\t');
const r6 = (dest, plen, flags, iface) => [dest, plen, Z, '00', Z, '00000400', '00000001', '00000000', flags, iface].join(' ');

test('empty or missing tables yield null for both families', () => {
  assert.deepEqual(defaultRouteIfaces(), { v4: null, v6: null });
  assert.deepEqual(defaultRouteIfaces({ route: '', route6: '' }), { v4: null, v6: null });
});

test('the first line of the IPv4 table is treated as a header and never matched', () => {
  const route = r4('eth0', '00000000', '0003', '00000000');
  assert.deepEqual(defaultRouteIfaces({ route }), { v4: null, v6: null });
});

test('the first IPv4 line with zero destination and zero mask wins after skipping others', () => {
  const route = [HDR, r4('eth1', '0000A8C0', '0001', '00FFFFFF'), r4('eth0', '00000000', '0003', '00000000')].join('\n');
  assert.deepEqual(defaultRouteIfaces({ route }), { v4: 'eth0', v6: null });
});

test('an IPv4 line with exactly eight fields matches and one with seven does not', () => {
  const eight = ['eth0', '00000000', '0101A8C0', '0003', '0', '0', '100', '00000000'].join(' ');
  const seven = ['eth0', '00000000', '0101A8C0', '0003', '0', '0', '100'].join(' ');
  assert.deepEqual(defaultRouteIfaces({ route: `${HDR}\n${eight}` }), { v4: 'eth0', v6: null });
  assert.deepEqual(defaultRouteIfaces({ route: `${HDR}\n${seven}` }), { v4: null, v6: null });
});

test('an IPv4 line with zero destination but a non-zero mask is not a default route', () => {
  const route = [HDR, r4('eth0', '00000000', '0003', '00FFFFFF')].join('\n');
  assert.deepEqual(defaultRouteIfaces({ route }), { v4: null, v6: null });
});

test('IPv4 loopback and routes without the up flag are skipped in favour of a later match', () => {
  const route = [
    HDR,
    r4('lo', '00000000', '0003', '00000000'),
    r4('eth0', '00000000', '0002', '00000000'),
    r4('wlan0', '00000000', '0001', '00000000'),
  ].join('\n');
  assert.deepEqual(defaultRouteIfaces({ route }), { v4: 'wlan0', v6: null });
});

test('an IPv6 default route on the very first line with flags 1 is returned', () => {
  const route6 = r6(Z, '00', '00000001', 'eth0');
  assert.deepEqual(defaultRouteIfaces({ route6 }), { v4: null, v6: 'eth0' });
});

test('an IPv6 default route on loopback is ignored', () => {
  const route6 = r6(Z, '00', '00000001', 'lo');
  assert.deepEqual(defaultRouteIfaces({ route6 }), { v4: null, v6: null });
});

test('IPv6 lines with non-zero destination, non-zero prefix, even flags or nine fields are ignored', () => {
  const route6 = [
    r6('fe80' + '0'.repeat(28), '40', '00000001', 'eth0'),
    r6(Z, '40', '00000001', 'eth1'),
    r6(Z, '00', '00000002', 'eth2'),
    r6(Z, '00', '00000001', 'eth3').split(' ').slice(0, 9).join(' '),
  ].join('\n');
  assert.deepEqual(defaultRouteIfaces({ route6 }), { v4: null, v6: null });
});

test('both families are resolved independently from realistic tables', () => {
  const route = [HDR, r4('eth0', '00000000', '0003', '00000000')].join('\n') + '\n';
  const route6 = [r6(Z, '00', '00200200', 'lo'), r6(Z, '00', '00450003', 'eth1')].join('\n') + '\n';
  assert.deepEqual(defaultRouteIfaces({ route, route6 }), { v4: 'eth0', v6: 'eth1' });
});
