// monitor/extractors/posture.mjs — the lanes that report a CONTROL'S STATE, in their own formats.
//
// Lifted unchanged from monitor/extractors.mjs on 2026-09-23. LANE_KINDS gives six lanes the kind
// `posture`; the four here each read a format of their own: hadolint (dockerfile), the TLS and
// security-header scan (tlsHeaders), GitHub CSPM (cspm) and OpenSSF Scorecard (supplyChainPosture).
// The other two, zizmor (actionsPosture) and trivy-config (iac), emit SARIF and read through
// ./sarif.mjs.
//
// Also here: the CI gaps scan (bin/actions-gaps.mjs, actionsGaps), and zizmor's severity pins,
// which ride into ./sarif.mjs as its `sevOf` and must agree with the actionsGaps rules. agentConfig,
// the other posture lane with a format of its own, reads with the agent surface in
// ./agent-surface.mjs. The jackson case-insensitive guard (jacksonCaseInsensitive) reads through
// ../jackson-guard-read.mjs, the reader the runner's parser shares.
//
// ONE COMMENT MOVED, and it is the only line in this file that sits somewhere new. The three-line
// Hadolint note above _hadolintCounts had been stranded above _shellcheckCounts in the old file,
// with shellcheck and actionlint between it and the function it describes; it was that way at
// 01fbcce. It now sits on its function again. Every line is byte-identical; only that one
// paragraph changed position.
//
// monitor/extractors.mjs re-exports every public name here, so its importers see no change.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeParseFile } from '../safe-parse.mjs';
import { readJacksonGuard } from '../jackson-guard-read.mjs';
import { unknown } from '../unknown.mjs';
import { _zero, _emptyArtifact, _detailFor, capMessage, _wtBucket, _setAsideWorktree, _worktreesOf } from './core.mjs';

// Hadolint writes a flat array of {code, level, file, line, message}. level ∈ error|warning|info|
// style. The manifest writes '[]' itself when no Dockerfile matched, so an empty array is a real
// clean run, not a void.
export function _hadolintCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!Array.isArray(j)) return { ..._zero(), ran: true, unparseable: true };
  const c = { ..._zero(), ran: true }, map = { error: 'high', warning: 'med', info: 'low', style: 'low' };
  const rows = [];
  for (const f of j) {
    const b = map[String((f && f.level) || '').toLowerCase()] || 'low';
    c[b]++; c.total++;
    rows.push({ rule: f && f.code, file: f && f.file, line: f && f.line, sev: b, message: f && f.message });
  }
  return { ...c, ..._detailFor('dockerfile', rows) };
}

// bin/tls-headers-scan.mjs writes {headers:{ran,grade,missing[]}, tls:{ran,findings[]}, ran, …}.
// Two halves that gate independently: the headers half needs CW_TARGET_URL, the TLS half needs a
// reachable https listener. `ran:false` at top level means NEITHER looked — a void, reported as
// null-with-provenance rather than a grade of zero missing headers.
//
// A missing security header is `med`, not `high`: it is a hardening gap, not a live exposure, and
// six of them on one edge would otherwise outrank a real CVE in the headline sum. The TLS half's
// own findings carry their severity (an expired or untrusted certificate is `high` there) and are
// passed through as graded rather than re-judged here.
export function _tlsHeaderCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  // the scan ran and found nothing to grade — its own honest void, not a clean grade
  if (j.ran === false) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true };
  // A missing header and a certificate defect are different evidence; they share a row vocabulary
  // (issue / target / sev / detail) so the tab is one table, and each row still says which it is.
  const rows = [];
  const target = String(j.target || '');
  const missing = (j.headers && Array.isArray(j.headers.missing)) ? j.headers.missing : [];
  c.med += missing.length; c.total += missing.length;
  for (const h of missing) rows.push({ issue: h, target, sev: 'med', message: 'security header not sent by the origin' });
  const tf = (j.tls && Array.isArray(j.tls.findings)) ? j.tls.findings : [];
  for (const f of tf) {
    const b = ({ crit: 'crit', critical: 'crit', high: 'high', med: 'med', medium: 'med', low: 'low' })[String((f && f.severity) || '').toLowerCase()] || 'med';
    c[b]++; c.total++;
    rows.push({ issue: f && f.issue, target: (f && f.target) || target, sev: b, message: f && f.detail });
  }
  return { ...c, ..._detailFor('tlsHeaders', rows) };
}

