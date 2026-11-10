// a11y-wcag on the shipped manifest: a repository with no UI source is n/a (nothing to scan); one
// with UI source but no static HTML is noscan (could not scan); one with served HTML is audited.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-a11y-na-'));
after(() => rmSync(T, { recursive: true, force: true }));

// monitor/rollup.mjs NA_SKIP: a skip reason without this prefix is counted as a blocked skip.
const NA_SKIP = /^n\/a\b/i;

function a11yStatus(name, files) {
  const repo = join(T, name);
  const reports = join(T, `${name}-reports`);
  mkdirSync(reports, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  const r = spawnSync('node', [CLI, 'run', 'a11y-wcag', '--manifest', 'security-baseline', '--repo', repo], {
    encoding: 'utf8', env: { ...process.env, CW_REPORT_DIR: reports } });
  const rows = JSON.parse(readFileSync(join(reports, 'checks-status.json'), 'utf8'));
  const row = rows.find((s) => s.check === 'a11y-wcag');
  assert.ok(row, `a11y-wcag missing from checks-status.json; stderr: ${r.stderr}`);
  return row;
}

test('a repository with no UI source is skip (n/a) with the reason, not noscan', () => {
  const row = a11yStatus('rust-only', { 'Cargo.toml': '[package]\nname = "x"\n', 'src/main.rs': 'fn main() {}\n' });
  assert.equal(row.status, 'skip', JSON.stringify(row));
  assert.match(row.reason, NA_SKIP);
  assert.match(row.reason, /no \.html\/.*sources found/);
});

test('UI markup only under node_modules does not make the check apply', () => {
  const row = a11yStatus('vendored-html', { 'node_modules/dep/index.html': '<html lang="en"><body></body></html>\n', 'index.js': '' });
  assert.equal(row.status, 'skip', JSON.stringify(row));
});

test('UI source with no static HTML still runs and is noscan: could not scan is a void', () => {
  const row = a11yStatus('tsx-only', { 'src/App.tsx': 'export const App = () => <main>hi</main>;\n' });
  assert.equal(row.status, 'noscan', JSON.stringify(row));
  assert.match(row.reason, /no served HTML/);
});

test('served HTML is audited', () => {
  const row = a11yStatus('served', { 'index.html': '<!doctype html><html lang="en"><head><title>x</title></head><body><main><h1>x</h1></main></body></html>\n' });
  assert.ok(['pass', 'fail'].includes(row.status), JSON.stringify(row));
});
