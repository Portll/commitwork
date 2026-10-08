// node --test cra/test/ — GO ↔ CVE alias resolution, built from artifacts already on disk.
//
// The plumbing this replaces: govulncheck proves reachability against GO-2026-xxxx while the
// dependency lane records CVEs, so 0.31% of findings could see a proof that existed. The aliases
// were in every sweep's govulncheck.json the whole time — monitor/extractors.mjs parses `o.finding`
// and drops `o.osv`, which is where they live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const A = await import(pathToFileURL(join(REPO, 'cra', 'advisory-aliases.mjs')).href);

// govulncheck's real stream shape: concatenated pretty-printed objects, not one per line.
const stream = (records) => records.map((r) => JSON.stringify(r, null, 2)).join('\n');

function scratch(records) {
  const T = mkdtempSync(join(tmpdir(), 'alias-'));
  mkdirSync(join(T, 'sweep-x', 'repo-a'), { recursive: true });
  writeFileSync(join(T, 'sweep-x', 'repo-a', 'govulncheck.json'), stream(records));
  return T;
}

test('aliases are read from the osv records the finding-parser throws away', () => {
  const got = A.aliasesFromGovulncheck(stream([
    { osv: { id: 'GO-2026-4479', aliases: ['CVE-2026-26014', 'GHSA-9f3f-wv7r-qc8r'] } },
    { finding: { osv: 'GO-2026-4479', trace: [{ module: 'm', function: 'f' }] } },
  ]));
  assert.equal(got.length, 1, 'finding rows are not advisory records');
  assert.equal(got[0].id, 'GO-2026-4479');
  assert.deepEqual(got[0].aliases, ['CVE-2026-26014', 'GHSA-9F3F-WV7R-QC8R']);
});

test('an advisory with no aliases is kept, not dropped — we asked and there were none', () => {
  const got = A.aliasesFromGovulncheck(stream([{ osv: { id: 'GO-2026-1', aliases: [] } }]));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].aliases, []);
});

test('a lookup is TOTAL — an unknown id resolves to itself', () => {
  const T = scratch([{ osv: { id: 'GO-1', aliases: ['CVE-1'] } }]);
  const idx = A.buildAliasIndex({ dir: T });
  assert.deepEqual(A.aliasesOf(idx, 'CVE-NOT-SEEN'), ['CVE-NOT-SEEN']);
  rmSync(T, { recursive: true, force: true });
});

test('the group is fully connected and case-insensitive', () => {
  const T = scratch([{ osv: { id: 'GO-2026-1', aliases: ['CVE-2026-9', 'GHSA-abcd'] } }]);
  const idx = A.buildAliasIndex({ dir: T });
  const want = ['CVE-2026-9', 'GHSA-ABCD', 'GO-2026-1'];
  for (const id of want) assert.deepEqual(A.aliasesOf(idx, id), want, `${id} must see the whole group`);
  assert.deepEqual(A.aliasesOf(idx, 'cve-2026-9'), want, 'lookups are case-insensitive');
  rmSync(T, { recursive: true, force: true });
});

test('FAN-OUT is resolved and its degree recorded — one Go advisory covering several CVEs', () => {
  // Measured live: 880 GO ids alias to more than one CVE (GO-2021-0159 covers three).
  const T = scratch([{ osv: { id: 'GO-2021-0159', aliases: ['CVE-2015-5739', 'CVE-2015-5740', 'CVE-2015-5741'] } }]);
  const idx = A.buildAliasIndex({ dir: T });
  const proofs = new Map([['GO-2021-0159', { proof: 'yes' }]]);
  const r = A.resolveVia(idx, 'CVE-2015-5740', (id) => proofs.get(id));
  assert.equal(r.hit.proof, 'yes');
  assert.equal(r.via, 'GO-2021-0159', 'the consumer must be able to say WHICH advisory carries the proof');
  assert.equal(r.aliased, true);
  assert.equal(r.fanOut, 4, 'the degree is recorded so a proof reaching three CVEs is visible as that');
  rmSync(T, { recursive: true, force: true });
});

