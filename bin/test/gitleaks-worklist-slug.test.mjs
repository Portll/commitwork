// .gitleaks.toml exempts an item slug in the programme worklist from generic-api-key, and only
// there: the same line in any other file, and a key-shaped value in the worklist, still match.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const has = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
const TMP = mkdtempSync(join(tmpdir(), 'cw-gl-wl-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

// Built at run time so this source carries no key-shaped literal of its own.
const SLUG = ['consolidation', '24', '14'].join('-');
const KEYISH = Array.from({ length: 32 }, (_, i) => 'aB3xQ9mZ7kT2wR5p'[(i * 7) % 16]).join('');

function scan(files) {
  const dir = mkdtempSync(join(TMP, 'tree-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const report = join(dir, '..', `${dir.split('/').pop()}.json`);
  const r = spawnSync('gitleaks', ['dir', dir, '--config', join(CW, '.gitleaks.toml'), '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '0'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `gitleaks did not run:\n${r.stderr}`);
  return JSON.parse(readFileSync(report, 'utf8')).filter((f) => f.RuleID === 'generic-api-key').map((f) => f.File.slice(dir.length + 1)).sort();
}

test('a worklist slug is exempt in the worklist and matches anywhere else', (t) => {
  if (!has) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed on this machine');
  const line = `[\n {\n  "key": "${SLUG}"\n }\n]\n`;
  assert.deepEqual(scan({ 'monitor/program-worklist.json': line, 'monitor/other.json': line }), ['monitor/other.json']);
});

test('a key-shaped value in the worklist still matches', (t) => {
  if (!has) return t.skip('SKIPPED (not a silent pass): gitleaks is not installed on this machine');
  assert.deepEqual(scan({ 'monitor/program-worklist.json': `{ "key": "${KEYISH}" }\n` }), ['monitor/program-worklist.json']);
});
