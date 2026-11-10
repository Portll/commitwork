// minimum free disk space in megabytes (bin/lib/disk-headroom.mjs minFreeMb).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minFreeMb } from '../lib/disk-headroom.mjs';

test('returns default 512 when env var is unset', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  delete process.env.CW_DISK_MIN_FREE_MB;
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 512, source: "default" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns default 512 when env var is empty string', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = '';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 512, source: "default" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns env value 1024 when env var is a valid positive number', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = '1024';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 1024, source: "env" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns default 512 when env var is a non-numeric string', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = 'abc';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 512, source: "default" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns default 512 when env var is a negative number', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = '-100';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 512, source: "default" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns env value 0 when env var is zero', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = '0';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 0, source: "env" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns default 512 when env var is NaN string', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = 'NaN';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 512, source: "default" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});

test('returns env value 1 when env var is one', () => {
  const saved = process.env.CW_DISK_MIN_FREE_MB;
  process.env.CW_DISK_MIN_FREE_MB = '1';
  try {
    const r = minFreeMb();
    assert.deepEqual(r, { value: 1, source: "env" });
  } finally {
    if (saved === undefined) delete process.env.CW_DISK_MIN_FREE_MB;
    else process.env.CW_DISK_MIN_FREE_MB = saved;
  }
});
