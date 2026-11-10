// Resolves the floor for N-chain adjudication from CW_ADJUDICATE_CHAINS (bin/issue-llm.mjs baseChainCount).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseChainCount } from '../issue-llm.mjs';

test('returns 1 when CW_ADJUDICATE_CHAINS is unset', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  delete process.env.CW_ADJUDICATE_CHAINS;
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is an empty string', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 3 when CW_ADJUDICATE_CHAINS is 3', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '3';
  try {
    assert.equal(baseChainCount(), 3);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is 0', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '0';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is a negative number', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '-2';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is not a number', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = 'abc';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is NaN', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = 'NaN';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is Infinity', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = 'Infinity';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is a float', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '1.5';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});

test('returns 1 when CW_ADJUDICATE_CHAINS is whitespace only', () => {
  const saved = process.env.CW_ADJUDICATE_CHAINS;
  process.env.CW_ADJUDICATE_CHAINS = '   ';
  try {
    assert.equal(baseChainCount(), 1);
  } finally {
    if (saved === undefined) delete process.env.CW_ADJUDICATE_CHAINS;
    else process.env.CW_ADJUDICATE_CHAINS = saved;
  }
});
