// bin/learning-rebuild.mjs as a process, on a fixture issue store built through the store's own API
// (so the hash chain is real) and a fixture learning view. Every path is a CW_* override.
// Pins: the default run writes the view; --dry prints the same document and writes nothing;
// --verify passes on its own output and fails once the event source moves; an absent view, a
// broken chain and an unparseable store each refuse (exit 1) rather than rebuild over them; bad
// flags exit 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyIssuesDoc, mintIssue, appendRemediationEvent } from '../../monitor/issue-store.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'learning-rebuild.mjs');
const NOW = '2026-02-01T00:00:00.000Z';
const PATTERN = { rule: 'js/sql-injection', pathPrefix: 'services/api/' };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-learning-rebuild-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const doc = emptyIssuesDoc();
  const { id } = mintIssue(doc, { source: { kind: 'manual', key: null, tool: null, rule: null }, class: 'S',
    title: 'synthetic finding', area: 'example-area', severity: 'high', kind: 'code' }, '2026-01-02T00:00:00.000Z');
  for (const [day, who] of [['03', 'reviewer-a'], ['04', 'reviewer-b']]) {
    appendRemediationEvent(doc, 'fix-verified', id, { at: `2026-01-${day}T00:00:00.000Z`,
      evidence: { note: 'parameterised the query', who }, pattern: PATTERN });
  }
  const issues = join(dir, 'issues.json');
  writeFileSync(issues, JSON.stringify(doc, null, 2));
  return { dir, doc, id, issues, learning: join(dir, 'learning.json') };
}

function cli(f, args, { now = NOW } = {}) {
  const env = { ...process.env, CW_ISSUES: f.issues, CW_LEARNING: f.learning,
    CW_REMEDIATION_POLICY: join(f.dir, 'no-policy.json') };
  delete env.CW_NOW;
  if (now) env.CW_NOW = now;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('the default run writes the view at CW_LEARNING with the pattern its events teach', (t) => {
  const f = fixture(t);
  const r = cli(f, []);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), `learning view rebuilt at ${f.learning} (1 patterns)`);
  const view = JSON.parse(readFileSync(f.learning, 'utf8'));
  assert.equal(view.generatedAt, NOW);
  assert.equal(view.sourceEventCount, 3, 'issue-opened plus two fix-verified');
  assert.equal(view.sourceChainHead, f.doc.events.at(-1).hash);
  const p = view.patterns['js/sql-injection|services/api/|'];
  assert.ok(p, `patterns: ${Object.keys(view.patterns)}`);
  assert.deepEqual([p.observations, p.distinctAnnotators, p.lastEventType], [2, 2, 'fix-verified']);
});

test('--dry prints the document the default run would write, and writes nothing', (t) => {
  const f = fixture(t);
  const dry = cli(f, ['--dry']);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(existsSync(f.learning), false, '--dry wrote the view');
  assert.equal(cli(f, []).code, 0);
  assert.deepEqual(JSON.parse(dry.out), JSON.parse(readFileSync(f.learning, 'utf8')));
});

test('--verify passes on its own output (clock taken from the view) and fails once the events move', (t) => {
  const f = fixture(t);
  assert.equal(cli(f, []).code, 0);
  const ok = cli(f, ['--verify'], { now: null });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out.trim(), 'learning view verified (1 patterns)');

  appendRemediationEvent(f.doc, 'fix-disputed', f.id, { at: '2026-01-05T00:00:00.000Z',
    evidence: { note: 'the fix regressed in a later commit', who: 'reviewer-c' }, pattern: PATTERN });
  writeFileSync(f.issues, JSON.stringify(f.doc, null, 2));
  const stale = cli(f, ['--verify'], { now: null });
  assert.equal(stale.code, 1);
  assert.match(stale.err, /learning rebuild failed: learning view at .*learning\.json does not match its event source; rebuild it/);
});

test('--verify with no view on disk is a failure naming the path, not a pass over nothing', (t) => {
  const f = fixture(t);
  const r = cli(f, ['--verify']);
  assert.equal(r.code, 1);
  assert.equal(r.err.trim(), `learning rebuild failed: learning view is absent at ${f.learning}`);
});

test('a tampered hash chain refuses the rebuild and leaves no view behind', (t) => {
  const f = fixture(t);
  const doc = JSON.parse(readFileSync(f.issues, 'utf8'));
  doc.events[1].data.evidence.who = 'someone-else';
  writeFileSync(f.issues, JSON.stringify(doc, null, 2));
  const r = cli(f, []);
  assert.equal(r.code, 1);
  assert.match(r.err, /issue-store chain is invalid:\n {2}- events\[1\]: hash mismatch \(fix-verified /);
  assert.equal(existsSync(f.learning), false);
});

test('an unparseable issue store is refused, never rebuilt as an empty one', (t) => {
  const f = fixture(t);
  writeFileSync(f.issues, '{ "events": [');
  const r = cli(f, []);
  assert.equal(r.code, 1);
  assert.match(r.err, /issue store at .*issues\.json is not valid JSON .*refusing to treat it as empty/);
  assert.equal(existsSync(f.learning), false);
});

test('an unknown flag, or --dry with --verify, is a usage error that touches nothing', (t) => {
  const f = fixture(t);
  for (const args of [['--force'], ['--dry', '--verify']]) {
    const r = cli(f, args);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.err.trim(), 'usage: node bin/learning-rebuild.mjs [--dry|--verify]');
  }
  assert.equal(existsSync(f.learning), false);
});
