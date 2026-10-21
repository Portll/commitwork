// node --test bin/test/one-mutex.test.mjs — there is ONE mutex in this tree, and it stays one.
//
// monitor/lockfile.mjs exists because there were three: rollup.mjs had an inline `.rollup.lock`,
// admin/auth.mjs had `withStoreLock`, and lockfile.mjs had `takeReportsLock`. All three were the
// same eight lines of mkdir-plus-stale-takeover and all three carried the same stale-break race, so
// fixing it in one place fixed nothing. They were consolidated; nothing stops a fourth appearing,
// and a fourth would not announce itself — it would look like eight harmless lines next to the code
// that needed them.
//
// So this asserts the shape rather than the intent: lock SEMANTICS (creating or removing a lock
// path) live in monitor/lockfile.mjs and nowhere else. Constructing a `.lock` path and handing it to
// acquireLock is correct and common — bin/exempt.mjs and bin/agent-tag.mjs both do it — so naming a
// lock is never what this flags. Implementing one is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OWNER = join('monitor', 'lockfile.mjs');      // the one place lock semantics may live
const ROOTS = ['bin', 'monitor', 'admin', 'cra', 'mcp'];

/** Every .mjs under the roots, excluding tests and node_modules. */
function sources(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'test') sources(p, out); continue; }
    if (e.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// mkdir/rmdir/rename against something whose name says "lock" is the signature of a hand-rolled
// mutex. Deliberately narrow: it matches the OPERATION on a lock path, not the mention of one.
const IMPLEMENTS_A_LOCK = [
  /\bmkdirSync\s*\(\s*[^)]*[Ll]ock/,
  /\brmdirSync\s*\(\s*[^)]*[Ll]ock/,
  /\brmSync\s*\(\s*[^)]*[Ll]ock/,
];

test('lock semantics live in monitor/lockfile.mjs and nowhere else', () => {
  const offenders = [];
  let scanned = 0;
  for (const root of ROOTS) {
    for (const file of sources(join(CW, root))) {
      scanned += 1;
      const rel = relative(CW, file);
      if (rel === OWNER) continue;                  // the owner is allowed to implement them
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
        if (IMPLEMENTS_A_LOCK.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
  }
  // A renamed root or a permissions error would scan nothing and pass — the denominator
  // is the one number that must never be allowed to reach zero quietly.
  assert.ok(scanned > 50, `only ${scanned} source files scanned — the walk degenerated, so an empty offenders list proves nothing`);
  assert.deepEqual(offenders, [],
    'a second mutex is being hand-rolled. Import acquireLock from monitor/lockfile.mjs instead — '
    + 'that module exists because three copies of these eight lines each carried the same stale-break '
    + 'race, and a fourth copy reintroduces it somewhere nobody will look:\n  ' + offenders.join('\n  '));
});

// THE CHOKEPOINT IS THE ENFORCEMENT. A lock a caller has to remember is a lock a caller will forget,
// so the ledger's lock lives INSIDE appendRecord and the hook's inside shouldEmit — every existing
// and future caller is serialised without knowing the lock exists. This pins that arrangement: if
// someone later "simplifies" the lock back out to the call sites, the guarantee silently becomes
// advisory and this fails.
test('the shared-state chokepoints hold their own lock, so no caller can forget it', () => {
  const cases = [
    { file: 'bin/lib/verdict-journal-core.mjs', fn: 'appendRecord', why: 'the ground-truth ledger: an unlocked append breaks the hash chain and reads downstream as tampering' },
    { file: 'bin/hook-once.mjs', fn: 'shouldEmit', why: 'concurrent Stop hooks lose suppression increments and can step over the streak threshold' },
    { file: 'monitor/issue-store.mjs', fn: 'withIssuesLock', why: 'monitor/issues.json is a whole-document read-modify-write; a lost update deletes tracked findings and rolls nextOrdinal back so an ISS id can be issued twice' },
    { file: 'cra/lib.mjs', fn: 'updateCases', why: 'cra/cases.json is the hash-chained CRA Article 14 ledger, written by the 30-minute watch agent and by every operator CLI action on a live statutory clock. Eight concurrent acks reported success and one landed' },
    { file: 'admin/auth.mjs', fn: 'withStoreLock', why: 'the auth store holds TOTP single-use burn state and recovery-code burns; a lost write un-burns a consumed code and reverts the replay protection' },
    { file: 'monitor/a11y-attestations.mjs', fn: 'withAttestationsLock', why: 'an attestation is a WCAG conformance claim someone cites; a lost write drops a ruling while the file still verifies' },
  ];
  for (const { file, fn, why } of cases) {
    const src = readFileSync(join(CW, file), 'utf8');
    assert.match(src, /from '(?:(?:\.\.\/)+monitor|\.)\/lockfile\.mjs'/,
      `${file} must take its lock from the shared primitive — ${why}`);
    assert.match(src, new RegExp(`function ${fn}\\b[\\s\\S]{0,3000}?acquireLock\\(`),
      `${fn}() in ${file} must acquire the lock itself rather than trusting callers to — ${why}`);
  }
});

// THE ISSUE STORE'S CHOKEPOINT IS THE SAVE, NOT THE LOCK HELPER. Its critical section spans
// load -> mutate -> save across three call sites in four packages, so the lock cannot live "inside
// the primitive" the way appendRecord's does — there is no single function to put it in. What CAN be
// made unforgettable is the last step: saveIssues refuses to write unless this process holds the
// lock for that store. That converts a forgotten withIssuesLock from a silent lost update into a
// loud refusal at the call site responsible.
//
// It is load-bearing, not decorative. bin/issue-rekey.mjs bypassed the store module entirely and
// wrote monitor/issues.json with its own writeJSONAtomic; against eight concurrent `issue.mjs new`
// on a 400-issue fixture, whichever finished second silently replaced the other's whole document —
// while verifyChain reported zero problems, because the records it lost were never in the file it
// hashed (bin/test/issue-store-concurrency.test.mjs).
test('saveIssues refuses to write the issue store without the lock', () => {
  const src = readFileSync(join(CW, 'monitor', 'issue-store.mjs'), 'utf8');
  assert.match(src, /export function saveIssues[\s\S]{0,1500}?heldStores\.has\(/,
    'saveIssues() must check that this process holds the store lock before writing. Without it the '
    + 'lock is advisory: every caller in bin/, admin/, mcp/ and monitor/ has to remember a wrapper, '
    + 'and the one that forgets produces no error, no chain break and no missing-record warning.');
  assert.match(src, /heldStores\.add\(target\)/,
    'withIssuesLock() must register the path it holds, or saveIssues has nothing to check against');
});

// The CRA case log has exactly one writer, and it is the locked one. cases.json had four unlocked
// read-modify-write sites, each three unremarkable lines next to the code that needed them; a fifth
// would arrive the same way.
test('nothing writes the CRA case log except cra/lib.mjs, and it writes it under the lock', () => {
  const offenders = [];
  // WALKED, not listed: cra/ holds 16 modules and the hardcoded five could not see a sixth writer.
  const craFiles = readdirSync(join(CW, 'cra')).filter((f) => f.endsWith('.mjs')).map((f) => `cra/${f}`);
  assert.ok(craFiles.length >= 5, `only ${craFiles.length} cra modules found — the walk degenerated, so this test would pass vacuously`);
  for (const rel of [...craFiles, 'admin/routes/cra.mjs']) {
    const p = join(CW, rel);
    let src;
    try { src = readFileSync(p, 'utf8'); } catch { continue; }
    src.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      // A write whose destination is the case log, by any spelling in use.
      if (/write(JSON|Text)?Atomic\s*\(\s*[^,)]*\.?cases\b/.test(line) || /writeFileSync\s*\(\s*[^,)]*\.?cases\b/.test(line)) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    'the CRA Article 14 case log is being written outside updateCases(). Route it through '
    + 'updateCases in cra/lib.mjs, which takes the lock AND loads the document inside it — a direct '
    + 'write is a lost update that verify() cannot see, because the events it drops were never in '
    + 'the file it hashes:\n  ' + offenders.join('\n  '));

  // The primitive must still do the loading, not just the locking: a lock wrapper callers hand a
  // document to gives every call site back the ability to mutate a stale read under the lock.
  const lib = readFileSync(join(CW, 'cra', 'lib.mjs'), 'utf8');
  const fn = lib.match(/export function updateCases\b[\s\S]*?\n}/);
  assert.ok(fn, 'updateCases() must still exist in cra/lib.mjs');
  assert.ok(/acquireLock\(/.test(fn[0]) && /readFileSync\(/.test(fn[0]),
    'updateCases must acquire the lock AND read the case log inside it. A version that accepts an '
    + 'already-loaded document serialises the write while leaving the read outside — the mutation is '
    + 'ordered, the state it was computed from is not, and the chain verifies clean over the result.');
});

// THE ARCHIVE PATH STAYS INSIDE THE APPEND LOCK. archiveJudgement copies a banked judgement to the
// month-segmented durable archive, and it is called from appendLocked — i.e. with the ledger lock
// held. Nothing but this asserts that placement, and moving the call out to appendRecord (after the
// `finally` releases) or to a caller would look like a tidy-up: same function, same arguments, one
// line further down. It would also mean two processes appending to one month segment with nothing
// serialising them, on the copy that exists precisely because the ledger's own retention could not
// be trusted with irreplaceable records.
test('archiveJudgement is called from inside the ledger lock, never outside it', () => {
  const src = readFileSync(join(CW, 'bin', 'lib', 'verdict-journal-core.mjs'), 'utf8');

  // Exactly one call site, and it is in appendLocked — the function whose name and comment both say
  // it only runs with the lock held.
  const calls = src.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /(?:^|[^A-Za-z.])archiveJudgement\s*\(/.test(line) && !line.startsWith('//') && !line.startsWith('*'));
  const defLine = calls.filter(({ line }) => /function archiveJudgement/.test(line));
  const callSites = calls.filter(({ line }) => !/function archiveJudgement/.test(line));
  assert.equal(defLine.length, 1, 'archiveJudgement is defined once');
  assert.equal(callSites.length, 1,
    `archiveJudgement must have exactly ONE call site (found ${callSites.length}: `
    + `${callSites.map((c) => c.n).join(', ')}) — a second one is a second writer of the durable archive`);

  const locked = src.match(/function appendLocked\b[\s\S]*?\n}/);
  assert.ok(locked, 'appendLocked() is the critical section and must still exist');
  assert.ok(locked[0].includes('archiveJudgement('),
    'the archive must be written INSIDE appendLocked, which only runs with the ledger lock held. '
    + 'Outside it, two processes append to one month segment unserialised — and the archive exists '
    + 'because the ledger\'s own rotation was already trusted with records that cannot be regenerated.');

  // …and appendRecord must not call it directly: that is the plausible "simplification" — the same
  // call, moved up one frame, where the `finally` has already released the lock.
  const record = src.match(/export function appendRecord\b[\s\S]*?\n}/);
  assert.ok(record, 'appendRecord() must still exist');
  assert.ok(!record[0].includes('archiveJudgement('),
    'appendRecord must delegate to appendLocked; calling archiveJudgement here puts the archive '
    + 'write outside the lock that makes it safe');
});

// ── THE OTHER HALF OF THE CHOKEPOINT: ATOMICITY ────────────────────────────────────────────────
// writeAtomic lives beside the mutex in monitor/lockfile.mjs for the same reason, and had no
// enforcement: 13 sites hand-rolled tmp+rename with a FIXED `.tmp` suffix, so two processes
// writing the same file built the SAME tmp path and one renamed a file the other was still
// filling. That is not theoretical — it is the collision bin/annotate.mjs was fixed for.
// writeAtomic pid-suffixes, which makes the collision unconstructible.
const TMP_EXCEPTIONS = {};
// Which exceptions are excused only because the file is UNTRACKED. A deferral whose unblock
// condition has fired must fail — the DEFERRED map in one-sarif-reader.test.mjs lacked exactly
// this and let a landed file stay exempt for a day.
const UNTRACKED_ONLY = [];

// SCOPE, stated because a guard that walks a tree reads as machine-wide and is not. ROOTS is
// repo-internal, so a supervisor that creates concurrency from OUTSIDE — a launchd WatchPaths
// trigger firing one run per filesystem event, a wrapper in ~/.claude — is invisible here, and the
// program it supervises can be single-instance-correct as read. 53 LaunchAgents on this box, at
// least one WatchPaths-triggered; none of them are covered by this test. Reported by another session
// (taxonomy 1.81), verified: 8 concurrent runs with fixed tmp names, 10 crashes.
test('a whole-file replace goes through writeAtomic — no hand-rolled fixed-name tmp+rename', () => {
  const offenders = [];
  let scanned = 0;
  for (const root of ROOTS) {
    for (const file of sources(join(CW, root))) {
      const rel = relative(CW, file);
      if (rel === join('monitor', 'lockfile.mjs')) continue;   // the owner implements it
      if (rel in TMP_EXCEPTIONS) continue;
      scanned += 1;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        const t = line.trimStart();
        if (t.startsWith('//') || t.startsWith('*')) return;
        // A tmp path CONSTRUCTED for a write or rename, with no pid in it. Read-side filters
        // (endsWith('.tmp')) are not writes and must not be flagged.
        const buildsTmp = /(?:const\s+tmp\s*=|\btmp\s*=)[^;]*\.tmp/.test(line)
          || /(?:writeFileSync|renameSync)\s*\([^)]*\.tmp/.test(line);
        if (buildsTmp && !/process\.pid/.test(line) && !/mkdtemp|tmpdir/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${t.slice(0, 90)}`);
        }
      });
    }
  }
  assert.ok(scanned > 50, `only ${scanned} files scanned — the walk degenerated`);
  assert.deepEqual(offenders, [],
    'a fixed-name .tmp path is shared by every process writing that file, so one renames what '
    + 'another is still filling. Use writeAtomic from monitor/lockfile.mjs (it pid-suffixes), or '
    + 'declare the site in TMP_EXCEPTIONS with a reason:\n  ' + offenders.join('\n  '));
});

test('every declared tmp exception carries a real reason, and an untracked-only one dies when it lands', () => {
  for (const [rel, why] of Object.entries(TMP_EXCEPTIONS)) {
    assert.ok(typeof why === 'string' && why.length > 20, `${rel}'s exception reason is too short to be one`);
  }
  for (const rel of UNTRACKED_ONLY) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', rel], { cwd: CW }).status === 0;
    assert.ok(!tracked,
      `${rel} is TRACKED now, so the reason it was excused ("another session's untracked file") no longer holds. `
      + 'Migrate its tmp+rename to writeAtomic and delete its TMP_EXCEPTIONS entry.');
  }
});
