import { readFileSync } from 'node:fs';
import { live, high } from '../theme.mjs';
import { safeReadJSON, voidResult } from './common.mjs';

export function parseNuclei(path) {
  // Nuclei writes JSONL (one finding per line), NOT a JSON document. Without this branch it fell
  // through to the generic { sev:'ok' } and a target riddled with live exposures scored GREEN as
  // long as the file existed — the manifest linter has been warning about exactly this on every
  // sweep. Severity comes from info.severity.
  //
  // LIVENESS: a template can match on a 404 error page, so a finding whose captured response is
  // 4xx/5xx is reported but NOT counted as a live exposure (the same rule bin/parse-runtime.mjs
  // applies). Network detects carry no HTTP status and are treated as live. Unconfirmed findings
  // are surfaced in the summary rather than silently dropped — invisible is not the same as absent.
  let text; try { text = readFileSync(path, 'utf8'); } catch { return { ok: false, summary: 'no nuclei data' }; }
  const rank = { critical: 4, high: 3, medium: 2, low: 1, info: 0, unknown: 0 };
  let live = 0, unconfirmed = 0, unreadable = 0, worst = 0, notFindings = 0;
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    let d; try { d = JSON.parse(t); } catch { notFindings++; continue; }
    // A nuclei finding is identified by its template. Without this guard ANY parsed object
    // counted: `{}` scored "1 live finding" (measured 2026-08-07) because it carries no HTTP
    // status and no `matched-at`, so the network-detect rule below — status null and not HTTP
    // ⇒ live by construction — promoted an empty object to a confirmed live exposure. The
    // liveness logic is right; it was just being handed things that were never findings.
    // Counted apart so a file of non-findings reports the void instead of a clean zero.
    if (!(d['template-id'] || d.templateID || d.template)) { notFindings++; continue; }
    const sev = String((d.info || {}).severity || 'unknown').toLowerCase();
    const resp = d.response || '';
    const m = resp.match(/^HTTP\/[\d.]+\s+(\d{3})/);
    const status = m ? parseInt(m[1], 10) : null;
    const isHttp = /^https?:\/\//i.test(d['matched-at'] || d.host || '') || d.type === 'http';
    // Three states, not two. `!isHttp || true` used to sit here — unconditionally true, which
    // made the isHttp test above dead code (filed in the audit corpus). The mirror
    // of bin/parse-runtime.mjs is `isHttp ? null : true`: a NETWORK detect carries no HTTP
    // status and is live by construction, while an HTTP finding whose response could not be
    // read is UNKNOWN — neither confirmed nor refuted.
    const confirmed = status === null ? (isHttp ? null : true) : status < 400;
    if (confirmed === false) { unconfirmed++; continue; }
    // Unknown liveness still raises severity. An unreadable response is not evidence that the
    // exposure is absent, and demoting it would be this repo's unsupported pass failure applied to
    // scoring. It is counted APART so the summary can say which of the two it is — that part
    // was never visible before, because both fell into one bucket named "live".
    if (confirmed === null) unreadable++; else live++;
    worst = Math.max(worst, rank[sev] ?? 0);
  }
  // Content that parsed but contained no nuclei records at all is a void, not a clean run: it is
  // what an error object or another tool's output looks like sitting in nuclei.jsonl. A genuinely
  // clean nuclei run writes an EMPTY file, which lands on the `0` below and stays green.
  if (!live && !unconfirmed && !unreadable && notFindings) {
    return { ok: false, sev: 'noscan', summary: `no nuclei records — ${notFindings} non-finding line(s)` };
  }
  if (!live && !unconfirmed && !unreadable) return { ok: true, total: 0, sev: 'ok', summary: '0' };
  const sev = worst >= 3 ? 'high' : worst === 2 ? 'med' : worst === 1 ? 'low' : 'ok';
  const counted = live + unreadable;
  return { ok: true, total: counted, sev,
    summary: `${live} live finding${live === 1 ? '' : 's'}` +
      `${unreadable ? ` (+${unreadable} liveness unknown: response unreadable)` : ''}` +
      `${unconfirmed ? ` (+${unconfirmed} unconfirmed: non-2xx response)` : ''}` };
}

