// monitor/test/issue-store.test.mjs — the issue store contract: fail closed (only ENOENT is
// absence), evaluable schema, idempotent identity on sourceKey, tamper-evident chain, exclusive
// claims, evidence-gated closes, derived deterministic `ready`, byte-identical determinism.
// Fixtures only; monitor/issues.json is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  emptyIssuesDoc, loadIssues, mintIssue, mutateIssue, verifyChain,
  claimIssue, releaseIssue, closeIssue, reopenIssue, linkIssues,
  readyIssues, gcIssues, normaliseSeverity, SEV_RANK,
  lodgeFix, FIX_TYPES, FIX_NOTES_MIN, FIX_NOTES_MAX,
  ISS_RE, ISS_RE_LEGACY, ISS_RE_SCOPED, saveIssues, withIssuesLock,
} from '../issue-store.mjs';
import { validateAgainstSchema } from '../registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '..', '..', 'schema', 'issue.schema.json');

const T0 = '2026-08-02T12:00:00.000Z';
const hoursAfter = (iso, h) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString();

const tmp = () => mkdtempSync(join(tmpdir(), 'cw-issues-'));

// the org is baked into every id, so it is an operator declaration, never a library guess
const ORG = 'PORTLL';
const newDoc = () => Object.assign(emptyIssuesDoc(), { organisation: ORG });

// A minimal manual issue; keyed sources override `source`.
// A manual/queue-sourced issue has no scanner to ask, so it must carry its own `class` (S/F/U/D/C).
// Note `class` (what KIND of problem) is a different axis from `kind` (vuln/code/config/docs/task).
const fields = (o = {}) => ({
  area: 'fixture-area', title: 'a defect', severity: 'high', class: 'F',
  source: { kind: 'manual', key: null, tool: null, rule: null },
  ...o,
});
// Scanner/finding-sourced issues DERIVE their class from source.tool — they pass no `class`.
const keyed = (key, o = {}) => {
  const f = fields({ source: { kind: 'finding', key, tool: 'osv', rule: null }, ...o });
  delete f.class;
  return f;
};

// ── (1) loadIssues fails closed ──────────────────────────────────────────────
test('loadIssues: ENOENT is the ONE legitimate absence and yields the empty doc', () => {
  const doc = loadIssues({ path: join(tmp(), 'never-written.json'), schemaPath: SCHEMA });
  assert.deepEqual(doc, emptyIssuesDoc());
});

test('loadIssues: corrupt JSON throws — a broken store must never read as "no issues"', () => {
  const p = join(tmp(), 'issues.json');
  writeFileSync(p, '{"note": "truncated mid-wri');
  assert.throws(() => loadIssues({ path: p, schemaPath: SCHEMA }), /not valid JSON/);
});

test('loadIssues: a non-object store (array, null) throws rather than degrading', () => {
  const d = tmp();
  const arr = join(d, 'arr.json');
  writeFileSync(arr, '[]');
  assert.throws(() => loadIssues({ path: arr, schemaPath: SCHEMA }), /not an object/);
  const nul = join(d, 'null.json');
  writeFileSync(nul, 'null');
  assert.throws(() => loadIssues({ path: nul, schemaPath: SCHEMA }), /not an object/);
});

test('loadIssues: a schema-invalid store (state closed, closedAs null) throws on load', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  doc.issues[id].state = 'closed'; // closedAs stays null — violates the oneOf state/closedAs pairing
  const p = join(tmp(), 'issues.json');
  writeFileSync(p, JSON.stringify(doc));
  assert.throws(() => loadIssues({ path: p, schemaPath: SCHEMA }), /issue store invalid/);
});

test('loadIssues: a valid store round-trips intact', () => {
  const doc = newDoc();
  mintIssue(doc, keyed('f:k1'), T0);
  const p = join(tmp(), 'issues.json');
  writeFileSync(p, JSON.stringify(doc));
  assert.deepEqual(loadIssues({ path: p, schemaPath: SCHEMA }), doc);
});

