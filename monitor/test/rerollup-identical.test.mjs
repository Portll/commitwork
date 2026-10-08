// node --test monitor/test/  — RE-ROLLUP DETERMINISM: rolling the same stored batch into two
// scratch CW_MONITOR_OUT dirs produces byte-identical artifacts, modulo the ISO `generated`
// timestamp and the 14-digit stamp (normalised identically on both sides). Hermetic: reads a
// stored batch, writes only os.tmpdir(); children run with fetch removed so no EPSS write.
//
// ── WHY THERE ARE TWO BATCHES UNDER TEST ────────────────────────────────────────────────────────
// This suite used to read ONLY `reports/`, which is gitignored. In any checkout without a stored
// sweep — a fresh clone, CI, the public snapshot — all seven assertions below skipped, so the
// determinism house invariant had no witness anywhere a stranger could run. Measured on a
// sidecar-less export of HEAD: 19 of 58 skips in the whole suite named a missing sweep batch.
//
// A loud skip was the right posture and the wrong resting state. `fixtures/sweep-batch/` now ships
// a SYNTHETIC batch — three findings, two CVEs, one minted CWX id, no real repository and no real
// finding — and the fixture arm runs in EVERY checkout. The live arm is kept because a real batch
// reaches tools and shapes the fixture does not, and it still skips loudly when `reports/` is bare.
//
// The two arms do NOT share a posture, deliberately. A fixture that fails to roll is a FAILURE: it
// ships with the repository, so nothing about the host can excuse it. Only the live arm may skip.
// Were the fixture allowed to skip too, this file would be the thing it exists to refuse — a check
// whose absence of input reads exactly like a pass.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const REPORTS = join(CW, 'reports');
// The synthetic batch that ships with the repository. Tracked, so it is present in a public clone.
const FIXTURE_BATCH = join(HERE, 'fixtures', 'sweep-batch', 'sweep-20260101000000-fixture');
// both batch-name forms — the old form must keep re-rolling forever
const BATCH_RE = /^sweep-\d{14}(-[a-z0-9-]+)?$/;
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';

function treeBytes(dir, cap = 200000) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    if (files > cap) return;
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { files++; try { bytes += statSync(p).size; } catch { /* vanished mid-walk */ } }
    }
  };
  walk(dir);
  return { bytes, files };
}

// smallest first: a determinism check does not need a big batch, and the suite must stay cheap.
function candidateBatches() {
  let ents; try { ents = readdirSync(REPORTS, { withFileTypes: true }); } catch { return []; }
  return ents.filter((e) => e.isDirectory() && BATCH_RE.test(e.name))
    .map((e) => ({ name: e.name, path: join(REPORTS, e.name), ...treeBytes(join(REPORTS, e.name)) }))
    .filter((b) => b.files > 1) // a batch holding only batch-manifest.json has no tool output to roll
    .sort((a, b) => a.bytes - b.bytes || a.name.localeCompare(b.name));
}

function rollInto(batchPath, out) {
  try {
    execFileSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor/rollup.mjs'), batchPath],
      { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_MONITOR_OUT: out } });
    return { code: 0 };
  } catch (e) {
    return { code: e.status ?? -1, stderr: String(e.stderr || ''), stdout: String(e.stdout || '') };
  }
}

