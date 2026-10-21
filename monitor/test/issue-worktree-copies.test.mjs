// A finding on a worktree copy of the repository is the canonical finding counted again. Two
// consequences are pinned here. It never files an issue of its own. And an issue already keyed on a
// copy closes as `superseded`, a duplicate of the canonical issue, never as `fixed`: deleting the
// worktree deletes the file, which the anchor probe otherwise reads as a fix.
// Synthetic stores and a temp repo only; the live store is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { emptyIssuesDoc, verifyChain, panelRows } from '../issue-store.mjs';
import { ingestArea, worktreeCopyOf } from '../issue-ingest.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const CANON = 'tools/gcobol/Dockerfile';
const COPY = '.claude/worktrees/agent-a/tools/gcobol/Dockerfile';
const TITLE = "Image user should not be 'root'";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-wt-copies-'));
  for (const f of [CANON, COPY]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), 'FROM debian:testing\nRUN apt-get update\n');
  }
  return dir;
}
const row = (file, extra = {}) => ({ repo: 'cw', rule: 'DS-0002', file, line: 1, sev: 'high', message: 'Specify at least 1 USER command', ...extra });
const slice = (n, rows, titles = null) => {
  const generated = `2026-10-0${n}T00:00:00.000Z`;
  return { now: generated, rollup: { generated, sliceId: `s${n}`, scanners: { iac: { ran: 1, total: rows.length } }, scannerFindings: { iac: rows }, ...(titles ? { scannerRuleTitles: { iac: titles } } : {}), repos: [] } };
};
const ingest = (doc, dir, n, rows, titles) => ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ...slice(n, rows, titles) });
const withCopiesCounted = (fn) => {
  const prev = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try { return fn(); } finally { if (prev === undefined) delete process.env.CW_WORKTREE_PATHS; else process.env.CW_WORKTREE_PATHS = prev; }
};
const assertStoreSound = (doc) => {
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
};

test('worktreeCopyOf finds the copy segment and the canonical key it stands for', () => {
  assert.deepEqual(worktreeCopyOf(`sc:cw|iac|DS-0002|${COPY}`), { name: 'agent-a', pattern: '.claude/worktrees', canonicalKey: `sc:cw|iac|DS-0002|${CANON}` });
  assert.equal(worktreeCopyOf(`sc:cw|iac|DS-0002|${CANON}`), null);
});

test('a row on a worktree copy never files; the canonical row files once', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, repo(), 1, [row(CANON), row(COPY)]);
  assert.equal(s.created.length, 1, 'one Dockerfile is one issue');
  assert.equal(s.worktreeRows, 1, 'the copy is counted, not silently dropped');
  assert.ok(doc.byKey[`sc:cw|iac|DS-0002|${CANON}`]);
  assert.equal(doc.byKey[`sc:cw|iac|DS-0002|${COPY}`], undefined);
  assertStoreSound(doc);
});

test('an issue already keyed on a copy closes as superseded by the canonical one, not as fixed, when the worktree is deleted', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  withCopiesCounted(() => ingest(doc, dir, 1, [row(CANON), row(COPY)]));
  const canonId = doc.byKey[`sc:cw|iac|DS-0002|${CANON}`];
  const copyId = doc.byKey[`sc:cw|iac|DS-0002|${COPY}`];
  assert.ok(canonId && copyId, 'the legacy state: two issues for one file');

  rmSync(join(dir, '.claude'), { recursive: true, force: true });
  const s = ingest(doc, dir, 2, [row(CANON)]);
  const copy = doc.issues[copyId];
  assert.equal(copy.state, 'closed');
  assert.equal(copy.closedAs, 'superseded', 'deleting a copy is not a fix');
  assert.equal(copy.deps.duplicateOf, canonId);
  assert.equal(copy.evidence.at(-1).tier, 'worktree-copy');
  assert.deepEqual(s.worktreeSuperseded, [copyId]);
  assert.equal(doc.issues[canonId].state, 'open', 'the canonical finding is still there');
  assert.ok(!s.closed.includes(copyId), 'nothing was reported as fixed');
  assertStoreSound(doc);
});

test('a copy issue whose lane did not run is left alone (A5)', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  withCopiesCounted(() => ingest(doc, dir, 1, [row(CANON), row(COPY)]));
  const copyId = doc.byKey[`sc:cw|iac|DS-0002|${COPY}`];
  const { now, rollup } = slice(2, []);
  ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, now, rollup: { ...rollup, scanners: {}, scannerFindings: {} } });
  assert.equal(doc.issues[copyId].state, 'open');
});

test('the rule title reaches the issue title, the source and the panel row; the id stays beside it', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  ingest(doc, dir, 1, [row(CANON)]);
  const id = doc.byKey[`sc:cw|iac|DS-0002|${CANON}`];
  assert.equal(doc.issues[id].title, 'DS-0002 [iac] (cw)', 'a rule with no title keeps the old form');

  const s = ingest(doc, dir, 2, [row(CANON)], { 'DS-0002': TITLE });
  const iss = doc.issues[id];
  assert.equal(iss.title, `${TITLE} (DS-0002) [iac] (cw)`);
  assert.equal(iss.source.ruleTitle, TITLE);
  assert.equal(iss.source.key, `sc:cw|iac|DS-0002|${CANON}`, 'identity is untouched');
  assert.ok(s.updated.includes(id));
  const panel = panelRows(doc, { now: '2026-10-03T00:00:00.000Z' }).find((r) => r.id === id);
  assert.equal(panel.title, `${TITLE} (DS-0002) [iac] (cw)`);
  assert.doesNotMatch(panel.title, /USER command/, 'message text never reaches a panel title (A4)');
  assertStoreSound(doc);
});
