// bin/panel-smoke.mjs with no usable browser. The rendered path needs Chrome and boots the panel
// from this checkout, so it is not run here; what IS pinned is the refusal that decides whether its
// verdict can be trusted at all: with CW_CHROME naming something that is not a browser binary, the
// tool exits 3 GREY, says why, prints no ✔ line, and never reaches the panel boot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMOKE = join(CW, 'bin', 'panel-smoke.mjs');

function run(t, chrome) {
  const env = { ...process.env, CW_CHROME: chrome,
    // belt and braces: if the refusal ever stopped refusing, the boot must not reach a real store
    CW_AUTH_STORE: join(tmpdir(), 'cw-panel-smoke-entry-never-users.json') };
  const r = spawnSync(process.execPath, [SMOKE], { encoding: 'utf8', env, timeout: 30_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('a CW_CHROME that does not exist is GREY (exit 3), not a pass and not a crash', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-panel-smoke-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const chrome = join(dir, 'no-such-chrome');
  const r = run(t, chrome);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.err, `panel-smoke: GREY — CW_CHROME=${chrome} is not a file. Not a pass.\n`);
  assert.equal(r.out, '', 'nothing may be asserted (✔) about a page no browser rendered');
});

test('a CW_CHROME that is a directory is refused the same way', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-panel-smoke-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(t, dir);
  assert.equal(r.code, 3);
  assert.match(r.err, /^panel-smoke: GREY — CW_CHROME=.* is not a file\. Not a pass\.\n$/);
  assert.doesNotMatch(r.out, /bootstrapped/, 'the panel was never booted');
});
