// Extracts TCP port bindings from registry URLs (monitor/host-inventory.mjs declaredPorts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { declaredPorts } from '../host-inventory.mjs';

test('returns empty array when registry is null', () => {
  assert.deepEqual(declaredPorts(null), []);
});

test('returns empty array when registry is undefined', () => {
  assert.deepEqual(declaredPorts(undefined), []);
});

test('returns empty array when registry has no urls or projects', () => {
  assert.deepEqual(declaredPorts({}), []);
});

test('parses http URL with explicit port from urls object', () => {
  const reg = { urls: { 'myrepo': 'http://192.0.2.10:8080/api' } };
  assert.deepEqual(declaredPorts(reg), [
    { repo: 'myrepo', address: '192.0.2.10', port: 8080, proto: 'TCP' }
  ]);
});

test('parses https URL with explicit port from urls object', () => {
  const reg = { urls: { 'secure': 'https://example.com:8443' } };
  assert.deepEqual(declaredPorts(reg), [
    { repo: 'secure', address: 'example.com', port: 8443, proto: 'TCP' }
  ]);
});

test('defaults to port 80 for http URL without explicit port', () => {
  const reg = { urls: { 'web': 'http://localhost' } };
  assert.deepEqual(declaredPorts(reg), [
    { repo: 'web', address: 'localhost', port: 80, proto: 'TCP' }
  ]);
});

test('defaults to port 443 for https URL without explicit port', () => {
  const reg = { urls: { 'secure': 'https://example.com' } };
  assert.deepEqual(declaredPorts(reg), [
    { repo: 'secure', address: 'example.com', port: 443, proto: 'TCP' }
  ]);
});

test('ignores non-http URLs in urls object', () => {
  const reg = { urls: { 'git': 'git://github.com/user/repo.git' } };
  assert.deepEqual(declaredPorts(reg), []);
});

test('parses project url and nested urls from projects array', () => {
  const reg = {
    projects: [
      {
        name: 'proj1',
        url: 'http://198.51.100.1:3000',
        urls: { 'sub': 'https://198.51.100.2:9090' }
      }
    ]
  };
  assert.deepEqual(declaredPorts(reg), [
    { repo: 'proj1', address: '198.51.100.1', port: 3000, proto: 'TCP' },
    { repo: 'sub', address: '198.51.100.2', port: 9090, proto: 'TCP' }
  ]);
});

test('skips project entries without url or urls', () => {
  const reg = {
    projects: [
      { name: 'empty' },
      { name: 'noUrls', url: '' }
    ]
  };
  assert.deepEqual(declaredPorts(reg), []);
});
