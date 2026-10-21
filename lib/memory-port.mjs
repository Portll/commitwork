// lib/memory-port.mjs — ONE surface over SEVERAL memory backends, and the CAPABILITY TABLE that
// stops any of them impersonating the others.
//
// WHY THIS EXISTS. There are at least three candidate backends and they are NOT interchangeable:
//
//   local  (lib/memory-store.mjs)          in-process node:sqlite. Full content, exact tags, and a
//                                          readback proven INSIDE the write transaction.
//   veld   (lib/memory-layer-client.mjs)   an HTTP service that keeps a ~410-byte PREVIEW in
//                                          `content` and discards the rest (measured 2026-09-02),
//                                          and MINTS TAGS FROM CONTENT server-side (measured: 2
//                                          sent -> 19 stored; 6 -> 50 on a real rollup record).
//   shodh-memory                           reachable ONLY through an MCP client. monitor/sweep.mjs
//                                          runs headless and has none, so this adapter cannot serve
//                                          it — not "usually fails", CANNOT. The substrate MCP was
//                                          absent fleet-wide for ~8 days and every session
//                                          rediscovered that alone, at whatever hour it was running.
//
// If the port returned `{ ok, id }` the SQLite adapter and the veld adapter would be INDISTINGUISHABLE
// to every caller and every panel: a full-fidelity durable write and a 410-byte preview, reported
// with one badge. That is the exact shape of this repo's named failure — a descriptive signal wearing
// a verdict's clothes. So the port carries a declaration per adapter, HOLDS each adapter to its own
// declaration, and — because a declaration nothing checks is documentation — verifyCapabilities()
// PROVES the declaration against observed behaviour, in both directions.
//
// THE ORDER OF AUTHORITY IS: measured behaviour > declaration > silence. When behaviour and
// declaration disagree the port keeps the BEHAVIOUR and reports the disagreement; it never lets a
// declaration launder an observation, and it never upgrades a receipt.
//
// Zero dependencies. Env is read at CALL time inside functions, never at module load — a
// `const X = process.env.Y` at import silently defeats every test that sets the override afterwards,
// so the test passes while proving nothing (CLAUDE.md).

import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/** Deterministic clock, same override as the rest of the repo. Read at call time. */
export function now() {
  const o = process.env.CW_NOW;
  if (!o) return new Date().toISOString();
  const d = new Date(o);
  if (Number.isNaN(d.getTime())) throw new Error(`CW_NOW is not a parseable date: ${o}`);
  return d.toISOString();
}

// ── The vocabularies ────────────────────────────────────────────────────────
//
// Each axis is a CLOSED set. An undeclared value is refused at declaration time rather than
// defaulting to the permissive member — defaulting is how an agent-tool adapter ends up wired into
// a cron job, and the failure surfaces at 3am as a timeout instead of at build time as a refusal.

/** WHERE the adapter can be reached from — the axis that decides whether a caller may use it at all. */
export const REACH_SERVICE = 'service';        // over the network; any process can attempt it
export const REACH_LIBRARY = 'library';        // in-process; no transport, no daemon, no client
export const REACH_AGENT_TOOL = 'agent-tool';  // ONLY via an attached MCP client — a headless process has none
export const REACHABILITY = Object.freeze([REACH_SERVICE, REACH_LIBRARY, REACH_AGENT_TOOL]);

/** WHAT the backend keeps of a document it accepted. The axis veld and SQLite differ on. */
export const STORED_FULL = 'full';        // the whole document, byte for byte
export const STORED_PREVIEW = 'preview';  // a bounded head of it; the rest is discarded on store
export const STORED_UNKNOWN = 'unknown';  // never established. NOT a pass and NOT a finding.
export const STORED_FORM_GUARANTEE = Object.freeze([STORED_FULL, STORED_PREVIEW, STORED_UNKNOWN]);

/**
 * WHO is calling. This is not decoration: it is the input the reachability refusal is computed from,
 * and it must be stated rather than inferred. Inferring "an MCP client is probably attached" is the
 * same defect as inferring an owner from a touch ledger.
 */
export const CALLER_HEADLESS = 'headless';          // cron, CI, monitor/sweep.mjs — no MCP client, no human
export const CALLER_INTERACTIVE = 'interactive';    // a human at a terminal — still no MCP client
export const CALLER_AGENT_SESSION = 'agent-session';// inside a session that HAS an MCP client attached
export const CALLER_CONTEXTS = Object.freeze([CALLER_HEADLESS, CALLER_INTERACTIVE, CALLER_AGENT_SESSION]);

/** The five operations, and there are only five. An adapter declares which of them it actually has. */
export const OP_UPSERT = 'upsert';
export const OP_GET_BY_ID = 'getById';
export const OP_RECALL_BY_TAGS = 'recallByTags';
export const OP_FORGET = 'forget';
export const OP_HEALTH = 'health';
export const OPERATIONS = Object.freeze([OP_UPSERT, OP_GET_BY_ID, OP_RECALL_BY_TAGS, OP_FORGET, OP_HEALTH]);

