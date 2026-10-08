// monitor/extractors/secrets.mjs — the credential lanes: secrets in the tree, in history, and weak ones.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23. Three readers:
//   - TruffleHog (secretsHistory) scans git history, and grades by VERIFIED at the provider;
//   - gitleaks (secrets) scans the working tree, grades through monitor/secret-verify.mjs, and
//     carries the path-context helpers no other extractor uses (isTestPath, classifyContext,
//     PUBLIC_BY_DESIGN);
//   - weakRandom reads bin/weak-random-detect.mjs: credentials generated guessably.
//
// The mainframe credential lane (mainframeSecrets) reads through the gitleaks reader too, with its
// own rule pack and verdict file.
//
// The path helpers are here and NOT in a shared module on purpose, and their own comment below says
// why: `testPath` is lane-local, because widening the shared fixture classifier would move every
// other lane's numbers at once. isTestPath has since been imported by two secrets-adjacent callers
// (admin/routes/leaks-verify.mjs, bin/weak-random-detect.mjs); that is the extent of its reach.
//
// The gitleaks note points to "the DETAIL_CAP block above" for why rows are whitelisted rather than
// redacted. That block is in ./core.mjs now.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseFile } from '../safe-parse.mjs';
import { _zero, _emptyArtifact, _detailFor, capMessage } from './core.mjs';

// TruffleHog scans git HISTORY and writes JSON-lines. A VERIFIED secret is `crit` and nothing
// else: the tool has confirmed the credential is live at its provider, which is the strongest
// statement any scanner in this fleet makes. Unverified is `med` — a candidate needing triage, not
// a finding to page on. (bin/commitwork.mjs's `trufflehog` parseReport branch makes the same split
// for the per-check severity; this is the fleet-aggregate half of the same judgement.)
export function _trufflehogCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true };   // clean history: trufflehog writes nothing
  const c = { ..._zero(), ran: true };
  const rows = [];
  for (const line of raw.split('\n')) {
    const t = line.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }  // the log interleaves non-JSON banners
    if (!(o.SourceMetadata || o.DetectorName || o.Verified !== undefined)) continue;
    // Mirrors the row's tri state: an errored verification is counted nowhere graded. It used to
    // land in med, which asserted a middling severity about a credential nobody had assessed.
    if (o.Verified) c.crit++;
    else if (!o.VerificationError) c.low++;
    else c.undetermined = (c.undetermined || 0) + 1;
    c.total++;
    // SourceMetadata.Data.Git carries commit/file/line. `Raw`, `RawV2` and `Redacted` carry the
    // secret itself and are deliberately not mapped — the schema would refuse them anyway, and
    // the two layers agreeing is the point.
    const g = (o.SourceMetadata && o.SourceMetadata.Data && o.SourceMetadata.Data.Git) || {};
    // THREE states. `o.Verified === true` collapsed the other two, and measurement says the
    // collapsed pair is not evenly split: of 439 non-true rows across 60 artifacts, 439 carried a
    // VerificationError. So `false` was the label on a population that was entirely "could not ask",
    // and it published as a refusal. An errored verification is NULL, and its sev is blank so the
    // row counts as undetermined rather than as a graded finding.
    const ver = o.Verified === true ? true : (o.VerificationError ? null : false);
    rows.push({ detector: o.DetectorName, file: g.file, line: g.line,
      sev: ver === true ? 'crit' : (ver === false ? 'low' : ''),
      commit: g.commit, verified: ver, verificationError: o.VerificationError || '' });
  }
  return { ...c, ..._detailFor('secretsHistory', rows) };
}

