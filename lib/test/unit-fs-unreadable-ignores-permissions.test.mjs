// whether the current process is considered to ignore permission errors (lib/fs-unreadable.mjs ignoresPermissions)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ignoresPermissions } from '../fs-unreadable.mjs';

function withEnv({ platform, getuid }, fn) {
  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const origGetuid = process.getuid;
  try {
    Object.defineProperty(process, 'platform', { value: platform });
    if (typeof getuid === 'undefined') {
      delete process.getuid;
    } else {
      process.getuid = getuid;
    }
    fn();
  } finally {
    if (origPlatform) {
      Object.defineProperty(process, 'platform', origPlatform);
    }
    if (typeof origGetuid === 'undefined') {
      delete process.getuid;
    } else {
      process.getuid = origGetuid;
    }
  }
}

test('non\u2011Windows, getuid exists and returns 0 \u2192 true', () => {
  withEnv({ platform: 'linux', getuid: () => 0 }, () => {
    assert.equal(ignoresPermissions(), true);
  });
});

test('non\u2011Windows, getuid exists and returns non\u2011zero \u2192 false', () => {
  withEnv({ platform: 'darwin', getuid: () => 1000 }, () => {
    assert.equal(ignoresPermissions(), false);
  });
});

test('non\u2011Windows, getuid is not a function \u2192 false', () => {
  withEnv({ platform: 'freebsd', getuid: undefined }, () => {
    assert.equal(ignoresPermissions(), false);
  });
});

test('Windows platform, getuid returns 0 \u2192 false', () => {
  withEnv({ platform: 'win32', getuid: () => 0 }, () => {
    assert.equal(ignoresPermissions(), false);
  });
});

test('Windows platform, getuid is undefined \u2192 false', () => {
  withEnv({ platform: 'win32', getuid: undefined }, () => {
    assert.equal(ignoresPermissions(), false);
  });
});