/** Port outcomes. Three, and `refused` is the one that had to exist. */
export const OUTCOME_OK = 'ok';
export const OUTCOME_REFUSED = 'refused';  // the adapter CANNOT do this, by declaration. Not a fault.
export const OUTCOME_FAILED = 'failed';    // it was attempted and it went wrong.

/** Verification verdicts. Three-valued for the same reason receipts are. */
export const VERDICT_CONFIRMED = 'confirmed';
export const VERDICT_CONTRADICTED = 'contradicted';
export const VERDICT_UNVERIFIABLE = 'unverifiable';  // grey: neither a pass nor a finding

// ── Declaring a capability row ──────────────────────────────────────────────

const setOf = (xs) => [...new Set((xs || []).map(String))].sort();

/**
 * Build one adapter's capability row, refusing an incoherent one at construction.
 *
 * The coherence rules below are not style. Each one closes a way for the table to say something a
 * caller would act on and the adapter cannot honour:
 *
 *  · supportsReadback === false  =>  storedFormGuarantee MUST be 'unknown'. You cannot know what a
 *    store kept if you cannot read it back. A `full` claim with no readback is the purest form of
 *    the declaration-without-a-floor problem: nothing would notice the day it stopped being true.
 *
 *  · supportsReadback === true   =>  'getById' must be among the operations. Readback IS a read.
 *    The two fields state one fact, and the brief that specified both is one place where the field
 *    set is redundant — so rather than letting them drift, they are bound.
 *    The converse is legal and means something real: reads exist, but a write is not immediately
 *    readable (eventual consistency), and in that case the guarantee still cannot be 'full'.
 *
 *  · storedFormGuarantee === 'preview'  =>  previewBytes MUST be a positive number. "Preview" with
 *    no budget cannot be checked against a document size, so every constrainReceipt() call would
 *    have to guess. veld's is ~410; a 115-byte body round-tripped byte-identically, so the cap is
 *    SIZE-CONDITIONAL and the number is what makes it computable rather than a mood.
 *
 *  · evidence is REQUIRED. A capability with no stated provenance is an assertion, and this table
 *    exists precisely to stop assertions being read as measurements.
 *
 * `tagsAuthoritative` is deliberately THREE-VALUED (true | false | null) where the rest are booleans.
 * See assertTags() for why: it is the only field on which BOTH boolean values are dangerous when the
 * truth is simply unknown.
 */
export function declareCapabilities({
  name,
  reachability,
  storedFormGuarantee,
  tagsAuthoritative,
  supportsReadback,
  supportsSemanticRecall,
  operations,
  previewBytes = null,
  evidence,
  notes = null,
} = {}) {
  const bad = [];
  if (!name || typeof name !== 'string') bad.push('name is required — an anonymous adapter cannot be reported on');
  if (!REACHABILITY.includes(reachability)) bad.push(`reachability must be one of ${REACHABILITY.join(' | ')} (got ${JSON.stringify(reachability)})`);
  if (!STORED_FORM_GUARANTEE.includes(storedFormGuarantee)) bad.push(`storedFormGuarantee must be one of ${STORED_FORM_GUARANTEE.join(' | ')} (got ${JSON.stringify(storedFormGuarantee)})`);
  if (!(tagsAuthoritative === true || tagsAuthoritative === false || tagsAuthoritative === null)) {
    bad.push('tagsAuthoritative must be true, false, or null (null = never established; no tag verdict may be emitted)');
  }
  if (typeof supportsReadback !== 'boolean') bad.push('supportsReadback must be a boolean');
  if (typeof supportsSemanticRecall !== 'boolean') bad.push('supportsSemanticRecall must be a boolean');
  if (!Array.isArray(operations) || operations.length === 0) bad.push('operations must be a non-empty array — an adapter that supports nothing is not an adapter');
  else {
    const unknown = operations.filter((o) => !OPERATIONS.includes(o));
    if (unknown.length) bad.push(`unknown operation(s): ${unknown.join(', ')} — the five are ${OPERATIONS.join(', ')}`);
  }
  if (typeof evidence !== 'string' || evidence.trim().length < 20) {
    bad.push('evidence is required (>=20 chars) — say WHERE each claim was measured; an undocumented capability is an assertion');
  }

  const ops = Array.isArray(operations) ? setOf(operations) : [];
  if (supportsReadback === false && storedFormGuarantee !== STORED_UNKNOWN) {
    bad.push(`supportsReadback:false forces storedFormGuarantee:'unknown' (declared '${storedFormGuarantee}') — you cannot know what was kept if you never read it back`);
  }
  if (supportsReadback === true && !ops.includes(OP_GET_BY_ID)) {
    bad.push("supportsReadback:true requires 'getById' among operations — readback is a read");
  }
  if (storedFormGuarantee === STORED_PREVIEW && !(typeof previewBytes === 'number' && previewBytes > 0)) {
    bad.push("storedFormGuarantee:'preview' requires a positive previewBytes budget — a preview with no size cannot be checked against a document");
  }
  if (storedFormGuarantee !== STORED_PREVIEW && previewBytes !== null) {
    bad.push('previewBytes is meaningful only for a preview guarantee — set it to null otherwise, so it can never be read as a live budget');
  }

  if (bad.length) throw new Error(`declareCapabilities(${name || 'unnamed'}): ${bad.join('; ')}`);

  return Object.freeze({
    name, reachability, storedFormGuarantee, tagsAuthoritative,
    supportsReadback, supportsSemanticRecall,
    operations: Object.freeze(ops),
    previewBytes, evidence, notes,
  });
}

