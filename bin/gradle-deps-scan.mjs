#!/usr/bin/env node
// commitwork — dependency CVEs for Gradle projects that ship NO LOCKFILE.
//
// THE GAP THIS FILLS. Every local scanner agrees at zero on a Gradle source tree: measured
// 2026-08-21 on ReactiveX_RxJava, ben-manes_caffeine and facebook_fresco, `trivy fs` catalogued 0
// packages, `grype dir:` returned 0 matches, and syft found ~1 Maven artifact. They agree because
// none of them parses build.gradle or gradle/libs.versions.toml, and a Gradle project is not
// obliged to commit a gradle.lockfile — most do not. osv-scanner can read
// gradle/verification-metadata.xml, but none of the seven Gradle repos in the corpus ships one.
// The result was five repos catalogueing zero packages and reporting a clean bill of health.
//
// WHY NOT JUST RUN GRADLE. Everything that resolves a Gradle graph properly — cdxgen, OWASP
// dependency-check, GitHub's own dependency-submission action — does it by EXECUTING THE BUILD.
// build.gradle is arbitrary Groovy or Kotlin. Running it is precisely the untrusted-code execution
// this fleet exists to detect, and the corpus is a hundred repositories nobody here owns. So the
// resolution is not done locally at all: it is READ FROM SOMEONE WHO ALREADY DID IT.
//
// deps.dev (Google) publishes resolved transitive graphs for published Maven artifacts. Given a
// group:artifact:version this returns the closure the ecosystem itself resolves, with no build, no
// lockfile and no code execution. Verified live 2026-08-21: guava 32.1.3-jre returned 7 transitive
// nodes including jsr305, error_prone_annotations and failureaccess.
//
// WHAT THIS IS NOT. It is a DECLARED-VERSION resolution, not the build's own. Gradle can override
// a version through constraints, resolutionStrategy, platform BOMs or a plugin, and none of that is
// visible here. So findings are a FLOOR, and the report says so — `resolution: "declared"` rides in
// the output rather than being left for a reader to infer. A floor that announces itself beats a
// zero that does not.
//
// usage: gradle-deps-scan.mjs <repoDir> --out <file> [--log <file>] [--offline]

import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ROOT = process.argv[2];
const OUT = arg('out');
const LOG = arg('log');
const OFFLINE = process.argv.includes('--offline');
if (!ROOT || !OUT) { console.error('usage: gradle-deps-scan.mjs <repoDir> --out <file> [--log <file>]'); process.exit(2); }

const log = (s) => { if (LOG) { try { appendFileSync(LOG, s + '\n'); } catch {} } else console.error(s); };
if (LOG) { try { writeFileSync(LOG, ''); } catch {} }

// ── 1. find version catalogs ────────────────────────────────────────────────────────────────
const SKIP = new Set(['.git', 'node_modules', 'build', 'vendor', 'reports', '.gradle']);
const catalogs = [];
(function walk(dir, depth) {
  if (depth > 4) return;
  let e; try { e = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const f of e) {
    const p = join(dir, f.name);
    if (f.isFile() && /^libs\.versions\.toml$/.test(f.name)) catalogs.push(p);
    else if (f.isDirectory() && !SKIP.has(f.name) && !f.name.startsWith('.')) walk(p, depth + 1);
  }
})(ROOT, 0);

// ── 2. parse them ───────────────────────────────────────────────────────────────────────────
// A deliberately small TOML reader: version catalogs are a fixed, documented shape, and pulling a
// TOML dependency into a zero-runtime-dependency repo to read two tables is a poor trade. Handles
// the three library spellings Gradle documents; anything else is COUNTED AS UNPARSED and reported,
// never silently dropped — an unparsed entry is a package this scan did not look at.
function parseCatalog(text) {
  const versions = {}, libs = [], unparsed = [];
  let section = null;
  // split(/\r?\n/): with a trailing `\r` the `#.*$` strip below is a NO-OP (`.` does not match
  // `\r`, and `$` without `m` only matches the end of the string), so a catalog entry carrying a
  // trailing comment kept it, failed the `^"([^"]*)"$` value match, and landed in `unparsed` —
  // which this file's own header defines as "a package this scan did not look at". Under-reporting
  // a dependency, quietly, on every Windows checkout.
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { section = sec[1]; continue; }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, key, val] = kv;
    if (section === 'versions') {
      const s = /^"([^"]*)"$/.exec(val); if (s) versions[key] = s[1];
      continue;
    }
    if (section !== 'libraries') continue;
    // form A: name = "group:artifact:version"
    const flat = /^"([^:"]+):([^:"]+):([^"]+)"$/.exec(val);
    if (flat) { libs.push({ key, group: flat[1], artifact: flat[2], versionLiteral: flat[3] }); continue; }
    // form B/C: name = { module = "g:a", version(.ref) = ... }  |  { group = "g", name = "a", ... }
    const mod = /module\s*=\s*"([^:"]+):([^"]+)"/.exec(val);
    const grp = /group\s*=\s*"([^"]+)"/.exec(val);
    const nm = /\bname\s*=\s*"([^"]+)"/.exec(val);
    const vref = /version\.ref\s*=\s*"([^"]+)"/.exec(val);
    const vlit = /version\s*=\s*"([^"]+)"/.exec(val);
    const group = mod ? mod[1] : grp ? grp[1] : null;
    const artifact = mod ? mod[2] : nm ? nm[1] : null;
    if (!group || !artifact) { unparsed.push(`${key} = ${val.slice(0, 60)}`); continue; }
    libs.push({ key, group, artifact, versionRef: vref ? vref[1] : null, versionLiteral: vlit ? vlit[1] : null });
  }
  return { versions, libs, unparsed };
}