test('an AMBIGUOUS alias is REFUSED, never picked', () => {
  // Measured zero live (497 CVEs, each claimed by exactly one GO id). None-today is not none-ever,
  // and guessing which of two advisories carries a proof is how a wrong proof reaches a document.
  const T = scratch([
    { osv: { id: 'GO-A', aliases: ['CVE-SHARED'] } },
    { osv: { id: 'GO-B', aliases: ['CVE-SHARED'] } },
  ]);
  const idx = A.buildAliasIndex({ dir: T });
  assert.equal(idx.collisions.length, 1);
  assert.deepEqual(idx.collisions[0].claimedBy, ['GO-A', 'GO-B']);
  // Only the ALIAS route is ambiguous. A direct proof for the CVE itself is unambiguous and is
  // taken first, so the lookup must miss on CVE-SHARED for the ambiguity to be reachable at all.
  const viaAliasOnly = (id) => (id === 'CVE-SHARED' ? null : { proof: 'yes' });
  const r = A.resolveVia(idx, 'CVE-SHARED', viaAliasOnly);
  assert.equal(r.hit, null, 'an ambiguous proof must not be attributed');
  assert.equal(r.refused, 'ambiguous-alias');
  assert.deepEqual(r.claimedBy, ['GO-A', 'GO-B']);
  // …and a DIRECT proof for the same id is still honoured, because nothing is being guessed.
  const direct = A.resolveVia(idx, 'CVE-SHARED', () => ({ proof: 'direct' }));
  assert.equal(direct.hit.proof, 'direct');
  assert.equal(direct.refused, undefined);
  rmSync(T, { recursive: true, force: true });
});

test('a direct hit never consults aliases', () => {
  const T = scratch([{ osv: { id: 'GO-1', aliases: ['CVE-1'] } }]);
  const idx = A.buildAliasIndex({ dir: T });
  const r = A.resolveVia(idx, 'CVE-1', (id) => (id === 'CVE-1' ? { direct: true } : { via: true }));
  assert.equal(r.hit.direct, true);
  assert.equal(r.aliased, false);
  assert.equal(r.via, 'CVE-1');
  rmSync(T, { recursive: true, force: true });
});

test('a missing reports directory yields an EMPTY index, not a throw', () => {
  const idx = A.buildAliasIndex({ dir: join(tmpdir(), 'definitely-not-here-' + process.pid) });
  assert.equal(idx.forward.size, 0);
  assert.equal(idx.stats.artifacts, 0);
  assert.deepEqual(A.aliasesOf(idx, 'CVE-1'), ['CVE-1'], 'a total lookup still works with no index');
});

test('unparseable chunks are skipped, not fatal — a truncated artifact still yields its records', () => {
  const raw = stream([{ osv: { id: 'GO-1', aliases: ['CVE-1'] } }]) + '\n{ this is not json';
  const got = A.aliasesFromGovulncheck(raw);
  assert.equal(got.length, 1);
});

// ── bound to the real artifacts ─────────────────────────────────────────────────────────────────
test('the index built from THIS tree resolves GO ids to CVEs', () => {
  const dir = join(REPO, 'reports');
  if (!existsSync(dir)) return;                       // clean checkout
  const idx = A.buildAliasIndex({ dir });
  if (!idx.stats.artifacts) return;                   // no Go sweeps in this tree
  assert.ok(idx.stats.records > 0, 'artifacts were found but no osv records parsed — the stream split is wrong');
  assert.ok(idx.stats.aliasedCves > 0, 'no CVE aliases resolved from any artifact');
  // Collisions are recorded, and if any appear the resolver must refuse them rather than pick.
  for (const c of idx.collisions) assert.ok(c.claimedBy.length > 1);
});
