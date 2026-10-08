#!/usr/bin/env node
// commitwork monitor — documentation backfill for v0 slices (evaluations/archive/PLAN-slices.md S12, doc-derived subset).
// v0 slices carry findings but no scope/toolRuns, so the fleet grid can't tell "scanned clean"
// from "not scanned". Their source report dirs still exist and DOCUMENT per-repo coverage
// (osv.sarif / npm-audit.json / checks-status.json per repo). This derives that coverage into
// append-only enrichment sidecars: history/enrichment/<stamp>-backfill.json.
// v0 slice files and index.json are NEVER rewritten (honesty over invention) — a repo is only
// backfilled as "documented clean" when its artifacts PARSE and yield zero findings with the same
// parsers rollup.mjs uses; an artifact that is present but unreadable makes the repo `void`, never
// clean — failing to parse is not parsing to zero. A doc/slice disagreement is a recorded mismatch.
// usage: node monitor/backfill-docs.mjs            (reads the registry OUT, or CW_MONITOR_OUT)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { outDirFor } from './area.mjs'; // THE OUT resolver: CW_MONITOR_OUT, then the area's out
import { loadRegistry } from './registry.mjs'; // the ONE validated loader — never a raw parse
import { readSarif, ruleIndex } from './sarif-read.mjs'; // the one SARIF reader

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
// The thirteenth and last swallowing registry parse. A bare `catch {}` here turned a malformed
// registry into `{ reportsRoot: 'reports' }`, which is not an error state — it is a plausible
// DEFAULT. outDirFor(null, REG) then resolved to the wrong directory and this tool wrote a project's
// history into whatever the fallback happened to name, reporting success.
//
// FAIL LOUD, despite being a backfill. Two reasons: it writes into a persistent history store keyed
// by the resolved area, so a wrong resolution strands data under another project's name rather than
// merely producing a thin report; and the fallback is silently PLAUSIBLE, which is worse than an
// obviously empty one — nothing downstream can tell a real 'reports' root from a guessed one.
const REG = loadRegistry();
const OUT = outDirFor(null, REG);
const histDir = join(OUT, 'history');
const enrichDir = join(histDir, 'enrichment');

