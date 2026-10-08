#!/usr/bin/env node
// cra/oscal.mjs — emit an OSCAL Component Definition mapping commitwork's evidence to NIST
// SP 800-53 Rev 5 controls and to the SOC 2 Trust Services Criteria, for a product.
//
// OSCAL (NIST's Open Security Controls Assessment Language) is the machine-readable format a
// GRC / assessment platform ingests — the legitimate way for a tool to "do 800-53": assert
// which controls this component satisfies and how, rather than pretending to be the system of
// record. This turns the coverage crosswalk into a `component-definition` with one
// control-implementation per framework, whose implemented-requirements carry an
// implementation-status (implemented when a mapping check provably ran / an evidence source is
// present; planned when only mapped) and a statement citing the evidence (which checks/sources,
// which repos, which slice). Every requirement also carries a commitwork `evidence-status`
// (evidenced | mapped | not-evidenced).
//
// Honest by construction: NIST lists only the technically-evidenceable controls, and states the
// mapped-vs-catalog denominator so no one reads it as full-catalog coverage. SOC 2 lists all 33
// common criteria; one no check or evidence source supplies is `not-evidenced` and carries no
// implementation-status at all — it is named, never claimed.
//
//   node cra/oscal.mjs [--product <id>]   →   reports/cra/oscal/<product>.oscal.json
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import {
  loadJSON, writeJSONAtomic, resolvePaths, loadProducts, nowISO, sha256, stableStringify, latestSweepDir,
} from './lib.mjs';
import { coverageFor, loadControls, ranChecksFromSweep } from './controls.mjs';

const OSCAL_VERSION = '1.1.2';
const NS = 'http://csrc.nist.gov/ns/oscal';
const CW_NS = 'https://commitwork.online/ns/oscal';
const CATALOG_SOURCE = 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json';

