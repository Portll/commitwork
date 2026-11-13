// sast-php-phpcs and sast-php-psalm apply to any tree holding PHP source; a WordPress plugin ships no composer.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-php-gate-'));
after(() => rmSync(T, { recursive: true, force: true }));
const CHECKS = ['sast-php-phpcs', 'sast-php-psalm'];

function rowsFor(name, files) {
  const repo = join(T, name);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  return CHECKS.map((id) => {
    const reports = join(T, `${name}-${id}-reports`);
    mkdirSync(reports, { recursive: true });
    const r = spawnSync('node', [CLI, 'run', id, '--manifest', 'security-baseline', '--repo', repo], {
      encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: reports }, timeout: 300_000 });
    const row = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8')).find((s) => s.check === id);
    assert.ok(row, `${id} missing from checks-status.json; stderr: ${r.stderr}`);
    return row;
  });
}

test('a plugin tree with PHP and no composer.json is scanned, never skipped for a missing composer.json', () => {
  const plugin = '<?php\n/*\nPlugin Name: Fixture\n*/\necho $_GET["q"];\n';
  for (const row of rowsFor('plain-plugin', { 'fixture.php': plugin, 'readme.txt': '=== Fixture ===\n' })) {
    assert.notEqual(row.status, 'skip', JSON.stringify(row));
    assert.doesNotMatch(String(row.reason ?? ''), /composer\.json/);
  }
});

test('a tree with no PHP source is skipped with the source reason, even beside a composer.json', () => {
  for (const row of rowsFor('no-php', { 'composer.json': '{"name":"x/y"}\n', 'index.js': 'console.log(1)\n' })) {
    assert.equal(row.status, 'skip', JSON.stringify(row));
    assert.match(row.reason, /no \.php sources found/);
  }
});
