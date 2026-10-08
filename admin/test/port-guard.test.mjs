// The test-context port guard (admin/serve.mjs) — substrate's tidal hang, the commitwork twin,
// pinned. A test that spawns the panel without choosing a port must die in MILLISECONDS naming
// the fix, not race the live panel on :7878. NODE_TEST_CONTEXT is already in our env (node --test
// sets it) and the spawned child inherits it — the exact property the guard rides.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');

test('spawning the panel under node --test without CW_ADMIN_PORT refuses fast, fix named', () => {
  const env = { ...process.env };
  delete env.CW_ADMIN_PORT;                          // the bug under test: nobody chose a port
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SERVE], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 2, r.stderr);
  assert.ok(Date.now() - t0 < 15_000, 'refusal is fast — the alternative was a multi-minute race');
  for (const m of ['CW_ADMIN_PORT', 'CW_TEST_PORTS_OK']) assert.ok(r.stderr.includes(m), `names ${m}`);
});
