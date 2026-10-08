// monitor/test/ingest-external.test.mjs — the external-judgement return path: refusal without
// identity, schema rejection -> quarantine, expiry, invalidation on subject change, append-only
// chain, human-green ≠ scanner-clean. Fixtures only; monitor/issues.json is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// ids are opaque handles here; the org is set so minting works under either id format
process.env.CW_ISSUE_ORG = process.env.CW_ISSUE_ORG || 'FIXTURE';
// Ingesting a ruling files it in the calibration ledger, so these tests get a scratch one.
process.env.CW_VERDICT_DIR = mkdtempSync(join(tmpdir(), 'cw-ingest-verdicts-'));

const { emptyIssuesDoc, mintIssue, mutateIssue, verifyChain, readyIssues, closeIssue } =
  await import('../issue-store.mjs');
const {
  ingestExternal, reconcileDispositions, subjectDigest, issueSubject, greenKind,
  dispositionStatus, activeDisposition, judgementView, rescanArgv, rescanLevels, runRescan,
  loadQuarantine, defaultQuarantineSink, emptyQuarantineDoc,
  DISPOSITIONS, SUPPRESSING_DISPOSITIONS, RESCAN_NONE, REFUSALS,
} = await import('../ingest-external.mjs');
const { validateAgainstSchema } = await import('../registry.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));
const ISSUE_SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');
const JUDGEMENT_SCHEMA = resolve(HERE, '..', '..', 'schema', 'external-judgement.schema.json');

const T0 = '2026-08-03T12:00:00.000Z';
const daysAfter = (iso, d) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString();
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-ingest-'));

// A logged-in panel operator, in the shape monitor/attribution.mjs::sessionWho consumes.
const HUMAN = { user: 'portll@example.com', provider: 'local' };

/** A memory quarantine sink, so the spine's refusal ledger is observable without touching disk. */
function memSink() {
  const entries = [];
  const sink = (entry) => { entries.push(entry); return { entries }; };
  sink.entries = entries;
  return sink;
}

/** A store holding one open dep finding for jackson-databind 2.20.0. */
function depStore({ version = '2.20.0', severity = 'high' } = {}) {
  const doc = emptyIssuesDoc();
  doc.organisation = doc.organisation || 'FIXTURE';
  const { id } = mintIssue(doc, {
    area: 'client-a', repo: 'svc-api-gateway', kind: 'vuln', severity,
    // exactly the shape issue-store's titleForFinding composes: package@version id (repo)
    title: `com.fasterxml.jackson.core:jackson-databind@${version} CVE-2026-54515 (svc-api-gateway)`,
    source: { kind: 'finding', key: 'f:svc-api-gateway|osv|CVE-2026-54515|com.fasterxml.jackson.core:jackson-databind|pom.xml', tool: 'osv', rule: null },
  }, T0);
  return { doc, id };
}

/** A store holding one open scanner row anchored to a line's content hash. */
function rowStore({ hash = 'abc123' } = {}) {
  const doc = emptyIssuesDoc();
  doc.organisation = doc.organisation || 'FIXTURE';
  const { id } = mintIssue(doc, {
    area: 'commitwork', repo: 'commitwork', kind: 'code', severity: 'high',
    title: 'js/command-line-injection [sastCodeql] (commitwork)',
    source: { kind: 'scanner-row', key: 'sc:commitwork|sastCodeql|js/command-line-injection|admin/serve.mjs|1204', tool: 'sastCodeql', rule: 'js/command-line-injection' },
    anchor: { file: 'admin/serve.mjs', line: 1204, hash },
  }, T0);
  doc.issues[id].anchor = { file: 'admin/serve.mjs', line: 1204, hash };
  return { doc, id };
}

const judgement = (id, o = {}) => ({
  issueId: id, disposition: 'false-positive', rescan: 'none',
  reason: 'the vulnerable code path is unreachable from this service; verified by call-graph review',
  ...o,
});

const ingest = (doc, payload, o = {}) => ingestExternal(doc, payload, {
  now: T0, session: HUMAN, channel: 'http',
  schemaPath: JUDGEMENT_SCHEMA, quarantineSink: memSink(), ...o,
});

// ── (1) refusal without identity ─────────────────────────────────────────────────────────────────
test('NO IDENTITY: a perfectly well-formed judgement with no session is REFUSED, not filed', () => {
  const { doc, id } = depStore();
  const sink = memSink();
  const before = JSON.stringify(doc);
  for (const session of [null, undefined, {}, { user: '' }, { user: '   ' }, { provider: 'local' }]) {
    const out = ingest(doc, judgement(id), { session, quarantineSink: sink });
    assert.equal(out.ok, false);
    assert.equal(out.refused, REFUSALS.NO_IDENTITY);
  }
  // the store is byte-identical: a refusal writes NOTHING, not even a partial record
  assert.equal(JSON.stringify(doc), before);
  // every attempt is on the refusal ledger with who=null, never an invented author
  assert.equal(sink.entries.length, 6);
  assert.ok(sink.entries.every((e) => e.who === null && e.refused === REFUSALS.NO_IDENTITY));
});

test('NO IDENTITY is checked BEFORE the schema — an unsigned garbage payload refuses on identity', () => {
  const { doc } = depStore();
  const out = ingest(doc, { total: 'garbage' }, { session: null });
  assert.equal(out.refused, REFUSALS.NO_IDENTITY);
});

test('identity carrying control characters is refused (log forging / terminal escapes)', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id), { session: { user: `example.test@domain.xyx\n[sweep] all clear`, provider: 'local' } });
  assert.equal(out.refused, REFUSALS.BAD_IDENTITY);
});

