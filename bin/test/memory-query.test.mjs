// bin/test/memory-query.test.mjs — the read surface, and the four states it must never merge.
//
// What these tests are actually defending. bin/memory-query.mjs exists because a write nobody reads
// cannot be missed when it breaks; a READER nobody checks fails the same way, one level up. The
// checks that matter here are the ones that would still pass if the tool quietly started rendering
// "veld is unreachable" as "veld holds nothing", so each of the four remote states is asserted to be
// DISTINGUISHABLE from the other three, in the text AND in the JSON.
//
// Two hermeticity rules, both load-bearing:
//   · the credential resolver is INJECTED. credential() falls through to lib/secrets.mjs, which
//     shells out to `security` and can block on a keychain ACL prompt. A test may not do that, and
//     a test that accidentally resolved a real key would pass for a reason it did not state.
//   · fetch is INJECTED. Nothing here touches the network.
//
// And the rule that makes every other test in this file mean something: T1 proves the env override
// actually routes to the fixture. A fixture path that silently fell through to the live store would
// leave every assertion below testing production data (CLAUDE.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { put, recordReceipt } from '../../lib/memory-store.mjs';
import {
  run, main, parseArgs, render, withhold, localDbPath, localState, remoteExternalId,
  queryTags, queryId, queryReceipts, queryStats, queryAdapters,
  REMOTE_OK, REMOTE_UNREACHABLE, REMOTE_NO_CREDENTIAL, REMOTE_NOT_QUERYABLE,
  LOCAL_OK, LOCAL_ABSENT, LOCAL_UNINITIALISED,
} from '../memory-query.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CRED_OK = () => ({ ok: true, key: 'fixture-key', source: 'env' });
const CRED_MISSING = () => ({ ok: false, key: null, source: null, missing: [{ name: 'VELD_API_KEY', reason: 'undeclared', detail: 'no ref' }] });

/** veld answers, with these memories. `[]` is a genuine empty answer. */
const fetchWith = (memories) => async (url) => {
  if (String(url).endsWith('/health')) return new Response('{}', { status: 200 });
  return new Response(JSON.stringify({ memories }), { status: 200, headers: { 'content-type': 'application/json' } });
};

/** veld is not there. Transport throws — the 127.0.0.1:3030 / 000 condition this box is actually in. */
const fetchDead = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:3030'); };

const ENV_BASE = { VELD_API_URL: 'http://127.0.0.1:3030', CW_VELD_PROJECT: 'commitwork', CW_NOW: '2026-09-07T00:00:00.000Z' };

/**
 * A fixture store. Set on process.env because lib/memory-store.mjs's dbPath() reads process.env
 * directly and takes no env argument — so this is also the only honest way to exercise the fallback
 * path a real invocation takes. Restored by the caller's t.after.
 */
function fixtureStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-memq-'));
  const db = join(dir, 'fixture.db');
  const prevDb = process.env.CW_MEMORY_DB;
  const prevNow = process.env.CW_NOW;
  process.env.CW_MEMORY_DB = db;
  process.env.CW_NOW = '2026-09-07T00:00:00.000Z';
  t.after(() => {
    if (prevDb === undefined) delete process.env.CW_MEMORY_DB; else process.env.CW_MEMORY_DB = prevDb;
    if (prevNow === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = prevNow;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db };
}

/** Two records, deliberately out of id order so an ordering assertion can bite. */
function seed(db) {
  process.env.CW_NOW = '2026-09-07T00:00:01.000Z';
  const a = put({ external_id: 'cw:rollup:beta', content: 'beta rollup body, several words of prose here', tags: ['commitwork', 'audit-rollup'] },
    { scope: 'commitwork-sweep', project: 'commitwork', path: db });
  process.env.CW_NOW = '2026-09-07T00:00:02.000Z';
  const b = put({ external_id: 'cw:rollup:alpha', content: 'alpha rollup body, several words of prose here', tags: ['commitwork', 'audit-rollup'] },
    { scope: 'commitwork-sweep', project: 'commitwork', path: db });
  process.env.CW_NOW = '2026-09-07T00:00:00.000Z';
  assert.equal(a.state, 'verified', a.reason || '');
  assert.equal(b.state, 'verified', b.reason || '');
  return { a, b };
}

// ── T1: the override actually routes to the fixture ─────────────────────────

test('T1 CW_MEMORY_DB is read at CALL time and routes every read to the fixture', (t) => {
  // Read BEFORE the override is set: if the module had captured process.env at import, this and
  // the post-override value would be identical and the whole file would be testing the live store.
  const before = localDbPath({});
  const { db } = fixtureStore(t);
  const after = localDbPath({});

  assert.notEqual(before, after, 'the override did not take effect — a module-load env read would look exactly like this');
  assert.equal(after, db);
  assert.equal(localState({}).state, LOCAL_ABSENT, 'a fresh fixture dir has no db file yet');

  seed(db);
  const st = localState({});
  assert.equal(st.state, LOCAL_OK);
  assert.equal(st.path, db, 'the reported path must be the fixture, never the repo default');

  const r = queryId('cw:rollup:alpha', {});
  assert.equal(r.local.found, true);
  assert.equal(r.local.path, db);
  // The decisive one: an id that exists ONLY in the fixture. If this resolved against the live
  // store it would not be found, and if the live store were being read the ids above would not be.
  assert.equal(queryId('cw:rollup:does-not-exist', {}).local.found, false);
});

test('T1b CW_DB is honoured as the second override, and an explicit env object wins', (t) => {
  const { dir } = fixtureStore(t);
  delete process.env.CW_MEMORY_DB;
  process.env.CW_DB = join(dir, 'via-cw-db.db');
  assert.equal(localDbPath({}), join(dir, 'via-cw-db.db'));
  assert.equal(localDbPath({ env: { CW_MEMORY_DB: '/injected/x.db' } }), '/injected/x.db');
  t.after(() => { delete process.env.CW_DB; });
});

// ── T2: absent store is a third answer ──────────────────────────────────────

test('T2 an absent store is ABSENT, never zero-matches and never clean', async (t) => {
  const { db } = fixtureStore(t);
  const r = await queryTags(['commitwork'], { env: ENV_BASE, fetchImpl: fetchWith([]), credentialImpl: CRED_OK });
  assert.equal(r.local.state, LOCAL_ABSENT);
  assert.equal(r.local.path, db);
  const text = render(r, {});
  assert.match(text, /store ABSENT/);
  assert.match(text, /not an empty result and not a clean one/);
  assert.doesNotMatch(text, /0 records in/, 'absence must not be phrased as a count');

  const s = await queryStats({ env: ENV_BASE, fetchImpl: fetchWith([]), credentialImpl: CRED_OK });
  assert.equal(s.local.storeAbsent, true);
  assert.equal(s.local.neverObserved, true);
  assert.match(render(s, {}), /strongest possible never-observed/);
});

test('T2c a file with no memory schema is UNINITIALISED — never zero records', async (t) => {
  // The state this box is actually in. dbPath()'s default is monitor/commitwork.db, which exists
  // and holds only taxonomy_* tables — so the naive read raises `no such table: memory_record`,
  // and the naive fix returns 0. Both are wrong in the same direction: they answer a question
  // nobody could answer.
  const { dir } = fixtureStore(t);
  const other = join(dir, 'taxonomy-shaped.db');
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(other);
  raw.exec('CREATE TABLE taxonomy_meta (k TEXT PRIMARY KEY, v TEXT)');
  raw.close();
  process.env.CW_MEMORY_DB = other;

  const st = localState({});
  assert.equal(st.state, LOCAL_UNINITIALISED);
  assert.notEqual(st.state, LOCAL_ABSENT, 'the file is there — that is a different fact from absence');
  assert.notEqual(st.state, LOCAL_OK);
  assert.match(st.reason, /no memory_record table/);

  // Every subcommand must survive it, withhold the counts, and say why.
  const opts = { env: ENV_BASE, fetchImpl: fetchWith([{ external_id: 'x' }]), credentialImpl: CRED_OK };
  const tags = await queryTags(['commitwork'], opts);
  assert.equal(tags.local.matches, null, 'an unreadable store matched nothing, it did not match zero');
  assert.equal(tags.correlation.determined, false, 'half an observation is not a comparison');
  assert.equal(tags.correlation.local, null);
  assert.match(render(tags, {}), /store UNINITIALISED/);
  assert.doesNotMatch(render(tags, {}), /0 local records matched/);

  const rec = queryReceipts('cw:x', {});
  assert.equal(rec.local.count, null);
  assert.equal(rec.neverObserved, null, 'never-observed is a claim about a ledger that exists');

  const stats = await queryStats(opts);
  assert.equal(stats.local.records, null, 'a count from a schema-less file would mean nothing');

  // And the CLI does not crash on any of them — the pre-fix behaviour was an unhandled throw.
  for (const argv of [['--tags', 'commitwork'], ['--id', 'x'], ['--receipts', 'x'], ['--stats'], ['--adapters']]) {
    const r = await run(argv, opts);
    assert.equal(r.exitCode, 0, `${argv.join(' ')} crashed on an uninitialised store`);
  }
});

test('T2d local-side grey binds as hard as remote-side grey — even when the remote DID answer', async (t) => {
  const { dir } = fixtureStore(t);
  process.env.CW_MEMORY_DB = join(dir, 'nothing-here.db');
  // Remote answered with results; local cannot answer. The comparison must still refuse to exist —
  // otherwise every remote record would render as "remote-only", a fabricated discrepancy.
  const r = await queryTags(['commitwork'], {
    env: ENV_BASE, credentialImpl: CRED_OK, fetchImpl: fetchWith([{ external_id: 'cw:rollup:alpha' }]),
  });
  assert.equal(r.remote.state, REMOTE_OK);
  assert.equal(r.remote.matches, 1);
  assert.equal(r.correlation.determined, false);
  assert.equal(r.correlation.remoteOnly, null, 'an unread local store cannot make a record remote-only');
  assert.match(r.correlation.reason, /the local store is absent/);
});

test('T2b a local store fault is not an empty result — only ENOENT is absence', async (t) => {
  const { dir } = fixtureStore(t);
  // A DIRECTORY where a file should be: stat() SUCCEEDS, so this is not ENOENT and must never be
  // reported as absence. The fault propagates — it does not matter at which call it surfaces, only
  // that it is never converted into an empty result set, which is the shape that lets a broken
  // query read as a clean store.
  process.env.CW_MEMORY_DB = dir;
  assert.throws(() => localState({}), (e) => e && e.code !== 'ENOENT');
  assert.throws(() => queryId('anything', {}));

  // And the CLI reports it as a FAULT — exit 2 with a message — never exit 0 with zero records.
  const err = [];
  const out = [];
  const prev = process.exitCode;
  await main(['--stats'], {
    out: { write: (x) => out.push(x) },
    err: { write: (x) => err.push(x) },
    env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK,
  });
  assert.equal(process.exitCode, 2, 'a fault must not exit 0');
  assert.equal(out.length, 0, 'nothing may be printed as a result when the query never ran');
  assert.match(err.join(''), /memory-query: /);
  process.exitCode = prev;
});

// ── T3: the four remote states are four different answers ───────────────────

test('T3 remote-unreachable, remote-empty and remote-has-results render as three distinct things', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const opts = { env: ENV_BASE, credentialImpl: CRED_OK };

  const dead = await queryTags(['commitwork'], { ...opts, fetchImpl: fetchDead });
  const empty = await queryTags(['commitwork'], { ...opts, fetchImpl: fetchWith([]) });
  const hits = await queryTags(['commitwork'], { ...opts, fetchImpl: fetchWith([{ external_id: 'cw:rollup:alpha' }]) });

  assert.equal(dead.remote.state, REMOTE_UNREACHABLE);
  assert.equal(empty.remote.state, REMOTE_OK);
  assert.equal(hits.remote.state, REMOTE_OK);

  // The upstream three-valued signal survives: null is "observed nothing", 0 is "observed zero".
  assert.equal(dead.remote.matches, null, 'a failed query observed nothing; 0 would claim it observed emptiness');
  assert.equal(empty.remote.matches, 0);
  assert.equal(hits.remote.matches, 1);
  assert.equal(dead.remote.ids, null);
  assert.deepEqual(empty.remote.ids, []);

  const tDead = render(dead, {});
  const tEmpty = render(empty, {});
  const tHits = render(hits, {});
  assert.notEqual(tDead, tEmpty);
  assert.notEqual(tEmpty, tHits);
  assert.notEqual(tDead, tHits);
  assert.match(tDead, /UNREACHABLE — nothing was observed\. This is not zero matches\./);
  assert.match(tEmpty, /0 matches returned/);
  assert.match(tEmpty, /asked and answered zero/);
  assert.doesNotMatch(tDead, /0 matches/, 'unreachable must never be phrased as a count');
});