// Prowler's GitHub provider, summarised by bin/cspm-github.sh to {ran, pass, fail} (or
// {ran:false,skipped:true,reason} when prowler / the dedicated token / a github origin is absent).
// A failing posture check is `high`: branch protection off or secret scanning disabled is a
// standing control gap, not an informational note.
export function _cspmCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran !== true) return { ..._zero(), ran: true, nosrc: true }; // self-gated skip — a void, not 0 failing controls
  const fail = Number(j.fail) || 0;
  // `low`, not `high` — OPERATOR RULING 2026-08-28, reasoned at the row-construction site below.
  // Every FAIL this lane produces is a repository SETTING somebody has not switched on, not a
  // weakness detected in the code, and several are gated behind a paid plan. The bucket has to move
  // with the rows or the two disagree: the count here is the producer's `fail`, computed
  // independently of the per-row `sev` set below, which is precisely the shape that let
  // scanners.stubs read {high:4322, low:0} while every row carried `low`.
  const c = { ..._zero(), ran: true, low: fail, total: fail };
  // MANUAL is prowler's own "could not determine". It was never counted here — correctly, since it
  // is not a finding — but it was also never REPORTED, so a control prowler declined to judge
  // vanished. Carried now, and deliberately kept out of every severity bucket.
  if (Number(j.manual)) c.undetermined = Number(j.manual);
  // Whether the evidence behind the security_and_analysis controls was visible to the credential
  // that ran. `absent` means prowler asserted those controls from a field GitHub did not return.
  if (j.securityAndAnalysisEvidence) c.securityAndAnalysisEvidence = j.securityAndAnalysisEvidence;
  // cspm-github.json's `detail` field NAMES the OCSF file beside it. A summary that points at its
  // own evidence and is then rendered as a bare number is evidence nobody can read: 398 failing
  // posture controls fleet-wide, not one of them nameable. Only FAIL records become rows — a PASS
  // is not a finding — and the count above stays the producer's, so the rows can only ever be a
  // subset of a number this extractor did not compute.
  const rows = [];
  const detailFile = String(j.detail || '');
  if (detailFile && !detailFile.includes('/')) {
    const dp = join(dir, detailFile);
    if (existsSync(dp)) {
      let arr = null;
      try { const d = safeParseFile(dp); arr = Array.isArray(d) ? d : (d.findings || null); } catch { arr = null; }
      const map = { critical: 'crit', high: 'high', medium: 'med', low: 'low', informational: 'low' };
      // Controls whose verdict is read off `security_and_analysis`. When the probe says that field
      // was ABSENT, prowler's FAIL on these is an assertion about data it never received, so the
      // row is marked undetermined and its severity dropped rather than published as a finding.
      //
      // The set is matched on prowler's own control titles and is deliberately SMALL and declared,
      // not inferred: a wide regex here would silently downgrade real findings, which is the
      // opposite error and a worse one. Sourced from the fleet's 614 OCSF artifacts, 2026-08-22.
      const EVIDENCE_GATED = /secret scanning|push protection|dependabot (alerts|security updates)|advanced security/i;
      const blind = String(j.securityAndAnalysisEvidence || '') === 'absent';
      let downgraded = 0;
      for (const f of arr || []) {
        if (String((f && f.status_code) || '').toUpperCase() !== 'FAIL') continue;
        const fi = (f && f.finding_info) || {};
        const res = (f && Array.isArray(f.resources) && f.resources[0]) || {};
        const md = (res.data && res.data.metadata) || {};
        const title = fi.title || '';
        if (blind && EVIDENCE_GATED.test(title)) {
          downgraded += 1;
          // sev '' is the schema's legal no-severity value (detail-schema COERCE.sev). An
          // undetermined control HAS no severity — giving it one would be the assertion again.
          rows.push({ control: title, resource: md.full_name || md.name || res.region, sev: '',
            message: `UNDETERMINED — GitHub did not return security_and_analysis to the credential this scan ran as, so this control was judged from a field that never arrived. Prowler reported: ${String(f.status_detail || '').slice(0, 160)}` });
          continue;
        }
        // REPOSITORY-SETTINGS CONTROLS ARE RECOMMENDATIONS, AND THEIR SEVERITY IS VENDOR-SET.
        //
        // Every FAIL this lane produces for a GitHub repo is a setting somebody has not switched
        // on — branch protection, required reviewers, signed commits, CODEOWNERS, immutable
        // releases. Not one is a detected weakness in the code, and several are gated behind a paid
        // plan, so the platform has an interest in reporting them loudly. Measured 2026-08-28: memory-layer
        // and shodh-memory failed the SAME 14 controls, control for control, and 8 of the 14 were
        // published at `high` — which is the platform's severity, not this fleet's judgement.
        //
        // OPERATOR RULING 2026-08-28: capped at `low` and labelled, never dropped. The control, the
        // resource and Prowler's own status_detail all still travel, so an operator who wants
        // branch protection can still read exactly which repo lacks it — what changes is that a
        // repository-configuration recommendation no longer sits in the same bucket as a CVE.
        // This is the GuardDog `capability-*` shape again: a control that fails on essentially
        // every repository is measuring adoption, not risk.
        rows.push({ control: title, resource: md.full_name || md.name || res.region,
          sev: 'low', suggestion: true,
          claimedSeverity: map[String(f.severity || '').toLowerCase()] || 'med',
          note: 'SUGGESTION — a repository SETTING that is not switched on, not a weakness detected in the code. Severity as reported by the platform is preserved in claimedSeverity.',
          message: f.status_detail });
      }
      if (downgraded) {
        // The producer's count stays the producer's; what changes is how many of it we are willing
        // to call findings. Both numbers travel, because a reader needs to know the gap exists.
        c.undetermined = (c.undetermined || 0) + downgraded;
        c.low = Math.max(0, c.low - downgraded);   // follows the bucket above; was c.high
        c.total = Math.max(0, c.total - downgraded);
        c.evidenceBlindControls = downgraded;
      }
    }
  }
  return { ...c, ..._detailFor('cspm', rows) };
}

