#!/usr/bin/env node
// cra/spdx.mjs — SPDX 2.3 JSON of the component set a CycloneDX SBOM holds.
//
// Converted from the CycloneDX commitwork publishes rather than asked of syft: the published
// document is merged per product (cra/sbom.mjs) and provenance-corrected (bin/sbom-enrich.mjs),
// and syft's own SPDX writer sees neither, so it would describe a different component set under
// different purls. One source, two projections, so the two formats cannot disagree.
//
// Deterministic: packages sort by key, SPDXIDs derive from the key, documentNamespace from a hash
// of the content, and `created` from the CycloneDX timestamp (else CW_NOW).
//
//   node cra/spdx.mjs <sbom.cdx.json> [--out <file.spdx.json>]
//
// Exit 0 written, 2 usage, 20 the input is not a CycloneDX document (nothing written).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { sha256, stableStringify, writeJSONAtomic } from './lib.mjs';

export const SPDX_VERSION = 'SPDX-2.3';
const NS_BASE = 'https://commitwork.online/spdxdocs';
const NOASSERTION = 'NOASSERTION';
// CycloneDX hash alg → SPDX checksum algorithm; anything unlisted is dropped rather than guessed.
const HASH_ALG = {
  'MD5': 'MD5', 'SHA-1': 'SHA1', 'SHA-256': 'SHA256', 'SHA-384': 'SHA384', 'SHA-512': 'SHA512',
  'SHA3-256': 'SHA3-256', 'SHA3-384': 'SHA3-384', 'SHA3-512': 'SHA3-512',
  'BLAKE2b-256': 'BLAKE2b-256', 'BLAKE2b-384': 'BLAKE2b-384', 'BLAKE2b-512': 'BLAKE2b-512', 'BLAKE3': 'BLAKE3',
};
const SPDX_LICENSE_ID = /^[A-Za-z0-9.+-]+$/;

export class SpdxInputError extends Error {
  constructor(reason) { super(`not convertible to SPDX: ${reason}`); this.name = 'SpdxInputError'; this.reason = reason; }
}

const componentKey = (c) => c.purl || `${c.group ? c.group + '/' : ''}${c.name}@${c.version || ''}`;
const spdxId = (prefix, key) => `SPDXRef-${prefix}-${sha256(key).slice(0, 16)}`;
// SPDX 2.3 §6.9: YYYY-MM-DDThh:mm:ssZ, no fractional seconds.
const spdxTime = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');

function licenseOf(c) {
  const ls = Array.isArray(c.licenses) ? c.licenses : [];
  const parts = [];
  for (const l of ls) {
    if (l && l.expression) parts.push(String(l.expression));
    else if (l && l.license && l.license.id && SPDX_LICENSE_ID.test(l.license.id)) parts.push(String(l.license.id));
    else return NOASSERTION; // a name-only licence is a claim SPDX cannot carry without inventing an id
  }
  if (!parts.length) return NOASSERTION;
  return parts.length === 1 ? parts[0] : parts.map((p) => (/\s/.test(p) ? `(${p})` : p)).join(' AND ');
}

function packageOf(c, id) {
  const pkg = {
    SPDXID: id,
    name: c.group ? `${c.group}/${c.name}` : String(c.name),
    ...(c.version ? { versionInfo: String(c.version) } : {}),
    supplier: c.supplier && c.supplier.name ? `Organization: ${c.supplier.name}` : NOASSERTION,
    downloadLocation: NOASSERTION,
    filesAnalyzed: false,
    licenseConcluded: NOASSERTION,
    licenseDeclared: licenseOf(c),
    copyrightText: NOASSERTION,
  };
  const dist = (c.externalReferences || []).find((r) => r && r.type === 'distribution' && r.url);
  if (dist) pkg.downloadLocation = String(dist.url);
  const sums = (c.hashes || []).filter((h) => h && HASH_ALG[h.alg] && h.content)
    .map((h) => ({ algorithm: HASH_ALG[h.alg], checksumValue: String(h.content).toLowerCase() }))
    .sort((a, b) => (a.algorithm < b.algorithm ? -1 : a.algorithm > b.algorithm ? 1 : 0));
  if (sums.length) pkg.checksums = sums;
  const refs = [];
  if (c.purl) refs.push({ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: String(c.purl) });
  if (c.cpe) refs.push({ referenceCategory: 'SECURITY', referenceType: 'cpe23Type', referenceLocator: String(c.cpe) });
  if (refs.length) pkg.externalRefs = refs;
  // commitwork's own annotations (which repo carries it, how it resolved) travel as a comment.
  const own = (c.properties || []).filter((p) => p && /^commitwork:/.test(p.name || ''))
    .map((p) => `${p.name}=${p.value}`).sort();
  if (own.length) pkg.comment = own.join('\n');
  return pkg;
}

