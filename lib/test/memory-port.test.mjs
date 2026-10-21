// lib/test/memory-port.test.mjs — the port's floor.
//
// Every test here asserts an EFFECT. The module's central claim is "two adapters that behave
// differently cannot look the same to a caller", and the only honest way to check that is to run the
// SAME call against two adapters and require the results to differ — not to grep for a field name.
//
// The tests are paired on purpose. For each rule there is a check that it FIRES and a check that it
// does not fire when it should not: a preview adapter must fail to verify a large document AND must
// still be able to verify a small one, because a check that cannot pass is worse than no check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  declareCapabilities, createPort, verifyCapabilities, constrainReceipt, assertTags,
  unreachableReason, absenceFromError, probeContent, now,
  KNOWN_ADAPTERS, OPERATIONS, PROBE_EXTERNAL_ID,
  REACH_SERVICE, REACH_LIBRARY, REACH_AGENT_TOOL,
  CALLER_HEADLESS, CALLER_INTERACTIVE, CALLER_AGENT_SESSION,
  STORED_FULL, STORED_PREVIEW, STORED_UNKNOWN,
  OUTCOME_OK, OUTCOME_REFUSED, OUTCOME_FAILED,
  VERDICT_CONFIRMED, VERDICT_CONTRADICTED, VERDICT_UNVERIFIABLE,
} from '../memory-port.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = JSON.parse(readFileSync(join(HERE, '..', 'memory-layer-contract.json'), 'utf8'));

// ── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A backend whose BEHAVIOUR is set independently of its DECLARATION, so a test can build an adapter
 * that lies. That combination is the only thing that can exercise verifyCapabilities: an adapter
 * built from one set of switches would agree with itself by construction.
 */
function fakeBackend({ truncateAt = null, mintTags = false, dropTag = null, omitTags = false } = {}) {
  const store = new Map();
  return {
    store,
    ops: {
      async upsert(record) {
        const kept = truncateAt ? String(record.content).slice(0, truncateAt) : record.content;
        const minted = mintTags ? String(record.content).split(/\s+/).filter(Boolean).slice(0, 9) : [];
        let tags = [...new Set([...(record.tags || []), ...minted])].sort();
        if (dropTag) tags = tags.filter((t) => t !== dropTag);
        store.set(record.external_id, { external_id: record.external_id, content: kept, tags });
        return {
          external_id: record.external_id,
          state: 'verified',        // the naive claim every backend makes; the port is what checks it
          storedForm: STORED_FULL,
          storedCoverage: 1,
          tagsSent: [...(record.tags || [])].sort(),
          tagsStoredCount: tags.length,
          reason: null,
        };
      },
      async getById(id) {
        const row = store.get(id);
        if (!row) return null;
        return omitTags ? { external_id: row.external_id, content: row.content } : row;
      },
      async recallByTags(tags) {
        return { ok: true, memories: [...store.values()].filter((r) => tags.every((t) => r.tags?.includes(t))) };
      },
      async forget(id) { store.delete(id); return { ok: true }; },
      async health() { return { ok: true }; },
    },
  };
}

const CAP = {
  local: () => declareCapabilities({
    name: 'fixture-local', reachability: REACH_LIBRARY, storedFormGuarantee: STORED_FULL,
    tagsAuthoritative: true, supportsReadback: true, supportsSemanticRecall: false,
    operations: [...OPERATIONS],
    evidence: 'fixture: an in-process store that keeps content verbatim and mints no tags',
  }),
  veld: () => declareCapabilities({
    name: 'fixture-veld', reachability: REACH_SERVICE, storedFormGuarantee: STORED_PREVIEW,
    previewBytes: 410, tagsAuthoritative: false, supportsReadback: true, supportsSemanticRecall: true,
    operations: [...OPERATIONS],
    evidence: 'fixture: reproduces the measured ~410-byte preview and server-side tag minting',
  }),
  agentTool: () => declareCapabilities({
    name: 'fixture-mcp', reachability: REACH_AGENT_TOOL, storedFormGuarantee: STORED_UNKNOWN,
    tagsAuthoritative: null, supportsReadback: false, supportsSemanticRecall: true,
    operations: ['upsert', 'recallByTags'],
    evidence: 'fixture: MCP-bound, reachable only from a session with a client attached',
  }),
};

