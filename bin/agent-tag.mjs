#!/usr/bin/env node
// Designate a remediation agent: TYPE-NNN-context, e.g. OPUS5-007-secrets. TYPE is UNKNOWN when
// undeclared (never guessed); NNN is launch order, never reused; context is what it was pointed
// at. Lands in claim.by and must classify as machine in attribution.mjs.
//
// usage:
//   node bin/agent-tag.mjs --type opus5 --context secrets     allocate (prints the tag)
//   node bin/agent-tag.mjs --resolve OPUS5-007-secrets        full provenance for one tag
//   node bin/agent-tag.mjs --list                             the launch roster, newest first
//   node bin/agent-tag.mjs --verify [--json]                  the roster's hash chain (exit 1 broken)
//
// Rows are hash-chained by bin/lib/touch-chain.mjs, the touch ledger's primitive. Rows written
// before the chain carry no `prev` and verify as `unchained` — counted, never passed as verified.

import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../monitor/lockfile.mjs';
import { chainedAppendHeld, verifyLedgerChain } from './lib/touch-chain.mjs';
import { ledgerLockPath } from './lib/ledger-rotate.mjs';
import { agentTags } from './lib/store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = () => agentTags();

/** Declared LM types. Anything else is UNKNOWN — this list is the declaration, not a guess table. */
export const LM_TYPES = Object.freeze({
  opus5: 'OPUS5', 'claude-opus-5': 'OPUS5',
  sonnet5: 'SONNET5', 'claude-sonnet-5': 'SONNET5',
  haiku45: 'HAIKU45', 'claude-haiku-4-5': 'HAIKU45', 'claude-haiku-4-5-20251001': 'HAIKU45',
  fable5: 'FABLE5', 'claude-fable-5': 'FABLE5',
});

export const TAG_RE = /^(?<type>[A-Z0-9]{2,12})-(?<n>\d{3,6})-(?<context>[a-z0-9][a-z0-9-]{0,31})$/;

/** Normalise an LM identifier to a tag TYPE. Unknown/absent is UNKNOWN, loudly and on purpose. */
export const lmType = (m) => LM_TYPES[String(m || '').toLowerCase().trim()] || 'UNKNOWN';

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

/** Every allocation ever made here, oldest first. */
export function roster() {
  let raw = '';
  try { raw = readFileSync(registryPath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return []; throw new Error(`agent-tag registry ${registryPath()} unreadable (${e.code}) — refusing to treat it as empty`); }
  const out = [];
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue;
    try { const { prev, ...rec } = JSON.parse(l); out.push(rec); } catch { /* a torn tail line is not a reason to lose the rest */ }
  }
  return out;
}

/** Allocate the next tag. Atomic under the shared lockfile — two same-millisecond launches must not both get 007. */
export function allocate({ model, context, sessionId = null, pid = process.pid, at = null } = {}) {
  const type = lmType(model);
  const ctx = slug(context) || 'general';
  const stamp = at || (process.env.CW_NOW ? new Date(process.env.CW_NOW).toISOString() : new Date().toISOString());

  mkdirSync(dirname(registryPath()), { recursive: true });
  const held = acquireLock(ledgerLockPath(registryPath()), { label: 'agent-tag', attempts: 50, spinMs: 20, staleMs: 30_000 });
  if (!held.ok) throw new Error('agent-tag: could not acquire the allocation lock — refusing to mint a number that may already be taken');
  try {
    // Monotonic over the whole roster, not per type — launch order is the fact recorded
    const next = roster().reduce((m, r) => Math.max(m, Number(r.n) || 0), 0) + 1;
    const rec = { tag: `${type}-${String(next).padStart(3, '0')}-${ctx}`, type, n: next, context: ctx, sessionId, pid, launchedAt: stamp };
    // Never rotated: roster() numbers from the live file alone, so a rotation would restart at 001.
    const w = chainedAppendHeld(registryPath(), rec, { maxBytes: Infinity });
    if (!w.ok) throw new Error(`agent-tag: registry append failed (${w.error}) — ${rec.tag} was not recorded`);
    return rec;
  } finally { held.release(); }
}

/**
 * The roster's chain verdict. A rewritten or removed row breaks its successor's link
 * (`chain-broken`); a rewritten LAST row is out of the chain's reach and is what the off-box
 * witness (bin/anchor-witness.mjs) bounds. Throws on anything but ENOENT.
 */
export const verifyRoster = () => verifyLedgerChain(registryPath());

/** Parse a tag without consulting the registry — the point of a self-describing name. */
export function parseTag(tag) {
  const m = TAG_RE.exec(String(tag || ''));
  return m ? { type: m.groups.type, n: Number(m.groups.n), context: m.groups.context } : null;
}

/** Full provenance for a tag, or null. Falls back to the parsed name when the registry is absent. */
export function resolveTag(tag) {
  const rec = roster().find((r) => r.tag === tag);
  return rec || (parseTag(tag) ? { tag, ...parseTag(tag), launchedAt: null, sessionId: null, pid: null, registered: false } : null);
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes('--list')) {
    const all = roster().reverse();
    if (!all.length) { process.stderr.write(`no agents allocated yet (${registryPath()})\n`); process.exit(1); }
    for (const r of all) process.stdout.write(`${r.tag.padEnd(28)}  ${r.launchedAt}  pid=${r.pid ?? '?'}  session=${(r.sessionId || '-').slice(0, 8)}\n`);
    process.exit(0);
  }
  if (argv.includes('--verify')) {
    let r;
    try { r = verifyRoster(); } catch (e) {
      process.stderr.write(`agent-tag: registry UNREADABLE (${e.code || e.message}) — not verified\n`);
      process.exit(2);
    }
    if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    else {
      const t = r.totals;
      process.stdout.write(`agent-tag chain: ${r.state}  (${registryPath()})\n`
        + `  examined ${t.examined} — verified ${t.verified}, unchained ${t.unchained} (pre-chain, unverifiable), `
        + `unlinked ${t.unlinked}, raced ${t.raced}, broken ${t.broken}, torn ${t.torn}\n`);
      for (const b of r.breaks) process.stdout.write(`  BREAK at row ${b.line} — ${b.why}\n`);
    }
    process.exit(r.state === 'chain-broken' || r.state === 'torn' ? 1 : r.state === 'absent' ? 2 : 0);
  }
  const res = flag('--resolve');
  if (res) { const r = resolveTag(res); process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); process.exit(r ? 0 : 1); }
  const model = flag('--type') || process.env.CW_AGENT_MODEL;
  const context = flag('--context');
  if (!context) { process.stderr.write('usage: agent-tag.mjs --type <lm> --context <area|check|class>  [--session <id>]\n'); process.exit(2); }
  process.stdout.write(`${allocate({ model, context, sessionId: flag('--session') }).tag}\n`);
}
