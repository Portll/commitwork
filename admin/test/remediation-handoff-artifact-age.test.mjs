// The artifact line in the triage handoff states how old the scanner report is, and shouts when it
// is stale or its age cannot be read. A silent age once let a 16-day-old report read as current.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeHandoff, handoffContext } from '../routes/remediation.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-artifact-age-'));
const NOW = Date.parse('2026-11-13T12:00:00.000Z');
const DAY_MS = 86_400_000;
const ARTIFACT = join(TMP, 'gitleaks.json');
const STALE = 'STALE ARTIFACT: re-run the check before triaging; findings below may not describe the current tree.';
const ENTRY = { check: 'demo-check', prompt: 'PROMPT', formatNotes: null, report: null };

let savedRegistry, savedIssues;

before(() => {
  savedRegistry = process.env.CW_REGISTRY;
  savedIssues = process.env.CW_ISSUES;
  process.env.CW_ISSUES = join(TMP, 'issues.json');
  writeFileSync(ARTIFACT, '[]');
});

after(() => {
  if (savedRegistry === undefined) delete process.env.CW_REGISTRY;
  else process.env.CW_REGISTRY = savedRegistry;
  if (savedIssues === undefined) delete process.env.CW_ISSUES;
  else process.env.CW_ISSUES = savedIssues;
  rmSync(TMP, { recursive: true, force: true });
});

// Whole seconds, so the filesystem cannot round the timestamp across a day boundary.
function ctxAgedDays(days, extra = {}) {
  const mtime = NOW - days * DAY_MS - 1000;
  utimesSync(ARTIFACT, new Date(mtime), new Date(mtime));
  return {
    artifact: ARTIFACT, repoName: 'alpha', artifactMtime: statSync(ARTIFACT).mtimeMs,
    generated: null, live: null, rollup: { state: 'absent', why: null }, repoPath: null, ...extra,
  };
}

const compose = (ctx) => composeHandoff(ENTRY, ctx, null, NOW);
const artifactLine = (ctx) => compose(ctx).split('\n')[3];

test('0 days old: states zero days and carries no stale warning', () => {
  const ctx = ctxAgedDays(0);
  assert.equal(artifactLine(ctx),
    `Scanner artifact: ${ARTIFACT} (repo: alpha), written ${new Date(ctx.artifactMtime).toISOString()}, 0 days before this handoff - read it before concluding anything.`);
  assert.ok(!compose(ctx).includes('STALE ARTIFACT'));
});

test('6 days old: no stale warning', () => {
  const ctx = ctxAgedDays(6);
  assert.match(artifactLine(ctx), /, 6 days before this handoff - read it before concluding anything\.$/);
  assert.ok(!compose(ctx).includes('STALE ARTIFACT'));
});

test('7 days old: the stale warning is the line directly after the artifact line', () => {
  const lines = compose(ctxAgedDays(7)).split('\n');
  assert.match(lines[3], /, 7 days before this handoff - read it before concluding anything\.$/);
  assert.equal(lines[4], STALE);
});

test('16 days old: the age is stated in whole days', () => {
  assert.match(artifactLine(ctxAgedDays(16)), /, 16 days before this handoff - read it before concluding anything\.$/);
});

test('unreadable age: UNKNOWN names the reason and still warns stale', () => {
  const lines = compose({
    ...ctxAgedDays(0), artifactMtime: null, artifactAgeError: 'EACCES',
  }).split('\n');
  assert.equal(lines[3],
    `Scanner artifact: ${ARTIFACT} (repo: alpha), age UNKNOWN (EACCES) - read it before concluding anything.`);
  assert.equal(lines[4], STALE);
});

test('no artifact: the NOT FOUND wording is unchanged and no age lines appear', () => {
  const text = compose({
    artifact: null, repoName: null, artifactMtime: null, artifactAgeError: null,
    generated: null, live: null, rollup: { state: 'absent', why: null }, repoPath: null,
  });
  assert.ok(text.includes('Scanner artifact: NOT FOUND on disk for this check — say so in your triage rather than inventing findings.'));
  assert.ok(!text.includes('STALE ARTIFACT'));
  assert.ok(!text.includes('written '));
  assert.ok(!text.includes('age UNKNOWN'));
});

test('a fresh artifact changes only the artifact line of the handoff', () => {
  const ctx = ctxAgedDays(0);
  const oldText = [
    '# commitwork triage handoff — demo-check',
    `Generated ${new Date(NOW).toISOString()} from the rollup of an unknown time.`,
    'Live counts: none — no rollup for this project; nothing has been swept here.',
    `Scanner artifact: ${ARTIFACT} (repo: alpha) — read it before concluding anything.`,
    'Repository: NOT RESOLVED on this box — no repository in this project\'s rollup has a path here; locate the code before concluding anything.',
    '',
    'PROMPT',
    '',
  ].join('\n');
  const oldLines = oldText.split('\n');
  const newLines = compose(ctx).split('\n');
  assert.equal(newLines.length, oldLines.length);
  for (let i = 0; i < oldLines.length; i++) {
    if (i === 3) assert.notEqual(newLines[i], oldLines[i]);
    else assert.equal(newLines[i], oldLines[i]);
  }
});

test('handoffContext reads the resolved artifact mtime', () => {
  const reports = join(TMP, 'reports');
  const batch = 'sweep-20261113000000-age';
  const artifact = join(reports, batch, 'alpha', 'gitleaks.json');
  mkdirSync(join(reports, batch, 'alpha'), { recursive: true });
  writeFileSync(artifact, '[]');
  const mtime = NOW - 3 * DAY_MS;
  utimesSync(artifact, new Date(mtime), new Date(mtime));
  mkdirSync(join(reports, 'alpha'), { recursive: true });
  writeFileSync(join(reports, 'alpha', 'rollup.json'), JSON.stringify({
    generated: '2026-11-13T00:00:00.000Z', source: batch,
    scanners: { secrets: { total: 1 } }, repos: [{ name: 'alpha', scanners: { secrets: { total: 1 } } }],
  }));
  const registry = join(TMP, 'projects.json');
  writeFileSync(registry, JSON.stringify({
    reportsRoot: reports, monitorOutput: 'alpha', defaultManifest: 'security-baseline',
    roots: [], projects: [], areas: [{ slug: 'alpha', label: 'alpha', out: 'alpha', primary: true }],
  }));
  process.env.CW_REGISTRY = registry;

  const ctx = handoffContext({ dir: join(reports, 'alpha'), project: 'alpha' },
    { check: 'secrets-gitleaks', report: 'gitleaks.json' });
  assert.equal(ctx.artifact, artifact);
  assert.equal(ctx.artifactMtime, statSync(artifact).mtimeMs);
  assert.equal(ctx.artifactAgeError, null);
});