test('an agent channel can never produce a `human` attribution, however it spells its name', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id), { channel: 'mcp', session: { user: 'portll', provider: 'mcp' } });
  assert.equal(out.ok, true);
  assert.equal(out.disposition.whoKind, 'machine');
  assert.equal(out.disposition.channel, 'mcp');
});

test('the panel channel with a real session IS recorded as human — the two are not the same record', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id));
  assert.equal(out.disposition.whoKind, 'human');
  assert.equal(out.disposition.who, 'portll@example.com (local)');   // sessionWho's one spelling
});

// ── (2) schema rejection -> quarantine, never a silent accept ────────────────────────────────────
test('SCHEMA: every malformed payload is quarantined and the store is untouched', () => {
  const { doc, id } = depStore();
  const before = JSON.stringify(doc);
  const sink = memSink();
  const bad = [
    { ...judgement(id), disposition: 'looks-fine-to-me' },        // not in the closed set
    { ...judgement(id), reason: 'nope' },                          // under the 8-char floor
    { ...judgement(id), reason: 'a'.repeat(2001) },                // over the 2000-char ceiling
    { ...judgement(id), reason: 'plausible\u0000reason text' },    // control character
    { ...judgement(id), extra: 'smuggled' },                       // additionalProperties: false
    { ...judgement(id), issueId: '../../etc/passwd' },             // not an id shape
    { ...judgement(id), subjectDigest: 'sha256:not-hex' },
    { ...judgement(id), expires: 'next tuesday' },
    (() => { const j = judgement(id); delete j.rescan; return j; })(),   // rescan is REQUIRED
    (() => { const j = judgement(id); delete j.reason; return j; })(),
  ];
  for (const payload of bad) {
    const out = ingest(doc, payload, { quarantineSink: sink });
    assert.equal(out.ok, false, `should have been refused: ${JSON.stringify(payload).slice(0, 80)}`);
    assert.equal(out.refused, REFUSALS.SCHEMA);
    assert.equal(out.quarantined, true);
    assert.ok(out.errors.length > 0);
  }
  assert.equal(JSON.stringify(doc), before, 'a refused payload must not have written anything');
  assert.equal(sink.entries.length, bad.length);
  // the quarantined payload is kept as an OPAQUE STRING — nothing structural is ever re-read
  assert.ok(sink.entries.every((e) => typeof e.payload === 'string' && /^sha256:[0-9a-f]{64}$/.test(e.payloadSha)));
  assert.ok(sink.entries.every((e) => e.who === 'portll@example.com (local)'));
});

test('a non-object payload (array, string, null) is refused as schema, never coerced', () => {
  const { doc } = depStore();
  for (const p of [null, undefined, 'ISS-000000', [], 42]) {
    assert.equal(ingest(doc, p).refused, REFUSALS.SCHEMA);
  }
});

test('the quarantine file itself FAILS CLOSED: only ENOENT reads as "nothing was refused"', () => {
  const d = tmp();
  assert.deepEqual(loadQuarantine({ path: join(d, 'never-written.json') }), emptyQuarantineDoc());
  const broken = join(d, 'q.json');
  writeFileSync(broken, '{"entries": [ truncated');
  assert.throws(() => loadQuarantine({ path: broken }), /not valid JSON/);
  writeFileSync(broken, '[]');
  assert.throws(() => loadQuarantine({ path: broken }), /not a quarantine document/);
});

test('the default quarantine sink writes atomically, appends, and COUNTS what retention drops', () => {
  const path = join(tmp(), 'q.json');
  for (let i = 0; i < 5; i++) {
    defaultQuarantineSink({ at: T0, channel: 'http', who: null, refused: 'schema', errors: [], payload: `p${i}`, payloadSha: 'sha256:' + '0'.repeat(64), payloadTruncated: false }, { path, max: 3 });
  }
  const doc = loadQuarantine({ path });
  assert.equal(doc.entries.length, 3);
  assert.equal(doc.dropped, 2, 'entries rolled off must be COUNTED, never silently lost');
  assert.ok(existsSync(path));
});

