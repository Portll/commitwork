#!/usr/bin/env node
// monitor/refutation.mjs — I11: contesting a claim, as a chained event rather than a conversation.
//
// fact: a refutation that is not a recorded, chained event is not contestable in any way that survives / commitwork itself must be the tool for this — the contest lives in the store beside the claim, never in a spreadsheet next to it (ruled 2026-08-26, expiry: never, prev: missing)
// fact: the party classifying which of commitwork's findings were commitwork's own fault is the party being measured / naming the adjudicator does not remove the conflict, it records it, so independence is a recorded field and never an assumption (ruled 2026-08-26, expiry: at an external adjudicator, prev: missing)
//
// A REFUTATION NEVER MUTATES WHAT IT CONTESTS. It is filed beside the claim, and the claim stays
// exactly as it was recorded — this is the same move as I9's append-only re-grade, for the same
// reason: a history whose whole value is that corrections are visible cannot have corrections
// applied by overwriting.
//
// AND THE CLAIM DOES NOT SILENTLY WIN. A target carrying an open refutation is `contested`, which
// is a THIRD state — not upheld, not conceded. A consumer that collapses it to either has
// discarded the fact that somebody disagreed. This is the fourth time the repo has used a
// non-collapsible type to stop exactly that: `undetermined` outside crit/high/med/low, `verified`
// as a tri-state, the 7-point band, and now this.
//
// TARGET ADDRESSES are deliberately the addresses that already exist, so an upstream maintainer can
// contest `detector:trufflehog/Lob` without commitwork minting them an identifier first. Opening
// this surface to affected maintainers is the intended end state — it is what converts an
// unverifiable claim into a checkable one — and is deliberately not the first step.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chainHash, writeJSONAtomic } from '../cra/lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

/** What may be contested. Each is an address that exists before the refutation does. */
export const TARGET_KINDS = Object.freeze(['closure', 'classification', 'band', 'detector']);

/** Resolutions. `withdrawn` is the refuter standing down; it is NOT the claim being upheld. */
export const RESOLUTIONS = Object.freeze(['upheld', 'conceded', 'withdrawn']);

/**
 * Independence of the refuter from the party that made the claim. RECORDED, never assumed, and
 * never used to refuse: a changed mind is legitimate and must leave a trace. What must not happen
 * is a self-refutation reading as an external check.
 */
export const INDEPENDENCE = Object.freeze(['self', 'internal', 'external']);

export function targetAddress({ kind, id }) {
  if (!TARGET_KINDS.includes(kind)) throw new Error(`target kind must be one of ${TARGET_KINDS.join('|')}`);
  const clean = String(id || '').trim();
  if (!clean) throw new Error(`a ${kind} refutation needs a target id`);
  return `${kind}:${clean}`;
}

export const emptyRefutationDoc = () => ({ version: 1, refutations: {}, events: [] });

function appendEvent(doc, type, refutationId, data, at) {
  const prevHash = doc.events.length ? doc.events[doc.events.length - 1].hash : null;
  const event = { type, refutationId, at, data: data || {}, prevHash, hash: '' };
  event.hash = chainHash(prevHash, event);
  doc.events.push(event);
  return event;
}

/**
 * File a refutation. Requires a stated ground — a refutation without one is a complaint, and the
 * same rule that makes evidence mandatory on a close makes it mandatory here.
 *
 * `independence` is required rather than defaulted. A default would be a guess about the one
 * property this record exists to make legible, and `self` defaulting would be as wrong as
 * `external`.
 */
export function fileRefutation(doc, { target, ground, by, independence, at, id = null }) {
  const address = targetAddress(target);
  if (!ground || !String(ground).trim()) throw new Error('a refutation requires a ground (a refutation without one is a complaint, not a contest)');
  if (!by || !String(by).trim()) throw new Error('a refutation requires a named refuter — an anonymous contest cannot be weighed');
  if (!INDEPENDENCE.includes(independence)) {
    throw new Error(`independence must be one of ${INDEPENDENCE.join('|')} — it is recorded, never inferred, because a self-refutation must not read as an external check`);
  }
  const rid = id || `REF-${randomUUID().slice(0, 8)}`;
  if (doc.refutations[rid]) throw new Error(`${rid} already exists`);
  doc.refutations[rid] = {
    id: rid, target: address, ground: String(ground).trim(), by: String(by).trim(),
    independence, state: 'open', resolution: null, filedAt: at, resolvedAt: null,
  };
  appendEvent(doc, 'refutation-filed', rid, { target: address, by, independence }, at);
  return doc.refutations[rid];
}

/**
 * Resolve one. `upheld` means the original claim stands DESPITE a recorded contest — which is not
 * the same as never having been contested, and the record keeps both.
 */