// gitleaks: whitelisted provenance rows — rule / file / line / commit / entropy — and a THREE-STATE
// verification verdict. See the DETAIL_CAP block above for why the copy is a whitelist rather than
// redaction-trust; the `Secret` and `Match` fields are still never mapped out of here.
//
// THIS LANE PUBLISHED 2,368 ROWS AT `high` WHILE PERFORMING NO VERIFICATION AT ALL.
// The previous comment was honest about the premise and wrong about the conclusion: "gitleaks
// grades nothing, so the lane is uniformly high". A detector that grades nothing must not emit the
// second-highest severity. Measured across the 100-repo corpus on 2026-08-24:
//   - 2,368 rows at high, ZERO carrying any verification field;
//   - the sibling TruffleHog lane, which does verify, found 3 live credentials in the entire fleet;
//   - 87% of the gitleaks rows sat in test/example/doc-shaped paths (vlang_v 1,111 of 1,117;
//     kenn-io_agentsview 174 of 175 — a secrets-tool test corpus reported as a breach).
// Three compounding defects, and fixing severity alone would have left the other two.
//
// Grading now follows monitor/secret-verify.mjs, which is the only place that may see a live
// secret: verified -> crit, refused-by-its-service -> low, and NO VERDICT -> `undetermined`,
// outside crit/high/med/low entirely. Undetermined is the common case and is not a failure —
// `generic-api-key` names no service, so there is nothing to ask. It is also the state this lane
// was silently converting into `high`.
//
// `testPath` is a LANE-LOCAL signal, deliberately not folded into monitor/fixture-paths.mjs. That
// classifier is shared, and widening it to catch `foo_test.go` would move every other lane's
// numbers at once — a SAST finding in test code is still a defect in code that runs, whereas a
// credential in a test fixture is usually a fixture. Different lanes, different question.
const _TEST_PATH_RE = /(^|\/)(test|tests|spec|specs|__tests__|testdata|fixtures?|examples?|samples?|mocks?|docs?)\//i;
const _TEST_FILE_RE = /(^|\/)[^/]*[._-](test|spec)\.[A-Za-z0-9]+$|(^|\/)[^/]*_test\.[A-Za-z0-9]+$/i;
export const isTestPath = (f) => _TEST_PATH_RE.test(String(f || '')) || _TEST_FILE_RE.test(String(f || ''));

// Context beyond test/fixture, each a place a matched string is usually NOT a live operational
// secret. Measured on the 100-repo corpus: one i18n label ('discord') fired in 11 locale files as
// 11 rows; an `airtable-api-key` matched inside a minified icons bundle; a `private-key` string
// literal sat in vendored mbedtls headers in two repos. Context does NOT change severity — a real
// secret in a minified vendor blob is still real — it is a triage signal, the same role testPath
// plays. `test` is reported first because isTestPath already owns that classification.
const _LOCALE_RE = /(^|\/)(locales?|i18n|lang|translations?)\//i;
const _MINIFIED_RE = /(^|\/)[^/]*\.min\.(js|mjs|css)$/i;
const _VENDOR_RE = /(^|\/)(vendor|vendored|third[_-]?party|node_modules|bower_components)\//i;
export function classifyContext(f) {
  const p = String(f || '');
  if (isTestPath(p)) return 'test';
  if (_LOCALE_RE.test(p)) return 'locale';
  if (_MINIFIED_RE.test(p)) return 'minified';
  if (_VENDOR_RE.test(p)) return 'vendored';
  return '';
}

// Rules whose match is a PUBLIC identifier, not a secret. A Firebase/GCP browser API key (`AIza…`,
// gitleaks rule `gcp-api-key`) is documented by Google as non-confidential — it is restricted by
// API/referrer, not by being hidden, and ships in client bundles by design. Even if a verifier
// reports it live, publishing it `crit` is the fabricated-critical the house rule forbids. Such a
// row is forced to `undetermined` with the original claim preserved in `verified`, never erased.
// Deliberately NARROW: `algolia-api-key` is excluded because gitleaks cannot tell a public search
// key from an admin key, and a wrong demotion there would hide a real one.
export const PUBLIC_BY_DESIGN = new Set(['gcp-api-key']);

