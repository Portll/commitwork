// Tests for lib/memory-layer-client.mjs (lives here because `npm test` globs bin/**, not lib/**).
// Fixture tests (fake fetch) prove the client's logic; live conformance (CW_VELD_LIVE=1) is the
// only thing that can catch memory-layer changing behaviour, and skips with a stated reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  upsert, verifyReceipt, recallByTags, config, scopeTags, redactionCheck, buildRow,
  tally, summarise, sha256, CREDENTIAL_FIELDS, NOT_ATTEMPTED,
  VERIFIED, ACCEPTED_UNVERIFIED, FAILED, CONTRACT_VERSION,
} from '../../lib/memory-layer-client.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = JSON.parse(readFileSync(join(HERE, '../../lib/memory-layer-contract.json'), 'utf8'));

const KEY = 'test-key-not-a-real-credential';
const ENV = { VELD_API_URL: 'http://memory-layer.test', VELD_USER_ID: 'portll', CW_VELD_PROJECT: 'CommitWork' };

/** A fake memory-layer that behaves the way the real one measurably does — including minting tags. */
function fakeInternalC({ mintTags = true, dropTag = null, omitContent = false, upsertStatus = 200, getStatus = 200, corrupt = false } = {}) {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'POST' });
    const u = new URL(url);
    if (u.pathname === '/health') return new Response('{"status":"healthy"}', { status: 200 });
    if (u.pathname === '/api/upsert') {
      if (upsertStatus !== 200) return new Response('{}', { status: upsertStatus });
      const body = JSON.parse(opts.body);
      const existing = [...store.values()].find((r) => r.external_id === body.external_id);
      const id = existing?.id || `id-${store.size + 1}`;
      // THE MEASURED BEHAVIOUR: memory-layer adds tags derived from content.
      const minted = mintTags ? String(body.content).split(/\s+/).filter(Boolean).slice(0, 6) : [];
      let tags = [...new Set([...body.tags, ...minted])];
      if (dropTag) tags = tags.filter((t) => t !== dropTag);
      store.set(id, { id, external_id: body.external_id, content: corrupt ? `${body.content}TAMPERED` : body.content, tags });
      return new Response(JSON.stringify({ id, success: true, was_update: Boolean(existing), version: existing ? 2 : 1 }), { status: 200 });
    }
    if (u.pathname.startsWith('/api/memory/')) {
      if (getStatus !== 200) return new Response('{}', { status: getStatus });
      if (!u.searchParams.get('user_id')) {
        return new Response(JSON.stringify({ code: 'INVALID_INPUT', message: "user_id required when API key is not tenant-bound" }), { status: 400 });
      }
      const rec = store.get(decodeURIComponent(u.pathname.split('/').pop()));
      if (!rec) return new Response('{}', { status: 404 });
      const experience = omitContent ? { tags: rec.tags } : { content: rec.content, tags: rec.tags };
      return new Response(JSON.stringify({ id: rec.id, experience }), { status: 200 });
    }
    if (u.pathname === '/api/recall/tags') {
      const body = JSON.parse(opts.body);
      const hits = [...store.values()].filter((r) => body.tags.every((t) => r.tags.includes(t)));
      return new Response(JSON.stringify({ memories: hits.map((r) => ({ id: r.id, experience: { content: r.content, tags: r.tags } })) }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, store, calls };
}

const rec = (over = {}) => ({
  content: 'COMMITWORK_AUDIT probe — no findings',
  memory_type: 'Context',
  tags: ['commitwork', 'audit-rollup'],
  external_id: 'commitwork:test:1',
  ...over,
});

// ── T1: scope tags are applied by the client ────────────────────────────────

test('T1 scope tags are applied by the client, not asked of the caller', async () => {
  const { fetchImpl, store } = fakeInternalC();
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, VERIFIED);
  // lowercase: the client normalises the project tag — /api/recall/tags matches EXACTLY
  assert.ok(r.tagsSent.includes('memory-layer-project:commitwork'), 'project scope missing');
  assert.ok(r.tagsSent.includes('scope:commitwork-sweep'), 'writer scope missing');
  assert.ok(r.tagsSent.includes('commitwork'), "caller's own tags must survive");
  assert.ok([...store.values()][0].tags.includes('scope:commitwork-sweep'));
});

