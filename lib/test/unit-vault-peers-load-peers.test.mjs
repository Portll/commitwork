// Reads and validates the peer roster file, or an empty roster when it is absent (lib/vault-peers.mjs loadPeers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPeers } from '../vault-peers.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const spki = '-----BEGIN PUBLIC KEY-----\n' + 'A'.repeat(44) + '\n-----END PUBLIC KEY-----\n';

function withRoster(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadPeers-'));
  try {
    const path = join(dir, 'peers.json');
    if (content !== undefined) writeFileSync(path, content);
    fn(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const notRoster = (path) => ({ name: 'Error', message: `vault-peers: roster at ${path} is not a peer roster` });

test('A missing roster file yields an empty version 1 roster', () => {
  withRoster(undefined, (path) => {
    assert.deepEqual(loadPeers({ CW_VAULT_PEERS: path }), { version: 1, peers: {} });
  });
});

test('A roster path that is a directory is reported as unreadable instead of empty', () => {
  withRoster(undefined, (path, dir) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: dir }), {
      name: 'Error',
      message: `vault-peers: roster at ${dir} is unreadable (EISDIR); refusing to treat it as empty`,
    });
  });
});

test('An empty roster file is rejected as invalid JSON', () => {
  withRoster('', (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), {
      name: 'Error',
      message: `vault-peers: roster at ${path} is not valid JSON (Unexpected end of JSON input); refusing to treat it as empty`,
    });
  });
});

test('A JSON null roster is rejected as not a peer roster', () => {
  withRoster('null', (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
});

test('A number or an array at the top level is rejected as not a peer roster', () => {
  withRoster('42', (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
  withRoster(JSON.stringify([{ peers: {} }]), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
});

test('A roster whose peers is missing or null is rejected as not a peer roster', () => {
  withRoster(JSON.stringify({ version: 1 }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
  withRoster(JSON.stringify({ version: 1, peers: null }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
});

test('A roster whose peers is a truthy non-object is rejected as not a peer roster', () => {
  withRoster(JSON.stringify({ version: 1, peers: 7 }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
  withRoster(JSON.stringify({ version: 1, peers: true }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), notRoster(path));
  });
});

test('A peer with an unknown or missing mechanism is rejected by name', () => {
  withRoster(JSON.stringify({ version: 1, peers: { bob: { mechanism: 'rsa', publicKey: spki } } }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), {
      name: 'Error',
      message: 'vault-peers: bob declares unknown mechanism "rsa"',
    });
  });
  withRoster(JSON.stringify({ version: 1, peers: { carol: { publicKey: spki } } }), (path) => {
    assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), {
      name: 'Error',
      message: 'vault-peers: carol declares unknown mechanism undefined',
    });
  });
});

test('A peer whose public key is not an SPKI PEM string is rejected by name', () => {
  for (const publicKey of ['nope', 5, undefined]) {
    withRoster(JSON.stringify({ version: 1, peers: { dave: { mechanism: 'ed25519', publicKey } } }), (path) => {
      assert.throws(() => loadPeers({ CW_VAULT_PEERS: path }), {
        name: 'Error',
        message: 'vault-peers: dave has no SPKI public key',
      });
    });
  }
});

test('A valid roster is returned exactly as parsed', () => {
  const roster = {
    version: 2,
    peers: {
      alice: { mechanism: 'ed25519', publicKey: spki, label: 'laptop' },
      erin: { mechanism: 'ed25519', publicKey: 'BEGIN PUBLIC KEY' },
    },
  };
  withRoster(JSON.stringify(roster), (path) => {
    assert.deepEqual(loadPeers({ CW_VAULT_PEERS: path }), roster);
  });
  withRoster(JSON.stringify({ version: 3, peers: {} }), (path) => {
    assert.deepEqual(loadPeers({ CW_VAULT_PEERS: path }), { version: 3, peers: {} });
  });
});
