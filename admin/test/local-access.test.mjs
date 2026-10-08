// admin/local-access.mjs — the panel's local names, and the tunnel routes that would reach the
// operator port. The boot refusal is asserted against a really-spawned panel, since a reason string
// that nothing acts on protects nothing.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_NAMES, PANEL_LOCAL_NAME, operatorPortRoute } from '../local-access.mjs';

const SERVE = join(dirname(fileURLToPath(import.meta.url)), '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-local-access-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const rule = (service) => `ingress:\n  - hostname: x.example\n    service: ${service}\n  - service: http_status:404\n`;

test('commitwork.local is a local name beside the loopback names, and a public name is not', () => {
  assert.equal(PANEL_LOCAL_NAME, 'commitwork.local');
  for (const h of ['localhost', '127.0.0.1', '[::1]', '::1', 'commitwork.local']) assert.ok(LOCAL_NAMES.has(h), h);
  for (const h of ['commitwork.online', 'www.commitwork.online', 'commitwork.portll.net', 'commitwork.local.example']) {
    assert.ok(!LOCAL_NAMES.has(h), h);
  }
});

test('a rule to the operator port is refused with or without a scheme default', () => {
  assert.match(operatorPortRoute(rule('http://127.0.0.1:7879'), 7879), /OPERATOR port/);
  assert.match(operatorPortRoute(rule('http://[::1]:7879'), 7879), /OPERATOR port/);
  assert.match(operatorPortRoute(rule('https://localhost'), 443), /port 443, which is the OPERATOR port/);
});

test('a rule to loopback :80 is refused, since the local name redirects it to the operator port', () => {
  for (const s of ['http://localhost', 'http://127.0.0.1:80', 'http://[::1]', 'HTTP://LocalHost']) {
    assert.match(operatorPortRoute(rule(s), 7879) || '', /loopback port 80/, s);
  }
});

test('the published port, a status rule, a remote :80 and a commented-out rule are all allowed', () => {
  assert.equal(operatorPortRoute(rule('http://127.0.0.1:7878'), 7879), null);
  assert.equal(operatorPortRoute(rule('http://10.0.0.5'), 7879), null);
  assert.equal(operatorPortRoute('ingress:\n  - service: http_status:404\n', 7879), null);
  assert.equal(operatorPortRoute('ingress:\n  # - hostname: p\n  #   service: http://127.0.0.1:7879\n', 7879), null);
});

test('a panel whose tunnel reaches loopback :80 refuses to start', () => {
  const cfg = join(TMP, 'config.yml');
  writeFileSync(cfg, rule('http://localhost'));
  const r = spawnSync(process.execPath, [SERVE], {
    env: { ...process.env, CW_CLOUDFLARED_CONFIG: cfg, CW_ADMIN_PORT: '0', CW_ADMIN_LOCAL_PORT: '7879', CW_AUTH_STORE: join(TMP, 'users.json') },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSING TO START: cloudflared routes a hostname to loopback port 80/);
});
