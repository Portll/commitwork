// admin/routes/secrets.mjs — the secrets store, PRESENCE ONLY: no value is ever read or returned,
// not even redacted. Joins each name with the checks it blocks when unresolvable.
// Absence has three distinct flavours, never merged: undeclared (no ref), unresolvable (ref
// lookup failed), overridden (env var shadowing).

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { status } from '../../lib/secrets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const MANIFESTS = join(CW, 'manifests');

/** Every secret name a bundled manifest demands -> the checks demanding it. Read from the manifests, never a hand-kept list. */
function demandedBy() {
  const out = new Map();
  let files = [];
  try { files = readdirSync(MANIFESTS).filter((f) => f.endsWith('.json')); }
  catch { return out; }   // no manifests dir is a legitimate state; an unreadable one yields nothing
  for (const f of files) {
    let m;
    try { m = JSON.parse(readFileSync(join(MANIFESTS, f), 'utf8')); } catch { continue; }
    for (const c of m.checks || []) {
      for (const name of c.requires?.secrets || []) {
        if (!out.has(name)) out.set(name, []);
        out.get(name).push({ check: c.id, manifest: f.replace(/\.json$/, '') });
      }
    }
  }
  return out;
}

export const routes = [{
  method: 'GET',
  path: '/api/secrets',
  handle: ({ send, adminSession, req }) => {
    // session-gated — the ref table names which credentials this box holds, which is reconnaissance.
    // FAIL CLOSED: a ctx with no session function, or a session naming no user, is not signed in.
    const s = typeof adminSession === 'function' ? adminSession(req) : null;
    if (!s || !s.user) return send(401, { error: 'not signed in' });

    const demand = demandedBy();
    let rows = [];
    let storeError = null;
    try { rows = status(); }
    catch (e) {
      // FAIL CLOSED: an unreadable ref table is not "no secrets"
      storeError = e.message;
    }

    const declared = new Set(rows.map((r) => r.name));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    // demanded but never declared — the row status() alone cannot produce. With the table unreadable
    // nothing is known to be declared or not, so those rows are undetermined, never undeclared.
    const undeclared = [...demand.keys()].filter((n) => !declared.has(n)).map((name) => (storeError
      ? { name, ref: null, declared: null, resolvable: null, reason: 'undetermined',
        detail: 'the ref table could not be read — whether a ref is recorded is unknown', blocks: demand.get(name) || [] }
      : { name, ref: null, declared: false, resolvable: false, reason: 'undeclared',
        detail: 'no ref recorded — nothing says where this credential lives', blocks: demand.get(name) || [] }));

    const enriched = rows.map((r) => ({ ...r, blocks: demand.get(r.name) || [] }));
    const all = [...enriched, ...undeclared];

    send(200, {
      generated: new Date().toISOString(),
      storeError,                                   // non-null ⇒ the page must say so, not show zero
      // counts stated separately so a renderer cannot collapse the three absence states
      counts: storeError
        ? { total: all.length, resolvable: null, unresolvable: null, undeclared: null, undetermined: undeclared.length, overridden: null }
        : {
          total: all.length,
          resolvable: all.filter((r) => r.resolvable).length,
          unresolvable: all.filter((r) => r.declared && !r.resolvable).length,
          undeclared: undeclared.length,
          overridden: all.filter((r) => r.envOverride).length,
        },
      // Blocked lanes, deduped — what an operator actually acts on. Unknown while the table is unreadable.
      blockedChecks: storeError
        ? null
        : [...new Set(all.filter((r) => !r.resolvable).flatMap((r) => (r.blocks || []).map((b) => b.check)))].sort(),
      secrets: all.sort((a, b) => Number(b.declared) - Number(a.declared) || a.name.localeCompare(b.name)),
      note: 'Presence only. No credential value is read, returned or logged by this route — lib/secrets.mjs has no getter, by design.',
    });
  },
}];