const receipt = (over = {}) => ({ state: 'verified', storedForm: STORED_FULL, storedCoverage: 1, reason: null, ...over });

/**
 * Trim a backend to exactly the operations a capability row declares.
 *
 * Needed because the operations check is a pure typeof comparison and therefore runs even for an
 * adapter nothing can reach — correctly, since it needs no transport. A fixture that declares two
 * operations while supplying five is a table/adapter disagreement, and it would be reported as one.
 */
const trimTo = (cap, be) => {
  const ops = {};
  for (const o of cap.operations) ops[o] = be.ops[o];
  return { ...be, ops };
};

// ── Vocabulary and coherence: refuse at declaration, never default ──────────

test('an undeclared reachability is REFUSED, not defaulted to the permissive member', () => {
  assert.throws(() => declareCapabilities({ ...CAP.local(), reachability: 'probably-fine' }),
    /reachability must be one of/);
  // and the refusal names the axis, so the fix is obvious rather than guessed at
  assert.throws(() => declareCapabilities({ ...CAP.local(), reachability: undefined }), /service \| library \| agent-tool/);
});

test('no readback forces storedFormGuarantee to unknown — you cannot know what you never read', () => {
  assert.throws(() => declareCapabilities({ ...CAP.local(), supportsReadback: false }),
    /forces storedFormGuarantee:'unknown'/);
  // the coherent form is accepted
  const ok = declareCapabilities({ ...CAP.local(), supportsReadback: false, storedFormGuarantee: STORED_UNKNOWN, operations: ['upsert'] });
  assert.equal(ok.storedFormGuarantee, STORED_UNKNOWN);
});

test('supportsReadback:true requires a getById operation — the two fields state one fact', () => {
  assert.throws(() => declareCapabilities({ ...CAP.local(), operations: ['upsert', 'health'] }),
    /requires 'getById' among operations/);
});

test("a 'preview' guarantee with no byte budget is refused — an uncheckable claim", () => {
  assert.throws(() => declareCapabilities({ ...CAP.veld(), previewBytes: null }), /requires a positive previewBytes/);
  // and a budget on a non-preview adapter is refused too, so it can never be read as a live limit
  assert.throws(() => declareCapabilities({ ...CAP.local(), previewBytes: 410 }), /meaningful only for a preview guarantee/);
});

test('a capability with no stated evidence is refused — provenance is part of the claim', () => {
  assert.throws(() => declareCapabilities({ ...CAP.local(), evidence: 'measured' }), /evidence is required/);
});

test('tagsAuthoritative accepts exactly three values, and null is one of them', () => {
  assert.throws(() => declareCapabilities({ ...CAP.local(), tagsAuthoritative: 'maybe' }), /must be true, false, or null/);
  assert.equal(declareCapabilities({ ...CAP.agentTool() }).tagsAuthoritative, null);
});

// ── Reachability: unusable BY DESIGN, said at the call site ─────────────────

test('an agent-tool adapter REFUSES a headless caller, naming reachability', async () => {
  const be = fakeBackend();
  const port = createPort({ capabilities: CAP.agentTool(), ops: be.ops }, { caller: CALLER_HEADLESS });
  const r = await port.upsert({ external_id: 'x', content: 'hello', tags: [] });

  assert.equal(r.outcome, OUTCOME_REFUSED);
  assert.equal(r.ok, false);
  assert.equal(r.capability, 'reachability');
  assert.match(r.reason, /attached MCP client/);
  assert.match(r.reason, /retrying will never succeed/, 'a design fact must not read as a transient outage');
  assert.equal(be.store.size, 0, 'nothing may reach the adapter when the port refuses');
});