test('T1b scopeTags refuses a write with no declared writer scope', () => {
  assert.throws(() => scopeTags(['x'], { env: ENV }), /writer scope is required/);
});

// ── T2: explicit uncertainty ───────────────────────────────────────────────────────

test('T2 readback unavailable yields accepted-unverified with a reason, not failed and not verified', async () => {
  const { fetchImpl } = fakeInternalC({ getStatus: 503 });
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, ACCEPTED_UNVERIFIED);
  assert.match(r.reason, /readback HTTP 503/);
  assert.notEqual(r.state, FAILED);
});

test('T2b every non-verified receipt carries a stated reason', async () => {
  const cases = [
    [fakeInternalC({ getStatus: 503 }), rec()],
    [fakeInternalC({ omitContent: true }), rec()],
    [fakeInternalC({ upsertStatus: 500 }), rec()],
    [fakeInternalC(), rec({ external_id: null })],
    [fakeInternalC(), rec({ content: 'x', Secret: 'leak' })],
  ];
  for (const [f, record] of cases) {
    const r = await upsert(record, { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl: f.fetchImpl });
    assert.notEqual(r.state, VERIFIED);
    assert.ok(r.reason && r.reason.length > 0, `state ${r.state} with no reason`);
  }
});

test('T2c a missing experience.content is unverified, NOT a mismatch', async () => {
  const { fetchImpl } = fakeInternalC({ omitContent: true });
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, ACCEPTED_UNVERIFIED);
  assert.match(r.reason, /cannot compare, which is not the same as a mismatch/);
});

test('T2d genuine content corruption IS failed', async () => {
  const { fetchImpl } = fakeInternalC({ corrupt: true });
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, FAILED);
  // Corruption keeps its OWN name. Preview-detection (added 2026-09-02, because memory-layer stores
  // a ~410-byte preview and a healthy large write can never hash-match) classifies every mismatch,
  // and if `divergent` collapsed into `preview` this check would silently stop working.
  assert.equal(r.storedForm, 'divergent');
  assert.match(r.reason, /not derived from the source/);
});

// ── T3: the tag-minting rule ────────────────────────────────────────────────

test('T3 tag SUBSET passes when memory-layer mints extra tags; EQUALITY would have failed', async () => {
  const { fetchImpl, store } = fakeInternalC({ mintTags: true });
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, VERIFIED, 'a healthy write must verify despite minted tags');
  const stored = [...store.values()][0].tags;
  assert.ok(stored.length > r.tagsSent.length, 'fixture must reproduce memory-layer minting extra tags');
  assert.notDeepEqual(stored.slice().sort(), r.tagsSent.slice().sort(),
    'if these were equal the test would not be exercising the real behaviour');
  assert.equal(r.tagsStoredCount, stored.length);
});

test('T3b a DROPPED sent-tag is accepted-unverified — content is right, scope is not', async () => {
  const { fetchImpl } = fakeInternalC({ dropTag: 'scope:commitwork-sweep' });
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, ACCEPTED_UNVERIFIED);
  assert.match(r.reason, /did not retain tag\(s\): scope:commitwork-sweep/);
  assert.equal(r.storedSha256, r.contentSha256, 'content matched; only the tag was lost');
});

// ── T4: env at CALL time ────────────────────────────────────────────────────

test('T4 env is read at call time — a variable set after import is honoured', async () => {
  const before = config({ env: { VELD_API_URL: 'http://one.test' } });
  const after = config({ env: { VELD_API_URL: 'http://two.test' } });
  assert.equal(before.url, 'http://one.test');
  assert.equal(after.url, 'http://two.test');

  const { fetchImpl, calls } = fakeInternalC();
  await upsert(rec(), { scope: 'commitwork-sweep', env: { ...ENV, VELD_API_URL: 'http://late.test' }, key: KEY, fetchImpl });
  // origin equality, not startsWith — the prefix form also matched http://late.test.evil.example
  assert.ok(calls.every((c) => new URL(c.url).origin === 'http://late.test'), 'a module-load const would have pinned the old base');
});

