// bin/lib/osv-advisories.mjs — advisory findings for (package, version) pairs from OSV: one
// querybatch for the ids, then each id's record for its severity. Only package names, versions and
// advisory ids are sent.
//
// Returns Map pairKey → { advisories: [{ id, aliases, severity, severitySource, summary, url }] } | { error }.
// A batch that fails or answers out of shape is an error on every pair in it, never "no advisories".
// A record that cannot be read keeps its id with severity unknown (severitySource `unread`).
//
// env, read at call time: CW_OSV_URL (default https://api.osv.dev).

import { pairKey } from './npm-graph.mjs';
import { gradeOf } from '../vendor-scan.mjs';
import { mapLimit } from './npm-versions.mjs';
import { severityOf } from './introduced-verdict.mjs';

export const OSV_ECOSYSTEM = Object.freeze({ npm: 'npm', cargo: 'crates.io', go: 'Go', pypi: 'PyPI', maven: 'Maven', rubygems: 'RubyGems', nuget: 'NuGet', packagist: 'Packagist' });
const BATCH = 1000;
const TIMEOUT_MS = 60_000;
const osvBase = () => (process.env.CW_OSV_URL || 'https://api.osv.dev').replace(/\/+$/, '');

async function json(fetchImpl, url, init) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OSV answered ${res.status}`);
  return res.json();
}

async function queryIds(fetchImpl, base, eco, pairs, out) {
  const ids = new Map();
  for (let i = 0; i < pairs.length; i += BATCH) {
    const slice = pairs.slice(i, i + BATCH);
    const fail = (why) => { for (const p of slice) out.set(pairKey(p.name, p.version), { error: why }); };
    let j;
    try {
      j = await json(fetchImpl, `${base}/v1/querybatch`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queries: slice.map((p) => ({ package: { name: p.name, ecosystem: eco }, version: p.version })) }) });
    } catch (e) { fail(`OSV querybatch failed: ${e.message}`); continue; }
    if (!Array.isArray(j?.results) || j.results.length !== slice.length) { fail('OSV querybatch answered without one result per query'); continue; }
    slice.forEach((p, k) => {
      const r = j.results[k];
      const key = pairKey(p.name, p.version);
      if (r?.next_page_token) { out.set(key, { error: 'OSV paged this result, and the further pages were not read' }); return; }
      if (r?.vulns !== undefined && !Array.isArray(r.vulns)) { out.set(key, { error: 'OSV answered this query out of shape' }); return; }
      ids.set(key, (r?.vulns || []).map((v) => v.id).filter(Boolean));
    });
  }
  return ids;
}

function advisoryOf(id, rec) {
  if (!rec) return { id, aliases: [], severity: 'unknown', severitySource: 'unread', summary: '', url: `https://osv.dev/vulnerability/${id}` };
  const g = gradeOf(rec);
  return { id, aliases: Array.isArray(rec.aliases) ? rec.aliases : [], severity: severityOf(g.severity), severitySource: g.severity === 'undetermined' ? 'unrated' : g.severitySource,
    summary: String(rec.summary || '').slice(0, 200), url: `https://osv.dev/vulnerability/${id}`, withdrawn: !!rec.withdrawn };
}

/** A lookup over OSV for one ecosystem: (pairs) → Promise<Map>. `fetchImpl` is injected by tests. */
export function osvLookup({ ecosystem = 'npm', fetchImpl = globalThis.fetch } = {}) {
  return async (pairs) => {
    const out = new Map();
    const eco = OSV_ECOSYSTEM[ecosystem];
    if (!eco) { for (const p of pairs) out.set(pairKey(p.name, p.version), { error: `no OSV ecosystem for ${ecosystem}` }); return out; }
    const base = osvBase();
    const unique = [...new Map(pairs.map((p) => [pairKey(p.name, p.version), p])).values()];
    const ids = await queryIds(fetchImpl, base, eco, unique, out);
    const allIds = [...new Set([...ids.values()].flat())].sort();
    const recs = await mapLimit(allIds, 6, async (id) => {
      try { return await json(fetchImpl, `${base}/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' }); } catch { return null; }
    });
    const byId = new Map(allIds.map((id, i) => [id, advisoryOf(id, recs[i])]));
    for (const [key, list] of ids) out.set(key, { advisories: list.map((id) => byId.get(id)).filter((a) => !a.withdrawn).map(({ withdrawn, ...a }) => a) });
    return out;
  };
}