// ── (2) the schema is fully evaluable by the subset checker ─────────────────
test('issue.schema.json uses only keywords the runtime checker implements, and the empty doc passes', () => {
  // zero errors asserts both "empty doc valid" and "every schema keyword executes"
  const { errors } = validateAgainstSchema(emptyIssuesDoc(), { path: SCHEMA });
  assert.deepEqual(errors, []);
});

test('a fully-populated store (claim, waiver, anchor, evidence, closed issue) passes the schema', () => {
  const doc = newDoc();
  const a = mintIssue(doc, keyed('f:k1', { repo: 'r1', kind: 'vuln' }), T0).id;
  const b = mintIssue(doc, keyed('sc:r1|sast|R1|src/a.js|3', {
    source: { kind: 'scanner-row', key: 'sc:r1|sast|R1|src/a.js|3', tool: 'sast', rule: 'R1' },
    kind: 'code', anchor: { file: 'src/a.js', line: 3, hash: 'abcdef123456' },
  }), T0).id;
  claimIssue(doc, a, { by: 'loop', sessionId: 's1', at: T0, ttlHours: 4 });
  closeIssue(doc, a, { as: 'fixed', evidence: 'patched', sessionId: 's1', at: hoursAfter(T0, 1) });
  doc.issues[b].waiver = { annotationId: 'ann-1', expiresAt: hoursAfter(T0, 24) };
  const { errors } = validateAgainstSchema(doc, { path: SCHEMA });
  assert.deepEqual(errors, []);
});

// The ingest writes source.model for rows that name their analysis (COBOL flow rows). The schema
// once lacked it: the store saved, and every later load refused it, fleet-wide, for six days.
test('a scanner row that names its analysis model passes the schema', () => {
  const doc = newDoc();
  const key = 'sc:r1|sast|R1|src/a.cbl';
  mintIssue(doc, keyed(key, { source: { kind: 'scanner-row', key, tool: 'sast', rule: 'R1', model: 'byte-range' }, kind: 'code' }), T0);
  assert.deepEqual(validateAgainstSchema(doc, { path: SCHEMA }).errors, []);
});

test('saveIssues refuses a schema-invalid store and leaves the file as it was', () => {
  const p = join(tmp(), 'issues.json');
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  withIssuesLock(() => saveIssues(doc, { path: p, schemaPath: SCHEMA }), { path: p });
  const before = readFileSync(p, 'utf8');
  doc.issues[id].source.undeclared = 'x';
  assert.throws(
    () => withIssuesLock(() => saveIssues(doc, { path: p, schemaPath: SCHEMA }), { path: p }),
    /refusing to save an invalid issue store/,
  );
  assert.equal(readFileSync(p, 'utf8'), before);
  assert.doesNotThrow(() => loadIssues({ path: p, schemaPath: SCHEMA }));
});

// ── (3) mint identity ────────────────────────────────────────────────────────
test('mintIssue is idempotent on source.key: same key twice is the same id, ordinal advances once', () => {
  const doc = newDoc();
  const first = mintIssue(doc, keyed('f:r1|pkg|ADV-1'), T0);
  const second = mintIssue(doc, keyed('f:r1|pkg|ADV-1'), hoursAfter(T0, 1));
  assert.equal(first.existed, false);
  assert.equal(second.existed, true);
  assert.equal(second.id, first.id);
  assert.equal(doc.nextOrdinal, 1);
  assert.equal(Object.keys(doc.issues).length, 1);
  assert.equal(doc.byKey['f:r1|pkg|ADV-1'], first.id);
  // MINTING is scoped-only: a declared tenant, and a class derived from source.tool (osv → S).
  assert.match(first.id, ISS_RE_SCOPED, `${first.id} must be ISS-<ORG>-<CLASS>-<SUFFIX>`);
  assert.equal(first.id.split('-')[1], ORG);
  assert.equal(first.id.split('-')[2], 'S');
  // READING is either shape: the flat legacy ids in the real hash chain must never stop matching.
  assert.ok(ISS_RE.test('ISS-000000'), 'ISS_RE must still accept the legacy flat id');
  assert.ok(ISS_RE.test(first.id), 'ISS_RE must accept the scoped id');
  assert.ok(ISS_RE_LEGACY.test('ISS-000000') && !ISS_RE_LEGACY.test(first.id));
  assert.ok(!ISS_RE_SCOPED.test('ISS-000000'));
});

