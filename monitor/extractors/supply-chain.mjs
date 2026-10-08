// monitor/extractors/supply-chain.mjs — the dependency and package-integrity lanes (Socket aside).
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23, from eight stretches of the old file.
// Every reader here answers a question about what a project PULLS IN rather than what it wrote:
//   - advisories: trivy (depsJvm), OSV's MAL- records (maliciousPackages), govulncheck (depsGo,
//     where reachability is the point), retire.js (depsRetire, identity by file content);
//   - second opinions on OSV's own universe, non-additive by design: cargo-audit (depsRustAudit)
//     and bundler-audit (depsBundlerAudit), and dep-scan (depsReachability), which adjudicates;
//   - integrity and heuristics: the Gradle wrapper fetch path (gradleWrapper), GuardDog
//     (supplyChainHeuristic), which reads through ./sarif.mjs, and dependency content
//     (depsContent): install hooks, lockfile integrity, installed-vs-locked drift.
// Socket reads its own artifact vocabulary and has its own module, ./socket.mjs.
//
// Order is the original's, so the cross-references between neighbours still read true —
// bundler-audit's "cargo-audit's lane above" among them.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseFile } from '../safe-parse.mjs';
import { readSarif, ruleIndex } from '../sarif-read.mjs';
import { classifyPath } from '../fixture-paths.mjs'; // a test corpus is a different population, not a cleaner one
import { classify as classifyReach, NOTE as REACH_NOTE } from '../advisory-reach.mjs'; // a name collision is not an installed package
import { _zero, _emptyArtifact, _detailFor, _ecosystemOf, capMessage, _wtBucket, _setAsideWorktree, _worktreesOf } from './core.mjs';
import { _sarifCounts } from './sarif.mjs';

