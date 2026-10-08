// sbom-provenance.mjs — stop the SBOM asserting a registry identity for something never on a registry.
//
// THE DEFECT, measured 2026-08-26 on firebase_firebase-js-sdk with syft 1.51.0. closure-net is
// pinned from github.com/google/closure-net, and the published CycloneDX says:
//
//   purl: pkg:npm/closure-net@0.0.0
//   cpe:  cpe:2.3:a:closure-net:closure-net:0.0.0:*:*:*:*:*:*:*
//   properties: foundBy / language / type / metadataType / location:0:path
//
// — a property set BYTE-IDENTICAL in shape to rimraf@5.0.10 beside it, no externalReferences, no
// VCS marker of any kind. npm has never served closure-net@0.0.0; the registry holds only
// 0.0.1-security, the takedown placeholder. So the document states an identity that does not exist.
//
// This is worse than a scanner false positive, and the priority stack says so. commitwork ships
// these through cra/sbom.mjs as CRA Annex I Part II (1) evidence — the component inventory a
// regulator or customer reads. A wrong SBOM is a claim we make about ourselves, and it is the
// number a reader can check.
//
// It is also the MERGE KEY. cra/sbom.mjs dedupes components on purl, so two artifacts that are
// genuinely different — a git checkout and a registry package that happen to share a name and a
// version — collapse into one row. Correcting the purl fixes the identity and the dedupe together.
//
// SYFT ALREADY KNOWS. This is not a limitation to work around: the NATIVE json carries
// `metadata.resolved` for all 2,297 artifacts of that scan, git and registry alike. The CycloneDX
// writer is where the fact is discarded. So the repair is to emit both from one scan and put back
// what the conversion dropped — never to reconstruct it by guessing, and never from the network.
//
// WHAT IT WRITES, and why the purl itself has to change: adding a note beside a false claim leaves
// the false claim. package-url defines a `vcs_url` qualifier for exactly this case, so the corrected
// identity is `pkg:npm/closure-net@0.0.0?vcs_url=<encoded>`, which no longer collides with a
// registry package of the same name. Alongside it an externalReferences entry of type `vcs` (or
// `distribution` for a bare archive), which is where a CycloneDX consumer looks.
//
// NEVER DROPS A COMPONENT. An SBOM that omits a dependency is worse than one that misdescribes it:
// the omission is invisible, and an inventory is judged on completeness first.
//
// Env: CW_SBOM_PROVENANCE=off disables enrichment; read at CALL time.

import { classifyResolution } from './dep-provenance.mjs';

export const enabled = () => process.env.CW_SBOM_PROVENANCE !== 'off';

/** CycloneDX externalReference type for a resolution class. Registry needs none — that is the
 *  identity the bare purl already asserts, and asserting it twice adds nothing. */
const REF_TYPE = { git: 'vcs', archive: 'distribution', file: 'distribution' };

/** purl qualifier name per package-url. `vcs_url` is the spec's own word for this. */
const QUALIFIER = { git: 'vcs_url', archive: 'download_url', file: 'download_url' };

/** Index the native syft document by the keys a CycloneDX component can be matched on. */
export function indexNative(nativeDoc) {
  const byPurl = new Map(); const byNameVersion = new Map();
  for (const a of (nativeDoc && nativeDoc.artifacts) || []) {
    const resolved = a && a.metadata && typeof a.metadata.resolved === 'string' ? a.metadata.resolved : '';
    if (!resolved) continue;
    if (a.purl && !byPurl.has(a.purl)) byPurl.set(a.purl, resolved);
    const k = `${a.name}@${a.version}`;
    if (!byNameVersion.has(k)) byNameVersion.set(k, resolved);
  }
  return { byPurl, byNameVersion };
}

/** Syft's native json names itself; a bare `{artifacts: []}` is a stub, not a reference. */
export function isSyftNative(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.artifacts)) return false;
  return (doc.descriptor && doc.descriptor.name === 'syft') || !!(doc.schema && doc.schema.version);
}