export function resolveRefutation(doc, rid, { resolution, why, by, at }) {
  const r = doc.refutations[rid];
  if (!r) throw new Error(`unknown refutation ${rid}`);
  if (r.state !== 'open') throw new Error(`${rid} is already ${r.state} (${r.resolution})`);
  if (!RESOLUTIONS.includes(resolution)) throw new Error(`resolution must be one of ${RESOLUTIONS.join('|')}`);
  if (!why || !String(why).trim()) throw new Error('resolving a refutation requires a reason — an unexplained resolution is the claim winning by default');
  if (!by || !String(by).trim()) throw new Error('resolving a refutation requires a named resolver');
  // A refuter withdrawing their own contest is theirs to do. Anyone else closing it is a JUDGEMENT,
  // and if the resolver is the refuter that is recorded rather than refused.
  if (resolution === 'withdrawn' && String(by).trim() !== r.by) {
    throw new Error('only the refuter may withdraw their own refutation — anyone else resolving it is upholding or conceding, and must say which');
  }
  r.state = 'resolved';
  r.resolution = resolution;
  r.resolvedBy = String(by).trim();
  r.resolvedWhy = String(why).trim();
  r.resolvedAt = at;
  // Self-resolution is legitimate (the operator is the primary adjudicator) and is MARKED, so a
  // reader can see the contest was settled by a party to it.
  r.resolvedIndependently = String(by).trim() !== r.by;
  appendEvent(doc, 'refutation-resolved', rid, { resolution, by, independent: r.resolvedIndependently }, at);
  return r;
}

/**
 * The state of a contested target. THREE STATES, and a consumer must not fold them.
 *
 *   uncontested — nobody has filed
 *   contested   — an open refutation stands against it; the claim is readable and does NOT win
 *   settled     — every refutation against it is resolved, with how
 */
export function contestState(doc, target) {
  const address = typeof target === 'string' ? target : targetAddress(target);
  const all = Object.values(doc.refutations || {}).filter((r) => r.target === address);
  if (!all.length) return { state: 'uncontested', open: 0, total: 0, why: 'no refutation has been filed against this claim' };
  const open = all.filter((r) => r.state === 'open');
  if (open.length) {
    return {
      state: 'contested', open: open.length, total: all.length,
      grounds: open.map((r) => ({ id: r.id, by: r.by, independence: r.independence, ground: r.ground })),
      why: `${open.length} open refutation${open.length === 1 ? '' : 's'} — the claim is recorded and does not stand unopposed`,
    };
  }
  const byRes = {};
  for (const r of all) byRes[r.resolution] = (byRes[r.resolution] || 0) + 1;
  const tally = Object.entries(byRes).map(([k, v]) => `${v} ${k}`).join(', ');
  // WHAT SETTLED MEANS DEPENDS ON HOW. The first version said "a claim upheld over a recorded
  // contest" for every settled target, including the conceded ones — asserting that the claim stood
  // in exactly the cases where it did not. A generated sentence is only safer than a hand-written
  // one while it reads the field it describes.
  const conceded = byRes.conceded || 0;
  return {
    state: 'settled', open: 0, total: all.length, resolutions: byRes,
    // The claim's own standing, which is NOT the same as the contest being over.
    claimStands: conceded > 0 ? false : (byRes.upheld ? true : null),
    why: conceded > 0
      ? `${all.length} refutation${all.length === 1 ? '' : 's'} filed and resolved (${tally}) — the claim was CONCEDED, so it does not stand and anything published from it must be withdrawn or restated`
      : (byRes.upheld
        ? `${all.length} refutation${all.length === 1 ? '' : 's'} filed and resolved (${tally}) — a claim upheld over a recorded contest, which is not an unchallenged one`
        : `${all.length} refutation${all.length === 1 ? '' : 's'} filed and withdrawn (${tally}) — the contest ended without a ruling, so the claim was never tested rather than vindicated`),
  };
}

/** Chain integrity. Proves non-alteration; it does NOT prove any refutation was ever considered. */
export function verifyRefutationChain(doc) {
  const broken = [];
  let prev = null;
  for (const [i, e] of (doc.events || []).entries()) {
    if (e.prevHash !== prev) broken.push({ index: i, why: 'prevHash does not match the preceding event' });
    else if (chainHash(e.prevHash, e) !== e.hash) broken.push({ index: i, why: 'hash does not match the event body' });
    prev = e.hash;
  }
  return { ok: broken.length === 0, broken, events: (doc.events || []).length };
}

