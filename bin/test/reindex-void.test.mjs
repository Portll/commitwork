// `commitwork reindex` re-renders a scan directory from the reports on disk. It read a parser's
// ok:false with no severity as ok, so a report the parser could not read rendered clean, and it read
// any 'no report' summary as n/a, which trivy also returns for a file that does not parse. Pinned in
// both directions: an unreadable report is a void, an absent one is n/a, a clean one is clean.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'commitwork.mjs');
const T = mkdtempSync(join(tmpdir(), 'cw-reindex-void-'));
after(() => rmSync(T, { recursive: true, force: true }));

const MANIFEST = join(T, 'm.json');
writeFileSync(MANIFEST, JSON.stringify({ repo: 'fixture', checks: [
  { id: 'deps', local: ['true'], report: { file: 'npm-audit.json', format: 'npm-audit' } },
  { id: 'jvm', local: ['true'], report: { file: 'trivy.json', format: 'trivy' } },
  { id: 'sbom', local: ['true'], report: { file: 'sbom.json', format: 'sbom' } },
] }));
const RUN = join(T, 'run');
const repo = (slug, files) => {
  mkdirSync(join(RUN, slug), { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(RUN, slug, f), body);
};
// npm-audit with no metadata is ok:false with no severity; trivy that does not parse says 'no report'
repo('unreadable', { 'npm-audit.json': '{}', 'trivy.json': 'Error: database download failed\n' });
repo('clean', { 'npm-audit.json': JSON.stringify({ metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } } }) });

const r = spawnSync(process.execPath, [CLI, 'reindex', '--manifest', MANIFEST, '--out', RUN],
  { cwd: T, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
const summary = (slug) => {
  try { return readFileSync(join(RUN, slug, 'summary.md'), 'utf8'); }
  catch (e) { return assert.fail(`no summary for ${slug} (${e.message}); exit ${r.status}:\n${r.stdout}\n${r.stderr}`); }
};

test('a report the parser could not read is a void, not ok', () => {
  assert.match(summary('unreadable'), /\| deps \| NOSCAN \| no audit data \|/);
});

test('a trivy report that does not parse is a void, not n/a', () => {
  assert.match(summary('unreadable'), /\| jvm \| NOSCAN \|/);
});

test('an absent report is still n/a, and a clean one still ok', () => {
  assert.match(summary('unreadable'), /\| sbom \| n\/a \| n\/a \|/);
  assert.match(summary('clean'), /\| deps \| OK \| 0 \|/);
  assert.match(summary('clean'), /\| jvm \| n\/a \|/);
});

test('the index counts both voids and paints neither clean', () => {
  const idx = readFileSync(join(RUN, 'index.md'), 'utf8');
  const row = idx.split('\n').find((l) => l.startsWith('| [unreadable]')) || '';
  assert.equal((row.match(/⬜/g) || []).length, 2, row);
  assert.doesNotMatch(row, /🟢/);
  assert.match(idx, /2 in-scope check\(s\) produced no output/);
});
