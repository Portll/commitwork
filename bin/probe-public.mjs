#!/usr/bin/env node
// bin/probe-public.mjs — the OFF-BOX probe. Ask the published hostnames, from outside, whether they
// are answering the way the registry says they should.
//
// WHY IT EXISTS, AND WHY IT MUST NOT RUN HERE. On 2026-08-22 commitwork.online served HTTP 502 for
// five and a half hours while monitor/liveness.mjs reported `gate liveness: ok` throughout — it
// checks sweep FRESHNESS and has no notion of service availability. Every other layer proposed to
// fix that runs as a launchd job ON THE MACHINE IT WATCHES: the same failure that unloaded the panel
// can unload them, and a watcher cannot report its own absence. This is the only layer that does not
// share a failure mode with its subject, which is why it is worth more than its size suggests.
//
// So this file is deliberately portable and dependency-free: Node >= 18 for global fetch, no imports
// beyond node: builtins, no repo state required when targets are passed in. It can run in GitHub
// Actions, in a Cloudflare Worker, or from cron on any other machine. Running it ON the box is the one
// deployment that defeats the point. The scheduled off-box probe itself moved to commitwork-remote on
// 2026-09-17 (probes.json `available-and-protected` for commitwork.online, every 15 minutes from a
// machine that is not the panel's host, attested every 6 hours on Actions); the Uptime workflow that ran
// this file every 15 minutes on Actions was removed.
//
// ── 200 IS AN ALARM ────────────────────────────────────────────────────────────────────────────
// The naive uptime check asks "did it answer 2xx". For commitwork.online that is backwards. The
// registry declares `requiresAuth: true`, so the healthy answer from outside is 401: the panel is up
// AND the gate is in front of it. A 200 there means the published panel is serving without a
// session — a worse incident than a 502, and one every generic monitor would render green.
//
// The expectation is therefore DERIVED from `deploy.requiresAuth` in monitor/projects.json rather
// than listed here. A hand-written list of expected codes is a second declaration of a fact the
// registry already owns, and this repository's most-repeated defect is exactly that.
//
// ── WHAT IT CANNOT TELL YOU, SAID OUT LOUD ─────────────────────────────────────────────────────
// From outside, a 502 cannot distinguish "the origin is down" from "the tunnel is down" — both look
// identical to a client. The probe reports what it observed and does not guess which; naming a cause
// it cannot see is how an alarm sends someone to the wrong machine at 3am.
//
// NEVER LOGS BODIES OR HEADERS. It records status, timing and a state. A response body from an
// authenticated surface can carry anything, and this output is designed to land in a public CI log.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registryPathFor } from '../monitor/store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every state this probe can report. `ok` is the only one that is not a finding. */
export const PROBE_STATES = Object.freeze(['ok', 'unexpected-status', 'unreachable', 'timeout', 'skipped']);

/**
 * What a healthy answer looks like for a declared hostname.
 * requiresAuth:true  -> 401 is health. 200 means the gate is GONE and is reported as its own alarm.
 * requiresAuth:false -> any 2xx, plus the redirects a public site legitimately serves.
 */
export function expectationFor({ requiresAuth }) {
  // A GATE MAY DENY EITHER WAY. The first cut expected 401 alone and turned every 403-gating
  // service permanently red — overwatch-layer answers 403 from its own origin, which is a correct denial,
  // and a probe that calls a working gate an incident trains the reader to ignore it. That is the
  // same defect as a hang threshold shorter than a healthy run, one layer up.
  //
  // What must stay an alarm is a 2xx: `requiresAuth: true` asserts the surface denies anonymous
  // requests, so a 200 means it is not denying them. 401 and 403 both satisfy the assertion; 200
  // contradicts it.
  return requiresAuth
    ? { expect: [401, 403], note: 'requiresAuth:true — a denial (401 or 403) is health; a 2xx means the gate is not in front of it' }
    : { expect: [200, 204, 301, 302, 303, 307, 308], note: 'requiresAuth:false — any 2xx or redirect' };
}

/** Targets from the registry's own deploy declarations. Public hostnames only. */
export function targetsFromRegistry(registryPath = registryPathFor(join(HERE, '..'))) {
  const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
  const out = [];
  for (const a of reg.areas || []) {
    const d = a.deploy;
    if (!d || d.public !== true) continue;
    const { expect, note } = expectationFor({ requiresAuth: d.requiresAuth === true });
    // A PUBLIC FRONT PAGE IS NOT AN ABSENT GATE. overwatch.example serves `/` anonymously by
    // design and gates `/app`; probing `/` there reports the gate as missing when it is working.
    // The path is DECLARED beside the posture it qualifies rather than special-cased here.
    const path = typeof d.probePath === 'string' && d.probePath.startsWith('/') ? d.probePath : '/';
    for (const h of d.hostnames || []) out.push({ area: a.slug, hostname: h, path, expect, note });
  }
  return out.sort((x, y) => x.hostname.localeCompare(y.hostname));
}

/**
 * Why an observed status is not the declared one. Each branch says only what THAT status supports:
 * the tunnel-vs-origin ambiguity is real for a 5xx and meaningless for a 403, and a detail line that
 * volunteers it anyway sends the reader to check two machines over an answer the edge gave on its
 * own. The first draft of this attached the 5xx sentence to every mismatch, and the first live run
 * printed it under a 403 — caught by running it, not by reading it back.
 */
