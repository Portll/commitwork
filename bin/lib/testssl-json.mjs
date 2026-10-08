// Reads testssl's flat --jsonfile output ([{ id, severity, finding, cve? }]) into tls-headers findings.
// FATAL rows and scanProblem are about the scan itself, so they decide whether testssl ran, not what
// it found; OK/INFO/WARN/DEBUG are not findings.

const GRADED = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

export function readTestsslJson(raw, target) {
  let rows;
  try { rows = JSON.parse(raw); } catch (e) { return { ok: false, reason: `testssl.json is not JSON: ${e.message}` }; }
  if (!Array.isArray(rows)) return { ok: false, reason: 'testssl.json is not the flat array that --jsonfile writes' };
  if (!rows.length) return { ok: false, reason: 'testssl.json holds no rows' };
  const problems = rows.filter((r) => r && (r.severity === 'FATAL' || r.id === 'scanProblem'));
  if (problems.length) {
    return { ok: false, reason: `testssl reported a scan problem: ${problems.map((p) => p.finding).join('; ').slice(0, 200)}` };
  }
  const findings = rows.filter((r) => r && GRADED[r.severity]).map((r) => ({
    severity: GRADED[r.severity], target, issue: `testssl ${r.id}`,
    detail: [r.finding, r.cve].filter(Boolean).join(' · '),
  }));
  return { ok: true, rows: rows.length, findings };
}
