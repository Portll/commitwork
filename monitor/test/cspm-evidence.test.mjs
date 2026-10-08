// Prowler asserts a definite FAIL for a control it judged from a field GitHub never returned.
//
// MEASURED, not inferred — the inference in evaluations/bifocal-scanner-remediation-2026-08-22.json
// was WRONG about the mechanism and this file records the correction. Across the fleet's 614 OCSF
// artifacts on 2026-08-22: PASS 1675 / FAIL 9225 / MANUAL 102, and every one of those 102 MANUALs
// is on "Repository deletes branches after pull request merge". The secret-scanning control is
// 596 FAIL / 18 PASS with no MANUAL at all. So mapping MANUAL to undetermined — the fix the
// evaluation proposed — would have moved 102 rows on an unrelated control and left 596
// unfalsifiable ones asserting a fact nobody checked.
//
// The real mechanism: GitHub omits `security_and_analysis` entirely for a token without the
// privilege — no null, no error, the key is simply absent. Verified the same day against
// Portll/commitwork, a PRIVATE repo where the operator holds admin: still absent. So this cannot
// be inferred from ownership and had to be probed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _cspmCounts } from '../extractors.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-cspm-'));
const ocsf = (rows) => rows.map((r) => ({
  status_code: r.status || 'FAIL',
  severity: r.severity || 'High',
  status_detail: r.detail || `Repository x does not have ${r.title}.`,
  finding_info: { title: r.title },
  resources: [{ data: { metadata: { full_name: 'o/r' } } }],
}));

function plant(summary, rows) {
  const d = mkdtempSync(join(T, 'r-'));
  writeFileSync(join(d, 'cspm-github.ocsf.json'), JSON.stringify(ocsf(rows)));
  writeFileSync(join(d, 'cspm-github.json'), JSON.stringify({
    tool: 'cspm-github', ran: true, repo: 'o/r', credential: 'gh-session',
    detail: 'cspm-github.ocsf.json', ...summary,
  }));
  return d;
}

const SECRET = 'Repository has secret scanning enabled to detect sensitive data';
const BRANCH = 'Repository default branch denies force pushes';

test('with the evidence ABSENT, an evidence-gated FAIL becomes undetermined, not a finding', () => {
  const d = plant({ pass: 0, fail: 2, securityAndAnalysisEvidence: 'absent' },
    [{ title: SECRET }, { title: BRANCH }]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.evidenceBlindControls, 1, 'only the evidence-gated control is downgraded');
  assert.equal(c.undetermined, 1);
  assert.equal(c.low, 1, 'the branch-protection FAIL is real and stays a finding — at `low` since 2026-08-28, because a repository SETTING is a recommendation and not a detected weakness. What this test guards is that it is not swallowed by the evidence gate, and that is unchanged.');
  assert.equal(c.total, 1);
  const secret = c.findings.find((f) => f.control === SECRET);
  assert.equal(secret.sev, '', 'an undetermined control HAS no severity — giving it one is the assertion again');
  assert.match(secret.message, /did not return security_and_analysis/);
  assert.match(secret.message, /Prowler reported:/, 'the original claim is preserved, not erased');
});

test('with the evidence VISIBLE, the same FAIL is a real finding — this must not downgrade everything', () => {
  const d = plant({ pass: 0, fail: 2, securityAndAnalysisEvidence: 'visible' },
    [{ title: SECRET }, { title: BRANCH }]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.evidenceBlindControls, undefined);
  assert.equal(c.low, 2, 'a token that CAN see the field makes prowler\'s verdict trustworthy');
  assert.equal(c.undetermined, undefined);
});

test('an unprobed report is left alone — absence of the probe is not evidence of blindness', () => {
  const d = plant({ pass: 0, fail: 1 }, [{ title: SECRET }]);   // no securityAndAnalysisEvidence key
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.low, 1, 'every rollup written before the probe existed must keep its counts');
  assert.equal(c.evidenceBlindControls, undefined);
});

test('MANUAL is carried as undetermined and enters NO severity bucket', () => {
  const d = plant({ pass: 0, fail: 1, manual: 102 }, [{ title: BRANCH }]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.undetermined, 102, 'prowler\'s own could-not-determine was previously dropped entirely');
  assert.equal(c.low, 1);
  assert.equal(c.crit + c.med + c.high, 0);
});

test('the downgrade set is narrow — a wide match would silently bury real findings', () => {
  const d = plant({ pass: 0, fail: 4, securityAndAnalysisEvidence: 'absent' }, [
    { title: SECRET },
    { title: 'Repository has secret scanning push protection enabled' },
    { title: BRANCH },
    { title: 'Repository has a CODEOWNERS file' },
  ]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.evidenceBlindControls, 2, 'only the two that read security_and_analysis');
  assert.equal(c.low, 2, 'branch protection and CODEOWNERS are read from elsewhere and stay findings');
});

test('counts never go negative even if the producer and the rows disagree', () => {
  // The producer's `fail` is authoritative for the total; the rows can only ever be a subset. If a
  // detail file somehow carries more gated rows than the summary counted, the arithmetic must
  // clamp rather than publish a negative finding count.
  const d = plant({ pass: 0, fail: 1, securityAndAnalysisEvidence: 'absent' },
    [{ title: SECRET }, { title: SECRET }, { title: SECRET }]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.ok(c.low >= 0 && c.total >= 0);
});

// THE BUCKET IS PART OF THE CONTRACT, so it is asserted rather than left implicit.
//
// Until 2026-08-28 this lane put the producer's whole `fail` count in `high`. Every FAIL it emits
// for a GitHub repository is a SETTING somebody has not switched on — branch protection, required
// reviewers, signed commits, CODEOWNERS — and none is a weakness detected in the code. Measured
// that day: memory-layer and shodh-memory failed the SAME 14 controls, control for control, 8 of them at
// `high`. A control that fails on essentially every repository is measuring adoption, not risk, and
// several of these are gated behind a paid plan, so the severity was the platform's rather than
// this fleet's.
//
// OPERATOR RULING: capped at `low` and labelled, never dropped. The two halves below are what make
// that honest — nothing is hidden, and the platform's own severity is preserved on the row.
test('every FAIL row is labelled a suggestion and keeps the severity the platform claimed', () => {
  const d = plant({ pass: 0, fail: 1, securityAndAnalysisEvidence: 'visible' }, [{ title: BRANCH }]);
  const c = _cspmCounts(d, 'cspm-github.json');
  assert.equal(c.low, 1, 'a repository setting is a low, whatever the platform called it');
  assert.equal(c.high, 0, 'and it must not also appear in high — one input, one bucket');
  const rows = c.findings ? Object.values(c.findings) : [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].suggestion, true, 'the row must SAY it is a suggestion, not merely be filed as one');
  assert.equal(rows[0].claimedSeverity, 'high', "the platform's own severity is preserved, so the downgrade is auditable rather than silent");
  assert.match(rows[0].message, /does not have/, "and prowler's own detail still travels, so an operator can still act on it");
});