// OpenSSF Scorecard — supply-chain posture from the OUTSIDE, and the roster's only posture tool
// that can say "I could not tell" in its own output format.
//
// WHY IT SITS BESIDE cspm RATHER THAN REPLACING IT. Prowler asks the GitHub API "is this setting
// on?" and gets FAIL when the API withholds the setting from a non-admin token. On the
// 100randomrepos corpus that read as 100/100 repos failing "secret scanning enabled" — a rate no
// real population produces, because it is not a finding, it is a permission denial wearing one.
// Scorecard scores what a non-admin can actually observe and returns -1 for the rest.
//
// SCORE -1 IS NOT A ZERO. This is the whole reason the lane exists, so it is enforced here rather
// than left to the panel: an undetermined check is counted in `undetermined`, never in crit/high/
// med/low, and never given a row. Grey is not green, and the mirror the codebase was missing —
// grey is not RED either. A repo whose posture is 6 scored and 12 undetermined is not a repo with
// 6 problems; it is a repo nobody could see.
//
// Severity from the score, because the score is what the tool emits. Scorecard also publishes a
// per-check risk tier (Critical/High/Medium/Low) in its docs, which is NOT in the JSON and is NOT
// mirrored here — a hand-copied risk table beside a machine-emitted score is exactly the artefact
// that rots into disagreement.
// SCORECARD CONTROLS THAT ASSERT A PRACTICE, NOT A WEAKNESS.
//
// _scorecardCounts mapped every score <= 2 to `high`, uniformly, so "project is not fuzzed" was
// published at the same severity as "51 existing vulnerabilities detected". Those are not the same
// claim. Measured 2026-08-28 on memory-layer: of 11 controls published at `high`, four asserted nothing
// about the repository's security state — `CII-Best-Practices score 0 / no effort to earn an
// OpenSSF best practices badge detected`, `Fuzzing score 0 / project is not fuzzed`,
// `Contributors score 0 / project has 0 contributing companies or organizations`, and packaging.
//
// A badge nobody applied for and a fuzzing harness nobody wrote are practices not adopted. They are
// worth SUGGESTING and they are not findings — the same distinction that made GuardDog's
// `capability-*` rules 602 of 675 rows at `med` for "this package can open a socket". A control
// that fails on essentially every repository is measuring adoption, not risk.
//
// Kept visible at `low` and LABELLED rather than dropped: the score, the reason and the docs URL
// still travel, so a project that wants the badge can still see what it would take.
const SCORECARD_SUGGESTION = new Set([
  'CII-Best-Practices',   // an OpenSSF badge application; asserts nothing about the code
  'Fuzzing',              // a practice not adopted, not a weakness found
  'Contributors',         // counts contributing ORGANISATIONS — a fact about affiliation
  'Packaging',            // whether the project publishes a package; not a security property
]);

