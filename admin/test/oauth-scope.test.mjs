// GitHub sign-in asks only for what identifying the person needs. `repo` grants read and write on
// every private repository the account can see, and nothing in the sign-in path reads one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cw-oauth-scope-'));
const overrides = { CW_AUTH_STORE: join(dir, 'users.json'), CW_SESSION_STORE: join(dir, 'sessions.json'),
  CW_SECRETS_FILE: join(dir, 'secrets.json') };
const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
Object.assign(process.env, overrides);
writeFileSync(overrides.CW_SECRETS_FILE, '{}');
const { OAUTH, GITHUB_LINK_SCOPE } = await import('../lib/auth-session.mjs');
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const tokens = (scope) => String(scope).split(/\s+/).filter(Boolean);

test('GitHub sign-in requests read:user and user:email and nothing else', () => {
  assert.deepEqual(tokens(OAUTH.github.scope).sort(), ['read:user', 'user:email']);
});

test('no OAuth flow requests a repository or organisation scope', () => {
  const broad = /^(repo|public_repo|repo:.*|admin:.*|write:.*|delete_repo|workflow)$/;
  for (const [name, provider] of Object.entries(OAUTH)) {
    for (const t of tokens(provider.scope)) assert.doesNotMatch(t, broad, `${name} requests ${t}`);
  }
  for (const t of tokens(GITHUB_LINK_SCOPE)) assert.doesNotMatch(t, broad, `the account link requests ${t}`);
});
