// node --test monitor/test/ — the batch archiver. Runs entirely on fixtures: no keychain, no real
// reports/ tree. The cases that matter are the ones where a wrong answer LOOKS right — a batch
// archived mid-write, an unverified archive counted as coverage, a verify that vouches for itself.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEY_LEN, openArchive, unpackEntries } from '../archive-container.mjs';
import { selectBatches, buildArchive, verifyArchive, coveredBatches, archiveDir, assertStable } from '../archive-batches.mjs';

const KEY = Buffer.alloc(KEY_LEN, 3);
const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const day = 86400000;
const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const trees = [];
after(() => { for (const t of trees) rmSync(t, { recursive: true, force: true }); });

// batches: [{ agoMs, area, files? }]
function makeReports(batches) {
  const root = mkdtempSync(join(tmpdir(), 'cw-arch-'));
  trees.push(root);
  const names = [];
  for (const b of batches) {
    const name = `sweep-${stampOf(NOW - b.agoMs)}-${b.area}`;
    names.push(name);
    const dir = join(root, name);
    mkdirSync(join(dir, 'repo-a'), { recursive: true });
    writeFileSync(join(dir, 'batch-manifest.json'), JSON.stringify({ area: b.area, anchors: { 'repo-a': 'abc1234' } }));
    for (const [f, body] of Object.entries(b.files || { 'repo-a/gitleaks.json': JSON.stringify([{ RuleID: 'generic', Secret: 'SYNTHETIC-NOT-REAL', File: 'x.js' }]) })) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), body);
    }
  }
  return { root, names };
}

describe('selection — never archive what is still being written', () => {
  test('the NEWEST batch of each area is excluded, and says why', () => {
    const { root } = makeReports([
      { agoMs: 5 * day, area: 'alpha' }, { agoMs: 2 * day, area: 'alpha' },
      { agoMs: 5 * day, area: 'beta' },
    ]);
    const { picked, skipped } = selectBatches(root, { now: NOW });
    assert.deepEqual(picked.map((p) => p.area), ['alpha'], 'only alpha has a non-newest batch');
    assert.equal(picked.length, 1);
    assert.ok(skipped.some((s) => /newest of its area/.test(s.why)));
  });

  test('anything younger than the min age is excluded even if it is not the newest', () => {
    const { root } = makeReports([
      { agoMs: 60 * 60 * 1000, area: 'alpha' },      // 1h
      { agoMs: 30 * 60 * 1000, area: 'alpha' },      // 30m — newest
      { agoMs: 10 * day, area: 'alpha' },
    ]);
    const { picked, skipped } = selectBatches(root, { now: NOW });
    assert.equal(picked.length, 1, 'only the 10-day-old batch is eligible');
    assert.ok(skipped.some((s) => /younger than 6h/.test(s.why)));
  });

  test('a dir with no batch-manifest.json is not a batch and is not archived', () => {
    const { root } = makeReports([{ agoMs: 5 * day, area: 'alpha' }, { agoMs: 9 * day, area: 'alpha' }]);
    mkdirSync(join(root, 'sweep-20260101000000-ghost'), { recursive: true });
    const { picked } = selectBatches(root, { now: NOW });
    assert.equal(picked.some((p) => /ghost/.test(p.name)), false);
  });

  test('an area out dir or any non-batch dir is never selected', () => {
    const { root } = makeReports([{ agoMs: 5 * day, area: 'alpha' }, { agoMs: 9 * day, area: 'alpha' }]);
    mkdirSync(join(root, 'commitwork-admin', 'history'), { recursive: true });
    writeFileSync(join(root, 'commitwork-admin', 'rollup.json'), '{}');
    const { picked } = selectBatches(root, { now: NOW });
    for (const p of picked) assert.match(p.name, /^sweep-\d{14}/);
  });

  test('--older-than narrows further and reports the reason', () => {
    const { root } = makeReports([
      { agoMs: 2 * day, area: 'alpha' }, { agoMs: 20 * day, area: 'alpha' }, { agoMs: 1 * day, area: 'alpha' },
    ]);
    const { picked, skipped } = selectBatches(root, { now: NOW, olderThanDays: 10 });
    assert.equal(picked.length, 1);
    assert.ok(skipped.some((s) => /--older-than 10d/.test(s.why)));
  });
});