test('the same adapter is reachable from an agent session — the refusal is about FIT, not health', async () => {
  const be = fakeBackend();
  const port = createPort({ capabilities: CAP.agentTool(), ops: be.ops }, { caller: CALLER_AGENT_SESSION });
  const r = await port.upsert({ external_id: 'x', content: 'hello', tags: [] });
  assert.equal(r.outcome, OUTCOME_OK);
  assert.equal(be.store.size, 1);
});

test('an interactive human is still not an MCP client', () => {
  assert.match(unreachableReason(CAP.agentTool(), CALLER_INTERACTIVE), /reachable only through an attached MCP client/);
  assert.equal(unreachableReason(CAP.veld(), CALLER_HEADLESS), null);
  assert.equal(unreachableReason(CAP.local(), CALLER_HEADLESS), null);
});

test('an undeclared caller context throws rather than defaulting — defaulting is how cron gets wired to MCP', () => {
  assert.throws(() => unreachableReason(CAP.agentTool(), 'cron-ish'), /unknown caller context/);
  assert.throws(() => createPort({ capabilities: CAP.local(), ops: {} }, { caller: 'whatever' }), /unknown caller context/);
});

// ── Unsupported operations refuse; they never fabricate an empty result ─────

test('an UNDECLARED operation refuses, and value is null — never [] and never a silent no-op', async () => {
  const be = fakeBackend();
  const cap = declareCapabilities({ ...CAP.local(), operations: ['upsert', 'getById'] });
  const port = createPort({ capabilities: cap, ops: be.ops }, { caller: CALLER_HEADLESS });

  const r = await port.recallByTags(['anything']);
  assert.equal(r.outcome, OUTCOME_REFUSED);
  assert.equal(r.capability, 'operations');
  assert.equal(r.value, null, '[] would claim the adapter looked and found nothing');
  assert.match(r.reason, /does not support recallByTags/);

  const f = await port.forget('x');
  assert.equal(f.outcome, OUTCOME_REFUSED);
  assert.equal(f.value, null);
  assert.equal(be.store.size, 0, 'a refused forget must not be reported as a completed deletion');
});

test('a DECLARED but unimplemented operation refuses too, instead of throwing from inside the port', async () => {
  const be = fakeBackend();
  delete be.ops.forget;                            // the table is ahead of the adapter
  const port = createPort({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS });
  const r = await port.forget('x');
  assert.equal(r.outcome, OUTCOME_REFUSED);
  assert.equal(r.capability, 'operations');
  assert.match(r.reason, /DECLARES forget but supplies no implementation/);
});

test('a supported operation still succeeds — the gates must not be a blanket refusal', async () => {
  const be = fakeBackend();
  const port = createPort({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS });
  assert.equal((await port.upsert({ external_id: 'a', content: 'x', tags: ['t'] })).outcome, OUTCOME_OK);
  assert.equal((await port.recallByTags(['t'])).outcome, OUTCOME_OK);
  assert.equal((await port.health()).outcome, OUTCOME_OK);
});

// ── A preview adapter can never claim `verified` for a large document ───────

test('a preview-guarantee adapter never reports verified for a large document', () => {
  const cap = CAP.veld();
  const out = constrainReceipt(cap, receipt(), { sourceBytes: 19_000 });
  assert.notEqual(out.state, 'verified');
  assert.equal(out.state, 'accepted-unverified');
  assert.equal(out.storedForm, STORED_PREVIEW);
  assert.match(out.reason, /NOT a durable copy/);
  // grey is not red either: the write SUCCEEDED, and that fact survives on its own axis
  assert.notEqual(out.state, 'failed');
});

test('...but the SAME adapter still verifies a small one — a check that cannot pass is worse than none', () => {
  const out = constrainReceipt(CAP.veld(), receipt(), { sourceBytes: 115 });
  assert.equal(out.state, 'verified', 'a 115-byte body round-trips byte-identically on the real service');
  assert.equal(out.storedForm, STORED_FULL);
  assert.equal(out.capabilityContradiction, null);
});

test('a preview adapter with no source size is GREY, not green — fail closed', () => {
  const out = constrainReceipt(CAP.veld(), receipt(), {});
  assert.equal(out.state, 'accepted-unverified');
  assert.equal(out.storedForm, STORED_UNKNOWN);
  assert.match(out.reason, /no source size was supplied/);
});

