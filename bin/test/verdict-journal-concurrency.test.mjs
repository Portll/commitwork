// node --test bin/test/verdict-journal-concurrency.test.mjs
//
// The ledger is written by many processes at once: appendRecord reads the tail, computes `prev`
// and appends, with nothing holding the three together — two racing writers claim the same
// predecessor and the ledger reports itself tampered with. Spawns real processes, because the
// race lives between a read and a write in separate address spaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// maxRetries: on Windows a directory that concurrent PROCESSES just wrote into cannot always be
// removed on the first try — handles linger briefly after exit and the scanner may still hold
// one, so rmSync raises ENOTEMPTY/EBUSY. `force: true` covers ENOENT and not those, and node
// documents maxRetries/retryDelay as the remedy. Applied HERE rather than to all 549 recursive
// rmSync sites in the suite: only the ones cleaning up after concurrent writers actually race,
// and a codemod across the rest would be churn with no measurement behind it.
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITERS = 8;
const PER_WRITER = 6;

/** A writer module written to disk rather than passed with `-e` — inlining a script into argv is
 *  a quoting hazard. */
function writerModule(dir) {
  const p = join(dir, 'writer.mjs');
  writeFileSync(p, `
import { appendRecord, adjudicationsPath } from ${JSON.stringify(pathToFileURL(join(CW, 'bin', 'lib', 'verdict-journal-core.mjs')).href)};
const tag = process.argv[2];
let failed = 0;
for (let i = 0; i < ${PER_WRITER}; i++) {
  const r = appendRecord(adjudicationsPath(), {
    v: 1, kind: 'adjudication', at: new Date().toISOString(),
    gate: 'g', recordAt: tag + '-' + i, truth: 'true-alarm', method: tag,
  });
  if (!r.ok) { failed++; process.stderr.write('WRITE FAILED: ' + r.error + '\\n'); }
}
process.exit(failed ? 1 : 0);
`);
  return p;
}

test('concurrent writers do not corrupt the ledger chain, and none is silently dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ledger-race-'));
  try {
    const writer = writerModule(dir);
    // the writers must overlap; async spawn gives the concurrency with no shell — an earlier
    // sh -c form was a string-built shell command this repo's own scanner lane exists to flag
    const env = { ...process.env, CW_VERDICT_DIR: dir, CW_VERDICT_PIN: '1' };
    await Promise.all(Array.from({ length: WRITERS }, (_, w) => new Promise((ok, bad) => {
      const kid = spawn(process.execPath, [writer, `w${w}`], { cwd: CW, env, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      kid.stderr.on('data', (d) => { err += d; });
      kid.on('error', bad);
      kid.on('close', (code) => (code === 0 ? ok() : bad(new Error(`writer w${w} exited ${code}: ${err}`))));
    })));

    const { readAdjudications } = await import('../lib/verdict-journal-core.mjs');
    const got = readAdjudications(dir);

    // 1. nothing lost — a lock that serialises by dropping writes is not a fix
    assert.equal(got.records.length, WRITERS * PER_WRITER,
      `every record must land: expected ${WRITERS * PER_WRITER}, got ${got.records.length}`);

    // 2. nothing corrupted — this is the assertion that fails without a lock
    assert.ok(!got.chain?.broken,
      `the chain must verify — a break here reads downstream as "the truth record itself was edited", `
      + `about a ledger nobody edited (broken at: ${got.chain?.broken})`);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// A leaked lock wedges every later writer until the stale timeout — a fixed race becomes a slow one.
test('no lock directory survives a completed run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ledger-lock-'));
  try {
    execFileSync(process.execPath, [writerModule(dir), 'solo'], {
      cwd: CW, encoding: 'utf8', env: { ...process.env, CW_VERDICT_DIR: dir, CW_VERDICT_PIN: '1' },
    });
    const stray = readFileSync(join(dir, 'adjudications.jsonl'), 'utf8').trim().split('\n');
    assert.equal(stray.length, PER_WRITER, 'the records landed');
    assert.ok(!existsSync(join(dir, 'adjudications.jsonl.lock')),
      'a lock left behind blocks every later writer until it goes stale');
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