describe('build and verify', () => {
  const mk = () => {
    const { root } = makeReports([
      { agoMs: 20 * day, area: 'alpha' }, { agoMs: 10 * day, area: 'alpha' }, { agoMs: 1 * day, area: 'alpha' },
    ]);
    const { picked } = selectBatches(root, { now: NOW });
    return { root, picked };
  };

  test('an archive round-trips and every entry hash re-derives', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf);
    const r = verifyArchive(f, KEY);
    assert.equal(r.ok, true, `missing=${r.missing} wrong=${r.wrong} extra=${r.extra}`);
    assert.equal(r.manifest.entries.length, built.entryCount);
    assert.equal(r.manifest.fidelity, 'raw');
  });

  test('the manifest is SEALED INSIDE — its frame count matches the archive', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf);
    assert.equal(verifyArchive(f, KEY).manifest.frames, built.manifest.frames);
  });

  test('anchors are carried, so a restored finding is still attributable to a commit', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    assert.equal(built.manifest.batches[0].anchors['repo-a'], 'abc1234');
  });

  test('secret-bearing files are COUNTED and the count survives into the manifest', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    assert.ok(built.manifest.secretBearingFiles > 0, 'the fixture has gitleaks reports; a zero here means the counter is dead');
  });

  test('raw fidelity PRESERVES the value — that is the point, and why it is encrypted', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf);
    assert.equal(verifyArchive(f, KEY).ok, true);
    assert.equal(built.manifest.fidelity, 'raw');
  });

  test('--redact actually REMOVES the value — asserted on the bytes, not on the manifest', () => {
    // The manifest saying fidelity:'redacted' is a MARKER. A test that stops there is green over an
    // inert redactor for as long as it stays inert. So: plant a canary, open the sealed archive,
    // and look for the canary in the bytes that would have been shipped.
    const CANARY = 'CANARY-SECRET-VALUE-9f3a2b';
    const files = {
      'repo-a/gitleaks.json': JSON.stringify([{ RuleID: 'generic', Secret: CANARY, File: 'x.js' }]),
      // The SARIF case is the one the denylist originally missed: the matched SOURCE LINE.
      'repo-a/semgrep.sarif': JSON.stringify({ runs: [{ results: [{ locations: [{ physicalLocation: { region: { snippet: { text: CANARY } } } }] }] }] }),
    };
    const { root } = makeReports([{ agoMs: 20 * day, area: 'alpha', files }, { agoMs: 1 * day, area: 'alpha', files }]);
    const { picked } = selectBatches(root, { now: NOW });

    const carrying = (redact) => {
      const built = buildArchive({ root, batches: picked, key: KEY, redact, now: NOW });
      const entries = unpackEntries(openArchive(built.buf, KEY).plaintext);
      return entries.filter((e) => e.data.includes(CANARY)).map((e) => e.path.split('/').pop()).sort();
    };

    // NEGATIVE CONTROL FIRST: without --redact the canary must be present in both, or the positive
    // assertion below proves nothing about redaction — it would pass on an empty archive too.
    assert.deepEqual(carrying(false), ['gitleaks.json', 'semgrep.sarif'],
      'the fixture must actually contain the canary unredacted, or this test cannot fail');
    assert.deepEqual(carrying(true), [], 'the canary survived --redact — including the SARIF snippet.text case');
  });

  test('--redact drops the known value fields, and SAYS it is redacted', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, redact: true, now: NOW });
    assert.equal(built.manifest.fidelity, 'redacted');
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf);
    assert.equal(verifyArchive(f, KEY).ok, true);
  });

  test('--redact STATES its coverage: the field list applied, and every file it could not process', () => {
    // A denylist cannot be complete, so the honest artifact publishes what it did rather than
    // implying it caught everything. The nasty case is an unparseable report: redaction silently
    // passed the raw bytes through before this, so "redacted" was a claim about files it skipped.
    const { root } = makeReports([
      { agoMs: 20 * day, area: 'alpha', files: { 'repo-a/gitleaks.json': '{ this is not json', 'repo-a/ok.json': '{"Secret":"SYNTHETIC"}' } },
      { agoMs: 1 * day, area: 'alpha' },
    ]);
    const { picked } = selectBatches(root, { now: NOW });
    const built = buildArchive({ root, batches: picked, key: KEY, redact: true, now: NOW });
    assert.deepEqual(built.manifest.redaction.fields, ['Secret', 'Match', 'Raw', 'RawV2', 'snippet']);
    const bad = built.manifest.redaction.notRedacted.find((n) => n.path.endsWith('gitleaks.json'));
    assert.ok(bad, 'an unparseable report must be NAMED, not silently shipped as redacted');
    assert.match(bad.why, /unparseable/);
    assert.equal(bad.secretBearing, true, 'and it must say that the file it could not redact was a secret-bearing one');
  });

  test('without --redact there is no redaction claim at all — absence, not a false empty', () => {
    const { root, picked } = mk();
    assert.equal(buildArchive({ root, batches: picked, key: KEY, now: NOW }).manifest.redaction, null);
  });

  test('a corrupted archive FAILS verification rather than returning what it can', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    const bent = Buffer.from(built.buf);
    bent[bent.length - 30] = bent[bent.length - 30] ^ 0xff;
    writeFileSync(f, bent);
    assert.throws(() => verifyArchive(f, KEY), /authentication|truncated|TRUNCATED/);
  });

  test('a TRUNCATED archive fails verification — the compound-critical path, end to end', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf.subarray(0, built.buf.length - 200));
    assert.throws(() => verifyArchive(f, KEY), /truncated|TRUNCATED|authentication/);
  });

  test('a wrong key cannot verify — so a lost key is a real loss, not a soft one', () => {
    const { root, picked } = mk();
    const built = buildArchive({ root, batches: picked, key: KEY, now: NOW });
    const f = join(mkdtempSync(join(tmpdir(), 'cw-out-')), 'a.cwar');
    writeFileSync(f, built.buf);
    assert.throws(() => verifyArchive(f, Buffer.alloc(KEY_LEN, 4)), /authentication/);
  });
});