// ── 2b. SYNTHESISE a catalog where none is committed ────────────────────────────────────────
// Most Gradle projects have no version catalog. The two shapes that dominate, measured 2026-08-21:
//
//   ReactiveX_RxJava   `testImplementation "org.mockito:mockito-core:$mockitoVersion"` with
//                      `mockitoVersion = "5.23.0"` in an ext block — interpolated
//   facebook_fresco    `const val jsr305 = "com.google.code.findbugs:jsr305:3.0.2"` in buildSrc,
//                      referenced as `Deps.jsr305` — indirected, but the COORDINATE is a literal
//
// Neither needs Gradle to run, so the catalog is reconstructed rather than demanded.
//
// THE FALSE-POSITIVE RISK IS THE WHOLE DIFFICULTY and it points one way: inventing packages, then
// reporting real CVEs against them. "a:b:c" matches many strings that are not Maven coordinates —
// fresco's dependencies.kt sits beside `val url = "https://scontent.example/x.jpg?a=1"`. So the
// group must look like a reverse domain, and anything with a path separator, space or scheme is
// refused. A missed dependency is a gap this lane already reports; a fabricated one is not.
// fact: either quote delimits a coordinate / Groovy build.gradle writes implementation 'g:a:v' in single quotes, and a double-quote-only pattern read log4j-core 2.14.1 as zero coordinates and left the lane noscan, measured 2026-10-04 (expiry: never, prev: broken)
const COORD = /(["'])([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+):([A-Za-z0-9_.-]+):([^"'\s]+)\1/g;
const VAR_DEF = /(?:const\s+val|val|var|def)?\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:]\s*["']([^"'\s]+)["']/g;
const BUILD_FILE = /\.(gradle|gradle\.kts|kts|kt)$/;

// Depth 10, not 5. A JVM package directory is inherently deep, and the convention puts build
// constants at the bottom of one: fresco's dependencies.kt lives at
// buildSrc/src/main/java/com/facebook/fresco/buildsrc/dependencies.kt — depth EIGHT. A limit of 5
// found nothing there and the lane refused a repo whose 769 dependency declarations were all
// sitting in one readable file. The SKIP set does the real pruning (.git, node_modules, build,
// vendor), so the extra levels cost little: measured at 0.4s on facebook_fresco.
function scanBuildFiles(root) {
  const files = [];
  (function walk(dir, depth) {
    if (depth > 10) return;
    let e; try { e = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const f of e) {
      const p = join(dir, f.name);
      if (f.isFile() && (BUILD_FILE.test(f.name) || f.name === 'gradle.properties')) files.push(p);
      else if (f.isDirectory() && !SKIP.has(f.name) && !f.name.startsWith('.')) walk(p, depth + 1);
    }
  })(root, 0);
  return files;
}

function synthesise(root) {
  const vars = new Map(); const coords = [];
  const files = scanBuildFiles(root);
  // Two passes: every variable in the tree is collected before any interpolation is attempted,
  // because the definition routinely lives in a different file from the use (RxJava keeps its
  // versions in the root build.gradle and its dependencies in each subproject's).
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(VAR_DEF)) if (/^[\w.+-]+$/.test(m[2])) vars.set(m[1], m[2]);
  }
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(COORD)) {
      const [, quote, group, artifact, rawVer] = m;
      if (m[0].includes('//') || rawVer.includes('/')) continue; // a URL, not a coordinate
      if (quote === "'" && rawVer.includes('$')) continue; // Groovy interpolates only double-quoted strings
      let version = rawVer;
      const interp = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(rawVer);
      if (interp) {
        const v = vars.get(interp[1]);
        if (!v) continue; // unresolvable variable — counted by the caller, never guessed
        version = v;
      } else if (rawVer.includes('$')) continue; // partial interpolation; not worth a guess
      if (!/^[\w.+-]+$/.test(version)) continue;
      coords.push({ group, artifact, version, from: relative(root, f) });
    }
  }
  return coords;
}

