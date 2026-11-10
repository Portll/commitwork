// Why a configured LLM host is blocked from use (monitor/llm-runtime.mjs blockedReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockedReason } from '../llm-runtime.mjs';

test('returns null when the host is on loopback', () => {
  const host = { id: 'h1', url: 'http://127.0.0.1:8080' };
  const posture = { allowNonLoopback: {} };
  const r = blockedReason(host, posture);
  assert.equal(r, null);
});

test('returns a parse error message when the URL is unparseable', () => {
  const host = { id: 'h2', url: 'not a url' };
  const posture = { allowNonLoopback: {} };
  const r = blockedReason(host, posture);
  assert.equal(r, "its configured address (not a url) could not be parsed, so it cannot be shown to be loopback");
});

test('returns a not-allowed message when the host is on a LAN address without consent', () => {
  const host = { id: 'h3', url: 'http://192.168.1.5:9000' };
  const posture = { allowNonLoopback: {} };
  const r = blockedReason(host, posture);
  assert.equal(r, "it is configured at a lan address (http://192.168.1.5:9000) and has not been allowed off loopback");
});

test('returns a consent-mismatch message when the allowed URL differs from the configured URL', () => {
  const host = { id: 'h4', url: 'http://192.168.1.5:9001' };
  const posture = { allowNonLoopback: { h4: 'http://192.168.1.5:9000' } };
  const r = blockedReason(host, posture);
  assert.equal(r, "it was allowed off loopback at http://192.168.1.5:9000, but is now configured at http://192.168.1.5:9001 \u2014 consent for one address is not consent for another");
});

test('returns null when the host is on a hosted address with matching consent', () => {
  const host = { id: 'h5', url: 'https://api.example.com' };
  const posture = { allowNonLoopback: { h5: 'https://api.example.com' } };
  const r = blockedReason(host, posture);
  assert.equal(r, null);
});

test('returns a not-allowed message when the host is on a hosted address without consent', () => {
  const host = { id: 'h6', url: 'https://api.example.com' };
  const posture = { allowNonLoopback: {} };
  const r = blockedReason(host, posture);
  assert.equal(r, "it is configured at a hosted address (https://api.example.com) and has not been allowed off loopback");
});

test('returns a consent-mismatch message when the allowed URL is a different loopback address', () => {
  const host = { id: 'h7', url: 'http://127.0.0.1:8081' };
  const posture = { allowNonLoopback: { h7: 'http://127.0.0.1:8080' } };
  const r = blockedReason(host, posture);
  assert.equal(r, null);
});

test('returns a parse error message when the URL is an empty string', () => {
  const host = { id: 'h8', url: '' };
  const posture = { allowNonLoopback: {} };
  const r = blockedReason(host, posture);
  assert.equal(r, "its configured address () could not be parsed, so it cannot be shown to be loopback");
});