/** Can `caller` reach an adapter with this reachability? Returns a reason string, or null if it can. */
export function unreachableReason(cap, caller) {
  if (!CALLER_CONTEXTS.includes(caller)) {
    // Refused, not defaulted. A caller context that falls back to the permissive member is how an
    // MCP-bound adapter gets wired into a headless sweep and fails in the middle of the night.
    throw new Error(`unknown caller context ${JSON.stringify(caller)} — declare one of ${CALLER_CONTEXTS.join(' | ')}; defaulting here would let an agent-tool adapter be called from cron`);
  }
  if (cap.reachability === REACH_AGENT_TOOL && caller !== CALLER_AGENT_SESSION) {
    return `${cap.name} is reachable only through an attached MCP client (reachability: agent-tool) and the caller is '${caller}', which has none. This is a design fact, not an outage — retrying will never succeed.`;
  }
  return null;
}

// ── Result envelopes ────────────────────────────────────────────────────────
//
// Every port call returns the SAME shape, and `value` is `null` on anything but success. Never `[]`:
// a refused or failed query has OBSERVED NOTHING, while `[]` claims it observed emptiness. That
// distinction is the one lib/memory-layer-client.mjs's recallByTags already makes, and it is the
// difference between "this adapter cannot answer" and "there is nothing there".

const envelope = (adapter, operation, outcome, extra = {}) => ({
  adapter, operation, outcome,
  ok: outcome === OUTCOME_OK,
  capability: null, reason: null, value: null,
  ...extra,
});

export const refusal = (adapter, operation, capability, reason) =>
  envelope(adapter, operation, OUTCOME_REFUSED, { capability, reason });

export const failure = (adapter, operation, reason) =>
  envelope(adapter, operation, OUTCOME_FAILED, { reason });

export const success = (adapter, operation, value, extra = {}) =>
  envelope(adapter, operation, OUTCOME_OK, { value, ...extra });

/**
 * ENOENT is decided by an error CODE, never by matching a message.
 *
 * lib/memory-store.mjs makes this decision with stat() because it owns a file. The port owns no
 * file, so it can only be handed an error — and the rule that survives the translation is: the only
 * legitimate absence is an explicit ENOENT code. Message matching is how "unable to open database
 * file" (SQLite errcode 14, emitted identically for a missing file and a permission denial) turns a
 * LOCKED store into an EMPTY one, which renders as zero records and therefore zero problems.
 */
export function absenceFromError(err) {
  return Boolean(err && err.code === 'ENOENT');
}

// ── Holding a receipt to the declaration ────────────────────────────────────

/**
 * Cap what a receipt is allowed to CLAIM, given what its adapter declared it can do.
 *
 * This only ever LOWERS a claim. It cannot turn a failure into a success, cannot turn a dry-run into
 * anything, and cannot upgrade an observed `preview` into a declared `full` — because behaviour
 * outranks declaration. Where the two disagree, the observation is kept and the disagreement is
 * REPORTED on `capabilityContradiction`, so a table that has gone stale announces itself at the
 * point of use rather than at the next audit.
 *
 * `sourceBytes` is the size of the document as it existed BEFORE the write. It is not optional
 * in spirit: without it a preview-guarantee adapter's `verified` cannot be judged, so it is treated
 * as grey rather than waved through. Fail closed.
 */
