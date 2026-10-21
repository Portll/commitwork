// admin/lib/served-projection.mjs — read-time allowlist projection for tunnel-served payloads.
// Pattern: bin/verdict-journal.mjs redactGateRecord. Each projector names the fields a panel
// surface renders; anything unnamed does not cross the tunnel (free text, absolute paths,
// session/pid are the risk class — monitor/sweep-verdict.mjs assertServedSafe pins it in tests).
// Every projector is pure over its inputs; the two fs readers take explicit paths (env seams stay
// with the callers). Fail closed: only ENOENT is absence; parse failure is 'unreadable', never {}.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { sanitizeServed } from '../../monitor/sweep-verdict.mjs';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const str = (v, cap = 200) => (typeof v === 'string' ? v.slice(0, cap) : null);

/** Three-state file read: {state:'ok',data} | {state:'absent'} | {state:'unreadable',detail}. */
export function readJSONState(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { state: 'absent' };
    return { state: 'unreadable', detail: (e && e.code) || 'error' };
  }
  try { return { state: 'ok', data: JSON.parse(raw) }; }
  catch { return { state: 'unreadable', detail: 'parse' };
  }
}

// ── conservation (rollup.json `conservation:{checked,violations}` — monitor/conserve.mjs) ───────
// Absent field => the rollup predates the check (or no rollup): 'never-checked', never a clean 0.
export function projectConservation(c) {
  if (!c || typeof c !== 'object') return { state: 'never-checked' };
  const checked = Array.isArray(c.checked) ? c.checked.map((x) => str(x, 80)).filter(Boolean) : [];
  const violations = (Array.isArray(c.violations) ? c.violations : []).map((v) => ({
    category: str(v && v.category, 80),
    declared: isNum(v && v.declared) ? v.declared : null,
    published: isNum(v && v.published) ? v.published : null,
    truncated: isNum(v && v.truncated) ? v.truncated : null,
  }));
  return sanitizeServed({ state: 'checked', checked, violations });
}

// ── artifact anomalies (reports-root artifact-anomalies.json — monitor/artifact-anomaly.mjs) ────
const ANOMALY_REPO_SHOW = 20;
export function projectAnomalies(res) {
  if (!res || res.state === 'absent') return { state: 'never-measured' };
  if (res.state === 'unreadable') return { state: 'unreadable', detail: str(res.detail, 40) };
  if (!Array.isArray(res.data)) return { state: 'unreadable', detail: 'not-an-array' };
  const anomalies = res.data.map((a) => {
    const repos = (Array.isArray(a && a.repos) ? a.repos : []).map((r) => str(r, 120)).filter(Boolean);
    return {
      category: str(a && a.category, 80),
      hash: str(a && a.hash, 12), // prefix only — enough to correlate, never the full digest
      repoCount: isNum(a && a.repoCount) ? a.repoCount : null,
      bytes: isNum(a && a.bytes) ? a.bytes : null,
      repos: repos.slice(0, ANOMALY_REPO_SHOW),
      // truncation is stated, never silent: file-level cap + this display cap, summed
      truncated: (isNum(a && a.truncated) ? a.truncated : 0) + Math.max(0, repos.length - ANOMALY_REPO_SHOW),
    };
  });
  return sanitizeServed({ state: 'measured', count: anomalies.length, anomalies });
}

