// A present-but-unreadable artifact is evidence of a FILE, not of a scan. backfill-docs counted
// artifacts with existsSync and rows with a parser that refuses husks — so a husk osv.sarif wrote
// `scanned: true, total: 0` into a persistent enrichment sidecar and tallied clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(CW, 'monitor', 'backfill-docs.mjs');

/** A v0 slice whose source dir holds one repo with the given artifacts. */
function fixture(artifacts) {
  const root = mkdtempSync(join(tmpdir(), 'cw-bfd-'));
  const out = join(root, 'out');
  const src = join(root, 'src');
  const repo = join(src, 'repo-a');
  mkdirSync(join(out, 'history'), { recursive: true });
  mkdirSync(repo, { recursive: true });
  for (const [name, body] of Object.entries(artifacts)) writeFileSync(join(repo, name), body);
  writeFileSync(join(out, 'history', 'index.json'), JSON.stringify([{ stamp: '20260101000000', sliceVersion: 0 }]));
  writeFileSync(join(out, 'history', '20260101000000.json'), JSON.stringify({ sliceId: 'v0-test', source: src, repos: [] }));
  return { root, out };
}

function run(out) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CW_MONITOR_OUT: out }, encoding: 'utf8', cwd: CW,
  });
  const dir = join(out, 'history', 'enrichment');
  const files = readdirSync(dir).filter((f) => f.endsWith('-backfill.json'));
  assert.equal(files.length, 1, `expected one sidecar, got ${files.length}\n${r.stdout}${r.stderr}`);
  return { sidecar: JSON.parse(readFileSync(join(dir, files[0]), 'utf8')), stdout: r.stdout, stderr: r.stderr };
}

test('a husk osv.sarif makes the repo VOID — never scanned, never clean', () => {
  const { root, out } = fixture({ 'osv.sarif': '{"version":"2.1.0"}' });   // valid JSON, no runs[]
  try {
    const { sidecar, stdout } = run(out);
    const repo = sidecar.repos['repo-a'];
    assert.equal(repo.scanned, false, 'a husk is not a scan');
    assert.equal(repo.void, true);
    assert.equal(repo.voids[0].artifact, 'osv.sarif');
    assert.match(stdout, /VOID/, 'the tally must name the void, not fold it into clean');
    assert.doesNotMatch(stdout, /1 clean/, 'a husk repo must not be counted clean');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an unparseable npm-audit.json is a void too, with its reason recorded', () => {
  const { root, out } = fixture({ 'npm-audit.json': '{ not json' });
  try {
    const { sidecar } = run(out);
    const repo = sidecar.repos['repo-a'];
    assert.equal(repo.void, true);
    assert.equal(repo.voids[0].artifact, 'npm-audit.json');
    assert.ok(repo.voids[0].reason, 'the reason travels with the void');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an artifact that genuinely parses to zero findings IS documented clean', () => {
  const { root, out } = fixture({ 'osv.sarif': JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'osv', rules: [] } }, results: [] }] }) });
  try {
    const { sidecar, stdout } = run(out);
    const repo = sidecar.repos['repo-a'];
    assert.equal(repo.scanned, true, 'parsing to zero is the one thing that earns clean');
    assert.equal(repo.void, undefined);
    assert.equal(repo.counts.total, 0);
    assert.match(stdout, /1 clean/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
