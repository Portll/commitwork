// tool-version.mjs — ONE declaration of "what version is this scanner, and can it say".
//
// Two consumers, and they must never drift: monitor/package-inventory.mjs asks about the BOX
// (what is installed right now), bin/commitwork.mjs asks at SWEEP TIME (what produced this
// artifact). A second copy of the parsing rules would let those two disagree about the same
// binary, and the disagreement would surface as a finding attributed to a version that never ran.
//
// WHY THIS EXISTS AT ALL. On 2026-08-22 the trufflehog stamp in the roster read 3.95.9, the box ran
// 3.96.0, upstream was 3.97.0, and the gap was manufacturing 1,311 of the 1,314 CRITICAL findings
// the fleet published — one detector, fixed upstream. rollup.json recorded no scanner version
// anywhere, so not one of those findings could be attributed to a build after the fact. The version
// has to travel WITH the finding, not merely be knowable about the machine.

import { spawnSync } from 'node:child_process';
import { safeSpawnSync } from '../lib/win-spawn.mjs'; // npm-installed scanners are .cmd shims on Windows
import { resolvePinnedTool } from '../lib/cobolwork-resolve.mjs';

const env = (k) => process.env[k];   // read at CALL time — a module-level capture defeats CW_* overrides

// Declared exceptions only; everything else answers to `--version`. Verified by probing all 18
// installed roster tools on 2026-08-22 — 17 took `--version`, scorecard took `version`.
export const VERSION_ARGS = Object.freeze({ scorecard: ['version'] });

// WHICH LINE CARRIES THE TOOL'S OWN VERSION. Several of these print their RUNTIME's version too,
// and a first-number-wins regex picks whichever the tool happened to print first. Both directions
// were observed on this box:
//   scorecard    GitVersion: v5.5.0   THEN   GoVersion: go1.26.2      → first-match is correct
//   govulncheck  Go: go1.26.6         THEN   Scanner: govulncheck@... → first-match reports the
//                                                                       Go COMPILER as the scanner
// A tool absent from this table uses first-match, which is right for the seventeen that print one.
export const VERSION_LINE = Object.freeze({ govulncheck: /^\s*Scanner:/im });

// `v0.0.0` is what a Go tool built without version stamping reports. It is the ABSENCE of a version
// wearing a version's shape and must never be published as one.
export const NULL_VERSIONS = new Set(['0.0.0']);

/** The binary to invoke for `name`, honouring the CW_<NAME>_BIN test seam. */
export const binFor = (name) => env(`CW_${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '')}_BIN`) || name;

/**
 * Probe one tool's version.
 *
 * Returns one of:
 *   { state:'present', version:'1.2.3', versionState:'stated' }
 *   { state:'present', version:null, versionState:'unstated', unstatedReason, reason }
 *   { state:'unavailable'|'failed', reason }                             — not here / could not ask
 *
 * Never returns a version it did not read. stdout AND stderr are both read: Go tools routinely
 * print their banner to stderr, and probing stdout alone read nuclei as unversioned.
 *
 * `raw` carries the text that was actually read, so a second consumer can derive something this
 * function does not model without spawning the tool again — bin/scanner-preflight.mjs reads the
 * `Go:` build toolchain out of it. It is deliberately NOT published: versionsForTools() picks the
 * fields that travel beside a report, so raw banner text (paths, plugin lists) cannot reach an
 * artifact by being added here.
 *
 * `unstatedReason` distinguishes the two ways a tool answers without identifying itself, because
 * they have different remedies: 'null-version' is a real version string that identifies nothing
 * (Go's v0.0.0 — rebuild it from its module), 'unparseable' is no version-shaped text at all
 * (wrong flag, or a banner this table does not know how to read).
 */
