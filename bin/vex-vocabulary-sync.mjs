#!/usr/bin/env node
// bin/vex-vocabulary-sync.mjs — derive the legal VEX vocabulary from the upstream JSON Schemas.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A HAND-WRITTEN LIST. On 2026-08-22 a prose read of the OASIS
// CSAF 2.0 HTML got THREE OF FOUR lists wrong: product_status as 5 values (it is 8), an invented
// `component_present` in flags.label (the real fifth is `inline_mitigations_already_exist`), and an
// invented `timing` in threats.category (the real third is `exploit_status`). A specification's
// prose is not a source and neither is recall. Everything downstream — the projection matrix, the
// evidence gate, every test — indexes the file this writes, so a value that does not exist upstream
// cannot be referenced anywhere in the tree.
//
//   node bin/vex-vocabulary-sync.mjs            derive from schema/upstream/ (offline, default)
//   node bin/vex-vocabulary-sync.mjs --fetch    re-download upstream first, then derive
//   node bin/vex-vocabulary-sync.mjs --check    derive and DIFF against the committed corpus; exit 1 on drift
//
// Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const UPSTREAM = join(REPO, 'schema', 'upstream');
const OUT = join(REPO, 'schema', 'vex-vocabulary.json');

export const SOURCES = Object.freeze({
  csaf: { file: 'csaf_json_schema.json', url: 'https://raw.githubusercontent.com/oasis-tcs/csaf/master/csaf_2.0/json_schema/csaf_json_schema.json' },
  cyclonedx: { file: 'bom-1.5.schema.json', url: 'https://raw.githubusercontent.com/CycloneDX/specification/master/schema/bom-1.5.schema.json' },
  openvex: { file: 'openvex_json_schema.json', url: 'https://raw.githubusercontent.com/openvex/spec/main/openvex_json_schema.json' },
});

// Values commitwork has NO model for, marked out of scope rather than left looking unmapped.
// first_affected/last_affected/recommended are version-RANGE concepts; a finding here is bound to
// one resolved version, so claiming a range would be an invention.
export const OUT_OF_SCOPE = Object.freeze({
  csaf: Object.freeze({
    first_affected: 'version-range concept; findings here bind to one resolved version',
    last_affected: 'version-range concept; findings here bind to one resolved version',
    first_fixed: 'version-range concept; the ledger records a fix instant, not a range boundary',
    recommended: 'a vendor recommendation across versions, which this tool does not author',
  }),
});

const load = (name) => JSON.parse(readFileSync(join(UPSTREAM, name), 'utf8'));