/** Artifact counts by purl type, sorted for byte-identical reports. */
function purlTypes(artifacts) {
  const n = {};
  for (const a of artifacts) {
    const m = /^pkg:([^/]+)\//.exec(String((a && a.purl) || ''));
    const t = m ? m[1] : (a && a.type) || 'unknown';
    n[t] = (n[t] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(n).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Append a qualifier to a purl, preserving any already present. Deterministic ordering. */
export function purlWithQualifier(purl, key, value) {
  const s = String(purl || '');
  if (!s || !key) return s;
  const enc = encodeURIComponent(String(value));
  const [base, frag] = s.split('#');
  const [path, query] = base.split('?');
  const parts = query ? query.split('&').filter(Boolean) : [];
  if (parts.some((p) => p.startsWith(`${key}=`))) return s;   // already stated; do not restate
  parts.push(`${key}=${enc}`);
  parts.sort();                                                // byte-identical output across runs
  return `${path}?${parts.join('&')}${frag ? `#${frag}` : ''}`;
}

/**
 * Put back what the CycloneDX writer dropped.
 *
 * @param {object} cdx    the CycloneDX document (mutated in place and returned)
 * @param {object} native syft's own json for the SAME scan
 * @returns {{cdx: object, report: object}}
 */
export function enrich(cdx, native) {
  const components = (cdx && cdx.components) || [];
  const report = { ran: true, enabled: enabled(), components: components.length,
    enriched: 0, byResolution: {}, unmatched: 0, note: '' };
  if (!enabled() || !cdx) { report.ran = false; report.enabled = false; return { cdx, report }; }

  const { byPurl, byNameVersion } = indexNative(native);
  if (!byPurl.size && !byNameVersion.size) {
    // FAIL CLOSED unless the reference is really syft's own document. An empty index had three
    // causes sharing this branch, and the note named only the first, about documents it had read:
    // measured 2026-09-18, 69 repos failed the lane, ~10 with no dependencies and ~59 whose
    // ecosystems carry no metadata.resolved (Go, Python, Java, non-npm lockfiles).
    const artifacts = isSyftNative(native) ? native.artifacts : null;
    if (artifacts && artifacts.length === 0 && components.length === 0) {
      report.artifacts = 0;
      report.note = 'nothing to inventory — syft catalogued 0 artifacts and the CycloneDX carries 0 components, so there is no identity to correct';
      return { cdx, report };
    }
    report.ran = false;
    report.unknown = true;
    if (artifacts) {
      // Read, but syft recorded no resolution for any artifact. CRA still reads ran:false as unenriched.
      report.unknownReason = 'unstated';
      report.artifacts = artifacts.length;
      report.byType = purlTypes(artifacts);
      report.note = `syft's native document was read: ${artifacts.length} artifact(s), none carrying metadata.resolved, so no component could be corrected or verified — provenance is unverified, not clean`;
      return { cdx, report };
    }
    report.unknownReason = 'no-reference';
    report.note = 'no syft native document to read resolutions from, so the CycloneDX was NOT corrected — every git-sourced component still asserts a registry identity. This is unenriched, not verified.';
    return { cdx, report };
  }

  for (const c of components) {
    if (!c || typeof c !== 'object') continue;
    const resolved = byPurl.get(c.purl) || byNameVersion.get(`${c.name}@${c.version}`) || '';
    if (!resolved) { report.unmatched++; continue; }
    const cls = classifyResolution(resolved);
    report.byResolution[cls] = (report.byResolution[cls] || 0) + 1;
    // A registry resolution is what the bare purl already says. Restating it adds bytes and no fact.
    if (cls === 'registry') continue;
    // `unknown` is our own blind spot, not a provenance claim — record the count, assert nothing.
    if (cls === 'unknown') continue;

    const q = QUALIFIER[cls];
    if (q && c.purl) c.purl = purlWithQualifier(c.purl, q, resolved);
    const rt = REF_TYPE[cls];
    if (rt) {
      c.externalReferences = Array.isArray(c.externalReferences) ? c.externalReferences : [];
      if (!c.externalReferences.some((r) => r && r.type === rt && r.url === resolved)) {
        c.externalReferences.push({ type: rt, url: resolved,
          comment: `resolved from a ${cls} source, not a package registry — recorded because the bare purl would otherwise assert a registry identity this component does not have` });
      }
    }
    c.properties = Array.isArray(c.properties) ? c.properties : [];
    if (!c.properties.some((p) => p && p.name === 'commitwork:resolution')) {
      c.properties.push({ name: 'commitwork:resolution', value: cls });
    }

    // THE SCHEMA'S OWN SLOT FOR THIS, and the one that names the defect rather than routing around
    // it. CycloneDX 1.5 added component.evidence.identity so a tool can say HOW it concluded an
    // identity and with what confidence; 1.6 made it an array. Verified against bom-1.7.schema.json:
    // `field` accepts "purl", methods[].technique accepts "manifest-analysis", and only `field` is
    // required — so the raw evidence can be recorded without inventing an overall confidence number.
    //
    // This matters more than the externalReference. The defect was never "a URL went missing"; it
    // was that a purl concluded from a GIT resolution was published indistinguishably from one
    // concluded from a registry, at an implied confidence of 1.0 nobody stated. Recording the
    // method and the value it was read from is the difference between an assertion and evidence —
    // which is the same distinction this repository applies to its own findings.
    //
    // No `confidence` is emitted. The schema permits omitting it, and a number invented here would
    // be exactly the unfounded precision the field exists to prevent.
    c.evidence = (c.evidence && typeof c.evidence === 'object') ? c.evidence : {};
    const identity = Array.isArray(c.evidence.identity) ? c.evidence.identity
      : (c.evidence.identity ? [c.evidence.identity] : []);   // 1.5 single-object form, normalised
    if (!identity.some((i) => i && i.field === 'purl' && i.concludedValue === c.purl)) {
      identity.push({ field: 'purl', concludedValue: c.purl,
        methods: [{ technique: 'manifest-analysis', confidence: 1, value: resolved }] });
    }
    c.evidence.identity = identity;
    report.enriched++;
  }

  report.note = report.enriched
    ? `${report.enriched} of ${report.components} components resolve from something other than a package registry. Each carries a vcs_url/download_url purl qualifier and an externalReferences entry, so its identity no longer collides with a registry package of the same name — which matters because cra/sbom.mjs dedupes on purl. No component is dropped.`
    : '';
  return { cdx, report };
}

export default { enrich, indexNative, purlWithQualifier, enabled };
