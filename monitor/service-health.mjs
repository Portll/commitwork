// monitor/service-health.mjs — D2/L1 and D2/L3 from the 2026-08-22 outage remediation.
//
// TWO CHECKS THE DEADMAN DID NOT HAVE. monitor/liveness.mjs measures whether SWEEPS are fresh. On
// 2026-08-22 it reported `gate liveness: ok` every hour for five and a half hours while
// commitwork.online served 502, because nothing in it asks whether a declared service is answering,
// and nothing asks whether liveness itself has been running.
//
// ── L1: THREE FACTS, NEVER ONE ─────────────────────────────────────────────────────────────────
// fact: "is the panel up" is three independently-failing questions — launchd job LOADED (the 2026-08-22 cause: it was not), port LISTENING, and ANSWERS over HTTP (expiry: never, prev: wrong)
// fact: each is reported separately with its own could-not-determine / a job can be loaded with nothing listening (crash-looping) and a port can listen while the server is wedged, so one boolean is how "up" stops meaning anything (expiry: never, prev: wrong)
//
// EVERY FACT IS TRUE | FALSE | NULL, and null is never folded into false. A `launchctl print` that
// fails because launchctl is missing is not evidence the job is unloaded; an inventory that could
// not be read is not evidence nothing is listening. The house rule is that absence of evidence is
// its own state — and the mirror of it, which this repository learned later and more expensively,
// is that an undetermined must not be published as a finding either.
//
// ── L3: THE WATCHER'S OWN PULSE, AND WHAT IT CANNOT SEE ────────────────────────────────────────
// liveness writes a record every run. A gap in that journal means it did not run when it should
// have. Worth catching — and it catches a gap RETROSPECTIVELY, once liveness runs again.
//
// IT CANNOT DETECT ITS OWN PRESENT ABSENCE. A watcher that is not running reports nothing, including
// that it is not running. No amount of self-checking closes that, which is exactly why the off-box
// probe exists (commitwork-remote since 2026-09-17; formerly bin/probe-public.mjs via an Uptime
// workflow here) and why it was ranked above this.
// Stated here rather than left implicit, because a self-check that reads as complete is worse than
// no self-check: it retires the question.
//
// Everything is injected — no clock read inside the logic, no ambient fs, no network by default —
// so the tests run on fixtures and the same inputs always give the same answer.

import { execFileSync } from 'node:child_process';
import { expectationFor } from '../bin/probe-public.mjs';

export const SERVICE_FACTS = Object.freeze(['jobLoaded', 'portListening', 'httpAnswers']);
/** `unknown` outranks `ok`: a service we could not measure is never reported as healthy. */
export const SERVICE_STATES = Object.freeze(['ok', 'down', 'degraded', 'unknown', 'unsupervised']);

// ── fact 1: is the launchd job loaded ───────────────────────────────────────────────────────────
// `launchctl print` exits 0 for a loaded job and non-zero for an unknown one. Any OTHER failure —
// launchctl absent, a domain we cannot address — is null, because "the tool did not work" and "the
// job is not loaded" are different findings and only one of them is about the service.
export function jobLoaded(label, { run = defaultRun, uid = process.getuid?.() } = {}) {
  if (!label) return { value: null, how: 'no launchd label is declared for this service — supervision is UNDECLARED, not absent' };
  if (uid === undefined || uid === null) return { value: null, how: 'no uid available to address the launchd domain' };
  const r = run('launchctl', ['print', `gui/${uid}/${label}`]);
  if (r.ok) return { value: true, how: `launchctl print gui/${uid}/${label} succeeded` };
  // A job launchd does not know is reported as a specific failure; anything else is a tooling
  // problem and must not be published as "the job is unloaded".
  if (r.status === 113 || /could not find service|not find service/i.test(r.err || '')) {
    return { value: false, how: `launchd does not know ${label} — the job is NOT loaded, so nothing restarts this service` };
  }
  return { value: null, how: `launchctl could not answer (${(r.err || `exit ${r.status}`).slice(0, 90)}) — supervision is UNKNOWN, not absent` };
}

function defaultRun(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'pipe' }); return { ok: true, status: 0, err: '' }; }
  catch (e) {
    const err = [e.stderr, e.stdout].map((b) => (b ? String(b) : '')).join(' ').trim() || e.message || '';
    return { ok: false, status: typeof e.status === 'number' ? e.status : null, err };
  }
}

