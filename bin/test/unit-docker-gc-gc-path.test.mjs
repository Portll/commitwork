// Docker GC path from env or default (bin/docker-gc.mjs gcPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gcPath } from '../docker-gc.mjs';

test('returns the env value when CW_DOCKER_GC_PATH is set', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  process.env.CW_DOCKER_GC_PATH = '/custom/gc/path';
  try {
    assert.equal(gcPath(), "/custom/gc/path");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_PATH;
    else process.env.CW_DOCKER_GC_PATH = saved;
  }
});

test('returns the default path when CW_DOCKER_GC_PATH is unset', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  delete process.env.CW_DOCKER_GC_PATH;
  try {
    assert.equal(gcPath(), "/System/Volumes/Data");
  } finally {
    if (saved !== undefined) process.env.CW_DOCKER_GC_PATH = saved;
  }
});

test('returns the env value when it is an empty string', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  process.env.CW_DOCKER_GC_PATH = '';
  try {
    assert.equal(gcPath(), "/System/Volumes/Data");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_PATH;
    else process.env.CW_DOCKER_GC_PATH = saved;
  }
});

test('returns the env value when it is a single space', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  process.env.CW_DOCKER_GC_PATH = ' ';
  try {
    assert.equal(gcPath(), " ");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_PATH;
    else process.env.CW_DOCKER_GC_PATH = saved;
  }
});

test('returns the env value when it is a long repeated path', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  process.env.CW_DOCKER_GC_PATH = 'x'.repeat(64);
  try {
    assert.equal(gcPath(), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_PATH;
    else process.env.CW_DOCKER_GC_PATH = saved;
  }
});

test('returns the default path when the env variable is zero', () => {
  const saved = process.env.CW_DOCKER_GC_PATH;
  process.env.CW_DOCKER_GC_PATH = '0';
  try {
    assert.equal(gcPath(), "0");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_PATH;
    else process.env.CW_DOCKER_GC_PATH = saved;
  }
});