// ── T5: redaction, default closed ───────────────────────────────────────────

test('T5 the gate refuses a record carrying a credential-bearing key, by default', async () => {
  const { fetchImpl, store } = fakeInternalC();
  const r = await upsert(rec({ Raw: 'ghp_realtokenshape' }), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, FAILED);
  assert.match(r.reason, /redaction gate refused/);
  assert.equal(store.size, 0, 'nothing may reach memory-layer when the gate refuses');
});

test('T5b the gate refuses a credential serialised INTO content — content becomes tags', () => {
  const bad = redactionCheck({ content: 'finding at a.js — Secret: ghp_abc123' });
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join(' '), /content embeds a credential-bearing field/);
  assert.equal(redactionCheck({ content: 'ordinary audit prose' }).ok, true);
});

test('T5c empty content is refused — an empty write is not a legitimate write', () => {
  assert.equal(redactionCheck({ content: '' }).ok, false);
  assert.equal(redactionCheck({}).ok, false);
});

test('T5d buildRow constructs from a declared list and never spreads', () => {
  const src = { rule: 'js/xss', file: 'a.js', line: 7, Raw: 'ghp_secret', extra: 'undeclared' };
  const row = buildRow(src, ['rule', 'file', 'line']);
  assert.deepEqual(row, { rule: 'js/xss', file: 'a.js', line: 7 });
  assert.ok(!('Raw' in row) && !('extra' in row));
  assert.throws(() => buildRow(src, ['rule', 'Raw']), /refusing to serialise credential-bearing field/);
  assert.throws(() => buildRow(src, []), /declared field list is required/);
});

test('T5e the deny-list covers the scanners named in CLAUDE.md', () => {
  for (const f of ['Raw', 'RawV2', 'Secret', 'Match']) assert.ok(CREDENTIAL_FIELDS.includes(f), `${f} missing`);
});

// ── T6: the lying endpoint is not on the surface ────────────────────────────

test('T6 the client exposes no tag-filtered semantic recall', async () => {
  const mod = await import('../../lib/memory-layer-client.mjs');
  assert.ok(!('recall' in mod), '/api/recall must not be reachable through this client');
  assert.ok(!('search' in mod) && !('relevant' in mod));
  assert.equal(typeof mod.recallByTags, 'function');
});

test('T6b recallByTags hits the strict endpoint and returns null memories on failure, never []', async () => {
  const { fetchImpl, calls } = fakeInternalC();
  await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  const hit = await recallByTags(['scope:commitwork-sweep'], { env: ENV, key: KEY, fetchImpl });
  assert.equal(hit.ok, true);
  assert.equal(hit.memories.length, 1);
  assert.ok(calls.some((c) => c.url.includes('/api/recall/tags')));
  assert.ok(!calls.some((c) => c.url.endsWith('/api/recall')), 'the ignoring endpoint must never be called');

  const dead = await recallByTags(['x'], { env: ENV, key: KEY, fetchImpl: async () => new Response('{}', { status: 500 }) });
  assert.equal(dead.ok, false);
  assert.equal(dead.memories, null, 'a failed query has observed nothing; [] would claim it observed emptiness');
});

// ── T7: live conformance ────────────────────────────────────────────────────

