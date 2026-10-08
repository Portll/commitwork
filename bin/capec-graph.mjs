#!/usr/bin/env node
// bin/capec-graph.mjs — CAPEC attack patterns and their ATT&CK mappings, vendored beside cwe-graph.
//
// Constrained by evaluations/STPA-capec-attack-2026-08-23.md. The three that bite:
// deprecated ids are excluded and COUNTED; only CWE→CAPEC→ATT&CK is walked, never the inverse; and
// CAPEC's own ChildOf is a different hierarchy from CWE's and is never walked with cwe-graph's.
//
// usage: node bin/capec-graph.mjs
// env:   CW_CAPEC_GRAPH · CW_CAPEC_URL · CW_NOW

import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');

export const graphPath = () => process.env.CW_CAPEC_GRAPH || join(CW, 'monitor', 'data', 'capec-graph.json');
const catalogueUrl = () => process.env.CW_CAPEC_URL || 'https://capec.mitre.org/data/xml/capec_latest.xml';

// Withdrawn for cause upstream. 57 of 615 as measured 2026-08-23 — publishing one is H3.
const DEAD = new Set(['Deprecated', 'Obsolete']);

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- k is a literal XML attribute name at each call site
const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : ''; };

/** CAPEC XML → {patterns, byCwe, dropped}. byCwe is the only join direction that exists. */
export function parseCatalogue(xml) {
  const patterns = {};
  const byCwe = {};
  const dropped = { deprecated: 0 };
  let i = xml.indexOf('<Attack_Pattern ');
  while (i !== -1) {
    const end = xml.indexOf('</Attack_Pattern>', i);
    const block = xml.slice(i, end === -1 ? i + 8000 : end);
    const head = block.slice(0, block.indexOf('>') + 1);
    const id = attr(head, 'ID');
    const status = attr(head, 'Status');
    if (id && DEAD.has(status)) dropped.deprecated += 1;
    else if (id) {
      const cwes = [...block.matchAll(/<Related_Weakness\s+CWE_ID="(\d+)"/g)].map((m) => m[1]);
      // Taxonomy_Mappings carries several taxonomies; only ATTACK is a technique id.
      // CAPEC writes the technique bare ("1499", "1542.002"); the ATT&CK id is T-prefixed, and an
      // unprefixed one resolves nowhere.
      const attack = [...block.matchAll(/<Taxonomy_Mapping[^>]*Taxonomy_Name="ATTACK"[^>]*>([\s\S]*?)<\/Taxonomy_Mapping>/g)]
        .flatMap((m) => [...m[1].matchAll(/<Entry_ID>([^<]+)<\/Entry_ID>/g)].map((x) => x[1].trim()))
        .filter((t) => /^\d+(\.\d+)?$/.test(t))
        .map((t) => `T${t}`);
      const node = { name: attr(head, 'Name'), abstraction: attr(head, 'Abstraction'), status };
      if (cwes.length) node.cwe = [...new Set(cwes)].sort();
      if (attack.length) node.attack = [...new Set(attack)].sort();
      patterns[id] = node;
      for (const c of new Set(cwes)) (byCwe[c] = byCwe[c] || []).push(id);
    }
    i = xml.indexOf('<Attack_Pattern ', i + 16);
  }
  for (const c of Object.keys(byCwe)) byCwe[c] = [...new Set(byCwe[c])].sort((a, b) => Number(a) - Number(b));
  return { patterns, byCwe, dropped };
}

/**
 * CWE ids → attack-pattern attribution. Attributes, never rows: one finding stays one finding
 * whatever the fan-out (measured max 59 CAPECs for one CWE).
 *
 * `via` is 'direct' or 'ancestor'. Ancestor derivation is OFF unless asked for: a parent CWE is a
 * generalisation, and attributing an attack pattern through one is the over-reporting direction.
 */
export function attributionFor(cweIds, graph, { cweGraph = null, ancestors = null, cap = 12 } = {}) {
  const ids = (cweIds || []).map((c) => String(c).replace(/^CWE-/, '')).filter(Boolean);
  if (!ids.length) return { capec: '', capecVia: '', attack: '', capecReason: 'no-cwe' };

  const direct = [...new Set(ids.flatMap((c) => graph.byCwe[c] || []))];
  let hits = direct;
  let via = direct.length ? 'direct' : '';

  if (!hits.length && cweGraph && ancestors) {
    // depth-1 only: each further step compounds the generalisation (HAZOP ++RECURSIVE)
    const up = [...new Set(ids.flatMap((c) => (ancestors(cweGraph, c) || []).slice(0, 1)))];
    const found = [...new Set(up.flatMap((c) => graph.byCwe[c] || []))];
    if (found.length) { hits = found; via = 'ancestor'; }
  }
  if (!hits.length) return { capec: '', capecVia: '', attack: '', capecReason: 'cwe-unmapped' };

  const sorted = hits.sort((a, b) => Number(a) - Number(b));
  const kept = sorted.slice(0, cap);
  const attack = [...new Set(kept.flatMap((p) => (graph.patterns[p] || {}).attack || []))].sort();
  return {
    capec: kept.map((p) => `CAPEC-${p}`).join(' '),
    capecVia: via,
    attack: attack.join(' '),
    // A cap that is not stated is a silent truncation; 71% of patterns carry no technique at all.
    capecReason: [sorted.length > cap ? `capped-${sorted.length}` : '',
      attack.length ? '' : 'capec-has-no-attack'].filter(Boolean).join('+'),
  };
}

export function loadGraph(p = graphPath()) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { patterns: {}, byCwe: {} };
    throw e;
  }
  const j = JSON.parse(raw);
  if (!j || typeof j.patterns !== 'object' || !j.patterns) throw new Error(`capec graph at ${p} has no patterns map`);
  return j;
}

export function serialise(graph) {
  const byNum = (a, b) => Number(a) - Number(b);
  const patterns = Object.fromEntries(Object.keys(graph.patterns).sort(byNum).map((k) => [k, graph.patterns[k]]));
  const byCwe = Object.fromEntries(Object.keys(graph.byCwe).sort(byNum).map((k) => [k, graph.byCwe[k]]));
  return `${JSON.stringify({ ...graph, count: Object.keys(patterns).length, patterns, byCwe }, null, 2)}\n`;
}

export function write(graph, p = graphPath()) {
  writeAtomic(p, serialise(graph));
  return p;
}

if (isMainModule(import.meta.url)) {
  const r = await fetch(catalogueUrl(), { signal: AbortSignal.timeout(180000) });
  if (!r.ok) { process.stderr.write(`capec-graph: ${r.status} from ${catalogueUrl()}\n`); process.exit(1); }
  const parsed = parseCatalogue(await r.text());
  write({ source: 'capec.mitre.org', generated: nowISO(), ...parsed });
  const withAttack = Object.values(parsed.patterns).filter((p) => p.attack).length;
  const techniques = new Set(Object.values(parsed.patterns).flatMap((p) => p.attack || [])).size;
  process.stdout.write(`wrote ${graphPath()} — ${Object.keys(parsed.patterns).length} patterns, `
    + `${Object.keys(parsed.byCwe).length} CWEs mapped, ${withAttack} with an ATT&CK technique `
    + `(${techniques} distinct), ${parsed.dropped.deprecated} deprecated dropped\n`);
}