test('T3b a missing credential is a LOCAL configuration fault, distinct from the remote being down', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  // A reachable remote and no key: the transport is fine, the box is not configured. Note the fetch
  // is the LIVE-looking one — if the tool conflated the two axes it would report "unreachable".
  const r = await queryTags(['commitwork'], { env: ENV_BASE, fetchImpl: fetchWith([{ external_id: 'x' }]), credentialImpl: CRED_MISSING });
  assert.equal(r.remote.state, REMOTE_NO_CREDENTIAL);
  assert.notEqual(r.remote.state, REMOTE_UNREACHABLE);
  assert.equal(r.remote.matches, null);
  const text = render(r, {});
  assert.match(text, /configuration fault on this box, not the remote being down/);

  const ad = await queryAdapters({ env: ENV_BASE, fetchImpl: fetchWith([]), credentialImpl: CRED_MISSING });
  assert.equal(ad.remote.state, REMOTE_NO_CREDENTIAL);
  assert.equal(ad.remote.credential.present, false);
  assert.equal(ad.remote.reachable, true, 'reachability and credential are separate axes and must stay separate');
  assert.match(render(ad, {}), /credential ABSENT/);
});

test('T3c the two grey states and the two answered states are pairwise different strings', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const texts = new Set();
  for (const [fetchImpl, credentialImpl] of [
    [fetchDead, CRED_OK], [fetchWith([]), CRED_MISSING], [fetchWith([]), CRED_OK], [fetchWith([{ external_id: 'cw:rollup:alpha' }]), CRED_OK],
  ]) {
    texts.add(render(await queryTags(['commitwork'], { env: ENV_BASE, fetchImpl, credentialImpl }), {}));
  }
  assert.equal(texts.size, 4, 'four different facts must produce four different outputs');
});