export function _scorecardCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return _emptyArtifact(p);
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object') return { ..._zero(), ran: true, unparseable: true };
  if (j.ran !== true) return { ..._zero(), ran: true, nosrc: true }; // self-gated skip — a void, not a clean posture

  // The producer's summary is authority for how many checks came back undetermined; the raw file
  // beside it carries the per-check rows. A summary that points at its own evidence and is then
  // rendered as a bare number is evidence nobody can read (see _cspmCounts above for the incident).
  const undetermined = Number((j.counts && j.counts.inconclusive)) || 0;
  const c = { ..._zero(), ran: true, undetermined,
    aggregateScore: typeof j.aggregateScore === 'number' ? j.aggregateScore : null,
    undeterminedChecks: Array.isArray(j.inconclusiveChecks) ? j.inconclusiveChecks : [] };

  const rows = [];
  const detailFile = String(j.detail || '');
  if (detailFile && !detailFile.includes('/')) {
    const dp = join(dir, detailFile);
    if (existsSync(dp)) {
      let checks = null;
      try { const d = safeParseFile(dp); checks = Array.isArray(d.checks) ? d.checks : null; } catch { checks = null; }
      // A detail file that exists but yields no checks is a husk. Fall back to the producer's own
      // failing count rather than reporting zero findings for a repo nobody scored.
      if (!checks) {
        const fail = Number(j.counts && j.counts.failing) || 0;
        return { ...c, med: fail, total: fail, detailUnreadable: true };
      }
      for (const ch of checks) {
        const score = Number(ch && ch.score);
        if (!Number.isFinite(score) || score === -1) continue;   // undetermined: counted above, never a finding
        if (score >= 10) continue;                                // a pass is not a finding
        const suggestion = SCORECARD_SUGGESTION.has(String(ch.name || ''));
        // A suggestion is capped at `low` however badly it scores: the severity of "no badge" does
        // not vary with how thoroughly there is no badge.
        const sev = suggestion ? 'low' : (score <= 2 ? 'high' : score <= 5 ? 'med' : 'low');
        c[sev] += 1; c.total += 1;
        if (suggestion) c.suggestions = (c.suggestions || 0) + 1;
        rows.push({ control: ch.name, score, sev, message: ch.reason || '',
          ...(suggestion ? { suggestion: true, note: 'SUGGESTION — this control measures a practice the project has not adopted (a badge, a fuzzing harness, organisational affiliation). It asserts nothing about a weakness in this repository, so it is capped at low rather than published beside a real posture failure.' } : {}),
          docs: (ch.documentation && ch.documentation.url) || '' });
      }
    }
  }
  return { ...c, ..._detailFor('supplyChainPosture', rows) };
}

// zizmor's SARIF level puts self-hosted-runner at warning; the fleet reads a job on the org's own
// machine as high, and the two gap rules are pinned so an upstream level change cannot move them
// away from what bin/actions-gaps.mjs says about the same workflow.
const ZIZMOR_SEV = Object.freeze({ 'zizmor/self-hosted-runner': 'high', 'zizmor/dangerous-triggers': 'high', 'zizmor/excessive-permissions': 'med' });
export function zizmorSev(id, b) { return ZIZMOR_SEV[id] || ZIZMOR_SEV[`zizmor/${id}`] || b; }

// bin/actions-gaps.mjs — self-hosted runners, triggering-head checkouts, absent permissions.
// Severity is per rule and read from the row. filesScanned === 0 is a void (no workflows, or none
// readable); an unparseable or unreadable workflow is carried through as a declared partial read.
export function _actionsGapsCounts(dir, file) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== 'actions-gaps' || !j.summary || !Array.isArray(j.findings)) {
    return { ..._zero(), ran: true, unparseable: true };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) return { ..._zero(), ran: true, nosrc: true };
  const c = { ..._zero(), ran: true, filesScanned: scanned };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  const wt = _wtBucket();
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const rule = String(f.rule || '');
    const sev = ['crit', 'high', 'med', 'low'].includes(f.sev) ? f.sev : '';
    const row = { rule, file: String(f.path || ''), job: String(f.job || ''), step: String(f.step || ''),
      line: Number(f.line) || 0, sev, cwe: String(f.cwe || ''), message: capMessage(String(f.detail || '')) };
    if (_setAsideWorktree(wt, row)) continue;
    if (sev) { c[sev]++; c.total++; } else undetermined++;
    byRule[rule] = byRule[rule] || { count: 0, sev };
    byRule[rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  if (wt.total) c.worktrees = _worktreesOf(wt, c.total + undetermined + wt.total, file);
  c.byRule = byRule;
  const unparseable = Number(j.summary.unparseable) || 0;
  const unreadable = Number(j.summary.unreadable) || 0;
  if (unparseable || unreadable) {
    c.partial = { unparseable, unreadable,
      note: `${unparseable} workflow(s) did not parse and ${unreadable} could not be read; none of them was judged, so these counts are a floor.` };
  }
  return { ...c, ..._detailFor('actionsGaps', rows) };
}