// ── timeline slice verify (history/index.json sliceSha256 three-state — monitor/timeline.mjs) ───
// match -> verified; mismatch/unreadable file -> unreadable (valid JSON is not trusted JSON);
// no recorded hash -> 'unverified-legacy', its own state and NEVER an alarm.
const VERIFY_WINDOW = 20;
export function projectTimelineVerify(histDir, { cap = VERIFY_WINDOW } = {}) {
  const idx = readJSONState(join(histDir, 'index.json'));
  if (idx.state === 'absent') return { state: 'no-history' };
  if (idx.state === 'unreadable') return { state: 'unreadable', detail: idx.detail };
  if (!Array.isArray(idx.data)) return { state: 'unreadable', detail: 'not-an-array' };
  if (!idx.data.length) return { state: 'no-history' };
  const rows = [...idx.data]
    .sort((a, b) => String(a.generated || '').localeCompare(String(b.generated || '')))
    .slice(-cap);
  const slices = rows.map((e) => {
    const out = { sliceId: str(e && e.sliceId, 60), stamp: str(e && e.stamp, 20), generated: str(e && e.generated, 30) };
    if (!e || !e.sliceSha256) return { ...out, verify: 'unverified-legacy' };
    let buf;
    try { buf = readFileSync(join(histDir, String(e.file || `${e.stamp}.json`))); }
    catch (err) { return { ...out, verify: 'unreadable', detail: (err && err.code) || 'error' }; }
    const actual = createHash('sha256').update(buf).digest('hex');
    return actual === e.sliceSha256
      ? { ...out, verify: 'verified' }
      : { ...out, verify: 'unreadable', detail: 'sha256-mismatch' };
  });
  const counts = { verified: 0, 'unverified-legacy': 0, unreadable: 0 };
  for (const s of slices) counts[s.verify]++;
  return sanitizeServed({ state: 'ok', window: slices.length, total: idx.data.length, counts, slices });
}

// ── fatigue (bin/verdict-journal.mjs fatigueReport over the adjudications journal) ──────────────
// journal.absent  -> 'no-journal' (unknown — nothing was ever recorded, explicit uncertainty)
// zero suppression-label rows in a live journal -> 'zero-unreinforced' (an uncorroborated zero:
//   nothing feeds suppression labels here; distinct from unknown AND from a corroborated empty)
// targets present -> 'ok' with the allowlist (target/count/labels/everExpiring — `who` and the
//   derived sentence never cross the tunnel; the panel composes its own copy).
export function projectFatigue(journal, report) {
  if (journal && journal.absent) return { state: 'no-journal' };
  const targets = (report && Array.isArray(report.targets) ? report.targets : []).map((t) => ({
    target: str(t && t.target, 200),
    count: isNum(t && t.count) ? t.count : 0,
    labels: isNum(t && t.labels) ? t.labels : 0,
    everExpiring: !!(t && t.everExpiring),
  }));
  if (!targets.length) {
    const fed = !!(journal && (journal.records || []).some((r) => r && r.kind === 'suppression-label'));
    return { state: fed ? 'zero-corroborated' : 'zero-unreinforced' };
  }
  return sanitizeServed({ state: 'ok', empty: false, targets });
}

// ── calibration (bin/verdict-journal.mjs computeFindingCalibration aggregate) ───────────────────
// No finding-adjudication records -> 'no-records' ("calibration is UNKNOWN, not zero").
// Rates stay null when adjudicated is 0 — null is served as null, never coerced to 0.
export function projectCalibration(calib) {
  if (!calib || !calib.checks || !Object.keys(calib.checks).length) return { state: 'no-records' };
  const checks = {};
  for (const [check, models] of Object.entries(calib.checks)) {
    const node = {};
    for (const [model, m] of Object.entries(models || {})) {
      node[str(model, 60)] = {
        denominator: isNum(m && m.denominator) ? m.denominator : 0,
        adjudicated: isNum(m && m.adjudicated) ? m.adjudicated : 0,
        unadjudicated: isNum(m && m.unadjudicated) ? m.unadjudicated : 0,
        falseAlarmRate: isNum(m && m.falseAlarmRate) ? m.falseAlarmRate : null,
        falseCleanRate: isNum(m && m.falseCleanRate) ? m.falseCleanRate : null,
        cohortUnknown: isNum(m && m.cohortUnknown) ? m.cohortUnknown : 0,
      };
    }
    checks[str(check, 80)] = node;
  }
  return sanitizeServed({ state: 'ok', generated: str(calib.generated, 30), checks });
}

