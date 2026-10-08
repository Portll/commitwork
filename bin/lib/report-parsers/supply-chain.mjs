import { crit, high } from '../theme.mjs';
import { safeReadJSON, voidResult } from './common.mjs';

export function parseNpmAudit(path) {
  const j = safeReadJSON(path);
  const v = j?.metadata?.vulnerabilities;
  if (!v) return { ok: false, summary: 'no audit data' };
  const total = (v.critical || 0) + (v.high || 0) + (v.moderate || 0) + (v.low || 0);
  const sev = v.critical ? 'high' : v.high ? 'high' : total ? 'med' : 'ok';
  return { ok: true, total, sev, summary: total ? `${v.critical || 0}c/${v.high || 0}h/${v.moderate || 0}m/${v.low || 0}l` : '0' };
}

export function parseTrivy(path) {
  const j = safeReadJSON(path);
  if (!j) return { ok: false, summary: 'no report' };
  // Trivy stamps every report with SchemaVersion. `Results` alone is not the marker — a clean
  // trivy run legitimately omits it or sets it null — so the version field is what separates
  // "trivy ran and found nothing" from "something else is in this file". Without it, `{}` and
  // `{"error":"permission denied"}` both scored a green 0.
  if (j.SchemaVersion === undefined && !Array.isArray(j.Results)) {
    return { ok: false, sev: 'noscan', summary: 'not a trivy report — no SchemaVersion' };
  }
  const sevs = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const res of j.Results || []) for (const v of res.Vulnerabilities || []) {
    const s = (v.Severity || '').toUpperCase();
    if (s in sevs) sevs[s]++;
  }
  const total = sevs.CRITICAL + sevs.HIGH + sevs.MEDIUM + sevs.LOW;
  // An empty catalogue is not a clean scan: "N packages, 0 vulnerable" is a checkable zero and
  // "0 packages, 0 vulnerable" means the scanner never had a subject (Gradle repos with no
  // lockfile passed this way on the 100randomrepos corpus). Reported as `noscan`, not a fifth
  // CHECK_STATUS, because every consumer already renders noscan grey and an unknown word would
  // render clean; the words "empty catalogue" ride in the reason.
  const pkgs = (j.Results || []).reduce((n, r) => n + ((r.Packages || []).length), 0);
  if (total === 0 && pkgs === 0) {
    return { ok: false, sev: 'noscan', total: 0, crit: 0, high: 0, med: 0, low: 0,
      summary: 'empty catalogue — 0 packages catalogued from 0 result sets, so this zero says nothing about whether the dependencies are vulnerable' };
  }
  const sev = (sevs.CRITICAL || sevs.HIGH) ? 'high' : total ? 'med' : 'ok';
  return { ok: true, total, sev, crit: sevs.CRITICAL, high: sevs.HIGH, med: sevs.MEDIUM, low: sevs.LOW,
    summary: total ? `${sevs.CRITICAL}c/${sevs.HIGH}h/${sevs.MEDIUM}m/${sevs.LOW}l` : `0 (${pkgs} packages catalogued)` };
}

export function parseSbom(path) {
  const j = safeReadJSON(path);
  // A zero-dependency project's SBOM is a VALID CycloneDX document with `components` OMITTED
  // ENTIRELY — not `[]`. Verified by running syft against a dependency-free fixture. Keying
  // "is this an SBOM?" off `components?.length == null` therefore reported a real, clean,
  // successful scan as "no sbom" — a scanner that ran and found nothing, filed as a scanner that
  // never ran. Decide validity from the document's own format marker, and treat an absent
  // components array as the zero it means.
  //
  // Both refusals below are noscan, not n/a. appliesIfExists already decided the lane had a subject;
  // a generator that then wrote no readable SBOM inventoried nothing. They returned `skip` until
  // 2026-10-07, and the run path published that skip as a pass.
  if (!j || typeof j !== 'object') {
    return { ok: false, sev: 'noscan', summary: 'sbom unreadable — empty, not JSON or not a JSON object; nothing was inventoried' };
  }
  const isCycloneDX = j.bomFormat === 'CycloneDX' || typeof j.specVersion === 'string' || Array.isArray(j.components);
  if (!isCycloneDX) {
    return { ok: false, sev: 'noscan', summary: 'not a CycloneDX document — no bomFormat, specVersion or components[]; nothing was inventoried' };
  }
  const n = Array.isArray(j.components) ? j.components.length : 0;
  // An SBOM's output IS the inventory, so an empty one is a complete answer (bin/audit.mjs rules
  // the same). It still gets its own words, carried on the pass row as its reason.
  if (n === 0) {
    return { ok: true, total: 0, sev: 'ok', empty: true,
      summary: '0 components — nothing to inventory: a valid CycloneDX document that lists no dependency' };
  }
  return { ok: true, sev: 'ok', summary: `${n} components` };
}