test('the same receipt through a full-fidelity adapter keeps its verified state — the two must DIFFER', () => {
  const big = { sourceBytes: 19_000 };
  const viaLocal = constrainReceipt(CAP.local(), receipt(), big);
  const viaVeld = constrainReceipt(CAP.veld(), receipt(), big);
  assert.equal(viaLocal.state, 'verified');
  assert.equal(viaVeld.state, 'accepted-unverified');
  assert.notEqual(viaLocal.storedForm, viaVeld.storedForm,
    'if these agreed, a 410-byte preview and a full durable copy would be one badge — the defect this module exists to prevent');
});

test('an adapter with no readback can never earn verified, whatever it claims', () => {
  const cap = declareCapabilities({ ...CAP.local(), supportsReadback: false, storedFormGuarantee: STORED_UNKNOWN, operations: ['upsert'] });
  const out = constrainReceipt(cap, receipt(), { sourceBytes: 10 });
  assert.equal(out.state, 'accepted-unverified');
  assert.equal(out.storedForm, STORED_UNKNOWN);
  assert.match(out.reason, /nothing read the record back/);
});

test('constrainReceipt only ever LOWERS — a failure and a dry run pass through untouched', () => {
  for (const state of ['failed', 'dry-run', 'some-state-added-next-year']) {
    const out = constrainReceipt(CAP.veld(), receipt({ state, storedForm: STORED_UNKNOWN, reason: 'r' }), { sourceBytes: 1 });
    assert.equal(out.state, state, 'rewriting a non-verified state would invent an event that did not happen');
  }
  // and it never upgrades an observed preview into a declared full
  const up = constrainReceipt(CAP.local(), receipt({ state: 'accepted-unverified', storedForm: STORED_PREVIEW }), { sourceBytes: 5 });
  assert.equal(up.storedForm, STORED_PREVIEW, 'behaviour outranks declaration');
});

test('a `full` declaration meeting a `preview` observation is reported as a contradiction, not laundered', () => {
  const out = constrainReceipt(CAP.local(), receipt({ state: 'accepted-unverified', storedForm: STORED_PREVIEW }), { sourceBytes: 5 });
  assert.ok(out.capabilityContradiction, 'a stale table must announce itself at the point of use');
  assert.match(out.capabilityContradiction, /the OBSERVATION is what stands/);
});

// ── tagsAuthoritative decides WHICH assertion is correct ────────────────────

const SENT = ['commitwork', 'scope:commitwork-sweep'];
const MINTED = ['commitwork', 'scope:commitwork-sweep', 'CVE-2026-1234', 'thing scanner'];

test('tagsAuthoritative changes the verdict on ONE pair of tag sets', () => {
  const strict = assertTags(CAP.local(), SENT, MINTED);
  const loose = assertTags(CAP.veld(), SENT, MINTED);

  assert.equal(strict.assertion, 'exact');
  assert.equal(strict.outcome, OUTCOME_FAILED, 'an exact store that returned tags nobody sent has invented data');
  assert.deepEqual(strict.unexpected, ['CVE-2026-1234', 'thing scanner']);

  assert.equal(loose.assertion, 'subset');
  assert.equal(loose.outcome, OUTCOME_OK, 'minting is expected on veld; equality would fail every healthy write');
  assert.deepEqual(loose.unexpected, ['CVE-2026-1234', 'thing scanner'], 'the extras are still REPORTED, just not a fault');

  assert.notEqual(strict.outcome, loose.outcome,
    'same inputs, opposite verdicts — this is the whole reason the rule is per-adapter and not a universal law');
});

test('exact equality is available to the SQL adapter — subset would forgo the strongest check', () => {
  const r = assertTags(CAP.local(), SENT, [...SENT].reverse());
  assert.equal(r.outcome, OUTCOME_OK, 'order must not matter; membership must');
  const drift = assertTags(CAP.local(), SENT, ['commitwork']);
  assert.equal(drift.outcome, OUTCOME_FAILED);
  assert.deepEqual(drift.missing, ['scope:commitwork-sweep']);
});