test('a quarantine sink that throws does not turn a refusal into an accept', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, { ...judgement(id), disposition: 'nonsense' }, {
    quarantineSink: () => { throw new Error('disk full'); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.quarantined, false);
  assert.ok(out.errors.some((e) => /quarantine write failed/.test(e)));
});

// ── the re-scan level is never picked for the caller ─────────────────────────────────────────────
test('an unknown re-scan level is REFUSED — no level is ever silently defaulted to `all`', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id, { rescan: 'thorough' }));
  assert.equal(out.refused, REFUSALS.UNKNOWN_LEVEL);
  assert.ok(/No level is picked for you/.test(out.errors[0]));
});

test('the sweep groups, every declared check id, and the literal `none` are all accepted', () => {
  const levels = rescanLevels();
  for (const g of ['all', 'fast', 'supply-chain', 'deep', RESCAN_NONE, 'sast-codeql', 'deps-osv']) {
    assert.ok(levels.has(g), `${g} should be a legal re-scan level`);
    const { doc, id } = depStore();
    assert.equal(ingest(doc, judgement(id, { rescan: g })).ok, true, g);
  }
});

test('rescanArgv is an ARGV ARRAY of allowlist-canonical parts, and refuses anything else', () => {
  assert.deepEqual(rescanArgv('none', 'client-a'), null);
  const argv = rescanArgv('fast', 'client-a', { root: '/cw' });
  // join(), not a POSIX literal. This argv is SPAWNED, so the script path must be OS-native —
  // `\cw\monitor\sweep.mjs` is correct on Windows and the literal was pinning the platform rather
  // than the property. What matters here is that the parts are allowlist-canonical and that the
  // level and area arrive as separate argv elements, which the join does not obscure.
  assert.deepEqual(argv, ['node', join('/cw', 'monitor', 'sweep.mjs'), 'fast', 'client-a']);
  assert.throws(() => rescanArgv('fast; rm -rf /', 'client-a'), /unknown level/);
  assert.throws(() => rescanArgv('fast', '../../etc'), /unresolvable area/);
  assert.throws(() => rescanArgv('fast', 'client-a; id'), /unresolvable area/);
});

test('runRescan spawns the argv it was given, and CW_INGEST_RESCAN=0 records without spawning', () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: 1234, unref() {} }; };
  const argv = rescanArgv('deep', 'client-a', { root: '/cw' });
  const ran = runRescan(argv, { spawn, enabled: true });
  assert.equal(ran.spawned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'node');
  assert.deepEqual(calls[0].args, [join('/cw', 'monitor', 'sweep.mjs'), 'deep', 'client-a']);
  assert.equal(calls[0].opts.detached, true);
  assert.ok(!('shell' in calls[0].opts), 'never shell:true');
  const off = runRescan(argv, { spawn, enabled: false });
  assert.equal(off.spawned, false);
  assert.match(off.reason, /disabled/);
  assert.equal(calls.length, 1, 'disabled must mean NOT spawned, not spawned-and-ignored');
  assert.deepEqual(runRescan(null, { spawn }), { spawned: false, reason: 'none', argv: null });
});

test('the re-scan sweep gets the scanner env: harness credentials stay with the caller', () => {
  const calls = [];
  const spawn = (cmd, args, opts) => { calls.push(opts); return { pid: 1, unref() {} }; };
  const env = { PATH: '/bin', VELD_API_KEY: 'v', CLAUDE_CODE_OAUTH_TOKEN: 'c', ANTHROPIC_API_KEY: 'a', MCP_X: 'm' };
  runRescan(rescanArgv('deep', 'client-a', { root: '/cw' }), { spawn, enabled: true, env });
  assert.ok(calls[0].env, 'no env given: the child inherits the whole caller env');
  assert.equal(calls[0].env.PATH, '/bin');
  for (const k of ['VELD_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'MCP_X']) assert.equal(calls[0].env[k], undefined, `${k} reached the sweep`);
});

// ── (3) expiry ───────────────────────────────────────────────────────────────────────────────────
test('a suppressing ruling with no named expiry gets the default TTL — nothing suppresses forever', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id));
  assert.ok(out.disposition.expires, 'a false-positive with no expiry must still expire');
  assert.equal(out.disposition.expires, daysAfter(T0, 90));
});

test('`remediated` NEVER carries an expiry — it is a claim ended by scan evidence, not by a clock', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id, { disposition: 'remediated', rescan: 'fast', expires: daysAfter(T0, 30) }));
  assert.equal(out.ok, true);
  assert.equal(out.disposition.expires, null);
});

test('an expired ruling stops being in force, and the issue is no longer human-green', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id, { expires: daysAfter(T0, 10) }));
  const iss = doc.issues[id];
  assert.equal(greenKind(iss, { now: daysAfter(T0, 9) }), 'human-green');
  assert.equal(dispositionStatus(out.disposition, { now: daysAfter(T0, 9) }), 'active');
  assert.equal(greenKind(iss, { now: daysAfter(T0, 11) }), 'open');
  assert.equal(dispositionStatus(out.disposition, { now: daysAfter(T0, 11) }), 'expired');
  // the RULING IS STILL THERE — expiry ends its force, it does not delete the record
  assert.equal(iss.dispositions.length, 1);
  assert.equal(activeDisposition(iss, { now: daysAfter(T0, 11) }), null);
});