// OSCAL's uuid type admits only RFC 4122 v4/v5, so the version and variant bits are set over the
// content hash; a raw hash prefix fails the schema pattern about 15 times in 16.
export function oscalUUID(seed) {
  const h = sha256(seed);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function evidenceText(r, cov) {
  if (r.status === 'evidenced') {
    return `Evidenced by ${[...r.evidencingChecks, ...r.evidencingSources.map((s) => `[${s}]`)].join(', ')}${r.repos.length ? ` on ${r.repos.length} repo(s)` : ''} in slice ${cov.slice || 'n/a'}.`;
  }
  return `Mapped to ${r.mappingChecks.join(', ') || 'n/a'} but not proven to have run for this product in the current slice.`;
}

function requirement(fw, productId, controlId, title, row, cov) {
  const props = [];
  let description;
  if (row) {
    description = `${title}. ${evidenceText(row, cov)}`;
    props.push({ name: 'implementation-status', ns: NS, value: row.status === 'evidenced' ? 'implemented' : 'planned' });
    props.push({ name: 'evidence-status', ns: CW_NS, value: row.status === 'evidenced' ? 'evidenced' : 'mapped' });
  } else {
    description = `${title}. Not evidenced: no commitwork check or evidence source supplies evidence for this criterion. Evidence it elsewhere (GRC); this document makes no claim about it.`;
    props.push({ name: 'evidence-status', ns: CW_NS, value: 'not-evidenced' });
  }
  return { uuid: oscalUUID(`req:${fw}:${productId}:${controlId}`), 'control-id': controlId.toLowerCase(), description, props };
}

const statusOf = (req) => req.props.find((x) => x.name === 'evidence-status').value;

export function buildOscal(cov, controls, atIso) {
  const nist = cov.frameworks.nist80053;
  const soc = cov.frameworks.soc2;
  const p = cov.product;
  const nistReqs = nist.rows.map((r) => requirement('nist80053', p.id, r.control, r.title, r, cov));

  // Every listed criterion, in catalogue order, plus any a mapping names that the list lacks (the
  // crosswalk test forbids that, but a dropped row would silently under-state what was evidenced).
  const socMeta = controls.frameworks.soc2;
  if (!socMeta?.catalogSource) throw new Error('controls.json frameworks.soc2.catalogSource is missing; an OSCAL control-implementation requires a source');
  const socRows = new Map(soc.rows.map((r) => [r.control, r]));
  const socIds = [...Object.keys(socMeta.controls || {}), ...[...socRows.keys()].filter((id) => !(id in (socMeta.controls || {}))).sort()];
  const socReqs = socIds.map((id) => requirement('soc2', p.id, id, socMeta.controls?.[id] || socRows.get(id)?.title || id, socRows.get(id), cov));
  const socNotEvidenced = socReqs.filter((r) => statusOf(r) === 'not-evidenced').length;

  const fwProp = (value) => [{ name: 'framework', ns: CW_NS, value }];
  const doc = {
    'component-definition': {
      uuid: oscalUUID(stableStringify({
        p: p.id, v: p.version,
        reqs: [...nistReqs, ...socReqs].map((r) => [r.uuid, statusOf(r)]),
      })),
      metadata: {
        title: `commitwork control evidence — ${p.name} ${p.version}`,
        'last-modified': atIso,
        version: p.version,
        'oscal-version': OSCAL_VERSION,
        props: [{ name: 'generated-by', ns: CW_NS, value: 'commitwork cra/oscal.mjs' }],
        remarks: 'ADVISORY. commitwork evidences only the technically-scannable subset of NIST SP 800-53 Rev 5 and of the SOC 2 Trust Services Criteria; the organizational majority of each is out of scope and evidenced elsewhere (GRC). Review with your assessor or auditor before use.',
      },
      components: [{
        uuid: oscalUUID(`comp:${p.id}`),
        type: 'software',
        title: 'commitwork',
        description: 'Local-first CI + security evidence pipeline (provenance-gated findings, verified-remediation ledger, signed evidence).',
        props: [{ name: 'scope', ns: CW_NS, value: nist.scope || '' }],
        'control-implementations': [{
          uuid: oscalUUID(`ci:${p.id}`),
          source: CATALOG_SOURCE,
          description: `Technically-evidenced NIST SP 800-53 Rev 5 controls for ${p.name}. commitwork maps ${nist.mapped} of ~${nist.catalog} catalogue controls (~${nist.baselineModerate} in a FedRAMP Moderate baseline); ${nist.evidenced} are currently evidenced.`,
          props: fwProp('nist-sp-800-53-rev5'),
          'implemented-requirements': nistReqs,
        }, {
          uuid: oscalUUID(`ci:soc2:${p.id}`),
          source: socMeta.catalogSource,
          description: `SOC 2 Trust Services Criteria (common criteria) for ${p.name}. commitwork maps ${soc.mapped} of ${socReqs.length} criteria; ${soc.evidenced} are currently evidenced and ${socNotEvidenced} have no supplying check or evidence source (not evidenced). The AICPA publishes no OSCAL catalog for the criteria, so source cites the criteria publication and control-ids are the criterion ids, lowercased.`,
          props: fwProp('aicpa-tsc-2017'),
          'implemented-requirements': socReqs,
        }],
      }],
    },
  };
  return doc;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--product') ? argv[argv.indexOf('--product') + 1] : null;
  const paths = resolvePaths();
  const at = nowISO();
  const controls = loadControls(paths.controls);
  const { products } = loadProducts(paths.products);
  const rollup = loadJSON(paths.rollup, { repos: [] });
  const ledger = loadJSON(paths.ledger, { entries: [] });
  const annDoc = loadJSON(paths.annotations, { annotations: [] });
  const sweep = latestSweepDir(paths.reportsRoot);
  for (const product of products) {
    if (only && product.id !== only) continue;
    const cov = coverageFor(product, controls, rollup, ledger.entries || [], annDoc, ranChecksFromSweep(sweep, product.repos));
    cov.slice = rollup.sliceId || null;
    const doc = buildOscal(cov, controls, at);
    const out = join(paths.out, 'oscal', `${product.id}.oscal.json`);
    writeJSONAtomic(out, doc);
    const summary = doc['component-definition'].components[0]['control-implementations'].map((ci) => {
      const reqs = ci['implemented-requirements'];
      return `${ci.props[0].value} ${reqs.filter((r) => statusOf(r) === 'evidenced').length}/${reqs.length} evidenced`;
    }).join(', ');
    console.log(`  ✓ ${product.id}: OSCAL component-definition, ${summary} → ${out}`);
  }
}