export function constrainReceipt(cap, receipt, { sourceBytes = null } = {}) {
  const out = { ...receipt, capabilityContradiction: null };
  const notes = [];

  // A failure, a dry run, or any state this port does not model is left EXACTLY as it is. Rewriting
  // one would be inventing an event; an unguarded else here is how `dry-run` was reported as data
  // loss for as long as both existed (lib/memory-layer-client.mjs NOT_ATTEMPTED).
  if (out.state !== 'verified') {
    if (cap.storedFormGuarantee === STORED_FULL && out.storedForm === STORED_PREVIEW) {
      out.capabilityContradiction = `${cap.name} declares storedFormGuarantee 'full' but this receipt reports 'preview' — the declaration is stale, and the OBSERVATION is what stands`;
    }
    return out;
  }

  if (!cap.supportsReadback) {
    notes.push(`${cap.name} declares no readback, so 'verified' cannot be earned — nothing read the record back`);
    out.storedForm = STORED_UNKNOWN;
    out.storedCoverage = null;
    out.state = 'accepted-unverified';
  } else if (cap.storedFormGuarantee === STORED_UNKNOWN) {
    notes.push(`${cap.name} makes no stored-form guarantee — the write was accepted and what the store kept is not established`);
    out.storedForm = STORED_UNKNOWN;
    out.storedCoverage = null;
    out.state = 'accepted-unverified';
  } else if (cap.storedFormGuarantee === STORED_PREVIEW) {
    if (sourceBytes === null) {
      // Grey, not green. A preview store that says `verified` about a document of unmeasured size is
      // exactly the claim the capability table exists to stop standing unchallenged.
      notes.push(`${cap.name} stores a ~${cap.previewBytes}-byte preview and no source size was supplied, so 'verified' cannot be judged`);
      out.storedForm = STORED_UNKNOWN;
      out.storedCoverage = null;
      out.state = 'accepted-unverified';
    } else if (sourceBytes > cap.previewBytes) {
      // Grey, not red either. The write SUCCEEDED. It is simply not a durable copy, and those are
      // two facts on two axes — folding them into one badge loses the second.
      notes.push(`${cap.name} keeps at most ~${cap.previewBytes} bytes and the source is ${sourceBytes} — the write succeeded and the record is NOT a durable copy`);
      if (out.storedForm === STORED_FULL) {
        out.capabilityContradiction = `${cap.name} returned storedForm 'full' for a ${sourceBytes}-byte document against a ${cap.previewBytes}-byte budget — either the budget moved or the measurement is wrong; both need a human`;
      }
      out.storedForm = STORED_PREVIEW;
      out.state = 'accepted-unverified';
    }
    // sourceBytes <= previewBytes: a small document genuinely can round-trip on a preview store
    // (measured: a 115-byte body was byte-identical on readback), so `verified` stands untouched.
  }

  if (notes.length) {
    out.reason = out.reason ? `${out.reason}; ${notes.join('; ')}` : notes.join('; ');
  }
  return out;
}

// ── Tag assertions ──────────────────────────────────────────────────────────

/**
 * WHICH tag assertion is correct is a property of the ADAPTER, never a universal law.
 *
 * veld MINTS TAGS FROM CONTENT (measured: 2 sent -> 19 stored; 6 -> 50 on a real record), so there
 * the only assertion that can ever pass is SUBSET — every sent tag present, extras expected. But
 * extracting that into a universal rule would be taking veld's quirk and imposing it on a SQL store
 * that keeps exactly what it was given, where subset-assertion silently forgoes the strongest check
 * available: EXACT EQUALITY, which would catch a store inventing or losing a tag.
 *
 * And the third value. `tagsAuthoritative === null` means never established, and this is the one
 * field where BOTH booleans are actively dangerous under uncertainty:
 *   · guessing `true`  on a minting store fabricates a failure on EVERY healthy write — the
 *     grey-as-RED half of the invariant, and the direction that costs more here.
 *   · guessing `false` on an exact store permanently disables the check that would have caught
 *     corruption — grey-as-GREEN.
 * There is no safe default, so there is no default: this refuses to emit a verdict at all, naming
 * the missing capability. That is why this field is three-valued while the rest are booleans.
 */
export function assertTags(cap, sent, stored) {
  const s = setOf(sent);
  const got = setOf(stored);
  const missing = s.filter((t) => !got.includes(t));
  const unexpected = got.filter((t) => !s.includes(t));

  if (cap.tagsAuthoritative === null) {
    return {
      ...refusal(cap.name, 'assertTags', 'tagsAuthoritative',
        `${cap.name} has never had its tag behaviour established. Asserting equality would fabricate a failure on every write if it mints tags; asserting subset would permanently disable the strongest check if it does not. Measure it (verifyCapabilities) rather than picking one.`),
      assertion: null, missing, unexpected,
    };
  }

  if (cap.tagsAuthoritative === true) {
    const ok = missing.length === 0 && unexpected.length === 0;
    return {
      ...(ok ? success(cap.name, 'assertTags', true) : failure(cap.name, 'assertTags',
        [missing.length ? `store dropped sent tag(s): ${missing.join(', ')}` : null,
         unexpected.length ? `store holds tag(s) nobody sent: ${unexpected.join(', ')}` : null]
          .filter(Boolean).join('; '))),
      assertion: 'exact', missing, unexpected,
    };
  }

  // Subset. Extras are the store's business; a MISSING sent tag is not a corruption but it does mean
  // the record is not scoped as intended — degraded, with a reason, never `failed`.
  const ok = missing.length === 0;
  return {
    ...(ok ? success(cap.name, 'assertTags', true)
           : envelope(cap.name, 'assertTags', OUTCOME_FAILED, {
               reason: `store did not retain sent tag(s): ${missing.join(', ')} — the content may be right, the record is not scoped as intended`,
             })),
    assertion: 'subset', missing, unexpected,
  };
}

// ── The port ────────────────────────────────────────────────────────────────

/**
 * Wrap an adapter `{ capabilities, ops }` for one caller context.
 *
 * Three gates run before any adapter code, in this order, and each returns a REFUSAL naming the
 * capability that stopped it — never a silent no-op, never a fabricated empty result:
 *   1. reachability vs caller   — the agent-tool case: unusable BY DESIGN, said at the call site
 *                                 rather than discovered as a 3am timeout.
 *   2. operation declared       — an undeclared operation is refused, not attempted.
 *   3. operation implemented    — a DECLARED but absent function is refused too, and this is the
 *                                 gate that catches a stale table: without it the caller gets a
 *                                 TypeError from inside the port, which reads as a bug in the store.
 */
