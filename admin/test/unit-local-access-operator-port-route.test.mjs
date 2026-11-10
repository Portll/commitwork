// Detects cloudflared service lines that route to the operator port or loopback panel port (admin/local-access.mjs operatorPortRoute).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorPortRoute } from '../local-access.mjs';

test('returns null when no service lines exist', () => {
  assert.equal(operatorPortRoute('some text\nno services here', 8080), null);
});

test('returns operator message when explicit port matches localPort', () => {
  const cfg = 'service: http://example.com:8080';
  assert.equal(operatorPortRoute(cfg, 8080), 'cloudflared routes a hostname to port 8080, which is the OPERATOR port');
});

test('returns null when explicit port does not match localPort', () => {
  const cfg = 'service: http://example.com:9090';
  assert.equal(operatorPortRoute(cfg, 8080), null);
});

test('returns operator message when default http port 80 matches localPort', () => {
  const cfg = 'service: http://example.com';
  assert.equal(operatorPortRoute(cfg, 80), 'cloudflared routes a hostname to port 80, which is the OPERATOR port');
});

test('returns null when default http port 80 does not match localPort', () => {
  const cfg = 'service: http://example.com';
  assert.equal(operatorPortRoute(cfg, 8080), null);
});

test('returns operator message when default https port 443 matches localPort', () => {
  const cfg = 'service: https://example.com';
  assert.equal(operatorPortRoute(cfg, 443), 'cloudflared routes a hostname to port 443, which is the OPERATOR port');
});

test('returns null when default https port 443 does not match localPort', () => {
  const cfg = 'service: https://example.com';
  assert.equal(operatorPortRoute(cfg, 8080), null);
});

test('returns loopback panel message when port 80 and host is localhost', () => {
  const cfg = 'service: http://localhost';
  assert.equal(operatorPortRoute(cfg, 8080), 'cloudflared routes a hostname to loopback port 80, which bin/panel-local-name.mjs redirects to the OPERATOR port');
});

test('returns null when port 80 but host is not loopback', () => {
  const cfg = 'service: http://example.com';
  assert.equal(operatorPortRoute(cfg, 8080), null);
});

test('returns null when port 80 and host is 127.0.0.2 (not in loopback set)', () => {
  const cfg = 'service: http://127.0.0.2';
  assert.equal(operatorPortRoute(cfg, 8080), null);
});
