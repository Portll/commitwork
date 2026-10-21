// Determines package name availability and ownership across registries (lib/launchlist-checks.mjs probePackage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probePackage } from '../launchlist-checks.mjs';

test('npm returns free when registry responds 404', async () => {
  const ctx = {
    fetch: async () => ({ status: 404, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'npm', 'my-pkg');
  assert.deepEqual(res, { registry: 'npm', name: 'my-pkg', state: 'free' });
});

test('npm returns owned when account matches maintainer', async () => {
  const ctx = {
    accounts: { npm: 'alice' },
    fetch: async () => ({
      status: 200,
      json: async () => ({ maintainers: [{ name: 'Alice' }] })
    })
  };
  const res = await probePackage(ctx, 'npm', 'my-pkg');
  assert.deepEqual(res, { registry: 'npm', name: 'my-pkg', state: 'owned', owners: ['alice'] });
});

test('npm returns taken when account does not match maintainer', async () => {
  const ctx = {
    accounts: { npm: 'bob' },
    fetch: async () => ({
      status: 200,
      json: async () => ({ maintainers: [{ name: 'Alice' }] })
    })
  };
  const res = await probePackage(ctx, 'npm', 'my-pkg');
  assert.deepEqual(res, { registry: 'npm', name: 'my-pkg', state: 'taken', owners: ['alice'] });
});

test('npm returns exists when no account is configured', async () => {
  const ctx = {
    fetch: async () => ({
      status: 200,
      json: async () => ({ maintainers: [{ name: 'Alice' }] })
    })
  };
  const res = await probePackage(ctx, 'npm', 'my-pkg');
  assert.deepEqual(res, { registry: 'npm', name: 'my-pkg', state: 'exists', owners: ['alice'] });
});

test('crates returns free when registry responds 404', async () => {
  const ctx = {
    fetch: async () => ({ status: 404, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'crates', 'my-pkg');
  assert.deepEqual(res, { registry: 'crates', name: 'my-pkg', state: 'free' });
});

test('crates returns owned when account matches owner login', async () => {
  const ctx = {
    accounts: { crates: 'alice' },
    fetch: async (url) => {
      if (url.includes('/owners')) {
        return { status: 200, json: async () => ({ users: [{ login: 'Alice' }] }) };
      }
      return { status: 200, json: async () => ({}) };
    }
  };
  const res = await probePackage(ctx, 'crates', 'my-pkg');
  assert.deepEqual(res, { registry: 'crates', name: 'my-pkg', state: 'owned', owners: ['alice'] });
});

test('pypi returns owned when name is in pypiOwned list', async () => {
  const ctx = {
    cfg: { packages: { pypiOwned: ['my-pkg'] } },
    fetch: async () => ({ status: 200, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'pypi', 'my-pkg');
  assert.deepEqual(res, { registry: 'pypi', name: 'my-pkg', state: 'owned', owners: [] });
});

test('pypi returns exists when name is not in pypiOwned list', async () => {
  const ctx = {
    cfg: { packages: { pypiOwned: ['other-pkg'] } },
    fetch: async () => ({ status: 200, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'pypi', 'my-pkg');
  assert.deepEqual(res, { registry: 'pypi', name: 'my-pkg', state: 'exists', owners: [] });
});

test('docker returns owned when namespace matches account', async () => {
  const ctx = {
    accounts: { docker: 'myorg' },
    fetch: async () => ({ status: 200, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'docker', 'myorg/my-image');
  assert.deepEqual(res, { registry: 'docker', name: 'myorg/my-image', state: 'owned', owners: ['myorg'] });
});

test('docker returns exists when namespace does not match account', async () => {
  const ctx = {
    accounts: { docker: 'otherorg' },
    fetch: async () => ({ status: 200, json: async () => ({}) })
  };
  const res = await probePackage(ctx, 'docker', 'myorg/my-image');
  assert.deepEqual(res, { registry: 'docker', name: 'myorg/my-image', state: 'exists', owners: ['myorg'] });
});
