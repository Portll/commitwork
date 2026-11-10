// bin/lib/npm-audit-findings.mjs — advisory findings per (package, version) pair from an `npm
// audit` already summarised by npm-versions.mjs summariseAudit, for the local merge, which audits
// both sides anyway. The OSV lookup is the source when no audit has run.
//
// An audit row names a package and the advisory ranges that hit it; the pairs are that package's
// lockfile versions inside a range. A failed audit, or a range this cannot read, is an error on the
// pair, never "no advisories". Rows vulnerable only through another package carry no advisory of
// their own and add nothing.

import { pairKey } from './npm-graph.mjs';
import { satisfies } from './npm-versions.mjs';
import { severityOf } from './introduced-verdict.mjs';

const GHSA_RE = /\b(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})\b/i;
const idOf = (adv) => GHSA_RE.exec(adv.url || '')?.[1] || adv.url || adv.title || 'unnamed advisory';

/** The lock's versions of `name`, every location. */
function versionsOf(lock, name) {
  const out = new Set();
  for (const [loc, e] of Object.entries(lock?.packages || {})) {
    if (!loc.startsWith('node_modules/') && !loc.includes('/node_modules/')) continue;
    const n = e?.name || loc.slice(loc.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (n === name && typeof e?.version === 'string') out.add(e.version);
  }
  return [...out];
}

/** A lookup answering from one side's audit summary and lockfile: (pairs) → Promise<Map>. */
export function auditLookup(summary, lock) {
  const table = new Map();
  const unreadable = new Map();
  if (summary && !summary.error) {
    for (const row of summary.rows || []) {
      for (const adv of row.advisories || []) {
        for (const v of versionsOf(lock, row.name)) {
          const hit = satisfies(v, adv.range);
          const key = pairKey(row.name, v);
          if (hit === null) { unreadable.set(key, `the advisory range ${JSON.stringify(adv.range)} could not be read`); continue; }
          if (!hit) continue;
          const list = table.get(key) || [];
          list.push({ id: idOf(adv), aliases: [], severity: severityOf(adv.severity || row.severity), severitySource: 'npm-audit', summary: adv.title || '', url: adv.url || null });
          table.set(key, list);
        }
      }
    }
  }
  return async (pairs) => {
    const out = new Map();
    for (const p of pairs) {
      const key = pairKey(p.name, p.version);
      if (!summary || summary.error) out.set(key, { error: summary?.error || 'no npm audit for this side' });
      else if (unreadable.has(key)) out.set(key, { error: unreadable.get(key) });
      else out.set(key, { advisories: table.get(key) || [] });
    }
    return out;
  };
}
