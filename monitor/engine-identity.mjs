// monitor/engine-identity.mjs — item 4: the engines commitwork CONSUMES (local LLM hosts via
// manifests/llm-hosts.json, overwatch-layer's SPINE) feed the reducer verdicts and the panel state. A
// spoofed engine on a known port would be believed. This lens pins each consumed endpoint's
// IDENTITY so a swap is a diff.
//
// Identity is two witnesses that cannot share a failure mode, per the manifest's own detection
// principle (a probe proves AN OpenAI server is listening, never WHICH one):
//   owner        the socket-holding pid's command line (port-bind's enumeration) — expected to
//                name the declared engine. The strong witness, and only claimable for hosts the
//                manifest marks portIsShared=false; the 8080 group is 'unidentifiable-by-design'
//                and this lens says so rather than asserting what it did not measure.
//   fingerprint  the implementation's shape, NOT its content: response status + sorted header
//                NAMES + error-body FIELD NAMES for a deliberate 404 probe. Stable across model
//                loads (a model list changes every time the operator loads one — churn is not
//                identity); different across implementations. Model count rides along as info.
//
// Baseline in .claude/store/, moved only by --accept. owner-changed and fingerprint-changed are
// the findings (the spoof signals); absent is an engine that is off (its own state); unbaselined
// is grey. Loopback GETs only; nothing is sent but the probe path.
//
// Env (read at call time): CW_ENGID_BASELINE, CW_BIND_LISTENERS (shared listener fixture), CW_NOW.
//
//   node monitor/engine-identity.mjs [--json]   diff vs baseline; exit 0 ok, 1 findings, 2 grey
//   node monitor/engine-identity.mjs --accept   pin the currently observed identities

import { nowISO } from '../lib/clock.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { loadLlmHosts, hostsInProbeOrder } from './llm-hosts.mjs';
import { collectListeners } from './port-bind.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_ENGID_BASELINE || join(REPO, '.claude', 'store', 'engine-identity-baseline.json');

// Consumed endpoints beyond the LLM manifest. The bind itself is declared in bind-declarations;
// this row declares the identity probe for it.
export const EXTRA_ENDPOINTS = [
  { id: 'overwatch', baseUrl: 'http://127.0.0.1:7980', ownerMatch: 'overwatch', portIsShared: false },
];

/** The endpoints this lens pins: manifest hosts + extras. Pure over the loaded declaration. */
export function endpointsFor(decl = loadLlmHosts()) {
  const hosts = hostsInProbeOrder(decl).map((h) => ({
    id: h.id,
    baseUrl: h.baseUrl,
    // The engine's own name is the expected socket owner; only claimable on an unshared port.
    ownerMatch: h.id === 'lmstudio' ? 'LM Studio' : h.id,
    portIsShared: h.portIsShared === true,
  }));
  return [...hosts, ...EXTRA_ENDPOINTS];
}

const portOf = (baseUrl) => Number(new URL(baseUrl).port) || (new URL(baseUrl).protocol === 'https:' ? 443 : 80);

/** Implementation fingerprint from a response: status class + sorted header names + body field
 *  names. Content never participates — model churn is not identity. */
export function fingerprintResponse(status, headerNames, bodyText) {
  let fields = 'non-json';
  try {
    const parsed = JSON.parse(bodyText);
    fields = parsed && typeof parsed === 'object' ? Object.keys(parsed).sort() : 'non-object';
  } catch { /* non-JSON stays 'non-json' */ }
  const names = [...headerNames].map((h) => String(h).toLowerCase()).filter((h) => h !== 'date' && h !== 'content-length').sort();
  return createHash('sha256').update(JSON.stringify([status, names, fields])).digest('hex').slice(0, 32);
}

async function probeOnce(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  const headerNames = [];
  res.headers.forEach((_v, k) => headerNames.push(k));
  const body = await res.text();
  return { status: res.status, headerNames, body };
}

/** Probe one endpoint: models info + a deliberate 404 for the implementation shape. */
export async function probeEndpoint(baseUrl, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  let models;
  try { models = await probeOnce(`${baseUrl}/v1/models`, fetchImpl, timeoutMs); }
  catch (e) {
    const code = e?.cause?.code || e?.code || e?.name;
    if (code === 'ECONNREFUSED') return { absent: true };
    return { ...unknown('tool-failed', `probe: ${code || e}`) };
  }
  let modelCount = null;
  try {
    const parsed = JSON.parse(models.body);
    if (Array.isArray(parsed?.data)) modelCount = parsed.data.length;
    else if (Array.isArray(parsed?.models)) modelCount = parsed.models.length;
  } catch { /* count stays null — info, never identity */ }
  let notFound = null;
  try { notFound = await probeOnce(`${baseUrl}/cw-identity-probe-404`, fetchImpl, timeoutMs); }
  catch { notFound = null; }
  const fingerprint = createHash('sha256').update(JSON.stringify([
    fingerprintResponse(models.status, models.headerNames, models.body),
    notFound ? fingerprintResponse(notFound.status, notFound.headerNames, notFound.body) : 'no-404-probe',
  ])).digest('hex').slice(0, 32);
  return { fingerprint, modelCount };
}