test('a manual/queue issue must declare its own class; a scanner issue must not have to', () => {
  const doc = newDoc();
  const noClass = fields();
  delete noClass.class;
  assert.throws(() => mintIssue(doc, noClass, T0), /carries no `class`/);
  assert.deepEqual(Object.keys(doc.issues), [], 'a refused mint leaves no partial issue behind');
  // an explicit class picks the letter; a scanner-sourced issue derives it from source.tool
  assert.equal(mintIssue(doc, fields({ class: 'U' }), T0).id.split('-')[2], 'U');
  assert.equal(mintIssue(doc, keyed('f:derives'), T0).id.split('-')[2], 'S');
});

test('manual issues (key null) always mint fresh — no accidental dedup on null', () => {
  const doc = newDoc();
  const a = mintIssue(doc, fields(), T0);
  const b = mintIssue(doc, fields(), T0);
  assert.equal(a.existed, false);
  assert.equal(b.existed, false);
  assert.notEqual(a.id, b.id);
  assert.equal(doc.nextOrdinal, 2);
});

test('severity is normalised at the door: critical→crit, medium→med, junk→unknown', () => {
  assert.equal(normaliseSeverity('critical'), 'crit');
  assert.equal(normaliseSeverity('MEDIUM'), 'med');
  assert.equal(normaliseSeverity('moderate'), 'med');
  assert.equal(normaliseSeverity('banana'), 'unknown');
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1', { severity: 'critical' }), T0);
  assert.equal(doc.issues[id].severity, 'crit');
});

// ── (4) chain + index verification ──────────────────────────────────────────
test('verifyChain: a clean doc reports no problems', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'loop', sessionId: 's1', at: T0, ttlHours: 4 });
  assert.deepEqual(verifyChain(doc), []);
});

test('verifyChain: tampering an event\'s data after the fact is detected', () => {
  const doc = newDoc();
  mintIssue(doc, keyed('f:k1', { title: 'real title' }), T0);
  doc.events[0].data.title = 'rewritten history';
  const problems = verifyChain(doc);
  assert.ok(problems.some((p) => /hash mismatch/.test(p)), JSON.stringify(problems));
});

test('verifyChain: byKey pointing at a missing issue is reported', () => {
  const doc = newDoc();
  mintIssue(doc, keyed('f:k1'), T0);
  doc.byKey['f:ghost'] = 'ISS-999999';
  const problems = verifyChain(doc);
  assert.ok(problems.some((p) => p.includes("byKey['f:ghost']")), JSON.stringify(problems));
});

// ── (5) claims + closes ──────────────────────────────────────────────────────
test('claimIssue sets state claimed and bumps attemptCount', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'loop', sessionId: 's1', at: T0, ttlHours: 4 });
  const iss = doc.issues[id];
  assert.equal(iss.state, 'claimed');
  assert.equal(iss.attemptCount, 1);
  assert.equal(iss.claim.sessionId, 's1');
  assert.equal(iss.claim.expiresAt, hoursAfter(T0, 4));
});

test('a second claim by a DIFFERENT session before expiry throws CLAIM_CONFLICT', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  assert.throws(
    () => claimIssue(doc, id, { by: 'b', sessionId: 's2', at: hoursAfter(T0, 1), ttlHours: 4 }),
    (e) => e.code === 'CLAIM_CONFLICT',
  );
});

test('the SAME session may re-claim (refresh) its own unexpired claim', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: hoursAfter(T0, 1), ttlHours: 4 });
  assert.equal(doc.issues[id].attemptCount, 2);
  assert.equal(doc.issues[id].claim.expiresAt, hoursAfter(T0, 5));
});

