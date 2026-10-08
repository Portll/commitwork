// scanner-quirks.mjs — a scanner's own error notifications, classified against declared upstream
// defects so the coverage they cost is countable.
//
// THE PROBLEM. Measured 2026-08-26 over the 100-repository corpus: the Semgrep OSS engine emitted
// 36,037 "Internal matching error" notifications, five rules accounting for essentially all of them,
// two of those five reporting an identical 10,121. The same rules under --pro-intrafile: 24. Every
// one of those runs exited 0 and published a finding count. A crashed rule finds nothing and looks
// exactly like a rule that found nothing.
//
// WHAT THIS DOES AND DOES NOT DO. It never suppresses a finding and never edits a count. It reads
// the notifications a scanner already publishes about itself and answers one question: is this a
// KNOWN upstream defect we have measured and can name, or an unexplained error? Both are reported;
// only the second should surprise anyone. An unexplained error is the more interesting state and is
// never folded into the known bucket.
//
// Env: CW_SCANNER_QUIRKS (path), CW_SCANNER_QUIRKS_OFF=1 to classify nothing. Read at CALL time.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const quirksPath = () => process.env.CW_SCANNER_QUIRKS
  || resolve(HERE, '..', 'manifests', 'scanner-quirks.json');

export const enabled = () => process.env.CW_SCANNER_QUIRKS_OFF !== '1';

let cache = null; let cacheFrom = null;

/** Fail closed and LOUD: an unreadable registry means nothing can be classified, so every error
 *  becomes unexplained. That is the safe direction — the alternative silently reclassifies real
 *  surprises as known ones. */
export function loadQuirks({ path = quirksPath() } = {}) {
  if (cache && cacheFrom === path) return cache;
  if (!existsSync(path)) return { version: 0, quirks: [], state: 'absent' };
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    return { version: 0, quirks: [], state: 'unreadable', error: String(e.message) };
  }
  if (!Array.isArray(doc.quirks)) return { version: 0, quirks: [], state: 'malformed' };
  cache = { ...doc, state: 'present' }; cacheFrom = path;
  return cache;
}

export function resetQuirkCache() { cache = null; cacheFrom = null; }

const ruleOf = (msg) => (String(msg || '').match(/running ([\w.\-]+)/) || [])[1] || null;

/** Match one notification against the declared quirks. Returns the quirk id or null. */
export function classifyNotification(n, { doc = loadQuirks() } = {}) {
  if (!enabled()) return null;
  const id = String(n?.descriptor?.id || n?.id || '');
  const msg = String(n?.message?.text || n?.message || '');
  const rule = ruleOf(msg);
  for (const q of doc.quirks || []) {
    const m = q.match || {};
    const hits = (t) => id.toLowerCase().includes(String(t).toLowerCase())
      || msg.toLowerCase().includes(String(t).toLowerCase());
    if (m.notificationId && !hits(m.notificationId)) continue;
    // anyOf is a SET of ids one bound covers — three semgrep parse states are one coverage class,
    // and splitting them into three entries would make the same fact look like three findings.
    if (Array.isArray(m.notificationIdAnyOf) && !m.notificationIdAnyOf.some(hits)) continue;
    if (m.messageContains && !msg.includes(m.messageContains)) continue;
    // A rule list NARROWS the quirk. An entry with rules listed matches only those, so a NEW rule
    // hitting the same crash is reported as unexplained rather than absorbed into a known count —
    // which is how a widening defect would otherwise stay invisible.
    if (Array.isArray(q.rules) && q.rules.length) {
      if (!rule || !q.rules.includes(rule)) continue;
    }
    return q.id;
  }
  return null;
}

/**
 * Summarise a scanner's notifications.
 * @returns {{total, known: Object, unexplained: number, unexplainedRules: string[], enabled: boolean, note: string}}
 */
export function summariseNotifications(notifications, { doc = loadQuirks() } = {}) {
  const known = {}; const unexplainedRules = new Set();
  let unexplained = 0; let total = 0;
  for (const n of notifications || []) {
    total++;
    const q = classifyNotification(n, { doc });
    if (q) { known[q] = (known[q] || 0) + 1; continue; }
    unexplained++;
    const r = ruleOf(n?.message?.text || n?.message);
    if (r) unexplainedRules.add(r);
  }
  const knownTotal = Object.values(known).reduce((a, b) => a + b, 0);
  return {
    enabled: enabled(),
    registryState: doc.state || 'present',
    total,
    known,
    knownTotal,
    unexplained,
    unexplainedRules: [...unexplainedRules].slice(0, 20),
    note: total
      ? `${total} scanner error notifications: ${knownTotal} match a declared upstream defect, ${unexplained} are unexplained. Every one of them is a rule that did not run, so this is a coverage bound, not a clean result.`
      : '',
  };
}

export default { loadQuirks, classifyNotification, summariseNotifications, quirksPath, enabled };
