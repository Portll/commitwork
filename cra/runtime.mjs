#!/usr/bin/env node
// cra/runtime.mjs — run the runtime scanner tier (DAST / BOLA / TLS) against live service
// endpoints and fold the evidence into the current slice, so the runtime-target controls
// (access enforcement AC-3/CC6.3, transport encryption SC-8/SC-13/CC6.7) become EVIDENCED.
//
// Why this is separate from the sweep: monitor/sweep.mjs already passes a per-service URL to
// the runner, but a runtime scanner (testssl, nuclei, authz-bola) only produces run evidence
// when the service is actually reachable AT scan time — so on a nightly sweep with services
// down they skip. This runs the runtime group on demand against the URLs in
// monitor/projects.json (or a --only/--url override), writing each service's runtime
// checks-status into the latest sweep's report dir (the runner MERGES by check id, so it
// augments rather than clobbers). Then `node cra/dashboard.mjs` / `cra/controls.mjs coverage`
// reflect the newly-evidenced controls.
//
//   node cra/runtime.mjs                          # every service with a URL in projects.json
//   node cra/runtime.mjs --only svc-api-gateway --url https://gw.internal:8443
//   node cra/runtime.mjs --urls targets.json      # {"svc":"https://…"} map
//   node cra/runtime.mjs --dry-run                # print what would run
//
// The services must be reachable from where this runs. Zero deps.

import { isMainModule } from '../lib/is-main.mjs';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolvePaths, latestSweepDir, loadJSON, craRoot } from './lib.mjs';

const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s), cyan = (s) => c('36', s);
const die = (m) => { console.error(red(`cra runtime: ${m}`)); process.exit(2); };

// Pure + tested: which services get scanned at which URL. A service is a runtime target only
// if it resolves a non-empty URL. Resolution: --urls map › project.urls[child] › project.url
// › registry.urls[name]. Children are derived from the union of url-map keys (a child with no
// URL can't be a runtime target anyway), so no filesystem walk is needed.
export function resolveTargets(reg, opts = {}) {
  const cliUrls = opts.urls || {};
  const out = [];
  const add = (name, path, url, manifest) => { if (url) out.push({ name, path, url, manifest }); };
  for (const p of reg.projects || []) {
    if (p.expand === 'children') {
      const names = new Set([...Object.keys(p.urls || {}), ...Object.keys(cliUrls), ...Object.keys(reg.urls || {})]);
      for (const d of names) {
        if (opts.only && d !== opts.only) continue;
        add(d, p.path ? join(p.path, d) : d, cliUrls[d] || (p.urls && p.urls[d]) || p.url || (reg.urls && reg.urls[d]) || '', p.manifest);
      }
    } else {
      if (opts.only && p.name !== opts.only) continue;
      add(p.name, p.path, cliUrls[p.name] || p.url || (reg.urls && reg.urls[p.name]) || '', p.manifest);
    }
  }
  const seen = new Set();
  return out.filter((t) => (seen.has(t.name) ? false : seen.add(t.name)));
}

// Scanned services (from the latest slice) that resolve NO runtime URL — the coverage gap:
// their runtime checks (DAST/BOLA/TLS → AC-3/CC6.x/SC-8/SC-13) can never be evidenced until a
// URL is added to monitor/projects.json. Surfaced so "which services still need wiring" is
// visible, not silent. (Some — frontends, plugins, static docs — legitimately have no HTTP
// target; the operator decides.)
export function unconfiguredServices(scannedNames, targets) {
  const configured = new Set((targets || []).map((t) => t.name));
  return (scannedNames || []).filter((n) => !configured.has(n));
}

// The runtime checks in the latest checks-status.json for a repo (post-run report).
function runtimeStatus(reportDir) {
  const f = join(reportDir, 'checks-status.json');
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
      .filter((s) => /^(dast-|tls-|api-fuzz|authz-)/.test(s.check || ''))
      .map((s) => `${s.check}:${s.status}`);
  } catch { return []; }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dryRun = argv.includes('--dry-run');
  const only = flag('--only');
  const manifest = flag('--manifest') || 'security-baseline'; // where the `runtime` group lives
  const group = flag('--group') || 'runtime';

  let cliUrls = {};
  if (flag('--urls')) { try { cliUrls = JSON.parse(readFileSync(flag('--urls'), 'utf8')); } catch (e) { die(`--urls not readable: ${e.message}`); } }
  if (flag('--url')) { if (!only) die('--url needs --only <service> (a single URL cannot target every service)'); cliUrls[only] = flag('--url'); }

  const paths = resolvePaths();
  const sweepDir = flag('--out') || latestSweepDir(paths.reportsRoot);
  if (!sweepDir) die('no sweep batch under reports/ — run `node monitor/sweep.mjs` first, or pass --out <dir>');

  const targets = resolveTargets(paths.projects, { only, urls: cliUrls });
  if (!targets.length) die(only ? `no URL for '${only}' — add it to monitor/projects.json urls or pass --url` : 'no service has a URL configured (monitor/projects.json urls map is empty) — pass --only <svc> --url <base>');

  console.log(bold(`cra runtime`) + dim(`  ${targets.length} target(s) · group=${group} · slice=${sweepDir.split('/').pop()}`));

  // Coverage-gap hint: scanned services with no runtime URL (their runtime controls stay grey).
  if (!only) {
    const scanned = (loadJSON(paths.rollup, { repos: [] }).repos || []).map((r) => r.name);
    const gaps = unconfiguredServices(scanned, targets);
    if (gaps.length) console.log(yel(`  ${gaps.length} scanned service(s) have NO runtime URL (runtime controls stay grey until wired): ${gaps.join(', ')}`));
  }

  if (dryRun) { for (const t of targets) console.log(dim(`  would scan ${t.name} → ${t.url}`)); process.exit(0); }

  const bin = join(craRoot(), 'bin', 'commitwork.mjs');
  let ran = 0, skipped = 0;
  for (const t of targets) {
    if (!existsSync(t.path)) { console.log(yel(`  ⊘ ${t.name}: path missing (${t.path})`)); skipped++; continue; }
    const reportDir = join(sweepDir, t.name);
    mkdirSync(reportDir, { recursive: true });
    process.stdout.write(`  ${cyan('▸')} ${bold(t.name)} ${dim(`→ ${t.url}`)} `);
    try {
      execFileSync('node', [bin, 'run', group, '--manifest', manifest, '--repo', t.path, '--url', t.url, '--no-fail-fast'],
        { stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, CW_REPORT_DIR: reportDir, CW_TARGET_URL: t.url } });
    } catch { /* runner exits non-zero on findings — the checks-status.json is what we want */ }
    const st = runtimeStatus(reportDir);
    console.log(st.length ? grn(st.join(' ')) : dim('(no runtime checks recorded)'));
    ran++;
  }
  console.log(bold('── done ──') + dim(`  ${ran} scanned, ${skipped} skipped`));
  console.log(dim('  refresh evidence:  node cra/dashboard.mjs  ·  node cra/controls.mjs coverage'));
}
