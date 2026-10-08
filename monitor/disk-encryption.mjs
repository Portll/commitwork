// monitor/disk-encryption.mjs — the full-disk-encryption baseline lens. Is the confidentiality
// floor this fleet declares actually in force on this box, and can we tell?
//
// WHY A LENS AND NOT A DOCUMENT. Item 17 of EXECUTION-PLAN-detection-and-selfsec-2026-08-27 asks
// for FDE "as the confidentiality baseline (beats per-log app encryption on key-management cost)"
// and says, correctly, DECLARATION ONLY — applying stays a human act. That constrains what this
// may DO, not what it may KNOW. A baseline nobody measures is the same shape as every other
// declaration this platform exists to check against reality: `deploy --verify` does not open
// tunnels, it reads them. So this reads, joins, and reports; it never enables anything.
//
// It also settles a question the rest of the codebase keeps implicitly: commitwork writes findings,
// sweep logs, scanner artifacts and a credential ref table to local disk, and several modules
// reason about whether a value is "at rest safely". That reasoning has no floor unless the volume
// underneath is encrypted. This is that floor, stated and measured.
//
// TWO SOURCES, AND THE JOIN IS THE POINT:
//   declared   monitor/disk-encryption.json — which volumes this fleet REQUIRES encrypted, and why.
//   observed   a per-OS, READ-ONLY status probe:
//                darwin  `fdesetup status`      (FileVault)
//                linux   `lsblk -o NAME,TYPE`   (LUKS appears as a `crypt` device-mapper type)
//                win32   `manage-bde -status`   (BitLocker)
//
// THE OUTCOMES, and which one is the finding:
//   protected     required and observed encrypted. The good state.
//   UNPROTECTED   required and observed NOT encrypted — THE finding. Exit 1.
//   undeclared    observed encrypted (or not) on a volume no baseline row mentions — grey, because
//                 nobody said whether it matters. An unlisted volume is not a passing volume.
//   unknown       we could not tell. explicit uncertainty. See below.
//
// explicit uncertainty AND IT IS NOT RED EITHER. An unsupported platform, a probe binary that is not
// installed, a probe that exits non-zero, or output we cannot parse ALL yield unknown() with a
// declared reason — never "encrypted" (which would launder an unmeasured box into compliance) and
// never "unencrypted" (which would manufacture a finding about a box we did not measure). This
// distinction is the whole reason the lens is worth having: on a fleet of mixed OSes, the honest
// answer for most boxes on most days is "not measured here", and that must be visible.
//
// PRIVILEGE: every probe is a status read. `fdesetup status` and `lsblk` need no elevation;
// `manage-bde -status` may. When a probe is refused for permissions the state is
// unknown('not-permitted') — the credential withheld the evidence, which is a different fact from
// the volume being unencrypted, and only one of them is actionable by rotating a policy.
//
// Env, read at CALL time (never at module load — a const at import silently defeats a test that
// sets it afterwards):
//   CW_FDE_BASELINE   path to the declaration file (default monitor/disk-encryption.json)
//   CW_FDE_PROBE      fixture probe output, so the suite runs with no disk and no privileges
//   CW_FDE_PLATFORM   override process.platform, to exercise every adapter on one machine
//
//   node monitor/disk-encryption.mjs [--json]
//   exit 0 baseline met · 1 a required volume is unencrypted · 2 grey (unmeasured or undeclared)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown, isUnknown } from './unknown.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, '..', 'schema', 'disk-encryption.schema.json');

const baselinePath = () => resolve(process.env.CW_FDE_BASELINE || join(HERE, 'disk-encryption.json'));
const platform = () => process.env.CW_FDE_PLATFORM || process.platform;

/** The declaration. A missing file is unknown('no-reference') — compared against nothing. */
export function loadBaseline() {
  const p = baselinePath();
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) {
    // ENOENT is the only reading of "no baseline"; anything else is a file we could not read, and
    // the two must not share an answer.
    return e.code === 'ENOENT'
      ? unknown('no-reference', `no FDE baseline at ${p} — nothing declares what this fleet requires`)
      : unknown('not-permitted', `cannot read ${p}: ${e.code || e.message}`);
  }
  try {
    const j = JSON.parse(raw);
    const { errors } = validateAgainstSchema(j, { path: SCHEMA });
    if (errors.length) return unknown('unparseable', `baseline violates ${SCHEMA}: ${errors.join('; ')}`);
    return j;
  } catch (e) { return unknown('unparseable', `baseline did not parse: ${e.message}`); }
}

// ── the per-OS adapters. Each returns { volumes: [{ id, encrypted:boolean }] } or an unknown(). ──
// Each parses the narrowest thing that answers the question, and says so when it cannot.

function probeRaw(cmd, args) {
  if (process.env.CW_FDE_PROBE !== undefined) return process.env.CW_FDE_PROBE;
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) {
    if (e.code === 'ENOENT') return unknown('not-run', `${cmd} is not installed on this box`);
    if (/denied|permission|elevat/i.test(String(e.stderr || e.message))) return unknown('not-permitted', `${cmd} refused: elevation required`);
    return unknown('tool-failed', `${cmd} exited ${e.status ?? '?'}: ${String(e.stderr || e.message).trim().slice(0, 160)}`);
  }
}