/**
 * Band-targeted refutations in the shape `buildLaneConfidence` already accepts.
 *
 * `lane-confidence.mjs` (I1) could always attach a refutation to a band, but `refuteBand` built an
 * in-memory object that nothing persisted — a contest that vanished when the process exited, which
 * is the exact condition I11 exists to end. This is the adapter that makes the band artifact read
 * from the durable chain instead.
 *
 * ONLY OPEN ONES by default. A resolved refutation belongs in the record, not hanging off a live
 * band as though it were still standing — and `contestState` remains the way to see that a band was
 * upheld over a contest rather than never contested.
 */
export function bandRefutations(doc, { includeResolved = false } = {}) {
  return Object.values(doc.refutations || {})
    .filter((r) => r.target.startsWith('band:') && (includeResolved || r.state === 'open'))
    .map((r) => ({
      detector: r.target.slice('band:'.length),
      by: r.by, reason: r.ground, at: r.filedAt,
      independence: r.independence, state: r.state, resolution: r.resolution, id: r.id,
    }))
    .sort((a, b) => a.detector.localeCompare(b.detector) || String(a.at).localeCompare(String(b.at)));
}

/**
 * Load the store. FAIL CLOSED: only ENOENT means "no refutation has ever been filed". A parse
 * failure or a permission error returning an empty doc would render every contested claim as
 * uncontested — the store going unreadable would look exactly like nobody having objected.
 */
export function loadRefutations(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return emptyRefutationDoc();
    throw new Error(`refutation store at ${path} could not be read (${e.code}) — refusing to report zero contests over an unreadable store`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new Error(`refutation store at ${path} is not valid JSON (${e.message}) — refusing to report zero contests over an unparseable store`);
  }
  if (!doc || typeof doc !== 'object' || !doc.refutations || !Array.isArray(doc.events)) {
    throw new Error(`refutation store at ${path} is not a refutation document — refusing to treat an unrecognised shape as empty`);
  }
  return doc;
}

/** Atomic write, and the chain is verified BEFORE it lands — a broken chain is never persisted. */
export function saveRefutations(path, doc) {
  const v = verifyRefutationChain(doc);
  if (!v.ok) throw new Error(`refusing to save a broken refutation chain: ${v.broken.map((b) => `#${b.index} ${b.why}`).join('; ')}`);
  writeJSONAtomic(path, doc);
  return v;
}

/** Everything open, so a reader is not required to ask. */
export function openRefutations(doc) {
  return Object.values(doc.refutations || {})
    .filter((r) => r.state === 'open')
    .sort((a, b) => String(a.filedAt).localeCompare(String(b.filedAt)));
}

export default {
  TARGET_KINDS, RESOLUTIONS, INDEPENDENCE, targetAddress, emptyRefutationDoc,
  fileRefutation, resolveRefutation, contestState, verifyRefutationChain, openRefutations,
  bandRefutations, loadRefutations, saveRefutations,
};

// ---- CLI --------------------------------------------------------------------------------------
if (isMainModule(import.meta.url)) {
  const { dirname, resolve: rs } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const CW = rs(dirname(fileURLToPath(import.meta.url)), '..');
  const { refutationsPathFor } = await import('./store-paths.mjs');
  const path = refutationsPathFor(CW);
  const doc = loadRefutations(path);
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
  const now = () => process.env.CW_NOW || new Date().toISOString();

  if (cmd === 'file') {
    const r = fileRefutation(doc, {
      target: { kind: arg('kind'), id: arg('target') },
      ground: arg('ground'), by: arg('by'), independence: arg('independence'), at: now(),
    });
    saveRefutations(path, doc);
    process.stdout.write(`filed ${r.id} against ${r.target}\n`);
  } else if (cmd === 'resolve') {
    const r = resolveRefutation(doc, arg('id'), { resolution: arg('as'), why: arg('why'), by: arg('by'), at: now() });
    saveRefutations(path, doc);
    process.stdout.write(`${r.id} ${r.resolution}${r.resolvedIndependently ? '' : ' (SELF-resolved — the resolver is the refuter)'}\n`);
  } else if (cmd === 'state') {
    process.stdout.write(`${JSON.stringify(contestState(doc, `${arg('kind')}:${arg('target')}`), null, 2)}\n`);
  } else {
    const open = openRefutations(doc);
    const v = verifyRefutationChain(doc);
    process.stdout.write(`${open.length} open of ${Object.keys(doc.refutations).length} filed; chain ${v.ok ? 'intact' : 'BROKEN'} over ${v.events} events\n`);
    for (const r of open) process.stdout.write(`  ${r.id}  ${r.target}  by ${r.by} (${r.independence})  ${r.ground.slice(0, 70)}\n`);
    if (!open.length) process.stdout.write('  (an empty store means nobody has filed — it does not mean nothing is contestable)\n');
    process.stdout.write('\nusage: refutation.mjs [file|resolve|state] --kind closure|classification|band|detector --target <id> --ground <why> --by <who> --independence self|internal|external\n');
  }
}