const LIVE = process.env.CW_VELD_LIVE === '1';
test('T7 live conformance against a running memory-layer', { skip: LIVE ? false : 'CW_VELD_LIVE!=1 — skipped WITH A STATED REASON: fixtures cannot reproduce memory-layer minting tags from content, so this is the only check that would catch memory-layer changing that behaviour. Run: CW_VELD_LIVE=1 npm test' }, async (t) => {
  const { health, credential } = await import('../../lib/memory-layer-client.mjs');
  const h = await health({});
  if (!h.ok) return t.skip(`memory-layer unreachable (${h.reason}) — skipped, not passed`);
  const cred = credential({ report: false });
  if (!cred.ok) return t.skip('VELD_API_KEY unresolvable — skipped, not passed');

  const eid = `commitwork:selftest:${Date.now()}`;
  const content = `COMMITWORK_SELFTEST ${eid}\n- line two with trailing space \n\n`;
  const r = await upsert({ content, memory_type: 'Context', tags: ['commitwork-selftest'], external_id: eid },
    { scope: 'commitwork-selftest' });

  try {
    assert.equal(r.state, VERIFIED, `live write did not verify: ${r.reason}`);
    assert.equal(r.storedSha256, sha256(content), 'content must round-trip byte-identically');
    assert.equal(r.was_update, false);
    assert.equal(r.version, 1);
    // The contract's central claim, checked against the real server.
    assert.ok(r.tagsStoredCount > r.tagsSent.length,
      `memory-layer is expected to mint tags from content (contract tagsAreNotIdentity); sent ${r.tagsSent.length}, stored ${r.tagsStoredCount}`);

    const again = await upsert({ content: `${content}CHANGED`, memory_type: 'Context', tags: ['commitwork-selftest'], external_id: eid },
      { scope: 'commitwork-selftest' });
    assert.equal(again.id, r.id, 'upsert must be idempotent on external_id');
    assert.equal(again.was_update, true);
    assert.equal(again.version, 2);
  } finally {
    // Clean up via the QUERY PARAM. A header is rejected, which is the legacy forget-endpoint bug.
    const cfg = config({});
    await fetch(`${cfg.url}/api/forget/${r.id}?user_id=${encodeURIComponent(cfg.userId)}`,
      { method: 'DELETE', headers: { 'X-API-Key': cred.key } }).catch(() => {});
  }
});

// ── T8: determinism ─────────────────────────────────────────────────────────

test('T8 the SENT payload is deterministic; the STORED form is memory-layer’s', async () => {
  const a = fakeInternalC(); const b = fakeInternalC();
  const r1 = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl: a.fetchImpl });
  const r2 = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl: b.fetchImpl });
  assert.equal(r1.contentSha256, r2.contentSha256);
  assert.deepEqual(r1.tagsSent, r2.tagsSent, 'sent tags must be stably ordered');
  assert.deepEqual(r1.tagsSent, [...r1.tagsSent].sort());
});

// ── Receipt aggregation ─────────────────────────────────────────────────────

// ── the external_id identity canary ──────────────────────────────────────────
// An external_id embedding a moving value never collides, so every sweep inserts — invisible in a
// state tally, visible only as "N new" where a healthy run reads "0 new, N updated".
test('a re-run of the same external_id reports UPDATED, not new', async () => {
  const { fetchImpl } = fakeInternalC();
  const first = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  const again = await upsert(rec({ content: 'COMMITWORK_AUDIT probe — changed' }),
    { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });

  assert.equal(first.was_update, false, 'first write of an id is an insert');
  assert.equal(again.was_update, true, 'the SAME external_id must update, never re-insert');
  assert.equal(again.id, first.id, 'identity holds: same external_id, same record');

  const t = tally([first, again]);
  assert.equal(t.inserted, 1);
  assert.equal(t.updated, 1);
});

test('an external_id carrying a moving value re-inserts every run — the shape that regressed', async () => {
  const { fetchImpl } = fakeInternalC();
  // Deliberately keyed on a stamp, the way the exporter once was.
  const runs = [];
  for (const stamp of ['2026-08-05T01:00:00Z', '2026-08-05T02:00:00Z']) {
    runs.push(await upsert(rec({ external_id: `commitwork:rollup:${stamp}:repo` }),
      { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl }));
  }
  const t = tally(runs);
  assert.equal(t.updated, 0, 'a moving key can never collide');
  assert.equal(t.inserted, 2, 'so every run inserts — this is what "29 new" looks like');
  assert.equal(t.verified, 2, 'both verify, which is exactly why the state tally cannot catch this');
});

test('summarise always prints new/updated, so the healthy reading is visible too', () => {
  const s = summarise([{ state: VERIFIED, was_update: true }, { state: VERIFIED, was_update: true }]);
  assert.match(s, /0 new, 2 updated/, 'a canary only shown when it is already dead is not a canary');
});

test('was_update: null is neither new nor updated — an absent field is not an insert', () => {
  const t = tally([{ state: ACCEPTED_UNVERIFIED, was_update: null }]);
  assert.equal(t.inserted, 0);
  assert.equal(t.updated, 0);
});