export function probeToolVersion(name, { timeoutMs = 15_000 } = {}) {
  // A pinned tool is probed where the lanes run it (lib/cobolwork-resolve.mjs), never on PATH.
  const pinned = resolvePinnedTool(name);
  if (pinned && !pinned.ok) return { state: 'unavailable', reason: pinned.reason, resolvedFrom: pinned.source };
  const res = pinned ? { resolvedFrom: pinned.source, ...(pinned.commit ? { commit: pinned.commit } : {}) } : {};
  const r = probeWith(pinned ? pinned.path : binFor(name), pinned ? [pinned.file, pinned.args] : [binFor(name), []], name, timeoutMs);
  return { ...r, ...res };
}

function probeWith(bin, [file, pre], name, timeoutMs) {
  // safeSpawnSync, not spawnSync. On Windows a great many of these scanners are BATCH SHIMS rather
  // than executables — anything installed through npm lands as a `.cmd` — and node cannot spawn one
  // without a shell: it returns ENOENT (no PATHEXT when shell is false) or, given the explicit
  // `.cmd` path, EINVAL (the CVE-2024-27980 refusal). Both were read here as "not installed" or
  // "could not be run", so the tool's version went UNKNOWN and every report it produced carried no
  // provenance — a scanner that ran, attributed to nothing.
  //
  // This is the provenance record, so the failure is quiet in the expensive direction: a missing
  // stamp reads as "we did not check", which is true of the stamp and false of the scan.
  const r = safeSpawnSync(file, [...pre, ...(VERSION_ARGS[name] || ['--version'])], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  if (r.refused) return { state: 'failed', reason: `${bin} could not be run safely (${r.reason}) — UNKNOWN, not absent` };
  if (r.error) {
    if (r.error.code === 'ENOENT') return { state: 'unavailable', reason: `${bin} is not installed on this box` };
    return { state: 'failed', reason: `${bin} could not be run (${r.error.code || r.error.message}) — UNKNOWN, not absent` };
  }
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (!text.trim()) return { state: 'failed', reason: `${bin} produced no output at all — UNKNOWN, not current` };

  const line = VERSION_LINE[name];
  const hay = line ? (text.split('\n').find((l) => line.test(l)) ?? '') : text;
  const m = hay.match(/v?(\d+)\.(\d+)(?:\.(\d+))?/);
  const version = m ? `${m[1]}.${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}` : null;
  if (!version || NULL_VERSIONS.has(version)) {
    return { state: 'present', version: null, versionState: 'unstated', raw: text,
      unstatedReason: version ? 'null-version' : 'unparseable',
      reason: version
        ? `${bin} reports version ${version} — a build with no version stamped in it, so a finding it produced cannot be attributed to a build`
        : `${bin} answered but published no parseable version${line ? ' on its declared version line' : ''} — UNKNOWN, not current` };
  }
  return { state: 'present', version, versionState: 'stated', raw: text };
}

// The fields that travel BESIDE A REPORT. Written as an allowlist rather than a spread of whatever
// probeToolVersion returned, so that adding a field there (as `raw` was) cannot silently start
// writing banner text — install paths, plugin inventories — into every artifact the fleet publishes.
// resolvedFrom and commit say which install of a pinned tool ran: 'pinned' at the pin's commit, or
// the CW_<TOOL>_BIN 'override'.
const PUBLISHED = Object.freeze(['state', 'version', 'versionState', 'unstatedReason', 'reason', 'resolvedFrom', 'commit']);

/**
 * The versions behind ONE check, as written beside its report.
 *
 * The shape is deliberately per-check-per-tool rather than a fleet map: a check that declares two
 * tools has two provenances, and collapsing them would make it impossible to say which binary
 * produced which half of a report.
 */
export function versionsForTools(tools, opts) {
  const out = {};
  for (const t of (Array.isArray(tools) ? tools : [])) {
    const r = probeToolVersion(t, opts);
    const pub = {};
    for (const k of PUBLISHED) if (r[k] !== undefined) pub[k] = r[k];
    out[t] = pub;
  }
  return out;
}