test('T3d not-queryable is its own state — the remote has no endpoint for identity or receipts', (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const byId = queryId('cw:rollup:alpha', {});
  assert.equal(byId.remote.state, REMOTE_NOT_QUERYABLE);
  assert.notEqual(byId.remote.state, REMOTE_UNREACHABLE, 'no endpoint is not the same as an outage');
  assert.match(byId.remote.reason, /no lookup by external_id/);

  const rec = queryReceipts('cw:rollup:alpha', {});
  assert.equal(rec.remote.state, REMOTE_NOT_QUERYABLE);
});

// ── T4: the correlation, and when it must refuse to exist ───────────────────

test('T4 local-only is reported as local-only, and labelled NORMAL rather than as a discrepancy', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  // veld holds one of the two. Local-first ordering makes the other's absence expected.
  const r = await queryTags(['commitwork'], {
    env: ENV_BASE, credentialImpl: CRED_OK, fetchImpl: fetchWith([{ external_id: 'cw:rollup:alpha' }]),
  });
  assert.equal(r.correlation.determined, true);
  assert.equal(r.correlation.local, 2);
  assert.equal(r.correlation.remote, 1);
  assert.deepEqual(r.correlation.both, ['cw:rollup:alpha']);
  assert.deepEqual(r.correlation.localOnly, ['cw:rollup:beta']);
  assert.deepEqual(r.correlation.remoteOnly, []);
  // Never summed into one number.
  const text = render(r, {});
  assert.match(text, /local 2 {3}remote 1 {3}both 1/);
  assert.match(text, /local-only is the NORMAL state/);
  assert.doesNotMatch(text, /\btotal 3\b/);
});

test('T4b when the remote did not answer, the correlation is UNDETERMINED — never "all local-only"', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  for (const [fetchImpl, credentialImpl] of [[fetchDead, CRED_OK], [fetchWith([]), CRED_MISSING]]) {
    const r = await queryTags(['commitwork'], { env: ENV_BASE, fetchImpl, credentialImpl });
    assert.equal(r.correlation.determined, false);
    assert.equal(r.correlation.local, 2, 'the local half is still a real, reportable count');
    assert.equal(r.correlation.remote, null);
    assert.equal(r.correlation.localOnly, null, 'calling these local-only would publish an unanswered question as a finding');
    assert.equal(r.correlation.remoteOnly, null);
    assert.equal(r.correlation.both, null);
    const text = render(r, {});
    assert.match(text, /UNDETERMINED/);
    assert.match(text, /They are NOT reported as/);
  }
});

