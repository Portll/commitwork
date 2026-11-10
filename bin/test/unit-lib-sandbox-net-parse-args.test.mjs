// Parses CLI args into loopback ports and bwrap argv (bin/lib/sandbox-net.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/sandbox-net.mjs';

test('throws when no separator is present', () => {
  assert.throws(() => parseArgs(['bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']), {
    name: 'Error',
    message: 'sandbox-net: usage: sandbox-net.mjs [--loopback PORTS] -- bwrap \u2026'
  });
});

test('throws when separator is at index zero', () => {
  assert.deepStrictEqual(parseArgs(['--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']), { loopback: [], bwrap: ["bwrap", "--unshare-net", "--info-fd", "3", "--block-fd", "4"] });
});

test('returns empty loopback and bwrap argv for minimal valid input', () => {
  const r = parseArgs(['--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']);
  assert.deepEqual(r, { loopback: [], bwrap: ['bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4'] });
});

test('parses single loopback port', () => {
  const r = parseArgs(['--loopback', '8080', '--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']);
  assert.deepEqual(r, { loopback: [8080], bwrap: ['bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4'] });
});

test('parses multiple loopback ports', () => {
  const r = parseArgs(['--loopback', '80,443,8080', '--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']);
  assert.deepEqual(r, { loopback: [80, 443, 8080], bwrap: ['bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4'] });
});

test('throws for port zero', () => {
  assert.throws(() => parseArgs(['--loopback', '0', '--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']), {
    name: 'Error',
    message: 'sandbox-net: --loopback takes ports 1-65535, got "0"'
  });
});

test('throws for port 65536', () => {
  assert.throws(() => parseArgs(['--loopback', '65536', '--', 'bwrap', '--unshare-net', '--info-fd', '3', '--block-fd', '4']), {
    name: 'Error',
    message: 'sandbox-net: --loopback takes ports 1-65535, got "65536"'
  });
});

test('throws when bwrap is missing --unshare-net', () => {
  assert.throws(() => parseArgs(['--', 'bwrap', '--info-fd', '3', '--block-fd', '4']), {
    name: 'Error',
    message: 'sandbox-net: the wrapped argv must be bwrap with --unshare-net --info-fd 3 --block-fd 4, or the command could start before its network exists'
  });
});

test('throws when bwrap is missing --info-fd 3', () => {
  assert.throws(() => parseArgs(['--', 'bwrap', '--unshare-net', '--block-fd', '4']), {
    name: 'Error',
    message: 'sandbox-net: the wrapped argv must be bwrap with --unshare-net --info-fd 3 --block-fd 4, or the command could start before its network exists'
  });
});

test('throws when bwrap is missing --block-fd 4', () => {
  assert.throws(() => parseArgs(['--', 'bwrap', '--unshare-net', '--info-fd', '3']), {
    name: 'Error',
    message: 'sandbox-net: the wrapped argv must be bwrap with --unshare-net --info-fd 3 --block-fd 4, or the command could start before its network exists'
  });
});