// ── in-house rule-counts lanes that say whether a result can be believed ─────────────────────────
// bin/actions-health.mjs (actionsHealth) and bin/hermetic-test.mjs (testHermetic). A void report is
// a lane that did not measure, carried as nosrc with its reason, never a clean zero.
function _ownRuleCounts(dir, file, tool, key, rowOf) {
  const p = join(dir, file); if (!existsSync(p)) return null;
  let raw; try { raw = readFileSync(p, 'utf8'); } catch { return null; }
  if (!raw.trim()) return { ..._zero(), ran: true, nosrc: true };
  let j; try { j = JSON.parse(raw); } catch { return { ..._zero(), ran: true, unparseable: true }; }
  if (!j || typeof j !== 'object' || j.tool !== tool || !j.summary || !Array.isArray(j.findings)) return { ..._zero(), ran: true, unparseable: true };
  if (j.summary.void) return { ..._zero(), ran: true, nosrc: true, ...(j.summary.voidReason ? { nosrcReason: String(j.summary.voidReason) } : {}) };
  const c = { ..._zero(), ran: true, filesScanned: Number(j.summary.filesScanned) || 0 };
  const byRule = {};
  const rows = [];
  let undetermined = 0;
  for (const f of j.findings) {
    if (!f || typeof f !== 'object') continue;
    const row = rowOf(f);
    if (row.sev) { c[row.sev]++; c.total++; } else undetermined++;
    byRule[row.rule] = byRule[row.rule] || { count: 0, sev: row.sev };
    byRule[row.rule].count++;
    rows.push(row);
  }
  if (undetermined) c.undetermined = undetermined;
  c.byRule = byRule;
  return { ...c, ..._detailFor(key, rows) };
}
const _sevOf = (s) => (['crit', 'high', 'med', 'low'].includes(s) ? s : '');

export function _actionsHealthCounts(dir, file) {
  return _ownRuleCounts(dir, file, 'actions-health', 'actionsHealth', (f) => ({
    rule: String(f.rule || ''), file: String(f.path || ''), sev: _sevOf(f.sev), message: capMessage(String(f.detail || '')) }));
}

export function _testHermeticCounts(dir, file) {
  return _ownRuleCounts(dir, file, 'test-hermetic', 'testHermetic', (f) => ({
    rule: String(f.rule || ''), file: String(f.path || ''), test: String(f.test || ''), sev: _sevOf(f.sev), message: capMessage(String(f.detail || '')) }));
}

// bin/guard-jackson-caseinsensitive.mjs. One med row per line that enables the toggle, the
// precondition for jackson-databind CVE-2026-54515 (medium); the matched line is not published.
// A guard that reached no verdict is toolfailed or unparseable with its cause in `reason`, and the
// closed-vocabulary reason is stamped where one fits more closely than tool-failed. Paths it could
// not read are counted in `unreadable`, beside the findings or in place of a clean zero.
const JACKSON_RULE = 'jackson-case-insensitive-enabled';
export function _jacksonGuardCounts(dir, file) {
  const r = readJacksonGuard(join(dir, file));
  const unread = r.unreadable && r.unreadable.length ? { unreadable: r.unreadable.length } : {};
  const voidOf = (flag, stamp) => ({ ..._zero(), ran: true, [flag]: true, reason: r.why, ...unread, ...(stamp ? unknown(stamp, r.why) : {}) });
  switch (r.state) {
    case 'absent': return null;
    case 'ok': return { ..._zero(), ran: true, filesScanned: r.scanned };
    case 'skipped': return { ..._zero(), ran: true, nosrc: true, nosrcReason: 'no .java/.yml/.properties files to guard' };
    case 'violation': {
      const rows = r.violations.map((h) => ({ rule: JACKSON_RULE, file: h.file, line: h.line, sev: 'med',
        message: 'ACCEPT_CASE_INSENSITIVE_PROPERTIES is enabled here, the precondition for jackson-databind CVE-2026-54515' }));
      return { ..._zero(), ran: true, med: rows.length, total: rows.length, ...unread, ..._detailFor('jacksonCaseInsensitive', rows) };
    }
    case 'unreadable-paths': return { ...voidOf('toolfailed'), ...(r.scanned != null ? { filesScanned: r.scanned } : {}) };
    case 'not-run': return voidOf('toolfailed', 'not-run');
    case 'empty': return voidOf('toolfailed', 'empty');
    case 'no-exit': return voidOf('toolfailed', 'not-recorded');
    default: return voidOf('unparseable');   // artifact-unreadable, unrecognised
  }
}