const direct = new Map(); // "g:a:v" -> {group, artifact, version, from}
let unparsedTotal = 0, unresolvedVersion = 0;
for (const c of catalogs) {
  const { versions, libs, unparsed } = parseCatalog(readFileSync(c, 'utf8'));
  unparsedTotal += unparsed.length;
  for (const u of unparsed) log(`  unparsed entry in ${relative(ROOT, c)}: ${u}`);
  for (const l of libs) {
    const v = l.versionLiteral || (l.versionRef ? versions[l.versionRef] : null);
    // A catalog entry with no resolvable version is a BOM-managed or plugin-supplied coordinate.
    // It is counted and reported, not guessed at: inventing a version would query the wrong package.
    if (!v) { unresolvedVersion++; continue; }
    direct.set(`${l.group}:${l.artifact}:${v}`, { group: l.group, artifact: l.artifact, version: v, from: relative(ROOT, c) });
  }
}

const fromCatalog = direct.size;
// Synthesis runs ALWAYS, not only as a fallback: a project with a version catalog can still declare
// coordinates inline (ben-manes_caffeine does, in its example subprojects), and taking the catalog
// as the complete picture would under-report exactly where the project is least tidy.
let synthesised = 0;
for (const c of synthesise(ROOT)) {
  const key = `${c.group}:${c.artifact}:${c.version}`;
  if (!direct.has(key)) { direct.set(key, c); synthesised++; }
}

log(`catalogs: ${catalogs.length}${catalogs.length ? ` (${catalogs.map((c) => relative(ROOT, c)).join(', ')})` : ''}`);
log(`direct coordinates: ${direct.size} (${fromCatalog} from catalog, ${synthesised} synthesised from build files)`
  + `   unresolved-version: ${unresolvedVersion}   unparsed: ${unparsedTotal}`);

if (!direct.size) {
  // Nothing resolvable from either source. Leave NO report — the lane must read as noscan, not as a
  // clean scan of a project whose dependencies were never enumerated.
  log('no resolvable dependency coordinates from catalog or build files — leaving no report so this reads as noscan, not clean');
  process.exit(1);
}
if (OFFLINE) { log('--offline: stopping after extraction'); writeFileSync(OUT, JSON.stringify({ resolution: 'declared', direct: [...direct.values()], offline: true }, null, 1)); process.exit(0); }

// ── 3. resolve the transitive closure via deps.dev ──────────────────────────────────────────
const DEPSDEV = 'https://api.deps.dev/v3alpha/systems/maven/packages';
const enc = (g, a) => encodeURIComponent(`${g}:${a}`);
async function closureOf(d) {
  const url = `${DEPSDEV}/${enc(d.group, d.artifact)}/versions/${encodeURIComponent(d.version)}:dependencies`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, nodes: (j.nodes || []).map((n) => n.versionKey).filter(Boolean) };
  } catch (e) { return { ok: false, why: e.message.slice(0, 60) }; }
}

const all = new Map(); // "g:a:v" -> {group,artifact,version,direct:boolean}
for (const [k, d] of direct) all.set(k, { ...d, direct: true });

let resolved = 0, failed = 0;
const items = [...direct.values()];
const CONC = 8;
for (let i = 0; i < items.length; i += CONC) {
  const batch = await Promise.all(items.slice(i, i + CONC).map(closureOf));
  batch.forEach((res, j) => {
    const d = items[i + j];
    if (!res.ok) { failed++; log(`  deps.dev failed for ${d.group}:${d.artifact}:${d.version} — ${res.why}`); return; }
    resolved++;
    for (const n of res.nodes) {
      const key = `${n.name}:${n.version}`;
      if (!all.has(key)) {
        const [g, a] = String(n.name).split(':');
        all.set(key, { group: g, artifact: a, version: n.version, direct: false });
      }
    }
  });
  log(`  resolved ${Math.min(i + CONC, items.length)}/${items.length} direct coordinates`);
}

// A resolution that reached NOTHING is not a clean scan of a small project — it is a scan that did
// not happen, most often the network being unavailable. Refuse it the same way every other lane here
// refuses an empty catalogue.
if (resolved === 0) {
  log(`REFUSING to report: deps.dev resolved 0 of ${items.length} coordinates (${failed} failures). Leaving no report.`);
  process.exit(1);
}

