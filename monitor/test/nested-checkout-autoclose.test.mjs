// Scan-time exclusion of nested checkouts (bin/test/nested-checkout-exclusion.test.mjs) removes copy
// rows outright, where the extraction-time set-aside kept them enumerable. What must hold:
//   1. a CANONICAL issue's disposition does not depend on whether copy rows are present — the
//      scan-time change cannot close one as fixed, and cannot hold one open either;
//   2. an issue keyed on a copy closes as superseded, never fixed, for scanner rows AND dependency
//      findings — a dependency finding absent with a known fix is ledger tier medium, which closed
//      a copy-keyed issue as FIXED before this;
//   3. the rollup resolves a vanished copy-path dependency finding as resolved-scope, so the
//      remediation ledger never scores it.
// Synthetic stores and a temp repo only; the live store is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { emptyIssuesDoc, verifyChain } from '../issue-store.mjs';
import { ingestArea } from '../issue-ingest.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const CANON = 'svc/app.py';
const COPY = `.claude/worktrees/agent-x/${CANON}`;
const PARKED = `.git/parked/${CANON}`;
const SRC = 'import subprocess\nsubprocess.call(cmd, shell=True)\n';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-nested-autoclose-'));
  for (const f of [CANON, COPY, PARKED]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), SRC);
  }
  return dir;
}
const row = (file) => ({ repo: 'cw', rule: 'B602', file, line: 2, sev: 'high', message: 'subprocess call with shell=True' });
const slice = (n, rows, findings = []) => {
  const generated = `2026-10-0${n}T00:00:00.000Z`;
  return { now: generated, rollup: { generated, sliceId: `s${n}`, scanners: { sastPython: { ran: 1, total: rows.length } }, scannerFindings: { sastPython: rows }, repos: [{ name: 'cw', findings }] } };
};
const ingest = (doc, dir, n, rows, findings, ledger = null) => ingestArea(doc, { areaSlug: 'a', repoPaths: { cw: dir }, ledger, ...slice(n, rows, findings) });
const withCopiesCounted = (fn) => {
  const prev = process.env.CW_WORKTREE_PATHS;
  process.env.CW_WORKTREE_PATHS = 'off';
  try { return fn(); } finally { if (prev === undefined) delete process.env.CW_WORKTREE_PATHS; else process.env.CW_WORKTREE_PATHS = prev; }
};
const clone = (doc) => JSON.parse(JSON.stringify(doc));
const disposition = (i) => ({ state: i.state, closedAs: i.closedAs ?? null, suspect: !!i.suspect });
const assertStoreSound = (doc) => {
  assert.deepEqual(verifyChain(doc), []);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
};

// The legacy state a fleet store is in today: issues filed while a lane still read the copies.
function legacy() {
  const doc = emptyIssuesDoc();
  const dir = repo();
  withCopiesCounted(() => ingest(doc, dir, 1, [row(CANON), row(COPY), row(PARKED)]));
  const id = (f) => doc.byKey[`sc:cw|sastPython|B602|${f}`];
  assert.ok(id(CANON) && id(COPY) && id(PARKED), 'three issues for one file is the legacy state');
  return { doc, dir, canonId: id(CANON), copyIds: [id(COPY), id(PARKED)] };
}

test('a canonical scanner issue ends the same whether or not the copy rows are still scanned', () => {
  for (const [label, withCopies, without, mutate] of [
    ['canonical still found', [row(CANON), row(COPY), row(PARKED)], [row(CANON)], null],
    ['canonical gone, its line unchanged', [row(COPY), row(PARKED)], [], null],
    ['canonical gone, its line changed', [row(COPY), row(PARKED)], [], (dir) => writeFileSync(join(dir, CANON), 'import subprocess\nsubprocess.call(cmd)\n')],
  ]) {
    const { doc, dir, canonId, copyIds } = legacy();
    if (mutate) mutate(dir);
    const a = clone(doc); const b = clone(doc);
    const sa = ingest(a, dir, 2, withCopies);   // a lane that still reads the copies
    const sb = ingest(b, dir, 2, without);      // the same lane with the scan-time exclusion
    assert.deepEqual(disposition(b.issues[canonId]), disposition(a.issues[canonId]), `${label}: copy rows changed the canonical issue`);
    for (const id of copyIds) {
      assert.equal(b.issues[id].closedAs, 'superseded', `${label}: a copy issue is a duplicate, not a fix`);
      assert.equal(a.issues[id].closedAs, 'superseded');
    }
    assert.deepEqual(sb.closed.filter((x) => copyIds.includes(x)), [], `${label}: no copy issue reported as fixed`);
    assertStoreSound(b);
  }
});