/** Pure assessment: observed (owner+probe per endpoint) vs baseline. */
export function assessIdentities(observed, baseline) {
  const base = baseline?.endpoints || null;
  const rows = [];
  for (const o of [...observed].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const b = base ? base[o.id] : undefined;
    if (o.absent) { rows.push({ id: o.id, state: b ? 'absent' : 'absent', pinned: !!b }); continue; }
    if (o.unknown) { rows.push({ id: o.id, state: 'unknown', unknownReason: o.unknownReason, unknownDetail: o.unknownDetail }); continue; }
    const row = { id: o.id, owner: o.owner, ownerOk: o.ownerOk, fingerprint: o.fingerprint, modelCount: o.modelCount, portIsShared: o.portIsShared };
    if (o.ownerOk === false) { rows.push({ ...row, state: 'owner-changed' }); continue; }
    if (!b) { rows.push({ ...row, state: 'unbaselined' }); continue; }
    if (b.fingerprint !== o.fingerprint) { rows.push({ ...row, state: 'fingerprint-changed', baseline: b }); continue; }
    rows.push({ ...row, state: 'ok' });
  }
  const findings = rows.filter((r) => ['owner-changed', 'fingerprint-changed'].includes(r.state));
  const grey = rows.some((r) => ['unbaselined', 'unknown'].includes(r.state));
  const state = findings.length ? 'findings' : !baseline ? 'no-baseline' : grey ? 'partial' : 'ok';
  return { rows, findings, state };
}

export async function observeEndpoints({ decl, platform, exec, fetchImpl } = {}) {
  const endpoints = endpointsFor(decl);
  let listeners = null;
  try { listeners = collectListeners({ platform, exec }).listeners; }
  catch { listeners = null; }   // owner axis degrades to undecided; the probe axis still runs
  const out = [];
  for (const ep of endpoints) {
    const probe = await probeEndpoint(ep.baseUrl, { fetchImpl });
    if (probe.absent) { out.push({ id: ep.id, absent: true }); continue; }
    if (probe.unknown) { out.push({ id: ep.id, ...probe }); continue; }
    let owner = null;
    let ownerOk = null;
    if (!ep.portIsShared && listeners) {
      const on = listeners.filter((l) => l.port === portOf(ep.baseUrl));
      const texts = on.map((l) => `${l.command ?? ''} ${l.args ?? ''}`);
      if (on.length) {
        owner = [...new Set(on.map((l) => l.args || l.command).filter(Boolean))].sort();
        ownerOk = texts.some((t) => t.includes(ep.ownerMatch));
      }
    }
    out.push({ id: ep.id, owner, ownerOk, portIsShared: ep.portIsShared, ...probe });
  }
  return out;
}

/** ENOENT is "no baseline yet"; anything else THROWS. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);
  if (!b || typeof b.endpoints !== 'object') throw new Error('baseline has no endpoints{}');
  return b;
}

export async function runLens(opts = {}) {
  const baseline = readBaseline();
  const observed = await observeEndpoints(opts);
  return { at: nowISO(), baselineAt: baseline?.at ?? null, ...assessIdentities(observed, baseline) };
}

export async function acceptBaseline(opts = {}) {
  const observed = await observeEndpoints(opts);
  const endpoints = {};
  for (const o of observed) {
    if (!o.absent && !o.unknown && o.fingerprint) endpoints[o.id] = { fingerprint: o.fingerprint, owner: o.owner ?? null };
  }
  const doc = { at: nowISO(), endpoints };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), pinned: Object.keys(endpoints).sort(), skipped: observed.filter((o) => o.absent || o.unknown).map((o) => o.id).sort() };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/engine-identity.mjs [--json]   pin consumed engines (LLM hosts + overwatch-layer) by socket owner + implementation fingerprint\n'
      + 'node monitor/engine-identity.mjs --accept   pin the currently observed identities (the human act)\n'
      + 'exit 0 ok, 1 findings (owner/fingerprint changed — the spoof signals), 2 grey');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = await acceptBaseline();
    console.log(`pinned ${a.pinned.length} endpoint(s) → ${a.path}${a.pinned.length ? `  (${a.pinned.join(', ')})` : ''}`);
    if (a.skipped.length) console.log(`not pinned (absent/unknown): ${a.skipped.join(', ')}`);
    process.exit(0);
  }
  const r = await runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`engine-identity: ${r.state}  (baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    for (const row of r.rows) {
      const bits = [];
      if (row.ownerOk === true) bits.push('owner ok');
      if (row.ownerOk === false) bits.push('OWNER MISMATCH');
      if (row.ownerOk === null && row.portIsShared) bits.push('unidentifiable-by-design (shared port)');
      if (row.modelCount != null) bits.push(`${row.modelCount} model(s)`);
      console.log(`  ${row.state.toUpperCase().padEnd(20)} ${row.id}${bits.length ? `  — ${bits.join(', ')}` : ''}`);
    }
  }
  process.exit(r.findings?.length ? 1 : r.state === 'ok' ? 0 : 2);
}