test('an expiry in the past, or beyond the ceiling, is refused rather than quietly clamped', () => {
  const { doc, id } = depStore();
  const past = ingest(doc, judgement(id, { expires: daysAfter(T0, -1) }));
  assert.equal(past.refused, REFUSALS.BAD_EXPIRY);
  const forever = ingest(doc, judgement(id, { expires: daysAfter(T0, 900) }));
  assert.equal(forever.refused, REFUSALS.BAD_EXPIRY);
  assert.ok(/deletion with extra steps/.test(forever.errors[0]));
});

// ── (4) invalidation when the subject changes ────────────────────────────────────────────────────
test('THE INVALIDATION KEY IS NOT THE FINDING KEY: a version bump moves the subject digest', () => {
  const a = depStore({ version: '2.20.0' });
  const b = depStore({ version: '2.21.5' });
  // identical source key — rollup.mjs's keyOf carries NO version, which is exactly the trap
  assert.equal(a.doc.issues[a.id].source.key, b.doc.issues[b.id].source.key);
  assert.notEqual(subjectDigest(a.doc.issues[a.id]), subjectDigest(b.doc.issues[b.id]));
});

test('a false-positive on 2.20.0 is INVALIDATED by the bump to 2.21.5, and the waiver is withdrawn', () => {
  const { doc, id } = depStore({ version: '2.20.0' });
  ingest(doc, judgement(id));
  const iss = doc.issues[id];
  assert.equal(greenKind(iss, { now: T0 }), 'human-green');
  assert.ok(iss.waiver, 'a suppressing ruling installs a waiver so the work queue skips it');
  assert.equal(readyIssues(doc, { now: T0 }).length, 0);

  // the package is upgraded; issue-store's fileOrRefresh carries the new composed title through
  const at1 = daysAfter(T0, 1);
  mutateIssue(doc, id, (i) => {
    i.title = 'com.fasterxml.jackson.core:jackson-databind@2.21.5 CVE-2026-54515 (svc-api-gateway)';
  }, 'issue-updated', { title: { from: 'old', to: 'new' } }, at1);

  // out of force IMMEDIATELY, before anything reconciles it into the store
  assert.equal(greenKind(iss, { now: at1 }), 'open');
  assert.equal(dispositionStatus(iss.dispositions[0], { now: at1, currentDigest: subjectDigest(iss) }), 'stale-subject');

  const { invalidated } = reconcileDispositions(doc, { now: at1 });
  assert.equal(invalidated.length, 1);
  assert.equal(iss.dispositions[0].invalidatedAt, at1);
  assert.match(iss.dispositions[0].invalidatedReason, /subject moved/);
  assert.equal(iss.waiver, null, 'the silence must not outlive the reason for it');
  assert.equal(readyIssues(doc, { now: at1 }).length, 1, 'the finding is back in the work queue');
  // and the ruling is STILL READABLE — invalidation is an append, never a delete
  assert.equal(iss.dispositions.length, 1);
  assert.equal(iss.dispositions[0].disposition, 'false-positive');
});

test('an anchored line changing invalidates a ruling about the code at that line', () => {
  const { doc, id } = rowStore({ hash: 'abc123' });
  ingest(doc, judgement(id));
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'human-green');
  doc.issues[id].anchor = { file: 'admin/serve.mjs', line: 1204, hash: 'def456' };
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'open');
});

test('a line RENUMBERING does not invalidate anything — the digest is over content, not position', () => {
  const { doc, id } = rowStore({ hash: 'abc123' });
  ingest(doc, judgement(id));
  const before = subjectDigest(doc.issues[id]);
  doc.issues[id].anchor = { file: 'admin/serve.mjs', line: 1999, hash: 'abc123' };
  assert.equal(subjectDigest(doc.issues[id]), before);
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'human-green');
});

test('a severity re-score invalidates an accepted-risk ruling — it is the input that ruling weighed', () => {
  const { doc, id } = depStore({ severity: 'med' });
  ingest(doc, judgement(id, { disposition: 'not-applicable' }));
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'human-green');
  doc.issues[id].severity = 'crit';
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'open');
});

test('a claim/release cycle does NOT invalidate a ruling — lifecycle churn is out of the digest', () => {
  const { doc, id } = depStore();
  ingest(doc, judgement(id));
  const before = subjectDigest(doc.issues[id]);
  const iss = doc.issues[id];
  iss.state = 'claimed';
  iss.claim = { by: 'someone', sessionId: 's1', at: T0, expiresAt: daysAfter(T0, 1) };
  iss.attemptCount = 3;
  iss.evidence.push({ at: T0, tier: 'scan-absent', detail: 'noise' });
  iss.updatedAt = daysAfter(T0, 1);
  assert.equal(subjectDigest(iss), before);
});