function darwin() {
  const out = probeRaw('fdesetup', ['status']);
  if (isUnknown(out)) return out;
  // `FileVault is On.` / `FileVault is Off.` — and an in-progress conversion is NOT yet protection.
  if (/FileVault is On\./i.test(out)) return { volumes: [{ id: 'root', encrypted: true, detail: 'FileVault On' }] };
  if (/Deferred|in progress|Encryption in progress/i.test(out)) {
    return { volumes: [{ id: 'root', encrypted: false, detail: 'FileVault conversion in progress — not yet protection' }] };
  }
  if (/FileVault is Off\./i.test(out)) return { volumes: [{ id: 'root', encrypted: false, detail: 'FileVault Off' }] };
  return unknown('unstated', `fdesetup answered and did not state a status: ${out.trim().slice(0, 120)}`);
}

function linux() {
  const out = probeRaw('lsblk', ['-o', 'NAME,TYPE', '-n']);
  if (isUnknown(out)) return out;
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return unknown('empty', 'lsblk listed no block devices');
  // A LUKS-backed volume surfaces as a device-mapper node of TYPE `crypt`. Its ABSENCE across every
  // row is the honest reading of "no encrypted volume", not of "we did not look".
  const hasCrypt = lines.some((l) => /\bcrypt$/.test(l));
  return { volumes: [{ id: 'root', encrypted: hasCrypt, detail: hasCrypt ? 'dm-crypt/LUKS mapping present' : 'no crypt-type device-mapper node' }] };
}

function win32() {
  const out = probeRaw('manage-bde', ['-status']);
  if (isUnknown(out)) return out;
  if (/Percentage Encrypted:\s*100(\.0)?%/i.test(out)) return { volumes: [{ id: 'system', encrypted: true, detail: 'BitLocker 100%' }] };
  if (/Percentage Encrypted:/i.test(out)) return { volumes: [{ id: 'system', encrypted: false, detail: 'BitLocker present but not fully encrypted' }] };
  return unknown('unstated', 'manage-bde answered without a Percentage Encrypted line');
}

/** Observe this box. An OS with no adapter is unknown('not-run') — never a pass by omission. */
export function observe() {
  const p = platform();
  if (p === 'darwin') return darwin();
  if (p === 'linux') return linux();
  if (p === 'win32') return win32();
  return unknown('not-run', `no FDE adapter for platform '${p}' — this box is unmeasured, which is not the same as compliant`);
}

/** The join: declared × observed. */
export function runLens({ at = process.env.CW_NOW || new Date().toISOString() } = {}) {
  const baseline = loadBaseline();
  if (isUnknown(baseline)) return { at, unknown: true, unknownReason: baseline.unknownReason, unknownDetail: baseline.unknownDetail, rows: [], findings: [] };

  const obs = observe();
  if (isUnknown(obs)) {
    // The declaration still reports — a reader learns what IS required even on a box we cannot
    // measure. That half is not grey; only the observation is.
    return {
      at, unknown: true, unknownReason: obs.unknownReason, unknownDetail: obs.unknownDetail,
      platform: platform(),
      rows: baseline.required.map((r) => ({ ...r, state: 'unknown', detail: obs.unknownDetail })),
      findings: [],
    };
  }

  const byId = new Map(obs.volumes.map((v) => [v.id, v]));
  const rows = baseline.required.map((r) => {
    const v = byId.get(r.volume);
    if (!v) return { ...r, state: 'unknown', detail: `the probe reported no volume '${r.volume}'` };
    return { ...r, state: v.encrypted ? 'protected' : 'UNPROTECTED', detail: v.detail };
  });

  // A volume the probe saw that no baseline row claims. Grey: nobody said whether it matters.
  const declared = new Set(baseline.required.map((r) => r.volume));
  const undeclared = obs.volumes.filter((v) => !declared.has(v.id))
    .map((v) => ({ volume: v.id, encrypted: v.encrypted, detail: v.detail }));

  const findings = rows.filter((r) => r.state === 'UNPROTECTED');
  const grey = rows.some((r) => r.state === 'unknown') || undeclared.length > 0;
  return { at, platform: platform(), unknown: false, rows, undeclared, findings, state: findings.length ? 'findings' : grey ? 'grey' : 'ok' };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/disk-encryption.mjs [--json]   declared FDE baseline × this box\'s actual encryption state\n'
      + 'READ-ONLY: reports; never enables encryption — applying stays a human act.\n'
      + 'exit 0 baseline met, 1 a required volume is UNPROTECTED, 2 grey (unmeasured or undeclared volume)');
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.unknown) {
    console.log(`disk-encryption: UNKNOWN (${r.unknownReason}) — ${r.unknownDetail}`);
    for (const row of r.rows) console.log(`  UNKNOWN     ${row.volume}  (required: ${row.why || 'declared'})`);
  } else {
    console.log(`disk-encryption: ${r.state}  (platform ${r.platform}, ${r.at})`);
    for (const row of r.rows) console.log(`  ${String(row.state).padEnd(12)} ${row.volume}  ${row.detail}`);
    for (const u of r.undeclared) console.log(`  UNDECLARED   ${u.volume}  ${u.encrypted ? 'encrypted' : 'not encrypted'} — no baseline row claims this volume`);
  }
  process.exit(r.unknown ? 2 : r.findings.length ? 1 : r.state === 'ok' ? 0 : 2);
}