// relative path -> file bytes, for every file under `dir`
function snapshot(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(relative(dir, p).split('\\').join('/'), readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const STAMP_RE = /(?<!\d)\d{14}(?!\d)/g;
// sliceSha256 hashes bytes embedding the wall-clock ISO the rolls disagree on — hashing does not
// commute with normalisation, so the hash is normalised too. Bounded to exactly 64 hex chars.
const SHA256_RE = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi;
// ORDER MATTERS, AND IT WAS WRONG: SHA256 BEFORE STAMP.
// With the stamp pass first, a 14-digit all-decimal run INSIDE a hash (…972d20870255140551a — the
// digits are bounded by non-digits, so STAMP_RE matches) was rewritten to <STAMP>; the value was
// then no longer 64 hex characters and SHA256_RE could not match it. Roll A's hash normalised whole
// and roll B's did not, so the comparison reported NON-DETERMINISTIC ROLLUP OUTPUT about a field
// whose two values are both correct. Nothing in rollup.mjs was wrong.
//
// It is a coin-flip per hash, which is why it lay latent: it fires only when some hash in the pair
// happens to contain such a run, so the assertion was intermittently red for a reason that had
// nothing to do with determinism. Found the hour the synthetic-fixture arm below first ran — the
// live arm had been skipping on this host, so no run had ever exercised it often enough to notice.
// A 14-digit stamp is never itself a 64-hex token, so moving the stamp pass last loses nothing.
const norm = (s) => s.replace(ISO_RE, '<ISO>').replace(SHA256_RE, '<SHA256>').replace(STAMP_RE, '<STAMP>');

// first differing line, so a failure names the field instead of dumping two files
function firstDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}:\n    A: ${JSON.stringify(la[i])}\n    B: ${JSON.stringify(lb[i])}`;
  }
  return `identical line-wise but ${a.length} vs ${b.length} bytes (trailing newline?)`;
}

// hash of the shared caches BEFORE any rollup runs (module top-level runs before before()).
const dataHash = () => {
  const dir = join(CW, 'monitor/data');
  const h = createHash('sha256');
  for (const f of readdirSync(dir).sort()) h.update(f).update(readFileSync(join(dir, f)));
  return h.digest('hex');
};
const DATA_HASH_BEFORE = dataHash();

/** Roll `batch` into two scratch OUT dirs. Returns {batch, a, b, rb} or {rollError}. */
function rollTwice(batch) {
  const a = mkdtempSync(join(tmpdir(), 'cw-reroll-a-'));
  const b = mkdtempSync(join(tmpdir(), 'cw-reroll-b-'));
  const ra = rollInto(batch.path, a);
  if (ra.code !== 0) {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
    // THE LAST NON-EMPTY LINE OF EITHER STREAM. Two defects, both making the skip reason say nothing:
    // `.split('\n').pop()` on rollup's trailing-newline output returns '', and rollup's exit-4
    // refusal ("nothing to roll up: no repo produced a report directory") goes to STDOUT via
    // console.log (monitor/rollup.mjs:694), not stderr — so a reason built from stderr alone read
    // `-> exit 4 ()` for every candidate on this host. A loud skip that says only that it skipped is
    // a quiet one with extra words.
    const lines = `${ra.stderr || ''}\n${ra.stdout || ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
    const why = ra.code === 2 ? 'empty batch: no tool output' : (lines.pop() || 'rollup printed nothing').slice(-180);
    return { rollError: `${batch.name} -> exit ${ra.code} (${why})` };
  }
  return { batch, a, b, rb: rollInto(batch.path, b) };
}

/**
 * The seven determinism assertions, over whatever batch `resolve()` hands back.
 *
 * `resolve()` returns `{batch}`, or `{skip}` for an arm that is legitimately absent here. The
 * fixture arm never returns `{skip}` — see the header.
 */
