// store-paths — where every durable store lives, and which working tree a record came from.
//
// One declaration, so a writer and its readers cannot drift apart: a reader whose default names an
// absent file does not error, it reports every file `unknown`, re-arms a floor or goes grey. Add a
// new store here, not next to its reader.
//
// This module resolves paths and nothing else. Whether an absent store is acceptable is the
// caller's judgement and differs per caller.

import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateBaseFor } from '../../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Thunks, not consts: `const X = process.env.Y || d` at module load defeats any override set after
// import.
const env = (name) => process.env[name];

// An installed tree keeps it under its state root (monitor/store-paths.mjs stateBaseFor).
export const storeDir = () => env('CW_STORE_DIR') || join(stateBaseFor(REPO), '.claude', 'store');

export const touchLedger = () => env('CW_TOUCH_LEDGER') || join(storeDir(), 'touches.jsonl');
// The ONE tracked ledger, resolved with neither CW_STORE_DIR nor CW_TOUCH_LEDGER consulted. Every
// other export here is overridable on purpose; this one exists so a guard can ask "is this the real
// store?" and not be answered by the same override it is trying to police. Only touchAppender's
// temp-repo refusal reads it — see bin/lib/touch-ledger-append.mjs.
export const realTouchLedger = () => join(stateBaseFor(REPO), '.claude', 'store', 'touches.jsonl');
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
// checkouts. So `bin/x.mjs` written elsewhere is indistinguishable from `bin/x.mjs` written here,
// and a reader repointed at the store without a discriminator blames the wrong session with full
// confidence: an honest grey becomes a false attribution.
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
