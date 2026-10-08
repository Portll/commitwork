// commitwork help and the scan-images refusal under the experimental flag (lib/feature-flags.mjs).
// Run as a child process with a temp settings store and HOME, because help and the refusal are the
// CLI's own output, not a function's return value.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-cli-exp-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

function run(args, env = {}, storeValue = null) {
  const store = join(TMP, `s-${Math.random().toString(36).slice(2)}.json`);
  if (storeValue) writeFileSync(store, JSON.stringify({ v: 1, settings: { experimentalFeatures: storeValue } }));
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (k.startsWith('CW_FEATURE_') || k === 'CW_EXPERIMENTAL') delete base[k];
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...base, HOME: join(TMP, 'home'), CW_SETTINGS: store, CW_REPORT_DIR: join(TMP, 'rd'), ...env },
    encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(r.error, undefined, String(r.error));
  return r;
}
// From "usage" to the first heading after it: the off section, or options.
const usageBlock = (out) => {
  const from = out.indexOf('usage');
  const ends = [out.indexOf('experimental (off)'), out.indexOf('\noptions')].filter((i) => i > from);
  return out.slice(from, Math.min(...ends));
};

test('ON (the default): scan-images is listed in place and labelled experimental', () => {
  const r = run(['help']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(usageBlock(r.stdout), /commitwork scan-images[\s\S]*OS packages \+ language deps\) \[experimental\]/);
  assert.doesNotMatch(r.stdout, /experimental \(off\)/);
});

test('OFF in the store: moved under "experimental (off)" with the variable that turns it back on', () => {
  const r = run(['help'], {}, { 'scan-images': 'off' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(usageBlock(r.stdout), /commitwork scan-images/, 'still listed among the usable commands');
  assert.match(r.stdout, /experimental \(off\)\n {2}commitwork scan-images[\s\S]*switched off: CW_FEATURE_SCAN_IMAGES=on/);
});

test('OFF: running it exits 2 naming the flag, and nothing is scanned', () => {
  const r = run(['scan-images'], { CW_FEATURE_SCAN_IMAGES: 'off' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /commitwork scan-images: experimental feature "scan-images" .*switched off.*CW_FEATURE_SCAN_IMAGES/);
  assert.doesNotMatch(r.stdout, /images=/, 'the scan banner printed: the command ran');
});

test('the per-flag variable beats CW_EXPERIMENTAL', () => {
  const r = run(['help'], { CW_EXPERIMENTAL: 'off', CW_FEATURE_SCAN_IMAGES: 'on' });
  assert.match(usageBlock(r.stdout), /\[experimental\]/);
  const off = run(['help'], { CW_EXPERIMENTAL: 'off' });
  assert.match(off.stdout, /experimental \(off\)/);
});
