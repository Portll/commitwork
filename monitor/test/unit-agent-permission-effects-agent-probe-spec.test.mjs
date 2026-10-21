// Computes the agent probe specification object (monitor/agent-permission-effects.mjs agentProbeSpec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentProbeSpec } from '../agent-permission-effects.mjs';

test('returns the exact object shape with all provided inputs', () => {
  const result = agentProbeSpec({
    platform: 'linux',
    cwRoot: '/cw',
    nodePrefix: '/node',
    tmpDir: '/tmp',
    home: '/home',
    developerDir: '/dev'
  });
  assert.deepEqual(result, {
    egress: 'registry',
    platform: 'linux',
    cwRoot: '/cw',
    nodePrefix: '/node',
    developerDir: '/dev',
    userCacheDir: null,
    repoPath: '/tmp',
    reportDir: '/tmp',
    tmpDir: '/tmp',
    home: '/home',
    extraReads: [],
    extraWrites: []
  });
});

test('defaults developerDir to null when not provided', () => {
  const result = agentProbeSpec({
    platform: 'darwin',
    cwRoot: '/cw',
    nodePrefix: '/node',
    tmpDir: '/tmp',
    home: '/home'
  });
  assert.equal(result.developerDir, null);
});

test('throws TypeError when cwRoot is not an absolute path', () => {
  assert.throws(
    () => agentProbeSpec({
      platform: 'linux',
      cwRoot: 'relative/path',
      nodePrefix: '/node',
      tmpDir: '/tmp',
      home: '/home'
    }),
    {
      name: 'TypeError',
      message: 'agentProbeSpec: cwRoot must be an absolute path'
    }
  );
});

test('throws TypeError when nodePrefix is not an absolute path', () => {
  assert.throws(
    () => agentProbeSpec({
      platform: 'linux',
      cwRoot: '/cw',
      nodePrefix: 'relative',
      tmpDir: '/tmp',
      home: '/home'
    }),
    {
      name: 'TypeError',
      message: 'agentProbeSpec: nodePrefix must be an absolute path'
    }
  );
});

test('throws TypeError when tmpDir is not an absolute path', () => {
  assert.throws(
    () => agentProbeSpec({
      platform: 'linux',
      cwRoot: '/cw',
      nodePrefix: '/node',
      tmpDir: 'tmp',
      home: '/home'
    }),
    {
      name: 'TypeError',
      message: 'agentProbeSpec: tmpDir must be an absolute path'
    }
  );
});

test('throws TypeError when home is not an absolute path', () => {
  assert.throws(
    () => agentProbeSpec({
      platform: 'linux',
      cwRoot: '/cw',
      nodePrefix: '/node',
      tmpDir: '/tmp',
      home: 'home'
    }),
    {
      name: 'TypeError',
      message: 'agentProbeSpec: home must be an absolute path'
    }
  );
});

test('throws TypeError when a path value is not a string', () => {
  assert.throws(
    () => agentProbeSpec({
      platform: 'linux',
      cwRoot: 123,
      nodePrefix: '/node',
      tmpDir: '/tmp',
      home: '/home'
    }),
    {
      name: 'TypeError',
      message: 'agentProbeSpec: cwRoot must be an absolute path'
    }
  );
});

test('accepts paths that start with forward slash', () => {
  const result = agentProbeSpec({
    platform: 'win32',
    cwRoot: '/cw',
    nodePrefix: '/node',
    tmpDir: '/tmp',
    home: '/home'
  });
  assert.equal(result.platform, 'win32');
  assert.equal(result.cwRoot, '/cw');
});