test('subjectDigest is stable under key reordering and is store-derived only', () => {
  const { doc, id } = depStore();
  const iss = doc.issues[id];
  const d1 = subjectDigest(iss);
  const reordered = Object.fromEntries(Object.entries(iss).reverse());
  assert.equal(subjectDigest(reordered), d1);
  // the subject carries no field a caller could supply
  assert.deepEqual(Object.keys(issueSubject(iss)).sort(),
    ['anchorHash', 'groupMembers', 'repo', 'rule', 'severity', 'sourceKey', 'sourceKind', 'title', 'tool']);
});

test('a pinned subjectDigest that no longer matches is REFUSED as stale, not mis-filed', () => {
  const { doc, id } = depStore();
  const pinned = subjectDigest(doc.issues[id]);
  doc.issues[id].severity = 'crit';                      // the subject moved between read and write
  const out = ingest(doc, judgement(id, { subjectDigest: pinned }));
  assert.equal(out.refused, REFUSALS.STALE_SUBJECT);
  assert.ok(/judge what is there now/.test(out.errors[0]));
  assert.ok(!doc.issues[id].dispositions, 'nothing was written');
});

test('a pinned subjectDigest that DOES match is accepted', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id, { subjectDigest: subjectDigest(doc.issues[id]) }));
  assert.equal(out.ok, true);
});

