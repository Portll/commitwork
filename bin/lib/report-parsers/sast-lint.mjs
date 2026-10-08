import { crit, high } from '../theme.mjs';
import { safeReadJSON } from './common.mjs';

export function parseRuleCounts(path) {
  // Shared shape for in-house lanes that count rule hits and never quote source:
  // {tool, summary:{findings, byRule, filesScanned}, findings:[{rule, path, sev, detail}]}.
  // Findings are monitor evidence, never a CI-gate failure (the minify rule), so `ok` stays true
  // while `sev` carries the worst row. filesScanned === 0 is a void, not a clean tree.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object' || typeof j.tool !== 'string' || !j.summary || !Array.isArray(j.findings)) {
    return { ok: false, sev: 'noscan', summary: 'not a rule-counts report — no tool/summary/findings' };
  }
  const scanned = Number(j.summary.filesScanned);
  if (!Number.isFinite(scanned) || scanned <= 0) {
    const why = typeof j.summary.voidReason === 'string' && j.summary.voidReason.trim() ? j.summary.voidReason.trim()
      : 'a walk that examined nothing is not a clean result';
    return { ok: false, sev: 'noscan', total: 0, summary: `${j.tool} scanned 0 files — ${why}` };
  }
  const rank = { crit: 4, critical: 4, high: 3, med: 2, medium: 2, low: 1 };
  const label = { 4: 'crit', 3: 'high', 2: 'med', 1: 'low' };
  const worst = j.findings.reduce((m, f) => Math.max(m, rank[String((f && f.sev) || '').toLowerCase()] || 0), 0);
  const total = j.findings.length;
  const byRule = j.summary.byRule && typeof j.summary.byRule === 'object' ? j.summary.byRule : {};
  const top = Object.entries(byRule).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([k, v]) => `${k}×${v}`);
  // fact: sev stays inside SEVERITY, crit folding into high and low or unrated into med as parseBearer folds them / a `low` row rendered 🟢 in index.md and ranked 0 in the worst-of, measured 2026-09-30 on cobolwork's agent-config, and `crit` fell through the same two maps (expiry: never, prev: wrong)
  const result = { ok: true, total, sev: !total ? 'ok' : worst >= 3 ? 'high' : 'med',
    summary: total
      ? `${total} finding${total === 1 ? '' : 's'} across ${scanned} files, worst ${label[worst] || 'unrated'}${top.length ? ` — ${top.join(' ')}` : ''}`
      : `0 (${scanned} files)` };
  // a partial read states what it could not read; zero findings beside that is a void, not a clean result
  if (j.summary.partial !== true) return result;
  const reasons = Array.isArray(j.summary.partialReasons) ? j.summary.partialReasons.map(String).join(', ') : '';
  const why = `partial read${reasons ? ` (${reasons.slice(0, 120)})` : ''}`;
  if (!total) return { ok: false, sev: 'noscan', partial: true, total: 0, summary: `${j.tool} found nothing in ${scanned} files, but read only part of its input: ${why}` };
  return { ...result, partial: true, summary: `${result.summary}; ${why}` };
}

export function parseBearer(path) {
  // Bearer writes `{ critical: [...], high: [...], medium: [...], low: [...] }` — severity-keyed
  // arrays, not a flat list, and NOT sarif. It was declared `generic` (a pass-through), so
  // classifyReport read total 0, fell into emptyClean, consulted the exit code — 1, which for
  // bearer is the ORDINARY "findings were produced" exit — and published the lane as
  // `nothing found, but the tool exited 1 — cannot tell clean from failed`.
  //
  // MEASURED 2026-08-28 on memory-layer and shodh-memory: the same rollup carried 171 and 216 bearer
  // rows in scannerFindings while its own repo entry listed sast-bearer under noscanReasons.
  // monitor/extractors.mjs understood the shape and this reader did not, so one artifact had two
  // readers that disagreed about whether it existed. That is the failure the second-witness rule
  // in CLAUDE.md exists for, arriving from the direction the rule did not name: not a guard that
  // was wrong, but two guards that were never asked to agree.
  //
  // Fails closed: an object without the four severity keys is a void, never a clean run. The
  // manifest deletes a zero-byte report itself, so ABSENT is handled by the caller's
  // reportMissing branch and an object here is always a real bearer document.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, sev: 'noscan', summary: 'not a bearer report — no severity buckets' };
  const BUCKETS = ['critical', 'high', 'medium', 'low'];
  const present = BUCKETS.filter((k) => Array.isArray(j[k]));
  if (!present.length) return { ok: false, sev: 'noscan', summary: 'not a bearer report — no severity buckets' };
  const n = (k) => (Array.isArray(j[k]) ? j[k].length : 0);
  const crit = n('critical'), high = n('high'), med = n('medium'), low = n('low');
  const total = crit + high + med + low;
  // SEVERITY has no `crit`/`low` rung, so critical folds into high and low into med — the same
  // any-finding-lifts-off-green convention hadolint uses. The real numbers survive in the summary
  // and, at full fidelity, in the extractor's rows.
  const sev = (crit || high) ? 'high' : total ? 'med' : 'ok';
  const parts = [];
  if (crit) parts.push(`${crit} critical`);
  if (high) parts.push(`${high} high`);
  if (med) parts.push(`${med} medium`);
  if (low) parts.push(`${low} low`);
  return { ok: true, total, sev, summary: total ? `${total} (${parts.join(', ')})` : '0' };
}