// `category` decides which detail schema the rows land under, and nothing else: the mainframe
// credential lane runs the same engine over the same shape with a different rule pack, and its rows
// must not be filed as `secrets` — two corpora under one category would credit one lane's coverage
// to the other, which is exactly why secrets and secretsHistory are separate to begin with.
//
// `verdictFile: null` reads the verdict INLINE, the way betterleaks --validation writes it: valid is
// live, invalid and revoked are dead, and anything else (no validator, error, unknown) is null.
// Whether validation ran at all is read from the run's own log line, not inferred from the rows.
const INLINE_VERDICT = new Map([['valid', true], ['invalid', false], ['revoked', false]]);
export function _gitleaksCounts(dir, file, verdictFile = 'gitleaks-verify.json', category = 'secrets') {
  const p = join(dir, file); if (!existsSync(p)) return null;
  // EMPTY IS CLEAN; UNREADABLE IS NOT. gitleaks writes nothing on a clean tree, and the old catch
  // treated BOTH that and a torn/hostile file as "ran, zero findings" — an unreadable secret scan
  // reading as a clean one, which is the failure this codebase exists to refuse. safeParseFile
  // throws on strictly more inputs than JSON.parse did (size, nesting, pollution keys), so keeping
  // the old catch would have WIDENED that lie rather than inherited it. Split, per the trufflehog
  // idiom at the top of this file: no bytes => clean; bytes we cannot trust => a named void.
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true };            // clean tree: gitleaks writes nothing
  let j; try { j = safeParseFile(p); } catch (e) {
    return { ..._zero(), ran: false, unreadable: true, reason: `gitleaks.json refused: ${e.message}` };
  }
  const arr = Array.isArray(j) ? j : (j.findings || []);

  // The verification sidecar, when the verify pass has run. Its ABSENCE is `null` for every row —
  // never `false`. "We did not ask" and "the service said no" are different facts and only one of
  // them is evidence.
  const vmap = new Map();
  let verifyRan = false;
  if (verdictFile === null) {
    try { verifyRan = /validation complete/.test(readFileSync(p.replace(/\.json$/i, '') + '.log', 'utf8')); } catch { verifyRan = false; }
  }
  const vp = verdictFile === null ? null : join(dir, verdictFile);
  if (vp && existsSync(vp)) {
    try {
      const v = safeParseFile(vp);
      verifyRan = !!v.ran;
      for (const d of v.verdicts || []) vmap.set(`${d.file}|${d.line}|${d.rule}`, d.verified);
    } catch { verifyRan = false; }   // fail closed: an unreadable sidecar verifies nothing
  }

  const c = { ..._zero(), ran: true, undetermined: 0, testPath: 0, verifyRan };
  const rows = arr.map((f) => {
    const rule = String((f && f.RuleID) || '');
    const path = String((f && f.File) || '');
    const line = Number(f && f.StartLine) || 0;
    const inline = verdictFile === null && f ? INLINE_VERDICT.get(f.ValidationStatus) : undefined;
    const verified = vmap.has(`${path}|${line}|${rule}`) ? vmap.get(`${path}|${line}|${rule}`) : (inline ?? null);
    const confidence = f && f.Attributes && typeof f.Attributes.confidence === 'string' ? f.Attributes.confidence : '';
    const publicByDesign = PUBLIC_BY_DESIGN.has(rule);
    // A public-by-design identifier never buckets — the raw claim stays in `verified`.
    const sev = publicByDesign ? null : (verified === true ? 'crit' : (verified === false ? 'low' : null));
    const testPath = isTestPath(path);
    const context = classifyContext(path);
    if (sev) c[sev]++; else c.undetermined++;
    if (testPath) c.testPath++;
    c.total++;
    return {
      rule, file: path, line, commit: String((f && f.Commit) || ''), redacted: true,
      // Entropy is the one confidence signal gitleaks DOES emit and the old extractor discarded it.
      ...(Number.isFinite(f && f.Entropy) ? { entropy: Number(f.Entropy) } : {}),
      ...(sev ? { sev } : {}), verified, ...(testPath ? { testPath: true } : {}),
      ...(context ? { context } : {}), ...(publicByDesign ? { publicByDesign: true } : {}),
      ...(confidence ? { confidence } : {}),
    };
  });
  return { ...c, ..._detailFor(category, rows) };
}

// bin/weak-random-detect.mjs — insufficient randomness in security-sensitive values.
//
// Every row is `high`: a guessable credential is not a severity gradient, and the lane already
// refuses to publish anything it cannot tie to a credential-shaped assignment target or a
// credential-generating function.
//
// `context:'test'` rows are counted under `undetermined`, never as findings — the same split
// _stubCounts makes. A deterministic seed in a benchmark is the correct implementation of a
// benchmark, and suppressing those rows entirely would hide the one case where a fixture leaks
// into production by being imported.
//
// filesScanned === 0 is a VOID: a walk that examined nothing has not found nothing.
export function _weakRandomCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'weak-random-detect' || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary && j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  const rows = [];
  let testRows = 0;
  for (const f of j.findings) {
    if (!f) continue;
    if (f.context === 'test') { testRows += 1; }
    else { c.high += 1; c.total += 1; }
    rows.push({ rule: f.rule, file: f.path, line: Number(f.line) || 0,
      sev: f.context === 'test' ? '' : 'high',
      context: f.context, fn: f.fn, message: capMessage(f.why || f.detail || '') });
  }
  if (testRows) {
    c.undetermined = (c.undetermined || 0) + testRows;
    c.testContextNote = `${testRows} row(s) in test/bench/fixture paths — deterministic randomness is correct there, so they are counted apart rather than published as findings.`;
  }
  c.filesScanned = scanned;
  return { ...c, ..._detailFor('weakRandom', rows) };
}