// ── fact 2: is the port listening ───────────────────────────────────────────────────────────────
// Reads the host inventory the panel already builds rather than shelling out again. A FAILED
// inventory yields null for every service: one unreadable observation must not become N assertions
// that nothing is listening.
export function portListening(port, { inv } = {}) {
  if (!Number.isInteger(port)) return { value: null, how: 'no port could be parsed from the declared service URL' };
  // `entries` is host-inventory's own field name — one row per (port, proto). Reading a field it
  // does not have made every service UNKNOWN: the failure was safe, which is why it took a live run
  // rather than a crash to notice, and safe-but-wrong is still wrong.
  const entries = inv && Array.isArray(inv.entries) ? inv.entries : null;
  if (!inv || inv.ok === false || !entries) {
    return { value: null, how: `the host inventory is unavailable${inv && inv.reason ? ` (${String(inv.reason).slice(0, 80)})` : ''} — listener state is UNKNOWN, not empty` };
  }
  const hit = entries.find((e) => Number(e.port) === port);
  return hit
    ? { value: true, how: `port ${port} is listening (${hit.binding || 'bound'})` }
    : { value: false, how: `the host inventory lists ${entries.length} listening port(s) and ${port} is NOT among them` };
}

// ── fact 3: does it answer ──────────────────────────────────────────────────────────────────────
// Loopback only. This asks whether the LOCAL process serves; whether the published hostname serves
// is a different question with a different failure set, and it belongs off-box.
export async function httpAnswers(url, { expect = null, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!url) return { value: null, status: null, how: 'no service URL is declared' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ac.signal });
    // ANY answer proves the process is serving. A 401 or a 404 is a served response; only the
    // absence of one means wedged. When `expect` is supplied the status is judged as well, but the
    // two conclusions stay separate — "it answered" and "it answered correctly" are not one fact.
    const answered = { value: true, status: res.status, how: `answered HTTP ${res.status}` };
    if (!expect || expect.includes(res.status)) return answered;
    return { ...answered, unexpected: true, how: `answered HTTP ${res.status}, expected ${expect.join(' or ')}` };
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || ac.signal.aborted);
    if (aborted) return { value: false, status: null, how: `no answer within ${timeoutMs}ms — bound but not serving` };
    const code = String((e && e.code) || (e && e.cause && e.cause.code) || '');
    // A TLS REJECTION IS NOT EVIDENCE THE SERVICE IS DOWN. clientD's origin is an mkcert certificate
    // the registry declares a caPool for; Node's fetch does not read that caPool, so the handshake
    // fails while the service is serving its public hostnames perfectly. Reporting that as `down`
    // would be a fabricated outage — the over-reporting direction of this repository's own rule,
    // and the one that trains a reader to ignore the lane. It is UNKNOWN: we could not ask.
    if (/^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS|CERT_)/.test(code) || /certificate|self.signed/i.test(String(e && e.message))) {
      return { value: null, status: null, how: `the TLS handshake failed (${code || 'certificate'}) — this origin presents a certificate this client does not trust, which says nothing about whether it is serving. UNKNOWN, not down` };
    }
    return { value: false, status: null, how: `could not connect (${(code || String(e && e.message || e)).slice(0, 80)})` };
  } finally { clearTimeout(timer); }
}

