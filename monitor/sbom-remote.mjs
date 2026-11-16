// sbom-remote.mjs — one component per remote package, not one per file it serves.
//
// syft catalogues each `remote` entry of a deno.lock as a component, and a remote package is many files:
// one scanned site's lock gave 389 components for 13 packages (deno.land/std@0.216.0 alone was 184). It also
// parses esm.sh URLs wrongly — https://esm.sh/@babel/helper-validator-identifier@7.22.20 became name
// `esm.sh/`, version `babel`. The native document keeps each entry's real URL (metadata.url), so the
// package is derived from that, and the files it served are merged into one component that records how
// many there were. Nothing is dropped: every file is still counted, and its integrity is in the lockfile.

/** A remote module URL -> { name, version, base, registry } or null when the URL names no versioned package. */
export function parseRemoteUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname;
  if (u.hostname === 'deno.land') {
    const m = /^\/(std|x\/[^/@]+)@([^/]+)/.exec(path);
    if (!m) return null;
    const name = `deno.land/${m[1]}`;
    return { name, version: m[2], base: `https://deno.land/${m[1]}@${m[2]}`, registry: 'https://deno.land' };
  }
  if (u.hostname === 'esm.sh') {
    // optional `*` (external deps) and a build prefix such as /v135/, then the npm specifier
    const m = /^\/\*?(?:v\d+\/)?((?:@[^/@]+\/)?[^/@]+)@([^/?]+)/.exec(path);
    if (!m) return null;
    return { name: m[1], version: m[2], base: `https://esm.sh/${m[1]}@${m[2]}`, registry: 'https://esm.sh' };
  }
  return null;
}

const nativeId = (c) => /[?&]package-id=([0-9a-f]+)/.exec(c['bom-ref'] || '')?.[1] || null;
const locationOf = (c) => (c.properties || []).find((p) => /location:0:path$/.test(p.name || ''))?.value || '';

/**
 * Merge per-file remote components into one per package and location, and correct their identity.
 * @returns {{ cdx: object, report: object }} — cdx is mutated in place.
 */
export function collapseRemote(cdx, native) {
  const report = { ran: false, remoteEntries: 0, packages: 0, merged: 0, renamed: 0, unparsed: 0 };
  const urls = new Map();
  for (const a of native?.artifacts || []) if (a.metadataType === 'deno-remote-lock-entry' && a.metadata?.url) urls.set(a.id, a.metadata.url);
  if (!cdx || !urls.size) return { cdx, report };
  report.ran = true;

  const keep = new Map(); const replaced = new Map(); const out = [];
  for (const c of cdx.components || []) {
    const url = urls.get(nativeId(c));
    if (!url) { out.push(c); continue; }
    report.remoteEntries++;
    const p = parseRemoteUrl(url);
    if (!p) { report.unparsed++; out.push(c); continue; }
    const key = `${p.name}@${p.version}\u0000${locationOf(c)}`;
    const kept = keep.get(key);
    if (kept) {
      kept.files++;
      replaced.set(c['bom-ref'], kept.c['bom-ref']);
      report.merged++;
      continue;
    }
    if (c.name !== p.name || c.version !== p.version) report.renamed++;
    c.name = p.name; c.version = p.version;
    const ns = p.name.startsWith('@') ? `%40${p.name.slice(1)}` : encodeURIComponent(p.name);
    c.purl = `pkg:npm/${ns}@${p.version}?repository_url=${encodeURIComponent(p.registry)}`;
    delete c.cpe;
    c.properties = (c.properties || []).filter((x) => !/^commitwork:remote-/.test(x.name || ''));
    c.properties.push({ name: 'commitwork:remote-url', value: p.base });
    keep.set(key, { c, files: 1 });
    out.push(c);
  }
  for (const { c, files } of keep.values()) c.properties.push({ name: 'commitwork:remote-files', value: String(files) });
  report.packages = keep.size;
  cdx.components = out;

  if (replaced.size && Array.isArray(cdx.dependencies)) {
    const to = (r) => replaced.get(r) || r;
    const merged = new Map();
    for (const d of cdx.dependencies) {
      const ref = to(d.ref);
      const deps = new Set([...(merged.get(ref)?.dependsOn || []), ...(d.dependsOn || []).map(to)]);
      deps.delete(ref);
      merged.set(ref, { ref, dependsOn: [...deps] });
    }
    cdx.dependencies = [...merged.values()];
  }
  return { cdx, report };
}
