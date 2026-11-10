// Maps a hostname to the area slug that declares it (monitor/registry.mjs areaOfHost).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaOfHost } from '../registry.mjs';

test('returns null when hostname is empty', () => {
  const r = areaOfHost('', { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, null);
});

test('returns null when hostname is whitespace only', () => {
  const r = areaOfHost('   ', { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, null);
});

test('returns null when hostname is null', () => {
  const r = areaOfHost(null, { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, null);
});

test('returns null when hostname is undefined', () => {
  const r = areaOfHost(undefined, { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, null);
});

test('returns null when reg is null', () => {
  const r = areaOfHost('x.com', null);
  assert.equal(r, null);
});

test('returns null when reg has no areas property', () => {
  const r = areaOfHost('x.com', {});
  assert.equal(r, null);
});

test('returns null when area has no deploy property', () => {
  const r = areaOfHost('x.com', { areas: [{ slug: 'a' }] });
  assert.equal(r, null);
});

test('returns null when area deploy has no hostnames property', () => {
  const r = areaOfHost('x.com', { areas: [{ slug: 'a', deploy: {} }] });
  assert.equal(r, null);
});

test('returns slug when hostname matches case-insensitively', () => {
  const r = areaOfHost('X.COM', { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, "a");
});

test('returns null when hostname does not match any area', () => {
  const r = areaOfHost('y.com', { areas: [{ slug: 'a', deploy: { hostnames: ['x.com'] } }] });
  assert.equal(r, null);
});