export function parseRetire(path) {
  // retire.js --outputformat json → { version, data:[{ file, results:[{ vulnerabilities:[{severity}] }] }] }.
  // A 0-byte clean run parses to null (JSON.parse('') throws); a clean scan is { data:[] }. Either
  // is 'ok'. Severities are lowercase (critical/high/medium/low). Flatten to count vulnerabilities.
  const j = safeReadJSON(path);
  if (!j || !Array.isArray(j.data)) return { ok: false, summary: 'no retire data' };
  const sevs = { critical: 0, high: 0, medium: 0, low: 0 };
  let total = 0;
  for (const f of j.data) for (const r of f.results || []) for (const v of r.vulnerabilities || []) {
    const s = (v.severity || '').toLowerCase(); if (s in sevs) sevs[s]++; total++;
  }
  const sev = (sevs.critical || sevs.high) ? 'high' : total ? 'med' : 'ok';
  return { ok: true, total, sev, summary: total ? `${sevs.critical}c/${sevs.high}h/${sevs.medium}m/${sevs.low}l` : '0' };
}

export function parseGradleWrapper(path) {
  // bin/gradle-wrapper-verify.mjs writes {ran, applicable, findings[]}. applicable:false is a repo
  // with no wrapper — nothing to scan, so n/a (`skip`), which the rollup's extractor reads as nosrc.
  // ran:false is a void. Neither is a clean bill of health: there was no wrapper to give one to.
  // applicable:false returned `ok` until 2026-10-07 and published as a pass.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no gradle-wrapper data' };
  if (j.ran !== true) return voidResult(j.reason, 'not evaluated', 'self-gated');
  if (j.applicable === false) return { ok: true, sev: 'skip', total: 0, summary: 'no Gradle wrapper in this repo, so nothing to verify' };
  const fs_ = Array.isArray(j.findings) ? j.findings : [];
  const high = fs_.filter((f) => f && f.sev === 'high').length;
  // A pass here covers the FETCH PATH only; the summary says so rather than letting '0 findings'
  // imply the wrapper is safe to run.
  return { ok: true, total: fs_.length, sev: high ? 'high' : fs_.length ? 'warn' : 'ok',
    summary: fs_.length
      ? `${fs_.length} wrapper finding(s), ${high} high — fetch path only`
      : 'wrapper fetch path clean (build.gradle and gradle.properties are NOT covered)' };
}

export function parseScorecard(path) {
  // bin/scorecard-scan.sh writes {ran,counts:{checks,scored,inconclusive,passing,failing}} on
  // success, else {ran:false,skipped:true,reason}. Same void rule as cspm-github above.
  //
  // AND ONE MORE: an all-undetermined result is NOT a pass. Scorecard returns -1 for a check it
  // could not determine, so a run where every check came back -1 has zero failures and has
  // measured nothing. `sev:'ok'` there would be the unsupported pass inversion this file exists to
  // refuse, so it reports noscan. The undetermined count travels in the summary either way —
  // "8 failing" and "8 failing, 6 undetermined" are different claims about the same repo.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no scorecard data' };
  if (j.ran !== true) return voidResult(j.reason, 'not evaluated', 'self-gated');
  const c = (j && j.counts) || {};
  const fail = Number(c.failing) || 0, pass = Number(c.passing) || 0, und = Number(c.inconclusive) || 0;
  const scored = Number(c.scored) || 0;
  if (!scored) return { ok: false, sev: 'noscan', summary: `0 of ${und} check(s) could be determined — no posture was measured` };
  const tail = und ? `, ${und} undetermined` : '';
  return { ok: true, total: fail, sev: fail ? 'high' : und ? 'warn' : 'ok',
    summary: `${fail} failing / ${pass} passing control(s)${tail}` };
}

export function parseDepscan(path) {
  // bin/depscan-scan.sh writes {ran, counts, reachability:{state,...}} on success, else
  // {ran:false,skipped:true,reason}. Same void rule as the two above.
  //
  // THE REACHABILITY STATE IS PART OF THE VERDICT, not a footnote. dep-scan's slicer writes
  // nothing on a tree with no installed dependencies, and `reachability.state:'not-produced'`
  // means there is NO answer — so a run that found no vulnerabilities AND produced no slices has
  // established nothing and reports noscan. Only a run whose analyser actually ran may say `ok`.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no depscan data' };
  if (j.ran !== true) return voidResult(j.reason, 'not evaluated', 'self-gated');
  const c = j.counts || {}, r = j.reachability || {};
  const total = Number(c.total) || 0;
  const sevCount = (Number(c.crit) || 0) + (Number(c.high) || 0);
  const produced = r.state === 'analysed';
  if (!total && !produced) {
    return { ok: false, sev: 'noscan',
      summary: '0 findings and the reachability analyser produced nothing — no dependency claim was established' };
  }
  const reach = produced
    ? `, ${Number(r.exploitable) || 0} adjudicated exploitable`
    : ', reachability NOT produced';
  return { ok: true, total, sev: sevCount ? 'high' : total ? 'med' : produced ? 'ok' : 'noscan',
    summary: `${total} dependency finding(s)${reach}` };
}
