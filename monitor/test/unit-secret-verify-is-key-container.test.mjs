// Detects whether a rule or file path indicates a key container (monitor/secret-verify.mjs isKeyContainer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKeyContainer } from '../secret-verify.mjs';

test('returns true when rule contains private-key', () => {
  const r = isKeyContainer('private-key', 'config.json');
  assert.equal(r, true);
});

test('returns true when rule contains rsa', () => {
  const r = isKeyContainer('rsa', 'config.json');
  assert.equal(r, true);
});

test('returns true when rule contains pkcs12', () => {
  const r = isKeyContainer('pkcs12', 'config.json');
  assert.equal(r, true);
});

test('returns true when rule contains keystore', () => {
  const r = isKeyContainer('keystore', 'config.json');
  assert.equal(r, true);
});

test('returns true when rule contains pkcs8', () => {
  const r = isKeyContainer('pkcs8', 'config.json');
  assert.equal(r, true);
});

test('returns true when file ends with pem', () => {
  const r = isKeyContainer('config', 'cert.pem');
  assert.equal(r, true);
});

test('returns true when file ends with key', () => {
  const r = isKeyContainer('config', 'id_rsa.key');
  assert.equal(r, true);
});

test('returns true when file ends with pfx', () => {
  const r = isKeyContainer('config', 'cert.pfx');
  assert.equal(r, true);
});

test('returns true when file ends with p12', () => {
  const r = isKeyContainer('config', 'cert.p12');
  assert.equal(r, true);
});

test('returns true when file ends with jks', () => {
  const r = isKeyContainer('config', 'keystore.jks');
  assert.equal(r, true);
});

test('returns true when file ends with keystore', () => {
  const r = isKeyContainer('config', 'app.keystore');
  assert.equal(r, true);
});

test('returns false when rule is empty and file is plain', () => {
  const r = isKeyContainer('', 'config.json');
  assert.equal(r, false);
});

test('returns false when rule is null and file is plain', () => {
  const r = isKeyContainer(null, 'config.json');
  assert.equal(r, false);
});

test('returns false when rule is undefined and file is plain', () => {
  const r = isKeyContainer(undefined, 'config.json');
  assert.equal(r, false);
});

test('returns false when rule is empty and file is null', () => {
  const r = isKeyContainer('', null);
  assert.equal(r, false);
});

test('returns false when rule is empty and file is undefined', () => {
  const r = isKeyContainer('', undefined);
  assert.equal(r, false);
});

test('returns false when rule is plain and file is plain', () => {
  const r = isKeyContainer('config', 'config.json');
  assert.equal(r, false);
});

test('returns false when rule is plain and file is null', () => {
  const r = isKeyContainer('config', null);
  assert.equal(r, false);
});

test('returns false when rule is plain and file is undefined', () => {
  const r = isKeyContainer('config', undefined);
  assert.equal(r, false);
});

test('returns true when rule matches and file also matches', () => {
  const r = isKeyContainer('rsa', 'cert.pem');
  assert.equal(r, true);
});

test('returns true when rule is empty string and file matches', () => {
  const r = isKeyContainer('', 'cert.pem');
  assert.equal(r, true);
});

test('returns true when rule is null and file matches', () => {
  const r = isKeyContainer(null, 'cert.pem');
  assert.equal(r, true);
});

test('returns true when rule is undefined and file matches', () => {
  const r = isKeyContainer(undefined, 'cert.pem');
  assert.equal(r, true);
});

test('returns true when rule matches and file is empty string', () => {
  const r = isKeyContainer('rsa', '');
  assert.equal(r, true);
});

test('returns true when rule matches and file is null', () => {
  const r = isKeyContainer('rsa', null);
  assert.equal(r, true);
});

test('returns true when rule matches and file is undefined', () => {
  const r = isKeyContainer('rsa', undefined);
  assert.equal(r, true);
});