test('a claim past its TTL can be taken over by another session', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  claimIssue(doc, id, { by: 'b', sessionId: 's2', at: hoursAfter(T0, 5), ttlHours: 4 });
  assert.equal(doc.issues[id].claim.sessionId, 's2');
  assert.equal(doc.issues[id].attemptCount, 2);
});

test('closeIssue refuses an empty evidence string — a close without evidence is an assertion', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  assert.throws(() => closeIssue(doc, id, { as: 'fixed', evidence: '', at: T0 }), /requires --evidence/);
  assert.throws(() => closeIssue(doc, id, { as: 'fixed', evidence: '   ', at: T0 }), /requires --evidence/);
  assert.equal(doc.issues[id].state, 'open');
});

test('closeIssue over a foreign unexpired claim is CLAIM_CONFLICT unless force', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  assert.throws(
    () => closeIssue(doc, id, { as: 'fixed', evidence: 'done', sessionId: 's2', at: hoursAfter(T0, 1) }),
    (e) => e.code === 'CLAIM_CONFLICT',
  );
  // force is the human override
  closeIssue(doc, id, { as: 'fixed', evidence: 'done by hand', sessionId: 's2', force: true, at: hoursAfter(T0, 1) });
  assert.equal(doc.issues[id].state, 'closed');
});

test('the owning session closes its own claim without conflict', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  closeIssue(doc, id, { as: 'fixed', evidence: 'patched in abc123', sessionId: 's1', at: hoursAfter(T0, 1) });
  const iss = doc.issues[id];
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'fixed');
  assert.equal(iss.claim, null);
  assert.equal(iss.evidence[iss.evidence.length - 1].tier, 'manual');
});

// ── (6) ready-work detection ─────────────────────────────────────────────────
test('readyIssues excludes claimed, blocked and closed issues', () => {
  const doc = newDoc();
  const open = mintIssue(doc, keyed('f:open'), T0).id;
  const claimed = mintIssue(doc, keyed('f:claimed'), T0).id;
  const blocked = mintIssue(doc, keyed('f:blocked'), T0).id;
  const closed = mintIssue(doc, keyed('f:closed'), T0).id;
  claimIssue(doc, claimed, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  mutateIssue(doc, blocked, (i) => { i.state = 'blocked'; i.blockedReason = 'waiting'; }, 'issue-blocked', {}, T0);
  closeIssue(doc, closed, { as: 'refuted', evidence: 'not real', at: T0 });
  assert.deepEqual(readyIssues(doc, { now: hoursAfter(T0, 1) }).map((i) => i.id), [open]);
});

test('authorityRequired issues are excluded unless includeAuthority', () => {
  const doc = newDoc();
  const auth = mintIssue(doc, keyed('f:auth', { authorityRequired: true }), T0).id;
  const plain = mintIssue(doc, keyed('f:plain'), T0).id;
  assert.deepEqual(readyIssues(doc, { now: T0 }).map((i) => i.id), [plain]);
  assert.deepEqual(readyIssues(doc, { now: T0, includeAuthority: true }).map((i) => i.id).sort(), [auth, plain].sort());
});

test('an unresolved blockedBy hides the issue; closing the blocker releases it', () => {
  const doc = newDoc();
  const blocker = mintIssue(doc, keyed('f:blocker'), T0).id;
  const blockee = mintIssue(doc, keyed('f:blockee'), T0).id;
  linkIssues(doc, blocker, { blocks: blockee, at: T0 });
  assert.deepEqual(readyIssues(doc, { now: T0 }).map((i) => i.id), [blocker]);
  closeIssue(doc, blocker, { as: 'fixed', evidence: 'done', at: hoursAfter(T0, 1) });
  assert.deepEqual(readyIssues(doc, { now: hoursAfter(T0, 1) }).map((i) => i.id), [blockee]);
});

test('an active waiver hides the issue; it returns once expiresAt passes', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:waived'), T0);
  doc.issues[id].waiver = { annotationId: 'ann-1', expiresAt: hoursAfter(T0, 24) };
  assert.deepEqual(readyIssues(doc, { now: hoursAfter(T0, 1) }), []);
  assert.deepEqual(readyIssues(doc, { now: hoursAfter(T0, 25) }).map((i) => i.id), [id]);
});