// ── 4. query OSV by purl ────────────────────────────────────────────────────────────────────
const pkgs = [...all.values()];
const queries = pkgs.map((p) => ({ package: { name: `${p.group}:${p.artifact}`, ecosystem: 'Maven' }, version: p.version }));
const findings = [];
let osvBatches = 0, osvFailed = 0;
for (let i = 0; i < queries.length; i += 500) {
  const slice = queries.slice(i, i + 500);
  try {
    const r = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: slice }), signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) { osvFailed++; log(`  osv batch HTTP ${r.status}`); continue; }
    const j = await r.json();
    // NO `|| []` DEFAULT ON THE RESULT SET. A 200 whose body carries no `results` array is a batch
    // that did not answer, and defaulting it to empty would convert that void into "none of these
    // 500 packages is vulnerable" — a clean bill of health issued by a request that failed. Count it
    // as a failure so the refusal below can see it; the same rule monitor/sarif-read.mjs enforces
    // for scanner documents, and the gate that guards that rule is what caught this line.
    if (!Array.isArray(j.results)) {
      osvFailed++;
      log(`  osv batch returned no results array (${Object.keys(j || {}).join(',') || 'empty body'}) — counted as a failure, not as zero findings`);
      continue;
    }
    osvBatches++;
    j.results.forEach((res, k) => {
      const p = pkgs[i + k];
      for (const v of (res.vulns || [])) findings.push({ id: v.id, package: `${p.group}:${p.artifact}`, version: p.version, direct: p.direct });
    });
  } catch (e) { osvFailed++; log(`  osv batch failed — ${e.message.slice(0, 60)}`); }
}
if (osvBatches === 0) { log('REFUSING to report: no OSV batch succeeded. Leaving no report.'); process.exit(1); }

// ── SARIF, so the existing reader owns this lane too ────────────────────────────────────────
// Emitting a bespoke format would have meant teaching monitor/extractors.mjs a tenth way to decide
// whether a scan happened — and that decision was JUST consolidated into monitor/sarif-read.mjs
// precisely because nine hand-rolled copies each scored a scanner that never ran as a clean scan.
// A new format would reopen what those commits closed, so this speaks the one the reader already
// guards.
//
// THE FLOOR CLAIM RIDES IN THE DOCUMENT, not only in the sidecar JSON. A reader who sees 59
// findings and not `resolution: declared` will take them for the whole exposure, and Gradle
// constraints, resolutionStrategy, platform BOMs and plugins can each override a declared version
// invisibly. So it is stated on the run's own invocation and repeated in every result's message —
// the count and the caveat cannot be separated by anything downstream that keeps only one of them.
const sarif = {
  version: '2.1.0',
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  runs: [{
    tool: { driver: { name: 'gradle-deps-scan', informationUri: 'https://deps.dev',
      rules: [...new Set(findings.map((f) => f.id))].map((id) => ({ id, shortDescription: { text: id } })) } },
    invocations: [{
      executionSuccessful: true,
      // Not decoration: this is the provenance a later reader needs to judge the count above it.
      workingDirectory: { uri: `file://${ROOT}` },
      properties: {
        resolution: 'declared',
        note: 'Direct coordinates read from version catalogs and build files; transitive closure from deps.dev. '
          + 'A declared version can be overridden by Gradle constraints/resolutionStrategy/BOMs/plugins, so this is a FLOOR.',
        directCoordinates: direct.size, totalPackages: all.size,
        depsDevResolved: resolved, depsDevFailed: failed,
      },
    }],
    results: findings.map((f) => ({
      ruleId: f.id,
      level: 'warning',
      message: { text: `${f.id} in ${f.package}@${f.version}${f.direct ? ' (direct)' : ' (transitive)'} — declared-version resolution, a floor not a ceiling` },
      locations: [{ physicalLocation: { artifactLocation: { uri: catalogs.length ? catalogs.map((c) => relative(ROOT, c))[0] : 'build.gradle' } } }],
    })),
  }],
};
writeFileSync(OUT.replace(/\.json$/, '') + '.sarif', JSON.stringify(sarif, null, 1));
log(`wrote ${OUT.replace(/\.json$/, '')}.sarif: ${findings.length} results in SARIF for the shared reader`);

const out = {
  resolution: 'declared',
  resolutionNote: 'Versions come from gradle/libs.versions.toml as DECLARED, with transitive closure from deps.dev. '
    + 'Gradle constraints, resolutionStrategy, platform BOMs and plugins can all override a declared version and are '
    + 'not visible here, so this is a FLOOR on the real exposure, never a ceiling.',
  catalogs: catalogs.map((c) => relative(ROOT, c)),
  counts: { direct: direct.size, transitive: all.size - direct.size, total: all.size,
    unresolvedVersion, unparsed: unparsedTotal, depsDevResolved: resolved, depsDevFailed: failed },
  findings,
};
writeFileSync(OUT, JSON.stringify(out, null, 1));
log(`wrote ${OUT}: ${all.size} packages (${direct.size} direct, ${all.size - direct.size} transitive), ${findings.length} vulnerability findings`);