export function createPort(adapter, { caller = CALLER_HEADLESS } = {}) {
  const cap = adapter && adapter.capabilities;
  if (!cap || !cap.name) throw new Error('createPort: adapter.capabilities is required — an adapter with no declaration is exactly what this module exists to prevent');
  const unreachable = unreachableReason(cap, caller);   // throws on an unknown caller context
  const ops = (adapter && adapter.ops) || {};

  const gate = (operation) => {
    if (unreachable) return refusal(cap.name, operation, 'reachability', unreachable);
    if (!cap.operations.includes(operation)) {
      return refusal(cap.name, operation, 'operations',
        `${cap.name} does not support ${operation} (declares: ${cap.operations.join(', ')}). Returning an empty result here would be indistinguishable from "there is nothing there".`);
    }
    if (typeof ops[operation] !== 'function') {
      return refusal(cap.name, operation, 'operations',
        `${cap.name} DECLARES ${operation} but supplies no implementation — the capability table is ahead of the adapter, and that disagreement is reported rather than thrown from inside the port`);
    }
    return null;
  };

  const run = async (operation, fn) => {
    const blocked = gate(operation);
    if (blocked) return blocked;
    try {
      return await fn(ops[operation]);
    } catch (e) {
      return failure(cap.name, operation, `${operation} threw: ${e && e.message ? e.message : 'error'}`);
    }
  };

  return {
    capabilities: cap,
    caller,

    /** Write. The receipt is held to the declaration by constrainReceipt before it reaches anybody. */
    async upsert(record, opts = {}) {
      return run(OP_UPSERT, async (fn) => {
        const receipt = await fn(record, opts);
        const sourceBytes = opts.sourceBytes !== undefined
          ? opts.sourceBytes
          : (typeof record?.content === 'string' ? Buffer.byteLength(record.content, 'utf8') : null);
        return success(cap.name, OP_UPSERT, constrainReceipt(cap, receipt, { sourceBytes }));
      });
    },

    /**
     * Read by identity. `absent: true` is a THIRD answer and only a proven absence may carry it:
     * either the adapter returned null, or it threw with an ENOENT code. Every other throw is a
     * FAILURE with value null — an unreadable store is not an empty one.
     */
    async getById(externalId, opts = {}) {
      const blocked = gate(OP_GET_BY_ID);
      if (blocked) return blocked;
      try {
        const row = await ops[OP_GET_BY_ID](externalId, opts);
        return success(cap.name, OP_GET_BY_ID, row ?? null, { absent: row == null });
      } catch (e) {
        if (absenceFromError(e)) {
          return success(cap.name, OP_GET_BY_ID, null, { absent: true, reason: 'store file does not exist (ENOENT) — legitimately absent' });
        }
        return { ...failure(cap.name, OP_GET_BY_ID, `getById threw: ${e && e.message ? e.message : 'error'}`), absent: false };
      }
    },

    /** Strict tag enumeration. `value` stays null on refusal/failure — see the envelope comment. */
    async recallByTags(tags, opts = {}) {
      return run(OP_RECALL_BY_TAGS, async (fn) => {
        const r = await fn(tags, opts);
        if (r && r.ok === false) return failure(cap.name, OP_RECALL_BY_TAGS, r.reason || 'recall failed');
        return success(cap.name, OP_RECALL_BY_TAGS, Array.isArray(r) ? r : (r?.memories ?? r?.records ?? null));
      });
    },

    async forget(externalId, opts = {}) {
      return run(OP_FORGET, async (fn) => {
        const r = await fn(externalId, opts);
        if (r && r.ok === false) return failure(cap.name, OP_FORGET, r.reason || 'forget failed');
        return success(cap.name, OP_FORGET, r ?? true);
      });
    },

    async health(opts = {}) {
      return run(OP_HEALTH, async (fn) => {
        const r = await fn(opts);
        if (r && r.ok === false) return failure(cap.name, OP_HEALTH, r.reason || 'unhealthy');
        return success(cap.name, OP_HEALTH, r ?? true);
      });
    },
  };
}

// ── Capability vs behaviour ─────────────────────────────────────────────────

/** Deterministic probe text. Prose, so it cannot trip the redaction gate's field-name patterns. */
export function probeContent(bytes) {
  const line = 'This is a commitwork memory-port capability probe line. It exists only to be written and read back. ';
  let s = '';
  while (Buffer.byteLength(s, 'utf8') < bytes) s += line;
  return s.slice(0, bytes);
}

export const PROBE_EXTERNAL_ID = 'commitwork:memory-port:capability-probe';
export const PROBE_TAGS = Object.freeze(['commitwork-memory-port-probe']);

const verdict = (v, declared, observed, reason) => ({ verdict: v, declared, observed, reason });