test('ready order: severity rank desc (crit>high>med>unknown>low), then slaDueAt asc, then id asc', () => {
  assert.ok(SEV_RANK.crit > SEV_RANK.high && SEV_RANK.high > SEV_RANK.med
    && SEV_RANK.med > SEV_RANK.unknown && SEV_RANK.unknown > SEV_RANK.low);
  const doc = newDoc();
  // shuffled mint order so the sort, not insertion, decides
  const low = mintIssue(doc, keyed('f:low', { severity: 'low' }), T0).id;
  const crit = mintIssue(doc, keyed('f:crit', { severity: 'crit' }), T0).id;
  const unk = mintIssue(doc, keyed('f:unk', { severity: 'nonsense' }), T0).id;
  const med = mintIssue(doc, keyed('f:med', { severity: 'med' }), T0).id;
  const high2 = mintIssue(doc, keyed('f:high2', { severity: 'high' }), hoursAfter(T0, 2)).id; // later slaDueAt
  const high1 = mintIssue(doc, keyed('f:high1', { severity: 'high' }), T0).id;                // earlier slaDueAt
  const ids = readyIssues(doc, { now: hoursAfter(T0, 3) }).map((i) => i.id);
  assert.deepEqual(ids, [crit, high1, high2, med, unk, low]);
  // id is the final tiebreak: two highs minted at the same instant sort by id
  const doc2 = newDoc();
  const a = mintIssue(doc2, keyed('f:a', { severity: 'high' }), T0).id;
  const b = mintIssue(doc2, keyed('f:b', { severity: 'high' }), T0).id;
  assert.deepEqual(readyIssues(doc2, { now: T0 }).map((i) => i.id), [a, b].sort());
});

// ── links ────────────────────────────────────────────────────────────────────
test('linkIssues --blocks rejects a dependency cycle', () => {
  const doc = newDoc();
  const a = mintIssue(doc, keyed('f:a'), T0).id;
  const b = mintIssue(doc, keyed('f:b'), T0).id;
  linkIssues(doc, a, { blocks: b, at: T0 });
  assert.deepEqual(doc.issues[b].deps.blockedBy, [a]);
  assert.throws(() => linkIssues(doc, b, { blocks: a, at: T0 }), /dependency cycle/);
  assert.throws(() => linkIssues(doc, a, { blocks: a, at: T0 }), /dependency cycle/);
});

test('linkIssues --duplicate-of closes the CALLER as superseded', () => {
  const doc = newDoc();
  const dup = mintIssue(doc, keyed('f:dup'), T0).id;
  const canonical = mintIssue(doc, keyed('f:canonical'), T0).id;
  linkIssues(doc, dup, { duplicateOf: canonical, at: T0 });
  const iss = doc.issues[dup];
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'superseded');
  assert.equal(iss.deps.duplicateOf, canonical);
  assert.equal(doc.issues[canonical].state, 'open');
});