/**
 * SPDX 2.3 JSON for a CycloneDX document. `created` defaults to the CycloneDX timestamp, then
 * CW_NOW. Throws SpdxInputError on anything that is not a CycloneDX document with named components.
 */
export function cdxToSpdx(cdx, { created, env = process.env } = {}) {
  if (!cdx || typeof cdx !== 'object' || cdx.bomFormat !== 'CycloneDX') throw new SpdxInputError('bomFormat is not CycloneDX');
  if (cdx.components !== undefined && !Array.isArray(cdx.components)) throw new SpdxInputError('components is not an array');
  const comps = cdx.components || [];
  comps.forEach((c, i) => { if (!c || typeof c !== 'object' || !c.name) throw new SpdxInputError(`component ${i} has no name`); });

  // Dedupe on key: a repeated SPDXID is an invalid document. Ties sort by content so the survivor
  // does not depend on input order.
  const ordered = [...comps].map((c) => ({ c, key: componentKey(c), body: stableStringify(c) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.body < b.body ? -1 : a.body > b.body ? 1 : 0));
  const byKey = new Map();
  for (const o of ordered) if (!byKey.has(o.key)) byKey.set(o.key, o.c);
  const refToId = new Map();
  const packages = [];
  for (const [key, c] of byKey) {
    const id = spdxId('Package', key);
    if (c['bom-ref']) refToId.set(String(c['bom-ref']), id);
    packages.push(packageOf(c, id));
  }

  const meta = cdx.metadata || {};
  const root = meta.component && meta.component.name ? meta.component : null;
  const rootId = root ? spdxId('Product', componentKey(root)) : null;
  if (root) {
    if (root['bom-ref']) refToId.set(String(root['bom-ref']), rootId);
    packages.unshift(packageOf(root, rootId));
  }

  const relationships = [];
  const rel = (a, type, b) => relationships.push({ spdxElementId: a, relationshipType: type, relatedSpdxElement: b });
  if (rootId) {
    rel('SPDXRef-DOCUMENT', 'DESCRIBES', rootId);
    for (const p of packages) if (p.SPDXID !== rootId) rel(rootId, 'CONTAINS', p.SPDXID);
  } else {
    for (const p of packages) rel('SPDXRef-DOCUMENT', 'DESCRIBES', p.SPDXID);
  }
  const deps = [];
  for (const d of Array.isArray(cdx.dependencies) ? cdx.dependencies : []) {
    const from = d && refToId.get(String(d.ref));
    if (!from) continue;
    for (const on of d.dependsOn || []) {
      const to = refToId.get(String(on));
      if (to && to !== from) deps.push([from, to]);
    }
  }
  for (const [a, b] of [...new Set(deps.map((x) => x.join(' ')))].sort().map((s) => s.split(' '))) rel(a, 'DEPENDS_ON', b);

  const name = root ? `${root.name}${root.version ? `-${root.version}` : ''}` : 'sbom';
  const content = stableStringify({ name, packages, relationships });
  const at = created || meta.timestamp || nowISO(env);
  const doc = {
    spdxVersion: SPDX_VERSION,
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name,
    documentNamespace: `${NS_BASE}/${encodeURIComponent(name)}-${sha256(content).slice(0, 32)}`,
    creationInfo: { created: spdxTime(at), creators: ['Tool: commitwork'] },
    packages,
    relationships,
  };
  // Document-level caveats (provenance-unenriched and the like) must survive the conversion: they
  // are what stops an unchecked identity reading as a checked one.
  const notes = (meta.properties || []).filter((p) => p && /^commitwork:/.test(p.name || ''))
    .map((p) => `${p.name}=${p.value}`);
  if (notes.length) doc.comment = notes.join('\n');
  return doc;
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--out');
  const out = i >= 0 ? argv[i + 1] : undefined;
  const input = argv.find((a, j) => !a.startsWith('--') && (i < 0 || j !== i + 1));
  if (!input || (i >= 0 && !out)) {
    process.stderr.write('usage: spdx.mjs <sbom.cdx.json> [--out <file.spdx.json>]\n');
    process.exitCode = 2;
  } else {
    let doc = null;
    try { doc = cdxToSpdx(JSON.parse(readFileSync(resolve(input), 'utf8'))); } catch (e) {
      if (!(e instanceof SpdxInputError) && !(e instanceof SyntaxError) && !(e && e.code)) throw e;
      process.stderr.write(`spdx: ${input}: ${e.message}\n`);
      process.exitCode = 20;
    }
    if (doc) {
      if (out) writeJSONAtomic(resolve(out), doc);
      else process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    }
  }
}
