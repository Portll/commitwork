// Validated, frozen and cached LLM host manifest (monitor/llm-hosts.mjs loadLlmHosts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLlmHosts } from '../llm-hosts.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST_SCHEMA = {
  type: 'object',
  required: ['id', 'baseUrl', 'portIsShared'],
  properties: { id: { type: 'string' }, baseUrl: { type: 'string' }, portIsShared: { type: 'boolean' } }
};
const SCHEMA = {
  type: 'object',
  required: ['hosts', 'default', 'probeOrder'],
  properties: {
    hosts: { type: 'array', items: HOST_SCHEMA },
    default: { type: 'string' },
    probeOrder: { type: 'array', items: { type: 'string' } }
  }
};

const host = (id, baseUrl, portIsShared) => ({ id, baseUrl, portIsShared });
const doc = (hosts, extra = {}) => ({ hosts, default: hosts[0].id, probeOrder: hosts.map((h) => h.id), ...extra });
const UNIQUE = [host('a', 'http://127.0.0.1:1111', false), host('b', 'http://127.0.0.1:2222', false)];
const refuses = (message) => assert.throws(() => loadLlmHosts({ force: true }), { name: 'Error', message });

function withManifest(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadLlmHosts-'));
  const manifest = join(dir, 'manifest.json');
  const schema = join(dir, 'schema.json');
  const write = (value, path = manifest) => writeFileSync(path, JSON.stringify(value));
  try {
    write(SCHEMA, schema);
    process.env.CW_LLM_HOSTS = manifest;
    process.env.CW_LLM_HOSTS_SCHEMA = schema;
    fn({ dir, manifest, write });
  } finally {
    delete process.env.CW_LLM_HOSTS;
    delete process.env.CW_LLM_HOSTS_SCHEMA;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the frozen manifest when every host has its own port', () => {
  withManifest(({ write }) => {
    const input = doc(UNIQUE);
    write(input);
    const r = loadLlmHosts();
    assert.deepEqual(r, input);
    assert.equal(Object.isFrozen(r), true);
  });
});

test('accepts portIsShared true on exactly the two hosts that share a port', () => {
  withManifest(({ write }) => {
    const input = doc([
      host('a', 'http://127.0.0.1:1111', true),
      host('b', 'http://localhost:1111', true),
      host('c', 'http://127.0.0.1:2222', false)
    ]);
    write(input);
    assert.deepEqual(loadLlmHosts(), input);
  });
});

test('counts URLs without an explicit port as sharing port 80', () => {
  withManifest(({ write }) => {
    const input = doc([host('a', 'http://127.0.0.1', true), host('b', 'http://localhost/v1', true)]);
    write(input);
    assert.deepEqual(loadLlmHosts(), input);
  });
});

test('returns the cached object for the same path without re-reading the file', () => {
  withManifest(({ write }) => {
    write(doc(UNIQUE));
    const first = loadLlmHosts();
    write(doc(UNIQUE, { default: 'b' }));
    const second = loadLlmHosts();
    assert.equal(second, first);
    assert.equal(second.default, 'a');
  });
});

test('force re-reads the file and replaces the cached object', () => {
  withManifest(({ write }) => {
    write(doc(UNIQUE));
    loadLlmHosts();
    const input = doc(UNIQUE, { default: 'b' });
    write(input);
    const forced = loadLlmHosts({ force: true });
    assert.deepEqual(forced, input);
    assert.equal(loadLlmHosts(), forced);
  });
});

test('reads the new file when the manifest path changes without force', () => {
  withManifest(({ dir, write }) => {
    write(doc(UNIQUE));
    loadLlmHosts();
    const other = join(dir, 'other.json');
    const input = doc(UNIQUE, { default: 'b', probeOrder: ['b'] });
    write(input, other);
    process.env.CW_LLM_HOSTS = other;
    assert.deepEqual(loadLlmHosts(), input);
  });
});

test('refuses to report an empty host list when the manifest is missing', () => {
  withManifest(({ manifest }) => {
    refuses(
      `llm-hosts: ${manifest} could not be read (ENOENT: no such file or directory, open '${manifest}') \u2014 ` +
        'refusing to report an empty host list, which would render as "no local LLM detected" and read as a normal state'
    );
  });
});

test('rejects a manifest that is not valid JSON', () => {
  withManifest(({ manifest }) => {
    writeFileSync(manifest, '{bad');
    let detail = '';
    try {
      JSON.parse('{bad');
    } catch (e) {
      detail = e.message;
    }
    refuses(`llm-hosts: ${manifest} is not valid JSON (${detail})`);
  });
});

test('rejects duplicate ids, an undeclared default and stray probeOrder entries', () => {
  withManifest(({ write }) => {
    write(doc([UNIQUE[0], { ...UNIQUE[1], id: 'a' }]));
    refuses('llm-hosts: duplicate host id \u2014 a declaration that names one host twice');
    write(doc(UNIQUE, { default: 'z' }));
    refuses('llm-hosts: default "z" is not a declared host');
    write(doc(UNIQUE, { probeOrder: ['a', 'y', 'z'] }));
    refuses(
      'llm-hosts: probeOrder names y, z, which no host declares \u2014 ' +
        'a probe order pointing at nothing silently shortens detection'
    );
  });
});

test('rejects a portIsShared flag that disagrees with the port count', () => {
  const tail = '\u2014 the field decides whether a probe may name this host';
  withManifest(({ write }) => {
    write(doc([host('a', 'http://127.0.0.1:1111', false), host('b', 'http://localhost:1111', false)]));
    refuses(`llm-hosts: a declares portIsShared=false but port 1111 is used by 2 host(s) ${tail}`);
    write(doc([host('a', 'http://127.0.0.1:1111', true), host('b', 'http://127.0.0.1:2222', false)]));
    refuses(`llm-hosts: a declares portIsShared=true but port 1111 is used by 1 host(s) ${tail}`);
    write(doc([host('a', 'http://127.0.0.1', true)]));
    refuses(`llm-hosts: a declares portIsShared=true but port 80 is used by 1 host(s) ${tail}`);
  });
});
