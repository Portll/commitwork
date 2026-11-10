// Parses keychain dump text into credential items (monitor/credential-scope.mjs parseKeychainDump).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeychainDump } from '../credential-scope.mjs';

test('returns empty array for empty string input', () => {
  const r = parseKeychainDump('');
  assert.deepEqual(r, []);
});

test('returns empty array for null input', () => {
  const r = parseKeychainDump(null);
  assert.deepEqual(r, []);
});

test('returns empty array for undefined input', () => {
  const r = parseKeychainDump(undefined);
  assert.deepEqual(r, []);
});

test('returns empty array for non-string input', () => {
  const r = parseKeychainDump(123);
  assert.deepEqual(r, []);
});

test('parses single item with svce and acct fields', () => {
  const text = 'keychain: \nclass: "inet"\n"svce"<blob>="myservice"\n"acct"<blob>="myaccount"\n0x00000007 <blob>="mylabel"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, [{ class: "inet", service: "myservice", account: "myaccount", label: "mylabel" }]);
});

test('parses single item with srvr field only', () => {
  const text = 'keychain: \nclass: "inet"\n"srvr"<blob>="myserver"\n"acct"<blob>="myaccount"\n0x00000007 <blob>="mylabel"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, [{ class: "inet", service: "myserver", account: "myaccount", label: "mylabel" }]);
});

test('parses single item with both svce and srvr fields', () => {
  const text = 'keychain: \nclass: "inet"\n"svce"<blob>="myservice"\n"srvr"<blob>="myserver"\n"acct"<blob>="myaccount"\n0x00000007 <blob>="mylabel"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, [{ class: "inet", service: "myservice", account: "myaccount", label: "mylabel" }]);
});

test('filters out items missing account field', () => {
  const text = 'keychain: \nclass: "inet"\n"svce"<blob>="myservice"\n0x00000007 <blob>="mylabel"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, []);
});

test('filters out items missing service field', () => {
  const text = 'keychain: \nclass: "inet"\n"acct"<blob>="myaccount"\n0x00000007 <blob>="mylabel"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, []);
});

test('parses multiple items from keychain dump', () => {
  const text = 'keychain: \nclass: "inet"\n"svce"<blob>="svc1"\n"acct"<blob>="acct1"\n0x00000007 <blob>="label1"\nkeychain: \nclass: "inet"\n"svce"<blob>="svc2"\n"acct"<blob>="acct2"\n0x00000007 <blob>="label2"';
  const r = parseKeychainDump(text);
  assert.deepEqual(r, [{ class: "inet", service: "svc1", account: "acct1", label: "label1" }, { class: "inet", service: "svc2", account: "acct2", label: "label2" }]);
});
