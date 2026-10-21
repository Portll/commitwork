// monitor/egress-suggest.mjs — turn the destinations lanes dial into a SUGGESTED allowlist.
// bin/commitwork.mjs writes <report dir>/egress-observed.json per networked lane when
// CW_EGRESS_OBSERVE is set; this reads every one under the reports root, aggregates per lane and
// host, and writes reports/egress/allowlist.suggested.json in the shape manifests/egress-allowlist.json
// takes, each entry's `why` stating the observation it rests on.


// DECLARATION SPLIT FROM AUTHORITY. The suggestion is written under reports/, never under
// manifests/. Promoting an entry is a person copying it, with the reason rewritten in their own
// words; a list this tool could apply would be one the lanes write for themselves.
//

//   node monitor/egress-suggest.mjs [--json]
//
// env (read at call time): CW_EGRESS_OBSERVED_ROOT (default the reports root, CW_REPORTS_ROOT), CW_EGRESS_SUGGEST_OUT
//   (default <root>/egress/allowlist.suggested.json), CW_NOW
// exit: 0 a suggestion is written · 2 no observation found, or one unreadable
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { writeAtomic } from './lockfile.mjs';
import { reportsRootFor } from './store-paths.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXIT = Object.freeze({ wrote: 0, nothing: 2 });
export const OBSERVED_FILE = 'egress-observed.json';
const SKIP = new Set(['node_modules', '.git', 'egress']);

export function findObserved(root) {
  const out = []; const failures = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT' && dir === root) return; failures.push({ path: relative(root, dir) || '.', why: e.code || 'ERROR' }); return; }
    for (const e of entries) {
      if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === OBSERVED_FILE) out.push(p);
    }
  };
  walk(root);
  return { files: out.sort(), failures };
}

/** Aggregate observation files into lanes → hosts. A file that does not parse is a failure, not an empty one. */
export function aggregate(files, root) {
  const lanes = new Map(); const failures = []; const unobserved = []; let runs = 0;
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { failures.push({ path: relative(root, f), why: `unreadable (${e.code || e.message})` }); continue; }
    const rows = Array.isArray(doc.lanes) ? doc.lanes : [doc];
    for (const row of rows) {
      if (row && typeof row.check === 'string' && typeof row.unobserved === 'string') { unobserved.push({ check: row.check, why: row.unobserved }); continue; }
      if (!row || typeof row.check !== 'string' || !Array.isArray(row.destinations)) { failures.push({ path: relative(root, f), why: 'not an observation (no check/destinations)' }); continue; }
      runs++;
      const lane = lanes.get(row.check) || { check: row.check, egress: row.egress || null, runs: 0, hosts: new Map() };
      lane.runs++;
      for (const d of row.destinations) {
        const key = `${d.host}:${d.port}`;
        const h = lane.hosts.get(key) || { host: d.host, port: d.port, allowed: 0, denied: 0, local: 0, runs: 0, firstSeen: row.at || null, lastSeen: row.at || null };
        h.allowed += d.allowed || 0; h.denied += d.denied || 0; h.local += d.local || 0; h.runs++;
        if (row.at) { if (!h.firstSeen || row.at < h.firstSeen) h.firstSeen = row.at; if (!h.lastSeen || row.at > h.lastSeen) h.lastSeen = row.at; }
        lane.hosts.set(key, h);
      }
      lanes.set(row.check, lane);
    }
  }
  const out = [...lanes.values()].sort((a, b) => a.check.localeCompare(b.check)).map((l) => ({
    check: l.check, egress: l.egress, runs: l.runs,
    hosts: [...l.hosts.values()].sort((a, b) => a.host.localeCompare(b.host) || a.port - b.port),
  }));
  return { lanes: out, runs, failures, unobserved };
}

const why = (l, h) => `SUGGESTED, not reviewed: ${l.check} (egress ${l.egress || 'undeclared'}) asked for ${h.host}:${h.port} ${h.allowed + h.denied} time(s) in ${h.runs} of ${l.runs} observed run(s)${h.firstSeen ? ` between ${h.firstSeen} and ${h.lastSeen}` : ''}. Rewrite this reason in your own words before copying the entry.`;

export function suggestion(agg, now) {
  return {
    generated: now,
    note: 'Written by monitor/egress-suggest.mjs from reports/**/egress-observed.json. Coverage is proxy-honouring clients only. Nothing applies this file: copy an entry into manifests/egress-allowlist.json by hand, with its reason rewritten.',
    coverage: 'proxy-honouring clients only',
    // a local destination is refused by the proxy in every mode and is never a suggestion
    lanes: Object.fromEntries(agg.lanes.map((l) => [l.check, { egress: l.egress, runs: l.runs, allow: l.hosts.filter((h) => !h.local).map((h) => ({ host: h.host, port: h.port, why: why(l, h) })),
      ...(l.hosts.some((h) => h.local) ? { refusedLocal: l.hosts.filter((h) => h.local).map((h) => `${h.host}:${h.port}`) } : {}) }])),
  };
}

export function runSuggest({ env = process.env } = {}) {
  const now = nowISO(env);
  const root = resolve(env.CW_EGRESS_OBSERVED_ROOT || reportsRootFor(CW));
  const out = env.CW_EGRESS_SUGGEST_OUT || join(root, 'egress', 'allowlist.suggested.json');
  const found = findObserved(root);
  const agg = aggregate(found.files, root);
  const failures = [...found.failures, ...agg.failures];
  const doc = suggestion(agg, now);
  const wrote = agg.lanes.length > 0;
  if (wrote) writeAtomic(out, `${JSON.stringify(doc, null, 2)}\n`, { mkdir: true });
  return { generated: now, root, out: wrote ? out : null, files: found.files.length, runs: agg.runs, lanes: agg.lanes.length, hosts: agg.lanes.reduce((n, l) => n + l.hosts.length, 0), failures, unobserved: agg.unobserved, suggestion: doc };
}

export const exitCodeFor = (r) => (r.lanes === 0 || r.failures.length ? EXIT.nothing : EXIT.wrote);

if (isMainModule(import.meta.url)) {
  const r = runSuggest();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...r, suggestion: undefined }, null, 2));
  else {
    console.log(`egress-suggest: ${r.files} observation file(s), ${r.runs} run(s), ${r.lanes} lane(s), ${r.hosts} host(s)${r.out ? ` → ${r.out}` : ''}`);
    for (const [check, l] of Object.entries(r.suggestion.lanes)) console.log(`  ${check.padEnd(28)} ${l.allow.length} host(s) over ${l.runs} run(s): ${l.allow.map((a) => `${a.host}:${a.port}`).join(', ')}`);
    for (const f of r.failures) console.log(`  unreadable: ${f.path} — ${f.why}`);
    for (const u of r.unobserved) console.log(`  unobserved: ${u.check} — ${u.why}`);
    if (!r.lanes) console.log('  nothing observed: run a sweep with CW_EGRESS_OBSERVE=1 first; an empty suggestion is not written');
  }
  process.exitCode = exitCodeFor(r);
}
