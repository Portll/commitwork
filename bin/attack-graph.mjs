#!/usr/bin/env node
// bin/attack-graph.mjs — MITRE ATT&CK techniques, their tactics, and the sub-technique hierarchy.
//
// Same constraints as capec-graph (evaluations/STPA-capec-attack-2026-08-23.md §6): withdrawn ids
// excluded and COUNTED, one direction only, no inverse index. ATT&CK withdraws two ways and they
// differ — `deprecated` means dropped, `revoked` means REPLACED BY something else, so a revoked id
// is stale attribution rather than absent attribution.
//
// usage: node bin/attack-graph.mjs [--domain enterprise-attack]
// env:   CW_ATTACK_GRAPH · CW_ATTACK_URL · CW_NOW

import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { join, dirname } from 'node:path';
import { validateAgainstSchema } from '../monitor/registry.mjs'; // the one schema validator
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMA_PATH = join(CW, 'schema', 'attack-graph.schema.json');
export const graphPath = () => process.env.CW_ATTACK_GRAPH || join(CW, 'monitor', 'data', 'attack-graph.json');
const bundleUrl = (domain) => process.env.CW_ATTACK_URL
  || `https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/${domain}/${domain}.json`;

const attackId = (o) => ((o.external_references || [])
  .find((e) => e.source_name === 'mitre-attack') || {}).external_id || '';

/** A sub-technique id carries its parent: T1059.007 → T1059. Validated against the STIX relationships. */
export const parentOf = (id) => (/^T\d+\.\d+$/.test(String(id)) ? String(id).split('.')[0] : '');

/** STIX bundle → {techniques, tactics, dropped}. */
export function parseBundle(bundle) {
  const objs = (bundle && bundle.objects) || [];
  const techniques = {};
  const tactics = {};
  const dropped = { deprecated: 0, revoked: 0, noId: 0 };

  for (const o of objs) {
    if (o.type === 'x-mitre-tactic') {
      const short = o.x_mitre_shortname;
      if (short) tactics[short] = { name: o.name || '', id: attackId(o) };
      continue;
    }
    if (o.type !== 'attack-pattern') continue;
    if (o.x_mitre_deprecated) { dropped.deprecated += 1; continue; }
    if (o.revoked) { dropped.revoked += 1; continue; }
    const id = attackId(o);
    if (!id) { dropped.noId += 1; continue; }
    const phases = (o.kill_chain_phases || [])
      .filter((k) => k.kill_chain_name === 'mitre-attack').map((k) => k.phase_name);
    const node = { name: o.name || '' };
    if (phases.length) node.tactics = [...new Set(phases)].sort();
    const parent = parentOf(id);
    if (parent) node.parent = parent;
    techniques[id] = node;
  }
  return { techniques, tactics, dropped };
}

/**
 * Technique ids → the tactics they sit under, plus each id's parent technique.
 * Attributes, never rows — the same rule the CAPEC axis holds.
 */
export function tacticsFor(ids, graph) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return { attackTactic: '', attackParent: '', attackReason: 'no-technique' };
  const known = list.filter((t) => graph.techniques[t]);
  if (!known.length) return { attackTactic: '', attackParent: '', attackReason: 'technique-unknown' };

  const tac = [...new Set(known.flatMap((t) => graph.techniques[t].tactics || []))].sort();
  // Parent only where the id IS a sub-technique; a base technique has no parent and must not
  // borrow one.
  const parents = [...new Set(known.map((t) => graph.techniques[t].parent).filter(Boolean))].sort();
  return {
    attackTactic: tac.join(' '),
    attackParent: parents.join(' '),
    attackReason: tac.length ? '' : 'technique-has-no-tactic',
  };
}

export function loadGraph(p = graphPath()) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { techniques: {}, tactics: {} };
    throw e;
  }
  const j = JSON.parse(raw);
  // THE SCHEMA WAS SITTING BESIDE THIS FILE UNUSED while a hand-rolled `typeof j.techniques` stood
  // in for it. Two descriptions of one contract, only one executing — and the executing one checked
  // a single key. schema/attack-graph.schema.json has had zero importers since it was written.
  //
  // Validated at LOAD, not only in a test: a test catches drift when someone runs it; a loader
  // catches it before the graph is acted on. ENOENT above is untouched — legitimately absent is a
  // different state from malformed, and collapsing them is how "no data" becomes "empty graph".
  const { errors } = validateAgainstSchema(j, { path: SCHEMA_PATH });
  if (errors.length) {
    throw new Error(`attack graph at ${p} does not satisfy schema/attack-graph.schema.json:\n  `
      + errors.slice(0, 8).join('\n  ') + (errors.length > 8 ? `\n  … +${errors.length - 8} more` : ''));
  }
  return j;
}

export function serialise(graph) {
  const techniques = Object.fromEntries(Object.keys(graph.techniques).sort().map((k) => [k, graph.techniques[k]]));
  const tactics = Object.fromEntries(Object.keys(graph.tactics).sort().map((k) => [k, graph.tactics[k]]));
  return `${JSON.stringify({ ...graph, count: Object.keys(techniques).length, techniques, tactics }, null, 2)}\n`;
}

export function write(graph, p = graphPath()) {
  writeAtomic(p, serialise(graph));
  return p;
}

if (isMainModule(import.meta.url)) {
  const i = process.argv.indexOf('--domain');
  const domain = (i > -1 && process.argv[i + 1]) || 'enterprise-attack';
  const r = await fetch(bundleUrl(domain), { signal: AbortSignal.timeout(300000) });
  if (!r.ok) { process.stderr.write(`attack-graph: ${r.status} from ${bundleUrl(domain)}\n`); process.exit(1); }
  const parsed = parseBundle(await r.json());
  write({ source: 'mitre-attack/attack-stix-data', domain, generated: nowISO(), ...parsed });
  const subs = Object.values(parsed.techniques).filter((t) => t.parent).length;
  const noTactic = Object.values(parsed.techniques).filter((t) => !t.tactics).length;
  process.stdout.write(`wrote ${graphPath()} — ${Object.keys(parsed.techniques).length} techniques `
    + `(${subs} sub), ${Object.keys(parsed.tactics).length} tactics, ${noTactic} with no tactic · `
    + `dropped ${parsed.dropped.deprecated} deprecated + ${parsed.dropped.revoked} revoked\n`);
}