// ── (5) append-only + chain integrity ────────────────────────────────────────────────────────────
test('a judgement is a HASH-CHAINED EVENT; the chain and the derived index stay consistent', () => {
  const { doc, id } = depStore();
  const eventsBefore = doc.events.length;
  ingest(doc, judgement(id, { rescan: 'fast' }));
  assert.deepEqual(verifyChain(doc), []);
  assert.equal(doc.events.length, eventsBefore + 2);
  const ev = doc.events[doc.events.length - 2];
  assert.equal(ev.type, 'issue-disposition');
  assert.equal(ev.issueId, id);
  // the event carries the attribution and the invalidation key, so the trail stands alone
  assert.equal(ev.data.disposition, 'false-positive');
  assert.equal(ev.data.whoKind, 'human');
  assert.equal(ev.data.rescan, 'fast');
  assert.match(ev.data.subjectDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(doc.events.at(-1).type, 'fix-authored');
  assert.equal(doc.events.at(-1).data.action, 'false-positive');

  reconcileDispositions(doc, { now: T0 });   // no-op, nothing moved
  assert.equal(doc.events.length, eventsBefore + 2);
  doc.issues[id].severity = 'crit';
  reconcileDispositions(doc, { now: daysAfter(T0, 1) });
  assert.deepEqual(verifyChain(doc), []);
  assert.equal(doc.events[doc.events.length - 1].type, 'issue-disposition-invalidated');
});

test('tampering with a filed judgement after the fact is DETECTED by the chain', () => {
  const { doc, id } = depStore();
  ingest(doc, judgement(id));
  doc.events[doc.events.length - 1].data.disposition = 'remediated';
  assert.ok(verifyChain(doc).some((p) => /hash mismatch/.test(p)));
});

test('successive judgements APPEND — the newest is in force, the older ones stay readable', () => {
  const { doc, id } = depStore();
  ingest(doc, judgement(id, { disposition: 'false-positive', reason: 'unreachable from this service, per call graph' }));
  ingest(doc, judgement(id, { disposition: 'not-applicable', reason: 'reachable after all, but dev-only build chain — accepted' }), { now: daysAfter(T0, 1) });
  const iss = doc.issues[id];
  assert.equal(iss.dispositions.length, 2);
  assert.equal(activeDisposition(iss, { now: daysAfter(T0, 1) }).disposition, 'not-applicable');
  assert.equal(iss.dispositions[0].disposition, 'false-positive', 'the superseded ruling is not deleted');
  assert.deepEqual(verifyChain(doc), []);
});

test('the finding is NEVER deleted and NEVER closed by a judgement', () => {
  const { doc, id } = depStore();
  for (const d of DISPOSITIONS) {
    ingest(doc, judgement(id, { disposition: d, reason: `judged as ${d} for a defensible reason` }));
    assert.ok(doc.issues[id], 'the issue still exists');
    assert.equal(doc.issues[id].state, 'open', 'a judgement never changes state');
    assert.equal(doc.issues[id].closedAs, null, 'a judgement never closes as fixed');
  }
});

test('an already-closed issue cannot be judged — reopen it first', () => {
  const { doc, id } = depStore();
  closeIssue(doc, id, { as: 'accepted', evidence: 'closed by hand for this fixture', at: T0 });
  const out = ingest(doc, judgement(id));
  assert.equal(out.refused, REFUSALS.CLOSED_ISSUE);
});

test('an unknown issue id is refused and recorded, never minted into existence', () => {
  const { doc } = depStore();
  const sink = memSink();
  const out = ingest(doc, judgement('ISS-ZZZZZZ'), { quarantineSink: sink });
  assert.equal(out.refused, REFUSALS.UNKNOWN_ISSUE);
  assert.equal(Object.keys(doc.issues).length, 1);
  assert.equal(sink.entries.length, 1);
});

// ── (6) human-green is NOT scanner-clean ─────────────────────────────────────────────────────────
test('HUMAN-GREEN vs SCANNER-CLEAN: distinguishable in the STORE', () => {
  // human-green: still open, no closedAs, carrying an attributed ruling
  const h = depStore();
  ingest(h.doc, judgement(h.id));
  const human = h.doc.issues[h.id];
  assert.equal(human.state, 'open');
  assert.equal(human.closedAs, null);
  assert.equal(human.dispositions.length, 1);
  assert.ok(human.dispositions[0].who && human.dispositions[0].at && human.dispositions[0].reason,
    'who / when / why all travel with the ruling');

  // scanner-clean: closed as fixed on a MACHINE evidence tier, with no disposition anywhere
  const s = depStore();
  const scanner = s.doc.issues[s.id];
  mutateIssue(s.doc, s.id, (i) => {
    i.state = 'closed'; i.closedAs = 'fixed';
    i.evidence.push({ at: T0, tier: 'strong', detail: 'remediation ledger: version bumped and verified' });
  }, 'issue-closed', { closedAs: 'fixed', auto: true }, T0);

  assert.notEqual(human.state, scanner.state);
  assert.equal(scanner.dispositions, undefined, 'a scanner-clean issue carries no human ruling');
  assert.equal(greenKind(human, { now: T0 }), 'human-green');
  assert.equal(greenKind(scanner, { now: T0 }), 'scanner-clean');
});

test('HUMAN-GREEN vs SCANNER-CLEAN: distinguishable on OUTPUT, and never collapsed to a boolean', () => {
  const h = depStore();
  ingest(h.doc, judgement(h.id));
  const view = judgementView(h.doc.issues[h.id], { now: T0 });
  assert.equal(view.greenKind, 'human-green');
  assert.equal(view.dispositions[0].status, 'active');
  assert.equal(view.dispositions[0].whoKind, 'human');
  assert.ok(view.subjectDigest.startsWith('sha256:'));
  // structured fields and the operator's own reason — never scanner message text
  assert.deepEqual(Object.keys(view).sort(),
    ['area', 'dispositions', 'greenKind', 'id', 'severity', 'state', 'subjectDigest']);
});

test('`remediated` is CLAIMED-FIXED, not green, and does NOT suppress the work queue', () => {
  const { doc, id } = depStore();
  const out = ingest(doc, judgement(id, { disposition: 'remediated', rescan: 'supply-chain', reason: 'bumped to 2.21.5 and regenerated the lockfile' }));
  assert.equal(out.ok, true);
  assert.equal(out.greenKind, 'claimed-fixed');
  assert.equal(doc.issues[id].waiver, null, 'a claim of a fix must not silence the finding');
  assert.equal(readyIssues(doc, { now: T0 }).length, 1, 'it stays in the queue until a scanner agrees');
  assert.ok(!SUPPRESSING_DISPOSITIONS.includes('remediated'));
});

test('a close as `fixed` with NO machine evidence tier is GREY, never scanner-clean', () => {
  const { doc, id } = depStore();
  mutateIssue(doc, id, (i) => {
    i.state = 'closed'; i.closedAs = 'fixed';
    i.evidence.push({ at: T0, tier: 'manual', detail: 'someone said so' });
  }, 'issue-closed', { closedAs: 'fixed' }, T0);
  assert.equal(greenKind(doc.issues[id], { now: T0 }), 'grey');
});

// ── schema + determinism ─────────────────────────────────────────────────────────────────────────
test('a store carrying dispositions validates against issue.schema.json', () => {
  const { doc, id } = depStore();
  ingest(doc, judgement(id, { rescan: 'fast' }));
  // scoped to disposition errors — the store's root keys belong to the org-scoped-id work
  const { errors } = validateAgainstSchema(doc, { path: ISSUE_SCHEMA });
  assert.deepEqual(errors.filter((e) => /disposition/i.test(e)), []);
});

test('a HAND-EDITED disposition (unknown key, bad id, bogus digest) is rejected by the schema', () => {
  const { doc, id } = depStore();
  ingest(doc, judgement(id));
  doc.issues[id].dispositions[0].smuggled = 'yes';
  doc.issues[id].dispositions[0].subjectDigest = 'trust-me';
  const { errors } = validateAgainstSchema(doc, { path: ISSUE_SCHEMA });
  const mine = errors.filter((e) => /disposition/i.test(e));
  assert.ok(mine.some((e) => /smuggled/.test(e)), JSON.stringify(mine));
  assert.ok(mine.some((e) => /subjectDigest/.test(e)), JSON.stringify(mine));
});

test('external-judgement.schema.json uses only keywords the runtime checker implements', () => {
  const { doc, id } = depStore();
  const { errors } = validateAgainstSchema(judgement(id), { path: JUDGEMENT_SCHEMA });
  assert.deepEqual(errors, []);
  assert.ok(!doc || true);
});

// ── the enabler: issue-store's refresh must carry a version change into the record ───────────────
// rollup's keyOf carries no version, so the digest can only move if the title carries it
test('ingestArea carries a package VERSION change into the stored title, so the digest can move', async () => {
  const { titleForFinding } = await import('../issue-store.mjs');
  const { ingestArea } = await import('../issue-ingest.mjs');
  const finding = (version) => ({
    key: `svc-api-gateway|osv|CVE-2026-54515|jackson-databind|pom.xml`,
    repo: 'svc-api-gateway', tool: 'osv', id: 'CVE-2026-54515',
    package: 'jackson-databind', version, severity: 'high', state: 'persisting',
  });
  const rollup = (version, generated) => ({
    sliceId: `sweep-${generated}`, generated,
    repos: [{ name: 'svc-api-gateway', findings: [finding(version)] }],
    scanners: {}, scannerFindings: {},
  });

  const doc = emptyIssuesDoc();
  doc.organisation = doc.organisation || 'FIXTURE';
  const t1 = T0;
  ingestArea(doc, { areaSlug: 'client-a', rollup: rollup('2.20.0', t1), now: t1 });
  const id = doc.byKey['f:svc-api-gateway|osv|CVE-2026-54515|jackson-databind|pom.xml'];
  assert.ok(id);
  const before = subjectDigest(doc.issues[id]);
  assert.match(doc.issues[id].title, /@2\.20\.0/);

  // a human rules on 2.20.0
  ingest(doc, judgement(id), { now: t1 });
  assert.equal(greenKind(doc.issues[id], { now: t1 }), 'human-green');

  // the package is bumped; the SAME finding key comes back with a new version
  const t2 = new Date(new Date(t1).getTime() + 3600_000).toISOString();
  const summary = ingestArea(doc, { areaSlug: 'client-a', rollup: rollup('2.21.5', t2), now: t2 });
  assert.equal(summary.status, 'ok');
  assert.deepEqual(summary.created, [], 'the same key must stay the same issue, never a duplicate');
  assert.equal(doc.issues[id].title, titleForFinding({ ...finding('2.21.5') }));
  assert.notEqual(subjectDigest(doc.issues[id]), before);

  // and the ruling about 2.20.0 no longer greens 2.21.5
  assert.equal(greenKind(doc.issues[id], { now: t2 }), 'open');
  reconcileDispositions(doc, { now: t2 });
  assert.ok(doc.issues[id].dispositions[0].invalidatedAt);
  assert.deepEqual(verifyChain(doc), []);
});

test('the same judgement with the same clock builds a byte-identical store', () => {
  const build = () => {
    const { doc, id } = depStore();
    ingest(doc, judgement(id, { rescan: 'fast' }));
    return JSON.stringify(doc).replaceAll(id, 'ID');
  };
  assert.equal(build(), build());
});

// ── ground truth: a false-positive ruling reaches the calibration ledger the moment it is filed ──
// (W1 wiring, cw-handoff-corpus task 1.5. The batch importer reads annotations.json and never this
// store, so before this the panel's own rulings were invisible to --calibrate until re-derived by
// hand.) CW_VERDICT_DIR is read at CALL time by verdict-journal, so a per-test scratch dir works.
const readAdj = (dir) => {
  try {
    return readFileSync(join(dir, 'adjudications.jsonl'), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l)).filter((r) => r.kind === 'finding-adjudication');
  } catch { return []; }
};