// ── escalations (bin/issue-llm.mjs N-chain review that did not converge) ────────────────────────
// finding-adjudication rows whose provenance is 'escalation:<reason>(<n>)'. truth is null on all
// of them BY DESIGN (one model's self-consistency, never ground truth) — this is a needs-a-human
// queue, so a row must never render as adjudicated. basis/evidence are sha256 envelopes on disk
// (write-time redactLedgerFields); only their EXISTENCE crosses the tunnel, never the digest.
// journal.absent -> 'no-journal'. Zero escalations splits on whether the reviewer has EVER written
// here (any provenance-bearing row): corroborated zero vs uncorroborated (violet, not grey).
// A later truth-bearing record for the same findingKey resolves the escalation out of the queue.
const ESCALATION_RE = /^escalation:([a-z-]+)\((\d+)\)$/;
const ESCALATION_SHOW = 50;
export function projectEscalations(journal) {
  if (journal && journal.absent) return { state: 'no-journal' };
  const records = (journal && journal.records) || [];
  const adjudicated = new Set();
  let producerSeen = false;
  const rows = [];
  for (const r of records) {
    if (!r || r.kind !== 'finding-adjudication') continue;
    if (typeof r.provenance === 'string' && r.provenance) producerSeen = true;
    if (r.findingKey && ['true-alarm', 'false-alarm', 'true-clean', 'false-clean'].includes(r.truth)) adjudicated.add(r.findingKey);
    if (typeof r.provenance !== 'string' || !r.provenance.startsWith('escalation:')) continue;
    const m = ESCALATION_RE.exec(r.provenance);
    rows.push({
      findingKey: str(r.findingKey, 200),
      category: str(r.category, 80),
      repo: str(r.repo, 120),
      // unparseable provenance is its own reading, never coerced into a known reason
      reason: m ? m[1] : 'unparsed',
      chains: m ? Number(m[2]) : null,
      at: str(r.at, 30),
      model: str(r.model, 80),
      // envelope EXISTENCE only — the sealed text and its digest stay on disk
      evidenceSealed: !!(r.evidence && typeof r.evidence === 'object' && r.evidence.sha256),
      basisSealed: !!(r.basis && typeof r.basis === 'object' && r.basis.sha256),
    });
  }
  const pending = rows.filter((r) => !(r.findingKey && adjudicated.has(r.findingKey)));
  const resolved = rows.length - pending.length;
  if (!rows.length) return { state: producerSeen ? 'zero-corroborated' : 'zero-unreinforced' };
  return sanitizeServed({
    state: 'ok', pending: pending.length, resolved,
    // newest first; truncation stated, never silent
    rows: pending.slice(-ESCALATION_SHOW).reverse(),
    truncated: Math.max(0, pending.length - ESCALATION_SHOW),
  });
}

// ── runtime raw-passthrough repair: tls-headers.json / cspm-github.json served whole ────────────
// The panel reads exactly these fields (admin/index.html runtime card); the rest of each file —
// probe URLs, header VALUES, raw API echoes — never crossed anyone's allowlist and now does not
// cross the tunnel. null in => null out (the panel's truthiness gates keep their meaning).
export function projectRuntimeTls(j) {
  if (!j || typeof j !== 'object') return null;
  const h = j.headers && typeof j.headers === 'object' ? j.headers : null;
  return sanitizeServed({
    status: str(j.status, 80),
    headers: h ? {
      ran: !!h.ran,
      grade: str(h.grade, 12),
      missing: (Array.isArray(h.missing) ? h.missing : []).map((m) => str(m, 60)).filter(Boolean),
    } : null,
  });
}

export function projectRuntimeCspm(j) {
  if (!j || typeof j !== 'object') return null;
  return sanitizeServed({
    ran: !!j.ran,
    pass: isNum(j.pass) ? j.pass : null,
    fail: isNum(j.fail) ? j.fail : null,
    reason: str(j.reason, 200),
  });
}
