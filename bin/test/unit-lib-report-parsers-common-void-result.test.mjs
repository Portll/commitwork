// Computes a noscan result object with a blocked flag derived from the reason string (bin/lib/report-parsers/common.mjs voidResult).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voidResult } from '../lib/report-parsers/common.mjs';

test('returns blocked true when reason contains the word token', () => {
  const res = voidResult('token is unset', 'CSPM', 'fallback');
  assert.equal(res.ok, false);
  assert.equal(res.sev, 'noscan');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'token is unset');
  assert.equal(res.summary, 'CSPM \u2014 token is unset');
});

test('returns blocked true when reason contains the word credential', () => {
  const res = voidResult('missing credential', 'Auth', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'missing credential');
  assert.equal(res.summary, 'Auth \u2014 missing credential');
});

test('returns blocked true when reason contains the word unset', () => {
  const res = voidResult('env var unset', 'Env', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'env var unset');
  assert.equal(res.summary, 'Env \u2014 env var unset');
});

test('returns blocked true when reason contains phrase not installed', () => {
  const res = voidResult('tool not installed', 'Tool', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'tool not installed');
  assert.equal(res.summary, 'Tool \u2014 tool not installed');
});

test('returns blocked true when reason contains the word PAT', () => {
  const res = voidResult('PAT expired', 'GitHub', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'PAT expired');
  assert.equal(res.summary, 'GitHub \u2014 PAT expired');
});

test('returns blocked true when reason contains the word scope', () => {
  const res = voidResult('insufficient scope', 'OAuth', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'insufficient scope');
  assert.equal(res.summary, 'OAuth \u2014 insufficient scope');
});

test('returns blocked true when reason contains phrase command not found', () => {
  const res = voidResult('command not found', 'Exec', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'command not found');
  assert.equal(res.summary, 'Exec \u2014 command not found');
});

test('returns blocked true when reason contains phrase no such file', () => {
  const res = voidResult('no such file or directory', 'FS', 'fb');
  assert.equal(res.blocked, true);
  assert.equal(res.blockedReason, 'no such file or directory');
  assert.equal(res.summary, 'FS \u2014 no such file or directory');
});

test('returns blocked false when reason describes structural absence like no target', () => {
  const res = voidResult('no target available', 'TLS', 'fb');
  assert.equal(res.blocked, false);
  assert.equal(res.blockedReason, null);
  assert.equal(res.summary, 'TLS \u2014 no target available');
});

test('returns blocked false when reason is empty and fallback reason is also empty', () => {
  const res = voidResult('', 'Lane', '');
  assert.equal(res.ok, false);
  assert.equal(res.sev, 'noscan');
  assert.equal(res.blocked, false);
  assert.equal(res.blockedReason, null);
  assert.equal(res.summary, 'Lane \u2014 ');
});