// cargo-audit's parser, written against REAL output (2026-08-28, memory-layer: 18 advisories over 719
// resolved dependencies). SEVERITY IS NOT MINTED: RustSec publishes CVSS VECTORS, not scores, so
// every advisory counts in `undetermined` — outside crit/high/med/low — with the vector preserved
// on its row. The lane is non-additive 'duplicate' (same advisory universe as deps-osv via the
// RustSec→OSV import); its published value is DISAGREEMENT with the osv row for the same crate.
// Warnings (unmaintained / unsound / yanked) are counted in `warned`, never folded into total.
export function _cargoAuditCounts(dir, file) {
  const p = join(dir, file);
  if (!existsSync(p)) return null;          // absent is absent — the lane did not produce
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let exit = 0;
  try { exit = parseInt(readFileSync(`${p}.exit`, 'utf8').trim(), 10) || 0; } catch { /* no sidecar: vintage artifact */ }
  let j; try { j = JSON.parse(raw); } catch {
    return { ..._zero(), ran: true, ...(exit > 1 ? { toolfailed: true } : { unparseable: true }) };
  }
  const v = j && j.vulnerabilities;
  if (!v || typeof v !== 'object' || !('count' in v)) return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const item of Array.isArray(v.list) ? v.list : []) {
    const a = (item && item.advisory) || {};
    const pkg = (item && item.package) || {};
    c.total++;
    rows.push({
      rule: String(a.id || 'RUSTSEC'),
      package: String(a.package || pkg.name || ''),
      version: String(pkg.version || ''),
      sev: '',                              // undetermined by design — the vector is not a score
      message: capMessage(`${a.title || ''}${a.cvss ? ` [${a.cvss}]` : ''}${item && item.versions && Array.isArray(item.versions.patched) && item.versions.patched.length ? ` — patched: ${item.versions.patched.join(', ')}` : ''}`),
    });
  }
  c.undetermined = c.total;
  const w = j.warnings;
  if (w && typeof w === 'object') {
    c.warned = Object.values(w).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  }
  return { ...c, ..._detailFor('depsRustAudit', rows) };
}
// bundler-audit's parser, written against a REAL run (0.9.3, verified 2026-09-01: 40 advisories over
// a 2-gem fixture Gemfile.lock via ruby-advisory-db). Same shape as cargo-audit's lane above and the
// same reason it is `duplicate`: OSV already reads Gemfile.lock for the same advisory universe (OSV
// imports the Ruby advisory DB the way it imports RustSec), so this is the second opinion, not
// additive coverage. Unlike RustSec's cargo-audit, `criticality` IS a real bucket here
// (low/medium/high/critical), not a bare CVSS vector — but it can be null (measured: 5 of 40 rows in
// the fixture run), and a null criticality is undetermined, never defaulted to a guessed bucket.
export function _bundlerAuditCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  if (!j || !Array.isArray(j.results)) return { ..._zero(), ran: true, unparseable: true };
  const map = { low: 'low', medium: 'med', high: 'high', critical: 'crit' };
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const r of j.results) {
    // insecure_source / unpatched_ruby are declared by bundler-audit's own docs but not exercised
    // by this fixture run — parsed only when a real one is observed, per this file's own rule for
    // every stub above (absent is absent; a shape nobody has seen reads unparseable, never zero).
    if (r.type !== 'unpatched_gem') continue;
    const adv = r.advisory || {}; const gem = r.gem || {};
    const b = map[String(adv.criticality || '').toLowerCase()];
    if (b) c[b]++; else c.undetermined = (c.undetermined || 0) + 1;
    c.total++;
    const patched = Array.isArray(adv.patched_versions) && adv.patched_versions.length
      ? ` — patched: ${adv.patched_versions.join(', ')}` : '';
    rows.push({
      rule: String(adv.id || ''), package: String(gem.name || ''), version: String(gem.version || ''),
      sev: b || '', message: capMessage(`${String(adv.title || '')}${patched}`),
    });
  }
  return { ...c, ..._detailFor('depsBundlerAudit', rows) };
}
export function _trivyCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  const c = { ..._zero(), ran: true }, map = { CRITICAL: 'crit', HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
  const rows = [];
  for (const res of j.Results || []) for (const v of res.Vulnerabilities || []) {
    const b = map[(v.Severity || '').toUpperCase()]; if (!b) continue;
    c[b]++; c.total++;
    rows.push({ id: v.VulnerabilityID, package: v.PkgName, version: v.InstalledVersion, sev: b, fixed: v.FixedVersion });
  }
  return { ...c, ..._detailFor('depsJvm', rows) };
}
// MAL- advisories (the OpenSSF malicious-packages feed, ingested by osv.dev) ride in on osv.sarif
// ALONGSIDE ordinary CVEs. Counting only those lets the fleet state "malicious packages" as a number
// that CVE volume cannot dilute — 1 worm among 246 CVEs is not a rounding error. Every hit is `crit`:
// a confirmed-malicious package has no severity gradient. osv-scanner groups aliases, so the MAL id
// is often not the primary ruleId; it is matched wherever it appears (see bin/commitwork.mjs).
// Returns null when the artifact is ABSENT so the ran/skipped/noscan join below reports the void
// rather than a zero — the S2 contract this file's next comment block exists to enforce.
const _MAL_ID = /\bMAL-\d{4}-\d+\b/;
export function _malCounts(dir, file) {
  // Same typed-state mapping as _sarifCounts
  const r = readSarif(join(dir, file));
  if (r.state === 'absent' || r.state === 'unreadable') return null;
  // `empty` has TWO live meanings and this is the one place that must not merge them: a self-gated
  // check with genuinely no source, and a tool killed before it wrote a byte. Both keep `nosrc` so
  // existing consumers still render grey; `emptyArtifact` is the discriminator a void-carry needs.
  if (r.state === 'empty') return { ..._zero(), ran: true, nosrc: true, emptyArtifact: true };
  if (r.state === 'unparseable') return { ..._zero(), ran: true, unparseable: true };
  if (r.state === 'never-ran') return { ..._zero(), ran: true, neverran: true };
  if (r.state === 'tool-failed') return { ..._zero(), ran: true, toolfailed: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  const fx = { crit: 0, total: 0, byPattern: {}, rows: [] };
  const un = { total: 0, byCode: {}, rows: [] };
  for (const run of r.runs) {
    const rules = ruleIndex(run);
    for (const res of run.results) {
      const rule = rules[res.ruleId] || {};
      const msg = (res.message && res.message.text) || '';
      const hay = [res.ruleId, rule.id,
        rule.shortDescription && rule.shortDescription.text, rule.fullDescription && rule.fullDescription.text,
        msg].filter((s) => typeof s === 'string').join('\n');
      const mal = hay.match(_MAL_ID);
      if (!mal) continue;
      // the same message grammar parseOsv reads, but greedy on the name so a scoped package
      // ('@ctrl/tinycolor@4.1.1') keeps its scope instead of failing the match
      const pm = msg.match(/Package '([^']+)@([^']+)'/);
      const loc = res.locations && res.locations[0] && res.locations[0].physicalLocation;
      // A confirmed-malicious package inside a TEST FIXTURE is a different claim from one in the
      // dependency tree. Measured 2026-08-24: 24 of the fleet's 25 MAL- rows were dependabot-core
      // fixtures, including flatmap-stream, the real 2018 event-stream attack kept deliberately so
      // the updater can be proven to remove it. Counted apart, never dropped — the SARIF is intact
      // and the row keeps its identity, because a worm that reaches a fixture directory is still
      // something an operator may want to look at.
      const fcls = classifyPath((loc && loc.artifactLocation && loc.artifactLocation.uri) || '');
      if (fcls.fixture) {
        fx.crit++; fx.total++;
        fx.byPattern[fcls.pattern] = (fx.byPattern[fcls.pattern] || 0) + 1;
        fx.rows.push({ id: mal[0], package: pm ? pm[1] : '', version: pm ? pm[2] : '', pattern: fcls.pattern });
        continue;
      }
      const uri = (loc && loc.artifactLocation && loc.artifactLocation.uri) || '';
      const version = pm ? pm[2] : '';
      // Fixture FIRST, then reachability: which population a row describes is the stronger
      // statement, and a fixture row is set aside whether or not the advisory reaches it.
      // A MAL- advisory with `introduced: 0` matches every version of a NAME, so a collision
      // publishes a critical about a package the repo never installed — measured 3 for 3 false
      // here once the fixture rows were removed. Counted apart under `undetermined`, never
      // dropped, and never restated as safe. See advisory-reach.mjs.
      const reach = classifyReach({ id: mal[0], version, path: uri });
      if (!reach.reachable) {
        un.total++;
        un.byCode[reach.code] = (un.byCode[reach.code] || 0) + 1;
        un.rows.push({ id: mal[0], package: pm ? pm[1] : '', version, ecosystem: _ecosystemOf(uri),
          unknown: true, unknownReason: reach.unknownReason,
          code: reach.code, reason: reach.reason, claimedSeverity: 'crit' });
        continue;
      }
      c.crit++; c.total++;
      rows.push({ id: mal[0], package: pm ? pm[1] : '', version,
        ecosystem: _ecosystemOf(uri),
        advisory: `https://osv.dev/vulnerability/${mal[0]}` });
    }
  }
  const out = { ...c, ..._detailFor('maliciousPackages', rows) };
  if (fx.total) {
    out.fixtures = { ...fx, of: fx.total + c.total, note: `${fx.total} of ${fx.total + c.total} malicious-package hits are under a test-fixture path and are excluded from these counts. Each is listed in fixtures.rows and remains in the SARIF artifact. Set CW_FIXTURE_PATHS=off to count them.` };
  }
  if (un.total) {
    out.undetermined = un.total;
    out.undeterminedDetail = { ...un, of: un.total + c.total, note: REACH_NOTE };
  }
  return out;
}
// govulncheck emits JSON-lines of `{osv:…}` (an advisory definition) and `{finding:…}` (this module
// is affected). REACHABILITY IS THE WHOLE POINT of preferring it over OSV/grype, so it is preserved
// in the severity rather than flattened: a finding whose trace names a `function` is a proven call
// path (`high`); a module-level trace means govulncheck could not prove the vulnerable package is
// imported (`med` — present, unproven, frequently already mitigated). Counting both as one number
// would throw away the only thing this scanner knows that the others do not.
//
// govulncheck emits ONE finding per trace, so the same advisory arrives several times; findings are
// deduped by (osv id, reachable) so the count is advisories-at-a-reachability, not trace rows.
export function _govulnCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  const seen = new Set();
  const c = { ..._zero(), ran: true };
  const rows = [];
  // govulncheck -format json is a stream of concatenated objects, pretty-printed across lines —
  // NOT one object per line. Split on the top-level brace boundary the encoder emits.
  const chunks = raw.split(/\n(?=\{)/);
  for (const chunk of chunks) {
    const t = chunk.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    const f = o && o.finding; if (!f || !f.osv) continue;
    const reachable = (f.trace || []).some((e) => e && e.function);
    const key = `${f.osv} ${reachable ? 'R' : 'M'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (reachable) c.high++; else c.med++;
    c.total++;
    // REACHABILITY IS A TYPED FIELD, not a phrase in a sentence. The distinction lived only in this
    // prose, which was fine while govulncheck was the sole analyst — and stopped being fine the
    // moment dep-scan started writing to a sibling lane. Two engines emitting the word "reachable"
    // in free text make two very different claims look identical: govulncheck's is a path from the
    // Go compiler's own call graph, dep-scan's is a static slice over an intermediate representation.
    // `prover` and `proofKind` say WHOSE proof and WHAT KIND, so a consumer can weigh them
    // differently instead of matching on a string.
    //
    // `unproven` is deliberately NOT `unreachable`. govulncheck does not assert that a symbol cannot
    // be reached; it reports that it did not show a path. Publishing the stronger word would be the
    // in_triage defect that dep-scan's lane was corrected for.
    rows.push({ id: f.osv, package: (f.trace && f.trace[0] && f.trace[0].module) || '', sev: reachable ? 'high' : 'med',
      reachability: reachable ? 'reachable' : 'unproven',
      prover: 'govulncheck',
      proofKind: reachable ? 'compiler-callgraph' : 'none',
      message: reachable
        ? 'REACHABLE — govulncheck traced a call path to the vulnerable symbol'
        : 'present, unproven — the module is imported but no call path to the vulnerable symbol was shown' });
  }
  return { ...c, ..._detailFor('depsGo', rows) };
}

// bin/gradle-wrapper-verify.mjs — the wrapper FETCH PATH, checked without running anything.
//
// `applicable:false` is a repo with no Gradle wrapper, which is nothing-to-scan rather than a void:
// nosrc, the same state a deps lane uses for a repo with no manifest. A repo that HAS a wrapper and
// could not be read reports its findings instead, because "unreadable" is a finding here.
export function _gradleWrapperCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran !== true) return { ..._zero(), ran: true, nosrc: true, reason: j.reason || null };
  if (j.applicable === false) return { ..._zero(), ran: true, nosrc: true, reason: j.reason || 'no Gradle wrapper in this repo' };

  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const f of (Array.isArray(j.findings) ? j.findings : [])) {
    const sev = String(f && f.sev || '').toLowerCase();
    if (sev in c) c[sev] += 1;
    c.total += 1;
    rows.push({ rule: f && f.rule, sev, message: f && f.message });
  }
  // The scope disclaimer travels with the counts, not just in the tool's own file. This lane
  // verifies where the toolchain is fetched from and what the committed binaries are; it does NOT
  // establish that running the wrapper is safe, and a zero here must not be read as saying so.
  if (j.scope) c.scope = j.scope;
  if (Array.isArray(j.doesNotCover)) c.doesNotCover = j.doesNotCover;
  if (j.declaredVersion) c.declaredVersion = j.declaredVersion;
  // Published for cross-repo comparison: these artifacts are GENERATED by Gradle, so two repos on
  // one version should agree, and disagreement is the only shape a substitution can take.
  if (j.jarSha256) c.jarSha256 = j.jarSha256;
  if (j.gradlewSha256) c.gradlewSha256 = j.gradlewSha256;
  if (j.checksumCheck) c.checksumCheck = j.checksumCheck;
  return { ...c, ..._detailFor('gradleWrapper', rows) };
}

// OWASP dep-scan — the only lane that ADJUDICATES a dependency finding rather than reporting its
// existence. bin/depscan-scan.sh writes the summary; the CycloneDX VDR beside it carries the rows.
//
// EXCLUDED FROM THE SEVERITY SUM, for the reason maliciousPackages is (see TOTALS_EXCLUDE): its CVE
// list is drawn from the same advisory data parseOsv already counted, so adding it would double-
// count the CVE lane rather than extend it. What this lane contributes is the SECOND OPINION —
// whether a path to the vulnerable symbol was adjudicated — and that is not a number to sum.
//
// "NOT PRODUCED" IS NOT "NOTHING REACHABLE". dep-scan's `in_triage` is its DEFAULT analysis state,
// and its slicer writes nothing at all on a tree with no installed dependencies. Measured on
// vercel/satori: 105 findings, 100 of them in_triage, and *-usages.slices.json empty — zero
// adjudications, from an analyser that never ran. Publishing that as "0 reachable" would be the
// strongest false-clean this fleet can emit, so the producer's `reachability.state` is carried
// through verbatim and a not-produced run yields NO reachability counts at all.
export function _depscanCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran !== true) return { ..._zero(), ran: true, nosrc: true, reason: j.reason || null };

  const k = j.counts || {};
  const reach = j.reachability || {};
  const produced = reach.state === 'analysed';
  const c = {
    ..._zero(), ran: true,
    crit: Number(k.crit) || 0, high: Number(k.high) || 0, med: Number(k.med) || 0, low: Number(k.low) || 0,
    total: Number(k.total) || 0,
    components: Number(k.components) || null,
    // The isolation the scan ran under is part of the result: a network-severed run cannot resolve
    // transitives, and a reader who does not know that will read a short list as a clean one.
    sandbox: j.sandbox || null,
    coverage: j.coverage || null,
    // The database's build date bounds which advisories a finding OR an absence can reflect;
    // carried whole so the reader sees builtAt (the bound) and pulledAt (the policy) apart.
    vdb: j.vdb && typeof j.vdb === 'object' ? j.vdb : { builtAt: null, pulledAt: null, bound: 'database build date unrecorded (receipt predates the vdb field) — the temporal bound of this result is unknown' },
    reachabilityState: reach.state || 'unknown',
    // Counts ONLY when the analyser actually produced slices. Absent — not zero — otherwise.
    ...(produced ? { reachable: Number(reach.exploitable) || 0, notAdjudicated: Number(reach.notAdjudicated) || 0 }
      : { reachabilityReason: reach.reason || 'the reachability analyser produced no output — there is no answer here, not an answer of none' }),
  };

  const rows = [];
  const vdrs = Array.isArray(j.detail) ? j.detail : (j.detail ? [String(j.detail)] : []);
  const map = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };
  for (const name of vdrs) {
    if (!name || String(name).includes('/')) continue;      // a path is not a sibling filename
    if (!/\.vdr\.json$/i.test(name)) continue;              // the SBOMs beside it are inventory, not findings
    const dp = join(dir, name);
    if (!existsSync(dp)) continue;
    let d; try { d = safeParseFile(dp); } catch { continue; }
    for (const v of (Array.isArray(d.vulnerabilities) ? d.vulnerabilities : [])) {
      const purl = ((v.affects || [])[0] || {}).ref || '';
      const state = String((v.analysis && v.analysis.state) || '').toLowerCase();
      rows.push({
        id: v.id || '',
        package: purl,
        sev: map[String(((v.ratings || [])[0] || {}).severity || '').toLowerCase()] || 'unknown',
        // The word is chosen deliberately: `exploitable` is dep-scan's only adjudication, and
        // everything else — in_triage included — is `unadjudicated`, never `unreachable`.
        reachability: state === 'exploitable' ? 'exploitable' : 'unadjudicated',
        insight: ((v.properties || []).find((x) => x.name === 'depscan:insights') || {}).value || '',
      });
    }
  }
  return { ...c, ..._detailFor('depsReachability', rows) };
}

// GuardDog (heuristic supply-chain): SARIF results whose signal lives in ruleId + message.text.
// GuardDog's SARIF declares no structured package field, so package@version is recovered from the
// message when the text carries one and stays '' otherwise — the rule + message are the payload
// either way, and '' is honest, never a guess.
export function _guarddogCounts(dir, file) {
  const rows = [];
  const c = _sarifCounts(dir, file, (res, rule) => {
    const msg = String((res.message && res.message.text) || '').trim();
    // THREE forms, and the third is the one GuardDog actually writes. Measured 2026-08-13 across the
    // fleet's 676 published rows: EVERY message opens `On package: <name> version: <ver>`, which
    // neither `name@version` pattern matches — so 673 of 676 rows carried package:'' and the panel's
    // supply-chain tab rendered a dash where the package belongs, for 99.6% of its content. The data
    // was never missing; it was sitting in the message string one field over. The two `@`-forms stay:
    // an artifact from a different GuardDog version must not start parsing as empty because the shape
    // it uses is no longer the one being looked for first.
    const pm = msg.match(/'(@?[^'\s]+)@([^'\s]+)'/)
      || msg.match(/(?:^|\s)(@?[\w.-]+(?:\/[\w.-]+)?)@(\d[\w.+-]*)/)
      || msg.match(/\bpackage:\s*(\S+)\s+version:\s*(\S+)/i);
    rows.push({ rule: String(res.ruleId || (rule && rule.id) || ''), package: pm ? pm[1] : '',
      version: pm ? pm[2] : '', message: capMessage(msg) });
  });
  if (!c || c.nosrc || c.unparseable || c.norules || c.neverran || c.toolfailed) return c; // absent, or a husk with nothing to detail

  // ── CAPABILITY IS NOT A VERDICT ────────────────────────────────────────────────────────────────
  // GuardDog emits two families under one SARIF. `threat-*` (plus metadata_mismatch, typosquatting,
  // bundled_binary, provenance_regression) are ADJUDICATIONS: this package did something bad.
  // `capability-*` is DESCRIPTION: this package can open a socket, spawn a process, read a file.
  // Almost every real package can.
  //
  // Measured on sweep-20260820120254: 602 of 675 published rows are capability-* across 255 distinct
  // packages — including @fortawesome/fontawesome-free (capability-network-outbound) and
  // @popperjs/core. Publishing those at `med` is the same defect class as the Lob detector's 1,311
  // false criticals: a descriptive signal wearing a verdict's clothes, at 89% of the lane.
  //
  // So capability rows keep their DETAIL — they are genuine context about a package, and deleting
  // them would lose real information — and lose their SEVERITY. They are counted under `capability`,
  // outside crit/high/med/low, and the verdict rows keep the lane's counts to themselves.
  const VERDICT = /^(threat-|metadata_mismatch|typosquatting|bundled_binary|provenance_regression|potentially_compromised_email_domain)/i;
  const isCapability = (r) => /^capability-/i.test(String(r.rule || ''));
  const capability = rows.filter(isCapability).length;
  if (capability) {
    // The producer counted every row; what changes is how many we are willing to call findings.
    // Both numbers travel — a reader needs to see that the lane is mostly description.
    const drop = Math.min(capability, Number(c.med) || 0);
    c.med = Math.max(0, (Number(c.med) || 0) - drop);
    c.total = Math.max(0, (Number(c.total) || 0) - capability);
    c.capability = capability;
    c.verdicts = rows.filter((r) => VERDICT.test(String(r.rule || ''))).length;
  }
  // No per-row `kind`: the rule prefix already determines the family, and declaring it as a field
  // would put one fact in two columns. The split that matters is in the counts above.
  return { ...c, ..._detailFor('supplyChainHeuristic', rows) };
}

// retire.js identifies a library BY THE CONTENT OF A FILE, which is why this is not the same
// evidence as deps-osv / npm-audit even though all three walk a node_modules tree. Those answer
// "what does the lockfile DECLARE"; retire answers "what library is actually IN this file".
//
// The gap that makes it worth its own category, measured 2026-08-01 on a client admin console: quill
// 1.3.7 inside react-quill/dist/react-quill.js, and vue 2.6.14 inside a chart.js docs asset. No
// manifest anywhere names either one — the lockfile declares react-quill and chart.js — so every
// manifest-gated lane in this fleet is structurally blind to them. The check has been running and
// writing retire.json since before this category existed; the findings simply reached no total,
// which is the same "ran, aggregated by nothing" shape as the seven categories above.
//
// KNOWN LIMIT, stated because a category that overclaims is worse than none: retire's database is
// curated, so absence is not proof. Verified 2026-08-02 — `retire --path sitemap/vendor` returns
// zero entries for three.min.js (607KB, ~4 years old, served publicly). A vendored asset retire
// does not know remains uncovered by EVERY lane, and that hole is tracked separately, not papered
// over by this category reading `ran: true`.
export function _retireDetail(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let j; try { j = safeParseFile(p); } catch { return null; }
  // A husk is not a clean scan. `{data: []}` IS a clean scan — retire lists only vulnerable files —
  // so the two are distinguished here rather than both collapsing to zeroes.
  if (!Array.isArray(j.data)) return null;
  const c = { ..._zero(), ran: true };
  const map = { critical: 'crit', high: 'high', medium: 'med', low: 'low' };
  const rows = [];
  for (const f of j.data) for (const r of f.results || []) for (const v of r.vulnerabilities || []) {
    const b = map[String(v.severity || '').toLowerCase()]; if (!b) continue;
    c[b]++; c.total++;
    const ids = v.identifiers || {};
    // retire reports an ABSOLUTE path on the scanning machine. Trimming to the node_modules segment
    // (or the last two segments) keeps the row's meaning — WHICH bundle the library was found in —
    // without publishing this operator's home directory into an artifact the panel serves.
    const abs = String(f.file || '');
    const nm = abs.indexOf('/node_modules/');
    const rel = nm >= 0 ? abs.slice(nm + 1) : abs.split('/').slice(-2).join('/');
    rows.push({
      component: String(r.component || ''),
      version: String(r.version || ''),
      id: String((Array.isArray(ids.CVE) && ids.CVE[0]) || ids.githubID || ids.issue || ''),
      sev: b,
      file: rel,
      message: capMessage(String(ids.summary || '')),
    });
  }
  return { ...c, ..._detailFor('depsRetire', rows) };
}

// bin/deps-content.mjs — dependency CONTENT: install hooks that fetch or exec, lockfile integrity,
// installed-vs-locked drift. Severity is per rule and read from the row; a row with no legal sev
// is counted under `undetermined` rather than given one. filesScanned === 0 is a void, and the
// scanner says which kind: noLockfile (absent, exit 0) or couldNotRun (unparseable / v1, exit 2).
export function _depsContentCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'deps-content' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) {
    const v = { ..._zero(), ran: true, nosrc: true };
    if (j.summary.couldNotRun) v.couldNotRun = String(j.summary.couldNotRun).slice(0, 240);
    else if (j.summary.noLockfile) v.noLockfile = true;
    return v;
  }
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const key = String(f.path || '');
    const i = key.lastIndexOf('node_modules/');
    const row = { rule, file: key, package: i >= 0 ? key.slice(i + 'node_modules/'.length) : key,
      sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  return { ...c, ..._detailFor('depsContent', rows) };
}