test('T4c a remote record with no external_id is uncorrelatable, not remote-only', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const r = await queryTags(['commitwork'], {
    env: ENV_BASE, credentialImpl: CRED_OK,
    fetchImpl: fetchWith([{ external_id: 'cw:rollup:alpha' }, { id: 'veld-internal-1' }]),
  });
  assert.equal(r.remote.matches, 2);
  assert.equal(r.remote.unidentified, 1);
  assert.deepEqual(r.correlation.remoteOnly, [], 'an id-less record must not be invented into a discrepancy');
  assert.equal(r.correlation.remoteUnidentified, 1);
  assert.match(render(r, {}), /no external_id/);
});

test('T4d external_id is found on the record, nested experience, or metadata — and nowhere else', () => {
  assert.equal(remoteExternalId({ external_id: 'a' }), 'a');
  assert.equal(remoteExternalId({ experience: { external_id: 'b' } }), 'b');
  assert.equal(remoteExternalId({ metadata: { external_id: 'c' } }), 'c');
  assert.equal(remoteExternalId({ id: 'veld-row-9' }), null, 'a row id is not an identity');
  assert.equal(remoteExternalId({ external_id: '' }), null);
  assert.equal(remoteExternalId(null), null);
});

// ── T5: content is withheld ─────────────────────────────────────────────────

test('T5 record content never appears without --content, in TEXT or in JSON', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const BODY = 'alpha rollup body, several words of prose here';

  for (const argv of [['--tags', 'commitwork'], ['--id', 'cw:rollup:alpha']]) {
    for (const extra of [[], ['--json']]) {
      const r = await run([...argv, ...extra], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK });
      assert.doesNotMatch(r.text, new RegExp(BODY), `content leaked via ${[...argv, ...extra].join(' ')}`);
      assert.match(r.text, /content_withheld|content withheld/);
    }
  }

  // And it DOES appear when explicitly asked for — a withholding that also withholds on request is
  // a broken flag, not a safe one.
  const shown = await run(['--id', 'cw:rollup:alpha', '--content'], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK });
  assert.match(shown.text, new RegExp(BODY));
});

test('T5b withhold() strips content at every depth and leaves a marker', () => {
  const out = withhold({ a: { content: 'secret prose', b: [{ content: 'more', keep: 1 }] } }, false);
  assert.equal(JSON.stringify(out).includes('secret prose'), false);
  assert.equal(JSON.stringify(out).includes('more'), false);
  assert.equal(out.a.content_withheld, true);
  assert.equal(out.a.b[0].content_withheld, true);
  assert.equal(out.a.b[0].keep, 1);
  assert.equal(withhold({ content: 'x' }, true).content, 'x');
});

test('T5c a URL carrying userinfo is never echoed', async (t) => {
  fixtureStore(t);
  const env = { ...ENV_BASE, VELD_API_URL: 'http://user:hunter2@veld.example:3030' };
  const r = await run(['--adapters'], { env, fetchImpl: fetchDead, credentialImpl: CRED_OK });
  assert.doesNotMatch(r.text, /hunter2/);
  assert.doesNotMatch(r.text, /user:/);
  assert.match(r.text, /userinfo redacted/);
  // The credential itself must never reach the output either.
  const r2 = await run(['--adapters', '--json'], { env: ENV_BASE, fetchImpl: fetchWith([]), credentialImpl: CRED_OK });
  assert.doesNotMatch(r2.text, /fixture-key/);
  assert.match(r2.text, /"source": "env"/);
});

// ── T6: receipts, and zero receipts as grey ─────────────────────────────────

test('T6 zero receipts is NEVER OBSERVED, not a clean write history', (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const r = queryReceipts('cw:rollup:alpha', {});
  assert.equal(r.neverObserved, true);
  const text = render(r, {});
  assert.match(text, /NEVER OBSERVED/);
  assert.match(text, /not a clean write history/);
  assert.doesNotMatch(text, /verified/, 'nothing was verified, so the word must not appear');

  // The --id view says the same thing about the remote half.
  const byId = queryId('cw:rollup:alpha', {});
  assert.equal(byId.remoteLedger.state, 'never-observed');
  assert.equal(byId.remoteLedger.attempts, 0);
  assert.match(render(byId, {}), /unknown, not clean/);
});

