// admin/routes/host.mjs — the Host section on /config: what THIS BOX listens on.
//
// An OBSERVATION, deliberately separate from /api/config's declared state — the two can disagree,
// and the disagreement is the point. Two tiers gated on isLoopbackReq: processes/pids/accounts are
// operator-port only. Strictly read-only.

import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inventory, publishedView, ownerOf } from '../../monitor/host-inventory.mjs';
import { disposition, DISPOSITION } from '../../monitor/nuclei-solve.mjs';
import { CW, registry } from '../lib/core.mjs';

// Cached briefly; the age is reported so freshness is visible.
const TTL_MS = 15_000;
let _cache = { at: 0, inv: null };

export function hostState({ nowMs = Date.now(), full = false } = {}) {
  if (!_cache.inv || (nowMs - _cache.at) > TTL_MS) {
    let inv;
    try { inv = inventory(); } catch (e) {
      // a thrown observation is UNKNOWN, never "nothing is listening"
      inv = { ok: false, reason: `the host observation failed (${e && e.message ? e.message.split('\n')[0] : e}) — listener state is UNKNOWN, not empty` };
    }
    _cache = { at: nowMs, inv };
  }
  const inv = _cache.inv;
  const body = full ? inv : publishedView(inv);
  return { ...body, observedAgeMs: nowMs - _cache.at, detail: full ? 'full' : 'redacted' };
}

// ── findings that belong to the BOX, not to a repo ───────────────────────────────────────────
// A DAST finding on a port the machine owns is a true detection about the wrong asset — surfaced
// here while the project view keeps a visible count. Read from the persisted nuclei-solved.jsonl
// sidecars, never re-solved live; no sidecars reads as "not adjudicated", not "nothing found".
function hostAttributed(inv, { limit = 500 } = {}) {
  const root = join(CW, (registry() || {}).reportsRoot || 'reports');
  if (!existsSync(root)) return { ok: false, reason: 'no reports root — nothing has been swept on this box' };
  const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  let batches;
  try { batches = readdirSync(root).filter((d) => d.startsWith('sweep-') && isDir(join(root, d))).sort().reverse(); }
  catch (e) { return { ok: false, reason: `the reports root could not be read (${e.code || 'error'}) — host findings are UNKNOWN` }; }

  const rows = new Map();       // keyed on place, never on the order a file happened to list them
  let sidecars = 0;
  for (const b of batches) {
    for (const repo of readdirSync(join(root, b))) {
      const f = join(root, b, repo, 'nuclei-solved.jsonl');
      if (!existsSync(f)) continue;
      sidecars++;
      let raw; try { raw = readFileSync(f, 'utf8'); } catch { continue; }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let s; try { s = JSON.parse(line); } catch { continue; }
        const owner = ownerOf(inv, { port: s.port, proto: s.proto === 'http' ? 'TCP' : 'UDP' });
        if (disposition(s, owner) !== DISPOSITION.HOST) continue;
        const k = `${s.templateId}|${s.port}|${s.proto}`;
        if (!rows.has(k)) {
          rows.set(k, { templateId: s.templateId, port: s.port, proto: s.proto, severity: s.severity,
            filedUnder: new Set(), batches: 0 });
        }
        const r = rows.get(k);
        r.filedUnder.add(repo);
        r.batches++;
      }
      if (rows.size >= limit) break;
    }
  }
  if (!sidecars) {
    return { ok: false, reason: 'no adjudicated sweep on this box yet — the solver writes nuclei-solved.jsonl per repo, and none exists, so host attribution has not been decided rather than decided empty' };
  }
  return {
    ok: true, sidecars,
    findings: [...rows.values()]
      .map((r) => ({ ...r, filedUnder: [...r.filedUnder].sort() }))
      .sort((a, b) => Number(a.port) - Number(b.port) || a.templateId.localeCompare(b.templateId)),
  };
}

export const routes = [{
  method: 'GET',
  path: '/api/host',
  handle: ({ send, isLoopbackReq }) => {
    const body = hostState({ full: !!isLoopbackReq });
    // attribution needs a live inventory to join against — a failed observation attributes nothing
    body.attributed = body.ok === true
      ? hostAttributed(_cache.inv)
      : { ok: false, reason: 'the host observation failed, so no finding can be attributed to this box' };
    return send(200, body);
  },
}];

export default routes;