/** Port from a declared service URL, or null. */
export function portOf(serviceUrl) {
  const m = /^https?:\/\/[^/:]+:(\d+)/i.exec(String(serviceUrl || ''));
  if (m) return Number(m[1]);
  if (/^https:\/\//i.test(serviceUrl || '')) return 443;
  if (/^http:\/\//i.test(serviceUrl || '')) return 80;
  return null;
}

/**
 * One row per area that DECLARES a deployment. An area with a deploy block and no launchd label is
 * reported `unsupervised` rather than skipped: a service nothing supervises is the exact condition
 * that turned a restart into a five-hour outage, and skipping it would render that as silence.
 */
export async function serviceHealth({ reg, labelFor = defaultLabelFor, inv = null, run = defaultRun, fetchImpl = fetch, timeoutMs = 5000, uid = process.getuid?.() } = {}) {
  const rows = [];
  for (const a of (reg && reg.areas) || []) {
    const d = a.deploy;
    if (!d || !d.service) continue;
    const label = labelFor(a);
    const port = portOf(d.service);
    const job = jobLoaded(label, { run, uid });
    const listening = portListening(port, { inv });
    // ONE declaration of what requiresAuth means, shared with the off-box probe: a gate may deny
    // with 401 OR 403 and both satisfy it. Expecting 401 alone made overwatch-layer — which denies with
    // 403 — read as degraded while working.
    const http = await httpAnswers(d.service, { fetchImpl, timeoutMs, expect: d.requiresAuth === true ? expectationFor({ requiresAuth: true }).expect : null });

    const facts = { jobLoaded: job, portListening: listening, httpAnswers: http };
    rows.push({ area: a.slug, label, service: d.service, port, facts, state: stateFrom(facts), reasons: SERVICE_FACTS.map((f) => facts[f].how) });
  }
  const counts = Object.fromEntries(SERVICE_STATES.map((s) => [s, 0]));
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  // ok ONLY when every row is ok. A run with an unknown in it is not a clean run.
  return { ok: rows.length > 0 && rows.every((r) => r.state === 'ok'), rows, counts, checked: rows.length };
}

/**
 * The three facts collapse to one state for a reader who wants one — and the collapse is ordered so
 * that no failure hides behind a success. `down` before `unknown` before `ok`, because a service
 * that is provably not answering is worse news than one we could not measure.
 */
export function stateFrom(facts) {
  if (facts.httpAnswers.value === false) return 'down';
  if (facts.portListening.value === false) return 'down';
  if (facts.jobLoaded.value === false) return 'unsupervised';   // it may be serving RIGHT NOW and nothing will restart it
  if (SERVICE_FACTS.some((f) => facts[f].value === null)) return 'unknown';
  if (facts.httpAnswers.unexpected) return 'degraded';
  return 'ok';
}

/** The launchd label commitwork installs for an area's own service, by convention. */
export function defaultLabelFor(area) {
  return area && area.slug === 'commitwork-admin' ? 'com.portll.commitwork-panel' : null;
}

// ── L3: has the watcher itself been running? ────────────────────────────────────────────────────
/**
 * A GAP in liveness's own journal means it did not run when it should have.
 *
 * ROTATION-AWARE ON PURPOSE. `readJournal(gate)` walks the rotation chain; `readJournalFile(path)`
 * reads one file. Right after a rotation the live file can be empty or newly started, so the
 * file-only reader would report "never" or a huge gap for a watcher that ran a minute ago — a false
 * alarm manufactured by the reader. The two sit in the same import and the wrong one is the shorter
 * word; this repository has a documented trap for exactly that, and it is why the reader is injected
 * and named rather than reached for.
 *
 * States: fresh | gap | never | unreadable. `never` is NOT `gap` — a journal that has never been
 * written is an unwired check, and reporting it as a missed run sends someone looking for a crash
 * that did not happen.
 */
export function watcherPulse({ readJournalImpl, gate = 'liveness', expectedIntervalMs = 3600_000, graceFactor = 2.5, nowMs = Date.now() } = {}) {
  let j;
  try { j = readJournalImpl(gate); }
  catch (e) { return { state: 'unreadable', gapMs: null, lastAt: null, how: `the ${gate} journal could not be read (${String(e && e.message || e).slice(0, 90)}) — whether it has been running is UNKNOWN, not fine` }; }

  const records = (j && (j.records || j.entries)) || [];
  const times = records.map((r) => Date.parse(r && (r.at || r.ts))).filter(Number.isFinite);
  if (!times.length) {
    return { state: 'never', gapMs: null, lastAt: null, how: `the ${gate} journal holds no dated record — this check has never run, which is not the same as having missed a run` };
  }
  const lastMs = Math.max(...times);
  const gapMs = nowMs - lastMs;
  const allowed = expectedIntervalMs * graceFactor;
  return gapMs > allowed
    ? {
      state: 'gap', gapMs, lastAt: new Date(lastMs).toISOString(),
      how: `${gate} last recorded ${Math.round(gapMs / 60000)} min ago against a ${Math.round(expectedIntervalMs / 60000)} min cadence — it stopped running and started again. NOTE: this can only ever be found retrospectively; a watcher that is not running cannot report that it is not running, which is what the off-box probe is for`,
    }
    : { state: 'fresh', gapMs, lastAt: new Date(lastMs).toISOString(), how: `${gate} recorded ${Math.round(gapMs / 60000)} min ago` };
}
