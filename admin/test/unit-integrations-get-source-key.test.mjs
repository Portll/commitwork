// getSourceKey: the source's own env var wins, then its stored key, and anything unreadable or empty is null.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSourceKey } from '../integrations.mjs';
import { ignoresPermissions, withUnreadable } from '../../lib/fs-unreadable.mjs';

const VARS = ['CW_INTEGRATIONS_STORE', 'CW_VULNCHECK_KEY', 'CW_SONATYPE_KEY', 'CW_SNYK_KEY'];

function withEnv({ store, env = {} }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-get-source-key-'));
  const storePath = join(dir, 'integrations.json');
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) delete process.env[k];
  process.env.CW_INTEGRATIONS_STORE = storePath;
  Object.assign(process.env, env);
  try {
    if (store !== undefined) writeFileSync(storePath, typeof store === 'string' ? store : JSON.stringify(store));
    return fn(storePath);
  } finally {
    for (const k of VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(dir, { recursive: true, force: true });
  }
}

const stored = (sources) => ({ version: 1, sources });

test('an unknown source throws, naming the known ones', () => {
  withEnv({}, () => {
    assert.throws(() => getSourceKey('unknown'), { message: "unknown integration source 'unknown' — known: vulncheck, sonatype, snyk" });
  });
});

test('each source reads its own env var', () => {
  withEnv({ env: { CW_VULNCHECK_KEY: 'vc-env', CW_SONATYPE_KEY: 'st-env', CW_SNYK_KEY: 'sn-env' } }, () => {
    assert.equal(getSourceKey('vulncheck'), 'vc-env');
    assert.equal(getSourceKey('sonatype'), 'st-env');
    assert.equal(getSourceKey('snyk'), 'sn-env');
  });
});

test('an env key wins over a stored key', () => {
  withEnv({ store: stored({ sonatype: { key: 'st-stored' } }), env: { CW_SONATYPE_KEY: 'st-env' } }, () => {
    assert.equal(getSourceKey('sonatype'), 'st-env');
  });
});

test('another source env var does not stand in for this one', () => {
  withEnv({ env: { CW_VULNCHECK_KEY: 'vc-env' } }, () => {
    assert.equal(getSourceKey('snyk'), null);
  });
});

test('a stored key is returned for its own source only', () => {
  withEnv({ store: stored({ vulncheck: { key: 'vc-stored' }, snyk: { key: 'sn-stored' } }) }, () => {
    assert.equal(getSourceKey('vulncheck'), 'vc-stored');
    assert.equal(getSourceKey('snyk'), 'sn-stored');
    assert.equal(getSourceKey('sonatype'), null);
  });
});

test('a stored record without a usable key is null', () => {
  withEnv({ store: stored({ vulncheck: {}, snyk: { key: '' } }) }, () => {
    assert.equal(getSourceKey('vulncheck'), null);
    assert.equal(getSourceKey('snyk'), null);
  });
});

test('an absent store is null', () => {
  withEnv({}, () => {
    assert.equal(getSourceKey('vulncheck'), null);
  });
});

test('a store that is not valid JSON is null, not a throw', () => {
  withEnv({ store: '{"version":1,"sources":{"vulncheck":{"key":"vc-stored"' }, () => {
    assert.equal(getSourceKey('vulncheck'), null);
  });
});

test('an unreadable store is null, not a throw', (t) => {
  if (ignoresPermissions()) return t.skip('elevated process ignores read denial');
  withEnv({ store: stored({ vulncheck: { key: 'vc-stored' } }) }, (storePath) => {
    const r = withUnreadable(storePath, () => getSourceKey('vulncheck'));
    if (!r.ran) return t.skip(r.why);
    assert.equal(r.value, null);
  });
});
