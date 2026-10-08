import { safeReadJSON } from './common.mjs';

export function parseMinify(path) {
  // bin/minify-detect.mjs → {tool, summary:{findings, byRule, filesScanned, filesSkipped, config}, findings:[...]}.
  // Findings never fail the check (a vendored bundle must not break `run all`); only a scanner
  // error or unparseable output is noscan. `sev` carries the mix so the badge is not silently
  // green, `ok` stays true, and per-rule severity becomes issues in the rollup's _minifyCounts.
  const j = safeReadJSON(path);
  if (!j || !j.summary || !Array.isArray(j.findings)) {
    return { ok: false, sev: 'noscan', summary: 'not a minify-detect report — no summary/findings' };
  }
  const scanned = j.summary.filesScanned || 0;
  const skipped = Array.isArray(j.summary.filesSkipped) ? j.summary.filesSkipped.length : 0;
  if (scanned === 0) return { ok: true, sev: 'ok', total: 0, summary: `0 — examined no scannable files${skipped ? `, ${skipped} skipped` : ''}` };
  const n = j.summary.findings || 0;
  const byRule = j.summary.byRule || {};
  const top = Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}×${v}`);
  const sev = j.findings.some((f) => f && f.sev === 'high') ? 'high'
    : j.findings.some((f) => f && f.sev === 'med') ? 'med'
    : n ? 'low' : 'ok';
  return { ok: true, sev, total: n,
    summary: n
      ? `${n} finding${n === 1 ? '' : 's'} across ${scanned} files${top.length ? ` — ${top.join(' ')}` : ''}${skipped ? `, ${skipped} skipped` : ''}`
      : `0 (${scanned} files${skipped ? `, ${skipped} skipped` : ''})` };
}
