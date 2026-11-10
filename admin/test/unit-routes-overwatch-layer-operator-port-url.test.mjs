// Local operator port URL (admin/routes/overwatch-layer.mjs operatorPortUrl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorPortUrl } from '../routes/overwatch-layer.mjs';

test('returns 127.0.0.1 with CW_ADMIN_LOCAL_PORT when set', () => {
  const saved = process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_LOCAL_PORT = '9999';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:9999');
  } finally {
    if (saved === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = saved;
  }
});

test('returns 127.0.0.1 with CW_ADMIN_PORT plus one when local port unset', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_PORT = '8080';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:8081');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('returns 127.0.0.1 with 7879 when both env vars are unset', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  delete process.env.CW_ADMIN_PORT;
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:7879');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('uses CW_ADMIN_LOCAL_PORT even when CW_ADMIN_PORT is also set', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  process.env.CW_ADMIN_LOCAL_PORT = '1234';
  process.env.CW_ADMIN_PORT = '5678';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:1234');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('handles CW_ADMIN_PORT as a string that converts to a number', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_PORT = '100';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:101');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('handles CW_ADMIN_PORT as a large number', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_PORT = '65535';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:65536');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('handles CW_ADMIN_PORT as zero', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_PORT = '0';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:1');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});

test('handles CW_ADMIN_PORT as a non-numeric string', () => {
  const savedLocal = process.env.CW_ADMIN_LOCAL_PORT;
  const savedPort = process.env.CW_ADMIN_PORT;
  delete process.env.CW_ADMIN_LOCAL_PORT;
  process.env.CW_ADMIN_PORT = 'abc';
  try {
    assert.equal(operatorPortUrl(), 'http://127.0.0.1:NaN');
  } finally {
    if (savedLocal === undefined) delete process.env.CW_ADMIN_LOCAL_PORT;
    else process.env.CW_ADMIN_LOCAL_PORT = savedLocal;
    if (savedPort === undefined) delete process.env.CW_ADMIN_PORT;
    else process.env.CW_ADMIN_PORT = savedPort;
  }
});
