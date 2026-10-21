import { safeReadJSON, voidResult } from './common.mjs';
import { readJacksonGuard } from '../../../monitor/jackson-guard-read.mjs';

export function parseHadolint(path) {
  // hadolint -f json → a flat JSON array of { code, level, file, line, message }. The manifest
  // writes '[]' itself when no Dockerfile matched, so a clean report is an empty array. level ∈
  // error|warning|info|style; any error ⇒ high, any other finding ⇒ med (codebase convention:
  // any finding lifts off green), empty ⇒ ok.
  const j = safeReadJSON(path);
  if (!Array.isArray(j)) return { ok: false, summary: 'no hadolint data' };
  const errors = j.filter((f) => f.level === 'error').length;
  const total = j.length;
  const sev = errors ? 'high' : total ? 'med' : 'ok';
  return { ok: true, total, sev, summary: total ? `${total} (${errors} error)` : '0' };
}

export function parseCspmGithub(path) {
  // bin/cspm-github.sh writes {ran,pass,fail} on success, else {ran:false,skipped:true,reason}.
  // The self-gated form is a VOID — prowler, the dedicated token or a github origin was absent, so
  // no control was evaluated. Reporting that as 0 failing controls would be the exact inversion.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no cspm data' };
  if (j.ran !== true) return voidResult(j.reason, 'not evaluated', 'self-gated');
  const fail = Number(j.fail) || 0, pass = Number(j.pass) || 0;
  return { ok: true, total: fail, sev: fail ? 'high' : 'ok',
    summary: fail ? `${fail} failing / ${pass} passing control(s)` : `0 failing / ${pass} passing` };
}

export function parseJacksonGuard(path) {
  // bin/guard-jackson-caseinsensitive.mjs, read through the reader the rollup shares.
  //
  // REPLACES A SILENT GREEN. The check declared 'generic', a pass-through that scored ok whatever
  // the report said, so a violation (exit 1) never moved the lane and the GUARD_FAIL marker the
  // command appended was read by nothing.
  //
  // A violation is med: the toggle is the precondition for one medium CVE (CVE-2026-54515, CVSS
  // 5.3), whatever jackson version is installed. Exit 2, an empty report and a missing exit code are
  // noscan. SKIPPED is n/a (`skip`), the rollup's nosrc: nothing to guard, so neither a pass nor a
  // void. It was noscan while the runner published a parser's skip as a pass.
  const r = readJacksonGuard(path);
  if (r.state === 'absent') return { ok: false, summary: 'no jackson-guard data' };
  if (r.state === 'ok') return { ok: true, total: 0, sev: 'ok', summary: `0 (${r.scanned} file(s) scanned, toggle not enabled)` };
  if (r.state === 'skipped') return { ok: true, total: 0, sev: 'skip', summary: 'no .java/.yml/.properties files to guard' };
  if (r.state === 'violation') {
    const n = r.violations.length;
    const shown = r.violations.slice(0, 3).map((h) => `${h.file}:${h.line}`).join(', ');
    return { ok: true, total: n, sev: 'med',
      summary: `${n} line(s) enable ACCEPT_CASE_INSENSITIVE_PROPERTIES: ${shown}${n > 3 ? ` (+${n - 3} more)` : ''}`
        + (r.unreadable.length ? `; ${r.unreadable.length} unreadable path(s) undetermined` : '') };
  }
  if (r.state === 'unreadable-paths') {
    return { ok: false, sev: 'noscan',
      summary: `${r.why} (${r.scanned ?? 'an unknown number of'} file(s) scanned); not a clean result` };
  }
  return { ok: false, sev: 'noscan', summary: r.why };
}
