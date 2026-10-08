// admin/integrations.mjs — third-party vuln-intel credentials. Same store discipline as auth.mjs
// (0600, atomic, fail-closed, cross-process lock), tested at the smaller surface this module has:
// no login flow, just store/retrieve/rotate/redact, plus the env-override-always-wins rule that is
// this module's actual point (it's what makes a source usable headless).

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOD = new URL('../integrations.mjs', import.meta.url).href;

// AWAITS fn before restoring the env — fn is async (it dynamic-imports the module under test), and
// a bare try/finally around a call that RETURNS a promise restores the env synchronously, before
// the awaited body inside fn ever runs. Caught by running this file in isolation: the store file
// was never created because CW_INTEGRATIONS_STORE had already been unset by the time setSourceKey
// read it.
async function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-integrations-'));
  const store = join(dir, 'integrations.json');
  const prev = process.env.CW_INTEGRATIONS_STORE;
  process.env.CW_INTEGRATIONS_STORE = store;
  try { return await fn(store); } finally {
    if (prev === undefined) delete process.env.CW_INTEGRATIONS_STORE; else process.env.CW_INTEGRATIONS_STORE = prev;
  }
}

afterEach(() => {
  for (const k of ['CW_VULNCHECK_KEY', 'CW_SONATYPE_KEY', 'CW_SNYK_KEY', 'CW_INTEGRATIONS_STORE']) delete process.env[k];
});

describe('store basics', () => {
  test('a fresh store reports every source as none, not absent-as-error', async () => {
    await withStore(async () => {
      const { listSources } = await import(`${MOD}?t=${Math.random()}`);
      const rows = listSources();
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => r.source === 'none' && r.key === null));
    });
  });

  test('set then get round-trips the full key; listSources only ever shows the redacted tail', async () => {
    await withStore(async () => {
      const { setSourceKey, getSourceKey, listSources, testKey } = await import(`${MOD}?t=${Math.random()}`);
      const key = testKey();
      setSourceKey('vulncheck', key);
      assert.equal(getSourceKey('vulncheck'), key);
      const row = listSources().find((r) => r.name === 'vulncheck');
      assert.equal(row.source, 'stored');
      assert.ok(!row.key.includes(key), 'the redacted listing must never contain the full key');
      assert.equal(row.key, `••••${key.slice(-4)}`);
    });
  });

  test('remove clears the key; a second remove is a no-op that says so', async () => {
    await withStore(async () => {
      const { setSourceKey, removeSourceKey, getSourceKey, testKey } = await import(`${MOD}?t=${Math.random()}`);
      setSourceKey('sonatype', testKey());
      const r1 = removeSourceKey('sonatype');
      assert.equal(r1.removed, true);
      assert.equal(getSourceKey('sonatype'), null);
      const r2 = removeSourceKey('sonatype');
      assert.equal(r2.removed, false);
    });
  });

  test('an unknown source name is refused, not silently accepted', async () => {
    await withStore(async () => {
      const { setSourceKey, getSourceKey, removeSourceKey } = await import(`${MOD}?t=${Math.random()}`);
      assert.throws(() => setSourceKey('typo-source', 'x'), /unknown integration source/);
      assert.throws(() => getSourceKey('typo-source'), /unknown integration source/);
      assert.throws(() => removeSourceKey('typo-source'), /unknown integration source/);
    });
  });

  test('an empty key is refused', async () => {
    await withStore(async () => {
      const { setSourceKey } = await import(`${MOD}?t=${Math.random()}`);
      assert.throws(() => setSourceKey('vulncheck', ''), /must not be empty/);
      assert.throws(() => setSourceKey('vulncheck', '   '), /must not be empty/);
    });
  });

  test('the store file is written 0600', async () => {
    await withStore(async (storePath) => {
      const { setSourceKey, testKey } = await import(`${MOD}?t=${Math.random()}`);
      setSourceKey('vulncheck', testKey());
      const mode = statSync(storePath).mode & 0o777;
      assert.equal(mode, 0o600);
    });
  });
});

