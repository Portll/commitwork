#!/usr/bin/env node
// semgrep-pro-delta — the NEGATIVE delta: unsuppressed findings the OSS engine reports and the
// Pro engine does not.
//
// Why this exists. Pro is a different analysis, not a superset of OSS. Measured 2026-08-30 across
// ten repositories: four gained, four were identical, and two reported FEWER under Pro. On that
// corpus every difference turned out to be Pro correctly discarding noise — but that was
// established by opening the files, not by the counts, and semgrep/semgrep#10761 (open, unassigned)
// is an outright result-loss mode where Pro drops taint findings once a directory holds many
// files. A lane that allocates Pro per repository therefore needs the loss to be MEASURABLE rather
// than assumed absent. manifests/security-baseline.json runs the OSS control pass only where Pro
// ran, and this reads both artifacts.
//
// SUPPRESSED FINDINGS ARE NOT FINDINGS. semgrep emits `nosemgrep`-suppressed results into SARIF
// flagged `suppressions:[{kind:"inSource"}]` so consumers can filter them. Counting raw
// `results[]` was the defect that produced a wrong published conclusion on 2026-08-30: two of the
// five claimed losses were already suppressed, one under a comment reading "FALSE POSITIVE".
//
// IDENTITY EXCLUDES `line`, per the house rule: code moves for reasons unrelated to the finding,
// and a line-keyed identity converts that movement into a state change.
import { join } from 'node:path';
// SARIF-document access lives in monitor/sarif-read.mjs and nowhere else, enforced by
// monitor/test/one-sarif-reader.test.mjs. This module hand-rolled it at first and reproduced the
// exact defect the rule exists to stop: `(JSON.parse(raw).runs || [])[0]` makes a runs-less husk
// read as an empty scan, and `results || []` turns a void back into a clean zero. The shared
// reader separates absent / unreadable / empty / unparseable / never-ran / tool-failed, and
// returns results:null for every non-ok state ON PURPOSE.
import { readSarif } from '../monitor/sarif-read.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const PRO = 'semgrep.sarif';
const OSS = 'semgrep-oss.sarif';

/** Unsuppressed results only. A suppressed result is a judgement already made, not a finding. */
export const live = (results) => (results || []).filter((r) => !(r.suppressions && r.suppressions.length));

/** rule + file. NEVER the line. */
export const identity = (r) => {
  const loc = ((r.locations || [])[0] || {}).physicalLocation || {};
  return `${r.ruleId}@${(loc.artifactLocation || {}).uri || '?'}`;
};

/**
 * Adapt the shared reader to what the delta needs: {ok, results, engine} or {ok:false, reason}.
 * `absent` is preserved as its own reason because it means "this repo is not Pro-allocated" —
 * a different thing from "the control pass failed", and it must not read as either a loss or a pass.
 */
export function read(path) {
  const r = readSarif(path);
  if (r.state === 'ok') return { ok: true, results: r.results, engine: r.tool || 'unknown' };
  return { ok: false, reason: r.state === 'absent' ? 'absent' : `${r.state}: ${r.reason}` };
}

/**
 * -> { state, lost, engines }. `state` is one of:
 *   'not-applicable' — no control pass (this repo does not run Pro). Not a pass, not a finding.
 *   'unknown'        — a pass exists but could not be read. NEVER reported as "no loss".
 *   'measured'       — both read; `lost` is the negative delta.
 */
export function delta(reportDir, rd = read) {
  const pro = rd(join(reportDir, PRO));
  const oss = rd(join(reportDir, OSS));
  if (oss.reason === 'absent') return { state: 'not-applicable', lost: [], engines: null };
  if (!oss.ok) return { state: 'unknown', reason: oss.reason, lost: [] };
  if (!pro.ok) return { state: 'unknown', reason: `pro: ${pro.reason}`, lost: [] };
  // A control pass that ran the SAME engine measures nothing — say so rather than reporting zero.
  if (pro.engine === oss.engine) {
    return { state: 'unknown', reason: `both artifacts report engine "${pro.engine}" — no comparison`, lost: [] };
  }
  const seen = new Set(live(pro.results).map(identity));
  const lost = [...new Set(live(oss.results).map(identity))].filter((k) => !seen.has(k)).sort();
  return { state: 'measured', lost, engines: { pro: pro.engine, oss: oss.engine } };
}

if (isMainModule(import.meta.url)) {
  const dir = process.argv[2] || process.env.CW_REPORT_DIR;
  if (!dir) { console.error('usage: semgrep-pro-delta.mjs <report-dir>'); process.exit(2); }
  const d = delta(dir);
  if (d.state === 'not-applicable') { console.log('pro-delta: not applicable (no OSS control pass — repo is not Pro-allocated)'); process.exit(0); }
  if (d.state === 'unknown') { console.error(`pro-delta: UNKNOWN — ${d.reason}`); process.exit(1); }
  if (!d.lost.length) { console.log(`pro-delta: 0 lost (${d.engines.oss} vs ${d.engines.pro})`); process.exit(0); }
  console.log(`pro-delta: ${d.lost.length} finding(s) reported by ${d.engines.oss} and NOT by ${d.engines.pro}:`);
  for (const k of d.lost) console.log(`  ${k}`);
  process.exit(0);
}