test('a dropped sent-tag is degraded on BOTH adapters — content right, scope wrong', () => {
  for (const cap of [CAP.local(), CAP.veld()]) {
    const r = assertTags(cap, SENT, ['commitwork']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /scope:commitwork-sweep/);
  }
});

test('tagsAuthoritative:null REFUSES a verdict rather than guessing one', () => {
  const r = assertTags(CAP.agentTool(), SENT, MINTED);
  assert.equal(r.outcome, OUTCOME_REFUSED);
  assert.equal(r.capability, 'tagsAuthoritative');
  assert.equal(r.assertion, null);
  // both wrong answers are named, because the point is that NEITHER default is safe
  assert.match(r.reason, /fabricate a failure/);
  assert.match(r.reason, /disable the strongest check/);
  // the measurement is still reported, so the gap is actionable rather than merely blank
  assert.deepEqual(r.unexpected, ['CVE-2026-1234', 'thing scanner']);
});

// ── Absence vs failure ──────────────────────────────────────────────────────

test('ENOENT is decided by a CODE, never by a message', () => {
  assert.equal(absenceFromError(Object.assign(new Error('nope'), { code: 'ENOENT' })), true);
  assert.equal(absenceFromError(new Error('ENOENT: no such file or directory')), false,
    'message matching is how "unable to open database file" turns a LOCKED store into an empty one');
  assert.equal(absenceFromError(Object.assign(new Error('denied'), { code: 'EACCES' })), false);
});

test('an unreadable store is a FAILURE, not an empty result', async () => {
  const be = fakeBackend();
  be.ops.getById = async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); };
  const port = createPort({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS });
  const r = await port.getById('x');
  assert.equal(r.outcome, OUTCOME_FAILED);
  assert.equal(r.absent, false, 'EACCES must never render as "there is nothing there"');
  assert.equal(r.value, null);
});

test('a genuinely absent record is ok+absent, and a present one is ok+present', async () => {
  const be = fakeBackend();
  const port = createPort({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS });
  const miss = await port.getById('never-written');
  assert.equal(miss.outcome, OUTCOME_OK);
  assert.equal(miss.absent, true);

  await port.upsert({ external_id: 'a', content: 'x', tags: [] });
  const hit = await port.getById('a');
  assert.equal(hit.absent, false);
  assert.equal(hit.value.content, 'x');
});

// ── Capability vs behaviour: the declaration is PROVEN, not believed ────────

test('verifyCapabilities requires probeWrites to be stated — no silent no-op, no surprise write', async () => {
  const be = fakeBackend();
  await assert.rejects(() => verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS }),
    /probeWrites must be stated explicitly/);
  assert.equal(be.store.size, 0);
});

test('probeWrites:false is ALL GREY and explicitly not trustworthy — absence of evidence', async () => {
  const be = fakeBackend();
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: false });
  assert.equal(be.store.size, 0, 'probeWrites:false must write nothing');
  assert.equal(r.contradicted, 0);
  assert.equal(r.ok, true, 'nothing was caught lying');
  assert.equal(r.trustworthy, false, 'and nothing was measured either — those are two different facts');
  assert.equal(r.fields.storedFormGuarantee.verdict, VERDICT_UNVERIFIABLE);
  assert.match(r.fields.storedFormGuarantee.reason, /not a pass/);
});

test('a truthful full-fidelity adapter is CONFIRMED on every measurable field', async () => {
  const be = fakeBackend();
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.contradicted, 0);
  assert.equal(r.fields.operations.verdict, VERDICT_CONFIRMED);
  assert.equal(r.fields.reachability.verdict, VERDICT_CONFIRMED);
  assert.equal(r.fields.supportsReadback.verdict, VERDICT_CONFIRMED);
  assert.equal(r.fields.storedFormGuarantee.verdict, VERDICT_CONFIRMED);
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_CONFIRMED);
  assert.equal(r.ok, true);
  // the probe cleans up after itself when a forget exists
  assert.equal(be.store.has(PROBE_EXTERNAL_ID), false);
});