test('GROUND TRUTH: false-positive on a dep finding lands a finding-adjudication, basis redacted, importer-compatible key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = depStore();
    const out = ingest(doc, judgement(id));
    assert.equal(out.ok, true);
    assert.deepEqual(out.groundTruth, { recorded: true });
    const recs = readAdj(dir);
    assert.equal(recs.length, 1);
    const r = recs[0];
    assert.equal(r.truth, 'false-alarm');
    assert.equal(r.humanVerdict, 'false-positive');
    // the same tuple findingKeyForDependency builds and adjudication-import writes — one subject
    assert.equal(r.findingKey, 'svc-api-gateway|CVE-2026-54515|com.fasterxml.jackson.core:jackson-databind');
    // write-time redaction: the ruling's free text must never reach the ledger as matched content
    assert.equal(typeof r.basis, 'object');
    assert.ok(r.basis.sha256, 'basis is a sha256 envelope, not the raw reason');
    assert.ok(!JSON.stringify(r).includes('call-graph review'), 'the reason text itself must not appear anywhere in the record');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

test('GROUND TRUTH: a scanner-row ruling derives category|repo|parts — and only false-positive maps to a truth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = rowStore();
    const out = ingest(doc, judgement(id));
    assert.equal(out.groundTruth?.recorded, true);
    const recs = readAdj(dir);
    assert.equal(recs.length, 1);
    assert.equal(recs[0].findingKey, 'sastCodeql|commitwork|js/command-line-injection|admin/serve.mjs|1204');
    assert.equal(recs[0].category, 'sastCodeql');
    // remediated is a HUMAN RISK/STATE decision, not a machine-truth claim — no record, and the
    // result says nothing rather than claiming an unrecorded truth
    const { doc: doc2, id: id2 } = rowStore();
    const out2 = ingest(doc2, judgement(id2, { disposition: 'remediated' }));
    assert.equal(out2.ok, true);
    assert.equal(out2.groundTruth, null);
    assert.equal(readAdj(dir).length, 1, 'remediated must not have appended');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

test('GROUND TRUTH: an unkeyable source refuses to guess — recorded:false WITH the reason, ruling still filed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const doc = emptyIssuesDoc();
    doc.organisation = doc.organisation || 'FIXTURE';
    const { id } = mintIssue(doc, {
      area: 'client-d', repo: 'client-d', kind: 'code', severity: 'high',
      title: 'degenerate legacy row (client-d)',
      source: { kind: 'scanner-row', key: 'sc:client-d|depsRetire|undefined|undefined', tool: 'depsRetire', rule: null },
    }, T0);
    const out = ingest(doc, judgement(id));
    assert.equal(out.ok, true, 'the ruling itself must file');
    assert.equal(out.groundTruth.recorded, false);
    assert.match(out.groundTruth.reason, /unkeyable|guess/);
    assert.equal(readAdj(dir).length, 0, 'no record may be minted from a degenerate key — one key for 500 findings merges them');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

// ── agent channels propose; they do not suppress and they are not ground truth ───────────────────
// Before this, `suppressing` read the disposition alone. An MCP call carrying false-positive set a
// waiver (the issue left the work queue), reported `human-green`, and appended humanVerdict
// 'false-positive' to the calibration ledger — while the same record said whoKind 'machine'. The
// `by`/`authorizedBy` strings are caller-typed, so "(authorized by <anyone>)" was enough.
test('an agent-channel false-positive is recorded but does NOT waive — the issue stays queued', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = depStore();
    const out = ingest(doc, judgement(id), { channel: 'mcp', session: { user: 'agent (authorized by portll)', provider: 'mcp' } });
    assert.equal(out.ok, true, 'the proposal itself files, attributed');
    assert.equal(out.disposition.whoKind, 'machine');
    assert.equal(doc.issues[id].waiver ?? null, null, 'a machine assertion must not silence the finding');
    assert.equal(readyIssues(doc, { now: T0 }).length, 1, 'it stays in the work queue until a person rules');
    assert.equal(out.greenKind, 'agent-proposed');
    assert.equal(out.groundTruth.recorded, false);
    assert.match(out.groundTruth.reason, /agent channel/);
    assert.equal(readAdj(dir).length, 0, 'an agent claim must never enter the calibration ledger as a human verdict');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

test('the same ruling from a human channel still waives and still records ground truth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = depStore();
    const out = ingest(doc, judgement(id));
    assert.ok(doc.issues[id].waiver, 'control: the human path is unchanged');
    assert.equal(out.greenKind, 'human-green');
    assert.equal(readAdj(dir).length, 1);
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

test('a later human ruling over an agent proposal does waive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = depStore();
    ingest(doc, judgement(id), { channel: 'webhook', session: { user: 'bot (authorized by portll)', provider: 'webhook' } });
    assert.equal(doc.issues[id].waiver ?? null, null);
    const human = ingest(doc, judgement(id), { now: daysAfter(T0, 1) });
    assert.ok(doc.issues[id].waiver);
    assert.equal(human.greenKind, 'human-green');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});

test('an agent proposal filed AFTER a human ruling neither withdraws the waiver nor relabels it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gt-'));
  const prev = process.env.CW_VERDICT_DIR;
  process.env.CW_VERDICT_DIR = dir;
  try {
    const { doc, id } = depStore();
    ingest(doc, judgement(id));
    const agent = ingest(doc, judgement(id), { now: daysAfter(T0, 1), channel: 'mcp', session: { user: 'agent (authorized by portll)', provider: 'mcp' } });
    assert.ok(doc.issues[id].waiver, 'the human waiver stands');
    assert.equal(agent.greenKind, 'human-green', 'the label follows the ruling in force, not the newest writer');
  } finally {
    if (prev === undefined) delete process.env.CW_VERDICT_DIR; else process.env.CW_VERDICT_DIR = prev;
  }
});
