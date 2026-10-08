// node --test bin/test/issue-store-concurrency.test.mjs
//
// The issue store is a whole-document read-modify-write from many processes; atomic means no TORN
// file, never no LOST update. Reproduced with real processes because the window lives between a
// read and a write in separate address spaces. The assertion is "nothing is silently lost", not
// "every writer wins" — the lock fails CLOSED, so a loud refusal is a correct outcome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// maxRetries: on Windows a directory that concurrent PROCESSES just wrote into cannot always be
// removed on the first try — handles linger briefly after exit and the scanner may still hold
// one, so rmSync raises ENOTEMPTY/EBUSY. `force: true` covers ENOENT and not those, and node
// documents maxRetries/retryDelay as the remedy. Applied HERE rather than to all 549 recursive
// rmSync sites in the suite: only the ones cleaning up after concurrent writers actually race,
// and a codemod across the rest would be churn with no measurement behind it.
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { emptyIssuesDoc, mintIssue, verifyChain, loadIssues, saveIssues, withIssuesLock } from '../../monitor/issue-store.mjs';
import { chainHash } from '../../cra/lib.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MINTERS = 8;
const LEGACY_ISSUES = 400;   // big enough that the re-key's read-to-write window spans the mints

/** Run one child to completion. Never rejects on a non-zero exit — a REFUSAL is data here. */
function run(argv, env) {
  return new Promise((ok) => {
    const kid = spawn(process.execPath, argv, { cwd: CW, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    kid.stdout.on('data', (d) => { out += d; });
    kid.stderr.on('data', (d) => { err += d; });
    kid.on('close', (code) => ok({ code, out, err }));
  });
}

/** A store of `n` issues under the FLAT legacy id scheme; built through mintIssue so the chain is real. */
function legacyFixture(path, n) {
  const doc = emptyIssuesDoc();
  doc.organisation = null;
  for (let i = 0; i < n; i++) {
    mintIssue(doc, {
      area: 'commitwork', title: `legacy ${i}`, severity: 'med', kind: 'task', class: 'F',
      source: { kind: 'manual', key: null, tool: null, rule: null },
    }, '2026-08-01T00:00:00.000Z');
  }
  const flat = {};
  let k = 0;
  for (const iss of Object.values(doc.issues)) {
    const legacy = `ISS-${String(k++).padStart(6, '0')}`;
    iss.id = legacy;
    iss.class = 'F';        // classForIssue must resolve, or the migration refuses before it writes
    flat[legacy] = iss;
  }
  doc.issues = flat;
  doc.events = doc.events.map((e, i) => ({ ...e, issueId: `ISS-${String(i).padStart(6, '0')}` }));
  let prev = null;
  for (const e of doc.events) { e.prevHash = prev; e.hash = ''; e.hash = chainHash(prev, e); prev = e.hash; }
  doc.nextOrdinal = n;
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

const readStore = (p) => JSON.parse(readFileSync(p, 'utf8'));
const mintArgv = (i) => [join(CW, 'bin', 'issue.mjs'), 'new', '--area', 'commitwork',
  '--title', `concurrent mint ${i}`, '--sev', 'med', '--class', 'F'];

test('eight concurrent mints all land, and the chain still verifies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issues-race-'));
  try {
    const store = join(dir, 'issues.json');
    writeFileSync(store, `${JSON.stringify(emptyIssuesDoc(), null, 2)}\n`);
    const env = { ...process.env, CW_ISSUES: store, CW_ISSUE_ORG: 'PROBE', CW_VERDICT_DIR: dir };

    const results = await Promise.all(Array.from({ length: MINTERS }, (_, i) => run(mintArgv(i), env)));
    const succeeded = results.filter((r) => r.code === 0);
    assert.equal(succeeded.length, MINTERS,
      `all ${MINTERS} mints should get the lock inside their retry budget; refusals: `
      + results.filter((r) => r.code !== 0).map((r) => r.err.trim()).join(' | '));

    const doc = readStore(store);
    assert.equal(Object.keys(doc.issues).length, MINTERS, 'every mint is in the store');
    assert.equal(doc.nextOrdinal, MINTERS, 'no ordinal was handed out twice');
    assert.deepEqual(verifyChain(doc), [], 'the event chain verifies');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('a re-key running beside live mints loses none of them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issues-rekey-'));
  try {
    const store = join(dir, 'issues.json');
    legacyFixture(store, LEGACY_ISSUES);
    const env = { ...process.env, CW_ISSUES: store, CW_ISSUE_ORG: 'PROBE', CW_VERDICT_DIR: dir };

    // re-key first, mints immediately after — the mints land inside the read-to-write window
    const all = await Promise.all([
      run([join(CW, 'bin', 'issue-rekey.mjs'), '--org', 'PROBE', '--write'], env),
      ...Array.from({ length: MINTERS }, (_, i) => run(mintArgv(i), env)),
    ]);
    const [rekey, ...mints] = all;

    const doc = readStore(store);
    const titles = new Set(Object.values(doc.issues).map((i) => i.title));

    // 0. the writers actually ran — assertion 1 is vacuous over a store nothing could write to
    const refused = [...mints.entries()].filter(([, m]) => m.code !== 0);
    assert.deepEqual(refused.map(([i]) => i), [],
      `every mint must complete — a mint that could not run proves nothing about lost updates. `
      + refused.map(([i, m]) => `#${i}: ${m.err.trim().split('\n').slice(0, 3).join(' ')}`).join(' | '));
    assert.equal(rekey.code, 0, `the migration must complete: ${rekey.err.trim()}`);

    // 1. nothing silently lost — matched on TITLE, since a raced mint may legitimately have its id rewritten
    const claimed = mints.map((m, i) => ({ ...m, i })).filter((m) => m.code === 0);
    const lost = claimed.filter((m) => !titles.has(`concurrent mint ${m.i}`)).map((m) => m.i);
    assert.deepEqual(lost, [],
      `${lost.length} of ${claimed.length} mints printed an id and exited 0, and are not in the store `
      + `(missing: ${lost.join(', ')}) — that is the lost update this test exists to catch`);

    // 2. THE MIGRATION EITHER HAPPENED OR REFUSED — never half. If it wrote, no flat id survives.
    if (rekey.code === 0 && /wrote /.test(rekey.out)) {
      const flatLeft = Object.keys(doc.issues).filter((k) => /^ISS-[0-9A-Z]{6}$/.test(k));
      assert.deepEqual(flatLeft, [], 're-key reported success, so no legacy id may remain');
    }

    // 3. the ordinal never goes backwards — a rollback reissues live ids
    assert.ok(doc.nextOrdinal >= LEGACY_ISSUES + claimed.length,
      `nextOrdinal is ${doc.nextOrdinal}; ${LEGACY_ISSUES} legacy + ${claimed.length} mints were handed out, `
      + 'so anything lower means an id can be issued twice');

    assert.deepEqual(verifyChain(doc), [], 'the event chain verifies');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// A lock a caller has to remember is a lock a caller will forget — so the store refuses an
// unlocked save, turning a silent lost update into a loud refusal at the call site.
test('saveIssues refuses to write when the caller does not hold the issue lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issues-guard-'));
  try {
    const store = join(dir, 'issues.json');
    writeFileSync(store, `${JSON.stringify(emptyIssuesDoc(), null, 2)}\n`);
    const doc = loadIssues({ path: store });

    assert.throws(() => saveIssues(doc, { path: store }), /withIssuesLock/,
      'an unlocked save must be refused, and the message must name the wrapper that fixes it');

    // …and the same save under the lock is exactly the ordinary path.
    withIssuesLock(() => {
      mintIssue(doc, {
        area: 'commitwork', title: 'locked', severity: 'med', kind: 'task', class: 'F',
        source: { kind: 'manual', key: null, tool: null, rule: null },
      }, '2026-08-01T00:00:00.000Z');
      saveIssues(doc, { path: store });
    }, { path: store });
    assert.equal(Object.keys(readStore(store).issues).length, 1, 'the locked save landed');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
