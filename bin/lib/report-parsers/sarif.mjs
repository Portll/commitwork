import { readSarif, isSuppressed } from '../../../monitor/sarif-read.mjs';
import { sarifMalicious } from './common.mjs';

export function parseSarif(path) {
  // Maps sarif-read.mjs's typed states onto this CLI's vocabulary; the never-ran and
  // tool-failed guards live in the shared reader (hoisted from here 2026-08-21)
  const r = readSarif(path);
  if (r.state === 'absent' || r.state === 'unreadable') return { ok: false, summary: 'no report' };
  if (r.state === 'empty') return { ok: true, total: 0, sev: 'ok', nosrc: true, summary: '0 (no sources)' };
  if (r.state === 'unparseable') return { ok: false, sev: 'med', summary: 'unparseable sarif' };
  if (r.state === 'never-ran') return { ok: false, sev: 'noscan', summary: 'not a sarif document — no runs[]' };
  // 140 keeps the trailing "HTTP 404." of registry-URL reasons — a shorter cap cuts the WHY
  if (r.state === 'tool-failed') return { ok: false, sev: 'noscan', summary: `tool reported failure — ${r.reason.slice(0, 140)}` };
  // NORULES MEANS OPPOSITE THINGS PER TOOL, so it is decided per tool rather than uniformly.
  // osv-scanner's CLEAN output is norules-shaped — no advisory matched, so no rule is emitted —
  // and treating that as a void would turn every clean dependency scan grey. Semgrep is the
  // inverse: it always emits its loaded ruleset, so zero rules means the RULESET failed to load
  // and the run examined the tree against nothing. Same SARIF shape, opposite meaning, and the
  // uniform reading scored the second one as a clean repository.
  //
  // This is the trufflehog receipt rule for a tool that states its work in the report rather than
  // a log: for semgrep the rule count IS the receipt, and 3033 rules against 0 findings is a
  // different claim from 0 rules against 0 findings. Measured on real artifacts 2026-08-22 —
  // nodejs_undici and vercel_satori both carry 3033 rules from "Semgrep PRO".
  //
  // Findings still gate nothing: a run that FOUND something proves itself, so the check applies
  // only on the empty path. Name-matched loosely because the driver reports "Semgrep PRO" on this
  // box and plain "semgrep" elsewhere.
  if (r.norules && /semgrep/i.test(String(r.tool || ''))) {
    return { ok: false, sev: 'noscan', total: 0, norules: true,
      summary: 'semgrep loaded ZERO rules — the tree was examined against nothing, which is not a clean scan' };
  }
  const live = r.results.filter((res) => !isSuppressed(res));
  const suppressed = r.results.length - live.length;
  const levels = { error: 0, warning: 0, note: 0, none: 0 };
  for (const res of live) { const l = res.level || 'warning'; levels[l] = (levels[l] || 0) + 1; }
  // Confirmed malware outranks the level tally — never `med`, whatever osv-scanner labelled it.
  const mal = sarifMalicious(r.runs);
  const sev = (mal.hits || levels.error) ? 'high' : live.length ? 'med' : 'ok';
  const unparsed = r.extractionErrors.length;
  const detail = (live.length
    ? `${live.length} (${levels.error}e/${levels.warning}w${mal.hits ? `, ${mal.hits} MALICIOUS` : ''})`
    : '0') + (suppressed ? ` · ${suppressed} suppressed in source` : '') + (unparsed ? ` — ${unparsed} file(s) failed extraction` : '');
  // A zero nothing witnessed. Carried, not acted on: the grade stays as measured, because
  // promoting it here would fail 2,103 of 10,354 stored SARIFs, most of them truly clean.
  // The consumer that holds the exit witness decides; one that holds none must not read it clean.
  return { ok: true, total: live.length, suppressed, sev, summary: detail, levels, malicious: mal.hits, maliciousIds: mal.ids,
    unwitnessedZero: r.unwitnessedZero };
}