// ---------- CVE extractors — mirror rollup.mjs (count-only use; keep in sync) ----------
const sevFromCvss = (c) => (c >= 9 ? 'crit' : c >= 7 ? 'high' : c >= 4 ? 'med' : c > 0 ? 'low' : 'unknown');
const mapNpm = (s) => ({ critical: 'crit', high: 'high', moderate: 'med', low: 'low', info: 'low' }[s] || 'low');
// Rows-only contract stays; a void is pushed to `voids` so the caller cannot read zero rows as
// zero findings — parsing failed is not parsing to zero.
function parseOsv(dir, voids = []) {
  const r = readSarif(join(dir, 'osv.sarif'));
  if (r.state === 'absent') return [];
  if (r.state !== 'ok') {
    process.stderr.write(`[backfill-docs] ${join(dir, 'osv.sarif')}: ${r.state} — ${r.reason}; contributing NO rows (a husk is not a clean scan)\n`);
    voids.push({ artifact: 'osv.sarif', state: r.state, reason: r.reason || null });
    return [];
  }
  const run = r.runs[0]; if (!run) return [];
  const rules = ruleIndex(run);
  const out = [];
  for (const res of run.results) {
    const rule = rules[res.ruleId] || {};
    const cvss = parseFloat((rule.properties && rule.properties['security-severity']) || 0) || 0;
    const m = (res.message && res.message.text) || '';
    const pm = m.match(/Package '([^'@]+)@([^']+)'/);
    const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
    out.push({ tool: 'osv', id: res.ruleId, severity: sevFromCvss(cvss), package: pm ? pm[1] : '', version: pm ? pm[2] : '',
      path: (loc && loc.artifactLocation && loc.artifactLocation.uri) || '' });
  }
  return out;
}
function parseNpm(dir, voids = []) {
  const p = join(dir, 'npm-audit.json'); if (!existsSync(p)) return [];
  let d;
  try { d = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) {
    process.stderr.write(`[backfill-docs] ${p}: unparseable — ${e.message.slice(0, 100)}; contributing NO rows\n`);
    voids.push({ artifact: 'npm-audit.json', state: 'unparseable', reason: e.message.slice(0, 120) });
    return [];
  }
  const out = [];
  for (const [name, v] of Object.entries(d.vulnerabilities || {})) {
    const advs = (v.via || []).filter((x) => typeof x === 'object');
    if (!advs.length) { out.push({ tool: 'npm', id: name, severity: mapNpm(v.severity), package: name, version: '', path: 'package-lock.json' }); continue; }
    for (const a of advs) {
      const id = (a.url || '').split('/').pop() || String(a.source || name);
      out.push({ tool: 'npm', id, severity: mapNpm(a.severity || v.severity), package: a.name || name, version: '', path: 'package-lock.json' });
    }
  }
  return out;
}
const dedupe = (fs) => { const seen = new Set(); return fs.filter((f) => { const k = `${f.tool}|${f.id}|${f.package}|${f.version}|${f.path || ''}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

const ARTIFACTS = ['osv.sarif', 'npm-audit.json', 'checks-status.json']; // rollup.mjs's own "scanned" evidence set

let idx = []; try { idx = JSON.parse(readFileSync(join(histDir, 'index.json'), 'utf8')); } catch {}
if (!idx.length) { console.error('backfill-docs: no history/index.json — nothing to backfill'); process.exit(1); }
mkdirSync(enrichDir, { recursive: true });

let wrote = 0, skipped = 0;
for (const e of idx) {
  if ((e.sliceVersion || 0) >= 1) { skipped++; continue; } // v1 slices carry real scope/toolRuns
  const stamp = e.stamp;
  let s = null; try { s = JSON.parse(readFileSync(join(histDir, `${stamp}.json`), 'utf8')); } catch {}
  if (!s || !s.source) { console.error(`backfill-docs: ${stamp} — no slice/source, skipped`); skipped++; continue; }
  const src = resolve(s.source);
  if (!existsSync(src)) { console.error(`backfill-docs: ${stamp} — source dir gone (${src}), skipped`); skipped++; continue; }

  // repos the slice itself observed (findings) — documentation must AGREE before we add anything
  const observed = new Set((s.findings || []).map((f) => f.repo));
  const repos = {}; const mismatches = [];
  for (const name of readdirSync(src)) {
    const dir = join(src, name);
    let st; try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const artifacts = ARTIFACTS.filter((f) => existsSync(join(dir, f)));
    if (!artifacts.length) continue; // no scan evidence — not documented as scanned
    const voids = [];
    const fs = dedupe([...parseOsv(dir, voids), ...parseNpm(dir, voids)]);
    const counts = { crit: 0, high: 0, med: 0, low: 0, unknown: 0, total: fs.length };
    for (const f of fs) counts[f.severity] = (counts[f.severity] || 0) + 1;
    // A present-but-unreadable artifact is scan evidence for the file and NOT for the scan:
    // existsSync counted the husk, the parser refused it, and the two together used to write
    // `scanned: true, total: 0` into a persistent sidecar — a clean bill from a failed read.
    repos[name] = voids.length
      ? { scanned: false, void: true, artifacts, voids, counts }
      : { scanned: true, artifacts, counts };
    // a repo the docs show findings for but the slice never observed can NOT be backfilled —
    // the slice may have run with different scope/annotations; record, don't invent
    if (fs.length && !observed.has(name)) mismatches.push(name);
  }
  const sidecar = {
    stamp, sliceId: s.sliceId || `v0-${stamp}`, source: src, sourceName: basename(src),
    derivedAt: new Date().toISOString(),
    evidence: 'per-repo scanner artifacts in the slice source report dir (same parsers as rollup.mjs)',
    repos, mismatches,
  };
  writeFileSync(join(enrichDir, `${stamp}-backfill.json`), JSON.stringify(sidecar, null, 1));
  const voided = Object.values(repos).filter((r) => r.void).length;
  const clean = Object.values(repos).filter((r) => r.scanned && r.counts.total === 0).length;
  console.log(`backfill-docs: ${stamp} ← ${basename(src)} · ${Object.keys(repos).length} repos documented (${clean} clean, ${voided} VOID (artifact present, unreadable — never clean), ${observed.size} observed in slice${mismatches.length ? `, ${mismatches.length} MISMATCH: ${mismatches.join(' ')}` : ''})`);
  wrote++;
}
console.log(`backfill-docs: ${wrote} sidecars written, ${skipped} slices skipped -> ${enrichDir}`);
