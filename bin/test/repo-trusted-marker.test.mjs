// CW_REPO_TRUSTED: the runner's marker for the operator's consent to run code the scanned tree
// supplies. The switch itself is stripped from lane envs; the marker is derived per spawn, after the
// base env, so a scanned tree cannot set it and a bundled command can branch on it (sast-php-psalm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCheckLocal } from '../commitwork.mjs';

function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
}
const marker = (env) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-trust-'));
  try {
    withEnv({ CW_REPORT_DIR: dir, CW_SANDBOX: 'off', ...env },
      () => runCheckLocal({ id: 'trust-probe', local: ['printf %s "$CW_REPO_TRUSTED" > "$CW_REPORT_DIR/trust"'] }, dir));
    return readFileSync(join(dir, 'trust'), 'utf8');
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('a lane sees CW_REPO_TRUSTED=0 by default, and a value in the caller env cannot raise it', () => {
  assert.equal(marker({ COMMITWORK_TRUST_REPO_MANIFEST: null, CW_REPO_TRUSTED: '1' }), '0');
});

test('the operator switch turns the marker on', () => {
  assert.equal(marker({ COMMITWORK_TRUST_REPO_MANIFEST: '1' }), '1');
});