test('tally is three-valued and summarise names every degraded state', () => {
  const t = tally([
    { state: VERIFIED, was_update: true }, { state: VERIFIED, was_update: true },
    { state: ACCEPTED_UNVERIFIED }, { state: FAILED }, { state: VERIFIED, truncated: true, was_update: false },
  ]);
  assert.deepEqual(t, {
    verified: 3, acceptedUnverified: 1, failed: 1, truncated: 1, total: 5,
    inserted: 1, updated: 2,
    // A dry run is neither a success nor a failure, and an undeclared state is a fact about this
    // client rather than about the store. Both get their own counter so neither can inflate `failed`.
    notAttempted: 0, unknownState: 0,
    // Stored form is its own axis: these receipts declare none, so every count is zero and
    // "0 failed" still cannot be read as "5 durable records". ALL FOUR forms are counted —
    // `divergent` used to fall through and have no number anywhere.
    storedFull: 0, storedPreview: 0, storedDivergent: 0, storedUnknown: 0,
  });
  const s = summarise([{ state: VERIFIED }, { state: ACCEPTED_UNVERIFIED }, { state: VERIFIED, truncated: true }]);
  assert.match(s, /accepted-unverified/);
  assert.match(s, /truncated at source/);
  const p = summarise([{ state: ACCEPTED_UNVERIFIED, storedForm: 'preview' }]);
  assert.match(p, /PREVIEW ONLY/, 'a previewed record must be named in the summary line, not just counted');
});

// ── The contract binds this implementation ──────────────────────────────────

// `user_id` answers WHO — if a value could be a `memory-layer-project:` or `scope:` tag, it is not a tenant.
test('the default tenant is an identity, not a project or a writer', () => {
  const tenant = config({ env: {} }).userId;
  const categories = ['commitwork', 'internal-d', 'claude-code', 'overwatch-layer', 'client-d', 'client-a', 'CommitWork'];
  assert.ok(!categories.includes(tenant),
    `${tenant} names a project or a writer. Those are what memory-layer-project:/scope: tags are for; ` +
    'putting one in user_id partitions the store along an axis no query can cross.');
  // the two axes are separate — scope still says claude-code where that is genuinely the writer
  assert.ok(scopeTags([], { scope: 'claude-code', env: {} }).includes('scope:claude-code'));
});

test('the organisation is not the tenant — `portll` is the person, `Portll` is the org', () => {
  assert.notEqual(config({ env: {} }).userId, 'Portll');
  // the tag is lowercased on the wire; the org-vs-person distinction lives in `user_id` alone
  assert.ok(scopeTags([], { scope: 'x', env: { CW_VELD_PROJECT: 'CommitWork' } }).includes('memory-layer-project:commitwork'));
});

test('the client agrees with lib/memory-layer-contract.json', () => {
  assert.equal(CONTRACT.contractVersion, CONTRACT_VERSION);
  assert.equal(config({ env: {} }).userId, CONTRACT.tenant.value, 'default tenant must match the contract');
  assert.ok(CONTRACT.redaction.denyList.length > 0, 'the contract deny-list is empty — the enforcement check below would pass having compared nothing');
  for (const f of CONTRACT.redaction.denyList) {
    assert.ok(CREDENTIAL_FIELDS.includes(f), `contract deny-list field ${f} not enforced by the client`);
  }
  for (const s of Object.keys(CONTRACT.receipt.states)) {
    assert.ok([VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED].includes(s), `contract declares an unknown state ${s}`);
  }
  // BOTH DIRECTIONS. The loop above catches a contract state the client does not implement; this
  // catches a client state the contract never declared — which is the direction `dry-run` came from,
  // emitted by a caller for as long as the contract said three states existed.
  for (const s of [VERIFIED, ACCEPTED_UNVERIFIED, FAILED, NOT_ATTEMPTED]) {
    assert.ok(s in CONTRACT.receipt.states, `client emits state ${s} that the contract does not declare`);
  }
  assert.equal(CONTRACT.redaction.default, 'CLOSED');
});