function determinismSuite(label, resolveBatch) {
  describe(`re-rolling a stored batch is deterministic — ${label}`, () => {
    let state = null;
    const guard = (t) => { if (state.skip) { t.skip(state.skip); return true; } return false; };

    before(() => { state = resolveBatch(); });
    after(() => {
      if (state && state.a) rmSync(state.a, { recursive: true, force: true });
      if (state && state.b) rmSync(state.b, { recursive: true, force: true });
    });

    test('the second re-roll of the same batch also exits 0', (t) => {
      if (guard(t)) return;
      assert.equal(state.rb.code, 0, `second re-roll of ${state.batch.name} exited ${state.rb.code}: ${(state.rb.stderr || '').trim()}`);
    });

    test('the roll is non-vacuous — it produced a rollup.json covering at least one repo', (t) => {
      if (guard(t)) return;
      const files = snapshot(state.a);
      assert.ok(files.has('rollup.json'), `no rollup.json in the scratch OUT (got: ${[...files.keys()].join(', ')})`);
      assert.ok(files.has('dashboard.html'));
      assert.ok(files.has('REMEDIATION.md'));
      const r = JSON.parse(files.get('rollup.json'));
      assert.ok(r.totals.repos >= 1, `rollup covers ${r.totals.repos} repos — an empty rollup would make the byte comparison vacuous`);
      assert.equal(r.sliceVersion, 1);
      assert.ok(/^(sweep|adhoc)-/.test(r.sliceId), `unexpected sliceId ${r.sliceId}`);
    });

    test('both rolls produce the SAME artifact set (stamped filenames normalised)', (t) => {
      if (guard(t)) return;
      const A = [...snapshot(state.a).keys()].map(norm).sort();
      const B = [...snapshot(state.b).keys()].map(norm).sort();
      assert.deepEqual(A, B, 'the two rolls wrote different files');
    });

    test('the batch-identity fields are reproduced exactly (sliceId, kind, source, scope)', (t) => {
      if (guard(t)) return;
      const a = JSON.parse(snapshot(state.a).get('rollup.json'));
      const b = JSON.parse(snapshot(state.b).get('rollup.json'));
      assert.equal(a.sliceId, b.sliceId, 'sliceId is the re-rollup identity key (rollup.mjs:249-253)');
      assert.equal(a.kind, b.kind);
      assert.deepEqual(a.totals, b.totals);
      assert.deepEqual(a.openTotals, b.openTotals);
      assert.deepEqual(a.scanned, b.scanned);
      assert.deepEqual(a.counts, b.counts);
      assert.deepEqual(a.scopeDelta, b.scopeDelta);
      assert.deepEqual(a.repos.map((r) => r.name), b.repos.map((r) => r.name), 'repo ORDER must be stable, not just the set');
      assert.deepEqual(a.allKeys, b.allKeys, 'finding key order must be stable — the ledger upserts on it');
    });

    test('every artifact is byte-identical apart from the wall-clock stamp and ISO timestamp', (t) => {
      if (guard(t)) return;
      const A = snapshot(state.a), B = snapshot(state.b);
      const byNorm = (m) => new Map([...m].map(([k, v]) => [norm(k), v]));
      const na = byNorm(A), nb = byNorm(B);
      const drifted = [];
      for (const [k, va] of na) {
        const vb = nb.get(k);
        assert.ok(vb !== undefined, `${k} exists in roll A but not roll B`);
        if (norm(va) !== norm(vb)) drifted.push(`${k}: ${firstDiff(norm(va), norm(vb))}`);
      }
      assert.deepEqual(drifted, [], `NON-DETERMINISTIC ROLLUP OUTPUT in ${state.batch.name}:\n  ${drifted.join('\n  ')}`);
      assert.ok(na.size >= 6, `only ${na.size} artifacts compared — expected rollup.json, rollup-<sliceId>.json, dashboard.html, REMEDIATION.md, lifecycle.json, cwx-registry.json, history/*`);
    });

    test('the CWX id set does not shrink across a re-roll (identity is append-only)', (t) => {
      if (guard(t)) return;
      // a re-roll of the same batch must mint the same CWX ids — identity is append-only
      const idsOf = (out) => {
        const f = snapshot(out).get('cwx-registry.json');
        if (f === undefined) return null;
        const j = JSON.parse(f);
        const collect = (o, acc = new Set()) => {
          if (!o || typeof o !== 'object') return acc;
          for (const [k, v] of Object.entries(o)) {
            if (/^CWX-/.test(k)) acc.add(k);
            if (typeof v === 'string' && /^CWX-/.test(v)) acc.add(v);
            else collect(v, acc);
          }
          return acc;
        };
        return collect(j);
      };
      const a = idsOf(state.a), b = idsOf(state.b);
      if (a === null) return t.skip('this batch mints no CWX ids (no non-CVE findings) — nothing to compare');
      assert.deepEqual([...b].sort(), [...a].sort(), 'a re-roll of the SAME batch must mint the same CWX ids, never a fresh set');
    });

    test('the re-roll wrote nothing into the repo — no monitor/data cache mutation', (t) => {
      if (guard(t)) return;
      // with fetch disabled the shared epss.json cache must stay untouched
      assert.equal(dataHash(), DATA_HASH_BEFORE, 'monitor/data/ changed during a re-rollup — a scratch-OUT roll must not mutate repo state');
    });
  });
}

// ── ARM 1: the shipped synthetic batch. Runs everywhere; never skips. ───────────────────────────
determinismSuite('synthetic fixture (runs in every checkout)', () => {
  const { bytes, files } = treeBytes(FIXTURE_BATCH);
  // Not a skip. The fixture is tracked, so an absent or truncated one is a broken repository, and
  // saying so here is the whole reason this arm exists.
  assert.ok(files >= 2, `the tracked fixture batch is missing or empty at ${FIXTURE_BATCH} (${files} files). `
    + 'It ships with the repository; this is not a host condition and must not be skipped.');
  const r = rollTwice({ name: 'sweep-20260101000000-fixture', path: FIXTURE_BATCH, bytes, files });
  assert.equal(r.rollError, undefined, `the shipped fixture batch did not roll up: ${r.rollError}`);
  return r;
});

// ── ARM 2: the newest-smallest real batch on this host, when there is one. ──────────────────────
determinismSuite('a stored live batch (host-dependent)', () => {
  const cands = candidateBatches();
  if (!cands.length) {
    return { skip: `SKIPPED (not a silent pass): no re-rollable batch dir under ${REPORTS}. This arm needs one stored sweep-<stamp>[-<area>] batch containing tool output; run \`node monitor/sweep.mjs fast <project>\` once, then re-run. The synthetic-fixture arm above ran and is the public witness for this invariant.` };
  }
  const tried = [];
  for (const batch of cands.slice(0, 3)) { // smallest three; a bigger tree is not a better test
    const r = rollTwice(batch);
    if (r.rollError) { tried.push(r.rollError); continue; }
    return r;
  }
  return { skip: `SKIPPED (not a silent pass): every candidate batch failed to roll up — ${tried.join(' · ')}` };
});
