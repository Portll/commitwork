#!/usr/bin/env node
// bin/memory-layer-migrate-tenant.mjs — consolidate memory-layer memories onto one tenant, and normalise scope tags.
//
// Order is the safety (memory-layer has no transaction): write the copy, verify by content-hash
// read-back, only then delete the original — a record must never exist in NEITHER place.
// Idempotent: identity is external_id; a record without one gets a deterministic id
// derived from content, never from the clock.
//
// usage:
//   node bin/memory-layer-migrate-tenant.mjs                 # DRY RUN — reports, writes nothing
//   node bin/memory-layer-migrate-tenant.mjs --apply         # write + verify + delete
//   node bin/memory-layer-migrate-tenant.mjs --apply --keep  # write + verify, leave originals in place
//   --from a,b   source tenants (default: claude-code,internal-d)
//   --to x       destination tenant (default: portll)
//   --limit N    stop after N records (rehearsal)
//
// exit: 0 all accounted for · 1 something did not verify · 2 bad usage / unreachable

import { createHash } from 'node:crypto';
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credential, config, health, sha256 } from '../lib/memory-layer-client.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true);
};
const APPLY = argv.includes('--apply');
const KEEP = argv.includes('--keep');
const FROM = String(flag('from', 'claude-code,internal-d')).split(',').map((s) => s.trim()).filter(Boolean);
const TO = String(flag('to', 'portll'));
const LIMIT = Number(flag('limit', 0)) || 0;

const cfg = config({});
const cred = credential({});
if (!cred.ok) { console.error('[migrate] VELD_API_KEY unresolvable — this is a configuration failure on this box.'); process.exit(2); }
const H = { 'Content-Type': 'application/json', 'X-API-Key': cred.key };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${cfg.url}${path}`, {
    method, headers: H,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* shape not load-bearing */ }
  return { ok: res.ok, status: res.status, json };
}

/** Deterministic external_id: `name:` frontmatter first (stable across edits), else a content hash. */
function deriveExternalId(content) {
  const m = /^name:\s*([A-Za-z0-9._-]{1,80})/m.exec(String(content || ''));
  if (m) return `migrated:name:${m[1]}`;
  return `migrated:sha256:${sha256(content).slice(0, 32)}`;
}

/** Lowercase every memory-layer-project: tag. The two clients disagreed on case and tag matching is exact. */
function normaliseTags(tags) {
  const out = (tags || []).map((t) => (t.startsWith('memory-layer-project:')
    ? `memory-layer-project:${t.slice('memory-layer-project:'.length).toLowerCase()}`
    : t));
  return [...new Set(out)].sort();
}

async function listTenant(user) {
  const r = await api('/api/memories', { body: { user_id: user, limit: 1000, offset: 0 } });
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, ids: null };
  const ms = r.json?.memories || r.json?.results || [];
  // created_at only comes from the LIST (GET-by-id lacks it); it decides identity collisions.
  return { ok: true, reason: null, ids: ms.map((m) => ({ id: m.id, created_at: m.created_at || null })) };
}

/** LIST omits external_id and trims the record; only GET by id carries the full shape. */
async function fetchFull(user, id) {
  const r = await api(`/api/memory/${encodeURIComponent(id)}?user_id=${encodeURIComponent(user)}`, { method: 'GET' });
  if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, rec: null };
  const j = r.json || {};
  const e = j.experience || {};
  const content = e.content;
  if (typeof content !== 'string' || !content) return { ok: false, reason: 'no experience.content', rec: null };
  return {
    ok: true,
    reason: null,
    rec: {
      id,
      content,
      tags: e.tags || j.tags || [],
      memory_type: e.experience_type || j.memory_type || 'Observation',
      external_id: j.external_id || e.external_id || null,
    },
  };
}

const receipts = [];
let moved = 0, already = 0, failed = 0, deleted = 0, kept = 0, superseded = 0, normalised = 0;

// ── --normalise: fix tag casing on records ALREADY in the destination ────────
// Tags are only settable via /api/upsert (keys on external_id); a record without one is
// reported, never silently skipped.
if (argv.includes('--normalise') || argv.includes('--normalize')) {
  const list = await listTenant(TO);
  if (!list.ok) { console.error(`[migrate] cannot list ${TO}: ${list.reason}`); process.exit(2); }
  console.log(`[migrate] normalising tag case in ${TO} (${list.ids.length} records)${APPLY ? '' : ' — DRY RUN'}`);
  for (const { id } of list.ids) {
    const got = await fetchFull(TO, id);
    if (!got.ok) { receipts.push({ from: TO, id, state: 'failed', reason: `unreadable: ${got.reason}` }); failed++; continue; }
    const before = got.rec.tags || [];
    const after = normaliseTags(before);
    if (JSON.stringify([...before].sort()) === JSON.stringify(after)) continue;
    if (!got.rec.external_id) {
      console.log(`  ${id.slice(0, 8)} has mixed-case tags but NO external_id — cannot rewrite`);
      receipts.push({ from: TO, id, state: 'failed', reason: 'no external_id; only /api/upsert sets tags and it keys on one' });
      failed++;
      continue;
    }
    if (!APPLY) { receipts.push({ from: TO, id, external_id: got.rec.external_id, state: 'dry-run-normalise', reason: `${before.filter((t) => t !== t.toLowerCase() && t.startsWith('memory-layer-project:')).join(',')} -> lowercase` }); normalised++; continue; }
    const w = await api('/api/upsert', { body: { user_id: TO, content: got.rec.content, memory_type: got.rec.memory_type, tags: after, external_id: got.rec.external_id } });
    // Verify: the rewrite must not have altered the content it carried through.
    const back = w.ok && w.json?.id ? await fetchFull(TO, w.json.id) : { ok: false, reason: `write HTTP ${w.status}` };
    const ok = back.ok && sha256(back.rec.content) === sha256(got.rec.content);
    receipts.push({ from: TO, id, external_id: got.rec.external_id, state: ok ? 'normalised' : 'failed', reason: ok ? null : (back.reason || 'content changed during tag rewrite') });
    if (ok) normalised++; else failed++;
    await sleep(120);
  }
  const dir = join(CW, 'reports', 'memory-layer-migration');
  try { mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  writeFileSync(join(dir, APPLY ? 'normalise-tags.json' : 'normalise-tags.dry-run.json'),
    `${JSON.stringify({ generated: process.env.CW_NOW || new Date().toISOString(), tenant: TO, mode: APPLY ? 'apply' : 'dry-run', normalised, failed, receipts }, null, 2)}\n`);
  console.log(`[migrate] ${APPLY ? 'normalised' : 'would normalise'} ${normalised} record(s), ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ── Pass 1: read everything, and settle collisions BEFORE writing anything ───
