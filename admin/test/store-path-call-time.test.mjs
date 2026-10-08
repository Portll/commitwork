// THE CREDENTIAL STORES RESOLVE AT CALL TIME, AND PIN INSIDE A LOCKED OPERATION.
//
// admin/auth.mjs and admin/integrations.mjs each held `export const STORE_PATH = process.env.CW_* ||
// <home>`, resolved once at module load. The repo's rule is that every input path is env-overridable
// and read at CALL time, precisely because a load-time const silently defeats any test that sets the
// variable afterwards — the test passes while operating on the operator's REAL credential store.
//
// It was not hypothetical: an integrations test wrote a live third-party key into the operator's
// actual ~/.commitwork/integrations.json on 2026-09-01 and it sat there for about three minutes.
// Four auth test files carried comments describing the workaround rather than the fix.
//
// These tests are written to FAIL on the old code. Under a module-load const, `resolves the env set
// AFTER import` cannot pass — that is the whole point of it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { authStorePath, integrationsStorePath } from '../../monitor/store-paths.mjs';

const withEnv = (name, value, fn) => {
  const prev = process.env[name];
  if (value === null) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally { if (prev === undefined) delete process.env[name]; else process.env[name] = prev; }
};

describe('the resolvers read the env at call time', () => {
  test('an override set AFTER import is honoured — the property the const could not have', () => {
    // This module imported store-paths at load. If the path were captured then, nothing below
    // could move it.
    const to = join(tmpdir(), 'cw-callsite', 'users.json');
    withEnv('CW_AUTH_STORE', to, () => assert.equal(authStorePath(), to));
    withEnv('CW_INTEGRATIONS_STORE', to, () => assert.equal(integrationsStorePath(), to));
  });

  test('unset falls back to the operator home — the default is unchanged by this work', () => {
    withEnv('CW_AUTH_STORE', null, () => {
      assert.equal(authStorePath(), join(homedir(), '.commitwork', 'users.json'));
    });
    withEnv('CW_INTEGRATIONS_STORE', null, () => {
      assert.equal(integrationsStorePath(), join(homedir(), '.commitwork', 'integrations.json'));
    });
  });

  test('a RELATIVE override resolves against cwd, so the same value means one file', () => {
    // store-paths.mjs's own header records why: four resolvers disagreed on whether to resolve a
    // relative override, so one value meant different files depending on cwd.
    withEnv('CW_AUTH_STORE', 'rel/users.json', () => {
      assert.equal(authStorePath(), join(process.cwd(), 'rel', 'users.json'));
    });
  });

  test('the two stores never resolve to the same file', () => {
    withEnv('CW_AUTH_STORE', null, () => withEnv('CW_INTEGRATIONS_STORE', null, () => {
      assert.notEqual(authStorePath(), integrationsStorePath());
    }));
  });
});

describe('a locked operation is atomic with respect to its target', () => {
  test('a load and its save cannot land in different files, even if the env moves mid-operation', async () => {
    // THE RISK THIS FIX INTRODUCES, AND THE MITIGATION. A const made it impossible to read one
    // store and write another; call-time resolution reintroduces exactly that, in a store where a
    // lost write is a burned TOTP step or a spent recovery code with no undo. withStoreLock()
    // resolves ONCE on entry, so everything inside names one file.
    const a = mkdtempSync(join(tmpdir(), 'cw-pin-a-'));
    const b = mkdtempSync(join(tmpdir(), 'cw-pin-b-'));
    const storeA = join(a, 'users.json');
    const storeB = join(b, 'users.json');
    process.env.CW_AUTH_STORE = storeA;
    // dynamic, so the pin below is exercised against a module that loaded with storeA in view
    const auth = await import(`../auth.mjs?pin=${Date.now()}`);
    try {
      auth.bootstrapRoot({ email: 'pin@example.com', password: 'correct horse battery staple' });
      assert.ok(existsSync(storeA), 'the bootstrap must have written to the pinned store');

      // Move the env to B and perform an operation that loads, mutates and saves. Under the pin it
      // must complete entirely in ONE store. Which store is not the point — that it is one is.
      process.env.CW_AUTH_STORE = storeB;
      auth.setExternalSsoAllowed(true);

      const wroteA = existsSync(storeA) && JSON.parse(readFileSync(storeA, 'utf8'));
      const wroteB = existsSync(storeB) && JSON.parse(readFileSync(storeB, 'utf8'));
      const landed = [wroteA, wroteB].filter((x) => x && x.settings && x.settings.allowExternalSso === true);
      assert.equal(landed.length, 1,
        'the setting landed in neither store or in both — a load and its save named different files');

      // WHICH store it targets is decided at lock time and is NOT the property under test. Moving
      // the env moves the target, which is what call-time resolution means. What must not happen is
      // a SPLIT: reading one file and writing another. So the store it did not touch must be
      // exactly as it was — a half-applied operation would show up here as A losing its user or
      // gaining the setting.
      assert.equal(wroteA.users.length, 1, 'the untargeted store lost data — the operation split');
      assert.notEqual(wroteA.settings && wroteA.settings.allowExternalSso, true,
        'the setting reached BOTH stores — the operation wrote a file it had not read');
      assert.equal(wroteB.settings.allowExternalSso, true, 'the targeted store did not receive it');
    } finally {
      delete process.env.CW_AUTH_STORE;
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('no module captures a credential path at load', () => {
  test('neither store module declares a module-load const for its path', () => {
    // A source assertion, deliberately: the behavioural tests above prove the resolver is
    // call-time, but they would still pass if someone reintroduced a captured const ALONGSIDE it
    // and used the const on one path. This asserts the shape is gone.
    for (const f of ['../auth.mjs', '../integrations.mjs']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      const captured = src.split('\n').filter((l) => !l.trim().startsWith('//')
        && /^(export )?const [A-Za-z_]+ *= *process\.env\.CW_[A-Z_]*STORE/.test(l.trim()));
      assert.deepEqual(captured, [], `${f} captures a store path at module load`);
    }
  });
});
