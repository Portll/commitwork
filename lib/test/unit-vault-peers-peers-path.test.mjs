// The peers file path, from CW_VAULT_PEERS or else the home directory default (lib/vault-peers.mjs peersPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { peersPath } from '../vault-peers.mjs';

const defaultPath = join(process.env.HOME, '.commitwork', 'peers.json');

test('returns the CW_VAULT_PEERS value when it is set', () => {
  const r = peersPath({ CW_VAULT_PEERS: '/tmp/custom-peers.json' });
  assert.equal(r, '/tmp/custom-peers.json');
});

test('returns the default home path when CW_VAULT_PEERS is undefined', () => {
  const r = peersPath({});
  assert.equal(r, defaultPath);
});

test('returns the default home path when CW_VAULT_PEERS is an empty string', () => {
  const r = peersPath({ CW_VAULT_PEERS: '' });
  assert.equal(r, defaultPath);
});

test('returns the CW_VAULT_PEERS value when it is a relative path', () => {
  const r = peersPath({ CW_VAULT_PEERS: 'relative/peers.json' });
  assert.equal(r, 'relative/peers.json');
});

test('returns the default home path when CW_VAULT_PEERS is zero', () => {
  const r = peersPath({ CW_VAULT_PEERS: 0 });
  assert.equal(r, defaultPath);
});

test('returns the CW_VAULT_PEERS value when it is a boolean true', () => {
  const r = peersPath({ CW_VAULT_PEERS: true });
  assert.equal(r, true);
});

test('returns the default home path when CW_VAULT_PEERS is boolean false', () => {
  const r = peersPath({ CW_VAULT_PEERS: false });
  assert.equal(r, defaultPath);
});

test('returns the CW_VAULT_PEERS value when it is a long repeated string', () => {
  const r = peersPath({ CW_VAULT_PEERS: 'x'.repeat(100) });
  assert.equal(r, 'x'.repeat(100));
});

test('returns a single-character CW_VAULT_PEERS value unchanged', () => {
  const r = peersPath({ CW_VAULT_PEERS: 'a' });
  assert.equal(r, 'a');
});
