// Docker GC retention window from CW_DOCKER_GC_UNTIL (bin/docker-gc.mjs retention).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retention } from '../docker-gc.mjs';

test('returns the default 720h when the environment variable is unset', () => {
  const saved = process.env.CW_DOCKER_GC_UNTIL;
  delete process.env.CW_DOCKER_GC_UNTIL;
  try {
    assert.equal(retention(), "720h");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_UNTIL;
    else process.env.CW_DOCKER_GC_UNTIL = saved;
  }
});

test('returns the default 720h when the environment variable is an empty string', () => {
  const saved = process.env.CW_DOCKER_GC_UNTIL;
  process.env.CW_DOCKER_GC_UNTIL = '';
  try {
    assert.equal(retention(), "720h");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_UNTIL;
    else process.env.CW_DOCKER_GC_UNTIL = saved;
  }
});

test('returns the provided value when the environment variable is a non-empty string', () => {
  const saved = process.env.CW_DOCKER_GC_UNTIL;
  process.env.CW_DOCKER_GC_UNTIL = '24h';
  try {
    assert.equal(retention(), "24h");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_UNTIL;
    else process.env.CW_DOCKER_GC_UNTIL = saved;
  }
});

test('returns the provided value when the environment variable is a single space', () => {
  const saved = process.env.CW_DOCKER_GC_UNTIL;
  process.env.CW_DOCKER_GC_UNTIL = ' ';
  try {
    assert.equal(retention(), " ");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_UNTIL;
    else process.env.CW_DOCKER_GC_UNTIL = saved;
  }
});

test('returns the provided value when the environment variable is a long repeated string', () => {
  const saved = process.env.CW_DOCKER_GC_UNTIL;
  process.env.CW_DOCKER_GC_UNTIL = 'x'.repeat(64);
  try {
    assert.equal(retention(), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  } finally {
    if (saved === undefined) delete process.env.CW_DOCKER_GC_UNTIL;
    else process.env.CW_DOCKER_GC_UNTIL = saved;
  }
});