test('a truthful preview adapter is CONFIRMED as a preview — the declaration is not punished for being honest', async () => {
  const be = fakeBackend({ truncateAt: 410, mintTags: true });
  const r = await verifyCapabilities({ capabilities: CAP.veld(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.storedFormGuarantee.verdict, VERDICT_CONFIRMED);
  assert.equal(r.fields.storedFormGuarantee.observed, STORED_PREVIEW);
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_CONFIRMED);
  assert.equal(r.contradicted, 0);
});

test('an adapter that declares `full` and actually previews is CONTRADICTED — the dangerous direction', async () => {
  const be = fakeBackend({ truncateAt: 410 });
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.storedFormGuarantee.verdict, VERDICT_CONTRADICTED);
  assert.equal(r.fields.storedFormGuarantee.declared, STORED_FULL);
  assert.equal(r.fields.storedFormGuarantee.observed, STORED_PREVIEW);
  assert.equal(r.ok, false, 'a caller deleting a source file on the strength of this claim would have lost it');
});

test('an adapter that declares authoritative tags and mints them is CONTRADICTED', async () => {
  const be = fakeBackend({ mintTags: true });
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_CONTRADICTED);
  assert.match(r.fields.tagsAuthoritative.reason, /fabricate a failure on every healthy write/);
});