export function parseSchemathesis(path) {
  // Schemathesis 4.x NDJSON: one single-key event object per line.
  //
  // REPLACES A SILENT GREEN. This check declared format 'generic' — a pass-through that scores ok
  // whenever the file exists. On 2026-08-01 a client API gateway's stream contained exactly three
  // events, the last of which was `FatalError: Failed to load schema (HTTP 401 Unauthorized)`.
  // The fuzzer never sent a single request and the sweep recorded `api-fuzz: pass`.
  //
  // A run that could not load the spec is a NOSCAN: nothing was tested, so there is no result to
  // be clean. A run that loaded the spec and finished with no failing scenario is a real ok.
  let text; try { text = readFileSync(path, 'utf8'); } catch { return { ok: false, summary: 'no schemathesis data' }; }
  if (!text.trim()) return { ok: false, sev: 'noscan', summary: 'schemathesis wrote no events — the run did not start' };
  let fatal = null, scenarios = 0, failures = 0, errors = 0;
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.FatalError) { fatal = ((o.FatalError.exception || {}).message) || 'fatal error'; continue; }
    const s = o.ScenarioFinished; if (!s) continue;
    scenarios++;
    const st = String(s.status || '').toLowerCase();
    if (st === 'failure') failures++; else if (st === 'error') errors++;
  }
  if (fatal && !scenarios) return { ok: false, sev: 'noscan', summary: `spec never loaded — ${String(fatal).slice(0, 70)}` };
  if (!scenarios) return { ok: false, sev: 'noscan', summary: 'no operations were tested' };
  const total = failures + errors;
  const sev = failures ? 'high' : errors ? 'med' : 'ok';
  return { ok: true, total, sev,
    summary: total ? `${failures} contract failure(s), ${errors} error(s) over ${scenarios} scenario(s)` : `0 (${scenarios} scenarios)` };
}

export function parseTlsHeaders(path) {
  // bin/tls-headers-scan.mjs writes {headers:{ran,grade,missing[]}, tls:{ran,findings[]}, ran, …}.
  // Two independently-gated halves; `ran:false` at top level means NEITHER looked, which is a
  // void and not a grade. (The previous declaration shelled straight to testssl.sh and filed the
  // result as 'generic' — pass-through — so seven clientA services graded an HTTP-only gateway
  // through a TLS-only tool and every one scored green.)
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no tls-headers data' };
  if (j.ran !== true) return voidResult(j.reason, 'nothing graded', 'no target');
  const missing = (j.headers && Array.isArray(j.headers.missing)) ? j.headers.missing.length : 0;
  const tls = (j.tls && Array.isArray(j.tls.findings)) ? j.tls.findings : [];
  const bad = tls.filter((f) => String((f && f.severity) || '').toLowerCase() === 'high').length;
  const total = missing + tls.length;
  const sev = bad ? 'high' : total ? 'med' : 'ok';
  const grade = (j.headers && j.headers.grade) ? ` headers ${j.headers.grade}` : '';
  return { ok: true, total, sev,
    summary: total ? `${missing} missing header(s), ${tls.length} TLS finding(s)${grade}` : `0${grade}` };
}

export function parseA11y(path) {
  // bin/a11y-scan.mjs writes {ran, conformance:{A,AA}, levels, criteria:[{id,level,state}]}.
  // A LEVEL-A FAILURE IS `high`: those criteria exclude people outright — an unlabelled control
  // or a missing lang attribute is not a papercut. AA failures are `med`. And `unchecked` never
  // scores green on its own: a scan whose criteria are mostly undecided has not established
  // conformance, so a report with zero failures but open unchecked criteria is `low`, not ok —
  // the same explicit uncertainty rule the rest of this file turns on, applied to a standard.
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no a11y data' };
  if (j.ran !== true) return voidResult(j.reason, 'not audited', 'no served HTML');
  const rows = Array.isArray(j.criteria) ? j.criteria : [];
  const failA = rows.filter((r) => r.state === 'fail' && r.level === 'A').length;
  const failAA = rows.filter((r) => r.state === 'fail' && r.level === 'AA').length;
  const unchecked = rows.filter((r) => r.state === 'unchecked').length;
  const total = failA + failAA;
  const sev = failA ? 'high' : failAA ? 'med' : unchecked ? 'low' : 'ok';
  return { ok: true, total, sev,
    summary: total
      ? `${failA} level-A / ${failAA} level-AA criteria failing (${unchecked} unchecked)`
      : `0 failing, ${unchecked} criteria unchecked — AA ${(j.conformance || {}).AA || 'unverified'}` };
}

export function parseAuthzBola(path) {
  // bin/authz-bola.mjs writes {tool, ran, skipped?, reason?, summary, findings[]}.
  //
  // The probe REFUSES TO GUESS endpoints: with no reachable OpenAPI it writes {ran:false} rather
  // than inventing paths, which is correct — but the check declared format 'generic', so that
  // refusal scored green. Measured 2026-08-01: seven clientA services recorded `dast-authz-bola:
  // pass` from a probe that had enumerated zero endpoints because the spec was behind auth.
  // BOLA is the highest breach-yield class here, so "we could not test it" must never read as
  // "it is not vulnerable".
  const j = safeReadJSON(path);
  if (!j || typeof j !== 'object') return { ok: false, summary: 'no authz-bola data' };
  if (j.ran !== true) return voidResult(j.reason, 'no endpoints probed', 'no spec');
  const n = ((j.findings || j.hits) || []).length;
  // Any object-level authorization hit is high: the probe only reports a finding when an object
  // came back to a caller that should not have seen it.
  return { ok: true, total: n, sev: n ? 'high' : 'ok',
    summary: n ? `${n} object-level authorization finding(s)` : '0 (endpoints probed, none exposed)' };
}