// Follow one $ref hop into definitions/$defs. Deliberately not a general resolver: if upstream ever
// nests deeper, this must FAIL rather than silently return nothing — see assertShape below.
function deref(root, node) {
  if (!node || !node.$ref) return node;
  const path = node.$ref.replace(/^#\//, '').split('/');
  return path.reduce((a, k) => (a ? a[k] : undefined), root);
}
function enumOf(root, node) {
  let n = deref(root, node);
  if (!n) return null;
  if (n.enum) return [...n.enum];
  if (n.items) { n = deref(root, n.items); if (n && n.enum) return [...n.enum]; }
  return null;
}

export function deriveCsaf(doc) {
  const v = doc?.properties?.vulnerabilities?.items?.properties;
  return {
    status: Object.keys(v?.product_status?.properties || {}),
    justification: enumOf(doc, v?.flags?.items?.properties?.label),
    threat: enumOf(doc, v?.threats?.items?.properties?.category),
    response: enumOf(doc, v?.remediations?.items?.properties?.category),
  };
}
export function deriveCycloneDx(doc) {
  const a = doc?.definitions?.vulnerability?.properties?.analysis?.properties;
  return {
    status: enumOf(doc, a?.state),
    justification: enumOf(doc, a?.justification),
    response: enumOf(doc, a?.response),
  };
}
export function deriveOpenVex(doc) {
  const s = doc?.properties?.statements?.items?.properties
    || doc?.$defs?.statement?.properties
    || doc?.definitions?.statement?.properties;
  return {
    status: enumOf(doc, s?.status),
    justification: enumOf(doc, s?.justification),
  };
}

// FAIL CLOSED. An extractor that quietly returns null would write an EMPTY vocabulary, and an empty
// vocabulary makes every downstream exhaustiveness test pass vacuously — the corpus would certify
// its own absence. These counts are the shape observed on 2026-08-22; a change is either upstream
// churn (re-run --fetch and read the diff) or a broken extractor. Both must stop the build.
export const EXPECTED = Object.freeze({
  csaf: { status: 8, justification: 5, threat: 3, response: 5 },
  cyclonedx: { status: 6, justification: 9, response: 5 },
  openvex: { status: 4, justification: 5 },
});

export function assertShape(vocab) {
  const problems = [];
  for (const [fmt, axes] of Object.entries(EXPECTED)) {
    for (const [axis, n] of Object.entries(axes)) {
      const got = vocab.formats[fmt]?.[axis];
      if (!Array.isArray(got)) { problems.push(`${fmt}.${axis} did not extract at all (extractor broken, or upstream moved)`); continue; }
      if (got.length !== n) problems.push(`${fmt}.${axis}: ${got.length} values, expected ${n} — upstream churn or a broken extractor; read the diff before changing EXPECTED`);
    }
  }
  return problems;
}

export function derive() {
  const formats = {
    csaf: deriveCsaf(load(SOURCES.csaf.file)),
    cyclonedx: deriveCycloneDx(load(SOURCES.cyclonedx.file)),
    openvex: deriveOpenVex(load(SOURCES.openvex.file)),
  };
  const total = Object.values(formats).reduce(
    (a, axes) => a + Object.values(axes).reduce((b, v) => b + (v ? v.length : 0), 0), 0);
  return {
    note: 'DERIVED by bin/vex-vocabulary-sync.mjs from schema/upstream/. Never hand-edit — a value '
      + 'that does not exist upstream must not be referenceable anywhere in this tree. Regenerate '
      + 'with `node bin/vex-vocabulary-sync.mjs --fetch`.',
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, s.url])),
    total,
    formats,
    outOfScope: OUT_OF_SCOPE,
  };
}

async function fetchUpstream() {
  for (const [name, s] of Object.entries(SOURCES)) {
    const res = await fetch(s.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${s.url}`);
    const text = await res.text();
    JSON.parse(text);                              // refuse to vendor something unparseable
    writeFileSync(join(UPSTREAM, s.file), text);
    console.log(`  fetched ${name} → schema/upstream/${s.file} (${text.length} bytes)`);
  }
}

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--fetch')) await fetchUpstream();
  const vocab = derive();
  const problems = assertShape(vocab);
  if (problems.length) {
    console.error('vex-vocabulary-sync: REFUSING to write a corpus of unexpected shape:');
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  const json = JSON.stringify(vocab, null, 2) + '\n';
  if (argv.includes('--check')) {
    const current = (() => { try { return readFileSync(OUT, 'utf8'); } catch { return null; } })();
    if (current !== json) {
      console.error(`vex-vocabulary-sync: schema/vex-vocabulary.json is STALE — re-run without --check`);
      process.exit(1);
    }
    console.log(`vex-vocabulary-sync: corpus is current (${vocab.total} legal values)`);
  } else {
    writeFileSync(OUT, json);
    console.log(`vex-vocabulary-sync: ${vocab.total} legal values → schema/vex-vocabulary.json`);
    for (const [fmt, axes] of Object.entries(vocab.formats)) {
      console.log(`  ${fmt.padEnd(11)}${Object.entries(axes).map(([a, v]) => `${a}=${v.length}`).join('  ')}`);
    }
  }
}