export function parseShellcheck(path) {
  // `shellcheck --format=json1` → { comments: [ { file, line, column, level, code, message } ] }.
  // json1, NOT json: plain `json` emits a BARE ARRAY, so `[]` from a clean run and `[]` from a
  // shellcheck that never examined anything are the same two bytes. The json1 wrapper makes the
  // `comments` key itself the proof that the tool produced structured output — the distinction
  // this codebase keeps having to rebuild, available for free by picking the other flag.
  const j = safeReadJSON(path);
  if (!j || !Array.isArray(j.comments)) return { ok: false, sev: 'noscan', summary: 'not a shellcheck report — no comments[]' };
  const c = j.comments;
  const errors = c.filter((f) => f.level === 'error').length;
  const warnings = c.filter((f) => f.level === 'warning').length;
  // info/style are real output but overwhelmingly stylistic, and lifting the lane to `med` on
  // SC2086 alone would make every shell script in the fleet permanently amber — an alarm nobody
  // reads is the same as no alarm. They are counted and NAMED in the summary instead of dropped:
  // surfaced without gating, because invisible is not the same as absent.
  const advisory = c.length - errors - warnings;
  const total = errors + warnings;
  const sev = errors ? 'high' : warnings ? 'med' : 'ok';
  const codes = [...new Set(c.filter((f) => f.level === 'error' || f.level === 'warning').map((f) => `SC${f.code}`))].slice(0, 4);
  // Exit 1 is shellcheck reporting, and advisory-only output (info/style) still exits 1; `exitOneIsReport`
  // lets the classifier tell that from a crash.
  return { ok: true, total, sev, advisory, exitOneIsReport: advisory > 0,
    summary: total
      ? `${total} (${errors}e/${warnings}w${advisory ? `, +${advisory} advisory` : ''}${codes.length ? ` — ${codes.join(' ')}` : ''})`
      : (advisory ? `0 (+${advisory} advisory)` : '0') };
}

export function parseCobolInventory(path) {
  // cobolwork inventory → coverage, never vulnerabilities. Every number here is a fact about what
  // was read, so the lane's severity says whether the READING was complete: unresolved copybooks
  // and unreadable files are `med`, a tree with neither is `ok`, and nothing here is ever crit.
  const j = safeReadJSON(path);
  if (!j || !j.summary) return { ok: false, sev: 'noscan', summary: 'not a cobolwork inventory — no summary' };
  if (!(j.schemaVersion >= 2)) return { ok: false, sev: 'noscan', summary: `cobolwork inventory schemaVersion ${j.schemaVersion ?? 'missing'} is older than 2 — upgrade cobolwork` };
  const s = j.summary;
  const scanned = s.filesScanned || 0;
  if (scanned === 0) return { ok: false, sev: 'noscan', summary: 'examined no COBOL, JCL or copybook files — coverage unknown' };
  const missing = s.copiesMissing || 0;
  const unreadable = s.filesUnreadable || 0;
  const total = missing + unreadable;
  const sev = total ? 'med' : 'ok';
  const formats = Object.entries(s.formats || {}).filter(([, v]) => v).map(([k, v]) => `${k}×${v}`);
  const parts = [`${s.programs || 0} programs in ${scanned} files`];
  if (formats.length) parts.push(formats.join(' '));
  if (missing) parts.push(`${missing} unresolved COPY`);
  if (unreadable) parts.push(`${unreadable} unreadable`);
  return { ok: true, sev, total, summary: parts.join(', ') };
}

export function parseActionlint(path) {
  // actionlint emits a bare array, so the manifest's Go-template -format wraps it as
  //   {"tool":"actionlint","ran":true,"findings":{{json .}}}
  // A tool that failed to run exits before rendering the template, so `ran:true` is a genuine
  // attestation; a repo with no workflows writes no such document at all.
  const j = safeReadJSON(path);
  if (!j || j.ran !== true || !Array.isArray(j.findings)) {
    return { ok: false, sev: 'noscan', summary: 'actionlint did not run — no ran:true marker' };
  }
  const f = j.findings;
  // actionlint carries NO severity field of any kind, so severity is derived here or not at all.
  // The one class that outranks the rest is untrusted input interpolated into an inline script —
  // the `${{ github.event.*.title }}` → shell injection path, which is a real RCE on
  // pull_request_target and is matched on actionlint's own wording rather than on `kind`, because
  // `kind:"expression"` covers both that and a harmless misspelled property.
  const injection = f.filter((x) => /potentially untrusted/i.test(String(x.message || ''))).length;
  const total = f.length;
  // Unknown kinds deliberately land in `med`, never below: an actionlint release that adds a
  // check this code has never heard of must show up, not quietly score clean.
  const sev = injection ? 'high' : total ? 'med' : 'ok';
  const kinds = [...new Set(f.map((x) => x.kind).filter(Boolean))].slice(0, 4);
  return { ok: true, total, sev, injection,
    summary: total
      ? `${total}${injection ? ` (${injection} UNTRUSTED-INPUT)` : ''}${kinds.length ? ` — ${kinds.join('/')}` : ''}`
      : '0' };
}