test('the opposite drift is caught too: declaring non-authoritative on an exact store', async () => {
  const be = fakeBackend();
  const cap = declareCapabilities({ ...CAP.local(), tagsAuthoritative: false });
  const r = await verifyCapabilities({ capabilities: cap, ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_CONTRADICTED);
  assert.match(r.fields.tagsAuthoritative.reason, /forgoing the strongest check/);
});

test('a null tag declaration stays GREY under probing, and names what was measured', async () => {
  const be = fakeBackend({ mintTags: true });
  const cap = declareCapabilities({ ...CAP.veld(), tagsAuthoritative: null });
  const r = await verifyCapabilities({ capabilities: cap, ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_UNVERIFIABLE, 'honest silence is not a finding');
  assert.equal(r.fields.tagsAuthoritative.observed, false);
  assert.match(r.fields.tagsAuthoritative.reason, /Record it in the table/);
});

test('a declared-but-missing operation is CONTRADICTED, and so is the reverse', async () => {
  const missing = fakeBackend();
  delete missing.ops.forget;
  const a = await verifyCapabilities({ capabilities: CAP.local(), ops: missing.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(a.fields.operations.verdict, VERDICT_CONTRADICTED);
  assert.match(a.fields.operations.reason, /declared but not implemented: forget/);

  const undeclared = fakeBackend();
  const cap = declareCapabilities({ ...CAP.local(), operations: ['upsert', 'getById'] });
  const b = await verifyCapabilities({ capabilities: cap, ops: undeclared.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(b.fields.operations.verdict, VERDICT_CONTRADICTED);
  assert.match(b.fields.operations.reason, /refused at every call site despite working/);
});

test('an unreachable adapter is all-grey: ok (nothing lied) but NOT trustworthy (nothing measured)', async () => {
  const cap = CAP.agentTool();
  const be = trimTo(cap, fakeBackend());
  const r = await verifyCapabilities({ capabilities: cap, ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(be.store.size, 0, 'an unreachable adapter must not be probed');
  assert.equal(r.contradicted, 0, 'unreachable is not a finding');
  assert.equal(r.ok, true);
  assert.equal(r.trustworthy, false, 'and it is not a pass either');
  // Every field that needs the backend is grey. `operations` is not among them: it is a typeof
  // comparison against the declaration and needs no transport, so it stays measurable — which is
  // the distinction worth keeping rather than blanking the whole report on unreachability.
  for (const f of ['reachability', 'storedFormGuarantee', 'tagsAuthoritative', 'supportsReadback']) {
    assert.equal(r.fields[f].verdict, VERDICT_UNVERIFIABLE, `${f} must not be a pass or a finding here`);
  }
  assert.equal(r.fields.operations.verdict, VERDICT_CONFIRMED);
  assert.match(r.fields.reachability.reason, /attached MCP client/);
});

test('an unreachable adapter IS measurable from the caller it was designed for', async () => {
  const cap = CAP.agentTool();
  const be = trimTo(cap, fakeBackend());
  const r = await verifyCapabilities({ capabilities: cap, ops: be.ops }, { caller: CALLER_AGENT_SESSION, probeWrites: true });
  assert.equal(r.fields.reachability.verdict, VERDICT_CONFIRMED);
  assert.match(r.fields.reachability.reason, /FROM HERE only/, 'reaching it from one caller does not prove it reaches from all');
  // it declares no forget, so its probe record REMAINS — reported, never left silently
  assert.match(r.fields.probeCleanup.reason, /remains in the store/);
  assert.equal(be.store.has(PROBE_EXTERNAL_ID), true);
});

test('a readback that carries no tags leaves the tag field grey rather than passing it', async () => {
  const be = fakeBackend({ omitTags: true });
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.tagsAuthoritative.verdict, VERDICT_UNVERIFIABLE);
  assert.match(r.fields.tagsAuthoritative.reason, /no tag list/);
});

test('supportsSemanticRecall is permanently unverifiable, and says why instead of pretending', async () => {
  const be = fakeBackend();
  const r = await verifyCapabilities({ capabilities: CAP.local(), ops: be.ops }, { caller: CALLER_HEADLESS, probeWrites: true });
  assert.equal(r.fields.supportsSemanticRecall.verdict, VERDICT_UNVERIFIABLE);
  assert.match(r.fields.supportsSemanticRecall.reason, /the port exposes no semantic-recall operation/);
  assert.equal(r.trustworthy, false, 'one unmeasurable field is enough to withhold the stronger claim');
});

// ── Determinism ─────────────────────────────────────────────────────────────

test('CW_NOW is honoured and read at CALL time, not at module load', (t) => {
  const before = process.env.CW_NOW;
  t.after(() => { if (before === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = before; });
  process.env.CW_NOW = '2026-09-07T00:00:00.000Z';
  assert.equal(now(), '2026-09-07T00:00:00.000Z');
  process.env.CW_NOW = '2026-01-01T00:00:00.000Z';
  assert.equal(now(), '2026-01-01T00:00:00.000Z', 'a module-load const would have pinned the first value');
  process.env.CW_NOW = 'not-a-date';
  assert.throws(() => now(), /not a parseable date/);
});

test('the same probe and the same inputs give byte-identical results', async () => {
  const before = process.env.CW_NOW;
  process.env.CW_NOW = '2026-09-07T00:00:00.000Z';
  try {
    const run = () => verifyCapabilities({ capabilities: CAP.local(), ops: fakeBackend().ops }, { caller: CALLER_HEADLESS, probeWrites: true });
    const [a, b] = [await run(), await run()];
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(probeContent(2048), probeContent(2048));
    assert.equal(Buffer.byteLength(probeContent(2048), 'utf8'), 2048);
  } finally {
    if (before === undefined) delete process.env.CW_NOW; else process.env.CW_NOW = before;
  }
});

test('assertTags is order-independent and sorted — the same pair always reports the same arrays', () => {
  const a = assertTags(CAP.veld(), ['b', 'a'], ['z', 'a', 'b']);
  const b = assertTags(CAP.veld(), ['a', 'b'], ['a', 'b', 'z']);
  assert.deepEqual(a.unexpected, b.unexpected);
  assert.deepEqual(a.unexpected, ['z']);
});

// ── The known table binds to the measured contract ──────────────────────────
//
// NOTE ON PLACEMENT. The brief asked for a `capabilities` section inside
// lib/memory-layer-contract.json. That file is validated by schema/memory-layer-contract.schema.json
// with `additionalProperties: false`, and bin/test/schema-required.test.mjs asserts BOTH that the
// shipped document validates and that the schema rejects an unexpected top-level key — so adding the
// section breaks two currently-passing tests in files outside this task's scope. Rather than land a
// regression, veld's row is bound to the contract HERE, derived from the facts the contract already
// records. That is the stronger arrangement anyway: a hand-written `capabilities` block could drift
// from the measurements two sections above it, whereas these assertions fail the moment they do.

test('veld’s declared row is derived from the contract’s own measurements, in both directions', () => {
  const veld = KNOWN_ADAPTERS.veld;

  // tagsAuthoritative:false <- the contract's central measured claim
  assert.equal(CONTRACT.tagsAreNotIdentity.fact, 'memory-layer MINTS TAGS FROM CONTENT on store.');
  assert.ok(CONTRACT.tagsAreNotIdentity.rules.some((r) => /SUBSET/.test(r)), 'the contract must still mandate subset assertion');
  assert.equal(veld.tagsAuthoritative, false,
    'a store that mints tags cannot be asserted exactly — but that is veld’s property, not a law');

  // storedFormGuarantee:'preview' <- the contract's storedForm section
  assert.ok('preview' in CONTRACT.receipt.storedForm.states);
  assert.match(CONTRACT.receipt.storedForm.why, /410-byte PREVIEW/);
  assert.equal(veld.storedFormGuarantee, STORED_PREVIEW);
  assert.equal(veld.previewBytes, 410, 'the budget must match the measured figure the contract quotes');

  // supportsReadback:true <- the identity read exists and is synchronous
  assert.equal(CONTRACT.endpoints['GET /api/memory/{id}'].synchronous, true);
  assert.equal(veld.supportsReadback, true);

  // forget exists (with a known bug the contract records) so the operation is declared
  assert.ok(CONTRACT.endpoints['DELETE /api/forget/{id}']);
  assert.ok(veld.operations.includes('forget'));

  assert.equal(veld.reachability, REACH_SERVICE, 'an HTTP service is reachable from a headless process');
  assert.equal(unreachableReason(veld, CALLER_HEADLESS), null, 'monitor/sweep.mjs must be able to use veld');
});

test('the port exposes no semantic-recall operation, because the contract forbids the endpoint', () => {
  assert.match(CONTRACT.endpoints['POST /api/recall'].use, /FORBIDDEN/);
  assert.ok(!OPERATIONS.includes('recall'), 'an endpoint that lies is removed from the surface, not documented');
  // and the capability field that describes it is honest about being unenforceable here
  assert.equal(KNOWN_ADAPTERS.veld.supportsSemanticRecall, true, 'true of the SERVICE');
  assert.match(KNOWN_ADAPTERS.veld.notes, /MUST NOT be exposed through this port/);
});

test('the local row claims `full` only because lib/memory-store.mjs proves it per write', () => {
  const local = KNOWN_ADAPTERS.local;
  assert.equal(local.storedFormGuarantee, STORED_FULL);
  assert.equal(local.tagsAuthoritative, true);
  assert.match(local.evidence, /reading the row back inside its own transaction/);
  assert.ok(!local.operations.includes('forget'), 'declaring an operation it lacks would refuse at every call site');
});

test('the MCP-bound row is the one that motivates the null third value', () => {
  const s = KNOWN_ADAPTERS['shodh-memory'];
  assert.equal(s.reachability, REACH_AGENT_TOOL);
  assert.equal(s.tagsAuthoritative, null);
  assert.equal(s.storedFormGuarantee, STORED_UNKNOWN, 'no readback means the stored form can only be unknown');
  assert.match(unreachableReason(s, CALLER_HEADLESS), /monitor|MCP client/);
});

test('every known adapter row is a valid declaration and no two share a name', () => {
  const names = Object.values(KNOWN_ADAPTERS).map((c) => c.name);
  assert.deepEqual(names, [...new Set(names)]);
  for (const [key, cap] of Object.entries(KNOWN_ADAPTERS)) {
    assert.equal(cap.name, key, 'the table key and the declared name must be one thing');
    assert.ok(Object.isFrozen(cap), 'a mutable capability row can be edited by a caller mid-run');
    assert.ok(cap.evidence.length >= 20);
  }
});