test('T6b receipts are tallied per adapter, and an undeclared state gets its own counter', (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  recordReceipt({ external_id: 'cw:rollup:alpha', adapter: 'local', at: '2026-09-07T00:01:00.000Z', state: 'verified', storedForm: 'full' }, { path: db });
  recordReceipt({ external_id: 'cw:rollup:alpha', adapter: 'veld', at: '2026-09-07T00:02:00.000Z', state: 'failed', reason: 'HTTP 000', storedForm: 'unknown' }, { path: db });
  recordReceipt({ external_id: 'cw:rollup:alpha', adapter: 'veld', at: '2026-09-07T00:03:00.000Z', state: 'dry-run', reason: 'not attempted', storedForm: 'unknown' }, { path: db });

  const r = queryReceipts('cw:rollup:alpha', {});
  assert.equal(r.neverObserved, false);
  assert.equal(r.local.count, 3);
  assert.equal(r.local.byAdapter.local.verified, 1);
  assert.equal(r.local.byAdapter.veld.failed, 1);
  assert.equal(r.local.byAdapter.veld.dryRun, 1, 'a dry run wrote nothing and lost nothing — never folded into failed');
  assert.equal(r.local.byAdapter.veld.total, 2);

  // The ledger view surfaces the NEWEST remote attempt, and says it is second-hand.
  const byId = queryId('cw:rollup:alpha', {});
  assert.equal(byId.remoteLedger.adapter, 'veld');
  assert.equal(byId.remoteLedger.at, '2026-09-07T00:03:00.000Z');
  assert.equal(byId.remoteLedger.attempts, 2);
  assert.match(render(byId, {}), /never a live read/);
});

// ── T7: stats ───────────────────────────────────────────────────────────────

test('T7 --stats reports local totals and refuses to invent remote ones', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  recordReceipt({ external_id: 'cw:rollup:alpha', adapter: 'veld', at: '2026-09-07T00:02:00.000Z', state: 'accepted-unverified', reason: 'preview', storedForm: 'preview', storedCoverage: 0.02 }, { path: db });

  const r = await queryStats({ env: ENV_BASE, fetchImpl: fetchWith([]), credentialImpl: CRED_OK });
  assert.equal(r.local.records, 2);
  assert.equal(r.local.receipts, 1);
  assert.equal(r.local.neverObserved, false);
  assert.equal(r.local.adapters.veld.acceptedUnverified, 1);
  assert.equal(r.local.adapters.veld.storedPreview, 1);
  // Reachable, but there is still no aggregate endpoint — so the count is not-queryable, never 0.
  assert.equal(r.remote.state, REMOTE_NOT_QUERYABLE);
  assert.equal(r.remote.matches, null);
  const text = render(r, {});
  assert.match(text, /LOCAL receipts about the veld adapter, not veld's own totals/);
  assert.match(text, /1 preview/);

  // Unreachable takes precedence over not-queryable: an outage is the more specific fact.
  const dead = await queryStats({ env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK });
  assert.equal(dead.remote.state, REMOTE_UNREACHABLE);
});

// ── T8: determinism ─────────────────────────────────────────────────────────

test('T8 same inputs produce byte-identical output, and ordering does not depend on wire order', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const mk = (mem) => ({ env: ENV_BASE, credentialImpl: CRED_OK, fetchImpl: fetchWith(mem) });
  const mems = [{ external_id: 'cw:rollup:beta' }, { external_id: 'cw:rollup:alpha' }];

  const one = await run(['--tags', 'commitwork'], mk(mems));
  const two = await run(['--tags', 'commitwork'], mk(mems));
  assert.equal(one.text, two.text, 'two runs over identical inputs must be byte-identical');

  // Reverse the order veld happened to return them in: the output must not move.
  const rev = await run(['--tags', 'commitwork'], mk([...mems].reverse()));
  assert.equal(one.text, rev.text, 'wire order is not stable and must not leak into the output');

  // Local records: newest first, external_id breaking the tie. beta was written first, alpha second.
  const r = await queryTags(['commitwork'], mk(mems));
  assert.deepEqual(r.local.records.map((x) => x.external_id), ['cw:rollup:alpha', 'cw:rollup:beta']);
  assert.deepEqual(r.remote.ids, ['cw:rollup:alpha', 'cw:rollup:beta'], 'remote ids are sorted, not wire-ordered');
  assert.deepEqual(r.correlation.both, ['cw:rollup:alpha', 'cw:rollup:beta']);

  // Tag order in the argument must not change the answer either.
  const t1 = await run(['--tags', 'commitwork,audit-rollup'], mk(mems));
  const t2 = await run(['--tags', 'audit-rollup,commitwork'], mk(mems));
  assert.equal(t1.text, t2.text);
});