/**
 * Prove — or contradict — an adapter's declaration by exercising it.
 *
 * WHY A DECLARATION IS NOT ENOUGH. Every field in the capability table is a claim a caller will act
 * on: a `full` guarantee decides whether a document is safe to delete from disk; `tagsAuthoritative`
 * decides which assertion the verifier makes; `reachability` decides whether a lane is wired at all.
 * A claim with no floor — no mechanism by which it HAS to be true — has no way to notice the day it
 * stops being true. That has already happened here: a store asserted 'full' because it "cannot
 * truncate", which was correct and unwitnessed, and lib/memory-store.mjs now proves the round-trip
 * inside its own write transaction for exactly that reason. This function is the same move at the
 * port layer, for adapters that will not all be written here.
 *
 * `probeWrites` has NO DEFAULT and must be stated. A verification that writes nothing verifies
 * nothing, so defaulting it to false would make the function a silent no-op wearing a checker's
 * name; defaulting it to true would write to a production store because somebody called a function
 * that sounds read-only. The caller decides, out loud.
 *
 * Verdicts are three-valued. `unverifiable` is NOT a pass and NOT a finding: an agent-tool adapter
 * probed from a headless process is unverifiable, and reporting that as either would be the exact
 * failure this repo names in both directions.
 */
export async function verifyCapabilities(adapter, { caller = CALLER_HEADLESS, probeWrites, probeBytes = null } = {}) {
  const cap = adapter && adapter.capabilities;
  if (!cap) throw new Error('verifyCapabilities: adapter.capabilities is required');
  if (typeof probeWrites !== 'boolean') {
    throw new Error('verifyCapabilities: probeWrites must be stated explicitly (true|false). A verification that writes nothing verifies nothing, and one that writes by default touches a production store on a call that reads as harmless.');
  }

  const fields = {};
  const port = createPort(adapter, { caller });
  const ops = (adapter && adapter.ops) || {};

  // 1. OPERATIONS — the cheapest check and the one that catches a stale table, in BOTH directions.
  //    A declared-but-absent op refuses at every call site; a present-but-undeclared op is refused
  //    forever despite working. Both are the table disagreeing with the adapter.
  const declaredMissing = cap.operations.filter((o) => typeof ops[o] !== 'function');
  const implementedUndeclared = OPERATIONS.filter((o) => typeof ops[o] === 'function' && !cap.operations.includes(o));
  fields.operations = declaredMissing.length || implementedUndeclared.length
    ? verdict(VERDICT_CONTRADICTED, cap.operations.join(','), OPERATIONS.filter((o) => typeof ops[o] === 'function').join(','),
        [declaredMissing.length ? `declared but not implemented: ${declaredMissing.join(', ')}` : null,
         implementedUndeclared.length ? `implemented but not declared (refused at every call site despite working): ${implementedUndeclared.join(', ')}` : null]
          .filter(Boolean).join('; '))
    : verdict(VERDICT_CONFIRMED, cap.operations.join(','), cap.operations.join(','), null);

  // 2. REACHABILITY — provable only in the negative-for-this-caller direction. That an adapter works
  //    from HERE does not prove it works from everywhere, so the confirmation is narrow and says so.
  const unreachable = unreachableReason(cap, caller);
  if (unreachable) {
    fields.reachability = verdict(VERDICT_UNVERIFIABLE, cap.reachability, null,
      `${unreachable} Nothing about this adapter's behaviour can be measured from a '${caller}' caller.`);
  }

  const behavioural = ['storedFormGuarantee', 'tagsAuthoritative', 'supportsReadback'];
  const allUnverifiable = (reason) => {
    for (const f of behavioural) if (!fields[f]) fields[f] = verdict(VERDICT_UNVERIFIABLE, cap[f], null, reason);
  };

  // supportsSemanticRecall is PERMANENTLY unverifiable here, and that is worth stating rather than
  // hiding: the port exposes no semantic-recall operation (veld's /api/recall accepts a `tags`
  // filter and silently ignores it — measured 5 returned, 4 without the requested tag — so the
  // contract forbids exposing it). The field therefore describes the BACKEND, not the port surface,
  // and by this module's own rule that makes it documentation until an operation gates it.
  fields.supportsSemanticRecall = verdict(VERDICT_UNVERIFIABLE, cap.supportsSemanticRecall, null,
    'the port exposes no semantic-recall operation, so nothing here can check this field — it describes the backend, not the surface. Advisory until an operation gates it.');

  if (unreachable) {
    allUnverifiable(`unreachable from a '${caller}' caller`);
  } else if (!probeWrites) {
    allUnverifiable('probeWrites:false — no probe was written, so no behaviour was observed. This is an absence of evidence, not a pass.');
    fields.reachability ||= verdict(VERDICT_UNVERIFIABLE, cap.reachability, null, 'no call was made');
  } else {
    const bytes = probeBytes ?? Math.max(2048, (cap.previewBytes || 0) * 4);
    const content = probeContent(bytes);
    const record = { external_id: PROBE_EXTERNAL_ID, content, memory_type: 'Context', tags: [...PROBE_TAGS] };

    const wrote = await port.upsert(record, { sourceBytes: bytes });
    if (!wrote.ok) {
      fields.reachability = verdict(VERDICT_CONTRADICTED, cap.reachability, null,
        `declared reachable from '${caller}' but the probe write did not succeed: ${wrote.reason}`);
      allUnverifiable(`the probe write did not succeed (${wrote.outcome}), so nothing downstream was observed`);
    } else {
      fields.reachability = verdict(VERDICT_CONFIRMED, cap.reachability, 'reached',
        `a probe write succeeded from a '${caller}' caller. This confirms reachability FROM HERE only.`);

      const read = await port.getById(PROBE_EXTERNAL_ID);
      const gotRow = read.ok && read.value && typeof read.value.content === 'string';

      // 3. supportsReadback — checked in both directions. Declared false with a working getById is a
      //    contradiction too: the table is understating, and everything downstream of it (the forced
      //    'unknown' stored form) is being suppressed for no reason.
      if (cap.supportsReadback) {
        fields.supportsReadback = gotRow
          ? verdict(VERDICT_CONFIRMED, true, true, null)
          : verdict(VERDICT_CONTRADICTED, true, false, `declared readback but the probe did not come back readable: ${read.reason || (read.absent ? 'absent immediately after a successful write' : 'no content')}`);
      } else if (cap.operations.includes(OP_GET_BY_ID)) {
        fields.supportsReadback = gotRow
          ? verdict(VERDICT_CONTRADICTED, false, true, 'declared no readback, but the probe read back fine — the declaration forces every receipt to `unknown` for nothing')
          : verdict(VERDICT_CONFIRMED, false, false, null);
      } else {
        fields.supportsReadback = verdict(VERDICT_UNVERIFIABLE, false, null,
          'no read operation exists, so a negative readback claim cannot be tested — a negative is not provable by absence of a means to test it');
      }

      // 4. storedFormGuarantee — measured against the SOURCE text, two directions.
      if (!gotRow) {
        fields.storedFormGuarantee = verdict(VERDICT_UNVERIFIABLE, cap.storedFormGuarantee, null,
          'nothing read back, so what the store kept is not established. Not a pass and not a finding.');
      } else {
        const stored = read.value.content;
        const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
        let observed;
        if (sha256(stored) === sha256(content)) observed = STORED_FULL;
        else if (norm(content).includes(norm(stored)) && stored.length < content.length) observed = STORED_PREVIEW;
        else observed = 'divergent';   // its own name; preview-detection must never swallow corruption

        if (observed === 'divergent') {
          fields.storedFormGuarantee = verdict(VERDICT_CONTRADICTED, cap.storedFormGuarantee, observed,
            'stored text is not derived from the probe at all — corruption, and no guarantee covers it');
        } else if (observed === cap.storedFormGuarantee) {
          fields.storedFormGuarantee = verdict(VERDICT_CONFIRMED, cap.storedFormGuarantee, observed, null);
        } else if (cap.storedFormGuarantee === STORED_PREVIEW && observed === STORED_FULL && bytes <= (cap.previewBytes || 0)) {
          fields.storedFormGuarantee = verdict(VERDICT_UNVERIFIABLE, cap.storedFormGuarantee, observed,
            `the probe (${bytes} bytes) is within the declared ${cap.previewBytes}-byte budget, so a full round-trip proves nothing about larger documents. Re-run with a bigger probeBytes.`);
        } else {
          fields.storedFormGuarantee = verdict(VERDICT_CONTRADICTED, cap.storedFormGuarantee, observed,
            `declared '${cap.storedFormGuarantee}', a ${bytes}-byte probe measured '${observed}' (${stored.length} of ${content.length} chars back)`);
        }
      }

      // 5. tagsAuthoritative — the field the whole rule is per-adapter for.
      const storedTags = gotRow && Array.isArray(read.value.tags) ? read.value.tags : null;
      const sentTags = Array.isArray(wrote.value?.tagsSent) && wrote.value.tagsSent.length
        ? wrote.value.tagsSent : [...PROBE_TAGS];
      if (!storedTags) {
        fields.tagsAuthoritative = verdict(VERDICT_UNVERIFIABLE, cap.tagsAuthoritative, null,
          'the readback carried no tag list, so tag behaviour is not established');
      } else {
        const s = setOf(sentTags);
        const got = setOf(storedTags);
        const exact = s.length === got.length && s.every((t, i) => t === got[i]);
        const observed = exact;
        if (cap.tagsAuthoritative === null) {
          // null is not a false claim; it is an unfinished one. Say what was measured so it can be
          // finished, and leave the verdict grey rather than marking honest silence as a finding.
          fields.tagsAuthoritative = verdict(VERDICT_UNVERIFIABLE, null, observed,
            `the declaration is null (never established); this probe observed tagsAuthoritative=${observed} (sent ${s.length}, stored ${got.length}). Record it in the table.`);
        } else if (cap.tagsAuthoritative === observed) {
          fields.tagsAuthoritative = verdict(VERDICT_CONFIRMED, cap.tagsAuthoritative, observed, null);
        } else if (cap.tagsAuthoritative === true) {
          fields.tagsAuthoritative = verdict(VERDICT_CONTRADICTED, true, false,
            `declared authoritative but the store returned ${got.length} tags for ${s.length} sent — exact-equality assertions against it would fabricate a failure on every healthy write`);
        } else {
          fields.tagsAuthoritative = verdict(VERDICT_CONTRADICTED, false, true,
            'declared non-authoritative, but the store returned exactly the tags it was sent — subset-assertion is forgoing the strongest check available here');
        }
      }
    }

    // Litter is reported, never left silently. A probe record nobody knows about is indistinguishable
    // from a real one the next time somebody enumerates the store.
    if (cap.operations.includes(OP_FORGET)) {
      const gone = await port.forget(PROBE_EXTERNAL_ID);
      if (!gone.ok) fields.probeCleanup = verdict(VERDICT_UNVERIFIABLE, null, null, `the probe record ${PROBE_EXTERNAL_ID} could not be removed: ${gone.reason}`);
    } else if (probeWrites) {
      fields.probeCleanup = verdict(VERDICT_UNVERIFIABLE, null, null,
        `${cap.name} declares no forget operation, so the probe record ${PROBE_EXTERNAL_ID} remains in the store`);
    }
  }

  const vals = Object.values(fields);
  const contradicted = vals.filter((f) => f.verdict === VERDICT_CONTRADICTED).length;
  const unverifiable = vals.filter((f) => f.verdict === VERDICT_UNVERIFIABLE).length;
  const confirmed = vals.filter((f) => f.verdict === VERDICT_CONFIRMED).length;

  return {
    adapter: cap.name,
    caller,
    checkedAt: now(),
    fields,
    confirmed, contradicted, unverifiable,
    // TWO claims, not one, for the same reason a receipt has `verified` and `accepted-unverified`.
    // `ok` says nothing was caught lying. `trustworthy` says every field was actually measured.
    // Collapsing them would let an all-grey table read as a clean one.
    ok: contradicted === 0,
    trustworthy: contradicted === 0 && unverifiable === 0,
  };
}