// ── gc ───────────────────────────────────────────────────────────────────────
test('gcIssues: an expired claim goes back to open and is listed; expired waivers are cleared', () => {
  const doc = newDoc();
  const claimed = mintIssue(doc, keyed('f:claimed'), T0).id;
  const waived = mintIssue(doc, keyed('f:waived'), T0).id;
  claimIssue(doc, claimed, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  doc.issues[waived].waiver = { annotationId: 'ann-1', expiresAt: hoursAfter(T0, 1) };
  const { expiredClaims, expiredWaivers } = gcIssues(doc, { at: hoursAfter(T0, 5) });
  assert.deepEqual(expiredClaims, [claimed]);
  assert.deepEqual(expiredWaivers, [waived]);
  assert.equal(doc.issues[claimed].state, 'open');
  assert.equal(doc.issues[claimed].claim, null);
  assert.equal(doc.issues[waived].waiver, null);
});

test('gcIssues leaves an UNexpired claim alone', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k1'), T0);
  claimIssue(doc, id, { by: 'a', sessionId: 's1', at: T0, ttlHours: 4 });
  const { expiredClaims } = gcIssues(doc, { at: hoursAfter(T0, 1) });
  assert.deepEqual(expiredClaims, []);
  assert.equal(doc.issues[id].state, 'claimed');
});

// ── (7) determinism ──────────────────────────────────────────────────────────
test('the same calls with the same clock build a byte-identical store', () => {
  const build = () => {
    const doc = newDoc();
    const a = mintIssue(doc, keyed('f:r1|pkg|ADV-1', { severity: 'crit', repo: 'r1' }), T0).id;
    const b = mintIssue(doc, keyed('f:r1|pkg|ADV-2', { severity: 'med' }), T0).id;
    const c = mintIssue(doc, fields({ title: 'manual chore', severity: 'low' }), hoursAfter(T0, 1)).id;
    claimIssue(doc, a, { by: 'loop', sessionId: 's1', at: hoursAfter(T0, 2), ttlHours: 4 });
    closeIssue(doc, a, { as: 'fixed', evidence: 'ledger entry x', sessionId: 's1', at: hoursAfter(T0, 3) });
    linkIssues(doc, b, { blocks: c, at: hoursAfter(T0, 3) });
    reopenIssue(doc, a, { at: hoursAfter(T0, 4), reason: 'source reappeared' });
    gcIssues(doc, { at: hoursAfter(T0, 5) });
    return doc;
  };
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
});

// ── (8) lodging a fix is a CLAIM, never a close ──────────────────────────────
// a lodged fix must not move the issue out of the work queue — only scan evidence or an explicit close may
test('lodgeFix records fixType + notes and leaves state/closedAs/evidence untouched', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-fix'), T0);
  const at = hoursAfter(T0, 1);
  lodgeFix(doc, id, { fixType: 'dep-upgrade', notes: 'bumped lodash to 4.17.21 in the lockfile', who: 'jo', at });
  const iss = doc.issues[id];
  assert.deepEqual(iss.fix, {
    fixType: 'dep-upgrade', notes: 'bumped lodash to 4.17.21 in the lockfile', who: 'jo', at, dispositionId: null,
  });
  assert.equal(iss.state, 'open', 'lodging must never close an issue');
  assert.equal(iss.closedAs, null);
  assert.deepEqual(iss.evidence, [], 'a lodging is not evidence — it is an assertion about evidence');
  assert.equal(iss.updatedAt, at);
});

test('the lodged notes ride in the hash-chained event, so a superseded account stays readable', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-fix2'), T0);
  lodgeFix(doc, id, { fixType: 'suppression', notes: 'first account of the fix', who: 'jo', at: hoursAfter(T0, 1) });
  lodgeFix(doc, id, { fixType: 'code-change', notes: 'second, corrected account', who: 'jo', at: hoursAfter(T0, 2) });
  assert.equal(doc.issues[id].fix.notes, 'second, corrected account', 'one CURRENT account');
  const lodged = doc.events.filter((e) => e.type === 'fix-authored' && e.data.fix).map((e) => e.data.fix.notes);
  assert.deepEqual(lodged, ['first account of the fix', 'second, corrected account']);
  assert.deepEqual(verifyChain(doc), [], 'chain still verifies across both lodgings');
});