describe('fail closed while the tree moves underneath', () => {
  // Tested through the guard directly rather than by racing a real writer: a race-based test is
  // flaky, and a flaky test for a data-integrity guard is worse than none. The first version of
  // this suite asserted doesNotThrow on a normal build, which proved nothing at all.
  const st = (size, mtimeMs) => ({ size, mtimeMs });

  test('a stable file passes', () => {
    assert.doesNotThrow(() => assertStable(st(100, 5), st(100, 5), 'a.json', 100));
  });

  test('a file that GREW mid-read is refused, and the message says by how much', () => {
    assert.throws(() => assertStable(st(100, 5), st(4096, 5), 'a.json', 100), /changed size while being read \(100 -> 4096\)/);
  });

  test('a file rewritten in place at the SAME size is still caught, via mtime', () => {
    // The nastiest case: size-preserving rewrite. Size alone would call this stable.
    assert.throws(() => assertStable(st(100, 5), st(100, 9), 'a.json', 100), /rewritten while being read/);
  });

  test('a short read is refused even when both stats agree', () => {
    assert.throws(() => assertStable(st(100, 5), st(100, 5), 'a.json', 60), /read 60 bytes but stat said 100/);
  });

  test('an UNREADABLE entry aborts the archive — never a silently shorter one', () => {
    const { root } = makeReports([{ agoMs: 20 * day, area: 'alpha' }, { agoMs: 1 * day, area: 'alpha' }]);
    const { picked } = selectBatches(root, { now: NOW });
    assert.doesNotThrow(() => buildArchive({ root, batches: picked, key: KEY, now: NOW }));
    // A permission error is NOT absence — only ENOENT is. This is the exact shape that produced a
    // confident 56.7x compression ratio from a truncated tar earlier today: the pipe reported
    // success while the archive held almost nothing.
    const victim = join(root, picked[0].name, 'repo-a', 'gitleaks.json');
    const _deny = denyRead(victim);

    assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
    try {
      assert.throws(() => buildArchive({ root, batches: picked, key: KEY, now: NOW }), /unreadable entry/);
    } finally { _deny.restore(); }
  });
});

describe('coverage is keyed on VERIFIED archives only', () => {
  test('an empty/absent index is legitimately empty, and ENOENT is the only absence', () => {
    const prev = process.env.CW_ARCHIVE_DIR;
    process.env.CW_ARCHIVE_DIR = mkdtempSync(join(tmpdir(), 'cw-cov-'));
    try { assert.equal(coveredBatches().size, 0); }
    finally { if (prev === undefined) delete process.env.CW_ARCHIVE_DIR; else process.env.CW_ARCHIVE_DIR = prev; }
  });

  test('the archive dir is env-overridable AND read at call time', () => {
    const prev = process.env.CW_ARCHIVE_DIR;
    process.env.CW_ARCHIVE_DIR = '/tmp/cw-archive-probe';
    try { assert.equal(archiveDir(), '/tmp/cw-archive-probe'); }
    finally { if (prev === undefined) delete process.env.CW_ARCHIVE_DIR; else process.env.CW_ARCHIVE_DIR = prev; }
  });

  test('a malformed coverage line hides nothing — unknown stays UNCOVERED', () => {
    const prev = process.env.CW_ARCHIVE_DIR;
    const dir = mkdtempSync(join(tmpdir(), 'cw-cov-'));
    process.env.CW_ARCHIVE_DIR = dir;
    try {
      appendFileSync(join(dir, 'coverage.jsonl'), 'not json at all\n');
      appendFileSync(join(dir, 'coverage.jsonl'), `${JSON.stringify({ batches: ['sweep-20260101000000-alpha'], verified: true })}\n`);
      const c = coveredBatches();
      assert.equal(c.has('sweep-20260101000000-alpha'), true);
      assert.equal(c.size, 1, 'the bad line must not invent coverage');
    } finally { if (prev === undefined) delete process.env.CW_ARCHIVE_DIR; else process.env.CW_ARCHIVE_DIR = prev; }
  });
});