export function explain(status, expect) {
  const head = `answered ${status}; expected ${expect.join(' or ')}`;
  if (expect.includes(401) && status >= 200 && status < 300) {
    return `answered ${status} where 401 was expected — the published surface is serving WITHOUT its session gate. This is a WORSE incident than an outage and every generic uptime monitor renders it green`;
  }
  if (status >= 500) {
    return `${head}. From outside, a 5xx cannot distinguish the origin being down from the tunnel being down — check both, and do not assume which`;
  }
  if (status === 403 || status === 404) {
    return `${head}. The edge answered, so this is a ROUTING or POLICY answer rather than an outage: the hostname resolves and something served it. Check the ingress rule and the declaration before looking at the origin`;
  }
  return head;
}

/**
 * Probe one hostname. Returns a row; never throws.
 * `fetchImpl` and `nowMs` are injectable so tests need no network and no clock.
 */
export async function probeOne(target, { fetchImpl = fetch, timeoutMs = 15000, nowMs = () => Date.now() } = {}) {
  const url = `https://${target.hostname}${target.path || '/'}`;
  const started = nowMs();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    // `redirect: 'manual'` so a 301 is OBSERVED rather than followed — following it would report the
    // status of some other hostname under this one's name, which is the attribution error this whole
    // programme exists to remove.
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ac.signal, headers: { 'user-agent': 'commitwork-probe' } });
    const ms = nowMs() - started;
    const status = res.status;
    const ok = target.expect.includes(status);
    return {
      ...target, url, status, ms, ok,
      state: ok ? 'ok' : 'unexpected-status',
      // The one case worth naming precisely, because a generic monitor calls it healthy.
      detail: ok ? null : explain(status, target.expect),
    };
  } catch (e) {
    const ms = nowMs() - started;
    const aborted = e && (e.name === 'AbortError' || ac.signal.aborted);
    return {
      ...target, url, status: null, ms, ok: false,
      state: aborted ? 'timeout' : 'unreachable',
      detail: aborted
        ? `no answer within ${timeoutMs}ms`
        // The message, not the object: a fetch error can carry a cause chain, and this output is
        // designed to be safe to paste into a public CI log.
        : `could not connect (${String((e && e.code) || (e && e.message) || e).slice(0, 120)})`,
    };
  } finally { clearTimeout(timer); }
}

export async function probeAll(targets, opts = {}) {
  const rows = [];
  // Sequential on purpose: a handful of hostnames, and a burst of parallel requests from a CI
  // runner is the shape that gets an IP rate-limited by the very edge being probed.
  for (const t of targets) rows.push(await probeOne(t, opts));
  const counts = Object.fromEntries(PROBE_STATES.map((s) => [s, 0]));
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  return { rows, counts, ok: rows.every((r) => r.ok) };
}

export function formatReport({ rows, counts, ok }) {
  const lines = [];
  for (const r of rows) {
    const mark = r.ok ? 'ok  ' : 'FAIL';
    lines.push(`${mark} ${r.hostname.padEnd(28)} ${String(r.status ?? r.state).padEnd(6)} ${String(r.ms).padStart(5)}ms  [${r.area}]`);
    if (!r.ok) lines.push(`       ${r.detail}`);
  }
  lines.push('');
  lines.push(ok
    ? `all ${rows.length} published hostname(s) answered as declared`
    : `${rows.filter((r) => !r.ok).length} of ${rows.length} published hostname(s) did NOT answer as declared`);
  lines.push(PROBE_STATES.filter((s) => counts[s]).map((s) => `${s}=${counts[s]}`).join(' · '));
  return lines.join('\n');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes('--json');
  // Explicit hostnames win, for probing a single target without the registry. They carry no
  // requiresAuth declaration, so their expectation must be stated rather than assumed: --expect.
  const hostArgs = args.filter((a) => !a.startsWith('--'));
  const expectArg = (args.find((a) => a.startsWith('--expect=')) || '').split('=')[1];
  const timeoutMs = Number((args.find((a) => a.startsWith('--timeout=')) || '').split('=')[1]) || 15000;

  let targets;
  if (hostArgs.length) {
    if (!expectArg) {
      console.error('probe-public: --expect=<codes> is required with explicit hostnames.\n'
        + 'Without the registry there is no declaration to derive health from, and GUESSING that 200 is\n'
        + 'healthy is exactly the error this probe exists to avoid: on an auth-gated surface 200 means\n'
        + 'the gate is gone.  e.g.  --expect=401');
      process.exit(2);
    }
    const expect = expectArg.split(',').map((n) => Number(n.trim())).filter(Number.isFinite);
    targets = hostArgs.map((h) => ({ area: '(explicit)', hostname: h, expect, note: `--expect=${expect.join(',')}` }));
  } else {
    targets = targetsFromRegistry();
  }

  if (!targets.length) {
    console.error('probe-public: no public hostnames are declared — nothing to probe. That is a registry\n'
      + 'state, not a pass: exiting 2 so an empty run is never mistaken for a clean one.');
    process.exit(2);
  }

  const result = await probeAll(targets, { timeoutMs });
  console.log(jsonOut ? JSON.stringify(result, null, 2) : formatReport(result));
  process.exit(result.ok ? 0 : 1);
}
