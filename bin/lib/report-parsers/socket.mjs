import { high } from '../theme.mjs';
import { safeReadJSON } from './common.mjs';

export function parseSocket(path) {
  // @socketsecurity/cli scan create --json. In this fleet the scan needs an org + API token the
  // sweep doesn't have, so the live artifact is ALWAYS an error object { ok:false, message } — a
  // coverage VOID, never a clean pass (do not score green). On a real success (ok:true) the alerts
  // carry a severity (critical/high/middle/low; middle==medium).
  const j = safeReadJSON(path);
  if (!j) return { ok: false, summary: 'no socket data' };
  if (j.ok === false) return { ok: false, sev: 'noscan', summary: `socket did not run — ${(j.message || 'error').slice(0, 60)}` };
  // `ok:false` was handled; `ok` ABSENT was not, and fell through to an empty alert list scoring
  // green. A socket success carries `ok:true` (see above), so a document with neither the flag nor
  // an alerts/issues array is not a socket report at all — most likely another tool's error object.
  if (j.ok !== true && !j.alerts && !j.issues) return { ok: false, sev: 'noscan', summary: 'not a socket report — no ok/alerts/issues' };
  const alerts = [].concat(j.alerts || j.issues || []);
  const sevs = { critical: 0, high: 0, middle: 0, medium: 0, low: 0 };
  for (const a of alerts) { const s = (a.severity || '').toLowerCase(); if (s in sevs) sevs[s]++; }
  const total = alerts.length;
  const sev = (sevs.critical || sevs.high) ? 'high' : total ? 'med' : 'ok';
  return { ok: true, total, sev, summary: total ? `${total} supply-chain alert${total > 1 ? 's' : ''}` : '0' };
}