// Same external_id in two tenants is one record written twice; newest wins, decided here
// so the result never depends on API return order.
const candidates = [];
for (const from of FROM) {
  if (from === TO) { console.log(`[migrate] ${from} is the destination — skipping`); continue; }
  const list = await listTenant(from);
  if (!list.ok) { console.error(`[migrate] cannot list ${from}: ${list.reason} — REFUSING to proceed for this tenant`); failed++; continue; }
  console.log(`[migrate] ${from}: ${list.ids.length} record(s)${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  for (const { id, created_at } of (LIMIT ? list.ids.slice(0, LIMIT) : list.ids)) {
    const got = await fetchFull(from, id);
    if (!got.ok) {
      // Cannot read it => cannot copy it => MUST NOT delete it.
      console.log(`  ${id.slice(0, 8)} UNREADABLE (${got.reason}) — left in place`);
      receipts.push({ from, id, state: 'failed', reason: `unreadable: ${got.reason}` });
      failed++;
      continue;
    }
    candidates.push({ from, id, created_at, rec: got.rec, externalId: got.rec.external_id || deriveExternalId(got.rec.content) });
  }
}

const byIdentity = new Map();
for (const c of candidates) {
  const prev = byIdentity.get(c.externalId);
  // Newest created_at wins; missing stamp loses; ties keep the first seen (deterministic).
  if (!prev || String(c.created_at || '') > String(prev.created_at || '')) byIdentity.set(c.externalId, c);
}
const losers = candidates.filter((c) => byIdentity.get(c.externalId) !== c);
if (losers.length) {
  console.log(`[migrate] ${losers.length} record(s) share an identity with a newer copy — the newer one is written,`);
  console.log('          and the older is deleted ONLY after that newer copy verifies.');
}

for (const winner of byIdentity.values()) {
  {
    const { from, id, rec } = winner;
    const externalId = winner.externalId;
    const tags = normaliseTags([...rec.tags, `migrated-from:${from}`]);
    const contentSha = sha256(rec.content);

    if (!APPLY) {
      receipts.push({
        from, id, external_id: externalId, derived: !rec.external_id,
        tagsBefore: rec.tags.length, tagsAfter: tags.length,
        bytes: Buffer.byteLength(rec.content), state: 'dry-run', reason: null,
      });
      moved++;
      // Report would-be superseded so dry-run totals reconcile with source counts.
      for (const l of losers.filter((x) => x.externalId === externalId)) {
        receipts.push({
          from: l.from, id: l.id, external_id: externalId, state: 'dry-run-superseded',
          reason: `older copy; ${from}/${id.slice(0, 8)} (${winner.created_at || 'no stamp'}) is newer and would win`,
        });
        superseded++;
      }
      continue;
    }

    // 1. WRITE
    const w = await api('/api/upsert', {
      body: { user_id: TO, content: rec.content, memory_type: rec.memory_type, tags, external_id: externalId },
    });
    if (!w.ok || !w.json?.id) {
      console.log(`  ${id.slice(0, 8)} write failed (HTTP ${w.status}) — original left in place`);
      receipts.push({ from, id, external_id: externalId, state: 'failed', reason: `write HTTP ${w.status}` });
      failed++;
      await sleep(120);
      continue;
    }
    const newId = w.json.id;
    if (w.json.was_update === true) already++;

    // 2. VERIFY — by id, comparing content only; memory-layer mints its own tags, so the stored set is a superset.
    const back = await fetchFull(TO, newId);
    const verified = back.ok && sha256(back.rec.content) === contentSha;
    if (!verified) {
      console.log(`  ${id.slice(0, 8)} -> ${newId.slice(0, 8)} NOT VERIFIED (${back.ok ? 'content mismatch' : back.reason}) — original left in place`);
      receipts.push({ from, id, newId, external_id: externalId, state: 'accepted-unverified', reason: back.ok ? 'content mismatch' : back.reason });
      failed++;
      await sleep(120);
      continue;
    }

    // 3. DELETE — only now, and only if asked.
    let delState = 'kept';
    let delReason = '--keep: original deliberately retained';
    if (!KEEP) {
      // user_id is a query param here; a header is rejected with 400.
      const d = await api(`/api/forget/${encodeURIComponent(id)}?user_id=${encodeURIComponent(from)}`, { method: 'DELETE' });
      if (d.ok) { delState = 'deleted'; delReason = null; deleted++; }
      else { delState = 'copy-verified-original-remains'; delReason = `delete HTTP ${d.status}`; }
    } else kept++;

    receipts.push({
      from, id, newId, external_id: externalId, derived: !rec.external_id,
      contentSha256: contentSha, was_update: w.json.was_update,
      tagsBefore: rec.tags.length, tagsAfter: tags.length,
      state: 'verified', delete: delState, reason: delReason,
    });
    moved++;

    // Superseded copies delete only after the winner is written, read back, and content-matched.
    if (delState === 'deleted' || KEEP) {
      for (const l of losers.filter((x) => x.externalId === externalId)) {
        if (KEEP) {
          receipts.push({ from: l.from, id: l.id, external_id: externalId, state: 'superseded', delete: 'kept', reason: '--keep: older copy retained' });
          kept++;
          continue;
        }
        const d = await api(`/api/forget/${encodeURIComponent(l.id)}?user_id=${encodeURIComponent(l.from)}`, { method: 'DELETE' });
        receipts.push({
          from: l.from, id: l.id, external_id: externalId, state: 'superseded',
          delete: d.ok ? 'deleted' : 'remains', reason: d.ok ? `older copy of ${externalId}; winner ${newId} verified first` : `delete HTTP ${d.status}`,
        });
        if (d.ok) { deleted++; superseded++; } else failed++;
        await sleep(120);
      }
    }
    await sleep(120); // stay under the rate limiter
  }
}

// Receipts are the evidence this ran and what it touched. Atomic (tmp+rename).
const outDir = join(CW, 'reports', 'memory-layer-migration');
try { mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
const dest = join(outDir, APPLY ? 'migrate-tenant.json' : 'migrate-tenant.dry-run.json');
const payload = {
  generated: process.env.CW_NOW || new Date().toISOString(),
  mode: APPLY ? (KEEP ? 'apply --keep' : 'apply') : 'dry-run',
  from: FROM, to: TO, limit: LIMIT || null,
  totals: { moved, alreadyPresent: already, superseded, deleted, kept, failed, total: receipts.length },
  receipts,
};
try {
  writeAtomic(dest, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[migrate] receipts -> ${dest}`);
} catch (e) { console.error(`[migrate] could not write receipts: ${e.message}`); }

const verb = APPLY ? 'migrated' : 'would migrate';
console.log(`[migrate] ${verb} ${moved} identit${moved === 1 ? 'y' : 'ies'}`
  + `${already ? `, ${already} already present (updated)` : ''}`
  + `${superseded ? `, ${superseded} older duplicate(s) superseded` : ''}`
  + `, ${deleted} deleted, ${kept} kept, ${failed} failed  ${FROM.join('+')} -> ${TO}`);
if (failed) {
  console.error('[migrate] Some records did not verify. Their ORIGINALS ARE INTACT — nothing was deleted');
  console.error('  that had not been read back and matched. Re-run to retry; it is idempotent.');
}
process.exit(failed ? 1 : 0);
