#!/usr/bin/env node
// bin/cwe-graph.mjs — MITRE's CWE catalogue as a typed graph.
//
// The weakness axis is the only real TAXONOMY the advisory corpus carries: a DAG of ~940 nodes with
// typed edges, so a finding rolls up variant → base → class → pillar. Severity cannot do that.
//
// usage: node bin/cwe-graph.mjs [--view 1000]
// env:   CW_CWE_GRAPH · CW_CWE_URL · CW_NOW

import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');

export const graphPath = () => process.env.CW_CWE_GRAPH || join(CW, 'monitor', 'data', 'cwe-graph.json');
const catalogueUrl = () => process.env.CW_CWE_URL || 'https://cwe.mitre.org/data/xml/cwec_latest.xml.zip';

// CWE ships zipped and node has raw inflate but no zip reader. Read the CENTRAL DIRECTORY, not the
// local headers: with a data descriptor the local sizes are zero and the entry silently truncates.
export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(`bad central directory entry at ${off}`);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : raw });
    off += 46 + nlen + elen + clen;
  }
  return out;
}

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- k is a literal XML attribute name at each call site
const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : ''; };

// Edges we keep, and what each means for a roll-up. ChildOf is the hierarchy; the rest are lateral
// and must never be walked as if they were, or the "DAG" grows cycles.
export const NATURES = ['ChildOf', 'PeerOf', 'CanPrecede', 'CanFollow', 'CanAlsoBe', 'Requires'];

/** CWE XML → {cwes, categories}. Scanned by index rather than split: the file is ~35 MB. */
export function parseCatalogue(xml, view = '1000') {
  const cwes = {};
  const categories = {};
  const scan = (tag, fn) => {
    const open = `<${tag} `;
    const close = `</${tag}>`;
    let i = xml.indexOf(open);
    while (i !== -1) {
      const end = xml.indexOf(close, i);
      const selfEnd = xml.indexOf('>', i);
      const block = end === -1 || (selfEnd !== -1 && xml[selfEnd - 1] === '/' && selfEnd < end)
        ? xml.slice(i, selfEnd + 1) : xml.slice(i, end);
      fn(block);
      i = xml.indexOf(open, i + open.length);
    }
  };

  scan('Weakness', (block) => {
    const head = block.slice(0, block.indexOf('>') + 1);
    const id = attr(head, 'ID');
    if (!id) return;
    const node = {
      name: attr(head, 'Name'),
      abstraction: attr(head, 'Abstraction'),
      status: attr(head, 'Status'),
    };
    for (const nature of NATURES) {
      const to = [];
      const re = /<Related_Weakness\b[^>]*\/?>/g;
      let m = re.exec(block);
      while (m) {
        if (attr(m[0], 'Nature') === nature) {
          const v = attr(m[0], 'View_ID');
          // View_ID scopes the edge: a ChildOf in view 699 is a DIFFERENT hierarchy from view 1000,
          // and mixing them is how a clean DAG acquires cycles.
          if (!v || v === view || nature !== 'ChildOf') to.push(attr(m[0], 'CWE_ID'));
        }
        m = re.exec(block);
      }
      if (to.length) node[nature] = [...new Set(to)].filter(Boolean).sort();
    }
    cwes[id] = node;
  });

  scan('Category', (block) => {
    const head = block.slice(0, block.indexOf('>') + 1);
    const id = attr(head, 'ID');
    if (id) categories[id] = { name: attr(head, 'Name'), status: attr(head, 'Status') };
  });

  return { cwes, categories };
}

/** ChildOf chain to the pillar. Cycle-guarded: a bad catalogue must not hang a scan. */
export function ancestors(graph, id, max = 24) {
  const out = [];
  const seen = new Set([String(id)]);
  let cur = String(id).replace(/^CWE-/, '');
  for (let i = 0; i < max; i += 1) {
    const node = graph.cwes[cur];
    const next = node && node.ChildOf && node.ChildOf[0];
    if (!next || seen.has(next)) break;
    seen.add(next);
    out.push(next);
    cur = next;
  }
  return out;
}

/** Nearest ancestor at an abstraction level (Pillar/Class/Base), or '' when the chain has none. */
export function rollup(graph, id, level = 'Pillar') {
  const self = String(id).replace(/^CWE-/, '');
  if (graph.cwes[self] && graph.cwes[self].abstraction === level) return self;
  for (const a of ancestors(graph, self)) {
    if (graph.cwes[a] && graph.cwes[a].abstraction === level) return a;
  }
  return '';
}

export function loadGraph(p = graphPath()) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { cwes: {}, categories: {} };
    throw e;
  }
  const j = JSON.parse(raw);
  if (!j || typeof j.cwes !== 'object' || !j.cwes) throw new Error(`cwe graph at ${p} has no cwes map`);
  return j;
}

export function serialise(graph) {
  const byNum = (a, b) => Number(a) - Number(b);
  const cwes = Object.fromEntries(Object.keys(graph.cwes).sort(byNum).map((k) => [k, graph.cwes[k]]));
  const categories = Object.fromEntries(Object.keys(graph.categories).sort(byNum)
    .map((k) => [k, graph.categories[k]]));
  return `${JSON.stringify({ ...graph, count: Object.keys(cwes).length, cwes, categories }, null, 2)}\n`;
}

export function write(graph, p = graphPath()) {
  writeAtomic(p, serialise(graph));
  return p;
}

if (isMainModule(import.meta.url)) {
  const view = (process.argv.includes('--view') && process.argv[process.argv.indexOf('--view') + 1]) || '1000';
  const r = await fetch(catalogueUrl(), { signal: AbortSignal.timeout(120000) });
  if (!r.ok) { process.stderr.write(`cwe-graph: ${r.status} from ${catalogueUrl()}\n`); process.exit(1); }
  const entries = unzip(Buffer.from(await r.arrayBuffer()));
  const xmlEntry = entries.find((e) => e.name.endsWith('.xml'));
  if (!xmlEntry) { process.stderr.write('cwe-graph: no .xml in the archive\n'); process.exit(1); }
  const parsed = parseCatalogue(xmlEntry.data.toString('utf8'), view);
  const graph = { source: 'cwe.mitre.org', view, generated: nowISO(), ...parsed };
  write(graph);
  const pillars = Object.values(parsed.cwes).filter((c) => c.abstraction === 'Pillar').length;
  const orphan = Object.values(parsed.cwes).filter((c) => !c.ChildOf && c.abstraction !== 'Pillar').length;
  process.stdout.write(`wrote ${graphPath()} — ${Object.keys(parsed.cwes).length} weaknesses, `
    + `${Object.keys(parsed.categories).length} categories, ${pillars} pillars, ${orphan} without a parent\n`);
}