test('removing the copy rows cannot close a canonical scanner issue as fixed', () => {
  const { doc, dir, canonId } = legacy();
  const s = ingest(doc, dir, 2, []);
  assert.equal(doc.issues[canonId].state, 'open', 'its own line is unchanged, so absence is suspect at most');
  assert.equal(doc.issues[canonId].suspect, true);
  assert.ok(!s.closed.includes(canonId));
});

// osv-scanner reports `file:///src/...` from inside its container.
const LOCK = 'file:///src/package-lock.json';
const LOCK_COPY = 'file:///src/.claude/worktrees/agent-x/package-lock.json';
const dep = (id, path, fixed = '4.17.21') => ({ key: `cw|osv|${id}|lodash|${path}`, legacyKey: `cw|${id}|lodash`, tool: 'osv', id, package: 'lodash', version: '4.17.15', path, severity: 'high', fixed, title: id, state: 'persisting' });
// What the rollup before this change wrote for a copy finding that left: absent, tool ran, fix known.
const medium = (d) => ({ key: d.key, resolvedSlice: 's2', at: '2026-10-02T00:00:00.000Z', evidence: { tier: 'medium', detail: `finding gone; tool ran ok; fix ${d.fixed} was known` } });

test('a dependency issue keyed on a copy\'s lockfile closes as superseded, even with medium ledger evidence', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  const canon = dep('GHSA-aaaa', LOCK), copy = dep('GHSA-aaaa', LOCK_COPY), copyOnly = dep('GHSA-bbbb', LOCK_COPY);
  ingest(doc, dir, 1, [], [canon, copy, copyOnly]);
  const id = (d) => doc.byKey[`f:${d.key}`];
  assert.ok(id(canon) && id(copy) && id(copyOnly));

  const s = ingest(doc, dir, 2, [], [canon], [medium(copy), medium(copyOnly)]);
  for (const d of [copy, copyOnly]) {
    const iss = doc.issues[id(d)];
    assert.equal(iss.state, 'closed');
    assert.equal(iss.closedAs, 'superseded', `${d.id} on a copy left the scan; that is not a fix`);
    assert.equal(iss.evidence.at(-1).tier, 'worktree-copy');
  }
  assert.equal(doc.issues[id(canon)].state, 'open', 'the canonical finding is still reported');
  assert.deepEqual(s.closed, [], 'nothing reported as fixed');
  assert.deepEqual([...s.worktreeSuperseded].sort(), [id(copy), id(copyOnly)].sort());
  assertStoreSound(doc);
});

test('a canonical dependency issue still closes as fixed on its own ledger evidence', () => {
  const doc = emptyIssuesDoc();
  const dir = repo();
  const canon = dep('GHSA-aaaa', LOCK);
  ingest(doc, dir, 1, [], [canon]);
  const s = ingest(doc, dir, 2, [], [], [medium(canon)]);
  assert.equal(doc.issues[doc.byKey[`f:${canon.key}`]].closedAs, 'fixed', 'the guard must not swallow real fixes');
  assert.equal(s.closed.length, 1);
});

test('the rollup resolves a vanished copy-path finding as resolved-scope, so the ledger never scores it', () => {
  const rollup = readFileSync(resolve(HERE, '..', 'rollup.mjs'), 'utf8');
  const at = rollup.indexOf('const carried = [], resolvedF = [];');
  const end = rollup.indexOf('// ---- annotations overlay', at);
  assert.ok(at > 0 && end > at, 'the resolution block moved; this test needs updating');
  const block = rollup.slice(at, end);
  const candidates = block.match(/'resolved-fixed-candidate'/g) || [];
  const guards = block.match(/classifyWorktreePath\(p\.path\)\.worktree/g) || [];
  assert.equal(candidates.length, 2, 'a third route to resolved-fixed-candidate needs the same copy guard');
  assert.equal(guards.length, candidates.length, 'every route to resolved-fixed-candidate must first send copy paths to resolved-scope');
  assert.match(block, /classifyWorktreePath\(p\.path\)\.worktree\) \{ resolvedF\.push\(\{ \.\.\.p, state: 'resolved-scope'/);
  assert.match(block, /classifyWorktreePath\(p\.path\)\.worktree \? 'resolved-scope' : 'resolved-fixed-candidate'/);
  assert.match(rollup, /const candidates = resolvedF\.filter\(\(p\) => p\.state === 'resolved-fixed-candidate'\)/,
    'only fix candidates reach updateLedger; resolved-scope must stay out of it');
});