test('lodgeFix refuses an unknown fixType, out-of-bound or control-bearing notes, and no `who`', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-fix3'), T0);
  const ok = { fixType: 'code-change', notes: 'a long enough annotation', who: 'jo', at: T0 };
  assert.throws(() => lodgeFix(doc, id, { ...ok, fixType: 'fixed' }), /fixType must be one of/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, notes: 'x'.repeat(FIX_NOTES_MIN - 1) }), /notes must be/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, notes: 'x'.repeat(FIX_NOTES_MAX + 1) }), /notes must be/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, notes: `bell ${String.fromCharCode(7)} here` }), /control character/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, who: '  ' }), /requires `who`/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, at: undefined }), /requires `at`/);
  assert.throws(() => lodgeFix(doc, id, { ...ok, dispositionId: 'DSP-nope' }), /is not a DSP- id/);
  assert.throws(() => lodgeFix(doc, 'ISS-NOSUCH', ok), /unknown issue/);
  assert.equal(doc.issues[id].fix, undefined, 'not one refused call left a partial record');
});

test('a store carrying a lodged fix still validates against issue.schema.json', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-fix4'), T0);
  for (const fixType of FIX_TYPES) {
    lodgeFix(doc, id, { fixType, notes: `lodging ${fixType} with enough text`, who: 'jo', at: hoursAfter(T0, 1) });
    const { errors } = validateAgainstSchema(doc, { path: SCHEMA });
    assert.deepEqual(errors, [], `fixType ${fixType} must be accepted by the schema`);
  }
});

// ── evidence that survives being read back ────────────────────────────────────────────────────
//
// `String({})` is `[object Object]` — non-empty, truthy, void — so the guard whose entire purpose is
// "a close without evidence is an assertion, not a closure" passed for exactly the input it existed
// to reject. Measured 2026-09-01: 135 of 259 closures in the live store carry a corrupt evidence
// field, and 5 distinct strings stand where 135 judgements should be.

test('an OBJECT evidence is serialised, never stringified to `[object Object]`', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-ev1'), T0);
  closeIssue(doc, id, { as: 'refuted', evidence: { note: 'rule fires on a comment', who: 'jo' }, at: hoursAfter(T0, 1) });
  const ev = doc.issues[id].evidence.at(-1).detail;
  assert.doesNotMatch(ev, /\[object Object\]/, 'the content must survive, not be replaced by a type name');
  assert.match(ev, /rule fires on a comment/);
  const chained = doc.events.filter((e) => e.type === 'issue-closed').at(-1).data.evidence;
  assert.doesNotMatch(chained, /\[object Object\]/, 'the CHAIN carries it too — that is what a reader replays');
});

test('an ARRAY of objects survives close', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-ev2'), T0);
  closeIssue(doc, id, { as: 'refuted', evidence: [{ sha: '7e57a1d' }, { sha: 'abc1234' }], at: hoursAfter(T0, 1) });
  assert.match(doc.issues[id].evidence.at(-1).detail, /7e57a1d/);
});

test('an EMPTY object is refused — it serialises to nothing a reader can act on', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-ev3'), T0);
  assert.throws(() => closeIssue(doc, id, { as: 'refuted', evidence: {}, at: hoursAfter(T0, 1) }), /close requires --evidence/);
  assert.throws(() => closeIssue(doc, id, { as: 'refuted', evidence: [], at: hoursAfter(T0, 1) }), /close requires --evidence/);
  assert.equal(doc.issues[id].state, 'open', 'a refused close leaves the issue open');
});

test('a CIRCULAR evidence is refused rather than swallowed', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-ev4'), T0);
  const circ = { note: 'x' }; circ.self = circ;
  assert.throws(() => closeIssue(doc, id, { as: 'refuted', evidence: circ, at: hoursAfter(T0, 1) }), /close requires --evidence/);
});

test('a plain string is unchanged — the fix must not reshape the normal case', () => {
  const doc = newDoc();
  const { id } = mintIssue(doc, keyed('f:k-ev5'), T0);
  closeIssue(doc, id, { as: 'refuted', evidence: '  checked by hand  ', at: hoursAfter(T0, 1) });
  assert.equal(doc.issues[id].evidence.at(-1).detail, 'checked by hand');
});