describe('env override — the headless path', () => {
  test('an env var wins over a stored key, and says so in listSources', async () => {
    await withStore(async () => {
      const { setSourceKey, getSourceKey, listSources, testKey } = await import(`${MOD}?t=${Math.random()}`);
      const stored = testKey();
      const envKey = testKey();
      setSourceKey('vulncheck', stored);
      process.env.CW_VULNCHECK_KEY = envKey;
      assert.equal(getSourceKey('vulncheck'), envKey, 'env must win even though a key is stored');
      const row = listSources().find((r) => r.name === 'vulncheck');
      assert.equal(row.source, 'env');
      assert.equal(row.key, `••••${envKey.slice(-4)}`);
    });
  });

  test('the env var is read at CALL time, not cached at import', async () => {
    await withStore(async () => {
      const { getSourceKey } = await import(`${MOD}?t=${Math.random()}`);
      assert.equal(getSourceKey('snyk'), null, 'unset at first call');
      process.env.CW_SNYK_KEY = 'set-after-import';
      assert.equal(getSourceKey('snyk'), 'set-after-import', 'a later env write must still be seen');
    });
  });

  test('with no env and no stored key, getSourceKey is null and listSources says none', async () => {
    await withStore(async () => {
      const { getSourceKey, listSources } = await import(`${MOD}?t=${Math.random()}`);
      assert.equal(getSourceKey('snyk'), null);
      assert.equal(listSources().find((r) => r.name === 'snyk').source, 'none');
    });
  });
});

describe('fail closed', () => {
  test('an unreadable/corrupt store throws from loadStore rather than reading as empty', async () => {
    await withStore(async (storePath) => {
      writeFileSync(storePath, 'not json');
      const { loadStore } = await import(`${MOD}?t=${Math.random()}`);
      assert.throws(() => loadStore(), /not valid JSON/);
    });
  });

  test('a corrupt store makes getSourceKey fail closed to null, not throw into a caller that just wants a key', async () => {
    await withStore(async (storePath) => {
      writeFileSync(storePath, 'not json');
      const { getSourceKey } = await import(`${MOD}?t=${Math.random()}`);
      assert.equal(getSourceKey('vulncheck'), null);
    });
  });

  test('a corrupt store reports every source as unknown in listSources, never falsely none', async () => {
    await withStore(async (storePath) => {
      writeFileSync(storePath, 'not json');
      const { listSources } = await import(`${MOD}?t=${Math.random()}`);
      const rows = listSources();
      assert.ok(rows.every((r) => r.source === 'unknown'), 'unreadable is a different fact from configured-to-nothing');
    });
  });
});

describe('cross-process lock', () => {
  const mutate = (store, name, key) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.CW_INTEGRATIONS_STORE = ${JSON.stringify(store)};
    const m = await import(${JSON.stringify(MOD)});
    m.setSourceKey(${JSON.stringify(name)}, ${JSON.stringify(key)});
    process.stdout.write('done');
  `], { encoding: 'utf8' });

  test('concurrent writers on different sources do not lose each other\'s writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-integrations-lock-'));
    const store = join(dir, 'integrations.json');
    writeFileSync(store, JSON.stringify({ version: 1, sources: {} }));
    const outs = [
      mutate(store, 'vulncheck', 'k-vulncheck'),
      mutate(store, 'sonatype', 'k-sonatype'),
      mutate(store, 'snyk', 'k-snyk'),
    ];
    assert.ok(outs.every((o) => o === 'done'));
    const final = JSON.parse(readFileSync(store, 'utf8'));
    assert.equal(final.sources.vulncheck.key, 'k-vulncheck');
    assert.equal(final.sources.sonatype.key, 'k-sonatype');
    assert.equal(final.sources.snyk.key, 'k-snyk');
  });
});
