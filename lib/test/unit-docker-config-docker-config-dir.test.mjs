// The docker config directory: CW_DOCKER_CONFIG when set and non-empty, else ~/.config/commitwork/docker (lib/docker-config.mjs dockerConfigDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockerConfigDir } from '../docker-config.mjs';

test('returns the value of CW_DOCKER_CONFIG when it is set to a non-empty string', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  process.env.CW_DOCKER_CONFIG = '/custom/docker/path';
  try {
    assert.equal(dockerConfigDir(), '/custom/docker/path');
  } finally {
    if (original === undefined) {
      delete process.env.CW_DOCKER_CONFIG;
    } else {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});

test('returns the value of CW_DOCKER_CONFIG when it is set to a single space', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  process.env.CW_DOCKER_CONFIG = ' ';
  try {
    assert.equal(dockerConfigDir(), ' ');
  } finally {
    if (original === undefined) {
      delete process.env.CW_DOCKER_CONFIG;
    } else {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});

test('returns the value of CW_DOCKER_CONFIG when it is set to the string zero', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  process.env.CW_DOCKER_CONFIG = '0';
  try {
    assert.equal(dockerConfigDir(), '0');
  } finally {
    if (original === undefined) {
      delete process.env.CW_DOCKER_CONFIG;
    } else {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});

test('falls back to the default path when CW_DOCKER_CONFIG is an empty string', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  process.env.CW_DOCKER_CONFIG = '';
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const expected = home + '/.config/commitwork/docker';
    assert.equal(dockerConfigDir(), expected);
  } finally {
    if (original === undefined) {
      delete process.env.CW_DOCKER_CONFIG;
    } else {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});

test('falls back to the default path when CW_DOCKER_CONFIG is not set', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  delete process.env.CW_DOCKER_CONFIG;
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const expected = home + '/.config/commitwork/docker';
    assert.equal(dockerConfigDir(), expected);
  } finally {
    if (original !== undefined) {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});

test('reads the environment variable at call time rather than at module load time', () => {
  const original = process.env.CW_DOCKER_CONFIG;
  delete process.env.CW_DOCKER_CONFIG;
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const defaultPath = home + '/.config/commitwork/docker';
    
    assert.equal(dockerConfigDir(), defaultPath);
    
    process.env.CW_DOCKER_CONFIG = '/late/override';
    assert.equal(dockerConfigDir(), '/late/override');
    
    process.env.CW_DOCKER_CONFIG = '';
    assert.equal(dockerConfigDir(), defaultPath);
  } finally {
    if (original === undefined) {
      delete process.env.CW_DOCKER_CONFIG;
    } else {
      process.env.CW_DOCKER_CONFIG = original;
    }
  }
});
