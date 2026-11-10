// Returns the CW_OFFBOX_EVIDENCE env var or null (lib/offbox-evidence.mjs evidencePath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidencePath } from '../offbox-evidence.mjs';

test('returns the env var value when CW_OFFBOX_EVIDENCE is set to a non-empty string', () => {
  const saved = process.env.CW_OFFBOX_EVIDENCE;
  process.env.CW_OFFBOX_EVIDENCE = '/tmp/evidence.json';
  try {
    assert.equal(evidencePath(), "/tmp/evidence.json");
  } finally {
    if (saved === undefined) delete process.env.CW_OFFBOX_EVIDENCE;
    else process.env.CW_OFFBOX_EVIDENCE = saved;
  }
});

test('returns null when CW_OFFBOX_EVIDENCE is unset', () => {
  const saved = process.env.CW_OFFBOX_EVIDENCE;
  delete process.env.CW_OFFBOX_EVIDENCE;
  try {
    assert.equal(evidencePath(), null);
  } finally {
    if (saved !== undefined) process.env.CW_OFFBOX_EVIDENCE = saved;
  }
});

test('returns null when CW_OFFBOX_EVIDENCE is set to an empty string', () => {
  const saved = process.env.CW_OFFBOX_EVIDENCE;
  process.env.CW_OFFBOX_EVIDENCE = '';
  try {
    assert.equal(evidencePath(), null);
  } finally {
    if (saved === undefined) delete process.env.CW_OFFBOX_EVIDENCE;
    else process.env.CW_OFFBOX_EVIDENCE = saved;
  }
});

test('returns the env var value when CW_OFFBOX_EVIDENCE is set to a long path', () => {
  const saved = process.env.CW_OFFBOX_EVIDENCE;
  process.env.CW_OFFBOX_EVIDENCE = 'x'.repeat(100);
  try {
    assert.equal(evidencePath(), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  } finally {
    if (saved === undefined) delete process.env.CW_OFFBOX_EVIDENCE;
    else process.env.CW_OFFBOX_EVIDENCE = saved;
  }
});

test('returns the env var value when CW_OFFBOX_EVIDENCE is set to a single character', () => {
  const saved = process.env.CW_OFFBOX_EVIDENCE;
  process.env.CW_OFFBOX_EVIDENCE = 'a';
  try {
    assert.equal(evidencePath(), "a");
  } finally {
    if (saved === undefined) delete process.env.CW_OFFBOX_EVIDENCE;
    else process.env.CW_OFFBOX_EVIDENCE = saved;
  }
});
