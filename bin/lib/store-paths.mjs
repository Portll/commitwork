// store-paths — where every durable store lives, and which working tree a record came from.
//
// One declaration, because the last time there were seven the writers moved to `.claude/store/`
// (2026-08-27) and six reader defaults stayed at `.claude/`. All six resolved to absent files and none
// of them errored: gate-tests returned success with every file `unknown`, gate-ratchet re-armed its
// floor, gate-spine went grey. Add a new store here, not next to its reader.
//
// This module resolves paths and nothing else. Whether an absent store is acceptable is the
// caller's judgement and differs per caller.

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Thunks, not consts: `const X = process.env.Y || d` at module load defeats any override set after
// import, and this repo already carries three baselined M9 identities of that shape.
const env = (name) => process.env[name];

export const storeDir = () => env('CW_STORE_DIR') || join(REPO, '.claude', 'store');

export const touchLedger = () => env('CW_TOUCH_LEDGER') || join(storeDir(), 'touches.jsonl');
// The ONE tracked ledger, resolved with no env consulted. Every other export here is
// overridable on purpose; this one exists so a guard can ask "is this the real store?" and not
// be answered by the same override it is trying to police. Only touchAppender's temp-repo
// refusal reads it — see bin/lib/touch-ledger-append.mjs.
export const realTouchLedger = () => join(REPO, '.claude', 'store', 'touches.jsonl');
export const spineLedger = () => env('CW_SPINE_LEDGER') || join(storeDir(), 'spine-touches.jsonl');
export const agentTags = () => env('CW_AGENT_TAGS') || join(storeDir(), 'agent-tags.jsonl');
// Existing seam names, kept verbatim. Renaming them to match this module's vocabulary would orphan
// every test and harness that sets the old one.
export const gateBaseline = () => env('CW_RATCHET_BASELINE') || join(storeDir(), 'gate-baseline.json');
export const testsBaseline = () => env('CW_GATE_TESTS_BASELINE') || join(storeDir(), 'gate-tests-baseline.json');

export const allStores = () => ({
  touchLedger: touchLedger(),
  spineLedger: spineLedger(),
  agentTags: agentTags(),
  gateBaseline: gateBaseline(),
  testsBaseline: testsBaseline(),
});

// ── TREE IDENTITY ────────────────────────────────────────────────────────────────────────────────
//
// Ledger records store paths RELATIVE to their own REPO, and one store is shared by several
// checkouts — 1,893 of 4,019 rows measured 2026-08-29 came from a different one. So `bin/x.mjs`
// written elsewhere is indistinguishable from `bin/x.mjs` written here, and a reader repointed at
// the store without a discriminator blames the wrong session with full confidence. That is worse
// than the `unknown` it replaces: an honest grey becomes a false attribution.
//
// Identity first, repoint second. Never the other order.
//
// A hash, not the path: the store is shared and the path is the operator's filesystem layout.
export const treeId = (root = REPO) => createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12);

export const rowTree = (rec) => (typeof rec?.r === 'string' && rec.r ? rec.r : null);

/**
 * 'mine' | 'other' | 'unknown' — never a boolean.
 *
 * Rows written before this field existed carry no `r` and the information is unrecoverable. Reading
 * those as mine lets another tree's work be claimed; reading them as theirs blames someone innocent.
 */
export function treeClaim(rec, self = treeId()) {
  const r = rowTree(rec);
  if (r === null) return 'unknown';
  return r === self ? 'mine' : 'other';
}
