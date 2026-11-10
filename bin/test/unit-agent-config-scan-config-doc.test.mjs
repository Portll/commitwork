// Scans a parsed agent config document for security findings (bin/agent-config.mjs scanConfigDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanConfigDoc } from '../agent-config.mjs';

test('returns empty array for non-object input', () => {
  assert.deepEqual(scanConfigDoc('a.json', null), []);
  assert.deepEqual(scanConfigDoc('a.json', 42), []);
  assert.deepEqual(scanConfigDoc('a.json', 'text'), []);
  assert.deepEqual(scanConfigDoc('a.json', []), []);
});

test('returns empty array for empty object', () => {
  assert.deepEqual(scanConfigDoc('a.json', {}), []);
});

test('flags mcp-remote-server for non-loopback host in url', () => {
  const doc = { mcpServers: { s1: { url: 'https://example.com/api' } } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'mcp-remote-server');
  assert.equal(f[0].sev, 'high');
  assert.equal(f[0].cwe, 'CWE-829');
  assert.equal(f[0].path, 'a.json');
  assert.equal(f[0].key, 's1');
  assert.match(f[0].detail, /reaches non-loopback host example\.com/);
});

test('flags mcp-remote-server for non-loopback host in args', () => {
  const doc = { mcpServers: { s1: { url: 'http://127.0.0.1:8080', args: ['https://evil.com/x'] } } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'mcp-remote-server');
  assert.match(f[0].detail, /reaches non-loopback host evil\.com/);
});

test('does not flag loopback hosts', () => {
  const doc = { mcpServers: { s1: { url: 'http://127.0.0.1:8080' } } };
  assert.deepEqual(scanConfigDoc('a.json', doc), []);
});

test('flags mcp-command-shell for shell command', () => {
  const doc = { mcpServers: { s1: { command: 'bash', args: ['-c', 'echo hi'] } } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'mcp-command-shell');
  assert.equal(f[0].sev, 'high');
  assert.match(f[0].detail, /command is bash/);
});

test('flags mcp-command-shell for node -e', () => {
  const doc = { mcpServers: { s1: { command: 'node', args: ['-e', 'console.log(1)'] } } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'mcp-command-shell');
  assert.match(f[0].detail, /node evaluates inline code/);
});

test('flags mcp-host-from-env for env var in url', () => {
  const doc = { mcpServers: { s1: { url: 'https://$HOST/api' } } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 2);
  assert.equal(f[0].rule, 'mcp-remote-server');
  assert.equal(f[1].rule, 'mcp-host-from-env');
  assert.equal(f[1].sev, 'med');
  assert.match(f[1].detail, /url host from HOST/);
});

test('flags hook-shell-out for curl in hook command', () => {
  const doc = { hooks: { 'PreToolUse': [{ command: 'curl https://example.com' }] } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'hook-shell-out');
  assert.equal(f[0].sev, 'high');
  assert.equal(f[0].key, 'PreToolUse');
  assert.match(f[0].detail, /network fetch to example\.com/);
});

test('flags permissions-allow-broad for bare Bash', () => {
  const doc = { permissions: { allow: ['Bash'] } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 2);
  assert.equal(f[0].rule, 'permissions-allow-broad');
  assert.equal(f[0].sev, 'med');
  assert.match(f[0].detail, /bare Bash grants every invocation/);
  assert.equal(f[1].rule, 'permissions-deny-missing');
  assert.equal(f[1].sev, 'low');
  assert.equal(f[1].key, 'permissions.deny');
  assert.match(f[1].detail, /1 Bash grant/);
});

test('flags permissions-deny-missing when Bash grant without deny', () => {
  const doc = { permissions: { allow: ['Bash(curl *)'] } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 2);
  assert.equal(f[0].rule, 'permissions-allow-broad');
  assert.equal(f[1].rule, 'permissions-deny-missing');
  assert.equal(f[1].sev, 'low');
  assert.equal(f[1].key, 'permissions.deny');
  assert.match(f[1].detail, /1 Bash grant/);
});

test('flags env-secret-inline for top-level env with secret-shaped value', () => {
  const doc = { env: { API_KEY: 'sk-abcdef1234567890abcdef1234567890' } };
  const f = scanConfigDoc('a.json', doc);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'env-secret-inline');
  assert.equal(f[0].sev, 'crit');
  assert.equal(f[0].key, 'API_KEY');
  assert.match(f[0].detail, /env key API_KEY holds an inline credential-shaped value/);
});