// ── The known table ─────────────────────────────────────────────────────────
//
// Declarations for the three backends that exist today. Each `evidence` string says where the claim
// came from; where nothing was measured, the field says so rather than guessing — which is the whole
// reason `tagsAuthoritative` can be null.

export const KNOWN_ADAPTERS = Object.freeze({
  local: declareCapabilities({
    name: 'local',
    reachability: REACH_LIBRARY,
    storedFormGuarantee: STORED_FULL,
    tagsAuthoritative: true,
    supportsReadback: true,
    supportsSemanticRecall: false,
    operations: [OP_UPSERT, OP_GET_BY_ID, OP_RECALL_BY_TAGS, OP_HEALTH],
    evidence: 'lib/memory-store.mjs: node:sqlite in-process, put() proves the round-trip by reading the row back inside its own transaction and comparing sha256; tags are stored verbatim as sent (tagsStoredCount === tags.length) and nothing is minted. No forget() exists yet — declaring one it does not have would refuse at every call site.',
    notes: 'The durable half. A `full` guarantee here is proven per write, not asserted.',
  }),
  veld: declareCapabilities({
    name: 'veld',
    reachability: REACH_SERVICE,
    storedFormGuarantee: STORED_PREVIEW,
    previewBytes: 410,
    tagsAuthoritative: false,
    supportsReadback: true,
    supportsSemanticRecall: true,
    operations: [OP_UPSERT, OP_GET_BY_ID, OP_RECALL_BY_TAGS, OP_FORGET, OP_HEALTH],
    evidence: 'lib/memory-layer-client.mjs:26-42 and lib/memory-layer-contract.json: measured 2026-09-02 the service keeps a ~410-byte preview in `content` and discards the rest; measured tag minting 2 sent -> 19 stored, 6 -> 50 on a real rollup record; GET /api/memory/{id} reflects an update immediately and round-tripped a 115-byte body byte-identically.',
    notes: 'supportsSemanticRecall is TRUE of the service and MUST NOT be exposed through this port: POST /api/recall accepts a `tags` filter and silently ignores it (measured 5 returned, 4 without the requested tag), which the contract forbids surfacing.',
  }),
  'shodh-memory': declareCapabilities({
    name: 'shodh-memory',
    reachability: REACH_AGENT_TOOL,
    storedFormGuarantee: STORED_UNKNOWN,
    tagsAuthoritative: null,
    supportsReadback: false,
    supportsSemanticRecall: true,
    operations: [OP_UPSERT, OP_RECALL_BY_TAGS],
    evidence: 'MCP-bound: reachable only through an attached MCP client, so monitor/sweep.mjs (headless) can never use it. Observed absent fleet-wide for ~8 days, rediscovered per-session. Nothing about its stored form or tag handling has been measured from this repo, so both say so rather than guessing.',
    notes: 'The row that motivates the null third value: guessing tagsAuthoritative either way here would either fabricate failures or disable a check, on an adapter nobody has measured.',
  }),
});