// ── T9: argument handling and exit codes ────────────────────────────────────

test('T9 parseArgs accepts each subcommand and refuses ambiguity', () => {
  assert.deepEqual(parseArgs(['--tags', 'a,b']), { json: false, content: false, limit: 50, subcommand: 'tags', value: 'a,b', help: false });
  assert.equal(parseArgs(['--stats', '--json']).json, true);
  assert.equal(parseArgs(['--adapters']).subcommand, 'adapters');
  assert.equal(parseArgs(['--receipts', 'x', '--limit', '3']).limit, 3);
  assert.equal(parseArgs(['--id', 'x', '--content']).content, true);

  assert.throws(() => parseArgs(['--tags', 'a', '--stats']), /one subcommand at a time/);
  assert.throws(() => parseArgs(['--tags']), /needs a value/);
  assert.throws(() => parseArgs(['--tags', '--json']), /needs a value/);
  assert.throws(() => parseArgs(['--limit', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('T9b an empty tag filter is refused rather than returning the whole store', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  await assert.rejects(queryTags([], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK }), /at least one tag/);
  await assert.rejects(queryTags([''], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK }), /at least one tag/);
});

test('T9c no subcommand prints usage with a non-zero code; grey remote still exits 0', async (t) => {
  fixtureStore(t);
  const none = await run([], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK });
  assert.equal(none.exitCode, 2);
  assert.match(none.text, /memory-query — read the memory records/);
  assert.equal((await run(['--help'], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_OK })).exitCode, 0);

  // The load-bearing one: an unreachable veld is grey, and grey is not red. Gating on it would
  // turn "nobody asked" into a failing check on every box that has no veld.
  const grey = await run(['--adapters'], { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_MISSING });
  assert.equal(grey.exitCode, 0);
});

test('T9d the module never calls process.exit — a pipe write is async and exit() truncates it', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../memory-query.mjs', import.meta.url), 'utf8');
  const live = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(/process\.exit\s*\(/.test(live), false, 'process.exit() truncates stdout at the 64KB pipe buffer while reporting success');
  assert.match(live, /process\.exitCode/);
  // And no module-load env capture, which would silently defeat every override above.
  assert.equal(/^\s*(?:export\s+)?const\s+\w+\s*=\s*process\.env\./m.test(live), false, 'env must be read at call time, inside functions');
});

// ── T10: the whole CLI against the state this box is actually in ────────────

test('T10 the tool is useful and correct with veld down and no credential — its normal condition', async (t) => {
  const { db } = fixtureStore(t);
  seed(db);
  const opts = { env: ENV_BASE, fetchImpl: fetchDead, credentialImpl: CRED_MISSING };

  for (const argv of [['--tags', 'commitwork'], ['--id', 'cw:rollup:alpha'], ['--receipts', 'cw:rollup:alpha'], ['--stats'], ['--adapters']]) {
    const r = await run(argv, opts);
    assert.equal(r.exitCode, 0, `${argv.join(' ')} must not fail merely because veld is down`);
    assert.ok(r.text.length > 0);
    // The local half still answers in full — that is the point of local-first ordering.
    assert.doesNotMatch(r.text, /undefined|\[object Object\]|NaN/, `${argv.join(' ')} rendered a hole`);
    // JSON must round-trip.
    const j = await run([...argv, '--json'], opts);
    assert.doesNotThrow(() => JSON.parse(j.text));
  }

  // And the local records are genuinely reported, not suppressed by the remote's silence.
  const r = await run(['--tags', 'commitwork'], opts);
  assert.match(r.text, /cw:rollup:alpha/);
  assert.match(r.text, /cw:rollup:beta/);
  assert.match(r.text, /2 records/);
});