test('a receipt carries every field the contract requires', async () => {
  const { fetchImpl } = fakeInternalC();
  const r = await upsert(rec(), { scope: 'commitwork-sweep', env: ENV, key: KEY, fetchImpl });
  assert.ok(CONTRACT.receipt.required.length > 0, 'the contract requires no receipt fields — the check below would pass over an empty list');
  for (const f of CONTRACT.receipt.required) assert.ok(f in r, `receipt missing contract field ${f}`);
});

// ── the project default is explicit-first ───────────────────────────────────
// `project` fell back silently where `scope` threw — from a second repo, the default files every
// memory under commitwork's tag, verified clean and invisible to its own scoped search.
test('an explicit project overrides the default, so a second repo does not inherit commitwork’s tag', () => {
  const tags = scopeTags([], { scope: 'overwatch-layer', project: 'overwatch-layer', env: {} });
  assert.ok(tags.includes('memory-layer-project:overwatch-layer'));
  assert.ok(!tags.includes('memory-layer-project:commitwork'), 'an explicit project must win over the default');
  assert.ok(tags.includes('scope:overwatch-layer'));
});

test('an explicit project is lowercased like every other path', () => {
  assert.ok(scopeTags([], { scope: 'x', project: 'overwatch-layer', env: {} }).includes('memory-layer-project:overwatch-layer'));
});

test('config reports WHICH source answered, so a silently-wrong default is answerable', () => {
  assert.equal(config({ env: {} }).projectSource, 'default');
  assert.equal(config({ env: { CW_VELD_PROJECT: 'client-d' } }).projectSource, 'env');
  assert.equal(config({ env: { CW_VELD_PROJECT: 'client-d' } }).project, 'client-d');
});

test('upsert threads an explicit project through to the stored tags', async () => {
  const { fetchImpl, store } = fakeInternalC();
  const r = await upsert(rec(), { scope: 'overwatch-layer', project: 'overwatch-layer', env: ENV, key: KEY, fetchImpl });
  assert.equal(r.state, VERIFIED);
  assert.ok(r.tagsSent.includes('memory-layer-project:overwatch-layer'));
  assert.ok([...store.values()][0].tags.includes('memory-layer-project:overwatch-layer'));
});

// ── U1 / M1: the two defects the state-code taxonomy proved on 2026-09-07 ───

test('a dry run is NOT a failure — the unguarded else reported every no-op as data loss', () => {
  // Exactly the shape monitor/export-overwatch.mjs:71 pushes on --dry.
  const t = tally([{ external_id: 'x', state: NOT_ATTEMPTED, reason: 'dry run — nothing was written' }]);
  assert.equal(t.failed, 0, '`node monitor/sweep.mjs all --dry` printed "1 failed" for writing nothing');
  assert.equal(t.notAttempted, 1);
  assert.match(summarise([{ state: NOT_ATTEMPTED }]), /not attempted \(dry run\)/);
});

test('an undeclared state announces itself instead of inflating failed', () => {
  const t = tally([{ state: 'some-state-added-next-year' }]);
  assert.equal(t.failed, 0, 'the next undeclared value must not silently become a failure, as dry-run did');
  assert.equal(t.unknownState, 1);
  assert.match(summarise([{ state: 'some-state-added-next-year' }]), /state this client does not declare/);
});

test('divergent — corruption — is counted, and named louder than preview', () => {
  const t = tally([{ state: FAILED, storedForm: 'divergent' }]);
  assert.equal(t.storedDivergent, 1, 'the most severe stored form had no counter at all');
  assert.equal(t.storedPreview, 0);
  assert.equal(t.storedUnknown, 0);
  assert.match(summarise([{ state: FAILED, storedForm: 'divergent' }]), /STORED DIVERGENT \(corruption, not truncation\)/);
});

test('a previewed write is still never failed and never verified — the fix did not weaken that', () => {
  const t = tally([{ state: ACCEPTED_UNVERIFIED, storedForm: 'preview' }]);
  assert.equal(t.failed, 0);
  assert.equal(t.verified, 0);
  assert.equal(t.acceptedUnverified, 1);
  assert.equal(t.storedPreview, 1);
});
